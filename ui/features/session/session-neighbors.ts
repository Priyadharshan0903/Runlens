import type { SessionSummary } from "../../../src/core/types.js";
import type { SidebarGrouping } from "../../shared/use-preferences.js";
import { groupSessionsByProject } from "../library/session-list.js";

export interface SessionNeighbors {
  previous?: SessionSummary;
  next?: SessionSummary;
  position: number;
  total: number;
}

/**
 * The caller supplies the agent scope. Paging follows the sidebar's order and crosses project
 * and day boundaries, so the last chat of one group leads to the first chat of the next.
 */
export function sessionNeighbors(
  sessions: SessionSummary[],
  selectedId: string | undefined,
  grouping: SidebarGrouping = "date",
): SessionNeighbors | undefined {
  if (!sessions.some((session) => session.id === selectedId)) return;

  const ordered =
    grouping === "project"
      ? groupSessionsByProject(sessions).flatMap((group) => group.sessions)
      : [...sessions].sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
  const index = ordered.findIndex((session) => session.id === selectedId);

  return {
    previous: ordered[index - 1],
    next: ordered[index + 1],
    position: index + 1,
    total: ordered.length,
  };
}
