import { randomUUID } from "node:crypto";
import { HistoryError, historyResponse } from "./safety.js";
import { ScanBudget, type ScanItem, type ScanRecord } from "./scan.js";

/** A live cursor holds an open reader; agents follow next_cursor within seconds. */
export const CURSOR_IDLE_MS = 2 * 60_000;
/** Bounds how stale a long walk's session list can become, however often it is followed. */
export const CURSOR_MAX_AGE_MS = 10 * 60_000;
/** A consumed cursor keeps only its response, for a retry whose reply was lost. */
export const CURSOR_REPLAY_MS = 60_000;
export const MAX_LIVE_CURSORS = 8;
export const MAX_REPLAY_CURSORS = 16;

interface HistoryPage extends Record<string, unknown> {
  next_cursor: string | null;
  next_offset: number | null;
}

export interface HistoryScan {
  key: string;
  base: Record<string, unknown>;
  field: "results" | "turns";
  budget: ScanBudget;
  iterator: AsyncGenerator<ScanRecord>;
  offset: number;
  remainingOffset: number;
  startedAt?: number;
  pending?: ScanItem[];
  finished?: boolean;
}

interface Continuation {
  key: string;
  scan?: HistoryScan;
  pending?: Promise<HistoryPage>;
  response?: HistoryPage;
  limit?: number;
  timer: ReturnType<typeof setTimeout>;
}

/** Opaque process-local cursors retain reader/decoder state, including unfinished turns. */
export class HistoryPagination {
  private readonly cursors = new Map<string, Continuation>();

  async resume(cursor: string, key: string, limit: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const continuation = this.cursors.get(cursor);
    if (!continuation || continuation.key !== key)
      throw new HistoryError(
        "invalid_cursor",
        "Cursor expired or does not match this query, session, project or output options. Resume with offset set to next_offset from your last page, or restart without cursor.",
      );
    if (continuation.limit !== undefined && continuation.limit !== limit)
      throw new HistoryError(
        "invalid_cursor",
        "Retry a consumed cursor with the same limit, or use the returned next_cursor.",
      );
    if (continuation.response) return continuation.response;
    // A duplicate call while the page is read shares it instead of finding no scan.
    if (continuation.pending) return continuation.pending;
    const scan = continuation.scan!;
    // Transfer ownership before reading; a failure closes this scan.
    continuation.scan = undefined;
    continuation.limit = limit;
    clearTimeout(continuation.timer);
    continuation.pending = this.page(scan, limit, signal).then(
      (response) => {
        continuation.pending = undefined;
        continuation.response = response;
        if (this.cursors.get(cursor) === continuation) this.keepForReplay(cursor, continuation);
        return response;
      },
      (error: unknown) => {
        this.remove(cursor);
        throw error;
      },
    );
    return continuation.pending;
  }

  async page(scan: HistoryScan, limit: number, signal?: AbortSignal) {
    const abort = () => scan.budget.controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    scan.budget.reset();
    scan.startedAt ??= Date.now();
    const items: ScanItem[] = [];
    let done = false;
    let stopReason = "page_full";
    try {
      signal?.throwIfAborted();
      while (items.length < limit) {
        const pending = scan.pending?.shift();
        const next = pending
          ? { done: false, value: pending }
          : scan.finished
            ? { done: true as const }
            : await scan.iterator.next();
        signal?.throwIfAborted();
        if (next.done) {
          scan.finished = true;
          done = true;
          stopReason = "complete";
          break;
        }
        const record = next.value;
        if (record.kind === "pause") {
          stopReason = record.reason;
          break;
        }
        if (scan.remainingOffset > 0) {
          scan.remainingOffset--;
          if (record.last) {
            scan.finished = true;
            done = true;
            stopReason = "complete";
            break;
          }
          continue;
        }
        items.push(record);
        if (record.last) {
          scan.finished = true;
          done = true;
          stopReason = "complete";
          break;
        }
      }
      signal?.throwIfAborted();
      const cursor = randomUUID();
      let response: HistoryPage;
      let oversized = 0;
      for (;;) {
        try {
          response = historyResponse({
            ...scan.base,
            [scan.field]: items.map((item) => item.value),
            next_offset: done ? null : scan.offset + oversized + items.length,
            next_cursor: done ? null : cursor,
            partial:
              !done ||
              oversized > 0 ||
              scan.budget.progress.skipped_transcripts > 0 ||
              scan.budget.progress.skipped_records > 0 ||
              scan.budget.progress.skipped_turns > 0,
            stop_reason: stopReason,
            scan_progress: { ...scan.budget.progress },
            skipped: [...scan.budget.skipped],
            ...(scan.budget.skippedOmitted ? { skipped_omitted: scan.budget.skippedOmitted } : {}),
            ...(oversized ? { omitted_oversized: oversized } : {}),
          });
          break;
        } catch (error) {
          if (
            !(error instanceof HistoryError) ||
            error.code !== "response_limit" ||
            items.length === 0
          )
            throw error;
          if (items.length === 1) {
            // An entry too large for any page is omitted, not allowed to strand the walk.
            items.pop();
            oversized++;
            if (!done) stopReason = "response_bytes";
            continue;
          }
          (scan.pending ??= []).unshift(items.pop()!);
          done = false;
          stopReason = "response_bytes";
        }
      }
      // Omitted entries still occupy their offsets, so legacy offsets stay aligned.
      scan.offset += oversized + items.length;
      if (!done) this.save(scan, cursor);
      if (done) await this.closeScan(scan);
      return response;
    } catch (error) {
      await this.closeScan(scan);
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  private save(scan: HistoryScan, cursor: string) {
    // Live cursors are created in use order and consumed once, so the oldest is least recent.
    this.evict((entry) => entry.scan !== undefined, MAX_LIVE_CURSORS - 1);
    const remaining = scan.startedAt! + CURSOR_MAX_AGE_MS - Date.now();
    const timer = setTimeout(
      () => this.remove(cursor),
      Math.max(0, Math.min(CURSOR_IDLE_MS, remaining)),
    );
    timer.unref();
    this.cursors.set(cursor, { key: scan.key, scan, timer });
    return cursor;
  }

  private keepForReplay(cursor: string, continuation: Continuation) {
    continuation.timer = setTimeout(() => this.remove(cursor), CURSOR_REPLAY_MS);
    continuation.timer.unref();
    this.evict((entry) => entry.response !== undefined, MAX_REPLAY_CURSORS);
  }

  /** Remove the oldest matching entries until at most `keep` remain. */
  private evict(matches: (entry: Continuation) => boolean, keep: number) {
    const entries = [...this.cursors].filter(([, entry]) => matches(entry));
    for (const [cursor] of entries.slice(0, Math.max(0, entries.length - keep)))
      this.remove(cursor);
  }

  private remove(cursor: string) {
    const continuation = this.cursors.get(cursor);
    if (!continuation) return;
    this.cursors.delete(cursor);
    clearTimeout(continuation.timer);
    if (continuation.scan) void this.closeScan(continuation.scan).catch(() => {});
  }

  private async closeScan(scan: HistoryScan) {
    scan.budget.controller.abort();
    await scan.iterator.return(undefined);
  }

  close() {
    for (const cursor of this.cursors.keys()) this.remove(cursor);
  }
}
