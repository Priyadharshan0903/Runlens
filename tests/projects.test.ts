import { claudeReader } from "../src/sources/claude/reader.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listSessions } from "../src/core/discover.js";
import { assignSessionProjects } from "../src/core/projects.js";
import type { SearchMatch, SessionSummary } from "../src/core/types.js";
import { groupSessionsByProject, matchingSessions } from "../ui/features/library/session-list.js";
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
