import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export type ReadCheckpoint =
  | { kind: "bytes"; bytes: number }
  | { kind: "skipped_record"; bytes: number };

export interface RecordScanOptions {
  maxRecordBytes: number;
}

/** Bounded records and raw-byte checkpoints, including records that emit no normalized event. */
export async function* scanRecords(
  file: string,
  signal: AbortSignal | undefined,
  { maxRecordBytes }: RecordScanOptions,
): AsyncIterable<ReadCheckpoint | { kind: "record"; value: Record<string, unknown> }> {
  signal?.throwIfAborted();
  const input = createReadStream(file, { signal, highWaterMark: 64 * 1024 });
  let pieces: Buffer[] = [];
  let length = 0;
  function finish() {
    const bytes = length;
    length = 0;
    const fragments = pieces;
    pieces = [];
    if (bytes > maxRecordBytes) return { kind: "skipped_record" as const, bytes };
    try {
      const value: unknown = JSON.parse(Buffer.concat(fragments, bytes).toString("utf8"));
      if (value && typeof value === "object" && !Array.isArray(value))
        return { kind: "record" as const, value: value as Record<string, unknown> };
    } catch {
      // Skip damaged/live partial records, as in the viewer reader.
    }
  }
  try {
    for await (const chunk of input) {
      signal?.throwIfAborted();
      yield { kind: "bytes", bytes: chunk.length };
      let start = 0;
      while (start < chunk.length) {
        signal?.throwIfAborted();
        const end = chunk.indexOf(10, start);
        const part = chunk.subarray(start, end === -1 ? chunk.length : end);
        length += part.length;
        if (length <= maxRecordBytes) pieces.push(part);
        else pieces = [];
        if (end === -1) break;
        const record = finish();
        if (record) yield record;
        start = end + 1;
      }
    }
    if (length) {
      const record = finish();
      if (record) yield record;
    }
  } finally {
    input.destroy();
  }
}

/** Skip damaged/live partial records and close handles when a consumer stops early. */
export async function* streamRecords(
  file: string,
  signal?: AbortSignal,
): AsyncIterable<Record<string, unknown>> {
  signal?.throwIfAborted();
  const input = createReadStream(file, { encoding: "utf8", signal });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      signal?.throwIfAborted();
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        yield value as Record<string, unknown>;
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
}
