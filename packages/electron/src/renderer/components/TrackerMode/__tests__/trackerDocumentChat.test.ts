/**
 * The item-scoped chat panel must land on ONE conversation per tracker item:
 * the remembered pairing when it survives, an existing linked chat otherwise,
 * then the standard chat sidebar chooses or creates a conversation.
 */
import { describe, expect, it } from 'vitest';
import type { SessionMeta } from '../../../store/atoms/sessions';
import { buildTrackerChatContext, resolveTrackerChatSessionId } from '../trackerDocumentChat';

function session(id: string, overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id,
    title: id,
    provider: 'claude-code',
    model: null,
    createdAt: 0,
    updatedAt: 0,
    messageCount: 0,
    ...overrides,
  } as SessionMeta;
}

function registryOf(...sessions: SessionMeta[]): Map<string, SessionMeta> {
  return new Map(sessions.map((entry) => [entry.id, entry]));
}

describe('resolveTrackerChatSessionId', () => {
  it('prefers the remembered pairing', () => {
    const paired = session('chat-1');
    const linked = session('chat-2');

    expect(resolveTrackerChatSessionId({
      pairedSessionId: 'chat-1',
      linkedSessions: [linked],
      sessionRegistry: registryOf(paired, linked),
    })).toBe('chat-1');
  });

  it('falls back to a linked chat when the pairing points at a deleted session', () => {
    const linked = session('chat-2');

    expect(resolveTrackerChatSessionId({
      pairedSessionId: 'chat-gone',
      linkedSessions: [linked],
      sessionRegistry: registryOf(linked),
    })).toBe('chat-2');
  });

  it('skips linked sessions that are coding work, not a chat', () => {
    const worktree = session('worktree-1', { worktreeId: 'wt-1' });
    const workstream = session('workstream-1', { childCount: 3 });
    const chat = session('chat-3');

    expect(resolveTrackerChatSessionId({
      pairedSessionId: null,
      linkedSessions: [worktree, workstream, chat],
      sessionRegistry: registryOf(worktree, workstream, chat),
    })).toBe('chat-3');
  });

  it('reports none when the item has no chat yet, so the standard sidebar initializes normally', () => {
    const worktree = session('worktree-1', { worktreeId: 'wt-1' });

    expect(resolveTrackerChatSessionId({
      pairedSessionId: undefined,
      linkedSessions: [worktree],
      sessionRegistry: registryOf(worktree),
    })).toBeNull();
  });
});

describe('buildTrackerChatContext', () => {
  const baseItem = {
    id: 'item-a',
    issueKey: 'NIM-1647',
    primaryType: 'plan',
    typeTags: ['plan'],
    source: 'frontmatter',
    fields: { title: 'Tracker document mode', status: 'in-progress', description: 'Body text' },
    system: { documentPath: 'plans/tracker-document-mode.md' },
  } as any;

  it('mentions the backing file so the agent can read the document', () => {
    const context = buildTrackerChatContext('item-a', baseItem);

    expect(context.draftInput).toContain('NIM-1647');
    expect(context.draftInput).toContain('@plans/tracker-document-mode.md');
    expect(context.trackerLinkId).toBe('file:plans/tracker-document-mode.md');
    expect(context.sessionTitle).toBe('Chat about NIM-1647');
  });

  it('points a database-only item at the tracker tools instead of a path', () => {
    const context = buildTrackerChatContext('item-b', {
      ...baseItem,
      id: 'item-b',
      issueKey: 'NIM-2000',
      source: 'native',
      system: {},
    });

    expect(context.draftInput).toContain('tracker_get');
    expect(context.draftInput).not.toContain('Document: @');
    expect(context.trackerLinkId).toBe('item-b');
  });

  it('degrades to the raw id when the record has not loaded yet', () => {
    const context = buildTrackerChatContext('item-c', null);

    expect(context.sessionTitle).toBe('Chat about item-c');
    expect(context.trackerLinkId).toBe('item-c');
  });
});
