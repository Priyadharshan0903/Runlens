import { CaretRightIcon, FolderSimpleIcon, PushPinIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "preact/hooks";
import type { SessionSummary } from "../../../src/core/types.js";
import { dayGroup, formatAgo } from "../../shared/format.js";
import { AgentIdentity } from "../../shared/agent-identity.js";
import type { SessionMeta, SidebarGrouping } from "../../shared/use-preferences.js";
import { groupSessionsByProject, sessionProject, type ProjectGroup } from "./session-list.js";

interface SessionNavigationProps {
  sessions: SessionSummary[];
  annotations: Record<string, SessionMeta>;
  selectedId?: string;
  grouping: SidebarGrouping;
  onGroupingChange: (grouping: SidebarGrouping) => void;
  query: string;
  searchPending: boolean;
  searchError?: string;
  showSource?: boolean;
}

interface ProjectChoices {
  expanded?: boolean;
  visibleCount?: number;
}

export function SessionNavigation({
  sessions,
  annotations,
  selectedId,
  grouping,
  onGroupingChange,
  query,
  searchPending,
  searchError,
  showSource,
}: SessionNavigationProps) {
  // Keep user choices when search temporarily removes a group from the results.
  const [projectChoices, setProjectChoices] = useState<Record<string, ProjectChoices>>({});
  const groups = useMemo(() => groupSessionsByProject(sessions), [sessions]);
  const searching = !!query.trim();

  return (
    <>
      <div class="grouping-row">
        <span>Group by</span>
        <div class="grouping-control" role="group" aria-label="Group sessions">
          <button aria-pressed={grouping === "project"} onClick={() => onGroupingChange("project")}>
            Project
          </button>
          <button aria-pressed={grouping === "date"} onClick={() => onGroupingChange("date")}>
            Date
          </button>
        </div>
      </div>
      <nav
        class="recent-list"
        aria-label={grouping === "project" ? "Sessions by project" : "Sessions by date"}
      >
        {searchPending && (
          <p class="side-message" role="status">
            Searching transcripts…
          </p>
        )}
        {searchError && (
          <p class="side-message" role="status">
            Transcript search failed. Showing title and note matches.
          </p>
        )}
        {grouping === "project" ? (
          groups.map((group, index) => (
            <ProjectSessions
              key={group.project.id}
              group={group}
              annotations={annotations}
              showSource={showSource}
              selectedId={selectedId}
              defaultOpen={index < 3 || group.sessions.some((session) => session.id === selectedId)}
              searching={searching}
              choices={projectChoices[group.project.id]}
              onChange={(patch) =>
                setProjectChoices((previous) => ({
                  ...previous,
                  [group.project.id]: { ...previous[group.project.id], ...patch },
                }))
              }
            />
          ))
        ) : (
          <DateSessions
            sessions={sessions}
            annotations={annotations}
            selectedId={selectedId}
            showSource={showSource}
          />
        )}
        {!sessions.length && !searchPending && (
          <p class="side-message">
            {searching ? "No sessions match this search." : "Your sessions will appear here."}
          </p>
        )}
      </nav>
    </>
  );
}

interface ProjectSessionsProps {
  group: ProjectGroup;
  annotations: Record<string, SessionMeta>;
  selectedId?: string;
  showSource?: boolean;
  defaultOpen: boolean;
  searching: boolean;
  choices?: ProjectChoices;
  onChange: (patch: ProjectChoices) => void;
}

function ProjectSessions({
  group,
  annotations,
  selectedId,
  showSource,
  defaultOpen,
  searching,
  choices,
  onChange,
}: ProjectSessionsProps) {
  const open = searching || (choices?.expanded ?? defaultOpen);
  const selectedIndex = group.sessions.findIndex((session) => session.id === selectedId);
  const count = Math.max(choices?.visibleCount ?? 5, searching ? 0 : selectedIndex + 1);
  const contentId = `project-${encodeURIComponent(group.project.id)}`;

  return (
    <section class="project-group">
      <button
        class="project-heading"
        aria-expanded={open}
        aria-controls={contentId}
        aria-label={`${group.project.name}${group.project.path ? `, ${group.project.path}` : ""}, ${group.sessions.length} ${group.sessions.length === 1 ? "session" : "sessions"}`}
        onClick={() => onChange({ expanded: !open })}
        disabled={searching}
        title={group.project.path ?? group.project.name}
      >
        <CaretRightIcon size={12} className="project-chevron" />
        <FolderSimpleIcon size={15} />
        <span class="project-label">{group.project.name}</span>
        <span class="project-meta">
          {group.directoryLabel && <span class="project-directory">{group.directoryLabel}</span>}
          <time
            dateTime={group.updatedAt}
            title={`Last activity: ${new Date(group.updatedAt).toLocaleString()}`}
          >
            {group.directoryLabel && <span aria-hidden="true"> · </span>}
            {formatAgo(group.updatedAt)}
          </time>
        </span>
        {group.project.availability === "missing" && (
          <span class="project-status">Folder removed</span>
        )}
        <span
          class="project-count"
          title={`${group.sessions.length} ${group.sessions.length === 1 ? "session" : "sessions"}`}
        >
          {group.sessions.length}
        </span>
      </button>
      <div class="project-sessions" id={contentId} hidden={!open}>
        {open && (
          <>
            {group.sessions.slice(0, count).map((session) => (
              <SessionLink
                key={session.id}
                session={session}
                annotation={annotations[session.id]}
                selectedId={selectedId}
                showProject={false}
                showSource={showSource}
              />
            ))}
            {group.sessions.length > count && (
              <button
                class="text-button navigation-more"
                onClick={() => onChange({ visibleCount: count + 5 })}
              >
                Show {Math.min(5, group.sessions.length - count)} more
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function DateSessions({
  sessions,
  annotations,
  selectedId,
  showSource,
}: Pick<SessionNavigationProps, "sessions" | "annotations" | "selectedId" | "showSource">) {
  const [visibleCount, setVisibleCount] = useState(30);
  const count = Math.max(
    visibleCount,
    sessions.findIndex((session) => session.id === selectedId) + 1,
  );
  const groups = new Map<string, SessionSummary[]>();

  for (const session of sessions.slice(0, count)) {
    const day = dayGroup(session.updatedAt);
    const group = groups.get(day) ?? [];
    group.push(session);
    groups.set(day, group);
  }

  return (
    <>
      {[...groups].map(([day, group]) => (
        <section key={day}>
          <h2 class="day">{day}</h2>
          {group.map((session) => (
            <SessionLink
              key={session.id}
              session={session}
              annotation={annotations[session.id]}
              selectedId={selectedId}
              showSource={showSource}
            />
          ))}
        </section>
      ))}
      {sessions.length > count && (
        <button class="text-button navigation-more" onClick={() => setVisibleCount(count + 30)}>
          Show {Math.min(30, sessions.length - count)} more sessions
        </button>
      )}
    </>
  );
}

function SessionLink({
  session,
  annotation,
  selectedId,
  showProject = true,
  showSource,
}: {
  session: SessionSummary;
  annotation?: SessionMeta;
  selectedId?: string;
  showProject?: boolean;
  showSource?: boolean;
}) {
  return (
    <a
      class={`recent-item ${session.id === selectedId ? "active" : ""}`}
      href={`#/s/${session.id}`}
      aria-current={session.id === selectedId ? "page" : undefined}
      title={annotation?.title || session.title}
    >
      <span class="recent-title">
        {annotation?.pinned && <PushPinIcon size={12} />}
        {annotation?.title || session.title}
      </span>
      <span class="recent-meta">
        {(showProject || showSource) && (
          <span class="recent-project" title={session.source?.name}>
            {showSource && <AgentIdentity source={session.source} />}
            {showSource && showProject && " · "}
            {showProject && sessionProject(session).name}
          </span>
        )}
        <time dateTime={session.updatedAt}>{formatAgo(session.updatedAt)}</time>
      </span>
    </a>
  );
}
