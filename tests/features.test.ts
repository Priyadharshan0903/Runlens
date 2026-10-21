import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listSessions } from "../src/core/discover.js";
import { parseRecords } from "../src/core/parse.js";
import { searchSessions } from "../src/core/search.js";
import { loadSession } from "../src/core/session.js";
import { buildTurns } from "../src/core/tree.js";
import { formatCost } from "../ui/shared/format.js";
import {
  allCalls,
  exportMarkdown,
  sessionFiles,
  summarizeSession,
  totalTokens,
} from "../ui/features/session/session-data.js";
import { call, makeProjectsRoot, prompt, result, say, tick } from "./helpers.js";

const usage = (id: string, output: number) => ({
  type: "assistant",
  timestamp: tick(),
  message: {
    id,
    model: "claude-test-model",
    content: [{ type: "text", text: "Recorded answer" }],
    usage: {
      input_tokens: 100,
      output_tokens: output,
      cache_read_input_tokens: 40,
      cache_creation_input_tokens: 10,
    },
  },
});

describe("recorded token usage", () => {
  it("merges repeated content blocks and streaming usage snapshots by message id", async () => {
    const p = makeProjectsRoot();
    const file = p.writeSession("usage", [
      prompt("inspect"),
      usage("m1", 5),
      usage("m1", 20),
      usage("m2", 8),
    ]);
    const session = await loadSession(file);
    expect(session.usage).toEqual({ input: 200, output: 28, cacheRead: 80, cacheWrite: 20 });
    expect(totalTokens(session.usage)).toBe(328);
    expect(session.models).toEqual([
      { model: "claude-test-model", messages: 2, usage: session.usage },
    ]);
  });

  it("does not double-count the parent messages replayed in a fork", async () => {
    const p = makeProjectsRoot();
    const parent = usage("shared-parent-message", 20);
    const file = p.writeSession("fork-usage", [
      prompt("review"),
      parent,
      call("spawn", "Agent", { prompt: "review it" }),
      result("spawn", "launched", { agentId: "a" }),
    ]);
    p.writeSubagent("fork-usage", "a", [prompt("review it"), parent, usage("child-message", 15)]);
    const session = await loadSession(file);
    expect(session.usage).toEqual({ input: 200, output: 35, cacheRead: 80, cacheWrite: 20 });
    expect(session.models?.[0].messages).toBe(2);
  });

  it("keeps missing usage distinct from real zero usage", async () => {
    const p = makeProjectsRoot();
    const session = await loadSession(p.writeSession("no-usage", [prompt("hello"), say("hi")]));
    expect(session.usage).toBeUndefined();
    expect(totalTokens(session.usage)).toBeUndefined();
    expect(formatCost(0)).toBe("$0.00");
  });
});

describe("full transcript search", () => {
  it("stops a superseded search instead of continuing to read transcripts", async () => {
    const projects = makeProjectsRoot();
    projects.writeSession("cancelled", [prompt("check logs"), say("Some evidence")]);
    const listing = await listSessions([projects.root]);
    const controller = new AbortController();
    const search = searchSessions(listing, "evidence", controller.signal);
    controller.abort();

    await expect(search).rejects.toMatchObject({ name: "AbortError" });
  });
  it("finds assistant messages and tool output beyond session titles", async () => {
    const p = makeProjectsRoot();
    p.writeSession("hit", [
      prompt("check logs"),
      call("t1", "Bash", { command: "cat log" }),
      result("t1", "a unique refresh failure appears here"),
    ]);
    p.writeSession("miss", [prompt("unrelated"), say("Nothing to report")]);
    const listing = await listSessions([p.root]);
    expect(await searchSessions(listing, "REFRESH FAILURE")).toEqual([
      { id: "hit", snippet: "a unique refresh failure appears here", source: "session" },
    ]);
  });

  it("searches subagent transcripts and invalidates changed-file results", async () => {
    const p = makeProjectsRoot();
    const file = p.writeSession("agent-search", [prompt("investigate")]);
    p.writeSubagent("agent-search", "a", [prompt("check"), say("refresh-token mismatch")]);
    const listing = await listSessions([p.root]);
    expect(await searchSessions(listing, "refresh-token")).toEqual([
      { id: "agent-search", snippet: "refresh-token mismatch", source: "subagent" },
    ]);
    expect(await searchSessions(listing, "new evidence")).toEqual([]);
    appendFileSync(file, JSON.stringify(say("New evidence has arrived")) + "\n");
    expect(await searchSessions(listing, "new evidence")).toEqual([
      { id: "agent-search", snippet: "New evidence has arrived", source: "session" },
    ]);
  });

  it("skips malformed lines, short queries, and hidden harness bookkeeping", async () => {
    const p = makeProjectsRoot();
    p.writeSession("safe-search", [
      prompt("hello"),
      { ...prompt("invisible reminder"), isMeta: true },
    ]);
    const listing = await listSessions([p.root]);
    expect(await searchSessions(listing, "invisible reminder")).toEqual([]);
    expect(await searchSessions(listing, "h")).toEqual([]);
  });
});

describe("session reconstruction and file activity", () => {
  it("preserves compaction markers in the right place without treating them as a turn", () => {
    const parsed = parseRecords([
      prompt("investigate"),
      say("Checking"),
      { type: "system", subtype: "compact_boundary", timestamp: tick() },
      say("Continuing"),
    ]);
    const { turns } = buildTurns(parsed.events);
    expect(turns).toHaveLength(1);
    expect(turns[0].steps).toMatchObject([
      { kind: "note", from: "agent", text: "Checking" },
      { kind: "note", from: "compaction" },
    ]);
    expect(turns[0].final).toBe("Continuing");
  });

  it("counts failed edits as attempts and counts replacement lines only for successful calls", async () => {
    const p = makeProjectsRoot();
    const file = p.writeSession("changes", [
      prompt("fix it"),
      call("r", "Read", { file_path: "/work/demo/a.ts" }),
      result("r", "x"),
      call("e1", "Edit", { file_path: "/work/demo/a.ts", old_string: "x", new_string: "y\nz" }),
      result("e1", "edited"),
      call("e2", "Edit", {
        file_path: "/work/demo/a.ts",
        old_string: "bad",
        new_string: "not applied",
      }),
      result("e2", "not found", { error: true }),
    ]);
    const session = await loadSession(file);
    const [activity] = sessionFiles(allCalls(session));
    expect(activity).toMatchObject({
      path: "/work/demo/a.ts",
      reads: 1,
      edits: 2,
      added: 2,
      removed: 1,
    });
    expect(allCalls(session)).toHaveLength(3);
    const overview = summarizeSession(session);
    expect(overview.mainCallCount).toBe(3);
    expect(overview.changedFiles).toHaveLength(1);
    expect(overview.failedCalls.map(({ step }) => step.id)).toEqual(["e2"]);
    expect(overview.tools).toEqual([
      { name: "Edit", calls: 2, errors: 1 },
      { name: "Read", calls: 1, errors: 0 },
    ]);
  });

  it("keeps subagent work and truncated-output markers in exported transcripts", async () => {
    const p = makeProjectsRoot();
    const file = p.writeSession("export", [
      prompt("research"),
      call("spawn", "Agent", { prompt: "find evidence" }),
      result("spawn", "started", { agentId: "a" }),
    ]);
    p.writeSubagent("export", "a", [
      prompt("find evidence"),
      call("read", "Read", { file_path: "a.ts" }),
      result("read", "Evidence"),
      say("Found it"),
    ]);
    const session = await loadSession(file);
    expect(allCalls(session).map(({ step }) => step.id)).toEqual(["spawn", "read"]);
    expect(exportMarkdown(session)).toContain("**Subagent:");
    expect(exportMarkdown(session)).toContain("Found it");
    expect(exportMarkdown(session)).toContain('"truncated": false');
  });

  it("refreshes the subagent count when the main transcript hasn't changed", async () => {
    const p = makeProjectsRoot();
    p.writeSession("discovery", [prompt("hello")]);
    expect((await listSessions([p.root])).sessions[0].subagents).toBe(0);
    p.writeSubagent("discovery", "new", [prompt("new task")]);
    expect((await listSessions([p.root])).sessions[0].subagents).toBe(1);
  });
});
