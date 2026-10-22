import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

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
