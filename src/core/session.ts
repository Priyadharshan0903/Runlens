import type { SessionFile } from "../sources/types.js";
import type { Session } from "./types.js";

/** Open only a discovered file, through the reader that discovered it. */
export async function loadSession({ id, file, reader }: SessionFile): Promise<Session> {
  return { ...(await reader.load(file)), id, source: reader.source };
}

export function sessionNotFoundMessage(roots: string[]): string {
  return [
    "Session not found in the configured history folders.",
    "",
    "Runlens is reading:",
    ...roots.map((root) => `• ${root}`),
    "",
    "If this session belongs to another Claude Code account, restart Runlens with --dir <path> for its projects folder. Repeat --dir for each folder you want to include.",
    "By default, Runlens includes ~/.claude/projects, $CLAUDE_CONFIG_DIR/projects, and existing ~/.claude-accounts/*/projects folders. Passing --dir replaces those defaults.",
    "Codex history is read from sessions and archived_sessions under $CODEX_HOME and ~/.codex. Use --codex-dir <path> to select other Codex history folders.",
  ].join("\n");
}
