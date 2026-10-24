# Changelog

### 2026-10-24 — Previous and next chats

- Add Previous/Next links and a position count beside the project breadcrumb in the fixed top bar.
  Browse the current project's full chat history in newest-first order, respecting the agent scope.
  Include sessions beyond the sidebar and library page limits; disable navigation at the ends.
- Show destination titles, including browser-local renames, in hover text and accessible names.
  Keep controls available during scrolling, loading and session errors, with native link keyboard
  navigation and compact arrow controls on narrow screens.
- Add regressions for project identity, grouped subfolders, source scope, empty/single sessions,
  boundaries, stable ordering and navigation beyond 40 sessions. Browser verification remains with
  the user, as requested in `AGENTS.md`.

### 2026-10-24 — Matching-turn retrieval and large-session recovery

- Add optional `include_turns` to search: return the first matching question, recorded answer
  and bounded successful-change/failure facts together. Keep excerpt-only search as the default.
- Add a summary `query` for matching turns in recorded order, including hits beyond excerpt caps.
  Default summaries to ten turns and allow up to fifty, still within the 16 KiB response cap.
  Bind cursors to search detail and summary query options.
- Exclude IDE opened-file boilerplate from MCP prompt excerpts and matching. Keep raw tool/web
  payloads, thinking and secrets outside searchable/returned history.
- Stream large Claude/Codex transcripts with raw-byte checkpoints and retained decoder state;
  preserve the 32 MiB/50,000-event per-call budgets without discarding whole oversized files.
  Skip individual records over 8 MiB and continue, with explicit partial-coverage diagnostics.
- Bound retained turn and parent projections to 8 MiB. Report omitted turn groups and skip forks
  without complete parent evidence. Retain the legacy file-size cap for adapters without checkpoints.
- Add mixed-agent retrieval, filtered/default paging, 110-call turns, raw-byte/UTF-8 boundaries,
  oversized-record recovery, parent isolation and real MCP-client contract regressions. Compare
  synthetic response bytes without claiming measured token or monetary savings.
- Validation: all 160 server-free tests, types and the production build pass. Repository formatting
  passes with the pre-existing `.claude/settings.local.json` formatting issue excluded; that personal
  file remains untouched and still prevents the unmodified `npm run check` command from finishing.

### 2026-10-23 — Queued MCP scans, cursor lifetimes and path identity

- Match startup grants, tool projects and recorded working directories by on-disk identity
  (`realpathSync.native`). A differently cased `--project`, such as `~/desktop/projects` on macOS,
  previously matched no sessions while reporting a complete, non-partial result.
- Replace the single-call `busy` guard with an in-process FIFO limiter: two scans run at once,
  eight wait, and overflow or a queue deadline returns `busy`. No external queue is required.
- Expire unused cursors after two minutes and whole walks ten minutes after their first page.
  Keep at most eight live cursors, evicting the oldest. Keep consumed cursors for a one-minute
  retry outside that cap, and share an in-flight page between duplicate resumes.
- Point expired-cursor errors at resuming with `offset` set to the last `next_offset`.
- Return `scope_warning` when the granted project holds no recorded sessions, and say so in
  `session_not_found`, so an empty scope no longer reads as "no prior work".
- Count skips beyond the four per-page details in `skipped_omitted`.
- Omit an entry too large for any page as `omitted_oversized` instead of closing the scan.
- Explain cursor-plus-offset requests directly, and state in the search tool description that each
  result is one session with its first matching message.
- Add regressions for grant identity (symlink, letter case, unrecorded parents), queue order and
  bounds, waiter cancellation and deadlines, idle and maximum cursor age, replay retention,
  live-cursor eviction, concurrent resumes, empty scopes, omitted skip details, oversized entries
  and page-request errors.

### 2026-10-22 — Resumable MCP history scans

- Add scoped, expiring search and summary cursors that preserve reader/decoder positions, avoid
  rescanning earlier pages, and support retrying consumed cursors. Keep legacy offsets available.
- Stop search when a page fills. Return collected results and continuations at total-byte and
  event-budget boundaries, including empty partial pages, with explicit reasons and scan progress.
- Report oversized transcripts as skips and continue through other sessions or child files.
  Skip forks without available parent evidence rather than counting inherited records as new work.
- Stream completed summary turns, retain unfinished turns across budget boundaries, and preserve
  late tool results across prompt boundaries. Retain entries trimmed by the response-byte cap.
- Bound cursor retention and release readers on expiry, eviction, cancellation and connection close.
  Document cursor lifetimes, skip coverage, per-call budgets and unchanged discovery limitations.
- Add regressions for oversized transcripts between matches, both exhausted scan budgets, cursor
  scope/retries/expiry/cancellation, streaming summaries and UTF-8 trimming, plus real SDK-client paging.
- Validation: all 138 server-free tests, types and the production build passed. Repository formatting
  passed with ignored local `.claude/settings.local.json` excluded; its pre-existing formatting issue
  blocks the unmodified `npm run check` command. Personal configuration was left untouched.

### 2026-10-22 — Interactive MCP walkthrough

- Replace the static MCP question with a selectable search, recorded-summary, and verification
  walkthrough. Add next/replay navigation and a copyable question with agent-specific copy feedback.
- Use matches and recorded facts verified against the synthetic MCP test history. Label the demo
  and distinguish suggested current-code checks from recorded outcomes. Read no history from the website.
- Preserve the monochrome style and existing trace animations. Keep all stages readable without
  JavaScript, use native keyboard controls, and respect reduced motion for stage transitions.
- Rename the navigation's “What’s next” link to “MCP” and the hero preview's matching label to
  “For your agents”; keep a direct MCP setup link for registration commands.

### 2026-10-22 — MCP connection guidance and website setup

- Teach connected agents when to search prior work, how to inspect a matching session, and how to
  handle empty results and historical instructions. Identify the configured default project during
  initialization; explain fixed startup scopes, explicit grants, and model-provider exposure.
- Add a dedicated landing-page MCP setup section with copyable Claude Code/Codex source-preview
  and future npm commands, optional developer build instructions, a practical question, and local clipboard feedback. Match the
  existing monochrome design and preserve the hero/footer trace animations.
- Document registration from the user's project with `"$PWD"`, private local Claude configuration,
  and the distinction between available source setup and npm commands for after release. Add the
  same setup to README and the MCP guide. No automatic approval or discovery behavior is claimed.
- Extend the real-client protocol check to verify initialization and tool guidance.
- Validation: all 126 server-free tests, formatting, types, and both builds passed. The user ran
  the browser inspector; final desktop/tablet/mobile screenshots were reviewed with zero failures
  and the two existing type-scale/video warnings. All seven copy targets and local anchors resolve;
  displayed commands pass shell syntax checks. No release, deployment, or personal registration.

### 2026-10-22 — Read-only MCP source preview

- Add `runlens mcp` stdio mode with `search_sessions` and `session_summary` over the shared Claude
  Code/Codex adapters. Keep the viewer as the default mode, without starting a browser or HTTP
  server in MCP mode. No MCP release to npm is claimed.
- Default to the startup directory project, require explicit startup grants plus tool selection
  for other projects, and scope the discovered file allowlist before full transcript scans.
- Return masked prompts/assistant excerpts and recorded change/failure facts with untrusted-data
  labels, dates, agent and session provenance. Exclude raw tool inputs/outputs, fetched payloads,
  thinking and compaction bodies; document the limits of redaction and injection protections.
- Bound JSON envelopes to 16 KiB, page results/turns, limit scans, propagate cancellation through
  discovery and reader iterators, and prevent overlapping scans. Keep transcripts unchanged.
- Bundle the official MCP SDK/schema validator and their notices; retain zero installation-time
  runtime dependencies. Add synthetic contract and real SDK-client protocol tests, plus source
  setup instructions and optional agent guidance.
- Reuse the viewer's inherited-fork filtering for MCP child evidence, and keep startup grants
  from expanding to inferred ancestor projects. Initialize the SDK only in MCP mode.
- Validation: all 126 server-free tests (including 19 MCP checks), types, formatting, both builds,
  and installed-package/MCP verification passed. Claude Code connected in a synthetic-only health
  check; Codex add/get configuration passed in a temporary config. Authenticated model use and
  Cursor integration were not exercised. No public release or personal client registration was made.

### 2026-10-22 — Manual GitHub Pages deployment

- Add a separate `Deploy website to GitHub Pages` workflow triggered only by manual dispatch.
  Check the selected commit, build the landing page, and upload only `website-dist/` before deploying.
- Pin GitHub actions to commit hashes, scope Pages/OIDC write permissions to the deployment job,
  and serialize deployments without cancelling an active run.
- Document the one-time Pages source setting and manual launch from the Actions tab.
- Validation: Actionlint passed, all 107 server-free tests and both builds passed, and 23 static
  asset/link references resolved under the repository's `/Runlens/` path. No deployment was triggered.

### 2026-10-22 — Quiet hero trace animation

- Introduce the footer's trace motif in the hero with three paths and slower, fainter packets
  flowing toward the product preview. Route around the headline, supporting copy, and install action.
- Adapt paths to the available space on resize and use outer routes on narrow layouts.
- Share packet playback with the footer, preserving its original timing and paths. Pause each
  stage when offscreen or the document is hidden; reduced motion keeps static paths only.
- Validation: all 107 tests and both builds passed. Browser checks covered seven widths, trace/text
  clearance, packet motion and offscreen pause, reduced-motion cancellation and restart, footer
  playback, and the keyboard install action. Final layout inspection reported no failures.

### 2026-10-22 — Practical website examples and aligned footer controls

- Replace the six-view reference table with expandable scenarios showing when Runlens helps:
  finding a familiar fix, reviewing an unexpected change, and carrying context into a handoff.
- Lower the closing sentence by 60px on desktop, connect the arrow to the upper trace, and center
  the license/navigation row between the lower two traces. Retain the original animation paths.
- Align controls through SVG coordinates and resize observation, with normal flow at smaller sizes.
- Validation: all 107 tests and both builds passed. Browser checks covered all three disclosures,
  keyboard activation, arrow/trace contact, link placement between lanes and clear of branches,
  the 60px copy offset, and six viewport widths. Final layout inspection reported no failures.

### 2026-10-22 — Restore the full footer animation

- Restore the original trace animation's full-width, full-height field around the Runlens name,
  preserving its paths, packet motion, and typography.
- Place the closing sentence and action above that field and the small footer copy and links below
  it, rather than shortening the animated area to the wordmark's height.
- Validation: all 107 tests and both builds passed. Browser checks verified the full animation field,
  clear copy and links at four widths, unchanged wordmark scale, playback, and reduced motion.

### 2026-10-22 — Clear footer copy around the animation

- Confine the animated traces to the large Runlens signature. Keep the closing sentence and action
  above it, and the license, navigation links, and independence notice below it.
- Preserve the wordmark's size and spacing. Pause trace playback based on the signature's visibility.
- Replace the repeated timeline close-up with a concise guide mapping review questions to the six
  session views, including Changes, Agents, Statistics, and Failures.
- Validation: all 107 project tests and both builds passed. Browser checks confirmed clear space
  around footer copy at 1440, 1280, 768, and 390px, unchanged wordmark scale, all six guide rows,
  trace playback, reduced motion, and no horizontal overflow or runtime errors.

### 2026-10-22 — Sharper website images and an animated close

- Recaptured all four demo screenshots directly at 3× pixel density (4320 × 3000 lossless PNGs),
  improving Retina clarity in the website and README without enlarging existing images.
- Replaced the privacy section's tall crop with the complete library view and added expandable
  screenshot previews with zoom, native Escape/focus behavior, and plain image-link fallback.
- Added subtle branching run traces behind the closing wordmark. Packet motion pauses offscreen
  and when the document is hidden; reduced motion keeps only the static background.
- Snap hero movement to physical pixels and include all website source modules in asset versioning.
- Validation: `npm run check` passed (107 tests), the website build passed, and browser checks
  verified PNG dimensions, expansion/zoom, Escape/focus restoration, theme links, the complete
  privacy image, footer playback/offscreen pause, reduced-motion stop/restart, and four viewport
  widths. Layout inspection passed at 1440, 768, and 390px without failures.

### 2026-10-22 — Runlens landing page

- Added an independent monochrome website with product screenshots, benefits, an interactive
  recorded-evidence walkthrough, FAQ, and npm/GitHub/release links.
- Included selectable and copyable npx/global setup commands, scroll entrances, screenshot
  transitions, keyboard controls, clipboard fallback, and reduced-motion support.
- Grounded planned MCP content in Foglio's safety/search/summary/client-guidance tasks; clearly
  distinguish unreleased tools and later candidates from current viewer capabilities.
- Added separate static build and loopback preview commands, local fonts/assets, and relative
  paths for future GitHub Pages hosting. Deployment remains deferred.
- Refreshed all four demo screenshots from the current viewer and verified the updated Runlens
  mark against the shared SVG; the website header and favicon reuse that same source asset.
- Version screenshot URLs by content and the website assets by build so refreshed images replace
  cached captures in the preview and future static hosting.
- Validation: `npm run check` passed (107 tests), the standalone website build passed, and browser
  checks passed for screenshot/walkthrough choices, keyboard activation, both copy commands and
  clipboard fallback, FAQ, reduced motion, four viewport widths, and the no-JavaScript fallback.
  Layout inspection passed at 1440, 768, and 390px with no failures.

### 2026-10-22 — Monochrome agent icon

- Replaced the previous Runlens mark with a simple agent face: a white face with black borders
  and eyes in light mode, and a black face with white borders and eyes in dark mode.
- Share one SVG between the sidebar, README, and bundled favicon. The sidebar follows the app's
  selected theme; the favicon follows the browser's colour scheme. No new state or dependency.
- Include the favicon in the build and isolated package asset checks.
- Validation: formatting, types, all 107 tests, production build, and isolated package checks passed.

### 2026-10-22 — Session jump control and branch cleanup

- Added one bottom-right session button that switches between moving to the top and bottom based
  on which half is being read. Hide it when the page fits; update it as tabs, expanded details,
  live content, or window size change. Respect reduced motion and keep nested code scrolling separate.
- Isolated scroll measurement in one small component, with a passive listener, frame scheduling,
  resize observation, and cleanup. Scroll position does not rerender the transcript. Reserve bottom
  reading space for the control; preserve keyboard focus on its single button.
- Consolidated duplicate Claude preview tests into the adapter tests. Removed unused project-colour
  and date-formatting helpers, plus Markdown fade pseudo-elements that were permanently hidden.
- Validation: formatting, types, all 107 tests, and the production build passed. User-assisted
  browser checks passed at 1440px and 1280px in both themes, covering button visibility and direction,
  focus, independent nested output scrolling, short content, resizing, and route cleanup.

### 2026-10-22 — Complete interface verification

- Verified library, timeline, and Changes views in both themes using user-assisted Chrome captures.
  All six inspection runs passed at 1440, 768, and 390px. Reviewed desktop renders; remaining
  warnings concern compact code/metadata and sparse status colours in the activity strip.
- Passed focused interaction checks in both themes, including agent filtering, Escape, Date
  grouping, expanded command details, original change records, and live/reduced-motion status.
  Corrected the capture harness to focus the picker before sending Escape; no application change
  was needed for that assertion.
- Recorded laptop and desktop as the primary UI audience. Phone-specific polish is outside current
  release criteria. Existing responsive behavior is retained.

### 2026-10-22 — Readable recorded file changes

- Replaced raw JSON as the default Changes view with per-file recorded patches or file content.
  Preserve indentation and line breaks, mark additions/removals, and keep original input/output
  behind a separate disclosure. Multi-file calls show only the selected path's preview.
- Normalize Codex completed file operations and patch blocks, and Claude edits, multi-edits, and
  writes into optional shared file previews. Keep missing source text explicit and distinguish
  file snapshots from diffs. Failed/pending edits retain their status and existing count rules.
- Keep files and original records lazily mounted; limit formatted previews to 400 lines or
  40,000 characters without modifying the underlying record. No runtime dependency was added.

### 2026-10-22 — Readable labels and phone error previews

- Increased primary navigation, filters, metric labels, session tabs, and search controls to 13px.
  Timestamps, IDs, and secondary row metadata retain their compact sizes.
- Wrap library titles to two lines on tablet and phone widths so longer session names are readable.
- Constrain failed-call previews and wrap them to two lines on phones, preserving the reading margin.
  Full error output remains available by expanding the call.
- Reviewed the taste inspector's library/session reports and screenshots in both themes at 1440,
  768, and 390px. Subsequent inspection passed after the error-spacing fix.

### 2026-10-22 — Codex inspection command labels

- Label simple Codex inspection commands as Read, Search, or List using shared lookup actions.
  Keep compound scripts, redirects, expansions, sed writes/executable expressions, search
  preprocessors, and uncertain commands as Run. Preserve original commands, inputs, and outputs.
- Classify both canonical tool calls and concrete completed operations inside orchestration calls.
  Do not execute shell text or infer file effects from these labels. Folded inspection commands
  display call counts instead of unsupported file counts.
- Add regression coverage for quoted arguments, system utility paths, native shell arrays,
  modifying/compound commands, and decoding through shared session summaries and search.

### 2026-10-22 — Codex commands and session sync status

- Fixed empty Codex command details: completed operations record commands as argument arrays,
  which were incorrectly passed to a string-only field. Preserve the original arguments in Input
  and show the shell script directly for a recorded shell invocation. Quote direct arguments so
  spaces and shell characters keep their boundaries. Unknown input remains inspectable.
- Added a green sync dot beside the session timestamp. It pulses while refreshing or following
  live activity, remains steady for a synced snapshot, and turns red with “Sync failed” on error.
  The indicator derives from the existing request and live-refresh state. Reduced motion disables
  the animation.
- Added regression coverage for native argument arrays, multiline scripts, direct invocations,
  Windows shell commands, positional arguments, and missing/malformed commands.

### 2026-10-22 — Agent identities and readable documentation

- Added bundled Claude and OpenAI marks beside agent names in the selector, session list, library,
  and session header. A shared identity component keeps labels consistent and supports unknown agents.
- Replaced the nested native-select focus treatment with one keyboard-accessible agent picker,
  including selected-state checks, Escape handling, and visible focus on the full control.
- Simplified README around installation, UI previews, features, and a short manual validation guide.
  Moved detailed usage, architecture, release instructions, and history into linked documentation.
- Added current UI screenshots with demo sessions in light and dark mode. Removed private task
  tracking references and the obsolete pre-adapter audit. Preserved brand-artwork license notices.
- Excluded injected Codex page-context blocks from user prompts so they cannot become session titles.

### 2026-10-22 — Codex sessions and agent navigation

- Registered a Codex adapter for local CLI/editor rollouts and archives. Added `--codex-dir` without
  changing Claude's discovery defaults or existing session URLs. Codex URLs use `codex--<id>`.
- Decode canonical messages, public reasoning summaries, tool calls/results, compactions, aborts,
  and recorded commands/patches inside orchestration calls. Ignore mirrored message records and
  fork-replayed parent metadata/calls. Retain unfamiliar calls and missing-result states.
- Group recorded child threads under their parent, link explicit spawn results, and include children
  in transcript search. Display Codex token totals as main-agent-only to avoid inherited fork usage.
- Added an extensible Agent selector above navigation. Replaced the large project/date switch with
  compact Group by controls; label agents in mixed sessions and library rows. Retained both themes,
  directory inference, saved grouping, search, pins, and sidebar collapse behavior.
- Applied the taste skill's Framed sheet direction with the existing brand and fonts. Browser
  verification remains with the user. Added synthetic Codex and source-filter regression tests to
  `npm run check`, plus a read-only local-history parsing smoke check.

### 2026-10-22 — Correct the npm archive path

- Prefixed the workflow's publish archive path with `./`, so npm treats it as a local tarball
  instead of a GitHub repository shorthand. npm's package-spec parser reproduced the failing
  `git` interpretation and confirmed that the corrected path resolves to `file`.
- The failed publish stopped before uploading a package. After pushing this workflow fix, start
  a new manual run on the updated branch; rerunning the old run uses its original workflow commit.

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

### 2026-10-22 — Source adapters

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
- Preserved the configured Claude session folders.
- Verification uses `npm run check`; browser and visual verification remain with the user.

### 2026-10-21 — Directory grouping

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
  passed.
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
