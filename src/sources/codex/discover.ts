import { realpathSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { DiscoveredSession } from "../types.js";
import { streamRecords } from "../jsonl.js";
import { CodexDecoder, type CodexInfo } from "./parse.js";

interface IndexedSession {
  file: string;
  info: CodexInfo;
  summary: DiscoveredSession["summary"];
}

const cache = new Map<string, { stamp: string; value?: IndexedSession }>();
let byFile = new Map<string, IndexedSession>();
let byParent = new Map<string, IndexedSession[]>();

export function defaultRoots(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  const roots = new Map<string, string>();
  const homes = [env.CODEX_HOME, join(home, ".codex")].filter((path): path is string => !!path);
  for (const base of homes) {
    for (const name of ["sessions", "archived_sessions"]) {
      const folder = resolve(base, name);
      try {
        if (!statSync(folder).isDirectory()) continue;
        const real = realpathSync(folder);
        if (!roots.has(real)) roots.set(real, folder);
      } catch {
        // An absent history is normal when Codex hasn't been used on this machine.
      }
    }
  }
  return [...roots.values()];
}

export async function discover(roots: string[]): Promise<DiscoveredSession[]> {
  const next = new Map<string, IndexedSession>();
  for (const root of roots) {
    for await (const file of rolloutFiles(root)) {
      const session = await summarize(file);
      if (session && !next.has(session.summary.id)) next.set(session.summary.id, session);
    }
  }
  const children = new Map<string, IndexedSession[]>();
  for (const session of next.values()) {
    if (!session.info.parentId) continue;
    const siblings = children.get(session.info.parentId) ?? [];
    siblings.push(session);
    children.set(session.info.parentId, siblings);
  }
  byFile = new Map([...next.values()].map((session) => [session.file, session]));
  byParent = children;
  // Children belong to their recorded parent; an orphan remains accessible as its own session.
  return [...next.values()]
    .filter((session) => !session.info.parentId || !next.has(session.info.parentId))
    .map((session) => ({
      file: session.file,
      summary: {
        ...session.summary,
        subagents: childSessions(session.file).length,
      },
    }));
}

export function childSessions(file: string): IndexedSession[] {
  const main = byFile.get(file);
  if (!main) return [];
  const found: IndexedSession[] = [];
  const parents = new Set([main.summary.id]);
  // Breadth first preserves parent-before-child linking without trusting depth fields.
  for (const parent of parents) {
    for (const session of byParent.get(parent) ?? []) {
      if (!parents.has(session.summary.id)) {
        parents.add(session.summary.id);
        found.push(session);
      }
    }
  }
  return found;
}

async function* rolloutFiles(root: string): AsyncIterable<string> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(root, entry.name);
    if (entry.isDirectory()) yield* rolloutFiles(file);
    else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl"))
      yield file;
  }
}

async function summarize(file: string): Promise<IndexedSession | undefined> {
  const info = await stat(file).catch(() => undefined);
  if (!info?.isFile()) return;
  const stamp = `${info.size}:${info.mtimeMs}`;
  const cached = cache.get(file);
  if (cached?.stamp === stamp) return cached.value;

  const decoder = new CodexDecoder();
  let prompt: string | undefined;
  try {
    for await (const record of streamRecords(file)) {
      for (const event of decoder.decode(record)) {
        if (event.type === "prompt") prompt = event.text;
      }
      if (prompt && decoder.info.id) break;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const id = decoder.info.id;
  const firstPrompt = prompt
    ?.split("\n")
    .find((line) => line.trim())
    ?.slice(0, 200);
  const value =
    id && /^[\w-]+$/.test(id) && firstPrompt
      ? {
          file,
          info: decoder.info,
          summary: {
            id,
            title: firstPrompt,
            firstPrompt,
            cwd: decoder.info.cwd,
            startedAt: decoder.info.startedAt,
            updatedAt: info.mtime.toISOString(),
            sizeBytes: info.size,
            subagents: 0,
          },
        }
      : undefined;
  cache.set(file, { stamp, value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return value;
}
