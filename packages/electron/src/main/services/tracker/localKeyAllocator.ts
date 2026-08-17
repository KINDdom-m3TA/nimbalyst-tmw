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

export interface LocalKeyPrefixConfig {
  prefix: string;
  locked: boolean;
  matchesTeamPrefix: boolean;
  warning?: string;
}

const LOCAL_KEY_PREFIX_PATTERN = /^[A-Z]{2,5}$/;

function normalizePrefix(prefix: string): string {
  return prefix.trim().toUpperCase();
}

/**
 * The local-prefix state shown in tracker settings.
 *
 * Merely opening settings does not pin the derived suggestion. The prefix is
 * persisted only when the user chooses it or the first local number is issued,
 * which keeps an untouched project free to route around prefixes claimed by
 * projects opened later in the same app session.
 */
export function getLocalKeyPrefixConfig(
  store: LocalKeyStateStore,
  workspacePath: string,
  teamPrefix?: string,
): LocalKeyPrefixConfig {
  const state = store.read(workspacePath);
  const prefix = state.prefix ?? resolveLocalKeyPrefix({
    projectNameOrPath: workspacePath,
    takenPrefixes: store.takenPrefixes(workspacePath),
  });
  const normalizedTeamPrefix = teamPrefix ? normalizePrefix(teamPrefix) : undefined;
  const matchesTeamPrefix = normalizedTeamPrefix === prefix;

  return {
    prefix,
    locked: (state.counter ?? 0) > 0,
    matchesTeamPrefix,
    ...(matchesTeamPrefix ? {
      warning: 'Using different local and team prefixes makes private numbers easier to recognize. The dot still keeps them mechanically distinct.',
    } : {}),
  };
}

/**
 * Persist the user's local prefix while changing it is still safe.
 *
 * A matching team prefix is intentionally only a warning. The team prefix may
 * already be immutable when a project joins a team; the dot is the durable
 * private-vs-shared boundary. Machine-local collisions are refused because two
 * projects using the same dotted reference would make lookup ambiguous.
 */
export function configureLocalKeyPrefix(
  store: LocalKeyStateStore,
  workspacePath: string,
  requestedPrefix: string,
  teamPrefix?: string,
): LocalKeyPrefixConfig {
  const prefix = normalizePrefix(requestedPrefix);
  if (!LOCAL_KEY_PREFIX_PATTERN.test(prefix)) {
    throw new Error('Local tracker prefix must be 2-5 uppercase letters.');
  }

  const current = store.read(workspacePath);
  if ((current.counter ?? 0) > 0 && current.prefix !== prefix) {
    throw new Error('The local tracker prefix cannot be changed after the first local number is issued.');
  }

  const taken = new Set(store.takenPrefixes(workspacePath).map(normalizePrefix));
  if (taken.has(prefix)) {
    throw new Error(`Local tracker prefix ${prefix} is already used by another project on this machine.`);
  }

  store.write(workspacePath, { prefix, counter: current.counter ?? 0 });
  return getLocalKeyPrefixConfig(store, workspacePath, teamPrefix);
}

interface QueryableDb {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

const workspaceAllocationTails = new Map<string, Promise<void>>();

/**
 * Allocation touches both workspace settings and the tracker database, so the
 * database's write lane alone cannot make the combined operation atomic. Keep
 * one in-process queue per workspace and let unrelated projects proceed in
 * parallel.
 */
async function withWorkspaceAllocationLock<T>(
  workspacePath: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = workspaceAllocationTails.get(workspacePath) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.then(() => undefined, () => undefined);
  workspaceAllocationTails.set(workspacePath, tail);

  try {
    return await run;
  } finally {
    if (workspaceAllocationTails.get(workspacePath) === tail) {
      workspaceAllocationTails.delete(workspacePath);
    }
  }
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
  if (rowIds.length === 0) return new Map();

  return withWorkspaceAllocationLock(workspacePath, async () => {
    const assigned = new Map<string, string>();
    const prefix = ensureLocalKeyPrefix(store, workspacePath);
    let counter = store.read(workspacePath).counter ?? 0;

    for (const rowId of rowIds) {
      // `rowIds` came from a list query that may have completed before another
      // sweep acquired this lock. Re-read inside the lock so a stale caller
      // reports the key the database already holds instead of spending and
      // returning a new key that its guarded UPDATE never wrote.
      const before = await db.query<{ local_key: string | null }>(
        `SELECT local_key FROM tracker_items
          WHERE id = $1 AND workspace = $2
          LIMIT 1`,
        [rowId, workspacePath],
      );
      if (!before.rows[0]) continue;
      if (before.rows[0].local_key) {
        assigned.set(rowId, before.rows[0].local_key);
        continue;
      }

      counter += 1;
      // Persist the advance before the row is written, so a crash here spends a
      // number rather than reissuing it.
      store.write(workspacePath, { prefix, counter });

      const localKey = formatLocalKey(prefix, counter);
      await db.query(
        `UPDATE tracker_items SET local_key = $1
          WHERE id = $2 AND workspace = $3 AND local_key IS NULL`,
        [localKey, rowId, workspacePath],
      );

      // Only return the value the database confirms. This is deliberately not
      // `assigned.set(rowId, localKey)`: if any future writer bypasses this
      // in-process queue, the guarded UPDATE can still lose its race.
      const after = await db.query<{ local_key: string | null }>(
        `SELECT local_key FROM tracker_items
          WHERE id = $1 AND workspace = $2
          LIMIT 1`,
        [rowId, workspacePath],
      );
      if (after.rows[0]?.local_key) {
        assigned.set(rowId, after.rows[0].local_key);
      }
    }

    return assigned;
  });
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
