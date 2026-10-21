import {
  ArrowClockwiseIcon,
  DesktopIcon,
  MoonIcon,
  PushPinIcon,
  ShieldCheckIcon,
  StackIcon,
  SunIcon,
} from "@phosphor-icons/react";
import type { SessionSummary } from "../../src/core/types.js";
import { SessionNavigation } from "../features/library/session-navigation.js";
import { BrandMark } from "../shared/brand.js";
import type { SessionMeta, SidebarGrouping, Theme } from "../shared/use-preferences.js";

interface SidebarProps {
  sessions: SessionSummary[];
  pinnedCount: number;
  annotations: Record<string, SessionMeta>;
  selectedId?: string;
  scope: "all" | "pinned";
  theme: Theme;
  grouping: SidebarGrouping;
  onGroupingChange: (grouping: SidebarGrouping) => void;
  query: string;
  searchPending: boolean;
  searchError?: string;
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
  pinnedCount,
  annotations,
  selectedId,
  scope,
  theme,
  grouping,
  onGroupingChange,
  query,
  searchPending,
  searchError,
  onThemeChange,
  onRefresh,
  onNavigate,
}: SidebarProps) {
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
        <span>Sessions</span>
        <button
          class="icon-button"
          onClick={onRefresh}
          aria-label="Refresh session library"
          title="Refresh session library"
        >
          <ArrowClockwiseIcon size={14} />
        </button>
      </div>

      <SessionNavigation
        sessions={sessions}
        annotations={annotations}
        selectedId={selectedId}
        grouping={grouping}
        onGroupingChange={onGroupingChange}
        query={query}
        searchPending={searchPending}
        searchError={searchError}
      />

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
