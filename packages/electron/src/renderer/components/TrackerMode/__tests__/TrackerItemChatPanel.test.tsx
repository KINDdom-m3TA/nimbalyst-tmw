// @vitest-environment jsdom
import { Provider } from 'jotai';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@nimbalyst/runtime/store';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { replaceAllTrackerItemsAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { sessionRegistryAtom, type SessionMeta } from '../../../store/atoms/sessions';
import { setTrackerModeLayoutAtom } from '../../../store/atoms/trackers';
import { TrackerItemChatPanel } from '../TrackerItemChatPanel';

const chatSidebarProps = vi.hoisted(() => vi.fn());

vi.mock('../../ChatSidebar/ChatSidebar', () => ({
  ChatSidebar: (props: Record<string, unknown>) => {
    chatSidebarProps(props);
    return <div data-testid="standard-chat-sidebar" />;
  },
}));

const ITEM = {
  id: 'bug-1',
  primaryType: 'bug',
  typeTags: ['bug'],
  issueKey: 'NIM-1',
  source: 'native',
  archived: false,
  syncStatus: 'local',
  fields: { title: 'Chat consistency' },
  system: {
    workspace: '/ws',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  },
} as TrackerRecord;

function session(id: string): SessionMeta {
  return {
    id,
    title: 'Linked item session',
    provider: 'claude-code',
    model: null,
    createdAt: 0,
    updatedAt: 1,
    messageCount: 0,
  } as SessionMeta;
}

function renderPanel() {
  return render(
    <Provider store={store}>
      <TrackerItemChatPanel itemId={ITEM.id} workspacePath="/ws" isActive />
    </Provider>,
  );
}

describe('TrackerItemChatPanel', () => {
  beforeEach(() => {
    chatSidebarProps.mockClear();
    store.set(replaceAllTrackerItemsAtom, [ITEM]);
    store.set(sessionRegistryAtom, new Map());
    store.set(setTrackerModeLayoutAtom, { documentChatSessions: {} });
  });

  it('uses the ordinary ChatSidebar initializer when the item has no linked session', () => {
    renderPanel();

    expect(screen.getByTestId('standard-chat-sidebar')).toBeTruthy();
    expect(chatSidebarProps).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: null,
      autoInitializeSession: true,
      newSessionTitle: 'Chat about NIM-1',
    }));
  });

  it('defaults to the remembered item session without replacing standard session controls', () => {
    const linked = session('session-1');
    store.set(sessionRegistryAtom, new Map([[linked.id, linked]]));
    store.set(setTrackerModeLayoutAtom, {
      documentChatSessions: { [ITEM.id]: linked.id },
    });

    renderPanel();

    expect(chatSidebarProps).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: linked.id,
      autoInitializeSession: false,
    }));
  });
});
