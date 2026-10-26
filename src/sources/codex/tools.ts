import { posix, win32 } from "node:path";
import type { FileEffect, ToolAction } from "../../core/types.js";

export function describeTool(
  rawName: string,
  input: unknown,
  cwd?: string,
): { summary: string; action: ToolAction } {
  const name = rawName.split(".").at(-1) ?? rawName;
  const args = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (["exec_command", "shell_command", "shell", "exec"].includes(name)) {
    const command = commandText(args.cmd) ?? commandText(args.command) ?? commandText(input);
    return {
      summary:
        command
          ?.split("\n")
          .find((line) => line.trim())
          ?.slice(0, 200) || name,
      action: describeCommand(command),
    };
  }
  if (name === "apply_patch") {
    const patch = typeof input === "string" ? input : String(args.patch ?? args.input ?? "");
    const files = patchEffects(patch, cwd);
    return {
      summary: files.map((file) => file.path).join(", ") || "Apply patch",
      action: { kind: "change", verb: "Patch", icon: "edit", files },
    };
  }
  if (["spawn_agent", "send_input", "send_message", "wait_agent", "close_agent"].includes(name)) {
    return {
      summary: String(args.message ?? args.agent_type ?? args.id ?? name).slice(0, 200),
      action: {
        kind: "delegate",
        verb: name === "spawn_agent" ? "Delegate" : "Coordinate",
        icon: "agent",
      },
    };
  }
  if (name === "update_plan") {
    return { summary: "Update plan", action: { kind: "other", verb: "Plan", icon: "todo" } };
  }
  if (rawName.startsWith("mcp__") || rawName.includes("mcp.")) {
    return { summary: rawName, action: { kind: "other", verb: "MCP", icon: "mcp" } };
  }
  return { summary: name, action: { kind: "other", verb: name, icon: "other" } };
}

/** Conventional display labels, not a shell evaluator or a guarantee of side-effect freedom. */
function describeCommand(command: string | undefined): ToolAction {
  const action: ToolAction = { kind: "run", verb: "Run", icon: "terminal", command };
  const words = command ? inspectionWords(command) : undefined;
  if (!words?.length) return action;

  // Only recognize bare utility names or their usual system paths, not ./cat or custom wrappers.
  const program = words[0].replace(/^\/(?:usr\/)?bin\//, "");
  const args = words.slice(1);
  if (["rg", "grep"].includes(program)) {
    // ripgrep can launch an arbitrary preprocessor or hostname program.
    if (args.some((arg) => /^--(?:pre|hostname-bin)(?:=|$)/.test(arg))) return action;
    return { ...action, kind: "look", verb: "Search", icon: "search" };
  }
  if (["ls", "pwd"].includes(program)) {
    return { ...action, kind: "look", verb: "List", icon: "files" };
  }
  if (["cat", "head", "tail", "wc"].includes(program)) {
    return { ...action, kind: "look", verb: "Read", icon: "file" };
  }
  if (program === "sed") {
    // sed supports writes and executable expressions; recognize only a simple print range.
    if (args[0] === "-n") args.shift();
    const isPrintRange = args.length > 0 && /^(?:(?:\d+|\$)(?:,(?:\d+|\$))?)?p$/.test(args[0]);
    const hasOnlyFileArguments = args.slice(1).every((arg) => !arg.startsWith("-"));
    if (isPrintRange && hasOnlyFileArguments)
      return { ...action, kind: "look", verb: "Read", icon: "file" };
  }
  return action;
}

/** Read literal words from one simple command; unsupported shell syntax stays Run. */
function inspectionWords(command: string): string[] | undefined {
  if (/[\r\n]/.test(command)) return;
  const words: string[] = [];
  let word = "";
  let quote = "";
  let started = false;
  for (const character of command) {
    if (quote) {
      if (character === quote) {
        quote = "";
        continue;
      }
      if (quote === '"' && /[$`\\]/.test(character)) return;
      word += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) words.push(word);
      word = "";
      started = false;
      continue;
    }
    if (/[\\$`;&|<>(){}#]/.test(character)) return;
    word += character;
    started = true;
  }
  if (quote) return;
  if (started) words.push(word);
  return words;
}

/** Newer Codex clients record the concrete operations executed inside an orchestration call. */
export function completedTool(item: Record<string, unknown>, cwd?: string) {
  if (item.type === "CommandExecution") {
    const input = { command: item.command, cwd: item.cwd };
    return {
      name: "exec_command",
      input,
      ...describeTool("exec_command", input, cwd),
      output: typeof item.aggregated_output === "string" ? item.aggregated_output : "",
      isError:
        item.status === "failed" || (typeof item.exit_code === "number" && item.exit_code !== 0),
    };
  }
  if (item.type === "FileChange") {
    const changes =
      item.changes && typeof item.changes === "object"
        ? (item.changes as Record<string, unknown>)
        : {};
    const files: FileEffect[] = [];
    for (const [file, raw] of Object.entries(changes)) {
      if (!raw || typeof raw !== "object") continue;
      const change = raw as Record<string, unknown>;
      files.push(completedFileEffect(file, change, cwd));
      if (typeof change.move_path === "string")
        files.push({
          path: relativePath(change.move_path, cwd),
          operation: "change",
          added: 0,
          removed: 0,
        });
    }
    return {
      name: "apply_patch",
      input: changes,
      summary: files.map((file) => file.path).join(", ") || "Apply patch",
      action: { kind: "change", verb: "Patch", icon: "edit", files } as ToolAction,
      output: typeof item.stdout === "string" ? item.stdout : "",
      isError: item.status === "failed",
    };
  }
  if (item.type === "McpToolCall") {
    const name = `mcp__${item.server}__${item.tool}`;
    const result =
      item.result && typeof item.result === "object"
        ? (item.result as Record<string, unknown>)
        : {};
    return {
      name,
      input: item.arguments,
      ...describeTool(name, item.arguments, cwd),
      output: JSON.stringify(item.result ?? ""),
      isError: item.status === "failed" || result.isError === true,
    };
  }
  return undefined;
}

function completedFileEffect(
  file: string,
  change: Record<string, unknown>,
  cwd?: string,
): FileEffect {
  const content = typeof change.content === "string" ? change.content : "";
  const diff = typeof change.unified_diff === "string" ? change.unified_diff : "";
  const contentLines = content ? content.replace(/\n$/, "").split("\n").length : 0;
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }

  return {
    path: relativePath(file, cwd),
    operation: "change",
    added: change.type === "add" ? contentLines : added,
    removed: change.type === "delete" ? contentLines : removed,
    preview: completedFilePreview(change, diff),
  };
}

function completedFilePreview(
  change: Record<string, unknown>,
  diff: string,
): FileEffect["preview"] {
  if (diff) return { kind: "diff", text: diff };
  if (typeof change.content !== "string") return undefined;

  switch (change.type) {
    case "add":
      return { kind: "added", text: change.content };
    case "delete":
      return { kind: "removed", text: change.content };
    default:
      return { kind: "content", text: change.content };
  }
}

/** Display a recorded shell script directly; keep argument boundaries for other invocations. */
function commandText(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (!Array.isArray(value) || !value.length || !value.every((part) => typeof part === "string"))
    return;

  const program = value[0]
    .replace(/^.*[\\/]/, "")
    .replace(/\.exe$/i, "")
    .toLowerCase();
  const shells = [
    "sh",
    "bash",
    "zsh",
    "dash",
    "fish",
    "ksh",
    "csh",
    "tcsh",
    "pwsh",
    "powershell",
    "cmd",
  ];
  if (
    value.length === 3 &&
    shells.includes(program) &&
    /^(?:-[il]*c[il]*|--command|-command|\/c)$/i.test(value[1])
  ) {
    return value[2] || undefined;
  }

  return value
    .map((part) =>
      /^[a-zA-Z0-9_@%+=:,./-]+$/.test(part) ? part : `'${part.replace(/'/g, "'\\''")}'`,
    )
    .join(" ");
}

/** Only explicit patch blocks count as edits; shell scripts are never guessed to be writes. */
function patchEffects(patch: string, cwd?: string): FileEffect[] {
  const files = new Map<string, FileEffect>();
  const previews = new Map<string, string[]>();
  let current: FileEffect | undefined;
  for (const line of patch.split("\n")) {
    const header = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    if (header) {
      const path = relativePath(header[1], cwd);
      current = files.get(path) ?? { path, operation: "change", added: 0, removed: 0 };
      files.set(path, current);
      continue;
    }
    if (line.startsWith("*** Move to: ")) {
      const path = relativePath(line.slice(13), cwd);
      if (!files.has(path)) files.set(path, { path, operation: "change", added: 0, removed: 0 });
      continue;
    }
    if (line.startsWith("***")) {
      current = undefined;
      continue;
    }
    if (!current) continue;

    const lines = previews.get(current.path) ?? [];
    lines.push(line);
    previews.set(current.path, lines);
    if (line.startsWith("+")) current.added++;
    if (line.startsWith("-")) current.removed++;
  }
  for (const [path, lines] of previews) {
    files.get(path)!.preview = { kind: "diff", text: lines.join("\n") };
  }
  return [...files.values()];
}

function relativePath(file: string, cwd?: string): string {
  const path = /^[A-Za-z]:[\\/]/.test(file) ? win32 : posix;
  if (!cwd || !path.isAbsolute(file)) return file;
  const relative = path.relative(cwd, file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : file;
}
