import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listSessions } from "../src/core/discover.js";
import type { Event } from "../src/core/events.js";
import { searchSessions } from "../src/core/search.js";
import { loadSession } from "../src/core/session.js";
import { buildTurns } from "../src/core/tree.js";
import type { ToolAction } from "../src/core/types.js";
import { claudeReader } from "../src/sources/claude/reader.js";
import { describeTool } from "../src/sources/claude/tools.js";
import type { SourceReader } from "../src/sources/types.js";
import { summarizeSession } from "../ui/features/session/session-data.js";
import { groupSessionsByProject } from "../ui/features/library/session-list.js";
import { makeProjectsRoot, prompt, tick } from "./helpers.js";

// Deliberately not Claude JSONL: an adapter for a JSON document with unrelated tool names.
function fixtureReader(root: string, events: Event[], cwd?: string): SourceReader {
  mkdirSync(root, { recursive: true });
  const file = join(root, "main.trace");
  writeFileSync(file, JSON.stringify({ events, hiddenMetadata: "unsearchable bookkeeping" }));

  async function* readEvents(path: string, signal?: AbortSignal): AsyncIterable<Event> {
    signal?.throwIfAborted();
    const document = JSON.parse(await readFile(path, "utf8"));
    for (const event of document.events) {
      signal?.throwIfAborted();
      yield event;
    }
  }

  return {
    source: { id: "fixture", name: "Fixture Agent" },
    defaultRoots: () => [root],
    discover: async () => [
      {
        file,
        summary: {
          id: "shared",
          title: "Adapter session",
          firstPrompt: "Inspect the project",
          cwd,
          updatedAt: "2026-10-22T12:00:00.000Z",
          sizeBytes: 100,
          subagents: 0,
        },
      },
    ],
    load: async (path) => {
      const document = JSON.parse(await readFile(path, "utf8"));
      const built = buildTurns(document.events);
      return {
        id: "shared",
        title: "Adapter session",
        cwd,
        turns: built.turns,
        stats: built.stats,
        unlinkedAgents: [],
      };
    },
    async *searchFiles(path) {
      yield { file: path, source: "session" };
      yield { file: join(root, "child.trace"), source: "subagent" };
    },
    readEvents,
  };
}

const tool = (id: string, name: string, action: ToolAction): Event => ({
  type: "tool_use",
  id,
  name,
  input: { arbitrary: true },
  summary: `${name} details`,
  action,
  at: tick(),
});
const result = (id: string, isError = false): Event => ({
  type: "tool_result",
  toolUseId: id,
  isError,
  output: isError ? "failed" : "done",
  at: tick(),
});

describe("source adapters", () => {
  it("keeps colliding local ids separate, preserves Claude ids, and groups projects across sources", async () => {
    const projects = makeProjectsRoot();
    const workspace = join(projects.root, "workspace");
    mkdirSync(join(workspace, "src"), { recursive: true });
    projects.writeSession("shared", [{ ...prompt("Inspect the project"), cwd: workspace }]);
    const reader = fixtureReader(join(projects.root, "fixture"), [], join(workspace, "src"));
    const listing = await listSessions([
      { reader: claudeReader, roots: [projects.root] },
      { reader, roots: reader.defaultRoots() },
    ]);

    expect(listing.sessions.map((session) => session.id).sort()).toEqual([
      "fixture--shared",
      "shared",
    ]);
    expect(groupSessionsByProject(listing.sessions)).toHaveLength(1);
    expect(listing.sessions.every((session) => session.project?.id === workspace)).toBe(true);
    const session = await loadSession(listing.files.get("fixture--shared")!);
    expect(session).toMatchObject({ id: "fixture--shared", source: reader.source });
    expect((await loadSession(listing.files.get("shared")!)).source).toEqual(claudeReader.source);
    expect(session.costUSD).toBeUndefined();
    expect(session.usage).toBeUndefined();
  });

  it("drives file activity and failures from normalized actions, including multi-file calls", async () => {
    const { root } = makeProjectsRoot();
    const edit: ToolAction = {
      kind: "change",
      verb: "Patch",
      icon: "edit",
      files: [
        { path: "a.ts", operation: "change", added: 3, removed: 1 },
        { path: "b.ts", operation: "change", added: 2, removed: 0 },
      ],
    };
    const reader = fixtureReader(root, [
      { type: "prompt", text: "Inspect the project", at: tick() },
      tool("scan", "scan_source", {
        kind: "look",
        verb: "Inspect",
        icon: "file",
        files: [{ path: "a.ts", operation: "read", added: 0, removed: 0 }],
      }),
      result("scan"),
      tool("patch", "apply_patch_set", edit),
      result("patch"),
      tool("failed", "apply_patch_set", edit),
      result("failed", true),
      tool("pending", "apply_patch_set", edit),
    ]);
    const listing = await listSessions([{ reader, roots: [root] }]);
    const session = await loadSession(listing.files.get("fixture--shared")!);
    const overview = summarizeSession(session);

    expect(
      overview.files.map(({ path, reads, edits, added, removed }) => ({
        path,
        reads,
        edits,
        added,
        removed,
      })),
    ).toEqual([
      { path: "a.ts", reads: 1, edits: 3, added: 3, removed: 1 },
      { path: "b.ts", reads: 0, edits: 3, added: 2, removed: 0 },
    ]);
    expect(overview.failedCalls.map(({ step }) => step.id)).toEqual(["failed"]);
    expect(session.stats).toEqual({ toolCalls: 4, errors: 1, subagents: 0 });
    expect(overview.calls.every(({ step }) => step.reasoning === undefined)).toBe(true);
  });

  it("searches reader events and child files without searching unrelated file metadata", async () => {
    const { root } = makeProjectsRoot();
    const reader = fixtureReader(root, [
      { type: "text", text: "Evidence from the main agent", at: tick() },
    ]);
    writeFileSync(
      join(root, "child.trace"),
      JSON.stringify({ events: [{ type: "text", text: "Child adapter evidence", at: tick() }] }),
    );
    const listing = await listSessions([{ reader, roots: [root] }]);

    expect(await searchSessions(listing, "main agent")).toEqual([
      { id: "fixture--shared", snippet: "Evidence from the main agent", source: "session" },
    ]);
    expect(await searchSessions(listing, "child adapter")).toEqual([
      { id: "fixture--shared", snippet: "Child adapter evidence", source: "subagent" },
    ]);
    expect(await searchSessions(listing, "unsearchable bookkeeping")).toEqual([]);
  });

  it("closes the reader iterator after a match and propagates cancellation", async () => {
    const { root } = makeProjectsRoot();
    const reader = fixtureReader(root, []);
    let closed = 0;
    let visited = 0;
    reader.readEvents = async function* (_file, signal) {
      try {
        for (const text of ["matching evidence", "later work"]) {
          signal?.throwIfAborted();
          visited++;
          yield { type: "text", text, at: tick() };
        }
      } finally {
        closed++;
      }
    };
    const listing = await listSessions([{ reader, roots: [root] }]);
    expect(await searchSessions(listing, "matching evidence")).toHaveLength(1);
    expect({ visited, closed }).toEqual({ visited: 1, closed: 1 });
    const controller = new AbortController();
    const readEvents = reader.readEvents;
    reader.readEvents = async function* (file, signal) {
      for await (const event of readEvents(file, signal)) {
        controller.abort();
        yield event;
      }
    };
    await expect(searchSessions(listing, "another query", controller.signal)).rejects.toMatchObject(
      { name: "AbortError" },
    );
    expect(closed).toBe(2);
  });

  it("retains recorded reasoning independently of the text explaining a call", () => {
    const { turns } = buildTurns([
      { type: "prompt", text: "Inspect", at: tick() },
      { type: "text", text: "Checking the source", at: tick() },
      { type: "thinking", text: "Recorded reasoning summary", at: tick() },
      tool("run", "execute_program", {
        kind: "run",
        verb: "Execute",
        icon: "terminal",
        command: "test-program",
      }),
    ]);
    expect(turns[0].steps[0]).toMatchObject({
      why: "Checking the source",
      reasoning: "Recorded reasoning summary",
      action: { command: "test-program" },
    });
  });
});

describe("Claude tool normalization", () => {
  it("preserves MCP display names and gives unknown tools a safe fallback", () => {
    expect(describeTool("mcp__claude_ai_linear__get_issue", { id: "ENG-1" }).action).toMatchObject({
      kind: "other",
      verb: "linear",
      icon: "mcp",
      detail: "get issue  ENG-1",
    });
    expect(describeTool("new_tool", {}).action).toEqual({
      kind: "other",
      verb: "new_tool",
      icon: "other",
    });
    expect(describeTool("constructor", {}).action).toEqual({
      kind: "other",
      verb: "constructor",
      icon: "other",
    });
  });

  it("normalizes commands, replacements, writes and MultiEdit line counts inside the adapter", () => {
    expect(describeTool("Bash", { command: "npm test" }).action.command).toBe("npm test");
    expect(
      describeTool("Edit", { file_path: "a.ts", old_string: "x", new_string: "y\nz" }).action,
    ).toMatchObject({
      replacement: { before: "x", after: "y\nz" },
      files: [{ path: "a.ts", operation: "change", added: 2, removed: 1 }],
    });
    expect(
      describeTool("Write", { file_path: "a.ts", content: "a\nb" }).action.files?.[0].added,
    ).toBe(2);
    expect(
      describeTool("MultiEdit", {
        file_path: "a.ts",
        edits: [
          { old_string: "a", new_string: "b\nc" },
          { old_string: "d", new_string: "" },
        ],
      }).action.files,
    ).toEqual([{ path: "a.ts", operation: "change", added: 2, removed: 2 }]);
  });
});
