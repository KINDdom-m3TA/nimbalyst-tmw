// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ISLAND_WINDOW_HEIGHT,
  ISLAND_WINDOW_WIDTH,
  islandWindowBounds,
  isCursorOverIsland,
  nextHoverState,
} from '../islandGeometry';

describe('islandWindowBounds', () => {
  it('centres on the display and sits at its top edge, not its work area', () => {
    // y must be the display's own top: the island draws *inside* the menu bar.
    // Returning workArea.y here would put it below the menu bar and the feature
    // silently becomes an ordinary floating panel.
    expect(islandWindowBounds({ x: 0, y: 0, width: 2048, height: 1152 })).toEqual({
      x: 1024 - ISLAND_WINDOW_WIDTH / 2,
      y: 0,
      width: ISLAND_WINDOW_WIDTH,
      height: ISLAND_WINDOW_HEIGHT,
    });
  });

  it('respects a display with a negative origin', () => {
    const bounds = islandWindowBounds({ x: -1352, y: 274, width: 1352, height: 878 });
    expect(bounds.x).toBe(Math.round(-1352 + 676 - ISLAND_WINDOW_WIDTH / 2));
    expect(bounds.y).toBe(274);
  });
});

describe('isCursorOverIsland', () => {
  const win = { x: 644, y: 0, width: ISLAND_WINDOW_WIDTH, height: ISLAND_WINDOW_HEIGHT };
  const island = { left: 280, top: 0, width: 200, height: 30 };

  it('converts the cursor into window coordinates', () => {
    expect(isCursorOverIsland({ x: 644 + 380, y: 14 }, win, island)).toBe(true);
    expect(isCursorOverIsland({ x: 644 + 100, y: 14 }, win, island)).toBe(false);
    expect(isCursorOverIsland({ x: 644 + 380, y: 90 }, win, island)).toBe(false);
  });

  it('is never hot before the renderer has reported a rect', () => {
    // The window spans 760x460 of transparent canvas. A zero-size island that
    // still answered "inside" for the origin would make the whole top-left
    // corner of the screen swallow clicks.
    expect(isCursorOverIsland({ x: 644, y: 0 }, win, { left: 0, top: 0, width: 0, height: 0 }))
      .toBe(false);
  });
});

describe('nextHoverState', () => {
  const closed = { hovered: false, outsideSince: 0 };

  it('opens immediately on entry', () => {
    expect(nextHoverState(closed, { inside: true, pinned: false, now: 1000 }))
      .toEqual({ hovered: true, outsideSince: 0 });
  });

  it('holds open through the exit grace, then closes', () => {
    const open = { hovered: true, outsideSince: 0 };
    const leaving = nextHoverState(open, { inside: false, pinned: false, now: 1000, graceMs: 260 });
    expect(leaving).toEqual({ hovered: true, outsideSince: 1000 });

    // Still inside the grace window.
    const stillOpen = nextHoverState(leaving, { inside: false, pinned: false, now: 1200, graceMs: 260 });
    expect(stillOpen.hovered).toBe(true);
    // The grace must be measured from when the cursor *first* left, not from
    // this tick -- carrying `now` forward each poll would hold it open forever.
    expect(stillOpen.outsideSince).toBe(1000);

    expect(nextHoverState(stillOpen, { inside: false, pinned: false, now: 1260, graceMs: 260 }))
      .toEqual({ hovered: false, outsideSince: 0 });
  });

  it('re-entering during the grace clears the pending close', () => {
    const leaving = { hovered: true, outsideSince: 1000 };
    expect(nextHoverState(leaving, { inside: true, pinned: false, now: 1100 }))
      .toEqual({ hovered: true, outsideSince: 0 });
  });

  it('stays open while pinned no matter where the cursor is', () => {
    expect(nextHoverState(closed, { inside: false, pinned: true, now: 5000 }))
      .toEqual({ hovered: true, outsideSince: 0 });
  });

  it('stays closed while the cursor is outside and nothing is pinned', () => {
    expect(nextHoverState(closed, { inside: false, pinned: false, now: 5000 }))
      .toEqual({ hovered: false, outsideSince: 0 });
  });
});
