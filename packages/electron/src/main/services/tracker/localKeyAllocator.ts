/**
 * Allocation of machine-private tracker numbers (`NIM.12`).
 *
 * There are eight places that insert into `tracker_items`, so minting at the
 * insert would mean eight copies of the counter logic and one of them
 * eventually drifting. Instead this sweeps the workspace for rows that have no
 * number yet and assigns one to each, in creation order. New items and the
 * one-time backfill of pre-existing items are therefore the same code path,
 * and the counter is touched in exactly one function.
 *
 * Two rules make this safe, and both were violated by the attempts that were
 * rolled back:
 *
 * 1. The counter is persisted and only counts up. It is never derived from the
 *    rows -- `LC-###` recomputed it by counting rows that still carried a local
 *    key, so a number was released the moment its item was acked or deleted,
 *    and the next create reused it. A note saying "LC-2" silently came to mean
 *    a different item.
 * 2. The counter advances BEFORE the row is written. A crash in between spends
 *    a number without using it, which costs nothing. The reverse order would
 *    reissue it, which is the failure worth avoiding: a missing number is an
 *    annoyance, a recycled one sends you to the wrong item with no warning.
 */

import { formatLocalKey, parseLocalKey } from '../../../shared/localIssueKey';
import { resolveLocalKeyPrefix } from '../../../shared/trackerIssueKeyPrefix';

export interface LocalKeyStateStore {
  read(workspacePath: string): { prefix?: string; counter?: number };
  write(workspacePath: string, next: { prefix: string; counter: number }): void;
  takenPrefixes(workspacePath: string): string[];
}

interface QueryableDb {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Pin this project's prefix if it does not have one yet.
 *
 * Pinning is one-way. If the project later joins a team and the room assigns
 * different letters, team keys move and local numbers do not: rewriting them
 * would change what an already-written reference points at.
 */
export function ensureLocalKeyPrefix(
  store: LocalKeyStateStore,
  workspacePath: string,
): string {
  const existing = store.read(workspacePath);
  if (existing.prefix) return existing.prefix;

  const prefix = resolveLocalKeyPrefix({
    projectNameOrPath: workspacePath,
    takenPrefixes: store.takenPrefixes(workspacePath),
  });
  store.write(workspacePath, { prefix, counter: existing.counter ?? 0 });
  return prefix;
}

/**
 * Give every unnumbered item in this workspace a local number.
 *
 * Returns how many were assigned. Safe to run repeatedly: a second pass finds
 * nothing to do, so this can be called after a create without becoming a
 * per-item write.
 */
export async function assignMissingLocalKeys(
  db: QueryableDb,
  store: LocalKeyStateStore,
  workspacePath: string,
): Promise<number> {
  const unnumbered = await db.query<{ id: string }>(
    `SELECT id FROM tracker_items
      WHERE workspace = $1 AND local_key IS NULL AND deleted_at IS NULL
      ORDER BY created ASC, id ASC`,
    [workspacePath],
  );
  const assigned = await assignLocalKeysToRows(
    db,
    store,
    workspacePath,
    unnumbered.rows.map((r) => r.id),
  );
  return assigned.size;
}

/**
 * The same allocation over rows the caller has already read.
 *
 * The tracker list query selects the workspace's rows anyway, so it can tell
 * which ones lack a number without a second round trip. In the steady state
 * that list is empty and this costs nothing at all -- which is the point, since
 * this runs on every list.
 */
export async function assignLocalKeysToRows(
  db: QueryableDb,
  store: LocalKeyStateStore,
  workspacePath: string,
  rowIds: string[],
): Promise<Map<string, string>> {
  const assigned = new Map<string, string>();
  if (rowIds.length === 0) return assigned;

  const prefix = ensureLocalKeyPrefix(store, workspacePath);
  let counter = store.read(workspacePath).counter ?? 0;

  for (const rowId of rowIds) {
    counter += 1;
    // Persist the advance before the row is written, so a crash here spends a
    // number rather than reissuing it.
    store.write(workspacePath, { prefix, counter });

    const localKey = formatLocalKey(prefix, counter);
    // `local_key IS NULL` in the predicate keeps a concurrent sweep from
    // overwriting a number that another pass just assigned; the unique index
    // is the second line of defence.
    await db.query(
      `UPDATE tracker_items SET local_key = $1
        WHERE id = $2 AND workspace = $3 AND local_key IS NULL`,
      [localKey, rowId, workspacePath],
    );
    assigned.set(rowId, localKey);
  }

  return assigned;
}

/**
 * Resolve a dotted reference to a row, within one project only.
 *
 * A local number means something different in every project on the machine, so
 * resolving one without knowing which project is the ambiguity this whole
 * scheme exists to avoid. There is deliberately no workspace-less variant.
 */
export async function resolveRowByLocalKey(
  db: QueryableDb,
  reference: string,
  workspacePath: string,
): Promise<unknown | null> {
  if (!parseLocalKey(reference)) return null;
  const result = await db.query(
    `SELECT * FROM tracker_items
      WHERE local_key = $1 AND workspace = $2
      LIMIT 1`,
    [reference.trim().toUpperCase(), workspacePath],
  );
  return result.rows[0] ?? null;
}
