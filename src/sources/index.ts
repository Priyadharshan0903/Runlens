import { claudeReader } from "./claude/reader.js";
import type { SourceReader } from "./types.js";

// Register adapters here. CLI source flags configure roots; features never import adapters.
export const sourceReaders: SourceReader[] = [claudeReader];
