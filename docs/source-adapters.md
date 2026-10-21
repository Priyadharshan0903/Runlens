# Adding a source adapter

Runlens uses a small TypeScript adapter interface, without a plugin framework or runtime dependency.
The only registered production adapter is Claude Code. New readers are bundled into a Runlens
release; this is not a system for loading arbitrary npm plugins at runtime.

## Responsibilities

| Location               | Owns                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `src/sources/types.ts` | Reader contract, configured folders, and discovered file references.                    |
| `src/sources/index.ts` | Explicit list of registered adapters.                                                   |
| `src/sources/claude`   | Claude file layout, parsing, call semantics, subagent linking, and usage deduplication. |
| `src/core/events.ts`   | Common events emitted by readers.                                                       |
| `src/core/tree.ts`     | Common event-to-turn reconstruction, results, durations, and output limits.             |
| `src/core/discover.ts` | Merged source results, stable public IDs, and shared project inference.                 |
| `src/core/search.ts`   | Matching and snippets over normalized events, cancellation, and bounded result caching. |
| `src/core/session.ts`  | Loading an allowlisted file through its owning adapter.                                 |

## Implement a reader

Create `src/sources/<agent>/reader.ts`, implementing `SourceReader`:

- `source`: a unique stable ID and the human-readable agent name. Use letters, digits, and hyphens
  for the source ID. It becomes part of session URLs and browser annotation keys.
- `defaultRoots(env)`: existing local history folders for that agent. Do not mix another agent's
  folders into this reader. CLI overrides configure these roots before discovery.
- `discover(roots)`: read lightweight metadata and return `{ file, summary }` entries. Each summary
  has a stable local session ID made of letters, digits, underscores, and hyphens, plus title, first
  prompt, timestamps, size, recorded working folder, and subagent count. Cache metadata when helpful;
  do not reconstruct every session just to show the library.
- `load(file)`: reconstruct a session using common events and `buildTurns` where possible. Own any
  source-specific subagent discovery, replay filtering, linking, and usage deduplication here. The
  shared loader supplies the source descriptor and public session ID.
- `searchFiles(file)`: asynchronously yield the main transcript and then child transcripts with
  `source: "session"` or `"subagent"`. This field describes where a search hit occurred; it is
  distinct from the agent's source descriptor. Do not enumerate unrelated files.
- `readEvents(file, signal)`: yield common events for search, decoding and filtering the agent's
  records first. Keep any decoder state inside this iterator when records depend on previous ones.
  Honor cancellation and release file handles in `finally`, including when search stops early.

Register the object once in `sourceReaders`. A new source is picked up by the shared discovery,
loading, search, project grouping, and session features. Agent-specific CLI flags or a new source
filter are separate UI/configuration work; they should not require changes to transcript features.

Existing Claude sessions retain their unprefixed IDs for compatibility. Other readers receive
`<source-id>--<local-id>` public IDs. Keep local IDs stable across refreshes and preserve the first
copy when multiple configured roots expose the same session.

## Normalize tool calls

Every `tool_use` event carries the raw tool name and input, a one-line `summary`, and an `action`:

```ts
{
  type: "tool_use",
  id: "call-1",
  name: "apply_patch_set",
  input: rawInput,
  summary: "src/auth.ts (+3 −1)",
  action: {
    kind: "change",
    verb: "Patch",
    icon: "edit",
    files: [{ path: "src/auth.ts", operation: "change", added: 3, removed: 1 }],
  },
  at: recordedTimestamp,
}
```

The common kinds are `look`, `run`, `change`, `delegate`, and `other`. They drive activity colors
and grouping. Use `other` and the raw name for an unfamiliar tool. Icons use semantic names from
`ToolIconName`; adapters do not import UI components.

Supply one file effect per path per call, aggregating multiple replacements to the same path.
A call can affect several files. The UI counts each as an attempt, but includes added/removed lines
only when the corresponding result succeeds. Failed or pending changes never inflate successful
line counts. These counts describe recorded replacements, not a net repository diff. Shell text
alone is not evidence that a file changed.

`action.command` enables command rendering; `action.replacement` enables a before/after display.
Raw inputs remain available for other calls. `action.detail` can override the displayed summary,
for example to show an MCP tool name beside its server. The UI should never inspect an agent's
raw field names to recover these meanings.

Omit cost, tokens, and reasoning when the source does not record them. Do not turn missing data
into zero or estimate hidden reasoning. Recorded thinking events can populate optional step
reasoning independently of the agent's explanatory text. Cost already displays a dash when absent.

## Verify the boundary

Use synthetic fixtures rather than personal transcripts. Cover malformed/live records, local ID
collisions across sources, subagent linking, successful/failed/pending changes, missing metadata,
and search cancellation. `tests/sources.test.ts` includes a deliberately different JSON-document
reader to exercise the shared code without Claude record types or tool names.

Run `npm run check` after adding your reader tests to its server-free test list. CI also exercises
the HTTP routes. Restart the backend after rebuilding to load changed readers and response shapes.
