import { randomUUID } from "node:crypto";
import { HistoryError, historyResponse } from "./safety.js";
import { ScanBudget, type ScanItem, type ScanRecord } from "./scan.js";

const CURSOR_TTL_MS = 5 * 60_000;
const MAX_CURSORS = 16;

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
  pending?: ScanItem[];
  finished?: boolean;
}

interface Continuation {
  key: string;
  scan?: HistoryScan;
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
        "Cursor expired or does not match this query, session and project. Restart without cursor.",
      );
    if (continuation.response) {
      if (continuation.limit !== limit)
        throw new HistoryError(
          "invalid_cursor",
          "Retry a consumed cursor with the same limit, or use the returned next_cursor.",
        );
      return continuation.response;
    }
    const scan = continuation.scan!;
    // Transfer ownership before reading; a failure closes this scan.
    continuation.scan = undefined;
    try {
      const response = await this.page(scan, limit, signal);
      continuation.response = response;
      continuation.limit = limit;
      return response;
    } catch (error) {
      this.remove(cursor);
      throw error;
    }
  }

  async page(scan: HistoryScan, limit: number, signal?: AbortSignal) {
    const abort = () => scan.budget.controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    scan.budget.reset();
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
      for (;;) {
        try {
          response = historyResponse({
            ...scan.base,
            [scan.field]: items.map((item) => item.value),
            next_offset: done ? null : scan.offset + items.length,
            next_cursor: done ? null : cursor,
            partial: !done || scan.budget.progress.skipped_transcripts > 0,
            stop_reason: stopReason,
            scan_progress: { ...scan.budget.progress },
            skipped: [...scan.budget.skipped],
          });
          break;
        } catch (error) {
          if (
            !(error instanceof HistoryError) ||
            error.code !== "response_limit" ||
            items.length <= 1
          )
            throw error;
          (scan.pending ??= []).unshift(items.pop()!);
          done = false;
          stopReason = "response_bytes";
        }
      }
      scan.offset += items.length;
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
    while (this.cursors.size >= MAX_CURSORS) this.remove(this.cursors.keys().next().value!);
    const timer = setTimeout(() => this.remove(cursor), CURSOR_TTL_MS);
    timer.unref();
    this.cursors.set(cursor, { key: scan.key, scan, timer });
    return cursor;
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
