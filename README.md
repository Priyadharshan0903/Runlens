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

| Flag | Meaning |
| --- | --- |
| `--dir <path>` | A Claude Code `projects` folder; repeatable. Default: `$CLAUDE_CONFIG_DIR/projects` and `~/.claude/projects`. |
| `--port <n>` | Preferred port, default `8740`; tries the next 10 ports if occupied. |
| `--no-open` | Print the URL without opening a browser. |

The package and CLI are named `runlens`. This repository is still private and is not published
to npm; use the local commands above.

## Session library

- **Transcript search** scans prompts, assistant text, recorded thinking, tool inputs and outputs,
  and subagent transcripts. Results include a matching excerpt. Two characters start a full-text
  search; one character still filters titles and local annotations. `Cmd/Ctrl + K` focuses search.
- **Project and date filters** narrow the library, with newest, oldest, or title sorting.
- **Pins** keep useful sessions in a separate library view.
- **Display names, tags, and notes** organize sessions without modifying their original files.
- **Pagination** loads the library in batches of 40 rows.

## Inspect a session

| View | What it shows |
| --- | --- |
| Timeline | Prompts, tool calls, outputs, recorded context, interruptions, and final answers. The activity strip jumps to a call and opens its collapsed ancestors. |
| Conversation | Prompts and final answers, with user interjections and compaction markers, without the tool-call stream. |
| Changes | File edits grouped by path, including subagent work. Expand a file for the recorded replacement blocks and tool results. |
| Agents | Subagent tasks, calls, outputs, durations, and background/stopped states. The inspector roster jumps to a run in the timeline. |
| Statistics | Recorded token usage, cache reads/writes, models, tool distribution, and file activity. |
| Failures | Calls whose tool results explicitly recorded an error, with links back to the timeline. |

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

The design uses a quiet frame, a flat session sheet, and teal on trace activity, with Geist for
text and Geist Mono for code and identifiers. The session trace is the main visual element.

## Data and privacy

- Everything stays on this machine. There are no model calls, uploads, analytics, or remote fonts.
- Transcript files are only read, never edited or deleted.
- Pins, display names, tags, notes, theme, and live-refresh preferences are saved in this browser's
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

## Develop

```sh
npm run typecheck
npm test
npm run dev
```

To run the core and feature checks without starting an HTTP test server:

```sh
npm test -- tests/core.test.ts tests/features.test.ts
```

Runtime dependencies: none. Requires Node 20+.

```text
src/core/parse.ts       transcript lines → events and recorded usage
src/core/tree.ts        events → turns, calls, notes, and compaction markers
src/core/session.ts     attaches subagents and deduplicates session-wide usage
src/core/discover.ts    cached discovery and library summaries
src/core/search.ts      full transcript and subagent search
src/server.ts          local read-only JSON API and static assets
ui/app.tsx             library, navigation, filters, and refresh lifecycle
ui/detail.tsx          session views, inspector, annotations, and exports
ui/session.tsx         reusable transcript and subagent components
ui/preferences.ts      browser-local annotations and theme preferences
ui/workspace.ts        shared session/file calculations and Markdown export
ui/styles.css          light/dark tokens and responsive workspace layout
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
