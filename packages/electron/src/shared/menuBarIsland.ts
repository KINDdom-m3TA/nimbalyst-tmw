/**
 * Wire contract between TrayManager (main) and the menu bar island renderer.
 *
 * The island is the second render style for the same `StripView` the tray
 * bitmap strip draws -- see `trayStripStyle` in the app store. It is its own
 * renderer (`?mode=menu-bar-island`) with an empty Jotai store, so like the tray
 * panel it takes its whole dataset from the main process.
 *
 * It carries the tray panel's `TrayPanelFeed` verbatim rather than a shape of
 * its own, so the expanded rows are the same rows the popover renders.
 */

import type { TrayIdleSummary, TrayPanelFeed } from './traySessions';

/** Fade to nothing, then the window hides. Matches the expand/collapse easing. */
export const ISLAND_FADE_MS = 260;

/** Everything the island needs to paint one frame. */
export interface MenuBarIslandState {
  /**
   * The strip line, as a plain wire shape.
   *
   * `StripView` itself lives in the main-process tray module; duplicating the
   * two variants here keeps the renderer from importing main-process code.
   */
  strip:
    | {
        mode: 'counts';
        needsApproval: number;
        needsDecision: number;
        running: number;
        failed: number;
        stalled: number;
        unread: number;
        age: { label: string; hot: boolean } | null;
      }
    | {
        mode: 'named';
        sessionId: string;
        title: string;
        state: 'approval' | 'decision' | 'failed' | 'running' | 'completed' | 'stalled';
        age: { label: string; hot: boolean };
      };
  /** The same buckets the tray panel renders. */
  feed: TrayPanelFeed;
  /**
   * Present only when every bucket is empty, and consumed only by the panel.
   *
   * The collapsed island is *invisible* in this state -- see `visible` -- so
   * this is what the user gets when they open the panel from the tray icon
   * instead.
   */
  idle?: TrayIdleSummary;
  /**
   * Whether the island should be painted at all.
   *
   * False when the fleet is idle. The renderer fades to transparent and main
   * hides the window `ISLAND_FADE_MS` later, so the disappearance is not a
   * snap. Appearing needs no such treatment: it coincides with a real
   * transition, which is the whole naming principle.
   */
  visible: boolean;
  /**
   * sessionId -> one line of what that session last said.
   *
   * Only populated while the island is expanded: the resting strip has no use
   * for it and it costs a database read. Absent for a session that has not said
   * anything yet, which the row renders by simply omitting the line.
   */
  snippets: Record<string, string>;
  /** Main owns the hit test (see islandGeometry), so it owns the open state too. */
  expanded: boolean;
}

export const MENU_BAR_ISLAND_CHANNELS = {
  /** main → island: a full frame. */
  state: 'menu-bar-island:state',
  /**
   * island → main (invoke): the glyph and the current frame, on mount.
   *
   * Pulled rather than pushed. Main finishes loading the window and would
   * naturally send on `did-finish-load`, but React has not mounted by then and
   * the renderer's IPC listener does not exist yet, so a one-shot push is
   * dropped on the floor. The state self-heals on the next repaint; the glyph
   * never changes, so it would simply never arrive -- which is exactly how it
   * failed. Same fix the tray panel uses for its initial feed.
   */
  requestInit: 'menu-bar-island:request-init',
  /** island → main: the island's laid-out rect, for the cursor hit test. */
  rect: 'menu-bar-island:rect',
  /** island → main: open this session's workspace window and navigate to it. */
  selectSession: 'menu-bar-island:select-session',
  /** island → main: the collapsed pill was clicked; pin or unpin the panel. */
  togglePin: 'menu-bar-island:toggle-pin',
  /**
   * island → main: close the panel.
   *
   * Sent for Escape, and for a click that lands inside the island's window but
   * outside the island itself. That second case is not hypothetical: the window
   * is a large transparent canvas, and while the panel is open the whole canvas
   * captures the mouse, so a click just beside the panel is delivered here
   * rather than to the app underneath.
   */
  dismiss: 'menu-bar-island:dismiss',
} as const;

/** Island rect in window coordinates, as the renderer measured it. */
export interface IslandRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
