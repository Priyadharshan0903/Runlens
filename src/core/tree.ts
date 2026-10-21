// Turns a flat list of transcript events into turns of steps:
//   prompt → [why → tool call → result]… → final answer

import type { Event } from "./parse.js";
import { summarizeTool } from "./summarize.js";
import type { Stats, ToolStep, Turn } from "./types.js";

/** Tool output beyond this many characters is cut, to keep the page light. */
export const MAX_OUTPUT_CHARS = 20_000;

export interface BuiltTurns {
  turns: Turn[];
  stats: Stats;
  /** Every tool call by its id, so subagents can be attached to the call that started them. */
  tools: Map<string, ToolStep>;
  /** Subagent id → id of the tool call that started it, read from that call's result. */
  agentCalls: Map<string, string>;
}

export function buildTurns(events: Event[], cwd?: string): BuiltTurns {
  const turns: Turn[] = [];
  const tools = new Map<string, ToolStep>();
  const agentCalls = new Map<string, string>();
  const stats: Stats = { toolCalls: 0, errors: 0, subagents: 0 };

  let turn: Turn | undefined;
  // Agent text not yet placed: it becomes the "why" of the next tool call, or the final answer.
  let pending: { text: string; at: string }[] = [];
  let thought: string | undefined;

  const current = (at: string): Turn => {
    if (!turn) {
      turn = { prompt: "", at, steps: [] };
      turns.push(turn);
    }
    return turn;
  };
  const joined = () => pending.map((p) => p.text).join("\n\n");
  const flushAsNotes = () => {
    for (const { text, at } of pending)
      current(at).steps.push({ kind: "note", from: "agent", text, at });
    pending = [];
  };
  const closeTurn = () => {
    if (turn && pending.length) turn.final = joined();
    pending = [];
    thought = undefined;
  };

  for (const e of events) {
    switch (e.type) {
      case "prompt":
        closeTurn();
        turn = { prompt: e.text, at: e.at, steps: [] };
        turns.push(turn);
        break;
      case "interjection":
        flushAsNotes();
        current(e.at).steps.push({ kind: "note", from: "user", text: e.text, at: e.at });
        break;
      case "interrupt":
        flushAsNotes();
        current(e.at).steps.push({
          kind: "note",
          from: "interrupt",
          text: "Interrupted",
          at: e.at,
        });
        break;
      case "compaction":
        flushAsNotes();
        current(e.at).steps.push({ kind: "note", from: "compaction", text: e.text, at: e.at });
        thought = undefined;
        break;
      case "text":
        pending.push({ text: e.text, at: e.at });
        break;
      case "thinking":
        thought = e.text;
        break;
      case "tool_use": {
        const step: ToolStep = {
          kind: "tool",
          id: e.id,
          name: e.name,
          summary: summarizeTool(e.name, e.input, cwd),
          input: e.input,
          why: joined() || thought,
          at: e.at,
        };
        pending = [];
        thought = undefined;
        current(e.at).steps.push(step);
        tools.set(step.id, step);
        stats.toolCalls++;
        break;
      }
      case "tool_result": {
        const step = tools.get(e.toolUseId);
        if (!step) break;
        const truncated = e.output.length > MAX_OUTPUT_CHARS;
        step.result = {
          status: e.isError ? "error" : "ok",
          output: truncated ? e.output.slice(0, MAX_OUTPUT_CHARS) : e.output,
          truncated,
          at: e.at,
        };
        const ms = Date.parse(e.at) - Date.parse(step.at);
        if (Number.isFinite(ms) && ms >= 0) step.durationMs = ms;
        if (e.isError) stats.errors++;
        if (e.agentId) agentCalls.set(e.agentId, step.id);
        break;
      }
    }
  }
  closeTurn();

  return { turns, stats, tools, agentCalls };
}
