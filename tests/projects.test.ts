import { claudeReader } from "../src/sources/claude/reader.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listSessions } from "../src/core/discover.js";
import { assignSessionProjects } from "../src/core/projects.js";
import type { SearchMatch, SessionSummary } from "../src/core/types.js";
import {
  filterBySource,
  groupSessionsByProject,
  matchingSessions,
} from "../ui/features/library/session-list.js";
import { sessionNeighbors } from "../ui/features/session/session-neighbors.js";
import { makeProjectsRoot, prompt } from "./helpers.js";

function session(id: string, cwd?: string, day = 1): SessionSummary {
  return {
    id,
    source: claudeReader.source,
    title: `Session ${id}`,
    firstPrompt: "Inspect the code",
    cwd,
    updatedAt: `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`,
    sizeBytes: 100,
    subagents: 0,
  };
}

describe("previous and next chats", () => {
  it("follows newest-first project order, including grouped subfolders, without changing the library", () => {
    const project = {
      id: "/work/demo",
      name: "demo",
      path: "/work/demo",
      availability: "available" as const,
    };
    const oldest = { ...session("oldest", "/work/demo", 1), project };
    const current = { ...session("current", "/work/demo/src", 2), project };
    const newest = { ...session("newest", "/work/demo", 3), project };
    const unrelated = session("other-demo", "/personal/demo", 4);
    const sessions = [oldest, unrelated, current, newest];

    expect(sessionNeighbors(sessions, "current")).toEqual({
      previous: newest,
      next: oldest,
      position: 2,
      total: 3,
    });
    expect(sessions.map((item) => item.id)).toEqual(["oldest", "other-demo", "current", "newest"]);
    expect(sessionNeighbors(sessions, "newest")).toEqual({
      previous: undefined,
      next: current,
      position: 1,
      total: 3,
    });
    expect(sessionNeighbors(sessions, "oldest")).toEqual({
      previous: current,
      next: undefined,
      position: 3,
      total: 3,
    });
  });

  it("respects the chosen agent and handles a missing or single chat without wrapping", () => {
    const claude = session("claude", "/work/demo", 1);
    const codex = { ...session("codex", "/work/demo", 2), source: { id: "codex", name: "Codex" } };
    const sessions = [claude, codex];
    expect(sessionNeighbors(sessions, "claude")).toMatchObject({ previous: codex, total: 2 });
    const scoped = filterBySource(sessions, "claude");
    expect(sessionNeighbors(scoped, "claude")).toEqual({
      previous: undefined,
      next: undefined,
      position: 1,
      total: 1,
    });
    expect(sessionNeighbors(scoped, "codex")).toBeUndefined();
    expect(sessionNeighbors(sessions, "missing")).toBeUndefined();
    expect(sessionNeighbors(sessions, undefined)).toBeUndefined();
    expect(sessionNeighbors([], "claude")).toBeUndefined();
  });

  it("uses the full project beyond sidebar and library page limits", () => {
    const sessions = Array.from({ length: 45 }, (_, index) => ({
      ...session(`chat-${index}`, "/work/demo"),
      updatedAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
    }));
    expect(sessionNeighbors(sessions, "chat-1")).toMatchObject({
      previous: sessions[2],
      next: sessions[0],
      position: 44,
      total: 45,
    });
  });

  it("keeps equal timestamps in the same stable order as the sidebar", () => {
    const sessions = [
      session("one", "/work/demo"),
      session("two", "/work/demo"),
      session("three", "/work/demo"),
    ];
    expect(sessionNeighbors(sessions, "two")).toMatchObject({
      previous: sessions[0],
      next: sessions[2],
      position: 2,
      total: 3,
    });
  });
});

describe("projects inferred from recorded directories", () => {
  it("combines descendants under the highest recorded parent, regardless of input order", async () => {
    const { root } = makeProjectsRoot();
    const project = join(root, "demo");
    const source = join(project, "src");
    const component = join(source, "components");
    mkdirSync(component, { recursive: true });
    const original = [
      session("deep", component),
      session("root", project),
      session("source", source),
    ];

    const sessions = await assignSessionProjects(original);

    expect(sessions.map((item) => item.project?.id)).toEqual([project, project, project]);
    expect(sessions[0].project).toEqual({
      id: project,
      name: "demo",
      path: project,
      availability: "available",
    });
    expect(sessions[0].cwd).toBe(component);
    expect(original[0].project).toBeUndefined();
  });

  it("keeps same-named folders and path prefixes separate", async () => {
    const { root } = makeProjectsRoot();
    const work = join(root, "work", "demo");
    const personal = join(root, "personal", "demo");
    const other = join(root, "work", "demo-tools");
    for (const directory of [work, personal, other]) mkdirSync(directory, { recursive: true });

    const sessions = await assignSessionProjects([
      session("work", work),
      session("personal", personal),
      session("tools", other),
    ]);

    expect(sessions.map((item) => item.project?.id)).toEqual([work, personal, other]);
    expect(sessions.map((item) => item.project?.name)).toEqual(["demo", "demo", "demo-tools"]);
  });

  it("does not invent an unrecorded parent for sibling folders", async () => {
    const { root } = makeProjectsRoot();
    const source = join(root, "demo", "src");
    const tests = join(root, "demo", "tests");
    mkdirSync(source, { recursive: true });
    mkdirSync(tests);

    const sessions = await assignSessionProjects([
      session("source", source),
      session("tests", tests),
    ]);

    expect(sessions.map((item) => item.project?.id)).toEqual([source, tests]);
  });

  it("ignores Git markers when combining folders", async () => {
    const { root } = makeProjectsRoot();
    const project = join(root, "demo");
    const child = join(project, "child");
    const linked = join(project, "linked");
    mkdirSync(join(child, ".git"), { recursive: true });
    mkdirSync(linked);
    writeFileSync(join(linked, ".git"), "gitdir: /does/not/matter\n");

    const sessions = await assignSessionProjects([
      session("child", child),
      session("parent", project),
      session("linked", linked),
    ]);

    expect(sessions.map((item) => item.project?.id)).toEqual([project, project, project]);
  });

  it("keeps home, unknown, and filesystem-root sessions from absorbing projects", async () => {
    const { root } = makeProjectsRoot();
    const home = join(root, "home");
    const project = join(home, "demo");
    mkdirSync(project, { recursive: true });

    const sessions = await assignSessionProjects(
      [
        session("home", home),
        session("unknown"),
        session("filesystem", "/"),
        session("project", project),
      ],
      home,
    );

    expect(sessions.slice(0, 3).map((item) => item.project?.id)).toEqual([
      "no-project",
      "no-project",
      "no-project",
    ]);
    expect(sessions[3].project?.id).toBe(project);
  });

  it("normalizes trailing slashes and checks missing folders again on refresh", async () => {
    const { root } = makeProjectsRoot();
    const project = join(root, "removed");
    const input = [session("root", `${project}/`), session("child", join(project, "src"))];

    const missing = await assignSessionProjects(input);
    expect(missing.map((item) => item.project?.id)).toEqual([project, project]);
    expect(missing[0].project?.availability).toBe("missing");

    mkdirSync(project);
    const restored = await assignSessionProjects(input);
    expect(restored[0].project?.availability).toBe("available");
  });

  it("adds project metadata to discovery even when transcript summaries are cached", async () => {
    const fixture = makeProjectsRoot();
    const project = join(fixture.root, "restored-project");
    fixture.writeSession("cached", [{ ...prompt("inspect"), cwd: project }]);
    expect(
      (await listSessions([{ reader: claudeReader, roots: [fixture.root] }])).sessions[0].project
        ?.availability,
    ).toBe("missing");

    mkdirSync(project);
    expect(
      (await listSessions([{ reader: claudeReader, roots: [fixture.root] }])).sessions[0].project
        ?.availability,
    ).toBe("available");
  });
});

describe("project navigation and shared search", () => {
  it("shows parent context only for equal names, using enough folders to distinguish them", () => {
    const groups = groupSessionsByProject([
      session("work", "/work/apps/demo"),
      session("personal", "/personal/apps/demo"),
      session("unique", "/work/runlens"),
      session("short", "/apps/demo"),
    ]);
    const labels = new Map(groups.map((group) => [group.project.id, group.directoryLabel]));

    expect(labels.get("/work/apps/demo")).toBe("work/apps");
    expect(labels.get("/personal/apps/demo")).toBe("personal/apps");
    expect(labels.get("/apps/demo")).toBe("apps");
    expect(labels.get("/work/runlens")).toBeUndefined();
    expect(groups).toHaveLength(4);
  });

  it("orders all projects and their sessions by latest activity without truncating or mutating input", async () => {
    const { root } = makeProjectsRoot();
    const project = join(root, "demo");
    const other = join(root, "other");
    const input = [
      session("old", project, 1),
      session("other", other, 2),
      session("new", project, 3),
    ];
    const sessions = await assignSessionProjects(input);
    const groups = groupSessionsByProject(sessions);

    expect(groups.map((group) => group.project.id)).toEqual([project, other]);
    expect(groups[0].sessions.map((item) => item.id)).toEqual(["new", "old"]);
    expect(groups[0].updatedAt).toBe(sessions[2].updatedAt);
    expect(sessions.map((item) => item.id)).toEqual(["old", "other", "new"]);

    const largeGroup = groupSessionsByProject(
      Array.from({ length: 45 }, (_, index) => ({
        ...sessions[0],
        id: String(index),
      })),
    );
    expect(largeGroup[0].sessions).toHaveLength(45);
  });

  it("finds transcript and annotation matches across projects before grouping", async () => {
    const { root } = makeProjectsRoot();
    const work = join(root, "work", "demo");
    const personal = join(root, "personal", "demo");
    const sessions = await assignSessionProjects([
      session("work", work),
      session("personal", personal),
      session("miss", join(root, "other")),
    ]);
    const matches = new Map<string, SearchMatch>([
      ["work", { id: "work", snippet: "Refresh failure", source: "subagent" }],
    ]);
    const annotations = { personal: { notes: "Investigated the refresh failure" } };

    const found = matchingSessions(sessions, annotations, " REFRESH FAILURE ", matches);
    expect(found.map((item) => item.id)).toEqual(["work", "personal"]);
    expect(groupSessionsByProject(found).map((group) => group.project.id)).toEqual([
      work,
      personal,
    ]);
    expect(
      matchingSessions(sessions, annotations, personal, new Map()).map((item) => item.id),
    ).toEqual(["personal"]);
    expect(matchingSessions(sessions, annotations, "", new Map())).toBe(sessions);
  });
});
