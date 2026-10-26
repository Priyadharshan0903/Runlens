// Everything that knows Claude Code's transcript format lives in this file.
// A transcript is JSONL: one record per line. Assistant replies are split into one record
// per content block (thinking, text, tool_use), and tool results come back as "user"
// records holding tool_result blocks matched by tool_use_id.

import { streamRecords } from "../jsonl.js";
export { streamRecords } from "../jsonl.js";
import type { Event } from "../../core/events.js";
import { describeTool } from "./tools.js";
import type { TokenUsage } from "../../core/types.js";

export interface TranscriptInfo {
  title?: string;
  cwd?: string;
  branch?: string;
  startedAt?: string;
  endedAt?: string;
  costUSD?: number;
  linesAdded?: number;
  linesRemoved?: number;
  usageRecords?: UsageRecord[];
}

export interface UsageRecord {
  id?: string;
  model: string;
  usage: TokenUsage;
}

export interface Transcript {
  events: Event[];
  info: TranscriptInfo;
}

type TranscriptRecord = Record<string, unknown>;

export async function readTranscript(file: string, cwd?: string): Promise<Transcript> {
  const records: TranscriptRecord[] = [];
  for await (const record of streamRecords(file)) records.push(record);
  return parseRecords(records, cwd);
}

export function parseRecords(records: TranscriptRecord[], cwd?: string): Transcript {
  const events: Event[] = [];
  const info: TranscriptInfo = {};
  // A resumed file can begin with tool records before its first recorded working directory.
  const callCwd = cwd ?? optionalString(records.find((record) => optionalString(record.cwd))?.cwd);
  let customTitle: string | undefined;
  const usage = new Map<string, UsageRecord>();
  let anonymous = 0;

  for (const record of records) {
    const at = optionalString(record.timestamp);
    if (at) {
      info.startedAt ??= at;
      info.endedAt = at;
    }
    if (!info.cwd && optionalString(record.cwd)) info.cwd = optionalString(record.cwd);
    if (optionalString(record.gitBranch) && record.gitBranch !== "HEAD")
      info.branch = optionalString(record.gitBranch);

    switch (record.type) {
      case "ai-title":
        info.title = optionalString(record.aiTitle) ?? info.title;
        break;
      case "custom-title":
        customTitle = optionalString(record.customTitle) ?? customTitle;
        break;
      case "summary":
        info.title ??= optionalString(record.summary);
        break;
      case "cost-state":
        info.costUSD = finiteNumber(record.totalCostUSD) ?? info.costUSD;
        info.linesAdded = finiteNumber(record.totalLinesAdded) ?? info.linesAdded;
        info.linesRemoved = finiteNumber(record.totalLinesRemoved) ?? info.linesRemoved;
        break;
      case "user":
        parseUser(record, at ?? "", events);
        break;
      case "assistant": {
        parseAssistant(record, at ?? "", events, callCwd);
        const nextUsage = parseUsage(record);
        if (nextUsage) {
          const key = nextUsage.id ?? `anonymous-${anonymous++}`;
          usage.set(key, mergeUsage(usage.get(key), nextUsage));
        }
        break;
      }
      case "attachment":
        parseAttachment(record, at ?? "", events);
        break;
      case "system":
        if (record.subtype === "compact_boundary") {
          events.push({ type: "compaction", text: "Context compacted", at: at ?? "" });
        }
        break;
    }
  }

  if (customTitle) info.title = customTitle;
  if (usage.size) info.usageRecords = [...usage.values()];
  return { events, info };
}

function parseUsage(record: TranscriptRecord): UsageRecord | undefined {
  const message = record.message;
  if (!isRecord(message) || !isRecord(message.usage)) return undefined;
  const usage = message.usage;
  return {
    id: optionalString(message.id) ?? optionalString(record.uuid),
    model: optionalString(message.model) ?? "Unknown model",
    usage: {
      input: Math.max(0, finiteNumber(usage.input_tokens) ?? 0),
      output: Math.max(0, finiteNumber(usage.output_tokens) ?? 0),
      cacheRead: Math.max(0, finiteNumber(usage.cache_read_input_tokens) ?? 0),
      cacheWrite: Math.max(0, finiteNumber(usage.cache_creation_input_tokens) ?? 0),
    },
  };
}

/** Content blocks and streaming snapshots can repeat a message's cumulative usage. */
function mergeUsage(previous: UsageRecord | undefined, next: UsageRecord): UsageRecord {
  if (!previous) return next;
  for (const field of Object.keys(next.usage) as (keyof TokenUsage)[]) {
    next.usage[field] = Math.max(previous.usage[field], next.usage[field]);
  }
  return next;
}

function parseUser(record: TranscriptRecord, at: string, events: Event[]) {
  if (record.isMeta || record.isCompactSummary) return;
  const content = isRecord(record.message) ? record.message.content : undefined;

  if (typeof content === "string") {
    pushUserText(content, at, events);
    return;
  }
  if (!Array.isArray(content)) return;

  const texts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    switch (block.type) {
      case "tool_result": {
        const meta = isRecord(record.toolUseResult) ? record.toolUseResult : undefined;
        events.push({
          type: "tool_result",
          toolUseId: optionalString(block.tool_use_id) ?? "",
          isError: block.is_error === true,
          output: contentToText(block.content),
          at,
          agentId: meta ? optionalString(meta.agentId) : undefined,
        });
        break;
      }
      case "text":
        if (typeof block.text === "string") texts.push(block.text);
        break;
      case "image":
        texts.push("[image]");
        break;
    }
  }
  if (texts.length) pushUserText(texts.join("\n"), at, events);
}

function pushUserText(raw: string, at: string, events: Event[]) {
  const text = raw.trim();
  if (!text) return;
  if (text.startsWith("[Request interrupted")) {
    events.push({ type: "interrupt", at });
    return;
  }
  // Output of local slash commands and other harness bookkeeping, not something the person typed.
  if (
    /^<(local-command-stdout|local-command-stderr|local-command-caveat|task-notification|system-reminder)>/.test(
      text,
    )
  ) {
    return;
  }
  const command = tag(text, "command-name");
  if (command) {
    const args = tag(text, "command-args");
    events.push({ type: "prompt", text: args ? `${command} ${args}` : command, at });
    return;
  }
  events.push({ type: "prompt", text: cleanPastes(text), at });
}

/** Pasted blocks are wrapped in <pasted_content id="…"> tags; show them as plain marked text. */
function cleanPastes(text: string): string {
  return text
    .replace(/<pasted_content[^>]*>\n?/g, "\n┄┄ pasted ┄┄\n")
    .replace(/\n?<\/pasted_content[^>]*>/g, "\n┄┄ end of paste ┄┄\n")
    .trim();
}

function parseAssistant(record: TranscriptRecord, at: string, events: Event[], cwd?: string) {
  const content = isRecord(record.message) ? record.message.content : undefined;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!isRecord(block)) continue;
    switch (block.type) {
      case "text": {
        const text = optionalString(block.text)?.trim();
        if (text) events.push({ type: "text", text, at });
        break;
      }
      case "thinking": {
        const text = optionalString(block.thinking)?.trim();
        if (text) events.push({ type: "thinking", text, at });
        break;
      }
      case "tool_use": {
        const name = optionalString(block.name) ?? "unknown";
        events.push({
          type: "tool_use",
          id: optionalString(block.id) ?? "",
          name,
          input: block.input,
          ...describeTool(name, block.input, cwd),
          at,
        });
        break;
      }
    }
  }
}

function parseAttachment(record: TranscriptRecord, at: string, events: Event[]) {
  const attachment = isRecord(record.attachment) ? record.attachment : undefined;
  if (!attachment || attachment.type !== "queued_command") return;
  const prompt = optionalString(attachment.prompt)?.trim();
  // Background-agent completions also arrive this way; only keep what the person typed.
  if (prompt && !prompt.startsWith("<task-notification>")) {
    events.push({ type: "interjection", text: prompt, at });
  }
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!isRecord(block)) return "";
      if (block.type === "text") return optionalString(block.text) ?? "";
      if (block.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function tag(text: string, name: string): string | undefined {
  const match = text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match?.[1]?.trim() || undefined;
}

function isRecord(value: unknown): value is TranscriptRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
