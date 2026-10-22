import type { Event } from "../../core/events.js";
import { buildTurns } from "../../core/tree.js";
import type { AgentRun, Session } from "../../core/types.js";
import type { SearchFile, SourceReader } from "../types.js";
import { streamRecords } from "../jsonl.js";
import { childSessions, defaultRoots, discover } from "./discover.js";
import { CodexDecoder, readTranscript } from "./parse.js";

export const codexReader: SourceReader = {
  source: { id: "codex", name: "Codex" },
  defaultRoots,
  discover,
  load,
  searchFiles,
  readEvents,
};

async function load(file: string): Promise<Omit<Session, "source">> {
  const main = await readTranscript(file);
  const built = buildTurns(main.events);
  const children = childSessions(file);
  const loaded = [];
  for (const child of children)
    loaded.push({ child, transcript: await readTranscript(child.file) });

  // Forks may replay the parent's messages and calls. Keep only the child's own call IDs.
  const parentEvents = new Map([[main.info.id, main.events]]);
  const tools = new Map(built.tools);
  const agentCalls = new Map(built.agentCalls);
  const stats = { ...built.stats };
  const unlinkedAgents: AgentRun[] = [];

  for (const { child, transcript } of loaded) {
    const inherited = parentEvents.get(child.info.parentId) ?? [];
    const events = ownEvents(transcript.events, inherited);
    parentEvents.set(child.summary.id, transcript.events);
    const childBuilt = buildTurns(events);
    const run: AgentRun = {
      id: child.summary.id,
      type: child.info.agentType ?? "subagent",
      description:
        childBuilt.turns.find((turn) => turn.prompt)?.prompt || child.summary.firstPrompt,
      background: false,
      stoppedByUser: events.some((event) => event.type === "interrupt"),
      startedAt: events[0]?.at,
      endedAt: transcript.info.endedAt,
      turns: childBuilt.turns,
      stats: childBuilt.stats,
    };
    const toolId =
      agentCalls.get(run.id) ??
      (child.info.agentPath ? agentCalls.get(child.info.agentPath) : undefined);
    const call = toolId ? tools.get(toolId) : undefined;
    if (call && !call.agent) call.agent = run;
    else unlinkedAgents.push(run);
    for (const [id, step] of childBuilt.tools) tools.set(id, step);
    for (const [id, callId] of childBuilt.agentCalls) agentCalls.set(id, callId);
    stats.toolCalls += run.stats.toolCalls;
    stats.errors += run.stats.errors;
    stats.subagents++;
    // Child usage is omitted: a fork may carry cumulative parent totals without a baseline.
  }
  return {
    id: main.info.id!,
    title:
      built.turns
        .find((turn) => turn.prompt)
        ?.prompt.split("\n")[0]
        .slice(0, 200) || "Untitled session",
    cwd: main.info.cwd,
    branch: main.info.branch,
    startedAt: main.info.startedAt,
    endedAt: main.info.endedAt,
    usage: main.usage,
    usageScope: "main",
    models: main.models,
    turns: built.turns,
    stats,
    unlinkedAgents,
  };
}

/** Drop an exact replay prefix, then exclude inherited calls even in a truncated fork. */
function ownEvents(events: Event[], parent: Event[]): Event[] {
  let prefix = 0;
  while (
    prefix < events.length &&
    prefix < parent.length &&
    JSON.stringify(events[prefix]) === JSON.stringify(parent[prefix])
  )
    prefix++;
  const calls = new Set(
    parent.filter((event) => event.type === "tool_use").map((event) => event.id),
  );
  const own = events
    .slice(prefix)
    .filter(
      (event) =>
        !(event.type === "tool_use" && calls.has(event.id)) &&
        !(event.type === "tool_result" && calls.has(event.toolUseId)),
    );
  if (own[0]?.type === "interjection") own[0] = { ...own[0], type: "prompt" };
  return own;
}

async function* searchFiles(file: string): AsyncIterable<SearchFile> {
  yield { file, source: "session" };
  for (const child of childSessions(file)) yield { file: child.file, source: "subagent" };
}

async function* readEvents(file: string, signal?: AbortSignal): AsyncIterable<Event> {
  const decoder = new CodexDecoder();
  for await (const record of streamRecords(file, signal)) yield* decoder.decode(record);
  yield* decoder.finish();
}
