// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findRecoveryArtifacts, largestDirBytes } from '../recoveryArtifacts';

describe('recoveryArtifacts', () => {
  let tmp: string;

  const seedDir = (name: string, bytes: number) => {
    fs.mkdirSync(path.join(tmp, name), { recursive: true });
    fs.writeFileSync(path.join(tmp, name, 'base'), Buffer.alloc(bytes));
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-recovery-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('separates renamed-aside databases from preserved migration dirs', () => {
    seedDir('pglite-db', 10);
    seedDir('pglite-db.backup-2026-08-20T11-00-00-000Z', 200);
    seedDir('pglite-db.migrated-2026-05-28T18-03-48-434Z', 300);
    seedDir('sqlite-db', 400);

    const found = findRecoveryArtifacts(tmp);
    expect(found.corruptionBackupDirs).toEqual(['pglite-db.backup-2026-08-20T11-00-00-000Z']);
    expect(found.migratedDirs).toEqual(['pglite-db.migrated-2026-05-28T18-03-48-434Z']);
  });

  // The live `pglite-db` prefixes both names, so a sloppy startsWith check on
  // the bare directory folds it into one of the buckets and every install
  // looks like it had a database renamed aside.
  it('does not count the live pglite-db as an artifact', () => {
    seedDir('pglite-db', 10);
    const found = findRecoveryArtifacts(tmp);
    expect(found.corruptionBackupDirs).toEqual([]);
    expect(found.migratedDirs).toEqual([]);
  });

  it('reports the largest backup, which is what says data is recoverable', () => {
    seedDir('pglite-db.backup-2026-08-19T09-00-00-000Z', 50);
    seedDir('pglite-db.backup-2026-08-20T11-00-00-000Z', 5000);

    const found = findRecoveryArtifacts(tmp);
    expect(found.corruptionBackupDirs).toHaveLength(2);
    expect(largestDirBytes(tmp, found.corruptionBackupDirs)).toBeGreaterThanOrEqual(5000);
  });

  it('returns nothing rather than throwing when userData is unreadable', () => {
    expect(findRecoveryArtifacts(path.join(tmp, 'does-not-exist'))).toEqual({
      migratedDirs: [],
      corruptionBackupDirs: [],
    });
    expect(largestDirBytes(tmp, ['does-not-exist'])).toBe(0);
  });
});
