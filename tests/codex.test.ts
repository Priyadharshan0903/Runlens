import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listSessions } from "../src/core/discover.js";
import { searchSessions } from "../src/core/search.js";
import { loadSession } from "../src/core/session.js";
import { buildTurns } from "../src/core/tree.js";
import { defaultRoots } from "../src/sources/codex/discover.js";
import { CodexDecoder } from "../src/sources/codex/parse.js";
import { codexReader } from "../src/sources/codex/reader.js";
import { claudeReader } from "../src/sources/claude/reader.js";
import { describeTool } from "../src/sources/codex/tools.js";
import {
  filterBySource,
  groupSessionsByProject,
  sessionSources,
} from "../ui/features/library/session-list.js";
import { summarizeSession } from "../ui/features/session/session-data.js";
import { jsonl, prompt } from "./helpers.js";

const folders: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "runlens-codex-"));
  folders.push(root);
  return {
    root,
    write(id: string, records: unknown[], folder = "2026/10/22") {
      const directory = join(root, folder);
      mkdirSync(directory, { recursive: true });
      const file = join(directory, `rollout-2026-10-22T10-00-00-${id}.jsonl`);
      writeFileSync(file, jsonl(records));
      return file;
    },
  };
}
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const at = "2026-10-22T10:00:00.000Z";
const record = (type: string, payload: unknown, timestamp = at) => ({ type, timestamp, payload });
const meta = (id: string, parent?: string) =>
  record("session_meta", {
    id,
    cwd: "/work/demo",
    git: { branch: "feature" },
    source: parent
      ? { subagent: { thread_spawn: { parent_thread_id: parent, agent_path: "/root/reviewer" } } }
      : "cli",
  });
const message = (role: string, text: string, id?: string) =>
  record("response_item", {
    type: "message",
    role,
    id,
    content: [{ type: role === "user" ? "input_text" : "output_text", text }],
  });
const call = (id: string, name: string, input: unknown) =>
  record("response_item", {
    type: "function_call",
    call_id: id,
    name,
    arguments: JSON.stringify(input),
  });
const result = (id: string, output: unknown) =>
  record("response_item", { type: "function_call_output", call_id: id, output });

describe("Codex history", () => {
  it("discovers active, default, and archived histories, deduplicating physical directories", () => {
    const { root } = fixture();
    expect(defaultRoots({}, root)).toEqual([]);
    const custom = join(root, "custom");
    mkdirSync(join(custom, "sessions"), { recursive: true });
    mkdirSync(join(custom, "archived_sessions"));
    symlinkSync(custom, join(root, ".codex"), "junction");
    expect(defaultRoots({ CODEX_HOME: custom }, root)).toEqual([
      join(custom, "sessions"),
      join(custom, "archived_sessions"),
    ]);
  });

  it("uses metadata IDs, ignores context-only/corrupt sessions, refreshes changed files, and preserves Claude URLs", async () => {
    const history = fixture();
    const file = history.write("filename", [
      meta("shared"),
      message(
        "user",
        "<external_codex_apps_open_page>Internal page context</external_codex_apps_open_page>",
      ),
      message("user", "Inspect auth"),
    ]);
    history.write("empty", [
      meta("empty"),
      message("user", "<environment_context>context only</environment_context>"),
    ]);
    history.write("broken", ["broken"]);
    writeFileSync(
      join(history.root, "2026/10/22", "not-a-rollout.jsonl"),
      jsonl([meta("unexpected"), message("user", "skip")]),
    );
    const claude = join(history.root, "claude");
    mkdirSync(join(claude, "project"), { recursive: true });
    writeFileSync(join(claude, "project/shared.jsonl"), jsonl([prompt("Claude question")]));
    const sources = [
      { reader: claudeReader, roots: [claude] },
      { reader: codexReader, roots: [history.root, history.root] },
    ];
    const listing = await listSessions(sources);
    expect(listing.sessions.map((session) => session.id).sort()).toEqual([
      "codex--shared",
      "shared",
    ]);
    expect(listing.sessions.find((session) => session.id === "codex--shared")).toMatchObject({
      source: codexReader.source,
      firstPrompt: "Inspect auth",
      cwd: "/work/demo",
    });
    writeFileSync(file, jsonl([meta("shared"), message("user", "New question")]) + "{partial");
    expect(
      (await listSessions(sources)).sessions.find((session) => session.id === "codex--shared")
        ?.title,
    ).toBe("New question");
  });

  it("reconstructs canonical messages, reasoning, calls, errors, compaction, and pending calls without mirrored duplicates", async () => {
    const history = fixture();
    const patch =
      "*** Begin Patch\n*** Update File: /work/demo/src/a.ts\n@@\n-old\n+new\n+line\n*** Add File: src/b.ts\n+hello\n*** End Patch";
    const first = message("user", "Fix authentication", "user-1");
    const file = history.write("main", [
      meta("main"),
      message("developer", "hidden instructions"),
      message(
        "user",
        "# AGENTS.md instructions for /work/demo\n<INSTRUCTIONS>rules</INSTRUCTIONS>",
      ),
      message("user", "<environment_context>hidden cwd</environment_context>"),
      first,
      first,
      record("event_msg", { type: "user_message", message: "Fix authentication" }),
      message("assistant", "I'll inspect the failing test."),
      record("response_item", {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "Check the boundary" }],
        encrypted_content: "hidden ciphertext",
      }),
      call("test", "exec_command", { cmd: "npm test" }),
      result("test", "Process exited with code 1\nOutput:\nexpired token"),
      record("response_item", {
        type: "custom_tool_call",
        call_id: "patch",
        name: "apply_patch",
        input: patch,
      }),
      record("response_item", {
        type: "custom_tool_call_output",
        call_id: "patch",
        output: "Success",
      }),
      record("compacted", { replacement_history: [first] }),
      call("pending", "future_tool", { unexpected: true }),
      message("assistant", "Authentication is fixed.", "answer"),
      record("event_msg", { type: "agent_message", message: "Authentication is fixed." }),
      record("event_msg", {
        type: "task_complete",
        last_agent_message: "Authentication is fixed.",
      }),
    ]);
    const session = { ...(await codexReader.load(file)), source: codexReader.source };
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0].prompt).toBe("Fix authentication");
    expect(session.turns[0].final).toBe("Authentication is fixed.");
    expect(session.stats).toEqual({ toolCalls: 3, errors: 1, subagents: 0 });
    const tools = session.turns[0].steps.filter((step) => step.kind === "tool");
    expect(tools[0]).toMatchObject({
      summary: "npm test",
      reasoning: "Check the boundary",
      result: { status: "error" },
    });
    expect(tools[2].result).toBeUndefined();
    expect(session.branch).toBe("feature");
    const overview = summarizeSession(session);
    expect(overview.compactionCount).toBe(1);
    expect(overview.changedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "src/a.ts", added: 2, removed: 1 }),
        expect.objectContaining({ path: "src/b.ts", added: 1, removed: 0 }),
      ]),
    );
  });

  it("counts cumulative usage once and separates cached tokens without double-counting reasoning", () => {
    const decoder = new CodexDecoder();
    decoder.decode(record("turn_context", { model: "test-model" }));
    const usage = (input: number, cached: number, output: number) =>
      record("event_msg", {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: input,
            cached_input_tokens: cached,
            output_tokens: output,
            reasoning_output_tokens: 5,
          },
        },
      });
    decoder.decode(usage(100, 20, 10));
    decoder.decode(usage(100, 20, 10));
    decoder.decode(
      record("token_usage_record", { usage: { input_tokens: 100, output_tokens: 10 } }),
    );
    decoder.decode(record("turn_context", { model: "second-model" }));
    decoder.decode(usage(150, 30, 15));
    expect(decoder.usage().usage).toEqual({ input: 120, output: 15, cacheRead: 30, cacheWrite: 0 });
    expect(decoder.usage().models.map((model) => model.usage.input)).toEqual([80, 40]);
    expect(new CodexDecoder().usage().usage).toBeUndefined();
  });

  it("shows concrete commands and edits inside exec without duplicating their orchestration wrapper", async () => {
    const history = fixture();
    const file = history.write("native", [
      meta("native"),
      message("user", "Fix the test"),
      record("response_item", {
        type: "custom_tool_call",
        call_id: "wrapper",
        name: "exec",
        input: "await tools.exec_command({cmd: 'npm test'})",
      }),
      record("event_msg", {
        type: "item_completed",
        item: {
          id: "cmd",
          type: "CommandExecution",
          command: ["/bin/zsh", "-lc", "npm test"],
          exit_code: 1,
          aggregated_output: "failure in auth",
          status: "completed",
        },
        started_at_ms: Date.parse(at),
        completed_at_ms: Date.parse(at) + 500,
      }),
      record("event_msg", {
        type: "item_completed",
        item: {
          id: "patch",
          type: "FileChange",
          changes: {
            "/work/demo/auth.ts": {
              type: "update",
              unified_diff: "--- a/auth.ts\n+++ b/auth.ts\n@@\n-before\n+after",
            },
          },
          status: "completed",
          stdout: "Patch applied",
        },
      }),
      record("response_item", {
        type: "custom_tool_call_output",
        call_id: "wrapper",
        output: [{ type: "text", text: "Script completed" }],
      }),
      message("assistant", "Updated the test"),
      record("response_item", {
        type: "custom_tool_call",
        call_id: "unfinished",
        name: "exec",
        input: "await tools.exec_command({cmd: 'npm test'})",
      }),
    ]);
    const session = { ...(await codexReader.load(file)), source: codexReader.source };
    const tools = session.turns[0].steps.filter((step) => step.kind === "tool");
    expect(tools.map((step) => step.id)).toEqual(["cmd", "patch", "unfinished"]);
    expect(tools[0]).toMatchObject({
      summary: "npm test",
      action: { command: "npm test" },
      input: { command: ["/bin/zsh", "-lc", "npm test"] },
      durationMs: 500,
      result: { status: "error", output: "failure in auth" },
    });
    expect(tools[2].result).toBeUndefined();
    expect(summarizeSession(session).changedFiles[0]).toMatchObject({
      path: "auth.ts",
      added: 1,
      removed: 1,
    });
  });

  it.each([
    {
      name: "string commands",
      input: { cmd: "git status --short" },
      expected: "git status --short",
    },
    {
      name: "cmd argument arrays",
      input: { cmd: ["/bin/zsh", "-lc", "git status --short"] },
      expected: "git status --short",
    },
    {
      name: "multiline shell scripts",
      input: { command: ["/bin/bash", "-c", 'printf "%s" "$HOME"\nnpm test'] },
      expected: 'printf "%s" "$HOME"\nnpm test',
    },
    {
      name: "direct arguments",
      input: { command: ["rg", "--glob", "*.tsx", "hello world", "ui/"] },
      expected: "rg --glob '*.tsx' 'hello world' ui/",
    },
    {
      name: "Windows shell scripts",
      input: { command: ["C:\\Windows\\System32\\cmd.exe", "/c", "dir /b"] },
      expected: "dir /b",
    },
    {
      name: "shell positional arguments",
      input: { command: ["bash", "-c", 'echo "$1"', "_", "two words"] },
      expected: "bash -c 'echo \"$1\"' _ 'two words'",
    },
    { name: "missing commands", input: {}, expected: undefined },
    { name: "malformed argument arrays", input: { cmd: ["zsh", 12] }, expected: undefined },
  ])("displays $name without losing argument boundaries", ({ input, expected }) => {
    expect(describeTool("exec_command", input).action.command).toBe(expected);
  });

  it("keeps a child's identity when a fork replays parent metadata and accepts recorded agent tasks", async () => {
    const history = fixture();
    history.write("main", [
      meta("main"),
      message("user", "Parent question"),
      call("spawn-path", "spawn_agent", { message: "Review the patch" }),
      result("spawn-path", JSON.stringify({ task_name: "/root/reviewer" })),
    ]);
    history.write("child", [
      meta("child", "main"),
      meta("main"),
      message("user", "# AGENTS.md instructions for /work/demo"),
      record("response_item", {
        type: "agent_message",
        id: "task",
        author: "/root",
        recipient: "/root/reviewer",
        content: [{ type: "input_text", text: "Review the patch" }],
      }),
      message("assistant", "Review complete"),
    ]);
    const listing = await listSessions([{ reader: codexReader, roots: [history.root] }]);
    expect(listing.sessions).toHaveLength(1);
    expect(listing.sessions[0].subagents).toBe(1);
    const session = await loadSession(listing.files.get("codex--main")!);
    const spawn = session.turns[0].steps.find((step) => step.kind === "tool");
    const child = spawn?.kind === "tool" ? spawn.agent : undefined;
    expect(child).toMatchObject({ id: "child", description: "Review the patch" });
    expect(child?.turns[0]).toMatchObject({ prompt: "Review the patch", final: "Review complete" });
    expect(session.usageScope).toBe("main");
  });

  it("loads linked descendants and searches child history without replaying parent tools", async () => {
    const history = fixture();
    const shared = [
      message("user", "Review the change", "u"),
      call("spawn", "spawn_agent", { message: "Review" }),
      result("spawn", JSON.stringify({ agent_id: "child" })),
    ];
    history.write("main", [meta("main"), ...shared, message("assistant", "Done")]);
    history.write("child", [
      meta("child", "main"),
      ...shared,
      message("user", "Check the edge cases"),
      call("child-call", "exec_command", { cmd: "child-only-evidence" }),
      result("child-call", "Process exited with code 0"),
    ]);
    const listing = await listSessions([{ reader: codexReader, roots: [history.root] }]);
    expect(listing.sessions).toHaveLength(1);
    expect(listing.sessions[0].subagents).toBe(1);
    const session = await loadSession(listing.files.get("codex--main")!);
    expect(session.stats).toEqual({ toolCalls: 2, errors: 0, subagents: 1 });
    const spawn = session.turns[0].steps.find((step) => step.kind === "tool");
    expect(spawn?.kind === "tool" && spawn.agent?.turns[0].prompt).toBe("Check the edge cases");
    expect(await searchSessions(listing, "child-only-evidence")).toEqual([
      expect.objectContaining({ id: "codex--main", source: "subagent" }),
    ]);
    const cancellation = new AbortController();
    cancellation.abort();
    await expect(
      codexReader
        .readEvents(listing.files.get("codex--main")!.file, cancellation.signal)
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toThrow();
  });

  it("keeps arbitrary tools readable, interprets structured errors, and never infers edits from shell text", () => {
    expect(
      describeTool("functions.exec_command", { cmd: "echo > a.ts" }).action.files,
    ).toBeUndefined();
    expect(describeTool("new_tool", { anything: 1 }).action).toMatchObject({
      kind: "other",
      verb: "new_tool",
    });
    const decoder = new CodexDecoder();
    const events = [
      call("a", "shell", { command: ["sh", "-c", "exit 2"] }),
      result("a", JSON.stringify({ output: "failed", metadata: { exit_code: 2 } })),
    ].flatMap((row) => decoder.decode(row));
    expect(buildTurns(events).stats.errors).toBe(1);
  });

  it("filters mixed-agent project groups without merging different agent IDs or hiding empty registered agents", async () => {
    const history = fixture();
    history.write("main", [meta("main"), message("user", "Question")]);
    const listing = await listSessions([{ reader: codexReader, roots: [history.root] }]);
    const codex = listing.sessions[0];
    const claude = { ...codex, id: "main", source: claudeReader.source };
    const sessions = [claude, codex];
    expect(filterBySource(sessions, "")).toBe(sessions);
    expect(filterBySource(sessions, "codex")).toEqual([codex]);
    expect(filterBySource(sessions, "missing")).toEqual([]);
    expect(groupSessionsByProject(sessions)[0].sessions).toHaveLength(2);
    expect(sessionSources([], [claudeReader.source, codexReader.source])).toHaveLength(2);
  });
});
