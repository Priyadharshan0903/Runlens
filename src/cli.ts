// `npx runlens`: find sessions, start the local viewer, open the browser.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { listSessions } from "./core/discover.js";
import { sourceReaders } from "./sources/index.js";
import { createServer } from "./server.js";

declare const __VERSION__: string;

const HELP = `runlens: inspect your local agent sessions

Usage
  npx runlens [options]

Options
  --dir <path>   A Claude Code "projects" folder to read (repeatable).
                 Default: $CLAUDE_CONFIG_DIR/projects and ~/.claude/projects
  --port <n>     Port to listen on (default 8740; the next free one is used if taken)
  --no-open      Don't open the browser
  -v, --version  Print the version
  -h, --help     Show this help

Everything stays on this machine. Session files are read, never changed or uploaded.`;

async function main() {
  const { values } = parseArgs({
    options: {
      dir: { type: "string", multiple: true },
      port: { type: "string", default: "8740" },
      "no-open": { type: "boolean", default: false },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) return console.log(HELP);
  if (values.version) return console.log(__VERSION__);

  const sources = sourceReaders.map((reader) => ({
    reader,
    roots:
      reader.source.id === "claude" && values.dir?.length
        ? values.dir.map((dir) => resolve(dir))
        : reader.defaultRoots(),
  }));
  const roots = sources.flatMap((source) => source.roots);
  const missing = roots.filter((r) => !existsSync(r));
  if (missing.length) fail(`Folder not found: ${missing.join(", ")}`);
  if (!roots.length)
    fail("No session folders found. For Claude Code, pass --dir ~/.claude/projects");

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
