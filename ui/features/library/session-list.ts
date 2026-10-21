import type { SearchMatch, SessionProject, SessionSummary } from "../../../src/core/types.js";
import { projectName } from "../../shared/format.js";
import type { SessionMeta } from "../../shared/use-preferences.js";

export interface ProjectGroup {
  project: SessionProject;
  /** Short parent path, only needed when another project has the same display name. */
  directoryLabel?: string;
  sessions: SessionSummary[];
  updatedAt: string;
}

/** Older running servers do not yet return project metadata. */
export function sessionProject(session: SessionSummary): SessionProject {
  return (
    session.project ?? {
      id: session.cwd ?? "no-project",
      name: session.cwd ? projectName(session.cwd) : "Home / no project",
      path: session.cwd,
      availability: "unknown",
    }
  );
}

export function groupSessionsByProject(sessions: SessionSummary[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  const groupsByName = new Map<string, ProjectGroup[]>();
  const newestFirst = [...sessions].sort((first, second) =>
    second.updatedAt.localeCompare(first.updatedAt),
  );

  for (const session of newestFirst) {
    const project = sessionProject(session);
    let group = groups.get(project.id);

    if (!group) {
      group = { project, sessions: [], updatedAt: session.updatedAt };
      groups.set(project.id, group);
      const sameName = groupsByName.get(project.name) ?? [];
      sameName.push(group);
      groupsByName.set(project.name, sameName);
    }

    group.sessions.push(session);
  }

  // Reveal only enough parent folders to tell equal project names apart.
  for (const sameName of groupsByName.values()) {
    if (sameName.length < 2) continue;
    const parents = sameName.map((group) => ({
      group,
      parts: (group.project.path ?? "").split("/").filter(Boolean).slice(0, -1),
    }));

    for (const { group, parts } of parents) {
      let depth = 1;
      while (
        depth < parts.length &&
        parents.some(
          (other) =>
            other.group !== group &&
            other.parts.slice(-depth).join("/") === parts.slice(-depth).join("/"),
        )
      ) {
        depth++;
      }
      group.directoryLabel = parts.slice(-depth).join("/") || "/";
    }
  }

  return [...groups.values()];
}

export function matchingSessions(
  sessions: SessionSummary[],
  annotations: Record<string, SessionMeta>,
  query: string,
  transcriptMatches: ReadonlyMap<string, SearchMatch>,
): SessionSummary[] {
  const search = query.trim().toLowerCase();
  if (!search) return sessions;

  return sessions.filter((session) => {
    if (transcriptMatches.has(session.id)) return true;
    const annotation = annotations[session.id];
    const project = sessionProject(session);
    const fields = [
      session.id,
      session.title,
      session.firstPrompt,
      session.cwd ?? "",
      project.name,
      project.path ?? "",
      annotation?.title ?? "",
      annotation?.notes ?? "",
      ...(annotation?.tags ?? []),
    ];

    return fields.some((field) => field.toLowerCase().includes(search));
  });
}
