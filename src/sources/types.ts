import type { Event } from "../core/events.js";
import type { Session, SessionSource, SessionSummary, SearchMatch } from "../core/types.js";

export interface DiscoveredSession {
  file: string;
  /** Stable local id using letters, digits, underscores, and hyphens, for existing URL routes. */
  summary: Omit<SessionSummary, "source" | "project">;
}

export interface SearchFile {
  file: string;
  source: SearchMatch["source"];
}

/** Each adapter owns its file layout, record format, tool semantics, and subagent links. */
export interface SourceReader {
  source: SessionSource;
  defaultRoots(env?: NodeJS.ProcessEnv): string[];
  discover(roots: string[]): Promise<DiscoveredSession[]>;
  load(file: string): Promise<Omit<Session, "source">>;
  /** Yield the main file first, then any child transcripts. Search stops on the first match. */
  searchFiles(file: string): AsyncIterable<SearchFile>;
  /** Stream normalized events. Honor cancellation and close handles when iteration stops. */
  readEvents(file: string, signal?: AbortSignal): AsyncIterable<Event>;
}

export interface SourceFolders {
  reader: SourceReader;
  roots: string[];
}

/** Internal allowlist entry; paths and readers are never accepted from HTTP requests. */
export interface SessionFile {
  id: string;
  file: string;
  reader: SourceReader;
}
