import { stat } from "node:fs/promises";
import type { Event } from "../core/events.js";
import type { ReadCheckpoint } from "../sources/jsonl.js";
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
    skipped_records: 0,
    skipped_turns: 0,
  };
  skipped: Record<string, unknown>[] = [];
  /** Skips on this page beyond the detail cap; pages' details plus these sum to the total. */
  skippedOmitted = 0;
  private bytes = 0;
  private events = 0;

  get signal() {
    return this.controller.signal;
  }

  reset() {
    this.bytes = 0;
    this.events = 0;
    this.skipped = [];
    this.skippedOmitted = 0;
  }

  skip(session: string, origin: string, reason: string, bytes?: number) {
    this.progress.skipped_transcripts++;
    this.detail(session, origin, reason, bytes);
  }

  skipTurns(session: string, origin: string, count: number) {
    this.progress.skipped_turns += count;
    this.detail(session, origin, "turn_buffer");
  }

  private detail(session: string, origin: string, reason: string, bytes?: number) {
    // Bound diagnostics too; the cumulative count includes omitted details.
    if (this.skipped.length >= 4) {
      this.skippedOmitted++;
      return;
    }
    this.skipped.push({
      session_id: excerpt(session, 160),
      origin: excerpt(origin, 40),
      reason,
      ...(bytes === undefined ? {} : { bytes }),
    });
  }

  async *file(
    file: string,
    session: string,
    origin: string,
    streaming = false,
  ): AsyncGenerator<ScanPause, boolean> {
    this.signal.throwIfAborted();
    const info = await stat(file);
    this.signal.throwIfAborted();
    if (!info.isFile() || (!streaming && info.size > MAX_TRANSCRIPT_BYTES)) {
      this.skip(session, origin, info.isFile() ? "transcript_size" : "not_regular_file", info.size);
      return false;
    }
    if (!streaming) {
      if (this.bytes + info.size > MAX_SCAN_BYTES) yield { kind: "pause", reason: "total_bytes" };
      this.bytes += info.size;
      this.progress.bytes_reserved += info.size;
    }
    this.progress.transcripts_read++;
    return true;
  }

  async *read(
    events: AsyncIterable<Event | ReadCheckpoint>,
    session: string,
    origin: string,
  ): AsyncGenerator<Event | ScanPause> {
    const iterator = events[Symbol.asyncIterator]();
    try {
      for (;;) {
        this.signal.throwIfAborted();
        if (this.events === MAX_SCAN_EVENTS) yield { kind: "pause", reason: "events" };
        this.signal.throwIfAborted();
        const next = await iterator.next();
        if (next.done) return;
        if ("kind" in next.value) {
          const checkpoint = next.value;
          if (checkpoint.kind === "bytes") {
            if (this.bytes + checkpoint.bytes > MAX_SCAN_BYTES)
              yield { kind: "pause", reason: "total_bytes" };
            this.bytes += checkpoint.bytes;
            this.progress.bytes_reserved += checkpoint.bytes;
          } else {
            this.progress.skipped_records++;
            this.detail(session, origin, "record_size", checkpoint.bytes);
          }
          continue;
        }
        this.events++;
        this.progress.events_read++;
        yield next.value;
      }
    } finally {
      await iterator.return?.();
    }
  }
}
