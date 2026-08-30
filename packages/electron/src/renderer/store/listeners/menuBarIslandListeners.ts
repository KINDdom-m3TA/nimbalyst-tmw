/**
 * Centralized IPC listener for the menu bar island.
 *
 * The island is its own renderer (`?mode=menu-bar-island`) with an empty session
 * registry, so its entire dataset arrives from the main process. Per
 * docs/IPC_LISTENERS.md the subscription lives here and `MenuBarIslandApp` reads
 * the atom.
 */

import { atom } from 'jotai';
import { store } from '../index';
import { MENU_BAR_ISLAND_CHANNELS, type MenuBarIslandState } from '../../../shared/menuBarIsland';
import { emptyTrayPanelFeed } from '../../../shared/traySessions';

export function emptyMenuBarIslandState(): MenuBarIslandState {
  return {
    strip: {
      mode: 'counts',
      needsApproval: 0,
      needsDecision: 0,
      running: 0,
      failed: 0,
      stalled: 0,
      unread: 0,
      age: null,
    },
    feed: emptyTrayPanelFeed(),
    snippets: {},
    expanded: false,
    // Main overrides this with the real display's anchor on the first frame.
    // Centring is the safe placeholder: nothing is painted yet either way.
    anchor: 'center',
    // Nothing has arrived yet, and an empty frame is by definition the idle
    // state -- which is the one state that paints nothing. Starting visible
    // would flash a bare glyph in the menu bar on every launch.
    visible: false,
  };
}

/** The last frame pushed by TrayManager. */
export const menuBarIslandStateAtom = atom<MenuBarIslandState>(emptyMenuBarIslandState());

/** The tray glyph, pushed once on load. Empty until it arrives. */
export const menuBarIslandGlyphAtom = atom<string | null>(null);

/**
 * Subscribe to state pushes.
 *
 * Unlike the tray panel there is no initial pull: main creates this window only
 * once it already has a frame to draw, and sends it on `did-finish-load`.
 */
export function initMenuBarIslandListener(): () => void {
  const unsubscribe = window.electronAPI.on(
    MENU_BAR_ISLAND_CHANNELS.state,
    (next: MenuBarIslandState) => {
      store.set(menuBarIslandStateAtom, next ?? emptyMenuBarIslandState());
    },
  );
  // Pull the glyph and the current frame now that this listener exists. Main
  // cannot usefully push either at `did-finish-load`: React has not mounted, so
  // there is nothing subscribed to receive them.
  void window.electronAPI
    .invoke(MENU_BAR_ISLAND_CHANNELS.requestInit)
    .then((init: { glyph?: string; state?: MenuBarIslandState | null } | null) => {
      if (!init) return;
      if (init.glyph) store.set(menuBarIslandGlyphAtom, init.glyph);
      if (init.state) store.set(menuBarIslandStateAtom, init.state);
    });

  return () => unsubscribe?.();
}
