/**
 * Item-scoped chat for the tracker document view.
 *
 * The chat surface itself is the ordinary `ChatSidebar` -- this module only
 * answers the two questions the panel has to resolve before mounting it:
 * *which* session is this item's conversation, and what does a brand-new one
 * start with.
 *
 * Pairing rules, in order:
 *   1. The session remembered for this item in the tracker layout, if it still
 *      exists.
 *   2. Otherwise the most recently updated session already linked to the item
 *      that could plausibly be a chat (no worktree, no child sessions) --
 *      reopening an item shouldn't strand a conversation the user already had
 *      about it just because the pairing wasn't written yet.
 *   3. Otherwise none: the panel creates one the first time it's opened, and
 *      links it back to the item.
 */

import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  getRecordFieldStr,
  getRecordPriority,
  getRecordStatus,
  getRecordTitle,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import type { SessionMeta } from '../../store/atoms/sessions';

/** Session shapes that can act as a chat, matching `sessionListChatAtom`. */
export function isChatEligibleSession(session: SessionMeta | undefined | null): boolean {
  if (!session) return false;
  if (session.agentRole === 'meta-agent') return false;
  if (session.worktreeId) return false;
  if (session.childCount && session.childCount > 0) return false;
  return true;
}

export function resolveTrackerChatSessionId(params: {
  /** Session remembered for this item in the persisted tracker layout. */
  pairedSessionId: string | null | undefined;
  /** Sessions already linked to the item (see `resolveLinkedSessions`). */
  linkedSessions: SessionMeta[];
  sessionRegistry: Map<string, SessionMeta>;
}): string | null {
  const { pairedSessionId, linkedSessions, sessionRegistry } = params;
  if (pairedSessionId && sessionRegistry.has(pairedSessionId)) return pairedSessionId;

  // `resolveLinkedSessions` already sorts most-recently-updated first.
  const candidate = linkedSessions.find(isChatEligibleSession);
  return candidate?.id ?? null;
}

export interface TrackerChatContext {
  /** Title for a newly created chat session. */
  sessionTitle: string;
  /** Draft seeded into a newly created chat session. */
  draftInput: string;
  /** Id to pass to `tracker:link-session` (file ref wins for file-backed items). */
  trackerLinkId: string;
  /** Label shown in the panel header. */
  itemLabel: string;
}

const MAX_SESSION_TITLE_LENGTH = 120;

export function buildTrackerChatContext(
  itemId: string,
  item?: TrackerRecord | null,
): TrackerChatContext {
  const title = item ? getRecordTitle(item) : itemId;
  const key = item?.issueKey || itemId;
  const itemLabel = `${key} ${title}`.trim();

  const lines: string[] = [`Regarding ${key}: ${title}`];
  if (item) {
    const meta: string[] = [];
    if (item.primaryType) meta.push(`type: ${item.primaryType}`);
    const status = getRecordStatus(item);
    if (status) meta.push(`status: ${status}`);
    const priority = getRecordPriority(item);
    if (priority) meta.push(`priority: ${priority}`);
    if (meta.length > 0) lines.push(meta.join(', '));

    const description = getRecordFieldStr(item, 'description');
    if (description) lines.push(`\n${description}`);

    // File-backed items carry their document on disk, so an `@` mention gives
    // the agent the whole thing. Database-only items have to be read with the
    // tracker tools instead.
    if (item.system.documentPath) {
      lines.push(`\nDocument: @${item.system.documentPath}`);
    } else {
      lines.push(`\nRead this item's document with tracker_get id "${key}".`);
    }
  }
  lines.push('');

  return {
    sessionTitle: `Chat about ${key}`.slice(0, MAX_SESSION_TITLE_LENGTH),
    draftInput: lines.join('\n'),
    trackerLinkId: item?.system.documentPath ? `file:${item.system.documentPath}` : itemId,
    itemLabel,
  };
}
