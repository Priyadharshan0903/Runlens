// Search parsed text without sending whole transcripts to the browser or writing an index to disk.
import { stat } from "node:fs/promises";
import type { Listing } from "./discover.js";
import type { SourceReader } from "../sources/types.js";
import type { SearchMatch } from "./types.js";

const cache = new Map<string, { stamp: string; query: string; snippet?: string }>();

export async function searchSessions(
  listing: Listing,
  rawQuery: string,
  signal?: AbortSignal,
): Promise<SearchMatch[]> {
  signal?.throwIfAborted();
  const query = normalize(rawQuery).slice(0, 200);
  if (query.length < 2) return [];
  const matches: SearchMatch[] = [];
  for (const session of listing.sessions) {
    signal?.throwIfAborted();
    const entry = listing.files.get(session.id)!;
    for await (const { file, source } of entry.reader.searchFiles(entry.file)) {
      signal?.throwIfAborted();
      const snippet = await searchFile(entry.reader, file, query, signal);
      if (snippet) {
        matches.push({ id: session.id, snippet, source });
        break;
      }
    }
  }
  return matches;
}

async function searchFile(
  reader: SourceReader,
  file: string,
  query: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return;
  const stamp = `${info.size}:${info.mtimeMs}`;
  const cacheKey = `${reader.source.id}:${file}`;
  const hit = cache.get(cacheKey);
  if (hit?.stamp === stamp && hit.query === query) return hit.snippet;
  signal?.throwIfAborted();
  let snippet: string | undefined;
  for await (const event of reader.readEvents(file, signal)) {
    signal?.throwIfAborted();
    const text =
      "text" in event
        ? event.text
        : event.type === "tool_result"
          ? event.output
          : event.type === "tool_use"
            ? `${event.name} ${JSON.stringify(event.input)}`
            : "";
    const plain = text.replace(/\s+/g, " ").trim();
    const position = normalize(plain).indexOf(query);
    if (position >= 0) {
      const start = Math.max(0, position - 65);
      snippet = `${start ? "…" : ""}${plain.slice(start, position + query.length + 130)}${plain.length > position + query.length + 130 ? "…" : ""}`;
      break;
    }
  }
  signal?.throwIfAborted();
  cache.set(cacheKey, { stamp, query, snippet });
  if (cache.size > 1000) cache.delete(cache.keys().next().value!);
  return snippet;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
