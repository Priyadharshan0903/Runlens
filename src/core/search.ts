// Search parsed text without sending whole transcripts to the browser or writing an index to disk.
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Listing } from "./discover.js";
import { parseRecords } from "./parse.js";
import { subagentDir } from "./session.js";
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
    const file = listing.files.get(session.id)!;
    const snippet = await searchFile(file, query, signal);
    if (snippet) {
      matches.push({ id: session.id, snippet, source: "session" });
      continue;
    }
    const dir = subagentDir(file);
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      signal?.throwIfAborted();
      if (!name.startsWith("agent-") || !name.endsWith(".jsonl")) continue;
      const agentSnippet = await searchFile(join(dir, name), query, signal);
      if (agentSnippet) {
        matches.push({ id: session.id, snippet: agentSnippet, source: "subagent" });
        break;
      }
    }
  }
  return matches;
}

async function searchFile(
  file: string,
  query: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return;
  const stamp = `${info.size}:${info.mtimeMs}`;
  const hit = cache.get(file);
  if (hit?.stamp === stamp && hit.query === query) return hit.snippet;
  signal?.throwIfAborted();
  const input = createReadStream(file, { encoding: "utf8", signal });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let snippet: string | undefined;
  try {
    for await (const line of lines) {
      signal?.throwIfAborted();
      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (!record || typeof record !== "object" || Array.isArray(record)) continue;
      const { events } = parseRecords([record as Record<string, unknown>]);
      for (const event of events) {
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
      if (snippet) break;
    }
  } finally {
    lines.close();
    input.destroy();
  }
  cache.set(file, { stamp, query, snippet });
  if (cache.size > 1000) cache.delete(cache.keys().next().value!);
  return snippet;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
