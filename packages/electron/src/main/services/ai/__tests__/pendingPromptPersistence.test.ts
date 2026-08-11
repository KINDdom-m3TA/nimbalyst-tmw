import { describe, it, expect, beforeEach, vi } from 'vitest';

const updateMetadata = vi.fn();
const trayManager = { onPromptCreated: vi.fn(), onPromptResolved: vi.fn() };

vi.mock('@nimbalyst/runtime', () => ({
  AISessionsRepository: {
    updateMetadata: (...args: unknown[]) => updateMetadata(...args),
  },
}));
vi.mock('../../SyncManager', () => ({ getSyncProvider: () => null }));
vi.mock('../../../tray/TrayManager', () => ({
  TrayManager: { getInstance: () => trayManager },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { main: { warn: vi.fn(), info: vi.fn() } },
}));

import {
  getSessionsWithPendingPrompt,
  resetPendingPromptTracking,
  setSessionPendingPrompt,
} from '../pendingPromptPersistence';

describe('pending-prompt in-memory mirror (NIM-2208)', () => {
  beforeEach(() => {
    resetPendingPromptTracking();
    updateMetadata.mockReset().mockResolvedValue(undefined);
    trayManager.onPromptCreated.mockReset();
    trayManager.onPromptResolved.mockReset();
  });

  it('tracks sessions as the bit is set and cleared', async () => {
    expect(getSessionsWithPendingPrompt()).toEqual([]);

    await setSessionPendingPrompt('s1', true);
    await setSessionPendingPrompt('s2', true);
    expect(getSessionsWithPendingPrompt().sort()).toEqual(['s1', 's2']);

    await setSessionPendingPrompt('s1', false);
    expect(getSessionsWithPendingPrompt()).toEqual(['s2']);
  });

  it('does not double-count a session whose bit is set twice', async () => {
    await setSessionPendingPrompt('s1', true);
    await setSessionPendingPrompt('s1', true);
    expect(getSessionsWithPendingPrompt()).toEqual(['s1']);
  });

  it('does not track a session whose write failed', async () => {
    // The mirror stands in for the DB during the reconcile, so it must not claim
    // a bit that was never persisted.
    updateMetadata.mockRejectedValueOnce(new Error('db down'));
    await setSessionPendingPrompt('s1', true);
    expect(getSessionsWithPendingPrompt()).toEqual([]);
  });

  it('ignores an empty session id', async () => {
    await setSessionPendingPrompt('', true);
    expect(getSessionsWithPendingPrompt()).toEqual([]);
    expect(updateMetadata).not.toHaveBeenCalled();
  });
});

/**
 * The menu bar used to learn about open prompts from its own `onPromptCreated`
 * calls, separate from this bit. Keeping the two in step was left to each
 * callsite, and the MCP AskUserQuestion handler called neither for SDK
 * sessions -- so a session sitting on an unanswered question was filed under
 * "Running" in the tray panel. Persisting and notifying are now one call.
 */
describe('tray notification is part of persisting the bit', () => {
  beforeEach(() => {
    resetPendingPromptTracking();
    updateMetadata.mockReset().mockResolvedValue(undefined);
    trayManager.onPromptCreated.mockReset();
    trayManager.onPromptResolved.mockReset();
  });

  it('tells the tray a prompt opened', async () => {
    await setSessionPendingPrompt('s1', true);

    expect(trayManager.onPromptCreated).toHaveBeenCalledWith('s1');
    expect(trayManager.onPromptResolved).not.toHaveBeenCalled();
  });

  it('tells the tray a prompt resolved', async () => {
    await setSessionPendingPrompt('s1', false);

    expect(trayManager.onPromptResolved).toHaveBeenCalledWith('s1');
    expect(trayManager.onPromptCreated).not.toHaveBeenCalled();
  });

  it('still notifies the tray when the database write fails', async () => {
    // The tray is in-memory state; a failed row update must not leave the menu
    // bar claiming a blocked session is merely running.
    updateMetadata.mockRejectedValue(new Error('db down'));

    await setSessionPendingPrompt('s1', true);

    expect(trayManager.onPromptCreated).toHaveBeenCalledWith('s1');
  });
});
