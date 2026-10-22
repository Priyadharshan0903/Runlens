# Developing Runlens

## Agent readers

Claude Code and Codex adapters are included. Cursor is not included yet.
Adapters implement `SourceReader` in `src/sources/types.ts` and register in `src/sources/index.ts`.

```text
agent files → source adapter → common events → shared turns and steps → session features
```

`src/sources/claude` owns Claude discovery, JSONL parsing, tool meanings, usage deduplication,
and subagent linking. Shared code handles library merging, directory grouping, turn reconstruction,
search matching, and HTTP routes. UI features use normalized actions and file effects rather than
Claude tool names or input fields. Raw tool names and inputs remain available for inspection and
exports. Source names come from session data.

`src/sources/codex` owns rollout discovery, canonical response-item decoding, concrete completed tool
activity, cumulative usage, and recorded child-thread relationships. Both readers share the small
JSONL stream in `src/sources/jsonl.ts`; their record semantics remain separate.

Existing Claude IDs remain unchanged, preserving session links and browser annotations. Other
adapters receive IDs prefixed with their source ID, so the same local session ID can occur in
different agents. Project grouping happens after sources are merged and uses the same directory
rules across agents. Search consumes each adapter's event iterator, stops on a match, and propagates
cancellation; readers close their file handles when iteration ends. Missing cost, token usage, and
reasoning remain absent rather than being estimated.

See [Adding a source adapter](source-adapters.md) for the contract and extension steps.

## Code structure and state ownership

The UI uses Preact and follows the same state model as React: store user choices and external
results, then derive what the screen displays. A smaller state count alone is not a design goal;
clear ownership and consistent transitions are.

| Owner                                            | Responsibility                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `ui/app/app.tsx`                                 | URL navigation, workspace layout, agent scope, and shared search input.                                   |
| `ui/features/library/library.tsx`                | Library project/date filters and sorting; each result set owns its pagination.                            |
| `ui/features/library/session-navigation.tsx`     | Project expansion and row limits; grouping follows the saved preference.                                  |
| `ui/features/library/use-session-search.ts`      | One transcript search request, enabled on the library route and shared with navigation.                   |
| `ui/features/session/session-page.tsx`           | The selected session request and session-view navigation. Changing session identity resets its view.      |
| `ui/features/session/inspector.tsx`              | A local notes draft and clipboard feedback. Notes persist after a 400 ms pause or on blur.                |
| `ui/features/session/session-scroll-control.tsx` | The page's jump direction, measured from the scroll container. Scroll updates stay inside this component. |
| `ui/shared/use-resource.ts`                      | One request snapshot, cancellation, debounce, refresh, and optional polling.                              |
| `ui/shared/use-preferences.ts`                   | Browser-local annotations and preferences, with stable update callbacks.                                  |

Counts, matching rows, agent rosters, and file summaries are derived from source data. Expensive
session summaries are memoized per loaded transcript. Tool inputs are indexed only when an
in-session search is active. File diff bodies render only when their file is expanded.
Timers, abort controllers, and DOM nodes use refs rather than render state. Effects handle external
systems; filters and tab changes do not need effects to reset other state.

Prettier enforces multiline formatting, and TypeScript rejects unused locals and parameters.
[`AGENTS.md`](../AGENTS.md) records these conventions for future contributions.

## Develop

The interface targets laptop and desktop users. Prioritize session reading, keyboard navigation,
and light/dark themes at those sizes. Existing responsive layouts remain available; phone-specific
polish is outside the current release criteria.

```sh
npm run check       # formatting, types, core/feature tests, production build
npm run dev         # build and start the local viewer
```

To run the core and feature checks without starting an HTTP test server:

```sh
npm test -- tests/core.test.ts tests/features.test.ts tests/projects.test.ts tests/sources.test.ts tests/codex.test.ts
```

Runtime dependencies: none. Requires Node 20+.

The MCP source preview lives in `src/mcp/`: `safety.ts` owns project grants, masking and byte
limits; `history.ts` projects normalized reader events; `server.ts` exposes the two stdio tools.
Do not route MCP through the viewer's broad transcript search, which includes raw tool content.
The official server SDK, shared core and Zod are bundled into the CLI and their licenses into
the notices. The client SDK is a development dependency for synthetic protocol checks. Discovery
and streaming readers accept cancellation signals. `npm run check` includes the MCP contract and
protocol tests without starting an HTTP server; protocol tests build their own temporary CLI.
See [MCP setup](mcp.md) for scopes, response limits and client verification boundaries.
MCP initialization instructions identify the configured default project and explain when to search,
how to inspect a result, and why changing the client's folder cannot change startup access. Keep
tool descriptions consistent with that behavior; protocol tests check the guidance clients receive.

The public landing page is a separate static site in `website/`. Use `npm run site:preview`
for port 8741 or `npm run site:build` for `website-dist/`. It is not bundled into the CLI.
See [website development](website.md) for content, preview behavior, and manual GitHub Pages deployment.

## Directory map

```text
src/
  core/                    common events, discovery, search, and turn reconstruction
    projects.ts            directory identities inferred from recorded working folders
  sources/
    types.ts               adapter contract and source folder configuration
    index.ts               registered agent readers
    claude/                Claude discovery, parsing, tool semantics, and subagent linking
    codex/                 Codex rollout discovery, parsing, tool activity, and child-thread linking
    jsonl.ts               cancellable JSONL stream shared by source readers
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
      session-scroll-control.tsx one contextual jump button for the session scroll container
      transcript.tsx       paired human/agent turns and tool disclosures
      session-views.tsx    conversation, changes, agents, statistics, and activity
      inspector.tsx       notes editor and session details
      session-data.ts     shared session calculations and Markdown export
  shared/
    use-resource.ts        GET request lifecycle
    use-preferences.ts     browser-local annotations and preferences
    icons.tsx              tool and status icon mappings
    brand.tsx              Runlens agent mark, using the same SVG as the favicon
    agent-identity.tsx     shared agent logos and readable source labels
    format.ts              display formatting
    markdown.ts            safe transcript Markdown rendering
  assets/
    runlens.svg            monochrome Runlens icon; adapts to the embedding colour scheme
    brands/                vendored agent marks and their license
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
  deploy-pages.yml         manually triggered website checks, build, and GitHub Pages deployment
docs/
  usage.md                setup, navigation, privacy, and measurement details
  development.md          code layout and contribution conventions
  releases.md             CI, publishing, and trusted-publisher setup
  source-adapters.md       reader contract and steps for adding another agent
  codex-sessions.md        supported Codex records, usage scope, and navigation decisions
  screenshots/            documented demo UI captures in both themes
CHANGELOG.md               implementation history
tests/                    core, feature, project, adapter, and HTTP server tests
```

The build writes generated files in place under `dist/`, so it also works when the output
directory cannot be removed. Existing backend processes must be restarted to pick up backend changes.
