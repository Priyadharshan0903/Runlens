import type { Listing } from "../core/discover.js";
import type { Event } from "../core/events.js";
import { buildTurns } from "../core/tree.js";
import type { SessionSummary, ToolStep, Turn } from "../core/types.js";
import type { SessionFile } from "../sources/types.js";
import { HistoryPagination } from "./pagination.js";
import { ScanBudget, type ScanPause, type ScanRecord } from "./scan.js";
import {
  excerpt,
  HistoryError,
  maskSecrets,
  requestedScope,
  scopeListing,
  type HistoryPolicy,
} from "./safety.js";

interface PageRequest {
  project?: string;
  offset?: number;
  limit?: number;
  cursor?: string;
}

/** A separate projection: viewer search is deliberately broader and must not feed MCP. */
export class HistoryService {
  private readonly pagination = new HistoryPagination();

  constructor(
    private readonly list: (signal?: AbortSignal) => Promise<Listing>,
    private readonly policy: HistoryPolicy,
  ) {
    requestedScope(policy);
    policy.allowProjects?.forEach((project) => requestedScope(policy, project));
  }

  get defaultProject(): string {
    return requestedScope(this.policy);
  }

  close() {
    this.pagination.close();
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
    const directory = requestedScope(this.policy, request.project);
    const key = JSON.stringify(["search", directory, normalized]);
    if (request.cursor) return this.pagination.resume(request.cursor, key, limit, signal);
    const { listing, project } = await this.scoped(request.project, signal);
    const budget = new ScanBudget();
    return this.pagination.page(
      {
        key,
        base: { project: excerpt(project, 512) },
        field: "results",
        budget,
        iterator: searchSessions(listing, normalized, budget),
        offset,
        remainingOffset: offset,
      },
      limit,
      signal,
    );
  }

  async summary(id: string, request: PageRequest = {}, signal?: AbortSignal) {
    if (!/^[\w-]{1,160}$/.test(id))
      throw new HistoryError("invalid_session", "Use a session ID returned by search_sessions.");
    const { offset, limit } = pageRequest(request);
    const directory = requestedScope(this.policy, request.project);
    const key = JSON.stringify(["summary", directory, id]);
    if (request.cursor) return this.pagination.resume(request.cursor, key, limit, signal);
    const { listing, project } = await this.scoped(request.project, signal);
    const session = listing.sessions.find((item) => item.id === id);
    const entry = listing.files.get(id);
    if (!session || !entry)
      throw new HistoryError("session_not_found", "Session not found in the selected project.");
    const budget = new ScanBudget();
    return this.pagination.page(
      {
        key,
        base: { ...provenance(session), project: excerpt(project, 512) },
        field: "turns",
        budget,
        iterator: summaryTurns(entry, budget),
        offset,
        remainingOffset: offset,
      },
      limit,
      signal,
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
    limit > 5 ||
    (request.cursor !== undefined &&
      (!/^[\da-f-]{36}$/.test(request.cursor) || request.offset !== undefined))
  )
    throw new HistoryError(
      "invalid_page",
      "Offset must be 0–100000 and limit must be 1–5. Use cursor without offset.",
    );
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

async function* searchSessions(
  listing: Listing,
  query: string,
  budget: ScanBudget,
): AsyncGenerator<ScanRecord> {
  for (const [index, session] of listing.sessions.entries()) {
    budget.signal.throwIfAborted();
    const entry = listing.files.get(session.id);
    if (!entry) continue;
    let match: { excerpt: string; origin: string; at: string } | undefined;
    for await (const file of projectedFiles(entry, budget)) {
      if (file.kind === "pause") {
        yield file;
        continue;
      }
      for await (const event of file.events) {
        if ("kind" in event) {
          yield event;
          continue;
        }
        // Match the same masked projection that can be returned. No secret oracle.
        if (event.type !== "prompt" && event.type !== "text" && event.type !== "interjection")
          continue;
        const position = event.text.toLowerCase().indexOf(query);
        if (position < 0) continue;
        match = {
          excerpt: event.text.slice(Math.max(0, position - 65), position + query.length + 130),
          origin: file.source,
          at: safeDate(event.at),
        };
        break;
      }
      if (match) break;
    }
    budget.progress.sessions_completed++;
    if (match)
      yield {
        kind: "item",
        value: { ...provenance(session), ...match },
        last: index === listing.sessions.length - 1,
      };
  }
}

async function* summaryTurns(entry: SessionFile, budget: ScanBudget): AsyncGenerator<ScanRecord> {
  for await (const file of projectedFiles(entry, budget)) {
    if (file.kind === "pause") {
      yield file;
      continue;
    }
    let projected: Event[] = [];
    const pendingCalls = new Set<string>();
    for await (const event of file.events) {
      if ("kind" in event) {
        yield event;
        continue;
      }
      // Wait for outstanding calls so results crossing a prompt still belong to their call.
      if (event.type === "tool_use") pendingCalls.add(event.id);
      if (event.type === "tool_result") pendingCalls.delete(event.toolUseId);
      if (event.type === "prompt" && projected.length && !pendingCalls.size) {
        const turns = buildTurns(projected).turns;
        projected = [event];
        for (const turn of turns)
          yield {
            kind: "item",
            value: { origin: file.source, ...summarizeTurn(turn) },
            last: false,
          };
      } else projected.push(event);
    }
    if (file.last) budget.progress.sessions_completed++;
    const turns = buildTurns(projected).turns;
    for (const [index, turn] of turns.entries())
      yield {
        kind: "item",
        value: { origin: file.source, ...summarizeTurn(turn) },
        last: file.last && index === turns.length - 1,
      };
  }
  // A skipped final file may leave no turn on which to report completion.
  budget.progress.sessions_completed = 1;
}

async function* projectedFiles(
  entry: SessionFile,
  budget: ScanBudget,
): AsyncGenerator<
  | ScanPause
  | {
      kind: "file";
      source: string;
      last: boolean;
      events: AsyncGenerator<Event | ScanPause>;
    }
> {
  const files = [];
  for await (const file of entry.reader.searchFiles(entry.file)) {
    budget.signal.throwIfAborted();
    files.push(file);
  }
  const recorded = new Map<string, Event[]>();
  const parents = new Set(files.map((file) => file.inheritedFile));
  for (const [index, { file, source, inheritedFile }] of files.entries()) {
    const parent = inheritedFile ? recorded.get(inheritedFile) : undefined;
    if (inheritedFile && !parent) {
      budget.skip(entry.id, source, "inherited_transcript_unavailable");
      continue;
    }
    if (!(yield* budget.file(file, entry.id, source))) continue;
    const saved = parents.has(file) ? ([] as Event[]) : undefined;
    if (saved) recorded.set(file, saved);
    yield {
      kind: "file",
      source,
      last: index === files.length - 1,
      events: projectedEvents(entry, file, budget, saved, parent),
    };
  }
}

async function* projectedEvents(
  entry: SessionFile,
  file: string,
  budget: ScanBudget,
  saved: Event[] | undefined,
  parent?: Event[],
): AsyncGenerator<Event | ScanPause> {
  let prefix = 0;
  let replay = !!parent;
  let firstOwn = true;
  const inheritedCalls = new Set(
    parent?.filter((event) => event.type === "tool_use").map((event) => event.id),
  );
  for await (const event of budget.read(entry.reader.readEvents(file, budget.signal))) {
    if ("kind" in event) {
      yield event;
      continue;
    }
    const safe = projectEvent(event);
    if (!safe) continue;
    saved?.push(safe);
    // Stream the viewer's ownEvents rule without buffering the entire fork first.
    if (replay && JSON.stringify(safe) === JSON.stringify(parent?.[prefix])) {
      prefix++;
      continue;
    }
    replay = false;
    if (
      (safe.type === "tool_use" && inheritedCalls.has(safe.id)) ||
      (safe.type === "tool_result" && inheritedCalls.has(safe.toolUseId))
    )
      continue;
    yield firstOwn && parent && safe.type === "interjection" ? { ...safe, type: "prompt" } : safe;
    firstOwn = false;
  }
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
