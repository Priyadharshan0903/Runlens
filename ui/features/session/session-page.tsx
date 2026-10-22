import {
  ArrowClockwiseIcon,
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  CaretDownIcon,
  DownloadSimpleIcon,
  FolderSimpleIcon,
  GitBranchIcon,
  MagnifyingGlassIcon,
  PushPinIcon,
  SidebarSimpleIcon,
} from "@phosphor-icons/react";
import type { TargetedKeyboardEvent } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { Session } from "../../../src/core/types.js";
import { between, formatClock, formatDuration, plural, projectName } from "../../shared/format.js";
import { SessionInspector } from "./inspector.js";
import { SessionScrollControl } from "./session-scroll-control.js";
import type { SessionMeta } from "../../shared/use-preferences.js";
import { useResource } from "../../shared/use-resource.js";
import { AgentIdentity } from "../../shared/agent-identity.js";
import { AgentStep, Expansion, Target, TurnView } from "./transcript.js";
import {
  ActivityTrace,
  AgentRuns,
  Conversation,
  FileChanges,
  FilteredCalls,
  Statistics,
} from "./session-views.js";
import {
  download,
  exportMarkdown,
  formatCompactNumber,
  formatNumber,
  summarizeSession,
  totalTokens,
  type CallRef,
  type SessionOverview,
} from "./session-data.js";

const SESSION_TABS = [
  { id: "timeline", label: "Timeline" },
  { id: "conversation", label: "Conversation" },
  { id: "changes", label: "Changes" },
  { id: "agents", label: "Agents" },
  { id: "statistics", label: "Statistics" },
  { id: "failed", label: "Failures" },
] as const;

type SessionView = (typeof SESSION_TABS)[number]["id"];
interface SessionNavigation {
  view: SessionView;
  query: string;
  target?: { id: string };
}

interface SessionPageProps {
  sessionId: string;
  meta: SessionMeta;
  onMetaChange: (id: string, patch: Partial<SessionMeta>) => void;
  live: boolean;
  onLive: (value: boolean) => void;
  focus: boolean;
  onFocus: () => void;
  storageError: boolean;
}

export function SessionPage({ sessionId, onMetaChange, ...props }: SessionPageProps) {
  const request = useResource<Session>(`/api/sessions/${sessionId}`, {
    pollInterval: props.live ? 5_000 : 0,
  });
  const updateMeta = useCallback(
    function updateSessionMeta(patch: Partial<SessionMeta>) {
      onMetaChange(sessionId, patch);
    },
    [sessionId, onMetaChange],
  );

  // Rebuilding replaces static assets, but an existing Node process still serves its old API.
  const outdatedBackend = request.data && !request.data.source;
  if (!request.data || outdatedBackend) {
    const error = outdatedBackend
      ? "This Runlens process is serving an older session format than the UI. Your sessions are still on disk. Stop the running Runlens process and start it again with the same --dir folders, then reload this page."
      : request.error;
    return (
      <div class="main-message" role={error ? "alert" : "status"}>
        <h1>
          {outdatedBackend
            ? "Restart Runlens to open this session"
            : error
              ? "Couldn't open this session"
              : "Opening session…"}
        </h1>
        {error && <p>{error}</p>}
        {error && (
          <button class="button secondary" onClick={request.refresh}>
            Try again
          </button>
        )}
        {error && <a href="#/">Back to all sessions</a>}
      </div>
    );
  }

  return <SessionDetail {...props} session={request.data} request={request} onMeta={updateMeta} />;
}

interface SessionDetailProps extends Omit<SessionPageProps, "sessionId" | "onMetaChange"> {
  session: Session;
  request: ReturnType<typeof useResource<Session>>;
  onMeta: (patch: Partial<SessionMeta>) => void;
}

function SessionDetail({
  session,
  request,
  meta,
  onMeta,
  live,
  onLive,
  focus,
  onFocus,
  storageError,
}: SessionDetailProps) {
  const [navigation, setNavigation] = useState<SessionNavigation>({ view: "timeline", query: "" });
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState(false);
  const overview = useMemo(() => summarizeSession(session), [session]);
  const tokens = totalTokens(session.usage);
  const reloading = request.status === "refreshing";
  const updatedAt = request.updatedAt;
  const refreshError = request.error;
  const onReload = request.refresh;
  const searchQuery = navigation.query.trim().toLowerCase();
  const needsCallSearch = navigation.view === "timeline" && searchQuery.length > 0;

  // Serialize inputs once when search is used, not on every render or every new search character.
  const callSearchIndex = useMemo(() => {
    if (!needsCallSearch) return [];

    return overview.calls.map((reference) => {
      const { step } = reference;
      const text = [
        step.name,
        step.summary,
        step.why,
        JSON.stringify(step.input),
        step.result?.output,
      ]
        .join("\n")
        .toLowerCase();
      return { reference, text };
    });
  }, [overview.calls, needsCallSearch]);

  const matchingCalls = useMemo(() => {
    return callSearchIndex
      .filter((entry) => entry.text.includes(searchQuery))
      .map((entry) => entry.reference);
  }, [callSearchIndex, searchQuery]);

  useEffect(() => {
    document.title = `${meta.title || session.title} · Runlens`;
    return () => {
      document.title = "Runlens — Your agent workspace";
    };
  }, [meta.title, session.title]);

  useEffect(() => {
    if (!navigation.target) return;

    const targetId = navigation.target.id;
    let frame = 0;
    let attempts = 0;

    // A hidden target may need its parent group and subagent to render first.
    function revealTarget() {
      const element = document.getElementById(`step-${targetId}`);
      if (!element) {
        if (++attempts < 12) frame = requestAnimationFrame(revealTarget);
        return;
      }

      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      element.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
      element.classList.remove("flash");
      void element.offsetWidth;
      element.classList.add("flash");
    }

    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(revealTarget);
    });
    return () => cancelAnimationFrame(frame);
  }, [navigation.target]);

  function selectView(view: SessionView) {
    setNavigation({ view, query: "" });
  }

  function showCall(id: string) {
    setNavigation({ view: "timeline", query: "", target: { id } });
  }

  function handleTabKey(event: TargetedKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number;

    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else
      nextIndex =
        (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;

    tabs[nextIndex]?.click();
    tabs[nextIndex]?.focus();
  }

  function exportSession(format: "json" | "md") {
    const title = meta.title || session.title;
    let contents: string;
    let contentType: string;

    if (format === "json") {
      contents = JSON.stringify({ ...session, title, annotation: meta }, null, 2);
      contentType = "application/json";
    } else {
      contents = exportMarkdown({ ...session, title });
      if (meta.notes) contents += `\n## Your notes\n\n${meta.notes}\n`;
      contentType = "text/markdown";
    }

    download(`runlens-${session.id}.${format}`, contents, contentType);
  }

  return (
    <Target.Provider value={navigation.target}>
      <Expansion.Provider value={expanded}>
        <article class="session">
          <header class="session-head">
            <div class="session-kicker">
              <span class="provider-label">
                <AgentIdentity source={session.source} />
              </span>
              <span class="session-id" title={session.id}>
                {session.id.replace(`${session.source.id}--`, "").slice(0, 8)}
              </span>
              <span
                class="freshness"
                title={
                  refreshError
                    ? `Couldn't sync: ${refreshError}`
                    : live
                      ? "Live refresh is on. New session activity is checked automatically."
                      : "Last successful sync. Turn on Live refresh to follow new activity."
                }
              >
                <span
                  class="sync-dot"
                  data-state={refreshError ? "error" : reloading || live ? "live" : "synced"}
                  aria-hidden="true"
                />
                {refreshError
                  ? "Sync failed"
                  : reloading
                    ? "Refreshing…"
                    : updatedAt
                      ? `${live ? "Live · " : ""}Synced ${formatClock(updatedAt)}`
                      : ""}
              </span>
            </div>
            <div class="title-row">
              <h1>{meta.title || session.title}</h1>
              <div class="session-actions">
                <button
                  class={`icon-button ${meta.pinned ? "is-pinned" : ""}`}
                  onClick={() => onMeta({ pinned: !meta.pinned })}
                  aria-label={meta.pinned ? "Unpin session" : "Pin session"}
                  aria-pressed={!!meta.pinned}
                  title={meta.pinned ? "Unpin session" : "Pin session"}
                >
                  <PushPinIcon size={17} weight={meta.pinned ? "fill" : "regular"} />
                </button>
                <button
                  class="icon-button"
                  onClick={onFocus}
                  aria-label={focus ? "Exit focus mode" : "Enter focus mode"}
                  title={focus ? "Exit focus mode (Esc)" : "Focus mode"}
                >
                  {focus ? <ArrowsInSimpleIcon size={17} /> : <ArrowsOutSimpleIcon size={17} />}
                </button>
                <button
                  class="icon-button details-toggle"
                  aria-label="Toggle session details"
                  aria-expanded={details}
                  onClick={() => setDetails(!details)}
                  title="Session details"
                >
                  <SidebarSimpleIcon size={17} />
                </button>
                <details class="export-menu">
                  <summary class="button secondary">
                    <DownloadSimpleIcon size={15} />
                    <span>Export</span>
                    <CaretDownIcon size={12} />
                  </summary>
                  <div class="export-options">
                    <button
                      onClick={(e) => {
                        exportSession("md");
                        e.currentTarget.closest("details")?.removeAttribute("open");
                      }}
                    >
                      Markdown transcript <span>.md</span>
                    </button>
                    <button
                      onClick={(e) => {
                        exportSession("json");
                        e.currentTarget.closest("details")?.removeAttribute("open");
                      }}
                    >
                      Session with notes <span>.json</span>
                    </button>
                  </div>
                </details>
              </div>
            </div>
            <div class="session-meta-line">
              <span>
                <FolderSimpleIcon size={14} />
                {projectName(session.cwd)}
              </span>
              {session.branch && (
                <span>
                  <GitBranchIcon size={14} />
                  {session.branch}
                </span>
              )}
              <span>
                {session.startedAt
                  ? new Date(session.startedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "Date unavailable"}
              </span>
              <span title="Elapsed time includes pauses between messages">
                {formatDuration(between(session.startedAt, session.endedAt)) ||
                  "Duration unavailable"}
              </span>
              {meta.tags?.map((tag) => (
                <span class="tag" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
            <div class="session-finding">
              <span>
                {plural(session.turns.length, "turn")} ·{" "}
                {overview.changedFiles.length
                  ? `${plural(overview.changedFiles.length, "file")} edited`
                  : "No file edits recorded"}
                {overview.failedCalls.length > 0 ? (
                  <>
                    {" "}
                    ·{" "}
                    <button class="failure-link" onClick={() => selectView("failed")}>
                      {plural(overview.failedCalls.length, "failed call")}
                    </button>
                  </>
                ) : (
                  " · No tool errors recorded"
                )}
              </span>
              <label class="live-control">
                <input
                  type="checkbox"
                  checked={live}
                  onChange={(e) => onLive(e.currentTarget.checked)}
                />
                <span class={live ? "live-dot on" : "live-dot"} />
                Live refresh
              </label>
              <button
                class="icon-button"
                onClick={onReload}
                disabled={reloading}
                aria-label="Refresh current session"
                title="Refresh current session"
              >
                <ArrowClockwiseIcon size={15} className={reloading ? "spin" : ""} />
              </button>
            </div>
            {refreshError && (
              <p class="inline-notice" role="alert">
                Couldn't refresh: {refreshError}. Showing the last loaded copy.
              </p>
            )}
            <div class="session-metrics">
              <div>
                <span>Tool calls</span>
                <strong>{formatNumber(overview.calls.length)}</strong>
              </div>
              <div>
                <span>Files edited</span>
                <strong>{formatNumber(overview.changedFiles.length)}</strong>
              </div>
              <div>
                <span>Subagents</span>
                <strong>{formatNumber(overview.agents.length)}</strong>
              </div>
              <div>
                <span>
                  {session.usageScope === "main" ? "Main-agent tokens" : "Recorded tokens"}
                </span>
                <strong
                  title={
                    tokens === undefined
                      ? "No usage was recorded"
                      : `${formatNumber(tokens)} tokens, including cache reads and writes`
                  }
                >
                  {formatCompactNumber(tokens)}
                </strong>
              </div>
            </div>
          </header>

          <div class="detail-grid">
            <div class="session-content">
              <div
                class="view-switch"
                role="tablist"
                aria-label="Session view"
                onKeyDown={handleTabKey}
              >
                {SESSION_TABS.filter(
                  (tab) => tab.id !== "failed" || overview.failedCalls.length > 0,
                ).map((tab) => (
                  <button
                    key={tab.id}
                    role="tab"
                    id={`tab-${tab.id}`}
                    aria-selected={navigation.view === tab.id}
                    tabIndex={navigation.view === tab.id ? 0 : -1}
                    aria-controls="session-panel"
                    class="view-tab"
                    onClick={() => selectView(tab.id)}
                  >
                    {tab.label}
                    {tab.id === "changes" && overview.changedFiles.length > 0 && (
                      <span class="count">{overview.changedFiles.length}</span>
                    )}
                    {tab.id === "failed" && (
                      <span class="count fail-text">{overview.failedCalls.length}</span>
                    )}
                  </button>
                ))}
              </div>
              <section
                id="session-panel"
                role="tabpanel"
                aria-labelledby={`tab-${navigation.view}`}
              >
                {(navigation.view === "timeline" || navigation.view === "conversation") && (
                  <div class="transcript-toolbar">
                    <label class="session-search">
                      <MagnifyingGlassIcon size={14} />
                      <input
                        aria-label="Find in session"
                        type="search"
                        placeholder="Find in this session…"
                        value={navigation.query}
                        onInput={(event) =>
                          setNavigation({
                            ...navigation,
                            query: event.currentTarget.value,
                            target: undefined,
                          })
                        }
                      />
                    </label>
                    {navigation.view === "timeline" && (
                      <button
                        class="text-button expand-button"
                        onClick={() => setExpanded(!expanded)}
                      >
                        {expanded ? (
                          <ArrowsInSimpleIcon size={14} />
                        ) : (
                          <ArrowsOutSimpleIcon size={14} />
                        )}
                        {expanded ? "Collapse details" : "Expand details"}
                      </button>
                    )}
                  </div>
                )}
                <SessionPanel
                  view={navigation.view}
                  query={navigation.query}
                  session={session}
                  overview={overview}
                  matchingCalls={matchingCalls}
                  onShowCall={showCall}
                />
              </section>
            </div>
            <SessionInspector
              session={session}
              overview={overview}
              meta={meta}
              open={details}
              storageError={storageError}
              onClose={() => setDetails(false)}
              onShowCall={showCall}
              onMeta={onMeta}
            />
          </div>
          <SessionScrollControl />
        </article>
      </Expansion.Provider>
    </Target.Provider>
  );
}

interface SessionPanelProps {
  view: SessionView;
  query: string;
  session: Session;
  overview: SessionOverview;
  matchingCalls: CallRef[];
  onShowCall: (id: string) => void;
}

function SessionPanel({
  view,
  query,
  session,
  overview,
  matchingCalls,
  onShowCall,
}: SessionPanelProps) {
  switch (view) {
    case "conversation":
      return <Conversation session={session} query={query} />;
    case "changes":
      return <FileChanges files={overview.changedFiles} cwd={session.cwd} />;
    case "agents":
      return <AgentRuns agents={overview.agents} />;
    case "statistics":
      return <Statistics session={session} overview={overview} />;
    case "failed":
      return (
        <>
          <p class="section-caption view-caption">
            Tool errors are recorded outcomes, not a judgment of the final result.
          </p>
          <FilteredCalls rows={overview.failedCalls} onShow={onShowCall} />
        </>
      );
    case "timeline":
      if (query.trim()) return <FilteredCalls rows={matchingCalls} onShow={onShowCall} />;
      return (
        <>
          <ActivityTrace calls={overview.calls} onPick={onShowCall} />
          {session.turns.map((turn, index) => (
            <TurnView key={index} turn={turn} index={index} />
          ))}
          {session.unlinkedAgents.length > 0 && (
            <section class="unlinked-section">
              <h2>Other subagents</h2>
              <p class="section-caption">These transcripts couldn't be linked to a launch call.</p>
              <div class="timeline">
                {session.unlinkedAgents.map((run) => (
                  <AgentStep key={run.id} run={run} />
                ))}
              </div>
            </section>
          )}
        </>
      );
  }
}
