// @vitest-environment node
/**
 * The regressions these pin are the two that already shipped and were rolled
 * back: a counter that could go backwards, and a number that resolved in a
 * project it did not belong to. Neither is visible on screen.
 */

import { describe, expect, it } from 'vitest';
import {
  assignMissingLocalKeys,
  ensureLocalKeyPrefix,
  resolveRowByLocalKey,
  type LocalKeyStateStore,
} from '../localKeyAllocator';

interface Row {
  id: string;
  workspace: string;
  local_key: string | null;
  created: string;
  deleted_at: string | null;
}

/**
 * Enough of the two statements the allocator issues to observe ordering and
 * the `local_key IS NULL` guard. Not a SQL engine.
 */
function fakeDb(rows: Row[]) {
  return {
    rows,
    async query<T = unknown>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
      if (sql.includes('SELECT id FROM tracker_items')) {
        const [workspace] = params as [string];
        const matching = rows
          .filter((r) => r.workspace === workspace && r.local_key === null && r.deleted_at === null)
          .sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
        return { rows: matching.map((r) => ({ id: r.id })) as T[] };
      }
      if (sql.startsWith('UPDATE tracker_items SET local_key')) {
        const [localKey, id, workspace] = params as [string, string, string];
        const target = rows.find((r) => r.id === id && r.workspace === workspace);
        if (target && target.local_key === null) target.local_key = localKey;
        return { rows: [] };
      }
      if (sql.includes('WHERE local_key = $1')) {
        const [localKey, workspace] = params as [string, string];
        const found = rows.find((r) => r.local_key === localKey && r.workspace === workspace);
        return { rows: (found ? [found] : []) as T[] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
}

function fakeStore(seed: Record<string, { prefix?: string; counter?: number }> = {}): LocalKeyStateStore & {
  state: Record<string, { prefix?: string; counter?: number }>;
} {
  const state: Record<string, { prefix?: string; counter?: number }> = { ...seed };
  return {
    state,
    read: (workspacePath) => state[workspacePath] ?? {},
    write: (workspacePath, next) => {
      state[workspacePath] = { ...next };
    },
    takenPrefixes: (workspacePath) =>
      Object.entries(state)
        .filter(([key]) => key !== workspacePath)
        .map(([, value]) => value.prefix)
        .filter((prefix): prefix is string => Boolean(prefix)),
  };
}

function row(id: string, workspace: string, created: string): Row {
  return { id, workspace, local_key: null, created, deleted_at: null };
}

describe('ensureLocalKeyPrefix', () => {
  it('pins once and never moves, even as other projects appear', () => {
    const store = fakeStore();
    expect(ensureLocalKeyPrefix(store, '/src/nimbalyst-code')).toBe('NIM');
    expect(ensureLocalKeyPrefix(store, '/src/nimbalyst-collab')).toBe('NIC');
    // Re-resolving the first project must not renegotiate now that NIC exists.
    expect(ensureLocalKeyPrefix(store, '/src/nimbalyst-code')).toBe('NIM');
  });
});

describe('assignMissingLocalKeys', () => {
  it('numbers unnumbered items in creation order', async () => {
    const db = fakeDb([
      row('b', '/src/app', '2026-08-02'),
      row('a', '/src/app', '2026-08-01'),
    ]);
    const store = fakeStore();

    expect(await assignMissingLocalKeys(db, store, '/src/app')).toBe(2);
    expect(db.rows.find((r) => r.id === 'a')?.local_key).toBe('APP.1');
    expect(db.rows.find((r) => r.id === 'b')?.local_key).toBe('APP.2');
  });

  /**
   * The `LC-###` rollback in one test: the counter was recomputed from rows
   * carrying a local key, so removing them released their numbers and the next
   * create reused one. An old note then resolved to a different item.
   */
  it('never reissues a number after its items are gone', async () => {
    const db = fakeDb([row('a', '/src/app', '2026-08-01'), row('b', '/src/app', '2026-08-02')]);
    const store = fakeStore();
    await assignMissingLocalKeys(db, store, '/src/app');

    db.rows.length = 0;
    db.rows.push(row('c', '/src/app', '2026-08-03'));
    await assignMissingLocalKeys(db, store, '/src/app');

    expect(db.rows.find((r) => r.id === 'c')?.local_key).toBe('APP.3');
  });

  it('spends rather than reissues a number when a write is lost', async () => {
    const db = fakeDb([row('a', '/src/app', '2026-08-01')]);
    const store = fakeStore();
    await assignMissingLocalKeys(db, store, '/src/app');

    // Simulate the row write being lost after the counter advanced.
    db.rows[0].local_key = null;
    await assignMissingLocalKeys(db, store, '/src/app');

    expect(db.rows[0].local_key).toBe('APP.2');
  });

  it('is a no-op on a second pass', async () => {
    const db = fakeDb([row('a', '/src/app', '2026-08-01')]);
    const store = fakeStore();

    expect(await assignMissingLocalKeys(db, store, '/src/app')).toBe(1);
    expect(await assignMissingLocalKeys(db, store, '/src/app')).toBe(0);
  });

  it('numbers each project from its own counter', async () => {
    const db = fakeDb([row('a', '/src/app', '2026-08-01'), row('b', '/src/site', '2026-08-01')]);
    const store = fakeStore();

    await assignMissingLocalKeys(db, store, '/src/app');
    await assignMissingLocalKeys(db, store, '/src/site');

    expect(db.rows.find((r) => r.id === 'a')?.local_key).toBe('APP.1');
    expect(db.rows.find((r) => r.id === 'b')?.local_key).toBe('SIT.1');
  });
});

describe('resolveRowByLocalKey', () => {
  it('resolves only inside the project that issued the number', async () => {
    const db = fakeDb([row('a', '/src/app', '2026-08-01')]);
    const store = fakeStore();
    await assignMissingLocalKeys(db, store, '/src/app');

    expect(await resolveRowByLocalKey(db, 'APP.1', '/src/app')).toMatchObject({ id: 'a' });
    expect(await resolveRowByLocalKey(db, 'APP.1', '/src/site')).toBeNull();
  });

  it('refuses a team key, so a dash can never reach the local lane', async () => {
    const db = fakeDb([row('a', '/src/app', '2026-08-01')]);
    expect(await resolveRowByLocalKey(db, 'NIM-212', '/src/app')).toBeNull();
  });
});
