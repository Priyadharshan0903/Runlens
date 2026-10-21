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
