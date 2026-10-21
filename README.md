# Runlens

A private workspace for inspecting Claude Code sessions, tool calls, file changes, and subagents.

Browse your local history, find a particular tool result, inspect a failed call, or follow a
subagent into its own work. Runlens reads the transcripts already on your machine. It does not
call a model or require an API key.

## Run it

```sh
npm install
npm run build
npm start
```

Open the URL printed in your terminal. The default is `http://127.0.0.1:8740/`.
If another viewer is already running there, the CLI tries the next available port. To load this
version's new backend features, start a new process after building; refreshing a page does not
replace an older running backend.

For multiple Claude Code accounts:

```sh
npm start -- --dir ~/.claude-accounts/personal/projects --dir ~/.claude-accounts/work/projects --dir ~/.claude/projects
```

Only pass folders that exist. Options:

| Flag           | Meaning                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| `--dir <path>` | A Claude Code `projects` folder; repeatable. Default: `$CLAUDE_CONFIG_DIR/projects` and `~/.claude/projects`. |
| `--port <n>`   | Preferred port, default `8740`; tries the next 10 ports if occupied.                                          |
| `--no-open`    | Print the URL without opening a browser.                                                                      |

The package and CLI are named `runlens`. This repository is still private and is not published
to npm; use the local commands above.

## Session library

- **Transcript search** scans prompts, assistant text, recorded thinking, tool inputs and outputs,
  and subagent transcripts. Results include a matching excerpt. Two characters start a full-text
  search; one character still filters titles and local annotations. `Cmd/Ctrl + K` focuses search.
- **Project and date filters** narrow the library, with newest, oldest, or title sorting. The
  project filter uses the same inferred folders as sidebar navigation, including subfolder sessions.
- **Pins** keep useful sessions in a separate library view.
- **Display names, tags, and notes** organize sessions without modifying their original files.
- **Pagination** loads the library in batches of 40 rows.

Navigation defaults to **By project**, with a saved **By date** option. Projects and their sessions
are ordered by most recent activity. The three most recent projects start open; each shows five
sessions with a “Show more” action. The selected session remains visible even when it is older than
the initial five. Each group has a compact folder header with its session count and latest activity.
Folders with identical names show the shortest distinguishing parent path, such as `work/apps` or
`personal/apps`; the full path is available on hover and in the accessible label. Session rows are
indented under their folder and show their title and time without repeating the project name.
Missing project folders show “Folder removed.”

Project boundaries come from session history, without Git detection. If working directories include
both `/work/demo` and `/work/demo/src`, those sessions belong to `/work/demo`. The full normalized
path identifies the project, so `/personal/demo` stays separate. Runlens uses the highest recorded
ancestor; it does not guess an unrecorded project root. If only `demo/src` and `demo/tests` appear,
they remain separate until a session records `demo`. Home, unknown, and filesystem-root sessions
share “Home / no project” and cannot absorb other projects. A newly recorded ancestor can change
existing inferred groups when the library refreshes. Git repositories, nested repositories, and
worktrees follow this same directory rule.

Global search covers every project and filters the sidebar and library through one shared search
request. Matching project groups open while searching; clearing search restores manual expansion
choices. Library-specific project, date, and pin filters do not narrow the sidebar. Search requests
pause while viewing a session, where the sidebar returns to the full library.

## Inspect a session

| View         | What it shows                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timeline     | Prompts, tool calls, outputs, recorded context, interruptions, and final answers. The activity strip jumps to a call and opens its collapsed ancestors. |
| Conversation | Prompts and final answers, with user interjections and compaction markers, without the tool-call stream.                                                |
| Changes      | File edits grouped by path, including subagent work. Expand a file for the recorded replacement blocks and tool results.                                |
| Agents       | Subagent tasks, calls, outputs, durations, and background/stopped states. The inspector roster jumps to a run in the timeline.                          |
| Statistics   | Recorded token usage, cache reads/writes, models, tool distribution, and file activity.                                                                 |
| Failures     | Calls whose tool results explicitly recorded an error, with links back to the timeline.                                                                 |

In Timeline and Conversation, each turn pairs your question on the left with the agent's work on
the right. The question stays visible while reading a long response. Collapsing agent work does not
collapse the question. Panes narrower than 700 px stack question above response, using the available
reading width rather than the window width. Session metadata and notes stay in the right inspector.

Search inside a session, expand or collapse tool details, copy the session ID, and export
Markdown or JSON. JSON exports include your session annotations; Markdown exports include your notes.

**Live refresh** polls the selected session every 5 seconds and the library every 15 seconds.
It keeps the existing transcript on screen while refreshing, pauses polling when the browser tab
is hidden, and avoids overlapping requests for the selected session. It is polling, not streaming.

**Focus mode** hides navigation and the inspector. Press `Escape` to leave it.

## Appearance

Light, dark, and system themes are available at the bottom of navigation. The saved preference is
applied before the first paint; system mode follows operating-system changes. Fonts are bundled
locally. The layout moves navigation and the session inspector into dismissible panels on smaller
screens. Tabs support arrow keys, Home, and End. Reduced-motion preferences are respected.

On desktop, the sidebar button beside the breadcrumb collapses or expands navigation and gives
the session more reading space. That choice is saved across navigation and reloads. Smaller screens
keep their own menu drawer, independent of the desktop preference.

The design uses a quiet frame, a flat session sheet, and teal on trace activity, with Geist for
text and Geist Mono for code and identifiers. The session trace is the main visual element.

## Data and privacy

- Everything stays on this machine. There are no model calls, uploads, analytics, or remote fonts.
- Transcript files are only read, never edited or deleted.
- Pins, display names, tags, notes, theme, sidebar visibility/grouping, and live-refresh preferences are saved in this browser's
  local storage under `runlens.workspace.v1`. They are specific to the browser and port; clearing
  site data removes them. Export JSON to keep a copy of an annotated session.
- The server binds to `127.0.0.1`, checks the request hostname, and only opens discovered transcripts.
- Search is performed on the server with a bounded in-memory result cache, without a persistent
  transcript index or database. A first search across a large history can take time.
- Tool outputs in the session view and exports are capped at 20,000 characters per call. Global
  transcript search scans the original text, including text beyond that display limit.

Transcripts and exports can include source code, command output, and secrets printed by tools.

## What the numbers mean

- Token usage comes from recorded assistant-message usage fields. Repeated content blocks,
  streaming snapshots, and fork-replayed messages with the same message ID are counted once,
  using the largest recorded value of each token field. Missing usage is shown as a dash.
- Token totals include input, output, cache reads, and cache writes. They measure recorded work,
  not the context size of a single request. Models and token totals include subagents.
- Cost is displayed only when the transcript records it. Runlens does not invent a price estimate.
- File line counts describe successful recorded replacement blocks. They are not a net Git diff;
  repeated edits and `replace_all` mean they can differ from final repository changes. Failed edits
  stay visible as attempts but do not increase successful replacement counts.
- The text before a tool call is the agent's recorded context, not independently verified intent.
  A tool result without an error does not establish that the overall task succeeded.
- Elapsed session duration includes idle time between messages.
- Compaction markers are displayed when recorded. Reconstructing missing history across separate
  fork/resume chains is not implemented. This version does not claim full Recensa feature parity.

Claude Code's transcript format is not a documented API and can change. Tests use synthetic
transcripts; coverage of the format is not a guarantee that every historical session will parse.

## Code structure and state ownership

The UI uses Preact and follows the same state model as React: store user choices and external
results, then derive what the screen displays. A smaller state count alone is not a design goal;
clear ownership and consistent transitions are.

| Owner                                        | Responsibility                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ui/app/app.tsx`                             | URL navigation, workspace layout, and the search input shared by the toolbar and library.            |
| `ui/features/library/library.tsx`            | Library project/date filters and sorting; each result set owns its pagination.                       |
| `ui/features/library/session-navigation.tsx` | Project expansion and row limits; grouping follows the saved preference.                             |
| `ui/features/library/use-session-search.ts`  | One transcript search request, enabled on the library route and shared with navigation.              |
| `ui/features/session/session-page.tsx`       | The selected session request and session-view navigation. Changing session identity resets its view. |
| `ui/features/session/inspector.tsx`          | A local notes draft and clipboard feedback. Notes persist after a 400 ms pause or on blur.           |
| `ui/shared/use-resource.ts`                  | One request snapshot, cancellation, debounce, refresh, and optional polling.                         |
| `ui/shared/use-preferences.ts`               | Browser-local annotations and preferences, with stable update callbacks.                             |

Counts, matching rows, agent rosters, and file summaries are derived from source data. Expensive
session summaries are memoized per loaded transcript. Tool inputs are indexed only when an
in-session search is active. File diff bodies render only when their file is expanded.
Timers, abort controllers, and DOM nodes use refs rather than render state. Effects handle external
systems; filters and tab changes do not need effects to reset other state.

Prettier enforces multiline formatting, and TypeScript rejects unused locals and parameters.
`AGENTS.md` records these conventions for future contributions.

## Develop

The [FOG-65 code review](docs/code-review.md) records the current project-filter behavior,
search/reader boundaries, direct tool-name assumptions, and Git state before grouping work.

```sh
npm run check       # formatting, types, core/feature tests, production build
npm run dev         # build and start the local viewer
```

To run the core and feature checks without starting an HTTP test server:

```sh
npm test -- tests/core.test.ts tests/features.test.ts tests/projects.test.ts
```

Runtime dependencies: none. Requires Node 20+.

```text
src/
  core/                    transcript parsing, discovery, search, and reconstruction
    projects.ts            directory identities inferred from recorded working folders
  server.ts                local read-only JSON API and static assets
  cli.ts                   command-line entry point
ui/
  main.tsx                 browser entry point
  index.html               HTML shell and initial theme
  app/
    app.tsx                workspace shell and URL navigation
    sidebar.tsx            recent sessions and theme controls
  features/
    library/
      library.tsx          session filters, search, and pagination
      session-list.ts      shared project grouping and session matching
      session-navigation.tsx project/date navigation and expansion choices
      use-session-search.ts shared transcript-search request
    session/
      session-page.tsx     selected-session request and view navigation
      transcript.tsx       paired human/agent turns and tool disclosures
      session-views.tsx    conversation, changes, agents, statistics, and activity
      inspector.tsx       notes editor and session details
      session-data.ts     shared session calculations and Markdown export
  shared/
    use-resource.ts        GET request lifecycle
    use-preferences.ts     browser-local annotations and preferences
    icons.tsx              tool and status icon mappings
    brand.tsx              Runlens mark
    format.ts              display formatting
    markdown.ts            safe transcript Markdown rendering
  styles/
    index.css              stylesheet entry point
    base.css               fonts, themes, resets, and shared controls
    workspace.css          navigation and workspace shell
    library.css            session library
    session.css            session header, views, and inspector
    transcript.css         human/agent turns and tool details
    responsive.css         tablet and phone layout
scripts/
  build.mjs                bundles the server, UI, and local styles
docs/
  code-review.md           FOG-65 audit before project grouping and additional readers
tests/                    core, feature, and HTTP server tests
```

The build writes generated files in place under `dist/`, so it also works when the output
directory cannot be removed. Existing backend processes must be restarted to pick up backend changes.

## Change log

### 2026-10-21 — Runlens workspace redesign

- Renamed the product, package, CLI, page metadata, favicon, exports, and test temp folders to Runlens.
- Rebuilt the UI as a session library and detail workspace with a persistent inspector and focus mode.
- Added persistent light, dark, and system themes with local fonts and no theme flash on initial load.
- Added transcript/subagent search, excerpts, project/date filters, sorting, and 40-row batches.
- Added browser-local pins, display names, tags, and notes, and Markdown/JSON exports.
- Added conversation, grouped file changes, agents, statistics, and failure views.
- Added token/cache/model accounting with duplicate-message handling, and compaction markers.
- Added opt-in live polling with request cancellation, stale-data handling, and hidden-tab pauses.
- Fixed zero-cost formatting, discovery of whitespace-formatted JSON, and stale subagent counts.
- Fixed pending read groups being marked successful and improved repeated/nested call navigation.
- Changed builds to update assets in place instead of deleting the output directory.
- Validation: type checking, production build, and 21 core/feature tests passed. Static design lint
  reported zero failures. Browser screenshots, visual QA, live polling, and end-to-end interaction
  checks are deferred to the user's local run, as requested. HTTP server tests were not run in this
  pass to avoid starting a server.
- Design direction: framed-sheet, seed `1188489699`, no redraws. The existing Geist type system is
  retained; the light frame uses a subtle teal tint and the dark frame uses neutral gray. No demo
  sessions or invented usage figures are included.

### 2026-10-21 — Readability and state ownership refactor

- Replaced the shell's 21 separate state declarations with three user-facing choices: navigation,
  layout mode, and shared search input. Requests and preferences remain in their own hooks.
- Moved library filters/pagination, session navigation, and editor drafts to their respective owners.
- Consolidated GET lifecycle into one request hook; removed retry counters, duplicated request flags,
  separate root/summary state, and effects used only to reset pagination.
- Search no longer restarts on library polling and does not run behind the session detail page.
- Superseded searches cancel their server-side file scan as well as the browser request.
- Reused one flattened call list for file summaries; derived agent/error/tool summaries once per
  loaded session. Tool input serialization is deferred until in-session search is used.
- Kept note keystrokes inside the inspector, debounced persistence, and skipped unchanged preferences.
- Deferred large file diff bodies until expansion and removed expansion/navigation version counters.
- Formatted source, tests, styles, and documentation with Prettier. Added strict unused-symbol checks
  and the single `npm run check` entry point; `AGENTS.md` documents contribution expectations.
- Added regression coverage for cancelled searches and consistent derived session summaries.

### 2026-10-21 — Paired turns, supported icons, and feature folders

- Replaced deprecated Phosphor aliases throughout the UI with supported `*Icon` exports, including
  `MagnifyingGlassIcon`. Pinned the existing icon package to version 2.1.10; no library replacement
  or additional dependency was needed.
- Organized the UI into `app`, `features/library`, `features/session`, and `shared`. Updated all
  imports and the state-ownership guide; the backend remains in its existing `src/core` structure.
- Split styles into base, workspace, library, session, transcript, and responsive files. The build
  bundles them into the same `styles.css` URL, so the server and HTML paths stay compatible.
- Paired human questions on the left with agent responses/activity on the right in Timeline and
  Conversation. Questions remain visible when agent content collapses, and the question column
  stays in view while reading a long response.
- Used a container query to stack the columns when the actual reading pane is narrower than 700 px.
  Kept subagent expansion, tool-call navigation, notes, and the right inspector intact.
- Verification uses the existing combined check; browser and visual verification remain with the user.

### 2026-10-21 — Collapsible workspace sidebar

- Added an accessible desktop sidebar toggle beside the breadcrumb. Collapsing navigation gives
  its width back to the workspace; the button remains available to expand it.
- Saved the desktop choice in the existing preferences hook, without adding shell state or
  dependencies. It survives route changes and reloads; mobile navigation and focus mode stay separate.
- Preserved the configured Claude session folders. Foglio tasks were read for discussion only.
- Verification uses `npm run check`; browser and visual verification remain with the user.

### 2026-10-21 — FOG-65 review and FOG-66 directory grouping

- Recorded the existing project filters, search/reader boundaries, six files with direct tool-name
  assumptions, and Git state in `docs/code-review.md`.
- Added directory-based project metadata during discovery, independently of cached transcript
  summaries. Groups use full paths and the highest ancestor recorded in session history; Git does
  not influence grouping. Home and filesystem-root sessions cannot swallow other groups.
- Added project/date navigation, activity ordering, counts, folder status, three initially open
  groups, five-session batches, and access to older selected sessions. The grouping preference is
  saved; manual expansion choices survive search and switching grouping modes during the visit.
- Shared one transcript search between sidebar and library. The existing project filter, project
  count, table labels, and breadcrumb use the same project metadata.
- Added focused directory-inference, collision, missing-folder refresh, ordering, and search tests
  to `npm run check`. Existing Claude source folders and transcript reconstruction are unchanged.
- Validation: formatting, type checking, all 31 core/feature/project tests, and the production build
  passed. FOG-65 and FOG-66 were marked done in Foglio with the agreed directory-grouping decisions.
- Browser and visual verification remain with the user. Restart the backend after building to
  load the new project metadata; an older server falls back to its recorded folder labels.

### 2026-10-21 — Clearer project navigation

- Replaced repeated full-path and “Last activity” rows with a compact folder header, count, and time.
- Show parent directory context only when folder names collide, expanding it just enough to
  distinguish each path. Full paths remain in tooltips and accessible labels.
- Indented project sessions with a quiet connecting rule and removed their repeated project names.
  Kept date navigation's layout, grouping behavior, and existing expansion choices.
- Aligned chevrons, folder icons, names, and counts on the same grid row. Timestamps and directory
  context sit directly under the name, without pulling the icons down between the two lines.
- Added regression coverage for duplicate-name directory labels; no extra state or dependency was
  needed. Browser and visual verification remain with the user.
