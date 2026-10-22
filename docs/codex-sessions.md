# Codex sessions

Runlens reads local Codex `rollout-*.jsonl` files beneath `sessions` and `archived_sessions`.
It checks `$CODEX_HOME` and `~/.codex`, deduplicates physical folders and session IDs, and skips
absent history. [Official Codex configuration documentation](https://developers.openai.com/codex/config-advanced/)
describes `CODEX_HOME`; the rollout decoder is based on observed local records rather than a
promised stable transcript API. No API calls, authentication files, or configuration secrets are needed.

Use repeated `--codex-dir <path>` flags to replace Codex's default history folders. Claude's
`--dir` remains independent. Restart a previously running Runlens process after rebuilding.

## Record handling

- Read identity and working folder from the first `session_meta`. A fork can replay parent
  metadata afterward; that replay must not replace the child's identity.
- Use `response_item` messages and tool calls/results as the canonical conversation. Ignore mirrored
  `event_msg` messages, task completion text, and completed message snapshots. Context-only AGENTS,
  environment, permission, and skill instructions do not become human questions.
- Display public reasoning summaries when recorded. Encrypted reasoning is never decoded.
- Match function/custom tool outputs by call ID. Missing output stays pending. Shell exit codes,
  explicit error fields, and failed completed operations determine tool failures, not prose guesses
  about whether the overall task succeeded.
- Completed commands can be strings or argument arrays. Recorded shell invocations display their
  script directly, while direct invocations retain quoted argument boundaries. The original array
  stays in the normalized call input for inspection and exports. Missing command text falls back
  to the available input instead of an empty Command field.
- Simple `cat`, `head`, `tail`, and `wc` commands are labelled Read; `rg`/`grep` are Search,
  and `ls`/`pwd` are List. A simple `sed` print/range expression also counts as Read.
  Compound scripts, pipelines, redirects, expansions, executable search preprocessors, and
  unfamiliar commands stay Run. These are conventional display labels, not a shell evaluator
  or a guarantee about aliases, environment configuration, or side effects. Classification never
  executes commands or invents file effects. Folded shell lookups show an inspection-call count
  rather than claiming a number of files read.
- Prefer concrete completed commands, file changes, and MCP calls recorded during one enclosing
  `exec` call. Show its individual operations instead of counting the wrapper again. If no concrete
  operations are recorded, retain the original script and output. Detached operations or overlapping
  wrappers cannot always be attributed; retain them as recorded activity rather than guessing.
- Normalize explicit patch blocks and recorded file changes into file effects. Shell text alone
  does not prove a read or write. Line counts describe recorded changes, not a net Git diff.
  Each effect carries its own recorded patch/content preview when available. Multi-file patch
  previews stay separate; an added file shows source lines rather than escaped JSON. Updates
  without a recorded diff show content without inventing a previous version.
- Display compaction/abort markers without replaying `replacement_history` as new conversation.
  Unknown record types are skipped; unknown tool names and inputs remain inspectable.

Metadata discovery is cached by size and modification time and stops after identity and the first
visible prompt. Titles use that prompt. It does not read Codex's SQLite database or rename records
from a separate session index. Only selected sessions are fully reconstructed. Search streams the
same decoder and releases handles when cancelled or a match is found.

## Subagents and usage

Recorded `source.subagent.thread_spawn.parent_thread_id` relationships group descendants with their
parent. Exact replay prefixes and parent call IDs are removed from child runs. Explicit `agent_id`
or exact recorded `task_name`/agent-path spawn results link a run to its call; otherwise the run
remains available in the Agents view. An
orphan whose parent is absent remains a standalone session. Child histories without a recorded
relationship cannot safely be inferred from matching names or directories.

Token usage comes from cumulative `event_msg.token_count` totals. Repeated snapshots and companion
`token_usage_record` entries are not summed again. Cached tokens are separated from ordinary input;
reasoning output is already included in output. Model attribution uses recorded turn context.
Missing usage and prices remain absent. Counters that move backwards are kept at their previous
high-water marks rather than inventing a reset baseline.

Codex token/model totals cover the **main agent only**. Forked children can inherit parent counters,
so including them would inflate usage without a reliable baseline. The session header and Statistics
view label this scope. Tool and subagent counts still include decoded child work.

## Navigation design

The screen answers: “Which local run do I want to inspect, and which agent ran it?”

The taste skill dealt **Framed sheet**, seed **276995629**, with palette and type kept from Runlens.
The existing teal mark, neutral frame, inset work surface, and Geist fonts remain. Agent scope gets
one labelled picker above All/Pinned navigation. A native details disclosure owns its open state;
buttons carry the agent marks, names, and selection checks. Tab and Escape support keyboard use,
and more agents fit without an expanding row of tabs. Registered agents remain selectable when
their history is empty.

Below Sessions, a quieter **Group by · Project / Date** row controls the organization of that scoped
history. Its active option uses an ink underline. The source choice belongs to App because sidebar
and library consume it; counts and project choices derive from scoped sessions. Switching source
returns a session view to its library and resets library-specific filters through component identity.
Grouping stays saved. Search text and project expansion choices survive agent changes.

Mixed sidebar rows identify the agent; library rows pair agent and project in one column, while
subagent counts keep their own clearly named column. Both themes use existing tokens. On narrow
screens, the existing menu holds the same agent/grouping controls with 44px targets.

No sample sessions or invented figures ship in the UI. Synthetic records live only in tests. Visual
verification at desktop, tablet, and phone widths is left to the user, per the repository's testing
instructions; source lint and server-free checks do not establish browser layout correctness.
