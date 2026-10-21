// One-line descriptions of tool calls, e.g. "npm test auth" or "src/auth/session.ts (+4 −1)".

import { homedir } from "node:os";

type Input = Record<string, unknown>;

export function summarizeTool(name: string, rawInput: unknown, cwd?: string): string {
  const input: Input = typeof rawInput === "object" && rawInput !== null ? (rawInput as Input) : {};
  const s = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
  const p = (key: string) => shortPath(s(key), cwd);

  switch (name) {
    case "Bash":
      // "cd /long/path && npm test" → "npm test": the cd is noise, the command is the point.
      return firstLine(s("command").replace(/^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*&&\s*/, ""));
    case "Read":
      return p("file_path") + (typeof input.offset === "number" ? `:${input.offset}` : "");
    case "Write":
      return `${p("file_path")} (${lineCount(s("content"))} lines)`;
    case "Edit": {
      const added = lineCount(s("new_string"));
      const removed = lineCount(s("old_string"));
      return `${p("file_path")} (+${added} −${removed})${input.replace_all ? " all" : ""}`;
    }
    case "MultiEdit":
      return `${p("file_path")} (${Array.isArray(input.edits) ? input.edits.length : 0} edits)`;
    case "Grep":
      return (
        `"${s("pattern")}"` +
        (s("path") ? ` in ${p("path")}` : "") +
        (s("glob") ? ` (${s("glob")})` : "")
      );
    case "Glob":
      return s("pattern") + (s("path") ? ` in ${p("path")}` : "");
    case "Agent":
    case "Task":
      return s("description") || firstLine(s("prompt"));
    case "Skill":
      return [s("skill"), s("args")].filter(Boolean).join(" ");
    case "WebSearch":
      return s("query");
    case "WebFetch":
      return s("url");
    case "TodoWrite":
      return `${Array.isArray(input.todos) ? input.todos.length : 0} todos`;
    case "ToolSearch":
      return s("query");
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

function lineCount(text: string): number {
  return text ? text.split("\n").length : 0;
}
