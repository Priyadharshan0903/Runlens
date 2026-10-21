// Everything that knows Claude Code's transcript format lives in this file.
// A transcript is JSONL: one record per line. Assistant replies are split into one record
// per content block (thinking, text, tool_use), and tool results come back as "user"
// records holding tool_result blocks matched by tool_use_id.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
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

type Rec = Record<string, unknown>;

export async function* streamRecords(file: string, signal?: AbortSignal): AsyncIterable<Rec> {
  signal?.throwIfAborted();
  const input = createReadStream(file, { encoding: "utf8", signal });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      signal?.throwIfAborted();
      if (!line.trim()) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        // A half-written last line while a session is live, or a corrupt line: skip it.
        continue;
      }
      if (isRec(value)) yield value;
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

export async function readTranscript(file: string, cwd?: string): Promise<Transcript> {
  const records: Rec[] = [];
  for await (const record of streamRecords(file)) records.push(record);
  return parseRecords(records, cwd);
}

export function parseRecords(records: Rec[], cwd?: string): Transcript {
  const events: Event[] = [];
  const info: TranscriptInfo = {};
  // A resumed file can begin with tool records before its first recorded working directory.
  const callCwd = cwd ?? str(records.find((record) => str(record.cwd))?.cwd);
  let customTitle: string | undefined;
  const usage = new Map<string, UsageRecord>();
  let anonymous = 0;

  for (const r of records) {
    const at = str(r.timestamp);
    if (at) {
      info.startedAt ??= at;
      info.endedAt = at;
    }
    if (!info.cwd && str(r.cwd)) info.cwd = str(r.cwd);
    if (str(r.gitBranch) && r.gitBranch !== "HEAD") info.branch = str(r.gitBranch);

    switch (r.type) {
      case "ai-title":
        info.title = str(r.aiTitle) ?? info.title;
        break;
      case "custom-title":
        customTitle = str(r.customTitle) ?? customTitle;
        break;
      case "summary":
        info.title ??= str(r.summary);
        break;
      case "cost-state":
        info.costUSD = num(r.totalCostUSD) ?? info.costUSD;
        info.linesAdded = num(r.totalLinesAdded) ?? info.linesAdded;
        info.linesRemoved = num(r.totalLinesRemoved) ?? info.linesRemoved;
        break;
      case "user":
        parseUser(r, at ?? "", events);
        break;
      case "assistant":
        parseAssistant(r, at ?? "", events, callCwd);
        if (isRec(r.message) && isRec(r.message.usage)) {
          const m = r.message;
          const u = m.usage as Rec;
          const id = str(m.id) ?? str(r.uuid);
          const key = id ?? `anonymous-${anonymous++}`;
          const next: UsageRecord = {
            id,
            model: str(m.model) ?? "Unknown model",
            usage: {
              input: Math.max(0, num(u.input_tokens) ?? 0),
              output: Math.max(0, num(u.output_tokens) ?? 0),
              cacheRead: Math.max(0, num(u.cache_read_input_tokens) ?? 0),
              cacheWrite: Math.max(0, num(u.cache_creation_input_tokens) ?? 0),
            },
          };
          const previous = usage.get(key);
          // Content blocks and streaming snapshots can repeat a message's cumulative usage.
          if (previous)
            for (const field of Object.keys(next.usage) as (keyof TokenUsage)[]) {
              next.usage[field] = Math.max(previous.usage[field], next.usage[field]);
            }
          usage.set(key, next);
        }
        break;
      case "attachment":
        parseAttachment(r, at ?? "", events);
        break;
      case "system":
        if (r.subtype === "compact_boundary") {
          events.push({ type: "compaction", text: "Context compacted", at: at ?? "" });
        }
        break;
    }
  }

  if (customTitle) info.title = customTitle;
  if (usage.size) info.usageRecords = [...usage.values()];
  return { events, info };
}

function parseUser(r: Rec, at: string, events: Event[]) {
  if (r.isMeta || r.isCompactSummary) return;
  const content = isRec(r.message) ? r.message.content : undefined;

  if (typeof content === "string") {
    pushUserText(content, at, events);
    return;
  }
  if (!Array.isArray(content)) return;

  const texts: string[] = [];
  for (const block of content) {
    if (!isRec(block)) continue;
    if (block.type === "tool_result") {
      const meta = isRec(r.toolUseResult) ? r.toolUseResult : undefined;
      events.push({
        type: "tool_result",
        toolUseId: str(block.tool_use_id) ?? "",
        isError: block.is_error === true,
        output: contentToText(block.content),
        at,
        agentId: meta ? str(meta.agentId) : undefined,
      });
    } else if (block.type === "text" && typeof block.text === "string") {
      texts.push(block.text);
    } else if (block.type === "image") {
      texts.push("[image]");
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

function parseAssistant(r: Rec, at: string, events: Event[], cwd?: string) {
  const content = isRec(r.message) ? r.message.content : undefined;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!isRec(block)) continue;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      events.push({ type: "text", text: block.text.trim(), at });
    } else if (
      block.type === "thinking" &&
      typeof block.thinking === "string" &&
      block.thinking.trim()
    ) {
      events.push({ type: "thinking", text: block.thinking.trim(), at });
    } else if (block.type === "tool_use") {
      events.push({
        type: "tool_use",
        id: str(block.id) ?? "",
        name: str(block.name) ?? "unknown",
        input: block.input,
        ...describeTool(str(block.name) ?? "unknown", block.input, cwd),
        at,
      });
    }
  }
}

function parseAttachment(r: Rec, at: string, events: Event[]) {
  const a = isRec(r.attachment) ? r.attachment : undefined;
  if (!a || a.type !== "queued_command") return;
  const prompt = str(a.prompt)?.trim();
  // Background-agent completions also arrive this way; only keep what the person typed.
  if (prompt && !prompt.startsWith("<task-notification>")) {
    events.push({ type: "interjection", text: prompt, at });
  }
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) =>
      isRec(b)
        ? b.type === "text"
          ? (str(b.text) ?? "")
          : b.type === "image"
            ? "[image]"
            : ""
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

function tag(text: string, name: string): string | undefined {
  const m = text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m?.[1]?.trim() || undefined;
}

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
