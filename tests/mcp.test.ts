import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listSessions } from "../src/core/discover.js";
import { HistoryService } from "../src/mcp/history.js";
import type { TurnField } from "../src/mcp/projection.js";
import { ScanLimiter } from "../src/mcp/limiter.js";
import {
  CURSOR_IDLE_MS,
  CURSOR_MAX_AGE_MS,
  CURSOR_REPLAY_MS,
  HistoryPagination,
  MAX_LIVE_CURSORS,
} from "../src/mcp/pagination.js";
import { ScanBudget, type ScanRecord } from "../src/mcp/scan.js";
import {
  canonicalPath,
  excerpt,
  historyFailure,
  historyResponse,
  maskSecrets,
  MAX_RESPONSE_BYTES,
  MAX_RECORD_BYTES,
  MAX_SCAN_BYTES,
  MAX_SCAN_EVENTS,
  MAX_TRANSCRIPT_BYTES,
  requestedScope,
  scopeListing,
} from "../src/mcp/safety.js";
import { claudeReader } from "../src/sources/claude/reader.js";
import { codexReader } from "../src/sources/codex/reader.js";
import { scanRecords } from "../src/sources/jsonl.js";
import { prompt, say, call, result, tick, jsonl } from "./helpers.js";
import { mcpFixture } from "./mcp-fixtures.js";

const folders: string[] = [];
const services: HistoryService[] = [];
function track(service: HistoryService) {
  services.push(service);
  return service;
}
function fixture() {
  const history = mcpFixture();
  folders.push(history.root);
  const list = (signal?: AbortSignal) => listSessions(history.sources, signal);
  return { ...history, list, service: track(new HistoryService(list, { project: "/work/demo" })) };
}
afterEach(() => {
  services.splice(0).forEach((service) => service.close());
  folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }));
  vi.useRealTimers();
});

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
    // Granting an unrecorded parent does not merge the separate projects below it.
    expect(scopeListing(listing, "/work").listing.sessions).toEqual([]);
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

  it("matches grants and recorded folders by on-disk identity, not spelling", async () => {
    const real = mkdtempSync(join(tmpdir(), "runlens-Identity-"));
    const link = `${real}-link`;
    symlinkSync(real, link);
    folders.push(link, real);
    const canonical = realpathSync.native(real);
    expect(requestedScope({ project: link })).toBe(canonical);
    expect(canonicalPath(join(link, "gone", "deeper"))).toBe(join(canonical, "gone", "deeper"));
    // Case-insensitive volumes (macOS, Windows) accept a differently cased grant.
    const project = existsSync(real.toUpperCase()) ? real.toUpperCase() : link;
    const { list, writeSession } = fixture();
    writeSession("recorded-real", [
      { ...prompt("Identity check from the real folder"), cwd: join(real, "src") },
      say("ok"),
    ]);
    writeSession("recorded-link", [
      { ...prompt("Identity check through the link"), cwd: link },
      say("ok"),
    ]);
    const service = track(new HistoryService(list, { project }));
    const found = await service.search("identity check", { limit: 5 });
    expect(found.project).toBe(canonical);
    expect(
      (found.results as { session_id: string }[]).map((item) => item.session_id).sort(),
    ).toEqual(["recorded-link", "recorded-real"]);
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
    await expect(service.summary("ancestor", { detail: "full" })).rejects.toMatchObject({
      code: "session_not_found",
    });
  });

  it("does not open out-of-scope transcripts or reveal whether their IDs exist", async () => {
    const { list } = fixture();
    const listing = await list();
    const forbidden = listing.files.get("different-project")!;
    const read = vi.fn(claudeReader.readEvents);
    forbidden.reader = { ...claudeReader, scanEvents: undefined, readEvents: read };
    const service = new HistoryService(async () => listing, { project: "/work/demo" });
    await service.search("timeout");
    await expect(service.summary("different-project", { detail: "full" })).rejects.toMatchObject({
      code: "session_not_found",
    });
    await expect(service.summary("missing", { detail: "full" })).rejects.toMatchObject({
      code: "session_not_found",
    });
    await expect(service.summary("../../private", { detail: "full" })).rejects.toMatchObject({
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
      for (const include_turns of [false, true])
        expect(JSON.stringify(await service.search(query, { include_turns }))).not.toContain(
          '"session_id"',
        );
      expect((await service.summary("earlier-claude", { detail: "full", query })).turns).toEqual(
        [],
      );
    }
    const summary = JSON.stringify(await service.summary("earlier-claude", { detail: "full" }));
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
      JSON.stringify(await service.summary("earlier-claude", { detail: "full", limit: 1 })),
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
        await service.summary("earlier-claude", {
          detail: "full",
          offset: summary.next_offset,
          limit: 1,
        }),
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
      JSON.stringify(await service.summary("codex--later-codex", { detail: "full", limit: 5 })),
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
      JSON.stringify(await service.summary("earlier-claude", { detail: "full", limit: 5 })),
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
    expect(JSON.stringify(await service.summary("long", { detail: "full" }))).not.toContain(secret);
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

  it("caps UTF-8 response bytes", () => {
    expect(() => historyResponse({ raw: "界".repeat(MAX_RESPONSE_BYTES) })).toThrow("byte limit");
  });

  it("keeps a transcript cap for adapters without byte checkpoints", async () => {
    const { claude, list } = fixture();
    const listing = await list();
    truncateSync(claude, MAX_TRANSCRIPT_BYTES + 1);
    const read = vi.fn(claudeReader.readEvents);
    listing.files.get("earlier-claude")!.reader = {
      ...claudeReader,
      scanEvents: undefined,
      readEvents: read,
    };
    const service = new HistoryService(async () => listing, { project: "/work/demo" });
    expect(await service.summary("earlier-claude", { detail: "full" })).toMatchObject({
      turns: [],
      partial: true,
      next_cursor: null,
      skipped: [
        {
          session_id: "earlier-claude",
          reason: "transcript_size",
          bytes: MAX_TRANSCRIPT_BYTES + 1,
        },
      ],
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps valid matches on both sides of an oversized transcript and stops at a full page", async () => {
    const { list, writeSession } = fixture();
    const oversized = writeSession("oversized", [prompt("timeout hidden by size")]);
    const listing = await list();
    listing.sessions = ["earlier-claude", "oversized", "codex--later-codex"].map(
      (id) => listing.sessions.find((session) => session.id === id)!,
    );
    truncateSync(oversized, MAX_TRANSCRIPT_BYTES + 1);
    const read = vi.fn(claudeReader.readEvents);
    listing.files.get("oversized")!.reader = {
      ...claudeReader,
      scanEvents: undefined,
      readEvents: read,
    };
    const discover = vi.fn(async () => listing);
    const service = track(new HistoryService(discover, { project: "/work/demo" }));
    const first = await service.search("timeout", { limit: 1 });
    expect(first).toMatchObject({
      results: [{ session_id: "earlier-claude" }],
      stop_reason: "page_full",
      skipped: [],
      scan_progress: { transcripts_read: 1 },
    });
    const second = await service.search("timeout", { cursor: first.next_cursor!, limit: 1 });
    expect(second).toMatchObject({
      results: [{ session_id: "codex--later-codex" }],
      next_cursor: null,
      partial: true,
      skipped: [{ session_id: "oversized", reason: "transcript_size" }],
      scan_progress: { sessions_completed: 3, skipped_transcripts: 1 },
    });
    expect(read).not.toHaveBeenCalled();
    expect(discover).toHaveBeenCalledTimes(1);
    expect(await service.search("timeout", { cursor: first.next_cursor!, limit: 1 })).toEqual(
      second,
    );
  });

  it("retains collected results when the total-byte budget is exhausted and resumes at the unopened file", async () => {
    const { list, writeSession } = fixture();
    const paths = Array.from({ length: 5 }, (_, i) =>
      writeSession(`budget-${i}`, [prompt("budget search")]),
    );
    const listing = await list();
    listing.sessions = paths.map(
      (_, i) => listing.sessions.find((session) => session.id === `budget-${i}`)!,
    );
    const read = vi.fn(async function* (file: string) {
      if (file === paths[0] || file === paths[4])
        yield { type: "prompt" as const, text: "byte-budget-match", at: tick() };
    });
    for (const [index, file] of paths.entries()) {
      truncateSync(file, MAX_TRANSCRIPT_BYTES);
      listing.files.get(`budget-${index}`)!.reader = {
        ...claudeReader,
        scanEvents: undefined,
        readEvents: read,
      };
    }
    const service = track(new HistoryService(async () => listing, { project: "/work/demo" }));
    const first = await service.search("byte-budget-match", { limit: 5 });
    expect(first).toMatchObject({
      results: [{ session_id: "budget-0" }],
      partial: true,
      stop_reason: "total_bytes",
      scan_progress: { bytes_reserved: MAX_SCAN_BYTES, sessions_completed: 4 },
    });
    expect(read).toHaveBeenCalledTimes(4);
    const second = await service.search("byte-budget-match", {
      cursor: first.next_cursor!,
      limit: 5,
    });
    expect(second).toMatchObject({
      results: [{ session_id: "budget-4" }],
      next_cursor: null,
      partial: false,
      scan_progress: {
        bytes_reserved: MAX_SCAN_BYTES + MAX_TRANSCRIPT_BYTES,
        sessions_completed: 5,
      },
    });
    expect(read.mock.calls.map(([file]) => file)).toEqual(paths);
  });

  it("returns child summary turns when the oversized main transcript was skipped", async () => {
    const { claude, list, writeSubagent } = fixture();
    writeSubagent("earlier-claude", "helper", [prompt("Child question"), say("Child answer")]);
    const listing = await list();
    truncateSync(claude, MAX_TRANSCRIPT_BYTES + 1);
    listing.files.get("earlier-claude")!.reader = { ...claudeReader, scanEvents: undefined };
    const service = track(new HistoryService(async () => listing, { project: "/work/demo" }));
    expect(await service.summary("earlier-claude", { detail: "full" })).toMatchObject({
      turns: [{ origin: "subagent", asked: "Child question", recorded_answer: "Child answer" }],
      next_cursor: null,
      partial: true,
      skipped: [{ origin: "session", reason: "transcript_size" }],
    });
  });

  it("skips inherited child evidence when its oversized parent cannot be compared", async () => {
    const { claude, list, writeSession } = fixture();
    const child = writeSession("fork", [prompt("Inherited question")]);
    const listing = await list();
    truncateSync(claude, MAX_TRANSCRIPT_BYTES + 1);
    const read = vi.fn(claudeReader.readEvents);
    listing.files.get("earlier-claude")!.reader = {
      ...claudeReader,
      scanEvents: undefined,
      async *searchFiles() {
        yield { file: claude, source: "session" };
        yield { file: child, source: "subagent", inheritedFile: claude };
      },
      readEvents: read,
    };
    const service = track(new HistoryService(async () => listing, { project: "/work/demo" }));
    expect(await service.summary("earlier-claude", { detail: "full" })).toMatchObject({
      turns: [],
      partial: true,
      next_cursor: null,
      skipped: [{ reason: "transcript_size" }, { reason: "inherited_transcript_unavailable" }],
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("resumes inside a transcript after an event limit without losing earlier matches or rereading events", async () => {
    const { list } = fixture();
    const listing = await list();
    listing.sessions = ["earlier-claude", "codex--later-codex"].map(
      (id) => listing.sessions.find((session) => session.id === id)!,
    );
    let readEvents = 0;
    let closed = 0;
    for (const [index, session] of listing.sessions.entries()) {
      const entry = listing.files.get(session.id)!;
      entry.reader = {
        ...entry.reader,
        scanEvents: undefined,
        async *readEvents() {
          try {
            if (index === 1)
              for (let i = 0; i < MAX_SCAN_EVENTS; i++) {
                readEvents++;
                yield { type: "text", text: "ordinary discussion", at: tick() };
              }
            readEvents++;
            yield { type: "prompt", text: "event-budget-match", at: tick() };
          } finally {
            closed++;
          }
        },
      };
    }
    const service = track(new HistoryService(async () => listing, { project: "/work/demo" }));
    const first = await service.search("event-budget-match", { limit: 5 });
    expect(first).toMatchObject({
      results: [{ session_id: "earlier-claude" }],
      partial: true,
      stop_reason: "events",
      scan_progress: { events_read: MAX_SCAN_EVENTS, sessions_completed: 1 },
    });
    expect(readEvents).toBe(MAX_SCAN_EVENTS);
    expect(closed).toBe(1);
    const second = await service.search("event-budget-match", {
      cursor: first.next_cursor!,
      limit: 5,
    });
    expect(second).toMatchObject({
      results: [{ session_id: "codex--later-codex" }],
      next_cursor: null,
      partial: false,
    });
    expect(readEvents).toBe(MAX_SCAN_EVENTS + 2);
    expect(closed).toBe(2);
  });

  it("streams summary turns early and retains an unfinished long turn across an empty budget page", async () => {
    const { list } = fixture();
    const listing = await list();
    let reads = 0;
    let closed = false;
    listing.files.get("earlier-claude")!.reader = {
      ...claudeReader,
      scanEvents: undefined,
      async *readEvents() {
        try {
          for (const text of ["First question", "Long second question", "Last question"]) {
            reads++;
            yield { type: "prompt", text, at: tick() };
            const count = text === "Long second question" ? MAX_SCAN_EVENTS + 10 : 1;
            for (let i = 0; i < count; i++) {
              reads++;
              yield { type: "text", text: `answer ${i}`, at: tick() };
            }
          }
        } finally {
          closed = true;
        }
      },
    };
    const service = track(new HistoryService(async () => listing, { project: "/work/demo" }));
    const first = await service.summary("earlier-claude", { detail: "full", limit: 1 });
    expect(first).toMatchObject({
      turns: [{ asked: "First question", recorded_answer: "answer 0" }],
    });
    expect(reads).toBe(3);
    expect(closed).toBe(false);
    const paused = await service.summary("earlier-claude", {
      detail: "full",
      cursor: first.next_cursor!,
      limit: 1,
    });
    expect(paused).toMatchObject({ turns: [], partial: true, stop_reason: "events" });
    const second = await service.summary("earlier-claude", {
      detail: "full",
      cursor: paused.next_cursor!,
      limit: 1,
    });
    expect(second).toMatchObject({ turns: [{ asked: "Long second question" }] });
    const last = await service.summary("earlier-claude", {
      detail: "full",
      cursor: second.next_cursor!,
      limit: 1,
    });
    expect(last).toMatchObject({
      turns: [{ asked: "Last question", recorded_answer: "answer 0" }],
      next_cursor: null,
      partial: false,
      scan_progress: { sessions_completed: 1 },
    });
    expect(reads).toBe(MAX_SCAN_EVENTS + 15);
    expect(closed).toBe(true);
  });

  it("binds cursors to the operation, query and granted project before discovery", async () => {
    const { list } = fixture();
    const discover = vi.fn(list);
    const service = track(
      new HistoryService(discover, { project: "/work/demo", allowProjects: ["/personal/demo"] }),
    );
    const first = await service.search("timeout", { limit: 1 });
    await expect(
      service.search("another query", { cursor: first.next_cursor! }),
    ).rejects.toMatchObject({ code: "invalid_cursor" });
    await expect(
      service.search("timeout", { cursor: first.next_cursor!, project: "/personal/demo" }),
    ).rejects.toMatchObject({ code: "invalid_cursor" });
    await expect(
      service.search("timeout", { cursor: first.next_cursor!, project: "/private/no-grant" }),
    ).rejects.toMatchObject({ code: "project_not_allowed" });
    await expect(
      service.summary("earlier-claude", { detail: "full", cursor: first.next_cursor! }),
    ).rejects.toMatchObject({ code: "invalid_cursor" });
    await expect(
      service.search("timeout", { cursor: first.next_cursor!, offset: 0 }),
    ).rejects.toMatchObject({ code: "invalid_page" });
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("keeps summary entries trimmed by the UTF-8 response cap available on the cursor", async () => {
    const { list, writeSession } = fixture();
    writeSession(
      "wide-summary",
      Array.from({ length: 5 }, (_, i) => [
        prompt(`Question ${i} ` + "界".repeat(480)),
        say(`Answer ${i} ` + "界".repeat(800)),
      ]).flat(),
    );
    const listing = await list();
    const read = vi.fn(claudeReader.readEvents);
    listing.files.get("wide-summary")!.reader = {
      ...claudeReader,
      scanEvents: undefined,
      readEvents: read,
    };
    const service = track(new HistoryService(async () => listing, { project: "/work/demo" }));
    const first = await service.summary("wide-summary", { detail: "full", limit: 5 });
    expect(first.stop_reason).toBe("response_bytes");
    const second = await service.summary("wide-summary", {
      detail: "full",
      cursor: first.next_cursor!,
      limit: 5,
    });
    expect(second.next_cursor).toBeNull();
    for (const page of [first, second])
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
    const turns = [
      ...(first.turns as { asked: string }[]),
      ...(second.turns as { asked: string }[]),
    ];
    expect(turns.map((turn) => turn.asked.slice(0, 10))).toEqual(
      Array.from({ length: 5 }, (_, i) => `Question ${i}`),
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("expires cursors and closes suspended readers", async () => {
    const { list } = fixture();
    const listing = await list();
    let closed = false;
    listing.files.get("earlier-claude")!.reader = {
      ...claudeReader,
      scanEvents: undefined,
      async *readEvents() {
        try {
          yield { type: "prompt", text: "First", at: tick() };
          yield { type: "prompt", text: "Second", at: tick() };
        } finally {
          closed = true;
        }
      },
    };
    vi.useFakeTimers();
    const service = track(new HistoryService(async () => listing, { project: "/work/demo" }));
    const first = await service.summary("earlier-claude", { detail: "full", limit: 1 });
    expect(closed).toBe(false);
    await vi.advanceTimersByTimeAsync(CURSOR_IDLE_MS - 1);
    expect(closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(closed).toBe(true);
    await expect(
      service.summary("earlier-claude", { detail: "full", cursor: first.next_cursor! }),
    ).rejects.toMatchObject({ code: "invalid_cursor" });
  });

  it("ends a frequently followed walk ten minutes after its first page", async () => {
    const { list } = fixture();
    const listing = await list();
    listing.files.get("earlier-claude")!.reader = {
      ...claudeReader,
      scanEvents: undefined,
      async *readEvents() {
        for (let i = 0; i < 20; i++) yield { type: "prompt", text: `Question ${i}`, at: tick() };
      },
    };
    vi.useFakeTimers();
    const service = track(new HistoryService(async () => listing, { project: "/work/demo" }));
    let page = await service.summary("earlier-claude", { detail: "full", limit: 1 });
    const step = CURSOR_IDLE_MS - 1;
    let elapsed = 0;
    for (; elapsed + step < CURSOR_MAX_AGE_MS; elapsed += step) {
      await vi.advanceTimersByTimeAsync(step);
      page = await service.summary("earlier-claude", {
        detail: "full",
        cursor: page.next_cursor!,
        limit: 1,
      });
    }
    await vi.advanceTimersByTimeAsync(step);
    await expect(
      service.summary("earlier-claude", { detail: "full", cursor: page.next_cursor!, limit: 1 }),
    ).rejects.toMatchObject({
      code: "invalid_cursor",
      message: expect.stringContaining("next_offset"),
    });
    // The legacy offset still resumes where the expired cursor stopped.
    const resumed = await service.summary("earlier-claude", {
      detail: "full",
      offset: page.next_offset!,
      limit: 1,
    });
    expect(resumed.turns).toMatchObject([{ asked: `Question ${page.next_offset}` }]);
  });

  it("keeps consumed cursors for a one-minute retry without using live slots", async () => {
    const { service } = fixture();
    vi.useFakeTimers();
    const first = await service.search("timeout", { limit: 1 });
    const second = await service.search("timeout", { cursor: first.next_cursor!, limit: 1 });
    const fresh = [];
    for (let i = 0; i <= MAX_LIVE_CURSORS; i++)
      fresh.push(await service.search("timeout", { limit: 1 }));
    // The oldest live cursor was evicted; the consumed one still replays.
    await expect(
      service.search("timeout", { cursor: fresh[0].next_cursor!, limit: 1 }),
    ).rejects.toMatchObject({ code: "invalid_cursor" });
    expect(await service.search("timeout", { cursor: first.next_cursor!, limit: 1 })).toEqual(
      second,
    );
    await vi.advanceTimersByTimeAsync(CURSOR_REPLAY_MS);
    await expect(
      service.search("timeout", { cursor: first.next_cursor!, limit: 1 }),
    ).rejects.toMatchObject({ code: "invalid_cursor" });
  });

  it("shares one continuation between duplicate concurrent resumes", async () => {
    const { service } = fixture();
    const first = await service.summary("earlier-claude", { detail: "full", limit: 1 });
    const request = { cursor: first.next_cursor!, limit: 1, detail: "full" as const };
    const [a, b] = await Promise.all([
      service.summary("earlier-claude", request),
      service.summary("earlier-claude", request),
    ]);
    expect(a).toBe(b);
    expect(a).toMatchObject({ turns: [{ asked: "What should we do next?" }] });
    await expect(
      service.summary("earlier-claude", { detail: "full", cursor: first.next_cursor!, limit: 2 }),
    ).rejects.toMatchObject({ code: "invalid_cursor" });
  });

  it("preserves results for tool calls that finish after a later prompt", async () => {
    const { service, writeSession } = fixture();
    writeSession("late-tool", [
      prompt("First question"),
      call("patch", "Edit", {
        file_path: "/work/demo/late.ts",
        old_string: "old",
        new_string: "new",
      }),
      prompt("Second question"),
      result("patch", "Recorded success"),
      say("Second answer"),
    ]);
    const first = await service.summary("late-tool", { detail: "full", limit: 1 });
    expect(first).toMatchObject({
      turns: [{ asked: "First question", changes: [{ path: "/work/demo/late.ts" }] }],
    });
    const second = await service.summary("late-tool", {
      detail: "full",
      cursor: first.next_cursor!,
      limit: 1,
    });
    expect(second).toMatchObject({
      turns: [{ asked: "Second question", recorded_answer: "Second answer" }],
      next_cursor: null,
    });
  });

  it("detaches completed request signals and invalidates a cursor when its continuation is cancelled", async () => {
    const { list } = fixture();
    const listing = await list();
    const initial = new AbortController();
    const continuation = new AbortController();
    let closed = false;
    listing.files.get("earlier-claude")!.reader = {
      ...claudeReader,
      scanEvents: undefined,
      async *readEvents() {
        try {
          yield { type: "prompt", text: "First question", at: tick() };
          yield { type: "prompt", text: "Second question", at: tick() };
          yield { type: "text", text: "Second answer", at: tick() };
          continuation.abort();
          yield { type: "prompt", text: "Third question", at: tick() };
        } finally {
          closed = true;
        }
      },
    };
    const service = track(new HistoryService(async () => listing, { project: "/work/demo" }));
    const first = await service.summary(
      "earlier-claude",
      { detail: "full", limit: 1 },
      initial.signal,
    );
    initial.abort();
    expect(closed).toBe(false);
    await expect(
      service.summary(
        "earlier-claude",
        { detail: "full", cursor: first.next_cursor!, limit: 1 },
        continuation.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(closed).toBe(true);
    await expect(
      service.summary("earlier-claude", { detail: "full", cursor: first.next_cursor!, limit: 1 }),
    ).rejects.toMatchObject({ code: "invalid_cursor" });
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
      scanEvents: undefined,
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
    await expect(
      service.summary("earlier-claude", { detail: "full" }, active.signal),
    ).rejects.toMatchObject({
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

describe("MCP scan admission", () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };

  it("runs at most the active limit, admits waiters in order, and rejects overflow", async () => {
    const limiter = new ScanLimiter(2, 2);
    const signal = new AbortController().signal;
    const gate = deferred();
    const order: number[] = [];
    let running = 0;
    let peak = 0;
    const task = (id: number) => async () => {
      order.push(id);
      peak = Math.max(peak, ++running);
      await gate.promise;
      running--;
      return id;
    };
    const admitted = [1, 2, 3, 4].map((id) => limiter.run(task(id), signal));
    await expect(limiter.run(task(5), signal)).rejects.toMatchObject({ code: "busy" });
    expect(order).toEqual([1, 2]);
    gate.resolve();
    expect(await Promise.all(admitted)).toEqual([1, 2, 3, 4]);
    expect(order).toEqual([1, 2, 3, 4]);
    expect(peak).toBe(2);
    // Slots are all returned once the queue drains.
    expect(await Promise.all([limiter.run(task(6), signal), limiter.run(task(7), signal)])).toEqual(
      [6, 7],
    );
  });

  it("drops cancelled waiters and reports a queue deadline as busy", async () => {
    const limiter = new ScanLimiter(1, 4);
    const gate = deferred();
    const holder = limiter.run(() => gate.promise, new AbortController().signal);
    const cancelled = new AbortController();
    const timedOut = new AbortController();
    const started = vi.fn(async () => "ran");
    const leaving = limiter.run(started, cancelled.signal);
    const late = limiter.run(started, timedOut.signal);
    const kept = limiter.run(started, new AbortController().signal);
    cancelled.abort();
    timedOut.abort(new DOMException("deadline", "TimeoutError"));
    await expect(leaving).rejects.toMatchObject({ name: "AbortError" });
    await expect(late).rejects.toMatchObject({ code: "busy" });
    gate.resolve();
    await holder;
    expect(await kept).toBe("ran");
    expect(started).toHaveBeenCalledTimes(1);
  });
});

describe("compact MCP output", () => {
  it("defaults to bounded extractive gists and exact counts, with smaller responses than full detail", async () => {
    const { service, writeSession } = fixture();
    const question = "Investigate the retry behavior. " + "Question context. ".repeat(70);
    const answer =
      "Recorded outcome: kept the cancellation check. " + "Recorded evidence. ".repeat(70);
    writeSession("compact", [
      prompt(question),
      ...Array.from({ length: 12 }, (_, i) => [
        call(`edit-${i}`, "Edit", {
          file_path: `/work/demo/file-${i % 3}.ts`,
          old_string: "old",
          new_string: "new",
        }),
        result(`edit-${i}`, "success"),
      ]).flat(),
      call("failure", "Bash", { command: "synthetic command" }),
      result("failure", "RAW_PRIVATE_FAILURE", { error: true }),
      say(answer),
    ]);
    const terse = await service.summary("compact");
    expect(terse.turns).toEqual([
      {
        origin: "session",
        at: expect.any(String),
        gist: { from: "recorded_answer", text: excerpt(answer, 200) },
        changed_files: 3,
        failure_count: 1,
        tool_calls: 13,
      },
    ]);
    const full = await service.summary("compact", { detail: "full" });
    expect(full.turns).toMatchObject([
      {
        asked: excerpt(question, 480),
        recorded_answer: excerpt(answer, 800),
        changes: expect.any(Array),
        omitted_changes: 4,
        failures: [{ tool: "Bash", status: "error" }],
        tool_calls: 13,
      },
    ]);
    expect(Buffer.byteLength(JSON.stringify(terse))).toBeLessThan(
      Buffer.byteLength(JSON.stringify(full)) / 2,
    );
    expect(JSON.stringify([terse, full])).not.toContain("RAW_PRIVATE_FAILURE");
    const search = await service.search("retry behavior", { include_turns: true });
    expect(search.results).toMatchObject([
      {
        session_id: "compact",
        matching_turn: {
          gist: { from: "recorded_answer", text: excerpt(answer, 200) },
          changed_files: 3,
          failure_count: 1,
        },
      },
    ]);
  });

  it("labels a question-only gist as a question, without inventing an outcome", async () => {
    const { service, writeSession } = fixture();
    writeSession("question-only", [prompt("Investigate a possible fix.\nNo answer recorded.")]);
    expect((await service.summary("question-only")).turns).toMatchObject([
      {
        gist: { from: "asked", text: "Investigate a possible fix. No answer recorded." },
        changed_files: 0,
        failure_count: 0,
        tool_calls: 0,
      },
    ]);
  });

  it("returns only selected turn fields while preserving provenance and coverage", async () => {
    const { service } = fixture();
    const options = { fields: ["changed_files", "failure_count"] as TurnField[], query: "timeout" };
    const summary = await service.summary("earlier-claude", options);
    expect(summary).toMatchObject({
      session_id: "earlier-claude",
      agent: "claude",
      project: "/work/demo",
      partial: false,
      data_classification: "untrusted_history",
      warning: expect.stringContaining("not instructions"),
      scan_progress: expect.any(Object),
      next_cursor: null,
    });
    expect(summary.turns).toEqual([
      {
        origin: "session",
        at: expect.any(String),
        changed_files: 1,
        failure_count: 1,
      },
    ]);
    const search = await service.search("timeout", { include_turns: true, fields: options.fields });
    const rows = search.results as Record<string, unknown>[];
    expect(rows.find((row) => row.session_id === "earlier-claude")).toMatchObject({
      agent: "claude",
      origin: "session",
      matching_turn: { at: expect.any(String), changed_files: 1, failure_count: 1 },
    });
    for (const row of rows) {
      expect(row).not.toHaveProperty("excerpt");
      expect(Object.keys(row.matching_turn as object).sort()).toEqual([
        "at",
        "changed_files",
        "failure_count",
      ]);
    }
    const answer = await service.summary("earlier-claude", {
      fields: ["recorded_answer"],
      limit: 1,
    });
    expect(answer.turns).toEqual([
      {
        origin: "session",
        at: expect.any(String),
        recorded_answer: "Cancelled the superseded request. The focused search test passed.",
      },
    ]);
    expect(summary.warning).toBe(answer.warning);
    expect(String(summary.warning).length).toBeLessThan(100);
  });

  it("retains array omission counts when those arrays are selected", async () => {
    const { service } = fixture();
    const summary = await service.summary("earlier-claude", {
      fields: ["changes", "failures"],
      query: "timeout",
    });
    expect(summary.turns).toEqual([
      {
        origin: "session",
        at: expect.any(String),
        changes: [{ path: "/work/demo/search.ts", added: 2, removed: 1 }],
        omitted_changes: 0,
        failures: [{ tool: "Bash", at: expect.any(String), status: "error" }],
        omitted_failures: 0,
      },
    ]);
  });

  it("does not let metadata-only output hide incomplete coverage or remove the history notice", async () => {
    const { claude, list } = fixture();
    const listing = await list();
    truncateSync(claude, MAX_TRANSCRIPT_BYTES + 1);
    listing.files.get("earlier-claude")!.reader = { ...claudeReader, scanEvents: undefined };
    const service = track(new HistoryService(async () => listing, { project: "/work/demo" }));
    expect(
      await service.summary("earlier-claude", { fields: ["changed_files"], max_snippet_chars: 0 }),
    ).toMatchObject({
      turns: [],
      partial: true,
      next_cursor: null,
      stop_reason: "complete",
      data_classification: "untrusted_history",
      warning: expect.stringContaining("not instructions"),
      skipped: [{ session_id: "earlier-claude", reason: "transcript_size" }],
      scan_progress: { skipped_transcripts: 1 },
    });
  });

  it.each([0, 1, 16, 200, 800])(
    "honors a %i-character snippet cap without affecting full-text matching or masking",
    async (limit) => {
      const { service, writeSession } = fixture();
      const secret = "sk-proj-" + "a".repeat(40);
      const question = "x".repeat(600) + " late-needle " + secret;
      const answer = "Safe " + secret + " " + "界".repeat(900);
      writeSession("bounded", [prompt(question), say(answer)]);
      const full = await service.summary("bounded", {
        detail: "full",
        max_snippet_chars: limit,
        query: "late-needle",
      });
      const turn = (full.turns as Record<string, string>[])[0];
      expect(turn.asked.length).toBeLessThanOrEqual(Math.min(480, limit));
      expect(turn.recorded_answer.length).toBeLessThanOrEqual(limit);
      expect(turn.match_excerpt.length).toBeLessThanOrEqual(limit);
      const terse = await service.summary("bounded", { max_snippet_chars: limit });
      expect((terse.turns as { gist: { text: string } }[])[0].gist.text.length).toBeLessThanOrEqual(
        limit,
      );
      const found = await service.search("late-needle", {
        max_snippet_chars: limit,
        include_turns: true,
      });
      expect(found.results).toHaveLength(1);
      expect((found.results as { excerpt: string }[])[0].excerpt.length).toBeLessThanOrEqual(limit);
      expect(JSON.stringify([full, terse, found])).not.toContain(secret.slice(0, 20));
      expect(
        (await service.search(secret, { include_turns: true, fields: ["gist"] })).results,
      ).toEqual([]);
    },
  );

  it("can return only the matching excerpt, even beyond the normal question/answer caps", async () => {
    const { service, writeSession } = fixture();
    writeSession("late-hit", [
      prompt("Ordinary question"),
      say("x".repeat(900) + " targeted decision at the end"),
    ]);
    const summary = await service.summary("late-hit", {
      query: "targeted decision",
      fields: ["match_excerpt"],
      max_snippet_chars: 30,
    });
    expect(summary.turns).toEqual([
      {
        origin: "session",
        at: expect.any(String),
        match_excerpt: expect.stringContaining("targeted decision"),
      },
    ]);
    const search = await service.search("targeted decision", {
      include_turns: true,
      fields: ["match_excerpt"],
      max_snippet_chars: 30,
    });
    expect(search.results).toMatchObject([
      {
        matching_turn: { match_excerpt: expect.stringContaining("targeted decision") },
      },
    ]);
  });

  it("does not split an emoji when a short character cap cuts through it", async () => {
    const { service, writeSession } = fixture();
    writeSession("emoji", [prompt("Emoji question"), say("😀 outcome")]);
    const response = await service.summary("emoji", {
      fields: ["recorded_answer"],
      max_snippet_chars: 2,
    });
    expect(response.turns).toMatchObject([{ recorded_answer: "…" }]);
  });

  it("validates projection options before discovery", async () => {
    const list = vi.fn(async () => ({ sessions: [], files: new Map() }));
    const service = track(new HistoryService(list, { project: "/work/demo" }));
    for (const request of [
      { detail: "invented" },
      { fields: [] },
      { fields: ["raw_tool_output"] },
      { fields: ["gist", "gist"] },
      { max_snippet_chars: -1 },
      { max_snippet_chars: 801 },
      { max_snippet_chars: 1.5 },
      { max_snippet_chars: NaN },
    ]) {
      await expect(service.summary("id", request as never)).rejects.toMatchObject({
        code: "invalid_projection",
      });
      await expect(
        service.search("needle", { ...request, include_turns: true } as never),
      ).rejects.toMatchObject({ code: "invalid_projection" });
    }
    await expect(service.summary("id", { fields: ["match_excerpt"] })).rejects.toMatchObject({
      code: "invalid_projection",
    });
    await expect(service.search("needle", { fields: ["gist"] })).rejects.toMatchObject({
      code: "invalid_projection",
    });
    expect(list).not.toHaveBeenCalled();
  });

  it("binds cursors to projection options, accepts reordered fields, and preserves retry responses", async () => {
    const { service } = fixture();
    const fields: TurnField[] = ["asked", "tool_calls"];
    const first = await service.summary("earlier-claude", {
      fields,
      max_snippet_chars: 40,
      limit: 1,
    });
    for (const override of [
      { detail: "full" as const },
      { fields: ["gist"] as TurnField[] },
      { max_snippet_chars: 41 },
    ])
      await expect(
        service.summary("earlier-claude", {
          fields,
          max_snippet_chars: 40,
          ...override,
          cursor: first.next_cursor!,
          limit: 1,
        }),
      ).rejects.toMatchObject({ code: "invalid_cursor" });
    const second = await service.summary("earlier-claude", {
      fields: ["tool_calls", "asked"],
      max_snippet_chars: 40,
      cursor: first.next_cursor!,
      limit: 1,
    });
    expect(second).toMatchObject({
      turns: [{ asked: "What should we do next?" }],
      next_cursor: null,
    });
    expect(
      await service.summary("earlier-claude", {
        fields,
        max_snippet_chars: 40,
        cursor: first.next_cursor!,
        limit: 1,
      }),
    ).toEqual(second);
    const search = await service.search("timeout", {
      include_turns: true,
      fields,
      max_snippet_chars: 40,
      limit: 1,
    });
    await expect(
      service.search("timeout", {
        include_turns: true,
        fields,
        max_snippet_chars: 41,
        cursor: search.next_cursor!,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: "invalid_cursor" });
    expect(
      await service.search("timeout", {
        include_turns: true,
        fields: ["tool_calls", "asked"],
        max_snippet_chars: 40,
        cursor: search.next_cursor!,
        limit: 1,
      }),
    ).toMatchObject({ next_cursor: null });
  });
});

describe("MCP page reporting", () => {
  it("preserves UTF-8 and CRLF across raw chunks, skips huge records, and reads a final record without newline", async () => {
    const { writeSession } = fixture();
    const text = "界".repeat(30_000);
    const raw =
      JSON.stringify({ text }) +
      "\r\n" +
      JSON.stringify({ hidden: "x".repeat(110_000) }) +
      "\n" +
      "damaged record\n42\n" +
      JSON.stringify({ text: "last" });
    const file = writeSession("raw-scanner", raw);
    const values = [];
    let bytes = 0;
    let skipped = 0;
    for await (const record of scanRecords(file, undefined, { maxRecordBytes: 100_000 })) {
      if (record.kind === "bytes") bytes += record.bytes;
      else if (record.kind === "skipped_record") skipped++;
      else values.push(record.value);
    }
    expect(values).toEqual([{ text }, { text: "last" }]);
    expect(skipped).toBe(1);
    expect(bytes).toBe(Buffer.byteLength(raw));
    const controller = new AbortController();
    const scanner = scanRecords(file, controller.signal, { maxRecordBytes: 100_000 })[
      Symbol.asyncIterator
    ]();
    await scanner.next();
    controller.abort();
    await expect(scanner.next()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports an excessive turn buffer and continues at the next question", async () => {
    const { service, writeSession } = fixture();
    const text = "x".repeat(1024 * 1024);
    writeSession("large-turn", [
      prompt("Too much commentary"),
      ...Array.from({ length: 9 }, () => say(text)),
      prompt("Next question"),
      say("Recoverable answer"),
    ]);
    expect(await service.summary("large-turn", { detail: "full" })).toMatchObject({
      turns: [{ asked: "Next question", recorded_answer: "Recoverable answer" }],
      partial: true,
      next_cursor: null,
      skipped: [{ reason: "turn_buffer" }],
      scan_progress: { skipped_turns: 1 },
    });
  });

  it("removes IDE opened-file boilerplate before matching and excerpting user messages", async () => {
    const { service, writeSession } = fixture();
    writeSession("ide-context", [
      prompt(
        "<ide_opened_file>" +
          "EDITOR_CONTEXT_ONLY ".repeat(60) +
          "</ide_opened_file>\nFix the retry race",
      ),
      say("Cancelled the earlier request"),
    ]);
    expect(
      await service.search("retry race", { include_turns: true, detail: "full" }),
    ).toMatchObject({
      results: [
        {
          matching_turn: {
            asked: "Fix the retry race",
            recorded_answer: "Cancelled the earlier request",
          },
        },
      ],
    });
    expect(
      (await service.search("EDITOR_CONTEXT_ONLY", { include_turns: true, detail: "full" }))
        .results,
    ).toEqual([]);
    expect((await service.summary("ide-context", { detail: "full" })).turns).toMatchObject([
      { asked: "Fix the retry race" },
    ]);
  });

  it.each([claudeReader, codexReader])(
    "resumes raw-byte scanning inside a large $source.name session and retrieves its tail without reopening",
    async (reader) => {
      const { list, writeSession, codex } = fixture();
      const id = reader === claudeReader ? "large" : "codex--large";
      const message = (role: string, text: string) =>
        reader === claudeReader
          ? role === "user"
            ? prompt(text)
            : say(text)
          : {
              type: "response_item",
              timestamp: tick(),
              payload: {
                type: "message",
                role,
                content: [{ type: role === "user" ? "input_text" : "output_text", text }],
              },
            };
      const padding = JSON.stringify({ type: "progress", padding: "x".repeat(1024 * 1024) }) + "\n";
      const records =
        jsonl([
          ...(reader === codexReader
            ? [
                {
                  type: "session_meta",
                  timestamp: tick(),
                  payload: { id: "large", cwd: "/work/demo", source: "cli" },
                },
              ]
            : []),
          message("user", "First question"),
          message("assistant", "First answer"),
          message("user", "Late question"),
        ]) +
        padding.repeat(34) +
        jsonl([message("assistant", "Tail decision")]);
      if (reader === claudeReader) writeSession("large", records);
      else writeFileSync(join(codex, "rollout-synthetic.jsonl"), records);
      const listing = await list();
      listing.sessions = listing.sessions.filter((session) => session.id === id);
      const scan = vi.fn(reader.scanEvents!);
      listing.files.get(id)!.reader = { ...reader, scanEvents: scan };
      const service = track(new HistoryService(async () => listing, { project: "/work/demo" }));
      const first = await service.summary(id, { detail: "full" });
      expect(first).toMatchObject({
        turns: [{ asked: "First question", recorded_answer: "First answer" }],
        partial: true,
        stop_reason: "total_bytes",
        scan_progress: { bytes_reserved: MAX_SCAN_BYTES, transcripts_read: 1 },
      });
      const last = await service.summary(id, { detail: "full", cursor: first.next_cursor! });
      expect(last).toMatchObject({
        turns: [{ asked: "Late question", recorded_answer: "Tail decision" }],
        next_cursor: null,
        partial: false,
        scan_progress: {
          bytes_reserved: Buffer.byteLength(records),
          transcripts_read: 1,
          skipped_records: 0,
        },
      });
      expect(scan).toHaveBeenCalledTimes(1);
      const search = await service.search("Tail decision", { include_turns: true, detail: "full" });
      expect(search).toMatchObject({ results: [], partial: true, stop_reason: "total_bytes" });
      const found = await service.search("Tail decision", {
        include_turns: true,
        detail: "full",
        cursor: search.next_cursor!,
      });
      expect(found).toMatchObject({
        results: [
          {
            session_id: id,
            matching_turn: { asked: "Late question", recorded_answer: "Tail decision" },
          },
        ],
        next_cursor: null,
        partial: false,
      });
    },
  );

  it("skips an oversized record and keeps later decisions and child transcripts readable", async () => {
    const { service, writeSession, writeSubagent } = fixture();
    writeSession("huge-record", [
      prompt("Before"),
      say("Early answer"),
      { type: "progress", padding: "x".repeat(MAX_RECORD_BYTES) },
      prompt("After"),
      say("Later decision"),
    ]);
    writeSubagent("huge-record", "helper", [prompt("Child question"), say("Child answer")]);
    expect(await service.summary("huge-record", { detail: "full" })).toMatchObject({
      turns: [
        { asked: "Before", recorded_answer: "Early answer" },
        { asked: "After", recorded_answer: "Later decision" },
        { origin: "subagent", asked: "Child question", recorded_answer: "Child answer" },
      ],
      next_cursor: null,
      partial: true,
      skipped: [{ session_id: "huge-record", reason: "record_size", bytes: expect.any(Number) }],
      scan_progress: { skipped_records: 1, skipped_transcripts: 0 },
    });
  });

  it("skips inherited child evidence when a parent record was omitted", async () => {
    const { list, writeSession } = fixture();
    const parent = writeSession("partial-parent", [
      prompt("Main question"),
      { type: "progress", padding: "x".repeat(MAX_RECORD_BYTES) },
      say("Main answer"),
    ]);
    const child = writeSession("inherited-child", [
      prompt("Main question"),
      say("Main answer"),
      prompt("Child work"),
    ]);
    const listing = await list();
    listing.files.get("partial-parent")!.reader = {
      ...claudeReader,
      async *searchFiles() {
        yield { file: parent, source: "session" };
        yield { file: child, source: "subagent", inheritedFile: parent };
      },
    };
    const service = track(new HistoryService(async () => listing, { project: "/work/demo" }));
    expect(await service.summary("partial-parent", { detail: "full" })).toMatchObject({
      turns: [{ asked: "Main question", recorded_answer: "Main answer" }],
      partial: true,
      next_cursor: null,
      skipped: [{ reason: "record_size" }, { reason: "inherited_transcript_unavailable" }],
    });
  });

  it("includes a matching turn in search without exposing raw activity or requiring a summary", async () => {
    const { service } = fixture();
    const rich = await service.search("recurring search timeout", {
      include_turns: true,
      detail: "full",
    });
    expect(rich.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          session_id: "earlier-claude",
          matching_turn: expect.objectContaining({
            asked: "Fix the recurring search timeout",
            recorded_answer: "Cancelled the superseded request. The focused search test passed.",
            failures: [{ tool: "Bash", at: expect.any(String), status: "error" }],
            changes: [{ path: "/work/demo/search.ts", added: 2, removed: 1 }],
          }),
        }),
        expect.objectContaining({
          session_id: "codex--later-codex",
          matching_turn: expect.any(Object),
        }),
      ]),
    );
    expect(JSON.stringify(rich)).not.toMatch(
      /WEB_FETCH_INJECTION_ONLY|RAW_ERROR_OUTPUT_ONLY|synthetic-private-value/,
    );
    const lean = await service.search("recurring search timeout");
    expect(lean.results).toEqual(
      expect.arrayContaining([expect.not.objectContaining({ matching_turn: expect.anything() })]),
    );
    const oldFlow = [
      lean,
      await service.summary("earlier-claude", { detail: "full" }),
      await service.summary("codex--later-codex", { detail: "full" }),
    ];
    expect(Buffer.byteLength(JSON.stringify(rich))).toBeLessThan(
      Buffer.byteLength(JSON.stringify(oldFlow)),
    );
  });

  it("filters turns using full masked messages and returns match context beyond excerpt caps", async () => {
    const { service, writeSession, writeSubagent } = fixture();
    writeSession("filtered", [
      prompt("Unrelated work"),
      say("Ordinary answer"),
      prompt("x".repeat(600) + " needle question"),
      say("Answer to question"),
      prompt("Another question"),
      say("y".repeat(900) + " needle answer"),
      prompt("Only activity"),
      call("read", "Read", { file_path: "needle" }),
      result("read", "needle"),
      say("No message match"),
    ]);
    writeSubagent("filtered", "helper", [prompt("A child needle"), say("Child answer")]);
    const page = await service.summary("filtered", { detail: "full", query: " needle " });
    expect(page).toMatchObject({
      next_cursor: null,
      partial: false,
      turns: [
        {
          recorded_answer: "Answer to question",
          match_excerpt: expect.stringContaining("needle question"),
        },
        { asked: "Another question", match_excerpt: expect.stringContaining("needle answer") },
        { origin: "subagent", asked: "A child needle", recorded_answer: "Child answer" },
      ],
    });
    const search = await service.search("needle", { include_turns: true, detail: "full" });
    expect(search.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          session_id: "filtered",
          excerpt: expect.stringContaining("needle question"),
          matching_turn: expect.objectContaining({ recorded_answer: "Answer to question" }),
        }),
      ]),
    );
    expect(
      (await service.summary("filtered", { detail: "full", query: "not present" })).turns,
    ).toEqual([]);
  });

  it("binds enriched search and filtered summary cursors to their options", async () => {
    const { service } = fixture();
    const search = await service.search("timeout", {
      limit: 1,
      include_turns: true,
      detail: "full",
    });
    await expect(service.search("timeout", { cursor: search.next_cursor! })).rejects.toMatchObject({
      code: "invalid_cursor",
    });
    const summary = await service.summary("earlier-claude", {
      detail: "full",
      query: "the",
      limit: 1,
    });
    expect(summary.next_cursor).toEqual(expect.any(String));
    await expect(
      service.summary("earlier-claude", {
        detail: "full",
        cursor: summary.next_cursor!,
        query: "other",
      }),
    ).rejects.toMatchObject({ code: "invalid_cursor" });
    await expect(
      service.summary("earlier-claude", { detail: "full", query: "x" }),
    ).rejects.toMatchObject({
      code: "invalid_query",
    });
  });

  it("defaults summaries to ten turns and accepts up to fifty within the byte cap", async () => {
    const { service, writeSession } = fixture();
    writeSession(
      "many-turns",
      Array.from({ length: 12 }, (_, i) => [
        prompt(`Question ${i}`),
        ...(i === 0
          ? Array.from({ length: 110 }, (_, j) => [
              call(`read-${j}`, "Read", { file_path: "/work/demo/file.ts" }),
              result(`read-${j}`, "raw output"),
            ]).flat()
          : []),
        say(`Answer ${i}`),
      ]).flat(),
    );
    const first = await service.summary("many-turns", { detail: "full" });
    expect(first.turns).toHaveLength(10);
    expect(first.turns).toEqual(
      expect.arrayContaining([expect.objectContaining({ tool_calls: 110 })]),
    );
    expect(first.next_offset).toBe(10);
    const last = await service.summary("many-turns", {
      detail: "full",
      cursor: first.next_cursor!,
      limit: 50,
    });
    expect(last.turns).toHaveLength(2);
    expect(last.next_cursor).toBeNull();
    await expect(
      service.summary("many-turns", { detail: "full", limit: 51 }),
    ).rejects.toMatchObject({
      code: "invalid_page",
    });
  });

  it("warns when the granted scope holds no recorded sessions", async () => {
    const { list, service } = fixture();
    expect(await service.search("timeout")).not.toHaveProperty("scope_warning");
    const empty = track(new HistoryService(list, { project: "/work/never-recorded" }));
    expect(await empty.search("timeout")).toMatchObject({
      results: [],
      next_cursor: null,
      scope_warning: expect.stringContaining("No recorded sessions"),
    });
    await expect(empty.summary("earlier-claude", { detail: "full" })).rejects.toMatchObject({
      code: "session_not_found",
      message: expect.stringContaining("No recorded sessions"),
    });
  });

  it("counts skipped transcripts beyond the per-page detail cap", async () => {
    const { list, writeSession } = fixture();
    const ids = Array.from({ length: 6 }, (_, i) => `huge-${i}`);
    for (const id of ids)
      truncateSync(writeSession(id, [prompt("timeout")]), MAX_TRANSCRIPT_BYTES + 1);
    const listing = await list();
    for (const id of ids)
      listing.files.get(id)!.reader = { ...claudeReader, scanEvents: undefined };
    const service = track(new HistoryService(async () => listing, { project: "/work/demo" }));
    let page = await service.search("timeout", { limit: 5 });
    let named = (page.skipped as unknown[]).length;
    let omitted = (page.skipped_omitted as number | undefined) ?? 0;
    while (page.next_cursor) {
      page = await service.search("timeout", { cursor: page.next_cursor, limit: 5 });
      named += (page.skipped as unknown[]).length;
      omitted += (page.skipped_omitted as number | undefined) ?? 0;
    }
    expect(omitted).toBeGreaterThan(0);
    const { skipped_transcripts } = page.scan_progress as { skipped_transcripts: number };
    expect(named + omitted).toBe(skipped_transcripts);
    expect(skipped_transcripts).toBe(ids.length);
  });

  it("explains a cursor passed together with an offset", async () => {
    const { service } = fixture();
    const first = await service.search("timeout", { limit: 1 });
    await expect(
      service.search("timeout", { cursor: first.next_cursor!, offset: 1 }),
    ).rejects.toMatchObject({ code: "invalid_page", message: expect.stringContaining("not both") });
    await expect(service.search("timeout", { limit: 9 })).rejects.toMatchObject({
      message: "Offset must be 0–100000 and limit must be 1–5.",
    });
  });

  it("omits an entry too large for any page and keeps the walk going", async () => {
    async function* records(): AsyncGenerator<ScanRecord> {
      yield { kind: "item", value: { id: "before" }, last: false };
      yield {
        kind: "item",
        value: { id: "huge", text: "x".repeat(MAX_RESPONSE_BYTES) },
        last: false,
      };
      yield { kind: "item", value: { id: "after" }, last: true };
    }
    const scan = () => ({
      key: "oversized",
      base: {},
      field: "results" as const,
      budget: new ScanBudget(),
      iterator: records(),
      offset: 0,
      remainingOffset: 0,
    });
    const pagination = new HistoryPagination();
    try {
      const first = await pagination.page(scan(), 2);
      expect(first).toMatchObject({ results: [{ id: "before" }], next_offset: 1 });
      const second = await pagination.resume(first.next_cursor!, "oversized", 2);
      expect(second).toMatchObject({
        results: [],
        omitted_oversized: 1,
        partial: true,
        next_offset: 2,
        stop_reason: "response_bytes",
      });
      const third = await pagination.resume(second.next_cursor!, "oversized", 2);
      expect(third).toMatchObject({
        results: [{ id: "after" }],
        next_cursor: null,
        stop_reason: "complete",
      });
      // An offset restart skips the omitted entry's position as well.
      const restarted = await pagination.page({ ...scan(), offset: 2, remainingOffset: 2 }, 2);
      expect(restarted).toMatchObject({ results: [{ id: "after" }], next_cursor: null });
    } finally {
      pagination.close();
    }
  });
});
