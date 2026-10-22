import type { Event } from "../../core/events.js";
import type { ModelUsage, TokenUsage } from "../../core/types.js";
import { streamRecords } from "../jsonl.js";
import { completedTool, describeTool } from "./tools.js";

type RecordValue = Record<string, unknown>;

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
  private orchestration = new Map<
    string,
    { call: Extract<Event, { type: "tool_use" }>; events: Event[] }
  >();

  decode(record: RecordValue): Event[] {
    const payload = object(record.payload);
    const at = string(record.timestamp);
    if (at) {
      this.info.startedAt ??= at;
      this.info.endedAt = at;
    }
    if (record.type === "session_meta" && !this.info.id) {
      this.info.id = string(payload.id) || string(payload.session_id) || undefined;
      this.info.cwd = string(payload.cwd) || undefined;
      this.info.branch = string(object(payload.git).branch) || undefined;
      const parent = object(object(object(payload.source).subagent).thread_spawn);
      this.info.parentId = string(parent.parent_thread_id) || undefined;
      this.info.agentType = string(parent.agent_role) || string(parent.agent_path) || undefined;
      this.info.agentPath = string(parent.agent_path) || undefined;
    }
    if (record.type === "turn_context") {
      this.info.cwd ??= string(payload.cwd) || undefined;
      this.model = string(payload.model) || this.model;
    }
    if (record.type === "compacted") {
      // replacement_history repeats old messages; the marker is the only new event.
      return [...this.finish(), { type: "compaction", text: "Context compacted", at }];
    }
    if (record.type === "event_msg") {
      if (payload.type === "token_count")
        this.recordUsage(object(object(payload.info).total_token_usage));
      if (payload.type === "turn_aborted") return [{ type: "interrupt", at }];
      if (payload.type === "item_completed") {
        const item = object(payload.item);
        const id = string(item.id);
        const tool = completedTool(item, this.info.cwd);
        if (
          tool &&
          id &&
          !this.seen.has(`native:${id}`) &&
          !this.seen.has(`function_call:${id}`) &&
          !this.seen.has(`custom_tool_call:${id}`)
        ) {
          this.seen.add(`native:${id}`);
          const { name, input, summary, action, output, isError } = tool;
          const start =
            typeof payload.started_at_ms === "number"
              ? new Date(payload.started_at_ms).toISOString()
              : at;
          const end =
            typeof payload.completed_at_ms === "number"
              ? new Date(payload.completed_at_ms).toISOString()
              : at;
          const events: Event[] = [
            { type: "tool_use", id, name, input, summary, action, at: start },
            { type: "tool_result", toolUseId: id, output, isError, at: end },
          ];
          // Replace a single enclosing exec script with its recorded operations, preserving order.
          const pending =
            this.orchestration.size === 1 ? this.orchestration.values().next().value : undefined;
          if (pending) pending.events.push(...events);
          else return events;
        }
      }
      // Message/task completion records mirror response items.
      return [];
    }
    if (record.type !== "response_item") return [];

    const type = string(payload.type);
    const id = string(payload.call_id) || string(payload.id);
    const key = id ? `${type}:${id}` : undefined;
    if (key && this.seen.has(key)) return [];
    if (key) this.seen.add(key);

    if (type === "message") {
      if (payload.role !== "user" && payload.role !== "assistant") return [];
      const text = messageText(payload.content);
      const visible = payload.role === "user" ? userText(text) : text;
      if (visible && payload.role === "user") {
        this.hasPrompt = true;
        return [...this.finish(), { type: "prompt", text: visible, at }];
      }
      return visible
        ? [{ type: payload.role === "user" ? "prompt" : "text", text: visible, at }]
        : [];
    }
    if (type === "agent_message") {
      const text = messageText(payload.content);
      if (!text) return [];
      if (this.info.parentId) {
        const type = this.hasPrompt ? "interjection" : "prompt";
        this.hasPrompt = true;
        return [{ type, text, at }];
      }
      return [{ type: "text", text: `${string(payload.author) || "Subagent"}:\n${text}`, at }];
    }
    if (type === "reasoning") {
      const text = messageText(payload.summary);
      // Encrypted/raw reasoning is neither decrypted nor inferred.
      return text ? [{ type: "thinking", text, at }] : [];
    }
    if (type === "function_call" || type === "custom_tool_call") {
      if (!id) return [];
      const name = [string(payload.namespace), string(payload.name)].filter(Boolean).join(".");
      let input: unknown = type === "function_call" ? payload.arguments : payload.input;
      if (typeof input === "string" && type === "function_call") {
        try {
          input = JSON.parse(input);
        } catch {
          // Preserve unfamiliar or partial input for inspection.
        }
      }
      const call: Extract<Event, { type: "tool_use" }> = {
        type: "tool_use",
        id,
        name,
        input,
        ...describeTool(name, input, this.info.cwd),
        at,
      };
      if (name.split(".").at(-1) === "exec") {
        this.orchestration.set(id, { call, events: [] });
        return [];
      }
      return [call];
    }
    if (type === "function_call_output" || type === "custom_tool_call_output") {
      if (!id) return [];
      const output = outputText(payload.output);
      const parsed = parseOutput(typeof payload.output === "string" ? payload.output : output);
      const exit = output.match(/(?:Process exited with code|Exit code:)\s*(-?\d+)/i);
      const metadata = object(parsed.metadata);
      const isError =
        parsed.isError === true ||
        parsed.is_error === true ||
        (typeof metadata.exit_code === "number" && metadata.exit_code !== 0) ||
        (exit !== null && Number(exit[1]) !== 0) ||
        /^Error(?: executing|:)/i.test(output);
      const result: Event = {
        type: "tool_result",
        toolUseId: id,
        output,
        isError,
        agentId: string(parsed.agent_id) || string(parsed.task_name) || undefined,
        at,
      };
      const pending = this.orchestration.get(id);
      if (pending) {
        this.orchestration.delete(id);
        return pending.events.length && !isError
          ? pending.events
          : [...pending.events, pending.call, result];
      }
      return [result];
    }
    return [];
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
