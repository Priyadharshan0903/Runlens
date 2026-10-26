import { claudeReader } from "../src/sources/claude/reader.js";
import { describe, expect, it } from "vitest";
import { listSessions } from "../src/core/discover.js";
import { sessionNotFoundMessage } from "../src/core/session.js";
import { parseRecords } from "../src/sources/claude/parse.js";
import { describeTool, summarizeTool } from "../src/sources/claude/tools.js";
import { buildTurns } from "../src/core/tree.js";
import type { ToolStep } from "../src/core/types.js";
import {
  loadSession,
  call,
  jsonl,
  makeProjectsRoot,
  prompt,
  result,
  say,
  tick,
} from "./helpers.js";

const tools = (steps: { kind: string }[]) => steps.filter((s): s is ToolStep => s.kind === "tool");

describe("session folder diagnostics", () => {
  it("explains missing sessions using every configured folder and recovery guidance", () => {
    const roots = ["/home/person/.claude/projects", "/home/person/.claude-accounts/work/projects"];
    const message = sessionNotFoundMessage(roots);
    for (const root of roots) expect(message).toContain(root);
    expect(message).toContain("--dir <path>");
    expect(message).toContain("CLAUDE_CONFIG_DIR");
  });
});

describe("parseRecords", () => {
  it("preserves mixed content order and ignores unsupported or malformed blocks", () => {
    const { events } = parseRecords([
      {
        type: "user",
        toolUseResult: { agentId: "child" },
        message: {
          content: [
            null,
            { type: "text", text: "Look at this" },
            { type: "image" },
            {
              type: "tool_result",
              tool_use_id: "read",
              content: [null, { type: "text", text: "contents" }, { type: "image" }],
            },
            { type: "unknown", text: "hidden" },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "  " },
            { type: "thinking", thinking: " Check the image " },
            { type: "text", text: " Here is what I found " },
            { type: "tool_use", id: "next" },
          ],
        },
      },
    ]);
    expect(events).toMatchObject([
      { type: "tool_result", output: "contents\n[image]", agentId: "child" },
      { type: "prompt", text: "Look at this\n[image]" },
      { type: "thinking", text: "Check the image" },
      { type: "text", text: "Here is what I found" },
      { type: "tool_use", id: "next", name: "unknown" },
    ]);
    expect(events).toHaveLength(5);
  });

  it("uses the recorded working directory even when the file starts with a tool call", () => {
    const { events } = parseRecords([
      call("early-read", "Read", { file_path: "/work/demo/src/a.ts" }),
      prompt("continue"),
    ]);
    expect(events[0]).toMatchObject({ type: "tool_use", summary: "src/a.ts" });
  });

  it("keeps what the person typed and skips harness bookkeeping", () => {
    const { events } = parseRecords([
      prompt(
        "<command-name>/color</command-name>\n<command-message>color</command-message>\n<command-args>purple</command-args>",
      ),
      prompt("<local-command-stdout>Session color set to: purple</local-command-stdout>"),
      prompt("[Request interrupted by user]"),
      { ...prompt("hidden"), isMeta: true },
      prompt('look at this <pasted_content id="ab12">\nsecret log\n</pasted_content id="ab12">'),
    ]);
    expect(events.map((e) => e.type)).toEqual(["prompt", "interrupt", "prompt"]);
    expect(events[0]).toMatchObject({ text: "/color purple" });
    expect(events[2]).toMatchObject({
      text: "look at this \n┄┄ pasted ┄┄\nsecret log\n┄┄ end of paste ┄┄",
    });
  });

  it("keeps mid-turn messages but not background-agent completions", () => {
    const attachment = (p: string) => ({
      type: "attachment",
      timestamp: tick(),
      attachment: { type: "queued_command", prompt: p },
    });
    const { events } = parseRecords([
      attachment("also check the tests"),
      attachment("<task-notification>done</task-notification>"),
    ]);
    expect(events).toEqual([
      { type: "interjection", text: "also check the tests", at: expect.any(String) },
    ]);
  });

  it("reads title, cost and folder; a custom title wins over the generated one", () => {
    const { info } = parseRecords([
      prompt("hi"),
      { type: "ai-title", aiTitle: "Generated" },
      { type: "custom-title", customTitle: "Mine" },
      { type: "cost-state", totalCostUSD: 1.5, totalLinesAdded: 10, totalLinesRemoved: 2 },
    ]);
    expect(info).toMatchObject({
      title: "Mine",
      cwd: "/work/demo",
      branch: "main",
      costUSD: 1.5,
      linesAdded: 10,
      linesRemoved: 2,
    });
  });
});

describe("buildTurns", () => {
  it("attaches the agent's words to the next call and ends the turn with its final answer", () => {
    const { events } = parseRecords([
      prompt("fix the bug"),
      say("Let me read the file first."),
      call("t1", "Read", { file_path: "/work/demo/src/a.ts" }),
      result("t1", "contents", { ms: 200 }),
      call("t2", "Bash", { command: "npm test" }),
      result("t2", "1 failed", { error: true }),
      say("Fixed it."),
    ]);
    const { turns, stats } = buildTurns(events);

    expect(turns).toHaveLength(1);
    const [read, bash] = tools(turns[0].steps);
    expect(read).toMatchObject({
      why: "Let me read the file first.",
      summary: "src/a.ts",
      durationMs: 200,
      result: { status: "ok" },
    });
    expect(bash).toMatchObject({ why: undefined, result: { status: "error", output: "1 failed" } });
    expect(turns[0].final).toBe("Fixed it.");
    expect(stats).toEqual({ toolCalls: 2, errors: 1, subagents: 0 });
  });

  it("shows text before an interruption as a note, not as a final answer", () => {
    const { events } = parseRecords([
      prompt("go"),
      say("Working on it…"),
      prompt("[Request interrupted by user]"),
    ]);
    const [turn] = buildTurns(events).turns;
    expect(turn.steps).toMatchObject([
      { kind: "note", from: "agent", text: "Working on it…" },
      { kind: "note", from: "interrupt" },
    ]);
    expect(turn.final).toBeUndefined();
  });

  it("cuts very long output", () => {
    const { events } = parseRecords([
      prompt("go"),
      call("t1", "Bash", { command: "yes" }),
      result("t1", "y".repeat(30_000)),
    ]);
    const [step] = tools(buildTurns(events).turns[0].steps);
    expect(step.result).toMatchObject({ truncated: true });
    expect(step.result!.output).toHaveLength(20_000);
  });
});

describe("loadSession", () => {
  it("attaches each subagent to the call that started it", async () => {
    const p = makeProjectsRoot();
    const file = p.writeSession("s1", [
      prompt("research it"),
      say("I'll split this up."),
      call("t-meta", "Agent", {
        description: "Find callers",
        subagent_type: "Explore",
        prompt: "find them",
      }),
      result("t-meta", "launched"),
      call("t-result", "Agent", { description: "Check docs", prompt: "read docs" }),
      result("t-result", "launched", { agentId: "bbb" }),
      call("t-skill", "Skill", { skill: "code-review" }),
      result("t-skill", "started"),
      say("Done."),
    ]);
    // Linked by meta.json's toolUseId.
    p.writeSubagent(
      "s1",
      "aaa",
      [
        prompt("find them"),
        call("x1", "Grep", { pattern: "refresh" }),
        result("x1", "3 hits"),
        say("3 callers"),
      ],
      {
        "meta.json": {
          agentType: "Explore",
          description: "Find callers",
          toolUseId: "t-meta",
          requestShape: "background",
        },
      },
    );
    // No meta file: linked by the agentId in the call's result.
    p.writeSubagent("s1", "bbb", [prompt("read docs"), say("Docs say X")]);
    // Started by a skill: linked by skill name.
    p.writeSubagent("s1", "ccc", [prompt("review"), say("2 issues")], {
      "meta.json": { agentType: "general-purpose", name: "code-review" },
      "forked-skill.json": { skillName: "code-review" },
    });
    // Nothing to link it with.
    p.writeSubagent("s1", "ddd", [prompt("orphan"), say("ok")]);

    const session = await loadSession(file);
    const [explore, docs, skill] = tools(session.turns[0].steps);

    expect(explore.agent).toMatchObject({
      id: "aaa",
      type: "Explore",
      background: true,
      stats: { toolCalls: 1 },
    });
    expect(explore.agent!.turns[0].final).toBe("3 callers");
    expect(docs.agent).toMatchObject({ id: "bbb", description: "Check docs" });
    expect(skill.agent).toMatchObject({ id: "ccc", type: "general-purpose" });
    expect(session.unlinkedAgents.map((a) => a.id)).toEqual(["ddd"]);
    expect(session.stats).toEqual({ toolCalls: 4, errors: 0, subagents: 4 });
  });

  it("doesn't count a fork's replay of the call that spawned it", async () => {
    const p = makeProjectsRoot();
    const file = p.writeSession("s3", [
      prompt("audit it"),
      call("t-fork", "Agent", {
        description: "Audit methods",
        subagent_type: "fork",
        prompt: "audit",
      }),
      result("t-fork", "launched"),
    ]);
    // A fork's transcript opens with the parent's spawning call, then does its own work.
    p.writeSubagent(
      "s3",
      "fff",
      [
        { type: "fork-context-ref" },
        call("t-fork", "Agent", { description: "Audit methods" }),
        result("t-fork", "launched"),
        call("f1", "Read", { file_path: "/work/demo/app.mjs" }),
        result("f1", "code"),
        say("2 risky methods"),
      ],
      { "meta.json": { agentType: "fork", description: "Audit methods", toolUseId: "t-fork" } },
    );

    const session = await loadSession(file);
    const [spawn] = tools(session.turns[0].steps);
    expect(spawn.agent).toMatchObject({ id: "fff", stats: { toolCalls: 1 } });
    expect(tools(spawn.agent!.turns.flatMap((t) => t.steps)).map((s) => s.id)).toEqual(["f1"]);
    expect(session.unlinkedAgents).toEqual([]);
    expect(session.stats).toMatchObject({ toolCalls: 2, subagents: 1 });
  });

  it("skips a corrupt or half-written line instead of failing", async () => {
    const p = makeProjectsRoot();
    const file = p.writeSession(
      "s2",
      jsonl([prompt("hello"), say("hi")]) + '{"type":"assistant","mess',
    );
    const session = await loadSession(file);
    expect(session.turns[0]).toMatchObject({ prompt: "hello", final: "hi" });
  });
});

describe("listSessions", () => {
  it("lists sessions newest first and skips ones where nothing was asked", async () => {
    const p = makeProjectsRoot();
    p.writeSession("asked", [
      prompt("<command-name>/mcp</command-name>"),
      { type: "ai-title", aiTitle: "MCP check" },
    ]);
    p.writeSession("empty", [
      { type: "file-history-snapshot" },
      prompt("<local-command-caveat>x</local-command-caveat>"),
    ]);
    p.writeSubagent("asked", "a1", [prompt("x")]);

    const { sessions, files } = await listSessions([{ reader: claudeReader, roots: [p.root] }]);
    expect(sessions).toEqual([
      expect.objectContaining({
        id: "asked",
        title: "MCP check",
        firstPrompt: "/mcp",
        cwd: "/work/demo",
        subagents: 1,
      }),
    ]);
    expect([...files.keys()]).toEqual(["asked"]);
  });
});

describe("summarizeTool", () => {
  it("keeps multi-edit counts and previews when some replacements are incomplete", () => {
    const { action } = describeTool("MultiEdit", {
      file_path: "/work/demo/a.ts",
      edits: [
        { old_string: "old", new_string: "new\nline" },
        null,
        { old_string: "removed only" },
        { old_string: "", new_string: "added" },
      ],
    });
    expect(action.files).toEqual([
      {
        path: "/work/demo/a.ts",
        operation: "change",
        added: 3,
        removed: 2,
        preview: { kind: "diff", text: "-old\n+new\n+line\n@@\n+added" },
      },
    ]);
  });

  it("describes common tools in one line", () => {
    expect(summarizeTool("Bash", { command: "cd /work/demo && npm test\nnpm run lint" })).toBe(
      "npm test",
    );
    expect(
      summarizeTool(
        "Edit",
        { file_path: "/work/demo/a.ts", old_string: "x", new_string: "y\nz" },
        "/work/demo",
      ),
    ).toBe("a.ts (+2 −1)");
    expect(summarizeTool("Grep", { pattern: "TODO", path: "/work/demo/src" }, "/work/demo")).toBe(
      '"TODO" in src',
    );
    expect(summarizeTool("Agent", { description: "Find callers", prompt: "long…" })).toBe(
      "Find callers",
    );
    expect(summarizeTool("mcp__linear__get_issue", { id: "ENG-1" })).toBe("ENG-1");
  });
});
