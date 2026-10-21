import type { AgentRun, Session, ToolStep, Turn, TokenUsage } from "../../../src/core/types.js";
import { kindOf } from "../../shared/format.js";

export interface CallRef {
  step: ToolStep;
  turn: number;
  agent?: AgentRun;
}
export function allCalls(session: Session): CallRef[] {
  const out: CallRef[] = [];
  const seen = new Set<string>();
  const walk = (turns: Turn[], parent?: number, agent?: AgentRun) => {
    turns.forEach((turn, i) => {
      for (const step of turn.steps) {
        if (step.kind !== "tool" || seen.has(step.id)) continue;
        seen.add(step.id);
        out.push({ step, turn: parent ?? i, agent });
        if (step.agent) walk(step.agent.turns, parent ?? i, step.agent);
      }
    });
  };
  walk(session.turns);
  for (const run of session.unlinkedAgents)
    walk(run.turns, Math.max(0, session.turns.length - 1), run);
  return out;
}

export interface FileActivity {
  path: string;
  calls: ToolStep[];
  edits: number;
  reads: number;
  added: number;
  removed: number;
}

export interface SessionOverview {
  calls: CallRef[];
  files: FileActivity[];
  changedFiles: FileActivity[];
  failedCalls: CallRef[];
  agents: { run: AgentRun; call?: ToolStep }[];
  tools: { name: string; calls: number; errors: number }[];
  mainCallCount: number;
  compactionCount: number;
}

/** Build the view's shared data once per loaded session, never once per keystroke. */
export function summarizeSession(session: Session): SessionOverview {
  const calls = allCalls(session);
  const files = sessionFiles(calls);
  const failedCalls: CallRef[] = [];
  const agents: SessionOverview["agents"] = [];
  const tools = new Map<string, { name: string; calls: number; errors: number }>();
  let mainCallCount = 0;

  for (const reference of calls) {
    const { step, agent } = reference;
    const tool = tools.get(step.name) ?? { name: step.name, calls: 0, errors: 0 };
    tool.calls++;

    if (step.result?.status === "error") {
      failedCalls.push(reference);
      tool.errors++;
    }
    if (step.agent) agents.push({ run: step.agent, call: step });
    if (!agent) mainCallCount++;

    tools.set(step.name, tool);
  }

  for (const run of session.unlinkedAgents) agents.push({ run });

  const compactions = session.turns.flatMap((turn) => {
    return turn.steps.filter((step) => step.kind === "note" && step.from === "compaction");
  });

  return {
    calls,
    files,
    changedFiles: files.filter((file) => file.edits > 0),
    failedCalls,
    agents,
    tools: [...tools.values()].sort((first, second) => second.calls - first.calls),
    mainCallCount,
    compactionCount: compactions.length,
  };
}
export function sessionFiles(calls: CallRef[]): FileActivity[] {
  const files = new Map<string, FileActivity>();
  for (const { step } of calls) {
    const input = step.input as Record<string, unknown> | undefined;
    const path = input?.file_path ?? input?.notebook_path;
    if (typeof path !== "string" || !path) continue;
    const file = files.get(path) ?? { path, calls: [], edits: 0, reads: 0, added: 0, removed: 0 };
    file.calls.push(step);
    if (kindOf(step.name) === "change") {
      file.edits++;
      // These are recorded replacement blocks, not a net Git diff; failed calls stay visible.
      if (step.result?.status === "ok") {
        if (step.name === "Edit") {
          file.added += lines(input?.new_string);
          file.removed += lines(input?.old_string);
        } else if (step.name === "Write") file.added += lines(input?.content);
        else if (step.name === "MultiEdit" && Array.isArray(input?.edits)) {
          for (const edit of input.edits) {
            file.added += lines(edit?.new_string);
            file.removed += lines(edit?.old_string);
          }
        }
      }
    } else file.reads++;
    files.set(path, file);
  }
  return [...files.values()].sort((a, b) => b.edits - a.edits || a.path.localeCompare(b.path));
}
function lines(value: unknown): number {
  return typeof value === "string" && value ? value.split("\n").length : 0;
}

export function totalTokens(usage?: TokenUsage): number | undefined {
  return usage ? usage.input + usage.output + usage.cacheRead + usage.cacheWrite : undefined;
}
export function formatNumber(value: number | undefined): string {
  return value === undefined ? "—" : value.toLocaleString();
}

const compactNumberFormat = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCompactNumber(value: number | undefined): string {
  return value === undefined ? "—" : compactNumberFormat.format(value);
}
export function relativePath(path: string, cwd?: string): string {
  return cwd && path.startsWith(cwd + "/") ? path.slice(cwd.length + 1) : path;
}
export function exportMarkdown(session: Session): string {
  const out = [
    `# ${session.title}`,
    "",
    `Project: ${session.cwd ?? "Unknown"}`,
    `Session: ${session.id}`,
    "",
  ];
  const walk = (turns: Turn[], depth = 2) => {
    turns.forEach((turn, i) => {
      out.push(`${"#".repeat(Math.min(6, depth))} Turn ${i + 1}`, "", turn.prompt, "");
      for (const step of turn.steps) {
        if (step.kind === "note") {
          out.push(`[${step.from}] ${step.text}`, "");
          continue;
        }
        out.push(`**${step.name}** — ${step.summary}`, "", step.why ?? "", "");
        // JSON string literals keep arbitrary backticks in transcript output from escaping a fence.
        out.push(
          "```json",
          JSON.stringify(
            {
              input: step.input,
              status: step.result?.status ?? "pending",
              output: step.result?.output,
              truncated: step.result?.truncated,
            },
            null,
            2,
          ),
          "```",
          "",
        );
        if (step.agent) {
          out.push(`**Subagent: ${step.agent.description}**`, "");
          walk(step.agent.turns, depth + 1);
        }
      }
      if (turn.final) out.push("**Answer**", "", turn.final, "");
    });
  };
  walk(session.turns);
  for (const run of session.unlinkedAgents) {
    out.push(`## Unlinked subagent: ${run.description}`, "");
    walk(run.turns, 3);
  }
  return out.join("\n");
}

export function download(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
