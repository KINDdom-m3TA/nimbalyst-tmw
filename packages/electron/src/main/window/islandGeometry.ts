/**
 * Pure geometry and hover logic for the menu bar island.
 *
 * Kept out of `MenuBarIslandWindow` so the fiddly part -- deciding when the
 * island is hovered -- is testable without Electron, a display, or a cursor.
 *
 * Hover is decided by polling the cursor in main rather than by `mouseleave` in
 * the renderer. Entry via forwarded `mousemove` is reliable; exit is not,
 * because the window stops receiving events the moment the cursor leaves it. A
 * poll answers both with one implementation. Proven on a real machine in
 * `nimbalyst-local/spikes/menu-bar-island/`.
 */

import type { IslandRect } from '../../shared/menuBarIsland';

/**
 * Window size.
 *
 * Fixed, and large enough for the widest expanded panel: the island is a `div`
 * inside it that animates with CSS. Resizing the *window* to expand jitters and
 * cannot be transitioned, which is the whole reason for the oversized canvas.
 * The window is click-through everywhere the island is not.
 */
export const ISLAND_WINDOW_WIDTH = 760;
export const ISLAND_WINDOW_HEIGHT = 460;

/** Don't collapse the instant the cursor clips an edge mid-transition. */
export const ISLAND_EXIT_GRACE_MS = 260;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Centre the island window on the top edge of a display.
 *
 * `y` is the display's own top, *inside* the menu bar. That only survives if the
 * window is created with `enableLargerThanScreen: true`: without it AppKit's
 * `constrainFrameRect:` snaps `y` down to the bottom of the menu bar the moment
 * the window becomes visible, and no window level overrides it.
 */
export function islandWindowBounds(displayBounds: Rect): Rect {
  return {
    x: Math.round(displayBounds.x + displayBounds.width / 2 - ISLAND_WINDOW_WIDTH / 2),
    y: displayBounds.y,
    width: ISLAND_WINDOW_WIDTH,
    height: ISLAND_WINDOW_HEIGHT,
  };
}

/** Is the cursor over the island itself, as opposed to the transparent canvas? */
export function isCursorOverIsland(
  cursor: { x: number; y: number },
  windowBounds: Rect,
  island: IslandRect,
): boolean {
  if (island.width <= 0 || island.height <= 0) return false;
  const x = cursor.x - windowBounds.x;
  const y = cursor.y - windowBounds.y;
  return x >= island.left
    && x <= island.left + island.width
    && y >= island.top
    && y <= island.top + island.height;
}

export interface HoverState {
  hovered: boolean;
  /** When the cursor first went outside, or 0 while it is inside. */
  outsideSince: number;
}

/**
 * Advance the hover state for one poll tick.
 *
 * Opening is immediate; closing waits out `graceMs`. Pinning holds it open
 * regardless of the cursor, which is what the click-the-pill affordance sets.
 */
export function nextHoverState(
  previous: HoverState,
  input: { inside: boolean; pinned: boolean; now: number; graceMs?: number },
): HoverState {
  const graceMs = input.graceMs ?? ISLAND_EXIT_GRACE_MS;

  if (input.inside) return { hovered: true, outsideSince: 0 };
  if (input.pinned) return { hovered: true, outsideSince: 0 };
  if (!previous.hovered) return { hovered: false, outsideSince: 0 };

  const outsideSince = previous.outsideSince || input.now;
  if (input.now - outsideSince >= graceMs) return { hovered: false, outsideSince: 0 };
  return { hovered: true, outsideSince };
}
