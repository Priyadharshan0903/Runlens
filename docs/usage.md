# Using Runlens

For the unreleased read-only MCP server, see [MCP setup and privacy](mcp.md). The viewer remains
the default CLI mode; MCP requires the explicit `mcp` subcommand.

## Run from source

```sh
npm install
npm run build
npm start
```

Open the URL printed in your terminal. The default is `http://127.0.0.1:8740/`.
If another viewer is already running there, the CLI tries the next available port. To load this
version's new backend features, start a new process after building; refreshing a page does not
replace an older running backend.

Runlens automatically combines existing Claude Code history from:

- `$CLAUDE_CONFIG_DIR/projects`, when the environment variable is set.
- `~/.claude/projects`.
- Each immediate account folder's `projects` directory under `~/.claude-accounts`.

Codex history is discovered from `sessions` and `archived_sessions` under `$CODEX_HOME` (when set)
and `~/.codex`. This includes local CLI and editor sessions that write Codex rollout JSONL files.
It does not fetch cloud history or require an OpenAI API key. Only rollout files are read;
configuration files and credentials are not opened. See [Codex support](codex-sessions.md).

Account names are discovered rather than hardcoded. No account-switcher folder is required.
Missing folders are skipped, paths pointing to the same directory are read once, and copied
sessions with the same ID are counted once. Newly created account folders are picked up on the
next start; sessions within the configured folders appear when the library refreshes.

To select specific history folders, pass `--dir` for Claude or `--codex-dir` for Codex (repeatable).
An override replaces automatic discovery for that agent; the other agent keeps its own defaults.
Only pass folders that exist. Options:

| Flag                 | Meaning                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `--dir <path>`       | Read only these Claude Code `projects` folders; repeatable. Without it, discover active config, default, and account history folders. |
| `--codex-dir <path>` | Read only these Codex rollout folders; repeatable. Without it, discover active/default sessions and archives.                         |
| `--port <n>`         | Preferred port, default `8740`; tries the next 10 ports if occupied.                                                                  |
| `--no-open`          | Print the URL without opening a browser.                                                                                              |

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
- **Agent scope** selects All agents, Claude Code, or Codex above the sidebar navigation. The same
  selection scopes sidebar sessions, library rows, pins, and project choices. New registered readers
  become options automatically, including agents with no history yet. Mixed lists label the agent
  on each session; the library also shows its agent beside its project.
- **Display names, tags, and notes** organize sessions without modifying their original files.
- **Pagination** loads the library in batches of 40 rows.

The compact **Group by** row sits below the agent scope and defaults to **Project**, with a saved
**Date** option. Choosing an agent while viewing a session returns to the library. The agent choice
lasts for the current page visit; grouping remains saved in browser preferences. Projects and their sessions
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

The centered search field in the top bar covers every project and filters the sidebar and library
through one shared search request. Matching project groups open while searching; clearing search
restores manual expansion choices. Library-specific project, date, and pin filters do not narrow
the sidebar. Search requests pause while viewing a session, where the sidebar returns to the full library.

## Inspect a session

Use **Previous** and **Next** on the right of the top bar to move between chats without returning
to the library. They follow the current project's most recently updated order and respect the chosen
agent. The count shows your position in that project; hovering a control shows the destination's
title, including any name you gave it. The controls stay visible while you scroll, load a chat, or
encounter a loading error, and disable at the first/last chat. Tab to a link and press Enter to open
it; browser Back/Forward still follow your navigation history. On narrow screens the controls use
arrow icons with the same accessible names. The sequence includes the full project, beyond the
sidebar's five rows and the library's 40-row pages.

| View         | What it shows                                                                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timeline     | Prompts, tool calls, outputs, recorded context, interruptions, and final answers. The activity strip jumps to a call and opens its collapsed ancestors.                 |
| Conversation | Prompts and final answers, with user interjections and compaction markers, without the tool-call stream.                                                                |
| Changes      | File edits grouped by path, including subagent work. Expand a file for readable recorded patches or file content. Original tool input/output stays behind a disclosure. |
| Agents       | Subagent tasks, calls, outputs, durations, and background/stopped states. The inspector roster jumps to a run in the timeline.                                          |
| Statistics   | Recorded token usage, cache reads/writes, models, tool distribution, and file activity.                                                                                 |
| Failures     | Calls whose tool results explicitly recorded an error, with links back to the timeline.                                                                                 |

In Timeline and Conversation, each turn pairs your question on the left with the agent's work on
the right. The question stays visible while reading a long response. Collapsing agent work does not
collapse the question. Panes narrower than 700 px stack question above response, using the available
reading width rather than the window width. Session metadata and notes stay in the right inspector.

Search inside a session, expand or collapse tool details, copy the session ID, and export
Markdown or JSON. JSON exports include your session annotations; Markdown exports include your notes.

A single button at the bottom-right of a session moves to the opposite end of the page. It shows
**Move to bottom** in the upper half and **Move to top** in the lower half. It hides when the content
fits without scrolling, updates when tabs or expanded content change height, and respects reduced
motion. It moves the session page, leaving nested command outputs and code previews independent.

**Live refresh** polls the selected session every 5 seconds and the library every 15 seconds.
It keeps the existing transcript on screen while refreshing, pauses polling when the browser tab
is hidden, and avoids overlapping requests for the selected session. It is polling, not streaming.

**Focus mode** hides navigation and the inspector. Press `Escape` to leave it.

## Appearance

The session header shows a green dot after a successful sync. It gently pulses during refreshes
and while Live refresh is enabled. A failed sync turns the dot red and shows “Sync failed.”
The timestamp identifies the last successful refresh; reduced-motion settings keep the dot still.

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

- Claude Code token usage comes from recorded assistant-message usage fields. Repeated content blocks,
  streaming snapshots, and fork-replayed messages with the same message ID are counted once,
  using the largest recorded value of each token field. Missing usage is shown as a dash.
- Codex uses cumulative token snapshots once, subtracting cached input from ordinary input and
  keeping reasoning tokens within the recorded output total. Codex usage covers the main agent only;
  child fork totals are excluded and labelled accordingly. Model rows count usage records, which
  are deduplicated messages for Claude and increasing cumulative snapshots for Codex.
- Token totals include input, output, cache reads, and cache writes. They measure recorded work,
  not the context size of a single request. Claude totals include subagents.
- Cost is displayed only when the transcript records it. Runlens does not invent a price estimate.
- File line counts describe successful recorded replacement blocks. They are not a net Git diff;
  repeated edits and `replace_all` mean they can differ from final repository changes. Failed edits
  stay visible as attempts but do not increase successful replacement counts.
- Change previews show only the selected path's recorded patch or content, preserving line breaks
  and indentation. Added/removed lines carry signs as well as colour. A full recorded file without
  its previous version is labelled as content, not a reconstructed diff. Missing source text is
  stated explicitly. Expanded previews are limited to 400 lines or 40,000 characters; the original
  tool record remains available separately. Files and raw records render only when opened.
- The text before a tool call is the agent's recorded context, not independently verified intent.
  A tool result without an error does not establish that the overall task succeeded.
- Elapsed session duration includes idle time between messages.
- Compaction markers are displayed when recorded. Reconstructing missing history across separate
  fork/resume chains is not implemented.

Local transcript formats can change between agent versions. Tests use synthetic
transcripts; coverage of the format is not a guarantee that every historical session will parse.
