import {
  ArrowClockwiseIcon,
  ArrowUpRightIcon,
  ClockCounterClockwiseIcon,
  FolderSimpleIcon,
  MagnifyingGlassIcon,
  PushPinIcon,
  RobotIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "preact/hooks";
import type { SearchMatch, SessionSummary } from "../../../src/core/types.js";
import { formatAgo } from "../../shared/format.js";
import type { SessionMeta } from "../../shared/use-preferences.js";
import type { Resource } from "../../shared/use-resource.js";
import { groupSessionsByProject, sessionProject } from "./session-list.js";
import type { useSessionSearch } from "./use-session-search.js";

export interface SessionLibrary {
  sessions: SessionSummary[];
  roots: string[];
}

interface LibraryProps {
  library: Resource<SessionLibrary>;
  matching: SessionSummary[];
  search: ReturnType<typeof useSessionSearch>;
  query: string;
  scope: "all" | "pinned";
  annotations: Record<string, SessionMeta>;
  onQueryChange: (query: string) => void;
  onRefresh: () => void;
  onPin: (id: string) => void;
}

const DEFAULT_FILTERS = { project: "", period: "all", sort: "newest" };
const PAGE_SIZE = 40;
const NO_SESSIONS: SessionSummary[] = [];

export function Library({
  library,
  matching,
  search,
  query,
  scope,
  annotations,
  onQueryChange,
  onRefresh,
  onPin,
}: LibraryProps) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const searchQuery = query.trim();
  const sessions = library.data?.sessions ?? NO_SESSIONS;

  const projects = useMemo(
    () =>
      groupSessionsByProject(sessions)
        .map((group) => group.project)
        .sort(
          (first, second) =>
            first.name.localeCompare(second.name) || first.id.localeCompare(second.id),
        ),
    [sessions],
  );

  const visibleSessions = useMemo(() => {
    const today = new Date();
    let earliestDate = 0;

    switch (filters.period) {
      case "today":
        earliestDate = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        break;
      case "week":
        earliestDate = today.getTime() - 7 * 86_400_000;
        break;
      case "month":
        earliestDate = today.getTime() - 30 * 86_400_000;
        break;
    }

    const matchingSessions = matching.filter((session) => {
      const annotation = annotations[session.id];

      if (scope === "pinned" && !annotation?.pinned) return false;
      if (filters.project && sessionProject(session).id !== filters.project) return false;
      if (Date.parse(session.updatedAt) < earliestDate) return false;
      return true;
    });

    return matchingSessions.sort((first, second) => {
      if (filters.sort === "oldest") {
        return first.updatedAt.localeCompare(second.updatedAt);
      }
      if (filters.sort === "title") {
        const firstTitle = annotations[first.id]?.title || first.title;
        const secondTitle = annotations[second.id]?.title || second.title;
        return firstTitle.localeCompare(secondTitle);
      }
      return second.updatedAt.localeCompare(first.updatedAt);
    });
  }, [matching, annotations, filters, scope]);

  const hasFilters = !!query || !!filters.project || filters.period !== "all";
  const isSearching = search.status === "loading";
  const projectCount = new Set(visibleSessions.map((session) => sessionProject(session).id)).size;
  const agentCount = visibleSessions.reduce((total, session) => total + session.subagents, 0);

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    onQueryChange("");
  }

  return (
    <div class="library">
      <div class="page-heading">
        <div>
          <p class="eyebrow">Your agent workspace</p>
          <h1>{scope === "pinned" ? "Pinned sessions" : "Sessions"}</h1>
          <p class="page-description">Every run has a story. Find the steps that matter.</p>
        </div>
        <button class="button secondary" onClick={onRefresh}>
          <ArrowClockwiseIcon size={15} />
          Refresh
        </button>
      </div>

      <div class="library-summary">
        <div>
          <span>Sessions</span>
          <strong>{visibleSessions.length.toLocaleString()}</strong>
        </div>
        <div>
          <span>Projects</span>
          <strong>{projectCount.toLocaleString()}</strong>
        </div>
        <div>
          <span>Subagent transcripts</span>
          <strong>{agentCount.toLocaleString()}</strong>
        </div>
      </div>

      <div class="library-toolbar">
        <div class="filter-group">
          <label class="select-control">
            <FolderSimpleIcon size={15} />
            <select
              aria-label="Filter by project"
              value={filters.project}
              onChange={(event) => setFilters({ ...filters, project: event.currentTarget.value })}
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                  {project.path ? ` — ${project.path}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label class="select-control">
            <ClockCounterClockwiseIcon size={15} />
            <select
              aria-label="Filter by date"
              value={filters.period}
              onChange={(event) => setFilters({ ...filters, period: event.currentTarget.value })}
            >
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="week">Past 7 days</option>
              <option value="month">Past 30 days</option>
            </select>
          </label>
          {hasFilters && (
            <button class="text-button clear-filters" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
        <label class="sort-control">
          <span>Sort</span>
          <select
            aria-label="Sort sessions"
            value={filters.sort}
            onChange={(event) => setFilters({ ...filters, sort: event.currentTarget.value })}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="title">Session title</option>
          </select>
        </label>
      </div>

      {query && (
        <p class="search-status" role="status">
          {isSearching
            ? "Searching session and subagent transcripts…"
            : `${visibleSessions.length} sessions matching “${query}”`}
          {searchQuery.length === 1 && " · Type 2 characters to search transcript contents."}
        </p>
      )}
      {library.error && (
        <p class="inline-notice" role="alert">
          Couldn't refresh the library: {library.error}
        </p>
      )}
      {search.error && (
        <p class="inline-notice" role="alert">
          Transcript search failed: {search.error}. Title and note matches are still shown.
        </p>
      )}

      {(library.status === "loading" || (isSearching && !visibleSessions.length)) && (
        <p class="empty-block" role="status">
          Reading sessions…
        </p>
      )}
      {library.data && !isSearching && !visibleSessions.length && (
        <div class="library-empty">
          <MagnifyingGlassIcon size={26} />
          <h2>{sessions.length ? "No sessions match" : "Your next run starts here"}</h2>
          <p>
            {sessions.length
              ? "Try another search, project, or date range."
              : "Runlens reads your local Claude Code history. Start a Claude Code session, then refresh this library."}
          </p>
          {!!sessions.length && (
            <button class="button secondary" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      )}
      {!!visibleSessions.length && (
        <SessionTable
          // Pagination belongs to this result set. A changed filter starts a new result set.
          key={`${scope}:${query}:${filters.project}:${filters.period}:${filters.sort}`}
          sessions={visibleSessions}
          annotations={annotations}
          matches={search.matches}
          query={query}
          roots={library.data?.roots ?? []}
          onPin={onPin}
        />
      )}
    </div>
  );
}

interface SessionTableProps {
  sessions: SessionSummary[];
  annotations: Record<string, SessionMeta>;
  matches: Map<string, SearchMatch>;
  query: string;
  roots: string[];
  onPin: (id: string) => void;
}

function SessionTable({ sessions, annotations, matches, query, roots, onPin }: SessionTableProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  return (
    <>
      <div class="session-table" role="table" aria-label="Sessions">
        <div class="session-table-head" role="row">
          <span role="columnheader">Session</span>
          <span role="columnheader">Project</span>
          <span role="columnheader" class="num">
            Agents
          </span>
          <span role="columnheader" class="num">
            Last activity
          </span>
          <span />
        </div>
        {sessions.slice(0, visibleCount).map((session) => {
          const annotation = annotations[session.id];
          const title = annotation?.title || session.title;
          const snippet = matches.get(session.id)?.snippet ?? session.firstPrompt;

          return (
            <div class="session-table-row" role="row" key={session.id}>
              <div class="session-identity" role="cell">
                <button
                  class={`pin-button ${annotation?.pinned ? "is-pinned" : ""}`}
                  aria-label={`${annotation?.pinned ? "Unpin" : "Pin"} ${title}`}
                  aria-pressed={!!annotation?.pinned}
                  onClick={() => onPin(session.id)}
                >
                  <PushPinIcon size={15} weight={annotation?.pinned ? "fill" : "regular"} />
                </button>
                <a href={`#/s/${session.id}`} class="session-link">
                  <span class="session-row-title">{title}</span>
                  <span class="session-preview">
                    <SearchExcerpt text={snippet} query={query} />
                  </span>
                  {!!annotation?.tags?.length && (
                    <span class="row-tags">
                      {annotation.tags.map((tag) => (
                        <span class="tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </a>
              </div>
              <span
                class="table-project"
                role="cell"
                title={sessionProject(session).path ?? session.cwd}
              >
                <FolderSimpleIcon size={14} />
                {sessionProject(session).name}
              </span>
              <span class="num table-agents" role="cell">
                {session.subagents ? (
                  <>
                    <RobotIcon size={14} />
                    {session.subagents}
                  </>
                ) : (
                  "—"
                )}
              </span>
              <time
                role="cell"
                class="num table-time"
                title={new Date(session.updatedAt).toLocaleString()}
                dateTime={session.updatedAt}
              >
                {formatAgo(session.updatedAt)}
              </time>
              <a
                class="row-open icon-button"
                href={`#/s/${session.id}`}
                aria-label={`Open ${title}`}
              >
                <ArrowUpRightIcon size={16} />
              </a>
            </div>
          );
        })}
      </div>
      <div class="list-footer">
        <span>
          Showing {Math.min(visibleCount, sessions.length)} of {sessions.length} sessions
        </span>
        {sessions.length > visibleCount && (
          <button
            class="button secondary"
            onClick={() => setVisibleCount(visibleCount + PAGE_SIZE)}
          >
            Load {PAGE_SIZE} more
          </button>
        )}
        <span class="source-label" title={roots.join("\n")}>
          <ShieldCheckIcon size={14} />
          {roots.length} local {roots.length === 1 ? "folder" : "folders"}
        </span>
      </div>
    </>
  );
}

function SearchExcerpt({ text, query }: { text: string; query: string }) {
  const search = query.trim();
  const start = text.toLowerCase().indexOf(search.toLowerCase());

  if (!search || start < 0) return <>{text}</>;

  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, start + search.length)}</mark>
      {text.slice(start + search.length)}
    </>
  );
}
