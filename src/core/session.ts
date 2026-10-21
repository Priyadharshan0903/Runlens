// Loads one session: the main transcript plus its subagents, each attached to the tool call
// that started it.
//
//   <project>/<session-id>.jsonl                          main agent
//   <project>/<session-id>/subagents/agent-<id>.jsonl     one per subagent
//   <project>/<session-id>/subagents/agent-<id>.meta.json type, description, toolUseId

import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { readTranscript, type UsageRecord } from "./parse.js";
import { buildTurns, type BuiltTurns } from "./tree.js";
import type { AgentRun, ModelUsage, Session, Stats, TokenUsage, ToolStep } from "./types.js";

interface SubagentMeta {
  agentType?: string;
  description?: string;
  name?: string;
  toolUseId?: string;
  requestShape?: string;
  stoppedByUser?: boolean;
  /** From agent-<id>.forked-skill.json, for subagents a skill started rather than a tool call. */
  skillName?: string;
}

interface LoadedRun {
  run: AgentRun;
  meta: SubagentMeta;
  built: BuiltTurns;
  usage: UsageRecord[];
}

export function sessionId(file: string): string {
  return basename(file, ".jsonl");
}

export function subagentDir(file: string): string {
  return join(file.replace(/\.jsonl$/, ""), "subagents");
}

export async function loadSession(file: string): Promise<Session> {
  const main = await readTranscript(file);
  const mainBuilt = buildTurns(main.events, main.info.cwd);
  const subagents = await loadSubagents(
    subagentDir(file),
    main.info.cwd,
    new Set(mainBuilt.tools.keys()),
  );

  // Subagents can start their own subagents, so look up calls across every transcript.
  // The first copy of a call wins, so the main transcript's own steps are the ones linked.
  const tools = new Map<string, ToolStep>(mainBuilt.tools);
  const agentCalls = new Map<string, string>(mainBuilt.agentCalls);
  for (const { built } of subagents) {
    for (const [id, step] of built.tools) if (!tools.has(id)) tools.set(id, step);
    for (const [agentId, toolId] of built.agentCalls)
      if (!agentCalls.has(agentId)) agentCalls.set(agentId, toolId);
  }

  const unlinkedAgents: AgentRun[] = [];
  const usage = aggregateUsage([main.info.usageRecords ?? [], ...subagents.map((s) => s.usage)]);
  const stats: Stats = { ...mainBuilt.stats };
  for (const { run, meta } of subagents) {
    const toolId = meta.toolUseId ?? agentCalls.get(run.id);
    let step = toolId ? tools.get(toolId) : undefined;
    if (!step && meta.skillName) step = findSkillCall(tools, meta.skillName, run.startedAt);
    if (step && !step.agent) {
      step.agent = run;
      if (!meta.description) run.description = step.summary;
    } else {
      unlinkedAgents.push(run);
    }
    stats.toolCalls += run.stats.toolCalls;
    stats.errors += run.stats.errors;
    stats.subagents++;
  }

  return {
    id: sessionId(file),
    title: main.info.title ?? firstPrompt(mainBuilt) ?? "Untitled session",
    cwd: main.info.cwd,
    branch: main.info.branch,
    startedAt: main.info.startedAt,
    endedAt: main.info.endedAt,
    costUSD: main.info.costUSD,
    linesAdded: main.info.linesAdded,
    linesRemoved: main.info.linesRemoved,
    ...usage,
    turns: mainBuilt.turns,
    stats,
    unlinkedAgents,
  };
}

/**
 * `parentCalls`: ids of the main transcript's calls. A forked subagent's transcript starts by
 * replaying the call that spawned it; those replayed calls belong to the parent, not the fork.
 */
async function loadSubagents(
  dir: string,
  cwd: string | undefined,
  parentCalls: Set<string>,
): Promise<LoadedRun[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files = names.filter((n) => n.startsWith("agent-") && n.endsWith(".jsonl"));
  const runs = await Promise.all(
    files.map(async (name): Promise<LoadedRun> => {
      const id = name.slice("agent-".length, -".jsonl".length);
      const raw = await readJson(join(dir, `agent-${id}.meta.json`));
      const skill = await readJson(join(dir, `agent-${id}.forked-skill.json`));
      const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
      const meta: SubagentMeta = {
        agentType: text(raw.agentType),
        description: text(raw.description),
        name: text(raw.name),
        toolUseId: text(raw.toolUseId),
        requestShape: text(raw.requestShape),
        stoppedByUser: raw.stoppedByUser === true,
        skillName: text(skill.skillName),
      };

      const transcript = await readTranscript(join(dir, name));
      const own = transcript.events.filter(
        (e) =>
          !(e.type === "tool_use" && parentCalls.has(e.id)) &&
          !(e.type === "tool_result" && parentCalls.has(e.toolUseId)),
      );
      const built = buildTurns(own, cwd ?? transcript.info.cwd);
      const run: AgentRun = {
        id,
        type: meta.agentType ?? meta.name ?? "subagent",
        description: meta.description ?? meta.name ?? firstPrompt(built) ?? "",
        background: meta.requestShape === "background",
        stoppedByUser: meta.stoppedByUser === true,
        startedAt: transcript.info.startedAt,
        endedAt: transcript.info.endedAt,
        turns: built.turns,
        stats: built.stats,
      };
      return { run, meta, built, usage: transcript.info.usageRecords ?? [] };
    }),
  );
  return runs.sort((a, b) => (a.run.startedAt ?? "").localeCompare(b.run.startedAt ?? ""));
}

/** Shared message ids in forked transcripts are counted once, at their largest recorded usage. */
function aggregateUsage(groups: UsageRecord[][]): { usage?: TokenUsage; models: ModelUsage[] } {
  const records = new Map<string, UsageRecord>();
  groups.forEach((group, g) =>
    group.forEach((record, i) => {
      const key = record.id ?? `${g}:${i}`;
      const old = records.get(key);
      const usage = { ...record.usage };
      if (old)
        for (const field of Object.keys(usage) as (keyof TokenUsage)[]) {
          usage[field] = Math.max(usage[field], old.usage[field]);
        }
      records.set(key, { ...record, usage });
    }),
  );
  const models = new Map<string, ModelUsage>();
  const total: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const record of records.values()) {
    const model = models.get(record.model) ?? {
      model: record.model,
      messages: 0,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    model.messages++;
    for (const field of Object.keys(total) as (keyof TokenUsage)[]) {
      total[field] += record.usage[field];
      model.usage[field] += record.usage[field];
    }
    models.set(record.model, model);
  }
  return { usage: records.size ? total : undefined, models: [...models.values()] };
}

/** The latest call to this skill that happened before the subagent started and has no subagent yet. */
function findSkillCall(
  tools: Map<string, ToolStep>,
  skill: string,
  startedAt?: string,
): ToolStep | undefined {
  let best: ToolStep | undefined;
  for (const step of tools.values()) {
    if (step.name !== "Skill" || step.agent) continue;
    const input = step.input as { skill?: unknown } | undefined;
    if (input?.skill !== skill) continue;
    if (startedAt && step.at > startedAt) continue;
    if (!best || step.at > best.at) best = step;
  }
  return best;
}

function firstPrompt(built: BuiltTurns): string | undefined {
  const prompt = built.turns.find((t) => t.prompt)?.prompt;
  return prompt ? prompt.split("\n")[0].slice(0, 120) : undefined;
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    return typeof value === "object" && value !== null ? value : {};
  } catch {
    return {};
  }
}
