// The common event format produced by source readers. No agent-specific records cross this boundary.

import type { ToolAction } from "./types.js";

export type Event =
  | { type: "prompt"; text: string; at: string }
  /** A message the person sent while the agent was still working. */
  | { type: "interjection"; text: string; at: string }
  | { type: "interrupt"; at: string }
  | { type: "text"; text: string; at: string }
  | { type: "thinking"; text: string; at: string }
  | { type: "compaction"; text: string; at: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: unknown;
      summary: string;
      action: ToolAction;
      at: string;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      isError: boolean;
      output: string;
      at: string;
      /** Set when the call started a subagent. */
      agentId?: string;
    };

/** Drop an exact replay prefix, then exclude inherited calls even in a truncated fork. */
export function ownEvents(events: Event[], parent: Event[]): Event[] {
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
