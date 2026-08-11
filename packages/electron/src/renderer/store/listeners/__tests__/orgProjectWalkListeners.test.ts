// @vitest-environment node
import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../contexts/DialogContext', () => ({ dialogRef: { current: null } }));
vi.mock('../../../dialogs/registry', () => ({ DIALOG_IDS: { ORG_PROJECT_WALK: 'org-project-walk' } }));
vi.mock('../../../components/TeamMode/onboarding/orgOnboardingStorage', () => ({
  readOrgProjectWalkDismissals: vi.fn(async () => []),
}));
vi.mock('../../../utils/teamAnalytics', () => ({ trackTeamAnalyticsEvent: vi.fn() }));

import { dialogRef } from '../../../contexts/DialogContext';
import { stytchAuthAtom } from '../../atoms/stytchAuth';
import { windowFocusedAtom } from '../../atoms/windowFocus';
import { initOrgProjectWalkListeners } from '../orgProjectWalkListeners';

const ACME = { orgId: 'org-acme', name: 'Acme Corp' };

function openedDialogs() {
  return (dialogRef.current?.open as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
}

describe('initOrgProjectWalkListeners', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    (dialogRef as { current: unknown }).current = { open: vi.fn(), isOpen: vi.fn(() => false) };
    (globalThis as any).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      electronAPI: {
        team: {
          resolveProjectWalk: vi.fn(async () => ({
            success: true,
            orgs: [ACME],
            boundOrgIds: [],
          })),
        },
      },
    };
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  // Sign-in completes in an external browser, so the auth broadcast routinely
  // lands while no window is the OS-key window. Dropping the walk there loses
  // the whole point of the flow, for its most important entry point.
  it('holds the walk until this window is focused instead of dropping it', async () => {
    const store = createStore();
    store.set(windowFocusedAtom, false);
    store.set(stytchAuthAtom, { isAuthenticated: true, user: null });

    cleanup = initOrgProjectWalkListeners(store);
    await vi.waitFor(() => expect(window.electronAPI.team.resolveProjectWalk).toHaveBeenCalled());
    expect(openedDialogs()).toEqual([]);

    store.set(windowFocusedAtom, true);
    await vi.waitFor(() => expect(openedDialogs()).toEqual(['org-project-walk']));
  });

  // `document.hasFocus()` is true in EVERY window while the app is frontmost,
  // so the walk has to key off this window's own OS focus.
  it('presents once, in the focused window, and not again on later focus changes', async () => {
    const store = createStore();
    store.set(windowFocusedAtom, true);
    store.set(stytchAuthAtom, { isAuthenticated: true, user: null });

    cleanup = initOrgProjectWalkListeners(store);
    await vi.waitFor(() => expect(openedDialogs()).toEqual(['org-project-walk']));

    store.set(windowFocusedAtom, false);
    store.set(windowFocusedAtom, true);
    await vi.waitFor(() => expect(window.electronAPI.team.resolveProjectWalk).toHaveBeenCalledTimes(1));
    expect(openedDialogs()).toEqual(['org-project-walk']);
  });
});
