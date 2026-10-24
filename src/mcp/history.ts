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
  MAX_RECORD_BYTES,
  MAX_PROJECTION_BYTES,
  maskSecrets,
  requestedScope,
  scopeListing,
  type HistoryPolicy,
} from "./safety.js";

/** A complete scan of nothing reads like "no prior work"; say the scope itself is empty. */
const EMPTY_SCOPE =
  "No recorded sessions ran in this project scope, so nothing was searched. Check that the project is the folder those sessions ran in.";

interface PageRequest {
  project?: string;
  offset?: number;
  limit?: number;
  cursor?: string;
}

interface SearchRequest extends PageRequest {
  include_turns?: boolean;
}

interface SummaryRequest extends PageRequest {
  query?: string;
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

  async search(query: string, request: SearchRequest = {}, signal?: AbortSignal) {
    const normalized = normalizeQuery(query);
    const { offset, limit } = pageRequest(request);
    const directory = requestedScope(this.policy, request.project);
    const includeTurns = request.include_turns ?? false;
    const key = JSON.stringify(["search", directory, normalized, includeTurns]);
    if (request.cursor) return this.pagination.resume(request.cursor, key, limit, signal);
    const { listing, project } = await this.scoped(request.project, signal);
    const budget = new ScanBudget();
    return this.pagination.page(
      {
        key,
        base: {
          project: excerpt(project, 512),
          ...(listing.sessions.length ? {} : { scope_warning: EMPTY_SCOPE }),
        },
        field: "results",
        budget,
        iterator: searchSessions(listing, normalized, budget, includeTurns),
        offset,
        remainingOffset: offset,
      },
      limit,
      signal,
    );
  }

  async summary(id: string, request: SummaryRequest = {}, signal?: AbortSignal) {
    if (!/^[\w-]{1,160}$/.test(id))
      throw new HistoryError("invalid_session", "Use a session ID returned by search_sessions.");
    const query = request.query === undefined ? undefined : normalizeQuery(request.query);
    const { offset, limit } = pageRequest(request, 10, 50);
    const directory = requestedScope(this.policy, request.project);
    const key = JSON.stringify(["summary", directory, id, query]);
    if (request.cursor) return this.pagination.resume(request.cursor, key, limit, signal);
    const { listing, project } = await this.scoped(request.project, signal);
    const session = listing.sessions.find((item) => item.id === id);
    const entry = listing.files.get(id);
    if (!session || !entry)
      throw new HistoryError(
        "session_not_found",
        listing.sessions.length
          ? "Session not found in the selected project."
          : `Session not found. ${EMPTY_SCOPE}`,
      );
    const budget = new ScanBudget();
    return this.pagination.page(
      {
        key,
        base: { ...provenance(session), project: excerpt(project, 512) },
        field: "turns",
        budget,
        iterator: summaryTurns(entry, budget, query),
        offset,
        remainingOffset: offset,
      },
      limit,
      signal,
    );
  }
}

function normalizeQuery(query: string) {
  const normalized = query.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized.length < 2 || normalized.length > 200)
    throw new HistoryError("invalid_query", "Query must contain between 2 and 200 characters.");
  return normalized;
}

function pageRequest(request: PageRequest, defaultLimit = 3, maxLimit = 5) {
  const offset = request.offset ?? 0;
  const limit = request.limit ?? defaultLimit;
  if (request.cursor !== undefined && request.offset !== undefined)
    throw new HistoryError(
      "invalid_page",
      "Pass either cursor or offset, not both. Follow next_cursor alone; use offset only to restart from next_offset.",
    );
  if (request.cursor !== undefined && !/^[\da-f-]{36}$/.test(request.cursor))
    throw new HistoryError(
      "invalid_page",
      "Cursor must be a next_cursor value from a previous page.",
    );
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100_000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > maxLimit
  )
    throw new HistoryError(
      "invalid_page",
      `Offset must be 0–100000 and limit must be 1–${maxLimit}.`,
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
  includeTurns: boolean,
): AsyncGenerator<ScanRecord> {
  for (const [index, session] of listing.sessions.entries()) {
    budget.signal.throwIfAborted();
    const entry = listing.files.get(session.id);
    if (!entry) continue;
    let match: Record<string, unknown> | undefined;
    if (includeTurns) {
      for await (const record of recordedTurns(entry, budget)) {
        if (record.kind === "pause") {
          yield record;
          continue;
        }
        const message = matchingMessage(record.turn, query);
        if (!message) continue;
        match = {
          excerpt: matchExcerpt(message.text, query),
          origin: record.origin,
          at: safeDate(message.at),
          matching_turn: summarizeTurn(record.turn),
        };
        break;
      }
    } else
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
            excerpt: matchExcerpt(event.text, query),
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

function matchExcerpt(text: string, query: string) {
  const position = text.toLowerCase().indexOf(query);
  return text.slice(Math.max(0, position - 65), position + query.length + 130);
}

/** Only fields originating in projected messages participate, never tool metadata or outputs. */
function matchingMessage(turn: Turn, query: string) {
  const messages = [
    { text: turn.prompt, at: turn.at },
    ...turn.steps.flatMap((step) =>
      step.kind === "tool"
        ? [{ text: step.why ?? "", at: step.at }]
        : step.from === "agent" || step.from === "user"
          ? [{ text: step.text, at: step.at }]
          : [],
    ),
    { text: turn.final ?? "", at: turn.at },
  ];
  return messages.find((message) => message.text.toLowerCase().includes(query));
}

async function* summaryTurns(
  entry: SessionFile,
  budget: ScanBudget,
  query?: string,
): AsyncGenerator<ScanRecord> {
  for await (const record of recordedTurns(entry, budget)) {
    if (record.kind === "pause") {
      yield record;
      continue;
    }
    const match = query === undefined ? undefined : matchingMessage(record.turn, query);
    if (query !== undefined && !match) continue;
    if (record.last) budget.progress.sessions_completed = 1;
    yield {
      kind: "item",
      value: {
        origin: record.origin,
        ...summarizeTurn(record.turn),
        ...(match ? { match_excerpt: matchExcerpt(match.text, query!) } : {}),
      },
      last: record.last,
    };
  }
  budget.progress.sessions_completed = 1;
}

async function* recordedTurns(
  entry: SessionFile,
  budget: ScanBudget,
): AsyncGenerator<ScanPause | { kind: "turn"; origin: string; turn: Turn; last: boolean }> {
  for await (const file of projectedFiles(entry, budget)) {
    if (file.kind === "pause") {
      yield file;
      continue;
    }
    let projected: Event[] = [];
    let projectedBytes = 0;
    let discarding = false;
    const pendingCalls = new Set<string>();
    for await (const event of file.events) {
      if ("kind" in event) {
        yield event;
        continue;
      }
      if (discarding) {
        if (event.type !== "prompt") continue;
        discarding = false;
      }
      // Wait for outstanding calls so results crossing a prompt still belong to their call.
      if (event.type === "tool_use") pendingCalls.add(event.id);
      if (event.type === "tool_result") pendingCalls.delete(event.toolUseId);
      if (event.type === "prompt" && projected.length && !pendingCalls.size) {
        const turns = buildTurns(projected).turns;
        projected = [];
        projectedBytes = 0;
        for (const turn of turns)
          yield {
            kind: "turn",
            origin: file.source,
            turn,
            last: false,
          };
      }
      projectedBytes += Buffer.byteLength(JSON.stringify(event));
      if (projectedBytes > MAX_PROJECTION_BYTES) {
        const count =
          projected.filter((item) => item.type === "prompt").length +
          (event.type === "prompt" ? 1 : 0);
        budget.skipTurns(entry.id, file.source, Math.max(1, count));
        projected = [];
        projectedBytes = 0;
        pendingCalls.clear();
        discarding = true;
        continue;
      }
      projected.push(event);
    }
    const turns = buildTurns(projected).turns;
    for (const [index, turn] of turns.entries())
      yield {
        kind: "turn",
        origin: file.source,
        turn,
        last: file.last && index === turns.length - 1,
      };
  }
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
    if (!(yield* budget.file(file, entry.id, source, !!entry.reader.scanEvents))) continue;
    const saved = parents.has(file)
      ? { events: [] as Event[], bytes: 0, complete: true }
      : undefined;
    const skippedRecords = budget.progress.skipped_records;
    yield {
      kind: "file",
      source,
      last: index === files.length - 1,
      events: projectedEvents(entry, file, source, budget, saved, parent),
    };
    // A partial parent cannot safely identify the child's inherited evidence.
    if (saved?.complete && budget.progress.skipped_records === skippedRecords)
      recorded.set(file, saved.events);
  }
}

async function* projectedEvents(
  entry: SessionFile,
  file: string,
  source: string,
  budget: ScanBudget,
  saved: { events: Event[]; bytes: number; complete: boolean } | undefined,
  parent?: Event[],
): AsyncGenerator<Event | ScanPause> {
  let prefix = 0;
  let replay = !!parent;
  let firstOwn = true;
  const inheritedCalls = new Set(
    parent?.filter((event) => event.type === "tool_use").map((event) => event.id),
  );
  const events = entry.reader.scanEvents
    ? entry.reader.scanEvents(file, budget.signal, { maxRecordBytes: MAX_RECORD_BYTES })
    : entry.reader.readEvents(file, budget.signal);
  for await (const event of budget.read(events, entry.id, source)) {
    if ("kind" in event) {
      yield event;
      continue;
    }
    const safe = projectEvent(event);
    if (!safe) continue;
    if (saved?.complete) {
      saved.bytes += Buffer.byteLength(JSON.stringify(safe));
      if (saved.bytes > MAX_PROJECTION_BYTES) {
        saved.events = [];
        saved.complete = false;
      } else saved.events.push(safe);
    }
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
      return {
        ...event,
        text: maskSecrets(event.text.replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, " "))
          .replace(/\s+/g, " ")
          .trim(),
      };
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
