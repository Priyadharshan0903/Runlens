import {
  ArrowClockwiseIcon,
  DesktopIcon,
  MoonIcon,
  PushPinIcon,
  ShieldCheckIcon,
  StackIcon,
  SunIcon,
  CaretDownIcon,
  CheckIcon,
} from "@phosphor-icons/react";
import type { SessionSummary, SessionSource } from "../../src/core/types.js";
import { SessionNavigation } from "../features/library/session-navigation.js";
import { BrandMark } from "../shared/brand.js";
import { AgentIdentity } from "../shared/agent-identity.js";
import type { SessionMeta, SidebarGrouping, Theme } from "../shared/use-preferences.js";

interface SidebarProps {
  sessions: SessionSummary[];
  sources: SessionSource[];
  sourceId: string;
  onSourceChange: (id: string) => void;
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
  sources,
  sourceId,
  onSourceChange,
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

      <div class="agent-select">
        <span class="agent-select-label" id="agent-filter-label">
          Agent
        </span>
        <details
          class="agent-picker"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
          onFocusOut={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              event.currentTarget.open = false;
            }
          }}
        >
          <summary aria-labelledby="agent-filter-label agent-filter-value">
            <span id="agent-filter-value">
              <AgentIdentity
                source={
                  sources.find((source) => source.id === sourceId) ?? {
                    id: "all",
                    name: "All agents",
                  }
                }
              />
            </span>
            <CaretDownIcon size={13} aria-hidden="true" />
          </summary>
          <div class="agent-options" role="group" aria-label="Filter sessions by agent">
            {[{ id: "", name: "All agents" }, ...sources].map((source) => (
              <button
                key={source.id}
                type="button"
                aria-pressed={sourceId === source.id}
                onClick={(event) => {
                  onSourceChange(source.id);
                  const picker = event.currentTarget.closest("details");
                  if (picker) {
                    picker.open = false;
                    picker.querySelector("summary")?.focus();
                  }
                }}
              >
                <AgentIdentity source={source.id ? source : { ...source, id: "all" }} />
                {sourceId === source.id && <CheckIcon size={14} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </details>
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
        showSource={!sourceId && sources.length > 1}
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
