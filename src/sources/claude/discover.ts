// Finds sessions on disk and builds the list shown in the sidebar.
// Listing reads only the lines it needs (title, first prompt, folder) and is cached by
// file size + modified time, so reopening the list doesn't re-read unchanged files.

import { createReadStream, readdirSync, realpathSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseRecords } from "./parse.js";
import { sessionId, subagentDir } from "./session.js";
import type { DiscoveredSession } from "../types.js";
type SessionSummary = DiscoveredSession["summary"];

/** Include the active config, standard history, and locally configured account histories. */
export function defaultRoots(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  const accountsDir = join(home, ".claude-accounts");
  let accountNames: string[] = [];
  try {
    accountNames = readdirSync(accountsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch {
    // Most installations have no account-switcher folder.
  }

  const candidates = [
    env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, "projects") : undefined,
    join(home, ".claude", "projects"),
    ...accountNames.map((name) => join(accountsDir, name, "projects")),
  ];
  const roots = new Map<string, string>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const path = resolve(candidate);
    try {
      if (!statSync(path).isDirectory()) continue;
      const realPath = realpathSync(path);
      if (!roots.has(realPath)) roots.set(realPath, path);
    } catch {
      // Missing, inaccessible, or dangling account folders don't block the other histories.
    }
  }
  return [...roots.values()];
}

const cache = new Map<string, { key: string; summary: SessionSummary | null }>();

export async function discover(
  roots: string[],
  signal?: AbortSignal,
): Promise<DiscoveredSession[]> {
  signal?.throwIfAborted();
  const files = new Map<string, string>();
  const sessions: DiscoveredSession[] = [];

  for (const root of roots) {
    for (const project of await safeReaddir(root)) {
      const projectDir = join(root, project);
      for (const name of await safeReaddir(projectDir)) {
        if (!name.endsWith(".jsonl")) continue;
        const file = join(projectDir, name);
        signal?.throwIfAborted();
        const summary = await summarize(file, signal);
        if (!summary || files.has(summary.id)) continue;
        files.set(summary.id, file);
        sessions.push({ file, summary });
      }
    }
  }

  return sessions;
}

async function summarize(file: string, signal?: AbortSignal): Promise<SessionSummary | null> {
  signal?.throwIfAborted();
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return null;
  const agents = await safeReaddir(subagentDir(file));
  const key = `${info.size}:${info.mtimeMs}:${agents.join(",")}`;
  const cached = cache.get(file);
  if (cached?.key === key) return cached.summary;

  let title: string | undefined;
  let customTitle: string | undefined;
  let firstPrompt: string | undefined;
  let cwd: string | undefined;
  let startedAt: string | undefined;

  const input = createReadStream(file, { encoding: "utf8", signal });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      signal?.throwIfAborted();
      // Cheap text checks first; only parse the few lines that matter.
      const isTitle = /"type"\s*:\s*"(?:ai-title|custom-title|summary)"/.test(line);
      const wantPrompt = !firstPrompt && /"type"\s*:\s*"user"/.test(line);
      const wantStart = !startedAt && line.includes('"timestamp"');
      if (!isTitle && !wantPrompt && !wantStart) continue;

      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record.type === "ai-title" && typeof record.aiTitle === "string") title = record.aiTitle;
      if (record.type === "summary" && !title && typeof record.summary === "string")
        title = record.summary;
      if (record.type === "custom-title" && typeof record.customTitle === "string")
        customTitle = record.customTitle;
      if (!startedAt && typeof record.timestamp === "string") startedAt = record.timestamp;
      if (wantPrompt) {
        const prompt = parseRecords([record]).events.find((e) => e.type === "prompt");
        if (prompt?.type === "prompt") {
          firstPrompt = prompt.text.split("\n")[0].slice(0, 200);
          if (typeof record.cwd === "string") cwd = record.cwd;
        }
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  signal?.throwIfAborted();

  // Sessions where nothing was ever asked (e.g. opened and closed) aren't worth listing.
  const summary: SessionSummary | null = firstPrompt
    ? {
        id: sessionId(file),
        title: customTitle ?? title ?? firstPrompt,
        firstPrompt,
        cwd,
        startedAt,
        updatedAt: info.mtime.toISOString(),
        sizeBytes: info.size,
        subagents: agents.filter((n) => n.endsWith(".jsonl")).length,
      }
    : null;
  cache.set(file, { key, summary });
  return summary;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
