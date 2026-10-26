import type { Event } from "../../core/events.js";
import type { ModelUsage, TokenUsage } from "../../core/types.js";
import { streamRecords } from "../jsonl.js";
import { completedTool, describeTool } from "./tools.js";

type RecordValue = Record<string, unknown>;
type ToolCallEvent = Extract<Event, { type: "tool_use" }>;

interface PendingOrchestration {
  call: ToolCallEvent;
  events: Event[];
}

export interface CodexInfo {
  id?: string;
  cwd?: string;
  branch?: string;
  startedAt?: string;
  endedAt?: string;
  parentId?: string;
  agentType?: string;
  agentPath?: string;
}

/** Decoder state belongs to one file, including deduplication and cumulative usage. */
export class CodexDecoder {
  readonly info: CodexInfo = {};
  private seen = new Set<string>();
  private model = "Unknown model";
  private previousUsage?: TokenUsage;
  private models = new Map<string, ModelUsage>();
  private hasPrompt = false;
  private orchestration = new Map<string, PendingOrchestration>();

  decode(record: RecordValue): Event[] {
    const payload = object(record.payload);
    const at = string(record.timestamp);
    if (at) {
      this.info.startedAt ??= at;
      this.info.endedAt = at;
    }
    switch (record.type) {
      case "session_meta":
        this.recordSessionInfo(payload);
        return [];
      case "turn_context":
        this.info.cwd ??= string(payload.cwd) || undefined;
        this.model = string(payload.model) || this.model;
        return [];
      case "compacted":
        // replacement_history repeats old messages; the marker is the only new event.
        return [...this.finish(), { type: "compaction", text: "Context compacted", at }];
      case "event_msg":
        return this.decodeEventMessage(payload, at);
      case "response_item":
        return this.decodeResponseItem(payload, at);
      default:
        return [];
    }
  }

  private recordSessionInfo(payload: RecordValue) {
    // Forks may replay parent metadata after their own identity has already been recorded.
    if (this.info.id) return;
    this.info.id = string(payload.id) || string(payload.session_id) || undefined;
    this.info.cwd = string(payload.cwd) || undefined;
    this.info.branch = string(object(payload.git).branch) || undefined;
    const source = object(payload.source);
    const parent = object(object(source.subagent).thread_spawn);
    this.info.parentId = string(parent.parent_thread_id) || undefined;
    this.info.agentType = string(parent.agent_role) || string(parent.agent_path) || undefined;
    this.info.agentPath = string(parent.agent_path) || undefined;
  }

  private decodeEventMessage(payload: RecordValue, at: string): Event[] {
    switch (payload.type) {
      case "token_count":
        this.recordUsage(object(object(payload.info).total_token_usage));
        return [];
      case "turn_aborted":
        return [{ type: "interrupt", at }];
      case "item_completed":
        return this.decodeCompletedTool(payload, at);
      default:
        // Message/task completion records mirror response items.
        return [];
    }
  }

  private decodeCompletedTool(payload: RecordValue, at: string): Event[] {
    const item = object(payload.item);
    const id = string(item.id);
    const tool = completedTool(item, this.info.cwd);
    if (!tool || !id) return [];

    const alreadySeen = ["native", "function_call", "custom_tool_call"].some((type) =>
      this.seen.has(`${type}:${id}`),
    );
    if (alreadySeen) return [];
    this.seen.add(`native:${id}`);

    const { name, input, summary, action, output, isError } = tool;
    const startedAt = timestampFromMilliseconds(payload.started_at_ms, at);
    const completedAt = timestampFromMilliseconds(payload.completed_at_ms, at);
    const events: Event[] = [
      { type: "tool_use", id, name, input, summary, action, at: startedAt },
      { type: "tool_result", toolUseId: id, output, isError, at: completedAt },
    ];

    // Attribute concrete operations only when there is a single enclosing exec call.
    if (this.orchestration.size !== 1) return events;
    const pending = this.orchestration.values().next().value!;
    pending.events.push(...events);
    return [];
  }

  private decodeResponseItem(payload: RecordValue, at: string): Event[] {
    const type = string(payload.type);
    const id = string(payload.call_id) || string(payload.id);
    const key = id ? `${type}:${id}` : undefined;
    if (key && this.seen.has(key)) return [];
    if (key) this.seen.add(key);

    switch (type) {
      case "message":
        return this.decodeMessage(payload, at);
      case "agent_message":
        return this.decodeAgentMessage(payload, at);
      case "reasoning": {
        const text = messageText(payload.summary);
        // Encrypted/raw reasoning is neither decrypted nor inferred.
        return text ? [{ type: "thinking", text, at }] : [];
      }
      case "function_call":
      case "custom_tool_call":
        return id ? this.decodeToolCall(payload, id, at) : [];
      case "function_call_output":
      case "custom_tool_call_output":
        return id ? this.decodeToolResult(payload, id, at) : [];
      default:
        return [];
    }
  }

  private decodeMessage(payload: RecordValue, at: string): Event[] {
    if (payload.role !== "user" && payload.role !== "assistant") return [];
    const content = messageText(payload.content);
    const text = payload.role === "user" ? userText(content) : content;
    if (!text) return [];
    if (payload.role === "assistant") return [{ type: "text", text, at }];

    this.hasPrompt = true;
    return [...this.finish(), { type: "prompt", text, at }];
  }

  private decodeAgentMessage(payload: RecordValue, at: string): Event[] {
    const text = messageText(payload.content);
    if (!text) return [];
    if (!this.info.parentId) {
      return [{ type: "text", text: `${string(payload.author) || "Subagent"}:\n${text}`, at }];
    }

    const type = this.hasPrompt ? "interjection" : "prompt";
    this.hasPrompt = true;
    return [{ type, text, at }];
  }

  private decodeToolCall(payload: RecordValue, id: string, at: string): Event[] {
    const name = [string(payload.namespace), string(payload.name)].filter(Boolean).join(".");
    const input = toolInput(payload);
    const call: ToolCallEvent = {
      type: "tool_use",
      id,
      name,
      input,
      ...describeTool(name, input, this.info.cwd),
      at,
    };
    if (name.split(".").at(-1) !== "exec") return [call];

    this.orchestration.set(id, { call, events: [] });
    return [];
  }

  private decodeToolResult(payload: RecordValue, id: string, at: string): Event[] {
    const output = outputText(payload.output);
    const parsed = parseOutput(typeof payload.output === "string" ? payload.output : output);
    const isError = toolOutputFailed(parsed, output);
    const result: Event = {
      type: "tool_result",
      toolUseId: id,
      output,
      isError,
      agentId: string(parsed.agent_id) || string(parsed.task_name) || undefined,
      at,
    };
    const pending = this.orchestration.get(id);
    if (!pending) return [result];

    this.orchestration.delete(id);
    // Concrete operations replace a successful wrapper, but a failed wrapper stays visible.
    if (pending.events.length && !isError) return pending.events;
    return [...pending.events, pending.call, result];
  }

  finish(): Event[] {
    const events = [...this.orchestration.values()].flatMap((pending) =>
      pending.events.length ? pending.events : [pending.call],
    );
    this.orchestration.clear();
    return events;
  }

  usage(): { usage?: TokenUsage; models: ModelUsage[] } {
    const models = [...this.models.values()];
    const usage = models.length ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } : undefined;
    for (const model of models) {
      for (const key of Object.keys(model.usage) as (keyof TokenUsage)[]) {
        usage![key] += model.usage[key];
      }
    }
    return { usage, models };
  }

  private recordUsage(raw: RecordValue) {
    if (typeof raw.input_tokens !== "number" || typeof raw.output_tokens !== "number") return;
    const cacheRead = count(raw.cached_input_tokens);
    const cacheWrite = count(raw.cache_write_input_tokens);
    const next: TokenUsage = {
      input: Math.max(0, count(raw.input_tokens) - cacheRead - cacheWrite),
      output: count(raw.output_tokens),
      cacheRead,
      cacheWrite,
    };
    // Cumulative snapshots and their companion token_usage_record are not individual requests.
    const model = this.models.get(this.model) ?? {
      model: this.model,
      messages: 0,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    let changed = false;
    const previous = this.previousUsage;
    for (const key of Object.keys(next) as (keyof TokenUsage)[]) {
      const delta = Math.max(0, next[key] - (previous?.[key] ?? 0));
      changed ||= delta > 0;
      model.usage[key] += delta;
      next[key] = Math.max(next[key], previous?.[key] ?? 0);
    }
    if (changed) model.messages++;
    this.previousUsage = next;
    this.models.set(this.model, model);
  }
}

export async function readTranscript(file: string) {
  const decoder = new CodexDecoder();
  const events: Event[] = [];
  for await (const record of streamRecords(file)) events.push(...decoder.decode(record));
  events.push(...decoder.finish());
  return { info: decoder.info, events, ...decoder.usage() };
}

export function userText(text: string): string {
  // These are injected context messages, not questions a person asked.
  if (/^# AGENTS\.md instructions\b/.test(text)) return "";
  return text
    .replace(
      /<(environment_context|permissions instructions|skill|turn_aborted|external_codex_apps_open_page)>[\s\S]*?<\/\1>/g,
      "",
    )
    .trim();
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((value) => {
      const block = object(value);
      if (["input_text", "output_text", "text", "summary_text"].includes(string(block.type)))
        return string(block.text);
      if (["input_image", "image"].includes(string(block.type))) return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function parseOutput(value: unknown): RecordValue {
  if (typeof value !== "string") return object(value);
  try {
    return object(JSON.parse(value));
  } catch {
    return {};
  }
}

function toolInput(payload: RecordValue): unknown {
  if (payload.type !== "function_call") return payload.input;
  if (typeof payload.arguments !== "string") return payload.arguments;
  try {
    return JSON.parse(payload.arguments);
  } catch {
    // Preserve unfamiliar or partial input for inspection.
    return payload.arguments;
  }
}

function toolOutputFailed(parsed: RecordValue, output: string): boolean {
  if (parsed.isError === true || parsed.is_error === true) return true;
  const metadata = object(parsed.metadata);
  if (typeof metadata.exit_code === "number" && metadata.exit_code !== 0) return true;
  const exit = output.match(/(?:Process exited with code|Exit code:)\s*(-?\d+)/i);
  if (exit !== null && Number(exit[1]) !== 0) return true;
  return /^Error(?: executing|:)/i.test(output);
}

function timestampFromMilliseconds(value: unknown, fallback: string): string {
  return typeof value === "number" ? new Date(value).toISOString() : fallback;
}

function outputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return messageText(value) || JSON.stringify(value);
  return value === undefined ? "" : JSON.stringify(value);
}

function object(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}
