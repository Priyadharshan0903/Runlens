import {
  ArrowClockwiseIcon,
  DesktopIcon,
  MoonIcon,
  PushPinIcon,
  ShieldCheckIcon,
  StackIcon,
  SunIcon,
} from "@phosphor-icons/react";
import { useMemo } from "preact/hooks";
import type { SessionSummary } from "../../src/core/types.js";
import { BrandMark } from "../shared/brand.js";
import { dayGroup, formatAgo, projectName } from "../shared/format.js";
import type { SessionMeta, Theme } from "../shared/use-preferences.js";

interface SidebarProps {
  sessions: SessionSummary[];
  annotations: Record<string, SessionMeta>;
  selectedId?: string;
  scope: "all" | "pinned";
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onRefresh: () => void;
  onNavigate: () => void;
}

const THEMES = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: DesktopIcon },
] as const;

export function Sidebar({
  sessions,
  annotations,
  selectedId,
  scope,
  theme,
  onThemeChange,
  onRefresh,
  onNavigate,
}: SidebarProps) {
  const recentGroups = useMemo(() => {
    const groups = new Map<string, SessionSummary[]>();

    for (const session of sessions.slice(0, 30)) {
      const day = dayGroup(session.updatedAt);
      const group = groups.get(day) ?? [];
      group.push(session);
      groups.set(day, group);
    }

    return [...groups];
  }, [sessions]);

  const pinnedCount = sessions.filter((session) => annotations[session.id]?.pinned).length;

  return (
    <aside
      id="workspace-sidebar"
      class="sidebar"
      aria-label="Workspace navigation"
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("a")) onNavigate();
      }}
    >
      <a class="brand" href="#/">
        <BrandMark />
        <span>Runlens</span>
        <span class="brand-label">local</span>
      </a>

      <div class="workspace-label">
        <span class="workspace-dot" />
        <span>Personal workspace</span>
      </div>

      <nav class="primary-nav" aria-label="Session library">
        <a class={`nav-item ${!selectedId && scope === "all" ? "active" : ""}`} href="#/">
          <StackIcon size={18} />
          <span>All sessions</span>
        </a>
        <a class={`nav-item ${!selectedId && scope === "pinned" ? "active" : ""}`} href="#/pinned">
          <PushPinIcon size={18} />
          <span>Pinned sessions</span>
          {pinnedCount > 0 && <span class="nav-count">{pinnedCount}</span>}
        </a>
      </nav>

      <div class="recent-heading">
        <span>Recent sessions</span>
        <button
          class="icon-button"
          onClick={onRefresh}
          aria-label="Refresh session library"
          title="Refresh session library"
        >
          <ArrowClockwiseIcon size={14} />
        </button>
      </div>

      <nav class="recent-list" aria-label="Recent sessions">
        {recentGroups.map(([day, group]) => (
          <section key={day}>
            <h2 class="day">{day}</h2>
            {group.map((session) => (
              <a
                key={session.id}
                class={`recent-item ${session.id === selectedId ? "active" : ""}`}
                href={`#/s/${session.id}`}
                aria-current={session.id === selectedId ? "page" : undefined}
              >
                <span class="recent-title">
                  {annotations[session.id]?.pinned && <PushPinIcon size={12} />}
                  {annotations[session.id]?.title || session.title}
                </span>
                <span class="recent-meta">
                  {projectName(session.cwd)}
                  <span>{formatAgo(session.updatedAt)}</span>
                </span>
              </a>
            ))}
          </section>
        ))}
        {!sessions.length && <p class="side-message">Your sessions will appear here.</p>}
      </nav>

      <div class="sidebar-footer">
        <div class="privacy-line">
          <ShieldCheckIcon size={15} />
          <span>On your machine. Only yours.</span>
        </div>
        <div class="theme-control" role="group" aria-label="Color theme">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              aria-pressed={theme === value}
              onClick={() => onThemeChange(value)}
              title={`${label} theme`}
            >
              <Icon size={15} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
