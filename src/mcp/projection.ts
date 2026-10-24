import type { ToolStep, Turn } from "../core/types.js";
import { excerpt, HistoryError } from "./safety.js";

export const TURN_FIELDS = [
  "gist",
  "asked",
  "recorded_answer",
  "changed_files",
  "changes",
  "failures",
  "failure_count",
  "tool_calls",
  "match_excerpt",
] as const;

export type TurnField = (typeof TURN_FIELDS)[number];

export interface ProjectionRequest {
  detail?: "terse" | "full";
  fields?: TurnField[];
  max_snippet_chars?: number;
}

const TERSE_FIELDS: TurnField[] = ["gist", "changed_files", "failure_count", "tool_calls"];
const FULL_FIELDS: TurnField[] = ["asked", "recorded_answer", "changes", "failures", "tool_calls"];
const STAT_FIELDS: TurnField[] = [
  "changed_files",
  "changes",
  "failures",
  "failure_count",
  "tool_calls",
];

export function projectionOptions(request: ProjectionRequest) {
  const detail = request.detail ?? "terse";
  const maxSnippetChars = request.max_snippet_chars ?? (detail === "terse" ? 200 : 800);
  if (detail !== "terse" && detail !== "full")
    throw new HistoryError("invalid_projection", "Detail must be terse or full.");
  if (!Number.isInteger(maxSnippetChars) || maxSnippetChars < 0 || maxSnippetChars > 800)
    throw new HistoryError(
      "invalid_projection",
      "max_snippet_chars must be an integer from 0 to 800.",
    );
  if (
    request.fields !== undefined &&
    (!Array.isArray(request.fields) ||
      !request.fields.length ||
      request.fields.some((field) => !TURN_FIELDS.includes(field)) ||
      new Set(request.fields).size !== request.fields.length)
  )
    throw new HistoryError(
      "invalid_projection",
      "Fields must be a nonempty list of distinct supported turn fields.",
    );

  const fields = TURN_FIELDS.filter((field) =>
    (request.fields ?? (detail === "terse" ? TERSE_FIELDS : FULL_FIELDS)).includes(field),
  );
  return {
    fields: new Set(fields),
    explicitFields: request.fields !== undefined,
    maxSnippetChars,
    // Canonical field order lets a caller reorder its selection when following a cursor.
    key: [detail, request.fields === undefined ? null : fields, maxSnippetChars],
  };
}

export type ProjectionOptions = ReturnType<typeof projectionOptions>;

function snippet(text: string, limit: number) {
  // A short UTF-16 cap must not leave half of an emoji before the ellipsis.
  return limit === 0 ? "" : excerpt(text, limit).replace(/[\uD800-\uDBFF](?=…$)/u, "");
}

/** Input is the full masked projection; shortening it must never change what matched. */
export function matchExcerpt(text: string, query: string, limit: number) {
  const position = text.toLowerCase().indexOf(query);
  const leading = Math.min(65, Math.max(0, Math.floor((limit - query.length) / 2)));
  return snippet(text.slice(Math.max(0, position - leading), position + query.length + 130), limit);
}

export function safeDate(value: string | undefined) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : "";
}

/** Select recorded facts before formatting text or allocating change/failure response arrays. */
export function summarizeTurn(turn: Turn, options: ProjectionOptions) {
  const { fields, maxSnippetChars } = options;
  const value: Record<string, unknown> = { at: safeDate(turn.at) };
  if (fields.has("gist")) {
    const answer = turn.final?.trim();
    value.gist = {
      from: answer ? "recorded_answer" : "asked",
      text: snippet(answer || turn.prompt, maxSnippetChars),
    };
  }
  if (fields.has("asked")) value.asked = snippet(turn.prompt, Math.min(480, maxSnippetChars));
  if (fields.has("recorded_answer"))
    value.recorded_answer = snippet(turn.final ?? "", maxSnippetChars);

  if (STAT_FIELDS.some((field) => fields.has(field))) {
    const tools = turn.steps.filter((step): step is ToolStep => step.kind === "tool");
    if (fields.has("tool_calls")) value.tool_calls = tools.length;
    if (fields.has("changes") || fields.has("changed_files")) {
      const changes = tools.flatMap((tool) =>
        tool.result?.status === "ok" ? (tool.action.files ?? []) : [],
      );
      if (fields.has("changed_files"))
        value.changed_files = new Set(changes.map((file) => file.path)).size;
      if (fields.has("changes")) {
        value.changes = changes
          .slice(0, 8)
          .map((file) => ({ path: file.path, added: file.added, removed: file.removed }));
        value.omitted_changes = Math.max(0, changes.length - 8);
      }
    }
    if (fields.has("failures") || fields.has("failure_count")) {
      const failures = tools.filter((tool) => tool.result?.status === "error");
      if (fields.has("failure_count")) value.failure_count = failures.length;
      if (fields.has("failures")) {
        value.failures = failures
          .slice(0, 8)
          .map((tool) => ({ tool: tool.name, at: safeDate(tool.at), status: "error" }));
        value.omitted_failures = Math.max(0, failures.length - 8);
      }
    }
  }
  return value;
}
