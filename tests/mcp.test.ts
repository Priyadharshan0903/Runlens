import { readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listSessions } from "../src/core/discover.js";
import { HistoryService } from "../src/mcp/history.js";
import {
  excerpt,
  historyFailure,
  historyPage,
  historyResponse,
  maskSecrets,
  MAX_RESPONSE_BYTES,
  MAX_TRANSCRIPT_BYTES,
  requestedScope,
  scopeListing,
} from "../src/mcp/safety.js";
import { claudeReader } from "../src/sources/claude/reader.js";
import { prompt, say, call, result, tick, jsonl } from "./helpers.js";
import { mcpFixture } from "./mcp-fixtures.js";

const folders: string[] = [];
function fixture() {
  const history = mcpFixture();
  folders.push(history.root);
  const list = (signal?: AbortSignal) => listSessions(history.sources, signal);
  return { ...history, list, service: new HistoryService(list, { project: "/work/demo" }) };
}
afterEach(() =>
  folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true })),
);

describe("MCP safety contract", () => {
  it("masks synthetic tokens, auth headers, dotenv values, credentials, JWTs and private keys before clipping", () => {
    const secrets = [
      "sk-proj-" + "a".repeat(40),
      "ghp_" + "b".repeat(36),
      "github_pat_" + "c".repeat(40),
      "AKIA" + "A".repeat(16),
      "ASIA" + "B".repeat(16),
      "xoxb-" + "d".repeat(25),
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.signature",
    ];
    const input = [
      ...secrets,
      "Authorization: Bearer synthetic-auth-value",
      'password="synthetic-password"',
      "api_key: synthetic-key",
      "https://user:synthetic-url-pass@example.invalid",
      "ORDINARY_ENV_NAME=synthetic-env-value",
      'export MULTILINE_VALUE="line-one\nline-two"',
      "-----BEGIN RSA PRIVATE KEY-----\nsynthetic-private-key\n-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const safe = maskSecrets(input);
    for (const secret of [
      ...secrets,
      "synthetic-auth-value",
      "synthetic-password",
      "synthetic-key",
      "synthetic-url-pass",
      "synthetic-env-value",
      "line-one",
      "line-two",
      "synthetic-private-key",
    ])
      expect(safe).not.toContain(secret);
    expect(safe).toContain("[REDACTED");
    expect(excerpt("Visible " + secrets[0], 20)).not.toContain(secrets[0].slice(0, 8));
    expect(maskSecrets("Ordinary discussion of the search timeout.")).toBe(
      "Ordinary discussion of the search timeout.",
    );
    expect(maskSecrets(JSON.stringify({ password: 'synthetic-quoted"value\\tail' }))).not.toMatch(
      /synthetic-quoted|value|tail/,
    );
    expect(
      maskSecrets(
        "-----BEGIN PGP PRIVATE KEY BLOCK-----\nsynthetic-pgp\n-----END PGP PRIVATE KEY BLOCK-----",
      ),
    ).not.toContain("synthetic-pgp");
  });

  it("requires startup grants for another project before listing or scanning anything", async () => {
    const { list } = fixture();
    const listing = vi.fn(list);
    const history = new HistoryService(listing, { project: "/work/demo" });
    await expect(history.search("timeout", { project: "/personal/demo" })).rejects.toMatchObject({
      code: "project_not_allowed",
    });
    expect(listing).not.toHaveBeenCalled();
    expect(() => requestedScope({ project: homedir() })).toThrow("not home");
    expect(() => requestedScope({ project: "/" })).toThrow("filesystem root");
    expect(() => requestedScope({ project: "relative" })).toThrow("absolute");
  });

  it("uses directory identities without Git, including subdirectories, and separates same-name projects", async () => {
    const { list, service } = fixture();
    const listing = await list();
    expect(
      scopeListing(listing, "/work/demo")
        .listing.sessions.map((session) => session.id)
        .sort(),
    ).toEqual(["codex--later-codex", "earlier-claude"]);
    expect(scopeListing(listing, "/work/demo-copy").listing.sessions).toEqual([]);
    expect(scopeListing(listing, "/work/demo/src").listing.sessions).toEqual([]);
    const result = await service.search("timeout");
    expect(JSON.stringify(result)).not.toContain("different-project");
    const granted = new HistoryService(list, {
      project: "/work/demo",
      allowProjects: ["/personal/demo"],
    });
    expect(
      JSON.stringify(await granted.search("timeout", { project: "/personal/demo" })),
    ).toContain("different-project");
  });

  it("never widens a project grant when recorded ancestors merge the viewer's project groups", async () => {
    const { list, service, writeSession } = fixture();
    writeSession("ancestor", [{ ...prompt("A workspace question"), cwd: "/work" }]);
    writeSession("sibling", [{ ...prompt("Sibling timeout"), cwd: "/work/another-project" }]);
    const listing = await list();
    expect(listing.sessions.find((session) => session.id === "earlier-claude")?.project?.path).toBe(
      "/work",
    );
    const response = JSON.stringify(await service.search("timeout"));
    expect(response).toContain("earlier-claude");
    expect(response).not.toContain("sibling");
    await expect(service.summary("ancestor")).rejects.toMatchObject({ code: "session_not_found" });
  });

  it("does not open out-of-scope transcripts or reveal whether their IDs exist", async () => {
    const { list } = fixture();
    const listing = await list();
    const forbidden = listing.files.get("different-project")!;
    const read = vi.fn(claudeReader.readEvents);
    forbidden.reader = { ...claudeReader, readEvents: read };
    const service = new HistoryService(async () => listing, { project: "/work/demo" });
    await service.search("timeout");
    await expect(service.summary("different-project")).rejects.toMatchObject({
      code: "session_not_found",
    });
    await expect(service.summary("missing")).rejects.toMatchObject({ code: "session_not_found" });
    await expect(service.summary("../../private")).rejects.toMatchObject({
      code: "invalid_session",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("excludes raw web/tool payloads, tool input, thinking, and compaction text from both search and summaries", async () => {
    const { service, writeSession } = fixture();
    writeSession("excluded", [
      prompt("A safe question"),
      {
        type: "assistant",
        timestamp: tick(),
        message: { content: [{ type: "thinking", thinking: "THINKING_PRIVATE_ONLY" }] },
      },
      call("read", "Read", { file_path: "TOOL_INPUT_PRIVATE_ONLY" }),
      result("read", "RAW_READ_PAYLOAD_ONLY"),
      say("A safe recorded response"),
    ]);
    for (const query of [
      "WEB_FETCH_INJECTION_ONLY",
      "RAW_ERROR_OUTPUT_ONLY",
      "RAW_READ_PAYLOAD_ONLY",
      "TOOL_INPUT_PRIVATE_ONLY",
      "THINKING_PRIVATE_ONLY",
    ]) {
      expect(JSON.stringify(await service.search(query))).not.toContain('"session_id"');
    }
    const summary = JSON.stringify(await service.summary("earlier-claude"));
    expect(summary).not.toMatch(
      /WEB_FETCH_INJECTION_ONLY|RAW_ERROR_OUTPUT_ONLY|synthetic-private-value/,
    );
    expect(summary).toContain("untrusted_history");
    expect(summary).toContain("not instructions");
    expect(summary).toContain('"status":"error"');
  });

  it("finds a Claude run from the same project as a Codex run and returns recorded outcome, changes, failures and provenance", async () => {
    const { service } = fixture();
    const search = JSON.parse(JSON.stringify(await service.search("recurring search timeout")));
    expect(search.results.map((item: { agent: string }) => item.agent).sort()).toEqual([
      "claude",
      "codex",
    ]);
    const summary = JSON.parse(
      JSON.stringify(await service.summary("earlier-claude", { limit: 1 })),
    );
    expect(summary).toMatchObject({
      session_id: "earlier-claude",
      agent: "claude",
      project: "/work/demo",
      next_offset: 1,
    });
    expect(summary.started_at).toMatch(/^2026-/);
    expect(summary.turns[0]).toMatchObject({
      asked: "Fix the recurring search timeout",
      recorded_answer: "Cancelled the superseded request. The focused search test passed.",
      changes: [{ path: "/work/demo/search.ts", added: 2, removed: 1 }],
      failures: [{ tool: "Bash", status: "error" }],
    });
    const next = JSON.parse(
      JSON.stringify(
        await service.summary("earlier-claude", { offset: summary.next_offset, limit: 1 }),
      ),
    );
    expect(next.turns[0].asked).toBe("What should we do next?");
    expect(next.next_offset).toBeNull();
  });

  it("includes child transcript evidence without counting a Codex fork's replay as new work", async () => {
    const { service, codex, writeSubagent } = fixture();
    const records = readFileSync(join(codex, "rollout-synthetic.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const timestamp = "2026-10-22T11:00:00.000Z";
    writeFileSync(
      join(codex, "rollout-child.jsonl"),
      jsonl([
        {
          ...records[0],
          payload: {
            ...records[0].payload,
            id: "child",
            source: { subagent: { thread_spawn: { parent_thread_id: "later-codex" } } },
          },
        },
        ...records.slice(1),
        {
          type: "response_item",
          timestamp,
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Find child-only-evidence" }],
          },
        },
        {
          type: "response_item",
          timestamp,
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "A recorded child outcome" }],
          },
        },
      ]),
    );
    const summary = JSON.parse(
      JSON.stringify(await service.summary("codex--later-codex", { limit: 5 })),
    );
    expect(summary.turns).toHaveLength(2);
    expect(summary.turns[1]).toMatchObject({
      origin: "subagent",
      asked: "Find child-only-evidence",
      recorded_answer: "A recorded child outcome",
    });
    const found = JSON.parse(JSON.stringify(await service.search("child-only-evidence")));
    expect(found.results[0]).toMatchObject({
      session_id: "codex--later-codex",
      origin: "subagent",
    });
    writeSubagent("earlier-claude", "helper", [
      prompt("Claude child evidence"),
      call("check", "Bash", { command: "not returned" }),
      result("check", "CHILD_TOOL_PAYLOAD_ONLY", { error: true }),
      say("A child recorded answer"),
    ]);
    const claude = JSON.parse(
      JSON.stringify(await service.summary("earlier-claude", { limit: 5 })),
    );
    expect(claude.turns[2]).toMatchObject({
      origin: "subagent",
      asked: "Claude child evidence",
      failures: [{ tool: "Bash", status: "error" }],
    });
    expect(JSON.stringify(claude)).not.toContain("CHILD_TOOL_PAYLOAD_ONLY");
  });

  it("searches text beyond excerpt boundaries, masks before matching, and does not expose secrets through matching", async () => {
    const { service, writeSession } = fixture();
    const secret = "sk-proj-" + "q".repeat(40);
    writeSession("long", [
      prompt("Long search"),
      say("x".repeat(6000) + " distinct-late-match " + secret),
    ]);
    expect(JSON.stringify(await service.search("distinct-late-match"))).toContain(
      "distinct-late-match",
    );
    expect(JSON.stringify(await service.search(secret))).not.toContain('"session_id"');
    expect(JSON.stringify(await service.summary("long"))).not.toContain(secret);
  });

  it("paginates search without dropping or repeating session matches", async () => {
    const { service } = fixture();
    const first = JSON.parse(JSON.stringify(await service.search("timeout", { limit: 1 })));
    const second = JSON.parse(
      JSON.stringify(await service.search("timeout", { offset: first.next_offset, limit: 1 })),
    );
    expect(first.next_offset).toBe(1);
    expect(second.next_offset).toBeNull();
    expect(new Set([first.results[0].session_id, second.results[0].session_id]).size).toBe(2);
  });

  it("rejects invalid paging/query arguments before discovery", async () => {
    const list = vi.fn(async () => ({ sessions: [], files: new Map() }));
    const service = new HistoryService(list, { project: "/work/demo" });
    for (const request of [
      { limit: 0 },
      { limit: 100 },
      { offset: -1 },
      { offset: 0.5 },
      { offset: NaN },
    ])
      await expect(service.search("timeout", request)).rejects.toMatchObject({
        code: "invalid_page",
      });
    await expect(service.search("a")).rejects.toMatchObject({ code: "invalid_query" });
    await expect(service.search("x".repeat(201))).rejects.toMatchObject({ code: "invalid_query" });
    expect(list).not.toHaveBeenCalled();
  });

  it("caps UTF-8 response bytes and preserves a continuation when entries are removed", () => {
    const items = ["界".repeat(3500), "界".repeat(3500), "界".repeat(3500)];
    const response = historyPage({ project: "/work/demo" }, "results", items, 4, false);
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
    expect(response.next_offset).toBe(5);
    expect(() => historyResponse({ raw: "界".repeat(MAX_RESPONSE_BYTES) })).toThrow("byte limit");
  });

  it("checks transcript scan limits before opening the event stream", async () => {
    const { claude, list } = fixture();
    const listing = await list();
    truncateSync(claude, MAX_TRANSCRIPT_BYTES + 1);
    const read = vi.fn(claudeReader.readEvents);
    listing.files.get("earlier-claude")!.reader = { ...claudeReader, readEvents: read };
    const service = new HistoryService(async () => listing, { project: "/work/demo" });
    await expect(service.summary("earlier-claude")).rejects.toMatchObject({ code: "scan_limit" });
    expect(read).not.toHaveBeenCalled();
  });

  it("cancels discovery and closes a running adapter iterator", async () => {
    const { sources, list } = fixture();
    const before = new AbortController();
    before.abort();
    await expect(listSessions(sources, before.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    const listing = await list();
    const active = new AbortController();
    let closed = false;
    listing.files.get("earlier-claude")!.reader = {
      ...claudeReader,
      async *readEvents(file, signal) {
        try {
          for await (const event of claudeReader.readEvents(file, signal)) {
            yield event;
            active.abort();
          }
        } finally {
          closed = true;
        }
      },
    };
    const service = new HistoryService(async () => listing, { project: "/work/demo" });
    await expect(service.summary("earlier-claude", {}, active.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(closed).toBe(true);
  });

  it("returns generic read errors without internal paths or raw exception content", () => {
    const error = historyFailure(new Error("/private/internal/history sk-proj-" + "x".repeat(40)));
    expect(error.error).toBe("history_unavailable");
    expect(JSON.stringify(error)).not.toMatch(/internal\/history|sk-proj/);
  });
});
