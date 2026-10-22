// Merge reader results, then infer projects across the whole library.
import type { SessionFile, SourceFolders } from "../sources/types.js";
import { assignSessionProjects } from "./projects.js";
import type { SessionSummary } from "./types.js";

export interface Listing {
  sessions: SessionSummary[];
  files: Map<string, SessionFile>;
}

export async function listSessions(
  sources: SourceFolders[],
  signal?: AbortSignal,
): Promise<Listing> {
  signal?.throwIfAborted();
  const files = new Map<string, SessionFile>();
  const sessions: SessionSummary[] = [];

  for (const { reader, roots } of sources) {
    for (const { file, summary } of await reader.discover(roots, signal)) {
      signal?.throwIfAborted();
      // Preserve existing Claude links and browser annotations. Other sources get a namespace.
      const id = reader.source.id === "claude" ? summary.id : `${reader.source.id}--${summary.id}`;
      if (files.has(id)) continue;
      files.set(id, { id, file, reader });
      sessions.push({ ...summary, id, source: reader.source });
    }
  }

  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const projects = await assignSessionProjects(sessions);
  signal?.throwIfAborted();
  return { sessions: projects, files };
}
