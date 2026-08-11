// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

// TrayPanelWindow imports electron at module scope. Nothing here touches a real
// window -- only the pure positioning function is under test.
vi.mock('electron', () => ({
  app: { getAppPath: () => '/app', isPackaged: false },
  BrowserWindow: vi.fn(),
  screen: { getDisplayNearestPoint: vi.fn() },
}));
vi.mock('../../utils/ipcRegistry', () => ({ safeHandle: vi.fn(), safeOn: vi.fn() }));
vi.mock('../../utils/appPaths', () => ({ getPreloadPath: () => '/preload.js' }));
vi.mock('../../utils/store', () => ({
  getTheme: () => 'dark',
  getTrayPanelWidth: () => undefined,
  setTrayPanelWidth: vi.fn(),
}));
vi.mock('../../utils/logger', () => ({ logger: { main: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } } }));

import { computeTrayPanelPosition } from '../TrayPanelWindow';

const SIZE = { width: 380, height: 460 };
/** A 1440x900 primary display with the 25px menu bar excluded. */
const PRIMARY = { x: 0, y: 25, width: 1440, height: 875 };

function within(pos: { x: number; y: number }, workArea: typeof PRIMARY): boolean {
  return pos.x >= workArea.x
    && pos.y >= workArea.y
    && pos.x + SIZE.width <= workArea.x + workArea.width
    && pos.y + SIZE.height <= workArea.y + workArea.height;
}

describe('computeTrayPanelPosition', () => {
  it('centres under the tray icon when there is room on both sides', () => {
    const pos = computeTrayPanelPosition({ x: 700, y: 0, width: 24, height: 24 }, PRIMARY, SIZE);

    expect(pos.x).toBe(Math.round(700 + 12 - 190));
    // Below the icon, then held clear of the menu bar by the work-area padding.
    expect(pos.y).toBe(PRIMARY.y + 8);
    expect(within(pos, PRIMARY)).toBe(true);
  });

  it('pulls the panel back on-screen when the icon sits at the right edge', () => {
    // The common case: the tray is right-aligned, so a centred panel overhangs
    // by half its width and would be created partly off the display.
    const pos = computeTrayPanelPosition({ x: 1410, y: 0, width: 24, height: 24 }, PRIMARY, SIZE);

    expect(within(pos, PRIMARY)).toBe(true);
    expect(pos.x).toBe(PRIMARY.width - SIZE.width - 8);
  });

  it('stays inside a secondary display with a negative origin', () => {
    const secondary = { x: -1920, y: -180, width: 1920, height: 1055 };
    const pos = computeTrayPanelPosition({ x: -1900, y: -205, width: 24, height: 24 }, secondary, SIZE);

    expect(within(pos, secondary)).toBe(true);
    expect(pos.x).toBe(secondary.x + 8);
  });

  it('clamps upward when the panel is taller than the space below the icon', () => {
    const shortDisplay = { x: 0, y: 25, width: 1440, height: 400 };
    const pos = computeTrayPanelPosition({ x: 700, y: 0, width: 24, height: 24 }, shortDisplay, SIZE);

    // No room for a 460px panel in a 400px work area: it pins to the top rather
    // than hanging off the bottom where the footer buttons are unreachable.
    expect(pos.y).toBe(shortDisplay.y + 8);
  });
});
