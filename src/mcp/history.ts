import { isAbsolute, resolve } from "node:path";
import type { Listing } from "../core/discover.js";
import type { Event } from "../core/events.js";
import { buildTurns } from "../core/tree.js";
import type { SessionSummary, Turn } from "../core/types.js";
import type { SessionFile } from "../sources/types.js";
import { HistoryPagination } from "./pagination.js";
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

interface ListRequest extends Omit<PageRequest, keyof ProjectionRequest> {
  agent?: string;
  title?: string;
  updated_after?: string;
  updated_before?: string;
}

interface FileHistoryRequest extends Omit<PageRequest, "detail" | "fields"> {}

/** Matching turns kept per session, and matching paths kept per turn. */
const MAX_FILE_TURNS = 5;
const MAX_TURN_PATHS = 4;

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
    const listing = await this.list(signal);
    signal?.throwIfAborted();
    return scopeListing(listing, directory);
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

  /** Listing metadata only, newest first; no transcript is opened. */
  async sessions(request: ListRequest = {}, signal?: AbortSignal) {
    const { offset, limit } = pageRequest(request, 10, 25);
    const title = request.title === undefined ? undefined : normalizeQuery(request.title);
    const after = dateBound(request.updated_after, "updated_after");
    const before = dateBound(request.updated_before, "updated_before");
    if (after !== undefined && before !== undefined && after >= before)
      throw new HistoryError("invalid_date", "updated_after must be earlier than updated_before.");
    const directory = requestedScope(this.policy, request.project);
    const filters = { agent: request.agent, title, after, before };
    const key = JSON.stringify(["list", directory, filters]);
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
        iterator: listedSessions(listing, filters, budget, directory === ALL_PROJECTS),
        offset,
        remainingOffset: offset,
      },
      limit,
      signal,
    );
  }

  /** Session counts per startup grant, or per recorded project with --all-projects. */
  async projects(
    request: Pick<PageRequest, "offset" | "limit" | "cursor"> = {},
    signal?: AbortSignal,
  ) {
    const { offset, limit } = pageRequest(request, 10, 25);
    const key = JSON.stringify(["projects"]);
    if (request.cursor) return this.pagination.resume(request.cursor, key, limit, signal);
    signal?.throwIfAborted();
    const all = await this.list(signal);
    signal?.throwIfAborted();
    const groups = this.allProjects
      ? recordedProjects(all)
      : this.grants.map((grant) => ({
          path: grant,
          sessions: scopeListing(all, grant).listing.sessions,
        }));
    const budget = new ScanBudget();
    return this.pagination.page(
      {
        key,
        base: { all_projects: this.allProjects },
        field: "results",
        budget,
        iterator: projectStats(groups, budget),
        offset,
        remainingOffset: offset,
      },
      limit,
      signal,
    );
  }

  /** Sessions whose successful recorded changes touched a path, newest first. */
  async fileHistory(path: string, request: FileHistoryRequest = {}, signal?: AbortSignal) {
    const target = normalizePath(path);
    const { offset, limit } = pageRequest(request);
    const projection = projectionOptions({
      fields: ["gist"],
      max_snippet_chars: request.max_snippet_chars,
    });
    const directory = requestedScope(this.policy, request.project);
    const key = JSON.stringify(["file", directory, target, projection.key]);
    if (request.cursor) return this.pagination.resume(request.cursor, key, limit, signal);
    const { listing, project } = await this.scoped(request.project, signal);
    const budget = new ScanBudget();
    return this.pagination.page(
      {
        key,
        base: {
          project: excerpt(project, 512),
          path: excerpt(target, 512),
          ...(listing.sessions.length ? {} : { scope_warning: EMPTY_SCOPE }),
        },
        field: "results",
        budget,
        iterator: fileSessions(listing, target, budget, projection, directory === ALL_PROJECTS),
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
    const projection = projectionOptions(request);
    if (projection.fields.has("match_excerpt") && query === undefined)
      throw new HistoryError("invalid_projection", "match_excerpt requires a summary query.");
    const directory = requestedScope(this.policy, request.project);
    const key = JSON.stringify(["summary", directory, id, query, projection.key]);
    if (request.cursor) return this.pagination.resume(request.cursor, key, limit, signal);
    // Session IDs are unique, so an omitted project looks through every startup grant in order.
    const scopes = request.project === undefined ? this.grants : [directory];
    signal?.throwIfAborted();
    const all = await this.list(signal);
    signal?.throwIfAborted();
    let found: { session: SessionSummary; entry: SessionFile; project: string } | undefined;
    let scopedSessions = 0;
    for (const scope of scopes) {
      const { listing, project } = scopeListing(all, scope);
      scopedSessions += listing.sessions.length;
      const session = findSession(listing, id);
      const entry = session && listing.files.get(session.id);
      if (session && entry) {
        found = { session, entry, project };
        break;
      }
    }
    if (!found)
      throw new HistoryError(
        "session_not_found",
        findSession(all, id)
          ? `This session exists but ran outside the granted projects. Ask the user to grant its folder at startup with --allow-project <path> or --all-projects, then reconnect.${scopedSessions ? "" : ` ${EMPTY_SCOPE}`}`
          : !scopedSessions
            ? `Session not found. ${EMPTY_SCOPE}`
            : request.project === undefined
              ? "Session not found in any granted project."
              : "Session not found in the selected project.",
      );
    const { session, entry, project } = found;
    const budget = new ScanBudget();
    return this.pagination.page(
      {
        key,
        base: {
          ...provenance(session),
          project: excerpt(
            project === ALL_PROJECTS ? (session.project?.path ?? project) : project,
            512,
          ),
        },
        field: "turns",
        budget,
        iterator: summaryTurns(entry, budget, projection, query),
        offset,
        remainingOffset: offset,
      },
      limit,
      signal,
    );
  }
}

/** Accept the ID a client displays too: Codex shows `<uuid>`, Runlens lists `codex--<uuid>`. */
function findSession(listing: Listing, id: string) {
  return (
    listing.sessions.find((session) => session.id === id) ??
    listing.sessions.find((session) => session.id === `${session.source.id}--${id}`)
  );
}

function normalizeQuery(query: string) {
  const normalized = query.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized.length < 2 || normalized.length > 200)
    throw new HistoryError("invalid_query", "Query must contain between 2 and 200 characters.");
  return normalized;
}

function dateBound(value: string | undefined, name: string) {
  if (value === undefined) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time))
    throw new HistoryError("invalid_date", `${name} must be an ISO 8601 date or date-time.`);
  return time;
}

function pageRequest(
  request: Pick<PageRequest, "offset" | "limit" | "cursor">,
  defaultLimit = 3,
  maxLimit = 5,
) {
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
          ...(!projection.explicitFields
            ? { excerpt: matchExcerpt(message.text, query, projection.maxSnippetChars) }
            : {}),
          origin: record.origin,
          at: safeDate(message.at),
          matching_turn: {
            ...summarizeTurn(record.turn, projection),
            ...(projection.fields.has("match_excerpt")
              ? { match_excerpt: matchExcerpt(message.text, query, projection.maxSnippetChars) }
              : {}),
          },
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
            excerpt: matchExcerpt(event.text, query, projection.maxSnippetChars),
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

/** Group by the viewer's inferred project; home and unknown folders share one unnamed group. */
function recordedProjects(listing: Listing) {
  const groups = new Map<string, { path?: string; sessions: SessionSummary[] }>();
  for (const session of listing.sessions) {
    const id = session.project?.path ?? "no-project";
    let group = groups.get(id);
    if (!group) groups.set(id, (group = { path: session.project?.path, sessions: [] }));
    group.sessions.push(session);
  }
  return [...groups.values()];
}

async function* projectStats(
  groups: { path?: string; sessions: SessionSummary[] }[],
  budget: ScanBudget,
): AsyncGenerator<ScanRecord> {
  for (const [index, { path, sessions }] of groups.entries()) {
    budget.signal.throwIfAborted();
    budget.progress.sessions_completed += sessions.length;
    const agents: Record<string, number> = {};
    for (const session of sessions)
      agents[session.source.id] = (agents[session.source.id] ?? 0) + 1;
    const started = sessions
      .map((session) => safeDate(session.startedAt))
      .filter(Boolean)
      .sort();
    yield {
      kind: "item",
      value: {
        // A null path is home or an unknown folder; it cannot be selected as a project.
        path: path === undefined ? null : excerpt(path, 512),
        sessions: sessions.length,
        agents,
        first_started_at: started[0] ?? "",
        // Sessions arrive newest first.
        last_updated_at: safeDate(sessions[0]?.updatedAt),
      },
      last: index === groups.length - 1,
    };
  }
}

/** A file path, or a trailing fragment of one such as `src/server.ts`. */
function normalizePath(path: string) {
  const normalized = path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.length < 2 || normalized.length > 512)
    throw new HistoryError("invalid_path", "Path must contain between 2 and 512 characters.");
  return normalized;
}

/**
 * Exact paths, or whole trailing segments: `server.ts` never matches `myserver.ts`. Relative
 * recorded paths (Codex patches) resolve against the session's folder for absolute targets.
 */
function pathMatches(recorded: string, target: string, cwd?: string) {
  const path = recorded.replace(/\\/g, "/");
  if (path === target) return true;
  if (!isAbsolute(target)) return path.endsWith(`/${target}`);
  return !isAbsolute(path) && !!cwd && isAbsolute(cwd) && resolve(cwd, path) === target;
}

async function* fileSessions(
  listing: Listing,
  target: string,
  budget: ScanBudget,
  projection: ProjectionOptions,
  withProject: boolean,
): AsyncGenerator<ScanRecord> {
  for (const [index, session] of listing.sessions.entries()) {
    budget.signal.throwIfAborted();
    const entry = listing.files.get(session.id);
    if (!entry) continue;
    const turns: Record<string, unknown>[] = [];
    let matchingTurns = 0;
    for await (const record of recordedTurns(entry, budget)) {
      if (record.kind === "pause") {
        yield record;
        continue;
      }
      const changes = new Map<string, { edits: number; added: number; removed: number }>();
      for (const step of record.turn.steps) {
        if (step.kind !== "tool" || step.result?.status !== "ok") continue;
        for (const file of step.action.files ?? []) {
          if (!pathMatches(file.path, target, session.cwd)) continue;
          const change = changes.get(file.path) ?? { edits: 0, added: 0, removed: 0 };
          change.edits++;
          change.added += file.added;
          change.removed += file.removed;
          changes.set(file.path, change);
        }
      }
      if (!changes.size) continue;
      matchingTurns++;
      if (turns.length === MAX_FILE_TURNS) continue;
      turns.push({
        origin: record.origin,
        ...summarizeTurn(record.turn, projection),
        files: [...changes].slice(0, MAX_TURN_PATHS).map(([path, change]) => ({ path, ...change })),
        ...(changes.size > MAX_TURN_PATHS ? { omitted_files: changes.size - MAX_TURN_PATHS } : {}),
      });
    }
    budget.progress.sessions_completed++;
    if (turns.length)
      yield {
        kind: "item",
        value: {
          ...provenance(session),
          ...(withProject && session.project?.path
            ? { project: excerpt(session.project.path, 512) }
            : {}),
          matching_turns: matchingTurns,
          turns,
          omitted_turns: matchingTurns - turns.length,
        },
        last: index === listing.sessions.length - 1,
      };
  }
}

async function* listedSessions(
  listing: Listing,
  filters: { agent?: string; title?: string; after?: number; before?: number },
  budget: ScanBudget,
  withProject: boolean,
): AsyncGenerator<ScanRecord> {
  for (const [index, session] of listing.sessions.entries()) {
    budget.signal.throwIfAborted();
    const last = index === listing.sessions.length - 1;
    const updated = Date.parse(session.updatedAt);
    const title = excerpt(session.title, 160);
    const matches =
      listing.files.has(session.id) &&
      (filters.agent === undefined || session.source.id === filters.agent) &&
      (filters.after === undefined || updated >= filters.after) &&
      (filters.before === undefined || updated < filters.before) &&
      // Match the masked title that can be returned. No secret oracle.
      (filters.title === undefined || title.toLowerCase().includes(filters.title));
    budget.progress.sessions_completed++;
    if (!matches) continue;
    yield {
      kind: "item",
      value: {
        ...provenance(session),
        ...(withProject && session.project?.path
          ? { project: excerpt(session.project.path, 512) }
          : {}),
        subagents: safeCount(session.subagents),
      },
      last,
    };
  }
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
