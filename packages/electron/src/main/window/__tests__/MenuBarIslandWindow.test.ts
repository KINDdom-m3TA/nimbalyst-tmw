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

const {
  browserWindowCtor,
  appMock,
  screenMock,
  applyDockIconMock,
  setIslandDisplayMock,
  cursorRef,
} = vi.hoisted(() => {
  /** The primary at the origin, and a second display 2048pt to its right. */
  const displays = [
    {
      id: 1,
      label: 'Studio Display',
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea: { x: 0, y: 30, width: 1440, height: 870 },
      internal: false,
    },
    {
      id: 2,
      label: 'Built-in',
      bounds: { x: 2048, y: 0, width: 1440, height: 900 },
      workArea: { x: 2048, y: 30, width: 1440, height: 870 },
      internal: false,
    },
  ];
  /** Mutable so a test can walk the cursor across the display boundary. */
  const cursorRef = { current: { x: 5, y: 800 } };
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
    setIslandDisplayMock: vi.fn(),
    cursorRef,
    screenMock: {
      // Two external displays, so a drag has somewhere to go and the island
      // centres on both. Notch placement is covered in islandGeometry.test.ts.
      getPrimaryDisplay: vi.fn(() => displays[0]),
      getAllDisplays: vi.fn(() => displays),
      getDisplayNearestPoint: vi.fn((point: { x: number; y: number }) => (
        displays.find((display) => (
          point.x >= display.bounds.x && point.x < display.bounds.x + display.bounds.width
        )) ?? displays[0]
      )),
      // Parked far from the island, so nothing hovers by accident.
      getCursorScreenPoint: vi.fn(() => cursorRef.current),
      on: vi.fn(),
      removeListener: vi.fn(),
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
vi.mock('../../utils/store', () => ({
  getTheme: () => 'dark',
  // No saved choice, so placement follows the primary until a drag says otherwise.
  getIslandDisplay: () => null,
  setIslandDisplay: setIslandDisplayMock,
}));
vi.mock('../../utils/logger', () => ({ logger: { main: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } } }));
vi.mock('../../utils/dockIcon', () => ({ applyDockIcon: applyDockIconMock }));
vi.mock('../../tray/trayGlyph', () => ({ loadTrayGlyphDataUri: () => null }));

import {
  closeMenuBarIsland,
  setupMenuBarIslandHandlers,
  showMenuBarIsland,
} from '../MenuBarIslandWindow';
import { ISLAND_FADE_MS, MENU_BAR_ISLAND_CHANNELS } from '../../../shared/menuBarIsland';
import { ISLAND_WINDOW_WIDTH } from '../islandGeometry';
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
    // Back on the primary, far from the island, so nothing hovers or drags by
    // accident and each drag test starts its gesture from a known point.
    cursorRef.current = { x: 5, y: 800 };
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
    const event = { sender: win.webContents };
    // A press that does not move is the pin toggle -- the pill is both the
    // toggle and the drag handle, and main is what tells them apart.
    const togglePin = () => {
      ipcHandlers.get(MENU_BAR_ISLAND_CHANNELS.dragStart)!(event);
      ipcHandlers.get(MENU_BAR_ISLAND_CHANNELS.dragEnd)!(event);
    };

    showMenuBarIsland(frame(true));
    finishLoad();
    togglePin();

    showMenuBarIsland(frame(false));
    vi.advanceTimersByTime(ISLAND_FADE_MS * 4);
    expect(win.hide).not.toHaveBeenCalled();

    togglePin();
    vi.advanceTimersByTime(ISLAND_FADE_MS + 1);
    expect(win.hide).toHaveBeenCalledTimes(1);
  });

  // The gesture that this whole drag path exists for: the island has to end up
  // on the display the user released it over, and stay there next launch.
  it('moves to the display the press was released on, and remembers it', () => {
    setupMenuBarIslandHandlers({ onSelectSession: vi.fn(), onExpandedChange: vi.fn() });
    const event = { sender: win.webContents };

    showMenuBarIsland(frame(true));
    finishLoad();
    win.setBounds.mockClear();

    ipcHandlers.get(MENU_BAR_ISLAND_CHANNELS.dragStart)!(event);
    // Travel well past the slop, onto the second display.
    cursorRef.current = { x: 2400, y: 10 };
    ipcHandlers.get(MENU_BAR_ISLAND_CHANNELS.dragMove)!(event);
    ipcHandlers.get(MENU_BAR_ISLAND_CHANNELS.dragEnd)!(event);

    expect(setIslandDisplayMock).toHaveBeenCalledWith({ id: 2, label: 'Built-in' });
    // Centred on the second display, whose origin is x=2048.
    expect(win.setBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: 2048 + 720 - ISLAND_WINDOW_WIDTH / 2, y: 0 }),
    );
  });

  it('reads a press that never moved as a pin, not a move', () => {
    setupMenuBarIslandHandlers({ onSelectSession: vi.fn(), onExpandedChange: vi.fn() });
    const event = { sender: win.webContents };

    showMenuBarIsland(frame(true));
    finishLoad();

    ipcHandlers.get(MENU_BAR_ISLAND_CHANNELS.dragStart)!(event);
    // Within the slop: a hand that failed to hold still, not an instruction.
    cursorRef.current = { x: 5 + 3, y: 800 };
    ipcHandlers.get(MENU_BAR_ISLAND_CHANNELS.dragEnd)!(event);

    expect(setIslandDisplayMock).not.toHaveBeenCalled();
  });
});
