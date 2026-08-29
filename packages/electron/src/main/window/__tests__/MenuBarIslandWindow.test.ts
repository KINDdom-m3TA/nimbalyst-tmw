// @vitest-environment node
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

/**
 * The idle fleet hides the island.
 *
 * Everything about *when* that happens is pure and covered next to the state
 * machine (`isIdleView` in fleetSnapshot.test.ts). What is only observable here
 * is what the window does about it: that it fades before it hides rather than
 * snapping out of the menu bar, that it stops polling the cursor the moment it
 * is invisible, and that it does not yank itself away from a user who has
 * deliberately pinned the panel open.
 */

const { browserWindowCtor, appMock, screenMock, applyDockIconMock } = vi.hoisted(() => {
  const listeners = new Map<string, Function>();
  const instance = {
    listeners,
    visible: false,
    on: vi.fn((event: string, handler: Function) => { listeners.set(event, handler); }),
    once: vi.fn((event: string, handler: Function) => { listeners.set(event, handler); }),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => instance.visible),
    showInactive: vi.fn(() => { instance.visible = true; }),
    hide: vi.fn(() => { instance.visible = false; }),
    focus: vi.fn(),
    destroy: vi.fn(),
    setBounds: vi.fn(),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 760, height: 460 })),
    setVisibleOnAllWorkspaces: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    setFocusable: vi.fn(),
    loadURL: vi.fn(() => Promise.resolve()),
    loadFile: vi.fn(() => Promise.resolve()),
    webContents: { send: vi.fn(), once: vi.fn() },
  };
  return {
    browserWindowCtor: Object.assign(
      vi.fn(function (_options?: Record<string, unknown>) { return instance; }),
      { instance },
    ),
    appMock: { getAppPath: () => '/app', isPackaged: false, setActivationPolicy: vi.fn() },
    applyDockIconMock: vi.fn(),
    screenMock: {
      getPrimaryDisplay: vi.fn(() => ({ bounds: { x: 0, y: 0, width: 1440, height: 900 } })),
      // Parked far from the island, so nothing hovers by accident.
      getCursorScreenPoint: vi.fn(() => ({ x: 5, y: 800 })),
    },
  };
});

vi.mock('electron', () => ({
  app: appMock,
  BrowserWindow: browserWindowCtor,
  screen: screenMock,
}));
const { ipcHandlers } = vi.hoisted(() => ({ ipcHandlers: new Map<string, Function>() }));
vi.mock('../../utils/ipcRegistry', () => ({
  safeHandle: vi.fn(),
  safeOn: vi.fn((channel: string, handler: Function) => { ipcHandlers.set(channel, handler); }),
}));
vi.mock('../../utils/appPaths', () => ({ getPreloadPath: () => '/preload.js' }));
vi.mock('../../utils/store', () => ({ getTheme: () => 'dark' }));
vi.mock('../../utils/logger', () => ({ logger: { main: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } } }));
vi.mock('../../utils/dockIcon', () => ({ applyDockIcon: applyDockIconMock }));
vi.mock('../../tray/trayGlyph', () => ({ loadTrayGlyphDataUri: () => null }));

import {
  closeMenuBarIsland,
  setupMenuBarIslandHandlers,
  showMenuBarIsland,
} from '../MenuBarIslandWindow';
import { ISLAND_FADE_MS, MENU_BAR_ISLAND_CHANNELS } from '../../../shared/menuBarIsland';
import { emptyTrayPanelFeed } from '../../../shared/traySessions';

const win = browserWindowCtor.instance;

function frame(visible: boolean) {
  return {
    strip: {
      mode: 'counts' as const,
      needsApproval: 0,
      needsDecision: 0,
      running: visible ? 1 : 0,
      failed: 0,
      stalled: 0,
      unread: 0,
      age: null,
    },
    feed: emptyTrayPanelFeed(),
    snippets: {},
    visible,
  };
}

/** The window is created hidden and shown by the `did-finish-load` handler. */
function finishLoad() {
  const handler = win.listeners.get('did-finish-load');
  if (handler) handler();
  else win.showInactive();
}

describe('MenuBarIslandWindow idle hiding', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    closeMenuBarIsland();
    vi.clearAllMocks();
    win.visible = false;
    win.listeners.clear();
  });

  afterEach(() => {
    closeMenuBarIsland();
    vi.useRealTimers();
  });

  it('fades before hiding rather than snapping out of the menu bar', () => {
    showMenuBarIsland(frame(true));
    finishLoad();
    expect(win.isVisible()).toBe(true);

    showMenuBarIsland(frame(false));

    // The frame carrying `visible: false` goes out first, so the renderer is
    // already animating to transparent while this timer runs.
    const sent = win.webContents.send.mock.calls.at(-1);
    expect(sent?.[1]).toMatchObject({ visible: false });
    expect(win.hide).not.toHaveBeenCalled();

    vi.advanceTimersByTime(ISLAND_FADE_MS + 1);
    expect(win.hide).toHaveBeenCalledTimes(1);
  });

  it('comes back without rebuilding the window, and cancels a fade in flight', () => {
    showMenuBarIsland(frame(true));
    finishLoad();
    showMenuBarIsland(frame(false));

    // A session starts again before the fade finishes.
    showMenuBarIsland(frame(true));
    vi.advanceTimersByTime(ISLAND_FADE_MS + 1);

    // The deferred hide must not fire after the island is wanted again -- that
    // would leave a visible-but-hidden island until the next repaint.
    expect(win.hide).not.toHaveBeenCalled();
    expect(browserWindowCtor).toHaveBeenCalledTimes(1);
  });

  it('never builds a window just to hide it', () => {
    showMenuBarIsland(frame(false));
    expect(browserWindowCtor).not.toHaveBeenCalled();
  });

  // Pinning is the user reading the panel on purpose. The last session
  // finishing is not a reason to pull it out from under them mid-sentence.
  it('defers the fade while the panel is pinned open, and takes it on release', () => {
    setupMenuBarIslandHandlers({ onSelectSession: vi.fn(), onExpandedChange: vi.fn() });
    const togglePin = ipcHandlers.get(MENU_BAR_ISLAND_CHANNELS.togglePin)!;
    const event = { sender: win.webContents };

    showMenuBarIsland(frame(true));
    finishLoad();
    togglePin(event);

    showMenuBarIsland(frame(false));
    vi.advanceTimersByTime(ISLAND_FADE_MS * 4);
    expect(win.hide).not.toHaveBeenCalled();

    togglePin(event);
    vi.advanceTimersByTime(ISLAND_FADE_MS + 1);
    expect(win.hide).toHaveBeenCalledTimes(1);
  });
});
