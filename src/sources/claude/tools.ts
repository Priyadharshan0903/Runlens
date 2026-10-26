// Claude tool names and input fields stop here; the UI consumes the returned action.
import type { FileEffect, ToolAction } from "../../core/types.js";
import { homedir } from "node:os";

const ACTIONS: Record<string, Pick<ToolAction, "kind" | "verb" | "icon">> = {
  Read: { kind: "look", verb: "Read", icon: "file" },
  Grep: { kind: "look", verb: "Search", icon: "search" },
  Glob: { kind: "look", verb: "Find files", icon: "files" },
  LS: { kind: "look", verb: "List", icon: "files" },
  Edit: { kind: "change", verb: "Edit", icon: "edit" },
  MultiEdit: { kind: "change", verb: "Edit", icon: "edit" },
  Write: { kind: "change", verb: "Write", icon: "write" },
  NotebookEdit: { kind: "change", verb: "Edit notebook", icon: "edit" },
  Bash: { kind: "run", verb: "Run", icon: "terminal" },
  BashOutput: { kind: "run", verb: "Check output", icon: "terminal" },
  KillShell: { kind: "run", verb: "Stop", icon: "terminal" },
  Agent: { kind: "delegate", verb: "Subagent", icon: "agent" },
  Task: { kind: "delegate", verb: "Subagent", icon: "agent" },
  Skill: { kind: "delegate", verb: "Skill", icon: "skill" },
  WebSearch: { kind: "other", verb: "Web search", icon: "web" },
  WebFetch: { kind: "other", verb: "Fetch", icon: "link" },
  TodoWrite: { kind: "other", verb: "Update todos", icon: "todo" },
  ToolSearch: { kind: "other", verb: "Load tools", icon: "tools" },
};

export function describeTool(
  name: string,
  rawInput: unknown,
  cwd?: string,
): { summary: string; action: ToolAction } {
  const input =
    rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};
  const summary = summarizeTool(name, input, cwd);
  const known = Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : undefined;
  const action: ToolAction = { ...(known ?? { kind: "other", verb: name, icon: "other" }) };
  const mcp = name.match(/^mcp__(.+?)__(.+)$/);
  if (mcp) {
    action.icon = "mcp";
    action.verb = mcp[1]
      .replace(/^claude_ai_/, "")
      .replace(/^plugin_[^_]+_/, "")
      .replace(/_/g, " ");
    action.detail = [mcp[2].replace(/_/g, " "), summary].filter(Boolean).join("  ");
  }
  if (name === "Bash" && typeof input.command === "string") action.command = input.command;
  if (
    name === "Edit" &&
    typeof input.old_string === "string" &&
    typeof input.new_string === "string"
  ) {
    action.replacement = { before: input.old_string, after: input.new_string };
  }

  const file = describeFileEffect(name, input, action);
  if (file) action.files = [file];
  return { summary, action };
}

function describeFileEffect(
  name: string,
  input: Input,
  action: ToolAction,
): FileEffect | undefined {
  const path = input.file_path ?? input.notebook_path;
  if (typeof path !== "string" || !path) return undefined;

  const effect: FileEffect = {
    path,
    operation: action.kind === "change" ? "change" : "read",
    added: 0,
    removed: 0,
  };
  switch (name) {
    case "Edit":
      effect.added = lines(input.new_string);
      effect.removed = lines(input.old_string);
      if (action.replacement) {
        effect.preview = {
          kind: "diff",
          text: replacementPatch(action.replacement.before, action.replacement.after),
        };
      }
      break;
    case "Write":
      effect.added = lines(input.content);
      if (typeof input.content === "string") {
        effect.preview = { kind: "content", text: input.content };
      }
      break;
    case "MultiEdit":
      addReplacementEffects(effect, input.edits);
      break;
  }
  return effect;
}

function addReplacementEffects(effect: FileEffect, edits: unknown) {
  if (!Array.isArray(edits)) return;
  const patches: string[] = [];
  for (const edit of edits) {
    effect.added += lines(edit?.new_string);
    effect.removed += lines(edit?.old_string);
    if (typeof edit?.old_string === "string" && typeof edit?.new_string === "string") {
      patches.push(replacementPatch(edit.old_string, edit.new_string));
    }
  }
  if (patches.length) effect.preview = { kind: "diff", text: patches.join("\n@@\n") };
}

function replacementPatch(before: string, after: string): string {
  return [
    ...(before ? before.split("\n").map((line) => `-${line}`) : []),
    ...(after ? after.split("\n").map((line) => `+${line}`) : []),
  ].join("\n");
}

function lines(value: unknown): number {
  return typeof value === "string" && value ? value.split("\n").length : 0;
}

type Input = Record<string, unknown>;

export function summarizeTool(name: string, rawInput: unknown, cwd?: string): string {
  const input: Input = typeof rawInput === "object" && rawInput !== null ? (rawInput as Input) : {};
  const stringInput = (key: string) =>
    typeof input[key] === "string" ? (input[key] as string) : "";
  const pathInput = (key: string) => shortPath(stringInput(key), cwd);

  switch (name) {
    case "Bash":
      // "cd /long/path && npm test" → "npm test": the cd is noise, the command is the point.
      return firstLine(
        stringInput("command").replace(/^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*&&\s*/, ""),
      );
    case "Read":
      return pathInput("file_path") + (typeof input.offset === "number" ? `:${input.offset}` : "");
    case "Write":
      return `${pathInput("file_path")} (${lines(stringInput("content"))} lines)`;
    case "Edit": {
      const added = lines(stringInput("new_string"));
      const removed = lines(stringInput("old_string"));
      return `${pathInput("file_path")} (+${added} −${removed})${input.replace_all ? " all" : ""}`;
    }
    case "MultiEdit":
      return `${pathInput("file_path")} (${Array.isArray(input.edits) ? input.edits.length : 0} edits)`;
    case "Grep":
      return (
        `"${stringInput("pattern")}"` +
        (stringInput("path") ? ` in ${pathInput("path")}` : "") +
        (stringInput("glob") ? ` (${stringInput("glob")})` : "")
      );
    case "Glob":
      return stringInput("pattern") + (stringInput("path") ? ` in ${pathInput("path")}` : "");
    case "Agent":
    case "Task":
      return stringInput("description") || firstLine(stringInput("prompt"));
    case "Skill":
      return [stringInput("skill"), stringInput("args")].filter(Boolean).join(" ");
    case "WebSearch":
      return stringInput("query");
    case "WebFetch":
      return stringInput("url");
    case "TodoWrite":
      return `${Array.isArray(input.todos) ? input.todos.length : 0} todos`;
    case "ToolSearch":
      return stringInput("query");
    default:
      return firstStringValue(input, cwd);
  }
}

export function shortPath(path: string, cwd?: string): string {
  if (!path) return "";
  if (cwd && path.startsWith(cwd + "/")) return path.slice(cwd.length + 1);
  const home = homedir();
  if (path.startsWith(home + "/")) return "~" + path.slice(home.length);
  return path;
}

function firstStringValue(input: Input, cwd?: string): string {
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value.trim()) {
      return value.startsWith("/") ? shortPath(value, cwd) : firstLine(value);
    }
  }
  return "";
}

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 160 ? line.slice(0, 157) + "…" : line;
}
