import {
  ArrowLeftIcon,
  ListIcon,
  MagnifyingGlassIcon,
  SidebarSimpleIcon,
} from "@phosphor-icons/react";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { SessionPage } from "../features/session/session-page.js";
import { projectName } from "../shared/format.js";
import { Library, type SessionLibrary } from "../features/library/library.js";
import { usePreferences } from "../shared/use-preferences.js";
import { useResource } from "../shared/use-resource.js";
import { Sidebar } from "./sidebar.js";

// The URL owns navigation. Filters belong to Library; fetched session data belongs to SessionPage.
type Route = { page: "library"; scope: "all" | "pinned" } | { page: "session"; id: string };
type LayoutMode = "default" | "navigation" | "focus";

function readRoute(): Route {
  const sessionId = location.hash.match(/^#\/s\/([\w-]+)/)?.[1];

  if (sessionId) return { page: "session", id: sessionId };
  return { page: "library", scope: location.hash === "#/pinned" ? "pinned" : "all" };
}

function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("default");
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const mainContent = useRef<HTMLElement>(null);
  const { preferences, storageError, updateMeta, setTheme, setLive, toggleSidebar } =
    usePreferences();
  const library = useResource<SessionLibrary>("/api/sessions", {
    pollInterval: preferences.live ? 15_000 : 0,
  });

  const selectedId = route.page === "session" ? route.id : undefined;
  const scope = route.page === "library" ? route.scope : "all";
  const sessions = library.data?.sessions ?? [];
  const selectedSummary = sessions.find((session) => session.id === selectedId);
  const navigationOpen = layoutMode === "navigation";
  const focusMode = layoutMode === "focus";

  useEffect(() => {
    function handleNavigation() {
      setRoute(readRoute());
      setLayoutMode("default");
      mainContent.current?.scrollTo(0, 0);
    }

    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        location.hash = "#/";
        searchInput.current?.focus();
      }
      if (event.key === "Escape") setLayoutMode("default");
    }

    addEventListener("hashchange", handleNavigation);
    addEventListener("keydown", handleShortcut);

    return () => {
      removeEventListener("hashchange", handleNavigation);
      removeEventListener("keydown", handleShortcut);
    };
  }, []);

  function searchLibrary(value: string) {
    setQuery(value);
    if (route.page === "session") location.hash = "#/";
  }

  function togglePin(id: string) {
    updateMeta(id, { pinned: !preferences.sessions[id]?.pinned });
  }

  return (
    <>
      <a
        class="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          mainContent.current?.focus();
        }}
      >
        Skip to content
      </a>
      <div
        class={`layout ${selectedId ? "has-session" : ""} ${focusMode ? "focus-mode" : ""} ${navigationOpen ? "menu-open" : ""} ${preferences.sidebarCollapsed ? "sidebar-collapsed" : ""}`}
      >
        {navigationOpen && (
          <button
            class="menu-scrim"
            aria-label="Close navigation"
            onClick={() => setLayoutMode("default")}
          />
        )}
        <Sidebar
          sessions={sessions}
          annotations={preferences.sessions}
          selectedId={selectedId}
          scope={scope}
          theme={preferences.theme}
          onThemeChange={setTheme}
          onRefresh={library.refresh}
          onNavigate={() => setLayoutMode("default")}
        />

        <div class="workspace">
          <header class="topbar">
            <button
              class="icon-button sidebar-toggle"
              onClick={toggleSidebar}
              aria-label={preferences.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={preferences.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!preferences.sidebarCollapsed}
              aria-controls="workspace-sidebar"
            >
              <SidebarSimpleIcon size={20} />
            </button>
            <button
              class="icon-button mobile-menu"
              onClick={() => setLayoutMode(navigationOpen ? "default" : "navigation")}
              aria-label={navigationOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={navigationOpen}
              aria-controls="workspace-sidebar"
            >
              <ListIcon size={20} />
            </button>
            <div class="breadcrumb">
              {selectedId ? (
                <>
                  <a href="#/" aria-label="Back to all sessions">
                    <ArrowLeftIcon size={15} />
                    Sessions
                  </a>
                  <span>/</span>
                  <span class="crumb-current">{projectName(selectedSummary?.cwd)}</span>
                </>
              ) : (
                <>
                  <span>Workspace</span>
                  <span>/</span>
                  <span class="crumb-current">
                    {scope === "pinned" ? "Pinned sessions" : "All sessions"}
                  </span>
                </>
              )}
            </div>
            <label class="global-search">
              <MagnifyingGlassIcon size={16} />
              <input
                ref={searchInput}
                type="search"
                aria-label="Search all transcripts"
                placeholder="Search transcripts, tools, or files…"
                value={query}
                onInput={(event) => searchLibrary(event.currentTarget.value)}
              />
              <kbd>⌘ K</kbd>
            </label>
            <span class="local-status">
              <span />
              Local only
            </span>
          </header>

          <main class="main" id="main-content" tabIndex={-1} ref={mainContent}>
            {storageError && (
              <p class="inline-notice" role="status">
                Browser storage is unavailable. Notes and preferences will last for this visit.
              </p>
            )}
            {route.page === "library" ? (
              <Library
                library={library}
                query={query}
                scope={route.scope}
                annotations={preferences.sessions}
                onQueryChange={setQuery}
                onRefresh={library.refresh}
                onPin={togglePin}
              />
            ) : (
              <SessionPage
                key={route.id}
                sessionId={route.id}
                meta={preferences.sessions[route.id] ?? {}}
                onMetaChange={updateMeta}
                live={preferences.live}
                onLive={setLive}
                focus={focusMode}
                onFocus={() => setLayoutMode(focusMode ? "default" : "focus")}
                storageError={storageError}
              />
            )}
          </main>
        </div>
      </div>
    </>
  );
}

render(<App />, document.getElementById("app")!);
