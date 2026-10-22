import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { listSessions } from "../src/core/discover.js";
import { HistoryService } from "../src/mcp/history.js";
import { MAX_RESPONSE_BYTES } from "../src/mcp/safety.js";
import { createMcpServer } from "../src/mcp/server.js";
import { mcpFixture } from "./mcp-fixtures.js";

const temporary = mkdtempSync(join(tmpdir(), "runlens-mcp-protocol-"));
const cli = join(temporary, "cli.mjs");
const fixture = mcpFixture();
beforeAll(async () => {
  await build({
    entryPoints: ["src/cli.ts"],
    outfile: cli,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    define: { __VERSION__: '"test-mcp"' },
    logLevel: "silent",
  });
});
afterAll(() => {
  rmSync(temporary, { recursive: true, force: true });
  rmSync(fixture.root, { recursive: true, force: true });
});

function parsed(result: { content?: unknown }) {
  const content = result.content as { type: string; text?: string }[];
  return JSON.parse(content.find((item) => item.type === "text")!.text!);
}

async function connectedClient(extra: string[] = []) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      cli,
      "mcp",
      "--project",
      "/work/demo",
      "--dir",
      fixture.root,
      "--codex-dir",
      fixture.codex,
      ...extra,
    ],
    cwd: resolve("."),
    stderr: "pipe",
  });
  let errors = "";
  transport.stderr?.on("data", (chunk) => {
    errors += chunk.toString();
  });
  const client = new Client({ name: "runlens-integration-client", version: "1" });
  await client.connect(transport);
  return { client, errors: () => errors };
}

describe("Runlens MCP stdio", () => {
  it("connects a real SDK client to the bundled CLI and retrieves a prior Claude outcome from mixed history", async () => {
    const original = readFileSync(fixture.claude, "utf8");
    const { client, errors } = await connectedClient();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(["search_sessions", "session_summary"]);
      expect(
        tools.every(
          (tool) => tool.annotations?.readOnlyHint && tool.annotations?.destructiveHint === false,
        ),
      ).toBe(true);
      const search = await client.callTool({
        name: "search_sessions",
        arguments: { query: "recurring search timeout" },
      });
      const data = parsed(search);
      expect(data.results.map((item: { agent: string }) => item.agent).sort()).toEqual([
        "claude",
        "codex",
      ]);
      expect(JSON.stringify(search)).not.toContain("different-project");
      expect(Buffer.byteLength(JSON.stringify(search))).toBeLessThan(MAX_RESPONSE_BYTES * 3);
      const summary = await client.callTool({
        name: "session_summary",
        arguments: { id: "earlier-claude", limit: 1 },
      });
      expect(parsed(summary)).toMatchObject({
        agent: "claude",
        next_offset: 1,
        turns: [
          {
            asked: "Fix the recurring search timeout",
            recorded_answer: "Cancelled the superseded request. The focused search test passed.",
            failures: [{ tool: "Bash", status: "error" }],
          },
        ],
      });
      expect(JSON.stringify(summary)).not.toMatch(
        /WEB_FETCH_INJECTION_ONLY|RAW_ERROR_OUTPUT_ONLY|synthetic-private-value/,
      );
      expect(readFileSync(fixture.claude, "utf8")).toBe(original);
      expect(errors()).toBe("");
    } finally {
      await client.close();
    }
  });

  it("validates schemas, rejects unknown tools, and returns bounded errors without out-of-scope content", async () => {
    const { client } = await connectedClient();
    try {
      const invalid = await client.callTool({
        name: "search_sessions",
        arguments: { query: "timeout", limit: 100 },
      });
      expect(invalid.isError).toBe(true);
      const missing = await client.callTool({
        name: "session_summary",
        arguments: { id: "different-project" },
      });
      expect(missing.isError).toBe(true);
      expect(parsed(missing).error).toBe("session_not_found");
      const scope = await client.callTool({
        name: "search_sessions",
        arguments: { query: "timeout", project: "/personal/demo" },
      });
      expect(parsed(scope).error).toBe("project_not_allowed");
      await expect(
        client.callTool({
          name: "delete_session",
          arguments: { id: "earlier-claude" },
        }),
      ).rejects.toThrow("not found");
      expect(JSON.stringify([invalid, missing, scope])).not.toContain("OTHER_PROJECT_PRIVATE_ONLY");
    } finally {
      await client.close();
    }
  });

  it("permits an explicitly granted second project", async () => {
    const { client } = await connectedClient(["--allow-project", "/personal/demo"]);
    try {
      const data = parsed(
        await client.callTool({
          name: "search_sessions",
          arguments: { query: "timeout", project: "/personal/demo" },
        }),
      );
      expect(data.results.map((item: { session_id: string }) => item.session_id)).toEqual([
        "different-project",
      ]);
    } finally {
      await client.close();
    }
  });

  it("propagates protocol cancellation and refuses overlapping scans", async () => {
    const history = new HistoryService((signal) => listSessions(fixture.sources, signal), {
      project: "/work/demo",
    });
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    let cancelled!: () => void;
    const stopped = new Promise<void>((resolve) => {
      cancelled = resolve;
    });
    vi.spyOn(history, "search").mockImplementation(async (_query, _request, signal) => {
      began();
      await new Promise<void>((_resolve, reject) => {
        signal!.addEventListener(
          "abort",
          () => {
            cancelled();
            reject(signal!.reason);
          },
          { once: true },
        );
      });
      throw new Error("unreachable");
    });
    const server = createMcpServer(history, "test");
    const client = new Client({ name: "cancellation-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const controller = new AbortController();
      const pending = client.callTool(
        { name: "search_sessions", arguments: { query: "timeout" } },
        { signal: controller.signal },
      );
      const rejected = expect(pending).rejects.toThrow();
      await started;
      const busy = await client.callTool({
        name: "session_summary",
        arguments: { id: "earlier-claude" },
      });
      expect(parsed(busy).error).toBe("busy");
      controller.abort();
      await rejected;
      await stopped;
    } finally {
      await client.close();
      await server.close();
    }
  });
});
