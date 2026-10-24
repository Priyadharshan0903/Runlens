import type { SessionSummary } from "../../../src/core/types.js";
import { sessionProject } from "../library/session-list.js";

export interface SessionNeighbors {
  previous?: SessionSummary;
  next?: SessionSummary;
  position: number;
  total: number;
}

/** The caller supplies the agent scope; project identity and ordering match the sidebar. */
export function sessionNeighbors(
  sessions: SessionSummary[],
  selectedId: string | undefined,
): SessionNeighbors | undefined {
  const selected = sessions.find((session) => session.id === selectedId);
  if (!selected) return;

  const projectId = sessionProject(selected).id;
  const projectSessions = sessions
    .filter((session) => sessionProject(session).id === projectId)
    .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
  const index = projectSessions.findIndex((session) => session.id === selectedId);

  return {
    previous: projectSessions[index - 1],
    next: projectSessions[index + 1],
    position: index + 1,
    total: projectSessions.length,
  };
}
