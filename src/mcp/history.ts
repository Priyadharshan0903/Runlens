import type { Listing } from "../core/discover.js";
import type { Event } from "../core/events.js";
import { buildTurns } from "../core/tree.js";
import type { SessionSummary, Turn } from "../core/types.js";
import type { SessionFile } from "../sources/types.js";
import { HistoryPagination, type HistoryScan } from "./pagination.js";
import {
  matchExcerpt,
  projectionOptions,
  safeDate,
  summarizeTurn,
  type ProjectionOptions,
  type ProjectionRequest,
} from "./projection.js";
import { ScanBudget, type ScanPause, type ScanRecord } from "./scan.js";
import {
  ALL_PROJECTS,
  excerpt,
  grantedScopes,
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

interface PageRequest extends ProjectionRequest {
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

interface ResolvedHistorySession {
  session: SessionSummary;
  file: SessionFile;
  project: string;
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

  get allProjects(): boolean {
    return this.policy.allProjects ?? false;
  }

  /** Every startup grant, for instructions and errors; never widened by a tool call. */
  get grants(): string[] {
    return grantedScopes(this.policy).map((scope) => requestedScope(this.policy, scope));
  }

  close() {
    this.pagination.close();
  }

  private async scoped(project: string | undefined, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const directory = requestedScope(this.policy, project);
    const listing = await this.loadListing(signal);
    return scopeListing(listing, directory);
  }

  private async loadListing(signal?: AbortSignal): Promise<Listing> {
    signal?.throwIfAborted();
    const listing = await this.list(signal);
    signal?.throwIfAborted();
    return listing;
  }

  async search(query: string, request: SearchRequest = {}, signal?: AbortSignal) {
    const normalized = normalizeQuery(query);
    const { offset, limit } = pageRequest(request);
    const directory = requestedScope(this.policy, request.project);
    const includeTurns = request.include_turns ?? false;
    const projection = projectionOptions(request);
    if (projection.explicitFields && !includeTurns)
      throw new HistoryError(
        "invalid_projection",
        "Search fields select matching-turn content. Set include_turns: true to use fields.",
      );
    const key = JSON.stringify(["search", directory, normalized, includeTurns, projection.key]);
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
        iterator: searchSessions(
          listing,
          normalized,
          budget,
          includeTurns,
          projection,
          directory === ALL_PROJECTS,
        ),
        offset,
        remainingOffset: offset,
      },
      limit,
      signal,
    );
  }

  async summary(sessionId: string, request: SummaryRequest = {}, signal?: AbortSignal) {
    const options = summaryOptions(sessionId, request);
    const directory = requestedScope(this.policy, request.project);
    const cursorKey = JSON.stringify([
      "summary",
      directory,
      sessionId,
      options.query,
      options.projection.key,
    ]);

    if (request.cursor) {
      return this.pagination.resume(request.cursor, cursorKey, options.limit, signal);
    }

    // Session IDs are unique, so an omitted project looks through every startup grant in order.
    const scopes = request.project === undefined ? this.grants : [directory];
    const listing = await this.loadListing(signal);
    const resolvedSession = findGrantedSession(listing, sessionId, scopes, request.project);

    const scan = createSummaryScan(resolvedSession, options, cursorKey);
    return this.pagination.page(scan, options.limit, signal);
  }
}

function summaryOptions(sessionId: string, request: SummaryRequest) {
  if (!/^[\w-]{1,160}$/.test(sessionId)) {
    throw new HistoryError("invalid_session", "Use a session ID returned by search_sessions.");
  }

  const query = request.query === undefined ? undefined : normalizeQuery(request.query);
  const { offset, limit } = pageRequest(request, 10, 50);
  const projection = projectionOptions(request);

  if (projection.fields.has("match_excerpt") && query === undefined) {
    throw new HistoryError("invalid_projection", "match_excerpt requires a summary query.");
  }

  return { query, offset, limit, projection };
}

function createSummaryScan(
  { session, file, project }: ResolvedHistorySession,
  { query, offset, projection }: ReturnType<typeof summaryOptions>,
  cursorKey: string,
): HistoryScan {
  const budget = new ScanBudget();
  const projectPath = project === ALL_PROJECTS ? (session.project?.path ?? project) : project;

  return {
    key: cursorKey,
    base: {
      ...provenance(session),
      project: excerpt(projectPath, 512),
    },
    field: "turns",
    budget,
    iterator: summaryTurns(file, budget, projection, query),
    offset,
    remainingOffset: offset,
  };
}

/** Accept the ID a client displays too: Codex shows `<uuid>`, Runlens lists `codex--<uuid>`. */
function findSession(listing: Listing, id: string) {
  return (
    listing.sessions.find((session) => session.id === id) ??
    listing.sessions.find((session) => session.id === `${session.source.id}--${id}`)
  );
}

function findGrantedSession(
  allSessions: Listing,
  sessionId: string,
  scopes: string[],
  requestedProject: string | undefined,
): ResolvedHistorySession {
  let scopedSessionCount = 0;

  for (const scope of scopes) {
    const { listing, project } = scopeListing(allSessions, scope);
    scopedSessionCount += listing.sessions.length;

    const session = findSession(listing, sessionId);
    if (!session) {
      continue;
    }

    const file = listing.files.get(session.id);
    if (file) {
      return { session, file, project };
    }
  }

  throw new HistoryError(
    "session_not_found",
    missingSessionMessage(allSessions, sessionId, scopedSessionCount, requestedProject),
  );
}

function missingSessionMessage(
  listing: Listing,
  id: string,
  scopedSessions: number,
  project: string | undefined,
): string {
  if (findSession(listing, id)) {
    const scopeWarning = scopedSessions ? "" : ` ${EMPTY_SCOPE}`;
    return `This session exists but ran outside the granted projects. Ask the user to grant its folder at startup with --allow-project <path> or --all-projects, then reconnect.${scopeWarning}`;
  }
  if (!scopedSessions) return `Session not found. ${EMPTY_SCOPE}`;
  if (project === undefined) return "Session not found in any granted project.";
  return "Session not found in the selected project.";
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
  projection: ProjectionOptions,
  withProject: boolean,
): AsyncGenerator<ScanRecord> {
  for (const [index, session] of listing.sessions.entries()) {
    budget.signal.throwIfAborted();
    const entry = listing.files.get(session.id);
    if (!entry) continue;
    const match = includeTurns
      ? yield* findMatchingTurn(entry, query, budget, projection)
      : yield* findMatchingText(entry, query, budget, projection);
    budget.progress.sessions_completed++;
    if (match)
      yield {
        kind: "item",
        value: {
          ...provenance(session),
          // One all-projects page mixes projects; name each so follow-ups can narrow the scope.
          ...(withProject && session.project?.path
            ? { project: excerpt(session.project.path, 512) }
            : {}),
          ...match,
        },
        last: index === listing.sessions.length - 1,
      };
  }
}

/** Return the first matching turn while forwarding scan pauses to the page iterator. */
async function* findMatchingTurn(
  entry: SessionFile,
  query: string,
  budget: ScanBudget,
  projection: ProjectionOptions,
): AsyncGenerator<ScanPause, Record<string, unknown> | undefined> {
  for await (const record of recordedTurns(entry, budget)) {
    if (record.kind === "pause") {
      yield record;
      continue;
    }
    const message = matchingMessage(record.turn, query);
    if (!message) continue;

    const excerpt = matchExcerpt(message.text, query, projection.maxSnippetChars);
    return {
      ...(!projection.explicitFields ? { excerpt } : {}),
      origin: record.origin,
      at: safeDate(message.at),
      matching_turn: {
        ...summarizeTurn(record.turn, projection),
        ...(projection.fields.has("match_excerpt") ? { match_excerpt: excerpt } : {}),
      },
    };
  }
  return undefined;
}

/** Match the same masked messages that can be returned, never raw tool content. */
async function* findMatchingText(
  entry: SessionFile,
  query: string,
  budget: ScanBudget,
  projection: ProjectionOptions,
): AsyncGenerator<ScanPause, Record<string, unknown> | undefined> {
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
      if (event.type !== "prompt" && event.type !== "text" && event.type !== "interjection")
        continue;
      if (!event.text.toLowerCase().includes(query)) continue;

      return {
        excerpt: matchExcerpt(event.text, query, projection.maxSnippetChars),
        origin: file.source,
        at: safeDate(event.at),
      };
    }
  }
  return undefined;
}

/** Only fields originating in projected messages participate, never tool metadata or outputs. */
function matchingMessage(turn: Turn, query: string) {
  const messages = [{ text: turn.prompt, at: turn.at }];
  for (const step of turn.steps) {
    if (step.kind === "tool") {
      messages.push({ text: step.why ?? "", at: step.at });
      continue;
    }
    if (step.from === "agent" || step.from === "user") {
      messages.push({ text: step.text, at: step.at });
    }
  }
  messages.push({ text: turn.final ?? "", at: turn.at });
  return messages.find((message) => message.text.toLowerCase().includes(query));
}

async function* summaryTurns(
  entry: SessionFile,
  budget: ScanBudget,
  projection: ProjectionOptions,
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
        ...summarizeTurn(record.turn, projection),
        ...(match && (!projection.explicitFields || projection.fields.has("match_excerpt"))
          ? { match_excerpt: matchExcerpt(match.text, query!, projection.maxSnippetChars) }
          : {}),
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
