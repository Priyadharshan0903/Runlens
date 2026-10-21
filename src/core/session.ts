import type { SessionFile } from "../sources/types.js";
import type { Session } from "./types.js";

/** Open only a discovered file, through the reader that discovered it. */
export async function loadSession({ id, file, reader }: SessionFile): Promise<Session> {
  return { ...(await reader.load(file)), id, source: reader.source };
}
