import { app, BrowserWindow, screen } from 'electron';
import { join } from 'path';
import { safeHandle, safeOn } from '../utils/ipcRegistry';
import { getPreloadPath } from '../utils/appPaths';
import { getTheme } from '../utils/store';
import { logger } from '../utils/logger';
import { applyDockIcon } from '../utils/dockIcon';
import { loadTrayGlyphDataUri } from '../tray/trayGlyph';
import {
  ISLAND_FADE_MS,
  MENU_BAR_ISLAND_CHANNELS,
  type IslandRect,
  type MenuBarIslandState,
} from '../../shared/menuBarIsland';
import {
  ISLAND_WINDOW_HEIGHT,
  ISLAND_WINDOW_WIDTH,
  islandWindowBounds,
  isCursorOverIsland,
  nextHoverState,
  type HoverState,
} from './islandGeometry';

/**
 * The menu bar island: the second render style for the fleet strip.
 *
 * A transparent, click-through window drawn *inside* the menu bar row, which
 * expands downward into the same session rows the tray panel shows. The tray
 * bitmap strip (`TrayStripRenderer`) is the other style; `trayStripStyle`
 * picks between them and TrayManager routes to one or the other.
 *
 * The window recipe below is not a matter of taste -- every line was measured
 * against a real compositor in `nimbalyst-local/spikes/menu-bar-island/`, and
 * the two annotated ones are load-bearing. macOS only: it draws over the menu
 * bar, which Windows and Linux have no equivalent of.
 */

/** Cursor poll. Fast enough that hover feels instant, cheap enough to leave on. */
const POLL_MS = 90;

let islandWindow: BrowserWindow | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let islandRect: IslandRect = { left: 0, top: 0, width: 0, height: 0 };
let hover: HoverState = { hovered: false, outsideSince: 0 };
let pinned = false;
let ignoringMouse = true;
let latestState: MenuBarIslandState | null = null;
/** Set while the fade-out is in flight, so a fleet waking up mid-fade cancels it. */
let fadeTimer: NodeJS.Timeout | null = null;
let onSelectSession: ((sessionId: string, workspacePath: string) => void) | null = null;
/**
 * Told whenever the panel opens or closes, so the owner can fetch the per-row
 * snippets only while they are on screen. Nothing else needs them.
 */
let onExpandedChange: ((expanded: boolean) => void) | null = null;

export function isMenuBarIslandSupported(): boolean {
  return process.platform === 'darwin';
}

function loadIslandRenderer(window: BrowserWindow): void {
  const query: Record<string, string> = { mode: 'menu-bar-island', theme: getTheme() };

  if (process.env.NODE_ENV === 'development') {
    const devPort = process.env.VITE_PORT || '5273';
    const search = new URLSearchParams(query).toString();
    void window.loadURL(`http://localhost:${devPort}/?${search}`);
    return;
  }

  const appPath = app.getAppPath();
  let htmlPath: string;
  if (app.isPackaged) {
    htmlPath = join(appPath, 'out/renderer/index.html');
  } else if (appPath.includes('/out/main') || appPath.includes('\\out\\main')) {
    htmlPath = join(appPath, '../renderer/index.html');
  } else {
    htmlPath = join(appPath, 'out/renderer/index.html');
  }
  void window.loadFile(htmlPath, { query });
}

/** The display the island lives on. Follows the menu bar the user is looking at. */
function targetDisplayBounds() {
  return screen.getPrimaryDisplay().bounds;
}

function createIslandWindow(): BrowserWindow {
  const bounds = islandWindowBounds(targetDisplayBounds());

  const window = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Never takes key focus, so hovering the island cannot pull the user out of
    // whatever app is frontmost. Unlike `type: 'panel'` -- which the tray panel
    // documents as demoting the whole app to the accessory activation policy,
    // stripping the Dock icon and the Cmd+Tab entry -- this does not.
    focusable: false,
    acceptFirstMouse: true,
    // REQUIRED, and the single non-obvious line here. Without it AppKit's
    // `constrainFrameRect:` snaps y from the display top down to the bottom of
    // the menu bar the moment the window becomes visible, and no window level
    // overrides that. The island would silently become an ordinary panel
    // floating under the menu bar.
    enableLargerThanScreen: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: getPreloadPath(),
      webviewTag: false,
    },
  });

  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setIgnoreMouseEvents(true, { forward: true });

  window.on('closed', () => {
    islandWindow = null;
    stopPolling();
  });

  // The other half of "click anywhere else to close". Pinning focuses the
  // window precisely so that this can fire; without it a click outside the
  // window's own bounds is never delivered to us at all and the panel stays
  // open forever.
  window.on('blur', () => {
    if (pinned) setPinned(false);
  });

  loadIslandRenderer(window);

  window.webContents.once('did-finish-load', () => {
    if (window.isDestroyed()) return;
    // NSStatusWindowLevel. Enough to clear the menu bar and to stay visible over
    // another app's full-screen space; screen-saver level is not needed.
    window.setAlwaysOnTop(true, 'status');
    // Re-assert the bounds now that the level is above the menu bar.
    window.setBounds(islandWindowBounds(targetDisplayBounds()));
    window.showInactive();
    // The renderer pulls the glyph and its first frame itself once mounted --
    // see `requestInit`. Pushing here would land before React subscribes.
  });

  // The tray panel found that creating a window with this shape can demote the
  // app's activation policy, which strips the Dock icon and the Cmd+Tab entry
  // for the whole app. Setting a policy rebuilds the Dock tile and discards the
  // runtime icon, so the two calls belong together.
  if (process.platform === 'darwin') {
    app.setActivationPolicy('regular');
    applyDockIcon();
  }

  return window;
}

// ─── Hover, by polling the cursor ────────────────────────────────────────────

function pollCursor(): void {
  if (!islandWindow || islandWindow.isDestroyed()) return;

  const inside = isCursorOverIsland(
    screen.getCursorScreenPoint(),
    islandWindow.getBounds(),
    islandRect,
  );
  const next = nextHoverState(hover, { inside, pinned, now: Date.now() });
  const changed = next.hovered !== hover.hovered;
  hover = next;
  if (!changed) return;

  // Interactive only while the cursor is actually over the island, so the rest
  // of the menu bar keeps receiving its own clicks.
  setIgnoreMouse(!hover.hovered);
  pushState();
  onExpandedChange?.(hover.hovered);
}

/**
 * Pin the panel open, or release it.
 *
 * Pinning takes key focus, which the island otherwise never does. That is the
 * only mechanism that can notice a click landing somewhere else on screen: the
 * window is click-through and unfocused at rest, so nothing outside its own
 * bounds is ever delivered to it. The cost is that pinning activates Nimbalyst
 * -- the same trade the tray panel already makes, and here it follows a
 * deliberate click rather than a hover.
 */
function setPinned(next: boolean): void {
  if (next === pinned) return;
  pinned = next;
  if (!islandWindow || islandWindow.isDestroyed()) return;

  if (pinned) {
    islandWindow.setFocusable(true);
    islandWindow.focus();
    hover = { hovered: true, outsideSince: 0 };
  } else {
    // Back to never taking focus, so plain hovering cannot pull the user out of
    // whatever app is frontmost.
    islandWindow.setFocusable(false);
    // Hand the decision back to the poll rather than forcing a collapse: the
    // cursor may still be sitting on the island, in which case releasing the
    // pin should leave it open.
    const inside = isCursorOverIsland(
      screen.getCursorScreenPoint(),
      islandWindow.getBounds(),
      islandRect,
    );
    hover = { hovered: inside, outsideSince: inside ? 0 : Date.now() };
  }

  setIgnoreMouse(!hover.hovered);
  pushState();
  onExpandedChange?.(hover.hovered);

  // The fleet may have gone idle while this was pinned open, in which case the
  // fade was deferred rather than skipped. Releasing the pin is when it is
  // finally safe to take the island away.
  if (!pinned && latestState && !latestState.visible) beginFadeOut();
}

function setIgnoreMouse(ignore: boolean): void {
  if (ignore === ignoringMouse) return;
  ignoringMouse = ignore;
  islandWindow?.setIgnoreMouseEvents(ignore, { forward: true });
}

function startPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(pollCursor, POLL_MS);
  // Nothing in the menu bar is worth keeping the event loop alive for.
  pollTimer.unref?.();
}

function stopPolling(): void {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function pushState(): void {
  if (!islandWindow || islandWindow.isDestroyed() || !latestState) return;
  islandWindow.webContents.send(MENU_BAR_ISLAND_CHANNELS.state, {
    ...latestState,
    expanded: hover.hovered,
  });
}

// ─── Public surface ──────────────────────────────────────────────────────────

/**
 * Paint a frame, creating the window on first use.
 *
 * Created lazily so a user who never turns the island on never pays for it, and
 * so the window does not exist before the first fleet state arrives.
 *
 * `visible: false` is the idle fleet. The window is *hidden*, not destroyed --
 * it comes straight back on the next transition, and rebuilding a transparent
 * always-on-top window on every lull would be both slow and a fresh chance to
 * re-hit the `enableLargerThanScreen` clamp. Nothing reachable only through the
 * island may exist, because in this state there is no island: the tray icon is
 * how the user gets to the panel.
 */
export function showMenuBarIsland(state: Omit<MenuBarIslandState, 'expanded'>): void {
  if (!isMenuBarIslandSupported()) return;

  const wasVisible = latestState?.visible ?? false;
  latestState = { ...state, expanded: hover.hovered };

  if (!state.visible) {
    // Never create a window just to hide it -- an install that launches quiet
    // should not pay for one at all.
    if (!islandWindow || islandWindow.isDestroyed()) return;
    // Pinning is the user reading the panel on purpose. The last session
    // finishing is not a reason to pull it out from under them; `setPinned`
    // re-checks this and fades then.
    if (pinned) {
      pushState();
      return;
    }
    if (wasVisible) beginFadeOut();
    return;
  }

  cancelFadeOut();

  if (!islandWindow || islandWindow.isDestroyed()) {
    islandWindow = createIslandWindow();
    startPolling();
    return;
  }
  if (!islandWindow.isVisible()) islandWindow.showInactive();
  startPolling();
  pushState();
}

/**
 * Let the renderer fade out, then hide the window.
 *
 * The state carrying `visible: false` has already been pushed by the caller, so
 * the renderer is animating to transparent while this timer runs. Polling stops
 * immediately: an invisible island must not expand under the cursor.
 */
function beginFadeOut(): void {
  cancelFadeOut();
  stopPolling();
  hover = { hovered: false, outsideSince: 0 };
  setIgnoreMouse(true);
  pushState();
  fadeTimer = setTimeout(() => {
    fadeTimer = null;
    if (islandWindow && !islandWindow.isDestroyed()) islandWindow.hide();
  }, ISLAND_FADE_MS);
  fadeTimer.unref?.();
}

function cancelFadeOut(): void {
  if (!fadeTimer) return;
  clearTimeout(fadeTimer);
  fadeTimer = null;
}

/** Tear the island down -- style switched away, strip hidden, or tray destroyed. */
export function closeMenuBarIsland(): void {
  stopPolling();
  cancelFadeOut();
  hover = { hovered: false, outsideSince: 0 };
  pinned = false;
  ignoringMouse = true;
  islandRect = { left: 0, top: 0, width: 0, height: 0 };
  latestState = null;
  if (islandWindow && !islandWindow.isDestroyed()) islandWindow.destroy();
  islandWindow = null;
}

/**
 * Whether this is the island window.
 *
 * It is a `BrowserWindow`, so it shows up in `getAllWindows()` alongside project
 * windows. Anything that means "a window the user works in" has to exclude it,
 * exactly as it already excludes the tray panel.
 */
export function isMenuBarIslandWindow(window: BrowserWindow): boolean {
  return !!islandWindow && !islandWindow.isDestroyed() && window === islandWindow;
}

/** Only the island's own renderer may drive these actions. */
function isIslandSender(event: Electron.IpcMainEvent): boolean {
  return isIslandWebContents(event.sender);
}

function isIslandSenderInvoke(event: Electron.IpcMainInvokeEvent): boolean {
  return isIslandWebContents(event.sender);
}

function isIslandWebContents(sender: Electron.WebContents): boolean {
  return !!(
    islandWindow
    && !islandWindow.isDestroyed()
    && sender === islandWindow.webContents
  );
}

export function setupMenuBarIslandHandlers(dependencies: {
  onSelectSession: (sessionId: string, workspacePath: string) => void;
  onExpandedChange: (expanded: boolean) => void;
}): void {
  onSelectSession = dependencies.onSelectSession;
  onExpandedChange = dependencies.onExpandedChange;

  safeHandle(MENU_BAR_ISLAND_CHANNELS.requestInit, async (event) => {
    if (!isIslandSenderInvoke(event)) return null;
    return {
      glyph: loadTrayGlyphDataUri(),
      state: latestState ? { ...latestState, expanded: hover.hovered } : null,
    };
  });

  safeOn(MENU_BAR_ISLAND_CHANNELS.rect, (event, rect: IslandRect) => {
    if (!isIslandSender(event) || !rect) return;
    islandRect = rect;
  });

  safeOn(MENU_BAR_ISLAND_CHANNELS.togglePin, (event) => {
    if (!isIslandSender(event)) return;
    setPinned(!pinned);
  });

  safeOn(MENU_BAR_ISLAND_CHANNELS.dismiss, (event) => {
    if (!isIslandSender(event)) return;
    if (pinned) {
      setPinned(false);
      return;
    }
    // Not pinned, so there is no focus to drop -- just close and let the poll
    // re-open it if the cursor really is still on the island.
    hover = { hovered: false, outsideSince: 0 };
    setIgnoreMouse(true);
    pushState();
  });

  safeOn(MENU_BAR_ISLAND_CHANNELS.selectSession, (event, payload: { sessionId?: string; workspacePath?: string }) => {
    if (!isIslandSender(event)) return;
    const { sessionId, workspacePath } = payload ?? {};
    if (!sessionId || !workspacePath) {
      logger.main.warn('[MenuBarIsland] Ignoring select-session without a session and workspace');
      return;
    }
    // Acting on a row dismisses the panel; leaving it pinned open over the app
    // the user just jumped to would be in the way.
    setPinned(false);
    hover = { hovered: false, outsideSince: 0 };
    setIgnoreMouse(true);
    pushState();
    onSelectSession?.(sessionId, workspacePath);
  });
}

export const __testing = {
  ISLAND_WINDOW_WIDTH,
  ISLAND_WINDOW_HEIGHT,
};
