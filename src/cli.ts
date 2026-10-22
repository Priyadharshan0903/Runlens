// `npx runlens`: find sessions, start the local viewer, open the browser.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { listSessions } from "./core/discover.js";
import { sourceReaders } from "./sources/index.js";
import { createServer } from "./server.js";
import { HistoryService } from "./mcp/history.js";

declare const __VERSION__: string;

const HELP = `runlens: inspect your local agent sessions

Usage
  npx runlens [options]
  runlens mcp [--project <path>] [--allow-project <path>] [history options]

Options
  --dir <path>   Override Claude Code "projects" folders (repeatable).
                 Default: $CLAUDE_CONFIG_DIR/projects, ~/.claude/projects,
                 and existing ~/.claude-accounts/*/projects folders
  --codex-dir <path>  Override Codex rollout folders (repeatable).
                 Default: sessions and archived_sessions under $CODEX_HOME and ~/.codex
  --port <n>     Port to listen on (default 8740; the next free one is used if taken)
  --no-open      Don't open the browser
  --project <path>  MCP only: current project (default: working directory)
  --allow-project <path>  MCP only: allow an additional project (repeatable)
  -v, --version  Print the version
  -h, --help     Show this help

The viewer keeps history local. MCP returns selected excerpts to its client, which may send
them to a model provider. Session files are read, never changed. See docs/mcp.md for limits.`;

async function main() {
  const args = process.argv.slice(2);
  const mcp = args[0] === "mcp";
  const { values } = parseArgs({
    args: mcp ? args.slice(1) : args,
    options: {
      dir: { type: "string", multiple: true },
      "codex-dir": { type: "string", multiple: true },
      port: { type: "string", default: "8740" },
      "no-open": { type: "boolean", default: false },
      project: { type: "string" },
      "allow-project": { type: "string", multiple: true },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) return console.log(HELP);
  if (values.version) return console.log(__VERSION__);
  if (!mcp && (values.project || values["allow-project"]))
    fail("--project and --allow-project are only available with runlens mcp.");

  const overrides: Record<string, string[] | undefined> = {
    claude: values.dir,
    codex: values["codex-dir"],
  };
  const sources = sourceReaders.map((reader) => {
    const override = overrides[reader.source.id];
    return {
      reader,
      roots: override?.length ? override.map((dir) => resolve(dir)) : reader.defaultRoots(),
    };
  });
  const roots = sources.flatMap((source) => source.roots);
  const missing = roots.filter((r) => !existsSync(r));
  if (missing.length) fail(`Folder not found: ${missing.join(", ")}`);
  if (mcp) {
    const { serveHistory } = await import("./mcp/server.js");
    const history = new HistoryService((signal) => listSessions(sources, signal), {
      project: resolve(values.project ?? process.cwd()),
      allowProjects: values["allow-project"]?.map((path) => resolve(path)),
    });
    await serveHistory(history, __VERSION__);
    return;
  }
  if (!roots.length)
    fail(
      "No session folders found. Use --dir <Claude projects folder> or --codex-dir <Codex sessions folder>.",
    );

  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`Invalid port: ${values.port}`);

  const { sessions } = await listSessions(sources);
  const uiDir = join(dirname(fileURLToPath(import.meta.url)), "ui");
  const server = createServer({ sources, uiDir });
  const actualPort = await listen(server, port);
  const url = `http://127.0.0.1:${actualPort}/`;

  console.log(
    `✔ Found ${sessions.length} sessions in ${roots.length} folder${roots.length === 1 ? "" : "s"}`,
  );
  for (const { reader, roots: sourceRoots } of sources) {
    for (const root of sourceRoots) console.log(`  ${reader.source.name}: ${root}`);
  }
  console.log(`✔ Viewer running at ${url}`);
  console.log("  Press Ctrl+C to stop.");
  if (!values["no-open"]) openBrowser(url);
}

/** Tries the requested port, then the next 10. */
function listen(
  server: ReturnType<typeof createServer>,
  port: number,
  attempt = 0,
): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && attempt < 10)
        resolvePort(listen(server, port + 1, attempt + 1));
      else reject(err);
    });
    server.listen(port, "127.0.0.1", () => resolvePort(port));
  });
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();
}

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
