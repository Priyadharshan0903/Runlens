// Local HTTP server: the session list, one session's tree, and the pre-built UI.
// Transcripts can hold code and secrets, so it only listens on 127.0.0.1, only answers
// requests addressed to that host, and only opens files that discovery listed.

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { listSessions, type Listing } from "./core/discover.js";
import { loadSession } from "./core/session.js";
import { searchSessions } from "./core/search.js";

export interface ServerOptions {
  roots: string[];
  uiDir: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export function createServer({ roots, uiDir }: ServerOptions): Server {
  let listing: Listing | undefined;

  const server = createHttpServer(async (req, res) => {
    try {
      if (!isLocalHost(req, server)) return send(res, 403, "text/plain", "Forbidden");
      if (req.method !== "GET") return send(res, 405, "text/plain", "Method not allowed");

      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;

      if (path === "/api/search") {
        // Stop scanning files when a new query replaces this request or its browser disconnects.
        const cancellation = new AbortController();
        res.once("close", () => cancellation.abort());
        listing = await listSessions(roots);
        const matches = await searchSessions(
          listing,
          url.searchParams.get("q") ?? "",
          cancellation.signal,
        );
        if (!res.destroyed) return json(res, { matches });
        return;
      }

      if (path === "/api/sessions") {
        listing = await listSessions(roots);
        return json(res, { roots, sessions: listing.sessions });
      }

      const match = path.match(/^\/api\/sessions\/([\w-]+)$/);
      if (match) {
        listing ??= await listSessions(roots);
        let file = listing.files.get(match[1]);
        if (!file) {
          listing = await listSessions(roots);
          file = listing.files.get(match[1]);
        }
        if (!file) return json(res, { error: "Session not found" }, 404);
        return json(res, await loadSession(file));
      }

      // Static UI. Unknown paths get index.html so links like /#/s/<id> keep working.
      const asset = path === "/" ? "index.html" : path.slice(1);
      if (!/^[\w.-]+$/.test(asset)) return send(res, 404, "text/plain", "Not found");
      const body = await readFile(join(uiDir, asset)).catch(() => null);
      if (!body) return send(res, 404, "text/plain", "Not found");
      return send(res, 200, CONTENT_TYPES[extname(asset)] ?? "application/octet-stream", body);
    } catch (err) {
      if (res.destroyed) return;
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
  return server;
}

/** Blocks other websites from reading transcripts through a DNS-rebound hostname. */
function isLocalHost(req: IncomingMessage, server: Server): boolean {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  const host = req.headers.host ?? "";
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function json(res: ServerResponse, value: unknown, status = 200) {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(value));
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}
