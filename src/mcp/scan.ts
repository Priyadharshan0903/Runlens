import { stat } from "node:fs/promises";
import { excerpt, MAX_SCAN_BYTES, MAX_SCAN_EVENTS, MAX_TRANSCRIPT_BYTES } from "./safety.js";

export interface ScanPause {
  kind: "pause";
  reason: "total_bytes" | "events";
}

export interface ScanItem {
  kind: "item";
  value: Record<string, unknown>;
  last: boolean;
}

export type ScanRecord = ScanPause | ScanItem;

/** Per-call work limits with cumulative progress across cursor pages. */
export class ScanBudget {
  readonly controller = new AbortController();
  readonly progress = {
    sessions_completed: 0,
    transcripts_read: 0,
    bytes_reserved: 0,
    events_read: 0,
    skipped_transcripts: 0,
  };
  skipped: Record<string, unknown>[] = [];
  private bytes = 0;
  private events = 0;

  get signal() {
    return this.controller.signal;
  }

  reset() {
    this.bytes = 0;
    this.events = 0;
    this.skipped = [];
  }

  skip(session: string, origin: string, reason: string, bytes?: number) {
    this.progress.skipped_transcripts++;
    // Bound diagnostics too; the cumulative count includes omitted details.
    if (this.skipped.length < 4)
      this.skipped.push({
        session_id: excerpt(session, 160),
        origin: excerpt(origin, 40),
        reason,
        ...(bytes === undefined ? {} : { bytes }),
      });
  }

  async *file(file: string, session: string, origin: string): AsyncGenerator<ScanPause, boolean> {
    this.signal.throwIfAborted();
    const info = await stat(file);
    this.signal.throwIfAborted();
    if (!info.isFile() || info.size > MAX_TRANSCRIPT_BYTES) {
      this.skip(session, origin, info.isFile() ? "transcript_size" : "not_regular_file", info.size);
      return false;
    }
    if (this.bytes + info.size > MAX_SCAN_BYTES) yield { kind: "pause", reason: "total_bytes" };
    this.bytes += info.size;
    this.progress.bytes_reserved += info.size;
    this.progress.transcripts_read++;
    return true;
  }

  async *read<T>(events: AsyncIterable<T>): AsyncGenerator<T | ScanPause> {
    const iterator = events[Symbol.asyncIterator]();
    try {
      for (;;) {
        this.signal.throwIfAborted();
        if (this.events === MAX_SCAN_EVENTS) yield { kind: "pause", reason: "events" };
        this.signal.throwIfAborted();
        const next = await iterator.next();
        if (next.done) return;
        this.events++;
        this.progress.events_read++;
        yield next.value;
      }
    } finally {
      await iterator.return?.();
    }
  }
}
