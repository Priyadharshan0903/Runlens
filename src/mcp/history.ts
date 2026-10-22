import { stat } from "node:fs/promises";
import type { Listing } from "../core/discover.js";
import { ownEvents, type Event } from "../core/events.js";
import { buildTurns } from "../core/tree.js";
import type { SessionSummary, ToolStep, Turn } from "../core/types.js";
import type { SessionFile } from "../sources/types.js";
import {
  excerpt,
  HistoryError,
  historyPage,
  maskSecrets,
  MAX_SCAN_BYTES,
  MAX_SCAN_EVENTS,
  MAX_TRANSCRIPT_BYTES,
  requestedScope,
  scopeListing,
  type HistoryPolicy,
} from "./safety.js";

interface PageRequest {
  project?: string;
  offset?: number;
  limit?: number;
}

/** A separate projection: viewer search is deliberately broader and must not feed MCP. */
export class HistoryService {
  constructor(
    private readonly list: (signal?: AbortSignal) => Promise<Listing>,
    private readonly policy: HistoryPolicy,
  ) {
    requestedScope(policy);
    policy.allowProjects?.forEach((project) => requestedScope(policy, project));
  }

  private async scoped(project: string | undefined, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const directory = requestedScope(this.policy, project);
    const listing = await this.list(signal);
    signal?.throwIfAborted();
    return scopeListing(listing, directory);
  }

  async search(query: string, request: PageRequest = {}, signal?: AbortSignal) {
    const normalized = query.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized.length < 2 || normalized.length > 200)
      throw new HistoryError("invalid_query", "Query must contain between 2 and 200 characters.");
    const { offset, limit } = pageRequest(request);
    const { listing, project } = await this.scoped(request.project, signal);
    const budget = new ScanBudget(signal);
    const matches = [];
    let matched = 0;
    let hasMore = false;
    for (const session of listing.sessions) {
      signal?.throwIfAborted();
      const entry = listing.files.get(session.id);
      if (!entry) continue;
      let match: { excerpt: string; origin: string; at: string } | undefined;
      for await (const { source, events } of projectedFiles(entry, budget)) {
        for await (const event of events) {
          // Search only the same masked projection that can be returned. No secret oracle.
          if (event.type !== "prompt" && event.type !== "text" && event.type !== "interjection")
            continue;
          const index = event.text.toLowerCase().indexOf(normalized);
          if (index < 0) continue;
          match = {
            excerpt: event.text.slice(Math.max(0, index - 65), index + normalized.length + 130),
            origin: source,
            at: safeDate(event.at),
          };
          break;
        }
        if (match) break;
      }
      if (!match) continue;
      if (matched++ < offset) continue;
      if (matches.length === limit) {
        hasMore = true;
        break;
      }
      matches.push({ ...provenance(session), ...match });
    }
    signal?.throwIfAborted();
    return historyPage({ project: excerpt(project, 512) }, "results", matches, offset, hasMore);
  }

  async summary(id: string, request: PageRequest = {}, signal?: AbortSignal) {
    if (!/^[\w-]{1,160}$/.test(id))
      throw new HistoryError("invalid_session", "Use a session ID returned by search_sessions.");
    const { offset, limit } = pageRequest(request);
    const { listing, project } = await this.scoped(request.project, signal);
    const session = listing.sessions.find((item) => item.id === id);
    const entry = listing.files.get(id);
    if (!session || !entry)
      throw new HistoryError("session_not_found", "Session not found in the selected project.");
    const budget = new ScanBudget(signal);
    const turns = [];
    let position = 0;
    let hasMore = false;
    for await (const { source, events } of projectedFiles(entry, budget)) {
      const projected: Event[] = [];
      for await (const event of events) projected.push(event);
      for (const turn of buildTurns(projected).turns) {
        if (position++ < offset) continue;
        if (turns.length === limit) {
          hasMore = true;
          break;
        }
        turns.push({ origin: source, ...summarizeTurn(turn) });
      }
      if (hasMore) break;
    }
    signal?.throwIfAborted();
    return historyPage(
      { ...provenance(session), project: excerpt(project, 512) },
      "turns",
      turns,
      offset,
      hasMore,
    );
  }
}

function pageRequest(request: PageRequest) {
  const offset = request.offset ?? 0;
  const limit = request.limit ?? 3;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100_000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 5
  )
    throw new HistoryError("invalid_page", "Offset must be 0–100000 and limit must be 1–5.");
  return { offset, limit };
}

function safeDate(value: string | undefined) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : "";
}

function provenance(session: SessionSummary) {
  return {
    session_id: excerpt(session.id, 160),
    agent: excerpt(session.source.id, 40),
    title: excerpt(session.title, 160),
    started_at: safeDate(session.startedAt),
    updated_at: safeDate(session.updatedAt),
  };
}

class ScanBudget {
  private bytes = 0;
  private events = 0;
  constructor(readonly signal?: AbortSignal) {}

  async file(file: string) {
    this.signal?.throwIfAborted();
    const info = await stat(file);
    this.signal?.throwIfAborted();
    this.bytes += info.size;
    if (!info.isFile() || info.size > MAX_TRANSCRIPT_BYTES || this.bytes > MAX_SCAN_BYTES)
      throw new HistoryError(
        "scan_limit",
        "History scan limit reached. Narrow the project or use a known session ID.",
      );
  }

  event() {
    this.signal?.throwIfAborted();
    if (++this.events > MAX_SCAN_EVENTS)
      throw new HistoryError(
        "scan_limit",
        "History event limit reached. Narrow the project or use a known session ID.",
      );
  }
}

async function* projectedFiles(entry: SessionFile, budget: ScanBudget) {
  const recorded = new Map<string, Event[]>();
  for await (const { file, source, inheritedFile } of entry.reader.searchFiles(entry.file)) {
    await budget.file(file);
    const parent = inheritedFile ? recorded.get(inheritedFile) : undefined;
    const saved: Event[] = [];
    recorded.set(file, saved);
    yield { source, events: projectedEvents(entry, file, budget, saved, parent) };
  }
}

async function* projectedEvents(
  entry: SessionFile,
  file: string,
  budget: ScanBudget,
  saved: Event[],
  parent?: Event[],
) {
  for await (const event of entry.reader.readEvents(file, budget.signal)) {
    budget.event();
    const safe = projectEvent(event);
    if (safe) {
      saved.push(safe);
      if (!parent) yield safe;
    }
  }
  // Reuse the viewer's fork rule with scoped, masked events; never open another file here.
  if (parent) yield* ownEvents(saved, parent);
}

function projectEvent(event: Event): Event | undefined {
  switch (event.type) {
    case "prompt":
    case "interjection":
    case "text":
      return { ...event, text: maskSecrets(event.text).replace(/\s+/g, " ").trim() };
    case "interrupt":
      return event;
    case "tool_use":
      return {
        type: "tool_use",
        id: event.id,
        name: excerpt(event.name, 80),
        at: event.at,
        input: null,
        summary: "",
        action: {
          kind: event.action.kind,
          verb: "",
          icon: event.action.icon,
          files: event.action.files
            ?.filter((file) => file.operation === "change")
            .map((file) => ({
              path: excerpt(file.path, 200),
              operation: "change",
              added: safeCount(file.added),
              removed: safeCount(file.removed),
            })),
        },
      };
    case "tool_result":
      // Even an error's first line may contain fetched text or a printed credential.
      return {
        type: "tool_result",
        toolUseId: event.toolUseId,
        isError: event.isError,
        output: "",
        at: event.at,
      };
    // Thinking, fetched payloads, tool inputs, patches and compaction bodies never become excerpts.
    default:
      return undefined;
  }
}

function safeCount(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function summarizeTurn(turn: Turn) {
  const tools = turn.steps.filter((step): step is ToolStep => step.kind === "tool");
  const changes = tools.flatMap((tool) =>
    tool.result?.status === "ok" ? (tool.action.files ?? []) : [],
  );
  const failures = tools.filter((tool) => tool.result?.status === "error");
  return {
    at: safeDate(turn.at),
    asked: excerpt(turn.prompt, 480),
    recorded_answer: excerpt(turn.final ?? "", 800),
    changes: changes
      .slice(0, 8)
      .map((file) => ({ path: file.path, added: file.added, removed: file.removed })),
    omitted_changes: Math.max(0, changes.length - 8),
    failures: failures
      .slice(0, 8)
      .map((tool) => ({ tool: tool.name, at: safeDate(tool.at), status: "error" })),
    omitted_failures: Math.max(0, failures.length - 8),
    tool_calls: tools.length,
  };
}
