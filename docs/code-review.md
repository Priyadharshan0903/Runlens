# Runlens code review — FOG-65

Reviewed on 2026-10-21 before project grouping and additional agent readers. This document records
the starting point; README describes the implemented FOG-66 behavior.

## Session navigation and project filtering

`ui/app/sidebar.tsx` takes the newest 30 sessions and groups them by activity date. The server
already returns every discovered session, ordered newest first; the 30-session limit is in the UI.
The sidebar has no project grouping or connection to transcript search yet.

`ui/features/library/library.tsx` builds its project options from distinct recorded `cwd` values.
Filtering uses exact path equality. A session in `demo/src` therefore counts as a different project
from a session in `demo`. The project count uses the same exact-folder distinction. Labels use
only the final folder name, so different paths with the same name are difficult to distinguish.

Directory grouping should retain full paths as identities and show enough path context to distinguish
duplicate names. Subfolders must roll up into a project folder. Per the user's decision, Git must
not define that boundary. The user selected inference from session history: combine subfolders under
the highest recorded ancestor, excluding home and filesystem-root sessions. Do not guess roots for
sibling folders when their shared parent has no recorded session.

The existing library project filter can complement sidebar grouping, but both must use the same
project identity. Sidebar grouping must happen before any per-group display limit is applied.

## Search and reader boundaries

`src/core/search.ts` streams transcript JSONL files and passes each record to `parseRecords` before
matching text in the emitted events. It does not search raw JSON strings directly. It also searches
subagent transcripts and returns one excerpt per matching session.

Search remains coupled to Claude through that parser and the Claude subagent directory layout.
`src/core/discover.ts` also checks Claude record types directly when finding titles and first prompts.
`src/core/session.ts` loads and links Claude subagent files and metadata. The normalized event union
currently lives in `src/core/parse.ts`, with turn reconstruction in `src/core/tree.ts`.

Library owns the current search request. To show matching sessions inside sidebar groups without
duplicating requests, search can move to a feature hook consumed by the shell, with matching rows
derived once for both consumers. Date and project filters should remain library-owned choices.

## Direct tool-name assumptions

Six implementation files explicitly map or compare Claude tool names:

| File                                  | Responsibility                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/core/summarize.ts`               | Builds summaries from tool-specific inputs such as `command`, `file_path`, and replacement text. |
| `src/core/session.ts`                 | Matches forked skill runs to calls named `Skill`.                                                |
| `ui/shared/format.ts`                 | Maps tool names to activity categories and display verbs.                                        |
| `ui/shared/icons.tsx`                 | Maps tool names to icons.                                                                        |
| `ui/features/session/session-data.ts` | Extracts file activity and replacement line counts for `Edit`, `Write`, and `MultiEdit`.         |
| `ui/features/session/transcript.tsx`  | Labels grouped reads and renders command or replacement input for specific tools.                |

The activity strip and changes view also consume the categories from `kindOf`, so moving tool
semantics into readers must preserve those consumers. Introducing another parser alone would not
make all existing features work for another agent. This is the scope of FOG-67, separate from grouping.

## Git state at review

The latest commit at documentation time is `8539dab` (collapsible sidebar and preferences), following
`4cb9c19` (UI components and styles) and `71a69e6` (initial setup). The sidebar work was committed
while this review was underway; the working tree was clean before adding this review. Existing
session-source configuration and sidebar behavior must be preserved. This review does not commit,
reset, or stage changes.

## Verification

This task is a source review; it does not change runtime behavior. The preceding sidebar change
passed formatting, type checking, 22 core/feature tests, and the production build. Project grouping
will need focused tests for directory boundaries, duplicate names, ordering, and grouped search.
