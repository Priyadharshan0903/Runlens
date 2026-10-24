import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Event } from "../../core/events.js";
import type { SourceReader, SearchFile } from "../types.js";
import { scanRecords, type RecordScanOptions } from "../jsonl.js";
import { defaultRoots, discover } from "./discover.js";
import { parseRecords, streamRecords } from "./parse.js";
import { loadSession, subagentDir } from "./session.js";

export const claudeReader: SourceReader = {
  source: { id: "claude", name: "Claude Code" },
  defaultRoots,
  discover,
  load: loadSession,
  searchFiles,
  readEvents,
  scanEvents,
};

async function* searchFiles(file: string): AsyncIterable<SearchFile> {
  yield { file, source: "session" };
  const dir = subagentDir(file);
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names) {
    if (name.startsWith("agent-") && name.endsWith(".jsonl")) {
      yield { file: join(dir, name), source: "subagent" };
    }
  }
}

async function* scanEvents(
  file: string,
  signal: AbortSignal | undefined,
  options: RecordScanOptions,
) {
  for await (const record of scanRecords(file, signal, options)) {
    if (record.kind === "record") yield* parseRecords([record.value]).events;
    else yield record;
  }
}

async function* readEvents(file: string, signal?: AbortSignal): AsyncIterable<Event> {
  for await (const record of streamRecords(file, signal)) {
    yield* parseRecords([record]).events;
  }
}
