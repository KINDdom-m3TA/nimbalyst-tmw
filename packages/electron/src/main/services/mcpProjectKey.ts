/**
 * Project-key matching for the `projects` map in `~/.claude.json`.
 *
 * Nimbalyst and Claude Code write that map with different path separators.
 * Nimbalyst passes native Windows paths (`C:\work\industrylens`); Claude Code
 * writes forward slashes (`C:/work/industrylens`). The lookup was an exact
 * string comparison, so on Windows the two never matched: every project-scoped
 * MCP server was invisible to Nimbalyst, and writes created a second entry
 * Claude Code could not read.
 *
 * One project can legitimately be present under both forms already, so an exact
 * hit always wins and only an unambiguous normalized hit is used as a fallback.
 */

/**
 * Canonical form for comparing two project keys.
 *
 * Separators are unified and a trailing one dropped. Only the drive letter is
 * case-folded: Windows drive letters vary by who wrote the string, but the rest
 * of the path is left alone so this stays correct on case-sensitive filesystems.
 */
export function normalizeProjectPathKey(projectPath: string): string {
  const unified = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return unified.replace(/^([a-zA-Z]):/, (_m, drive: string) => `${drive.toLowerCase()}:`);
}

/**
 * Find the key in `projects` that refers to `workspacePath`, or undefined.
 *
 * Returns the key as it is actually stored, so callers read and write the entry
 * the other tool already owns instead of forking a second one.
 */
export function resolveProjectConfigKey(
  projects: Record<string, unknown> | undefined,
  workspacePath: string,
): string | undefined {
  if (!projects || !workspacePath) return undefined;

  // Exact match wins: never change behaviour for a config that already worked.
  if (Object.prototype.hasOwnProperty.call(projects, workspacePath)) {
    return workspacePath;
  }

  const target = normalizeProjectPathKey(workspacePath);
  const matches = Object.keys(projects).filter(
    (key) => normalizeProjectPathKey(key) === target,
  );

  // Exactly one normalized match is unambiguous. If several keys normalize to
  // the same path and none matched exactly, prefer none over guessing.
  return matches.length === 1 ? matches[0] : undefined;
}
