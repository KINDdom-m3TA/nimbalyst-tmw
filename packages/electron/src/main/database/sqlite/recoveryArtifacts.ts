/**
 * Leftover PGLite directories that record something happening to a user's
 * database, found by a single scan of userData at launch.
 *
 *   - `pglite-db.migrated-*` — a completed migration preserved the old store.
 *     Gates retiring the PGLite reader code.
 *   - `pglite-db.backup-*`   — the worker decided the database was corrupt and
 *     renamed it aside (`worker.js`). Until this was reported there was no
 *     fleet signal for it at all, so an established install could be silently
 *     running on an empty database and nothing upstream would know (#1347).
 *
 * Every filesystem error is swallowed: this feeds telemetry gauges, and none of
 * them should be able to fail a launch because a directory went away mid-scan.
 */

import * as fs from 'fs';
import * as path from 'path';
import { dirSizeBytes } from './dirSize';

export const MIGRATED_DIR_PREFIX = 'pglite-db.migrated-';
export const CORRUPTION_BACKUP_DIR_PREFIX = 'pglite-db.backup-';

export interface RecoveryArtifacts {
  /** Preserved pre-migration stores, newest name last (timestamps sort lexically). */
  migratedDirs: string[];
  /** Databases the worker renamed aside as corrupt, newest name last. */
  corruptionBackupDirs: string[];
}

export function findRecoveryArtifacts(userDataPath: string): RecoveryArtifacts {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(userDataPath);
  } catch {
    return { migratedDirs: [], corruptionBackupDirs: [] };
  }
  const migratedDirs: string[] = [];
  const corruptionBackupDirs: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith(MIGRATED_DIR_PREFIX)) migratedDirs.push(entry);
    else if (entry.startsWith(CORRUPTION_BACKUP_DIR_PREFIX)) corruptionBackupDirs.push(entry);
  }
  migratedDirs.sort();
  corruptionBackupDirs.sort();
  return { migratedDirs, corruptionBackupDirs };
}

/**
 * Bytes held by the largest renamed-aside database. This is the number that
 * says whether a user has data waiting to be restored: a large value next to a
 * near-empty live `pglite-db/` is the fingerprint of a silent wipe.
 */
export function largestDirBytes(userDataPath: string, dirNames: string[]): number {
  let largest = 0;
  for (const name of dirNames) {
    const bytes = dirSizeBytes(path.join(userDataPath, name));
    if (bytes > largest) largest = bytes;
  }
  return largest;
}
