import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { makeProjectsRoot, prompt, say } from "./helpers.js";

const p = makeProjectsRoot();
p.writeSession("s1", [prompt("hello"), say("hi")]);
const server = createServer({ roots: [p.root], uiDir: "/nonexistent" });
let port = 0;

beforeAll(
  () =>
    new Promise<void>((done) =>
      server.listen(
        0,
        "127.0.0.1",
        () => ((port = (server.address() as AddressInfo).port), done()),
      ),
    ),
);
afterAll(() => new Promise<void>((done) => server.close(() => done())));

function get(path: string, host = `127.0.0.1:${port}`): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject).end();
  });
}

describe("server", () => {
  it("lists sessions and returns one session's tree", async () => {
    const list = await get("/api/sessions");
    expect(list.status).toBe(200);
    expect(JSON.parse(list.body).sessions).toHaveLength(1);

    const one = await get("/api/sessions/s1");
    expect(JSON.parse(one.body).turns[0]).toMatchObject({ prompt: "hello", final: "hi" });
  });

  it("refuses requests addressed to another host name", async () => {
    expect((await get("/api/sessions", `attacker.example:${port}`)).status).toBe(403);
  });

  it("only serves listed sessions and plain asset names", async () => {
    expect((await get("/api/sessions/does-not-exist")).status).toBe(404);
    expect((await get("/api/sessions/..%2Fsecret")).status).toBe(404);
    expect((await get("/%2E%2E/package.json")).status).toBe(404);
  });
});
