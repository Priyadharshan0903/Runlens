import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import type { SessionProject, SessionSummary } from "./types.js";

/** Group under the highest recorded ancestor, without guessing from Git or folder names. */
export async function assignSessionProjects(
  sessions: SessionSummary[],
  homeDirectory = homedir(),
): Promise<SessionSummary[]> {
  const home = resolve(homeDirectory);
  const workingDirectories = sessions.map((session) =>
    session.cwd && isAbsolute(session.cwd) ? resolve(session.cwd) : home,
  );
  const directories = new Set(
    workingDirectories.filter(
      (directory) => directory !== home && dirname(directory) !== directory,
    ),
  );
  const roots = new Map<string, string>();

  for (const directory of directories) {
    let root = directory;

    for (let parent = dirname(directory); dirname(parent) !== parent; parent = dirname(parent)) {
      if (directories.has(parent)) root = parent;
    }

    roots.set(directory, root);
  }

  const projects = new Map<string, SessionProject>([
    ["no-project", { id: "no-project", name: "Home / no project", availability: "unknown" }],
  ]);

  // Check each inferred project once per listing, independently of the transcript cache.
  await Promise.all(
    [...new Set(roots.values())].map(async (path) => {
      const availability = await stat(path).then(
        (info) => (info.isDirectory() ? "available" : "missing"),
        (error: NodeJS.ErrnoException) =>
          error.code === "ENOENT" || error.code === "ENOTDIR" ? "missing" : "unknown",
      );

      projects.set(path, { id: path, name: basename(path), path, availability });
    }),
  );

  return sessions.map((session, index) => ({
    ...session,
    project: projects.get(roots.get(workingDirectories[index]) ?? "no-project")!,
  }));
}
