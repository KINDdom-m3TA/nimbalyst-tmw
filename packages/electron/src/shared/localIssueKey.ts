/**
 * Local-only issue keys for tracker items that do not yet have a
 * server-assigned identity.
 *
 * The `NIM-###` namespace (or whatever the room's prefix is) belongs to the
 * tracker room and to nothing else. A client that mints into it is guessing,
 * and two clients guessing independently is how the same shared item ended up
 * as NIM-2521 in one workspace and NIM-2525 in another: every create path
 * allocated a local `MAX(issue_number)+1` before the mutation was acked, and
 * the loser never converged.
 *
 * A synced item therefore carries an `LC-###` key between creation and the
 * ack. It is visibly not a real issue key, so nobody pastes it into a commit
 * message expecting `CommitTrackerLinker` to resolve it, and it never occupies
 * `issue_number` -- the column the room owns.
 */

export const LOCAL_ISSUE_KEY_PREFIX = 'LC';

const LOCAL_ISSUE_KEY_PATTERN = /^LC-(\d+)$/;

export function formatLocalIssueKey(localNumber: number): string {
  return `${LOCAL_ISSUE_KEY_PREFIX}-${localNumber}`;
}

/**
 * True for a provisional local key. Callers that resolve user-typed references
 * (commit trailers, `Fixes` lines) must treat these as unresolvable rather than
 * matching them against the room's namespace.
 */
export function isLocalIssueKey(issueKey: string | null | undefined): boolean {
  return typeof issueKey === 'string' && LOCAL_ISSUE_KEY_PATTERN.test(issueKey.trim());
}

/**
 * How a key should be described to an agent or a user.
 *
 * A provisional key is not just "not final" -- it is actively unsafe to hold
 * onto. `nextLocalIssueNumber` derives the next suffix by scanning rows whose
 * key still starts with `LC-`, so once the ack rewrites `LC-2` to `NIM-2615`
 * nothing matches and the counter resets: the next create is `LC-2` again.
 * A caller that stashed the first `LC-2` and later resolves it lands on a
 * different item entirely.
 */
export function describeIssueKey(
  issueKey: string | null | undefined,
  itemId: string,
): { ref: string; isProvisional: boolean; caveat: string | null } {
  if (!issueKey) {
    return { ref: itemId, isProvisional: false, caveat: null };
  }
  if (!isLocalIssueKey(issueKey)) {
    return { ref: issueKey, isProvisional: false, caveat: null };
  }
  return {
    ref: `${issueKey} (provisional)`,
    isProvisional: true,
    caveat:
      `${issueKey} is a local placeholder, NOT this item's issue key. The server assigns the real key. ` +
      `Re-read the item by its ID (${itemId}) to get it. Do not put ${issueKey} in commit messages, ` +
      `links, or references -- it does not resolve, and it is later reused by a different item.`,
  };
}

/** Numeric suffix of a local key, or null when it is not one. */
export function parseLocalIssueNumber(issueKey: string | null | undefined): number | null {
  if (typeof issueKey !== 'string') return null;
  const match = LOCAL_ISSUE_KEY_PATTERN.exec(issueKey.trim());
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
