// Shared data produced by source adapters. Features never interpret raw agent records.

export interface SessionSource {
  id: string;
  name: string;
}

export type ToolKind = "look" | "change" | "run" | "delegate" | "other";
export type ToolIconName =
  | "file"
  | "files"
  | "search"
  | "edit"
  | "write"
  | "terminal"
  | "agent"
  | "skill"
  | "web"
  | "link"
  | "todo"
  | "tools"
  | "mcp"
  | "other";

export interface FileEffect {
  path: string;
  operation: "read" | "change";
  /** Recorded replacement counts; applied only when the call succeeds. */
  added: number;
  removed: number;
}

export interface ToolAction {
  kind: ToolKind;
  verb: string;
  icon: ToolIconName;
  /** Overrides the summary for display, for example to include an MCP tool name. */
  detail?: string;
  command?: string;
  replacement?: { before: string; after: string };
  /** One effect per path per call. Empty or absent when no file activity is recorded. */
  files?: FileEffect[];
}

export type ToolStatus = "ok" | "error" | "pending";

export interface ToolResult {
  status: ToolStatus;
  /** Tool output, capped so huge outputs don't bloat the page. */
  output: string;
  truncated: boolean;
  at?: string;
}

export interface ToolStep {
  kind: "tool";
  id: string;
  name: string;
  /** One line describing the call, e.g. the command or the file path. */
  summary: string;
  action: ToolAction;
  input: unknown;
  /** What the agent wrote right before making this call. Empty when it said nothing. */
  why?: string;
  /** Recorded reasoning, when supplied by the agent; never inferred. */
  reasoning?: string;
  at: string;
  durationMs?: number;
  result?: ToolResult;
  /** Present when this call started a subagent. */
  agent?: AgentRun;
}

/**
 * Something said mid-turn: agent text not tied to a tool call, a message the person
 * sent while the agent was working, or the person interrupting.
 */
export interface NoteStep {
  kind: "note";
  from: "agent" | "user" | "interrupt" | "compaction";
  text: string;
  at: string;
}

export type Step = ToolStep | NoteStep;

export interface Turn {
  /** The person's message (or the subagent's task). Empty if the file starts mid-turn. */
  prompt: string;
  at: string;
  steps: Step[];
  /** The agent's last words in this turn. */
  final?: string;
}

export interface Stats {
  toolCalls: number;
  errors: number;
  subagents: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelUsage {
  model: string;
  messages: number;
  usage: TokenUsage;
}

export interface AgentRun {
  id: string;
  /** Explore, general-purpose, fork, code-review... */
  type: string;
  description: string;
  background: boolean;
  stoppedByUser: boolean;
  startedAt?: string;
  endedAt?: string;
  turns: Turn[];
  /** Counts for this agent only; subagents it started are counted on their own runs. */
  stats: Stats;
}

export interface Session {
  id: string;
  source: SessionSource;
  title: string;
  cwd?: string;
  branch?: string;
  startedAt?: string;
  endedAt?: string;
  costUSD?: number;
  linesAdded?: number;
  linesRemoved?: number;
  /** Recorded usage, deduplicated by the reader. Scope defaults to the complete session. */
  usage?: TokenUsage;
  usageScope?: "main";
  models?: ModelUsage[];
  turns: Turn[];
  /** Totals across the main agent and every subagent. */
  stats: Stats;
  /** Subagent transcripts we found but couldn't tie to a specific call. */
  unlinkedAgents: AgentRun[];
}

export interface SessionProject {
  /** Full directory path, or "no-project" for home/unknown working folders. */
  id: string;
  name: string;
  path?: string;
  availability: "available" | "missing" | "unknown";
}

export interface SessionSummary {
  id: string;
  source: SessionSource;
  title: string;
  firstPrompt: string;
  cwd?: string;
  /** Inferred from the working directories recorded across the session library. */
  project?: SessionProject;
  startedAt?: string;
  updatedAt: string;
  sizeBytes: number;
  subagents: number;
}

export interface SearchMatch {
  id: string;
  snippet: string;
  source: "session" | "subagent";
}
