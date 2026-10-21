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

Without `--dir`, Runlens automatically combines existing Claude history from:

- `$CLAUDE_CONFIG_DIR/projects`, when the environment variable is set.
- `~/.claude/projects`.
- Each immediate account folder's `projects` directory under `~/.claude-accounts`.

Account names are discovered rather than hardcoded. No account-switcher folder is required.
Missing folders are skipped, paths pointing to the same directory are read once, and copied
sessions with the same ID are counted once. Newly created account folders are picked up on the
next start; sessions within the configured folders appear when the library refreshes.

To read only specific history folders, pass `--dir` (repeatable). Explicit folders replace automatic
discovery, so `npm start -- --dir ~/.claude/projects` intentionally reads only that history.
Only pass folders that exist. Options:

| Flag           | Meaning                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `--dir <path>` | Read only these Claude Code `projects` folders; repeatable. Without it, discover active config, default, and account history folders. |
| `--port <n>`   | Preferred port, default `8740`; tries the next 10 ports if occupied.                                                                  |
| `--no-open`    | Print the URL without opening a browser.                                                                                              |

Startup output lists every configured history folder. The standard folder is `~/.claude/projects`
(with the dot). Other custom locations outside the discovered account folders can be selected
through `--dir` or `CLAUDE_CONFIG_DIR`. The library footer exposes the read paths on hover. A
missing-session response lists those folders and explains how to include a different location.

If the library loads but individual chats stop opening after a rebuild, stop the existing Runlens
process and restart it with the same `--dir` options. A running process keeps its old backend code
even though rebuilding replaces its static UI files. The UI detects the pre-adapter response format
and explains the required restart instead of trying to render incompatible session data. Your
transcripts are not changed by rebuilding or restarting Runlens.

The package and CLI are named `runlens`. Downloadable builds are listed on
[GitHub Releases](https://github.com/Priyadharshan0903/Runlens/releases). Install the published
package with `npx runlens@latest`. The publish workflow releases the checked archive to npm and
GitHub automatically after verification.

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

## License and third-party notices

Runlens's own code uses the [MIT license](LICENSE), copyright 2026 Priyadharshan0903.
[Third-party notices](THIRD_PARTY_NOTICES.md) contain the original copyright statements and full
license texts for the bundled Preact, Phosphor Icons, Marked, Geist Sans, and Geist Mono packages.
Marked's additional Markdown notice is preserved. The fonts retain their SIL Open Font License.

Both files ship at the root of every newly built npm package and GitHub release archive. The build
regenerates third-party notices from the installed dependency versions; commit that generated file
when dependencies change. The package installation check verifies that both complete files are
present in the installed package. The notices acknowledge the authors through the distributed files
and this README link; they do not require a notification email or a UI prompt.

Archives uploaded before this change need to be rebuilt to include these files.

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

## Agent readers

Claude Code is the currently shipped adapter. Codex and Cursor readers are not included yet.
Adapters implement `SourceReader` in `src/sources/types.ts` and register in `src/sources/index.ts`.

```text
agent files → source adapter → common events → shared turns and steps → session features
```

`src/sources/claude` owns Claude discovery, JSONL parsing, tool meanings, usage deduplication,
and subagent linking. Shared code handles library merging, directory grouping, turn reconstruction,
search matching, and HTTP routes. UI features use normalized actions and file effects rather than
Claude tool names or input fields. Raw tool names and inputs remain available for inspection and
exports. Source names come from session data.

Existing Claude IDs remain unchanged, preserving session links and browser annotations. Other
adapters receive IDs prefixed with their source ID, so the same local session ID can occur in
different agents. Project grouping happens after sources are merged and uses the same directory
rules across agents. Search consumes each adapter's event iterator, stops on a match, and propagates
cancellation; readers close their file handles when iteration ends. Missing cost, token usage, and
reasoning remain absent rather than being estimated.

See [Adding a source adapter](docs/source-adapters.md) for the contract and extension steps.

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

The [FOG-65 code review](docs/code-review.md) records the historical project-filter behavior,
search/reader boundaries, direct tool-name assumptions, and Git state before grouping and adapter work.

```sh
npm run check       # formatting, types, core/feature tests, production build
npm run dev         # build and start the local viewer
```

To run the core and feature checks without starting an HTTP test server:

```sh
npm test -- tests/core.test.ts tests/features.test.ts tests/projects.test.ts tests/sources.test.ts
```

Runtime dependencies: none. Requires Node 20+.

## GitHub Actions

`.github/workflows/ci.yml` checks pushes to `master`, pull requests, and manual runs on Ubuntu
with Node 22 and 24. It installs the locked dependencies, checks formatting and types, runs the
complete test suite (including HTTP server tests), builds, and verifies a clean package installation.
The normal local `npm run check` continues to avoid starting a server.

The installation check packs the built files, installs the archive outside the checkout, runs the
installed `runlens --help` and `--version` commands, and checks the shipped UI and referenced fonts.
It also rejects transcript/environment filenames in the archive. This check does not open the UI,
read local sessions, or start a server. To run it after building:

```sh
npm run test:package
```

`.github/workflows/publish.yml` runs when a `v*` tag is pushed, or through **Actions → Publish
release → Run workflow**. It replaces the old draft-only `release.yml` workflow.

1. Check that a pushed version tag matches `package.json`, then run the full checks on Node 24.
2. Build, install-test, and retain the `.tgz` package and `SHA256SUMS`.
3. Verify the downloaded archive's checksum and publish that exact archive to npm using OIDC
   trusted publishing and provenance. Stable versions use `latest`; prereleases use `next`.
4. Publish the GitHub release immediately, with generated notes and the same archive/checksum
   attached. There is no draft or separate Publish button. Prereleases are marked accordingly.

Configure npm **runlens → Settings → Trusted Publisher → GitHub Actions** once, with owner
`Priyadharshan0903`, repository `Runlens`, and workflow filename `publish.yml`. Permit direct
`npm publish` if npm shows an allowed-actions setting. The workflow uses Node 24 and npm 11,
with `id-token: write` restricted to the npm publishing job; no npm token secret is needed.
See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

For each release, commit your changes first, then bump the package version and push its commit/tag:

```sh
npm version patch
git push origin master --follow-tags
```

For example, bumping `0.1.2` creates `0.1.3` and tag `v0.1.3`. `npm version` updates both
`package.json` and the lockfile. npm versions cannot be overwritten. Alternatively, update and
commit both files yourself, push the changes, and run the workflow manually on that commit.
The workflow publishes only when invoked by a version-tag push or a manual run; ordinary commits
continue to run CI without releasing.

GitHub publication waits for npm publication to succeed. If the final GitHub job fails after npm
succeeds, use **Re-run failed jobs** to retry that job without publishing the npm version again.
Do not rerun the whole successful npm publication for the same version. GitHub and npm are separate
services, so the workflow cannot roll back an npm publication if GitHub publication fails.

The workflows use pinned action commits. CI and packaging have read access; only the final GitHub
job gets release write access. Checked workflow artifacts are retained for 14 days; assets attached
to the published release remain available separately. Packaging files use the ignored `release/`
directory.

```text
src/
  core/                    common events, discovery, search, and turn reconstruction
    projects.ts            directory identities inferred from recorded working folders
  sources/
    types.ts               adapter contract and source folder configuration
    index.ts               registered agent readers
    claude/                Claude discovery, parsing, tool semantics, and subagent linking
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
  check-package.mjs        verifies an isolated package installation and writes release checksums
.github/workflows/
  ci.yml                   full checks and package verification on Node 22/24
  publish.yml              checked archive, npm trusted publishing, and direct GitHub release
docs/
  code-review.md           FOG-65 audit before project grouping and additional readers
  source-adapters.md       reader contract and steps for adding another agent
tests/                    core, feature, project, adapter, and HTTP server tests
```

The build writes generated files in place under `dist/`, so it also works when the output
directory cannot be removed. Existing backend processes must be restarted to pick up backend changes.

## Change log

### 2026-10-22 — Include account histories by default

- Changed default Claude discovery to include every existing `~/.claude-accounts/*/projects`
  folder alongside the active `CLAUDE_CONFIG_DIR` and `~/.claude/projects`. A plain `npm start`
  now combines these histories without requiring repeated flags.
- Follow account directory symlinks and deduplicate physical history folders. Skip absent,
  invalid, or inaccessible folders; retain session-ID deduplication across copied histories.
- Explicit `--dir` folders still replace defaults. Updated CLI help, recovery guidance, and
  setup documentation to describe automatic discovery and how to restrict it.
- Added regression coverage for all account names, standard-only installs, missing/invalid folders,
  active config precedence, directory symlinks, and copied sessions across account histories.
- Validation: `npm run check` passed formatting, TypeScript, 45 tests, and the production build.
  A read-only scan of the local histories found 96 displayable sessions across the three roots;
  two additional transcript files had no recognized user prompt and retained the existing exclusion.

### 2026-10-22 — Session loading compatibility and folder diagnostics

- Diagnosed a running pre-adapter backend serving rebuilt UI files. It still returned the user's
  session and history, but lacked the source/actions required by the new session view.
- Added an explicit restart message for the older response format, preserving navigation back
  to the library instead of rendering incompatible session data.
- Print each source's actual history paths at startup. Missing-session responses include the
  configured paths and `--dir`/`CLAUDE_CONFIG_DIR` guidance; error text preserves line breaks.
- Kept custom account folders explicit rather than scanning every account by default. Added
  recovery-message coverage to core tests and HTTP response assertions for CI.
- Validation: formatting, TypeScript, all 41 server-free tests, and the production build passed.
  The existing viewer was inspected read-only: it returned 96 sessions and the reported session's
  43 turns in the old format. Restarting that process and browser verification remain with the user.

### 2026-10-22 — Direct GitHub and npm releases

- Replaced the draft-only `release.yml` with `publish.yml`, matching the npm Trusted Publisher
  setup. Version-tag pushes and manual runs now check/package, publish to npm, and publish the
  GitHub release directly.
- Publish the verified archive rather than rebuilding it in the publishing job. Added checksum
  verification, npm OIDC authentication, provenance, and a matching tag/package version check.
- Stable releases use npm's `latest` tag; prereleases use `next` and GitHub's prerelease flag.
  npm publication must succeed before GitHub publication; permissions stay scoped to each job.
- Documented the one-time npm connection, normal release steps, and retrying a failed GitHub job
  after a successful npm publication. This change does not publish a release from the local machine.
- Validation passed workflow linting, stable/prerelease/tag-mismatch checks, formatting, TypeScript,
  40 server-free tests, the production build, and isolated package installation. Live npm OIDC
  authentication and GitHub publication will be verified by the first publishing run.

### 2026-10-22 — FOG-67 source adapters

- Added a typed reader contract and an explicit adapter registry. Moved Claude's discovery,
  parser, tool normalization, and subagent linking into `src/sources/claude`.
- Made discovery, session loading, and streaming search dispatch through the owning reader.
  Merge all sources before project inference; retain existing Claude IDs and namespace other sources.
- Replaced Claude tool-name and raw-input checks in session features with common actions, file
  effects, command/replacement details, and semantic icon names. No extra UI state or runtime
  dependency was introduced.
- Preserve raw tool inputs and recorded reasoning while leaving unavailable metadata absent.
  The source label is supplied by the reader; the shipped source remains Claude Code.
- Added a fake second reader using JSON documents and unrelated tool names to verify mixed-source
  IDs, project grouping, file changes, failures, optional metadata, search, and cancellation.
- Added `tests/sources.test.ts` to the server-free `npm run check` command and documented how to
  add another adapter in `docs/source-adapters.md`. Browser verification remains with the user.
- Validation: `npm run check` passed formatting, TypeScript, all 40 core/feature/project/adapter
  tests, and the production build. HTTP and browser checks were not run locally.

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

### 2026-10-21 — GitHub checks and draft releases

- Added CI for pushes to `master`, pull requests, and manual runs on Node 22/24. CI runs formatting,
  types, the full test suite, production build, and installation checks against the packed archive.
- Added a manual release workflow that repeats verification on Node 24, retains checked artifacts,
  and creates a draft GitHub release with generated notes, the package, and its SHA-256 checksum.
- Pinned action commits and limited release write permissions to the final draft job. npm publishing
  stays disabled; the workflow uses GitHub's built-in token.
- Added `check:ci` for the full suite and `test:package` for isolated installation, installed CLI
  checks, UI/font assets, and archive filename checks. Local `check` retains its server-free behavior.
- The installation check uses a temporary cache and removes its temporary installation on completion.
  Release archives are kept only when an output directory is requested.
- Local validation passed workflow linting with actionlint, formatting, types, 32 core/feature/project
  tests, the build, and isolated installation checks. GitHub-hosted Node 22/24 runs and the full
  HTTP test suite remain to be exercised after the workflows are pushed.

### 2026-10-21 — MIT license and bundled dependency notices

- Removed the package's private flag and added MIT license metadata, repository, homepage, and issue
  tracker links. Added the project license and updated the lockfile's root license metadata.
- Generate `THIRD_PARTY_NOTICES.md` during each build from the exact installed Preact, Phosphor,
  Marked, Geist Sans, and Geist Mono versions, preserving their complete supplied license files.
- Included both license files explicitly in the package and documented the credits in README.
  Package installation verification checks that the full files reach users unchanged.
- The generated notices cover bundled code/fonts; build-only development tools are not distributed
  in the package. Existing uploaded archives need rebuilding to include the notices.
