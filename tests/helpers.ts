// Builders for small, fake transcripts in Claude Code's format. Tests write them to a temp
// folder instead of committing real transcripts, which can contain code and secrets.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let clock = Date.parse("2026-10-01T10:00:00.000Z");
/** A timestamp that moves forward by `ms` each call. */
export const tick = (ms = 1000) => new Date((clock += ms)).toISOString();

export const prompt = (text: string) => ({
  type: "user",
  cwd: "/work/demo",
  gitBranch: "main",
  timestamp: tick(),
  message: { role: "user", content: text },
});

export const say = (text: string) => ({
  type: "assistant",
  timestamp: tick(),
  message: { role: "assistant", content: [{ type: "text", text }] },
});

export const call = (id: string, name: string, input: unknown) => ({
  type: "assistant",
  timestamp: tick(),
  message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
});

export const result = (
  id: string,
  output: string,
  opts: { error?: boolean; agentId?: string; ms?: number } = {},
) => ({
  type: "user",
  timestamp: tick(opts.ms ?? 500),
  message: {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: id, content: output, is_error: opts.error ?? false },
    ],
  },
  ...(opts.agentId ? { toolUseResult: { agentId: opts.agentId, status: "async_launched" } } : {}),
});

export const jsonl = (records: unknown[]) =>
  records.map((r) => JSON.stringify(r)).join("\n") + "\n";

/** Creates <root>/<project>/ and returns helpers to write sessions and subagents into it. */
export function makeProjectsRoot() {
  const root = mkdtempSync(join(tmpdir(), "runlens-"));
  const project = join(root, "-work-demo");
  mkdirSync(project);
  return {
    root,
    writeSession(id: string, records: unknown[] | string) {
      const file = join(project, `${id}.jsonl`);
      writeFileSync(file, typeof records === "string" ? records : jsonl(records));
      return file;
    },
    writeSubagent(
      sessionId: string,
      agentId: string,
      records: unknown[],
      files: Record<string, unknown> = {},
    ) {
      const dir = join(project, sessionId, "subagents");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `agent-${agentId}.jsonl`), jsonl(records));
      for (const [suffix, value] of Object.entries(files)) {
        writeFileSync(join(dir, `agent-${agentId}.${suffix}`), JSON.stringify(value));
      }
    },
  };
}
