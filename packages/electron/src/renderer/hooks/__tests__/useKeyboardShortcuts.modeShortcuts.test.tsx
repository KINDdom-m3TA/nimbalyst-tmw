// @vitest-environment jsdom
/**
 * The mode shortcuts double as pane toggles: pressing a mode's own chord while
 * that mode is already active collapses/expands its left pane instead of
 * re-selecting the mode. Cmd+T was the odd one out until it joined Cmd+E and
 * Cmd+K, and nothing on screen distinguishes "switched again" from "toggled".
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import type { ContentMode } from '../../types/WindowModeTypes';

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));

const setActiveMode = vi.fn();
const toggleActiveLeftPane = vi.fn();
const exitFullscreenPanel = vi.fn();

function Harness({ activeMode, isFullscreenPanelActive = false }: {
  activeMode: ContentMode;
  isFullscreenPanelActive?: boolean;
}): React.ReactElement {
  useKeyboardShortcuts({
    activeMode,
    workspaceMode: true,
    setActiveMode,
    activeModeStateRef: { current: activeMode },
    editorModeRef: { current: null },
    agentModeRef: { current: null },
    toggleAgentCollapsed: vi.fn(),
    toggleActiveLeftPane,
    openHistoryForCurrentDocument: vi.fn(),
    isFullscreenPanelActive,
    exitFullscreenPanel,
  });
  return <div />;
}

/** Dispatch the app modifier + key, matching the hook's platform detection. */
function pressAppModifier(key: string): void {
  const isMac = navigator.platform.startsWith('Mac');
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    metaKey: isMac,
    ctrlKey: !isMac,
    bubbles: true,
  }));
}

beforeEach(() => {
  setActiveMode.mockReset();
  toggleActiveLeftPane.mockReset();
  exitFullscreenPanel.mockReset();
});

describe('Cmd+T', () => {
  it('switches into Tracker mode from another mode', () => {
    render(<Harness activeMode="files" />);
    pressAppModifier('t');

    expect(setActiveMode).toHaveBeenCalledWith('tracker');
    expect(toggleActiveLeftPane).not.toHaveBeenCalled();
  });

  it('toggles the left pane instead of re-switching when already in Tracker mode', () => {
    render(<Harness activeMode="tracker" />);
    pressAppModifier('t');

    expect(toggleActiveLeftPane).toHaveBeenCalledTimes(1);
    expect(setActiveMode).not.toHaveBeenCalled();
  });

  it('surfaces Tracker mode rather than toggling an unseen pane behind a fullscreen panel', () => {
    render(<Harness activeMode="tracker" isFullscreenPanelActive />);
    pressAppModifier('t');

    expect(exitFullscreenPanel).toHaveBeenCalledTimes(1);
    expect(setActiveMode).toHaveBeenCalledWith('tracker');
    expect(toggleActiveLeftPane).not.toHaveBeenCalled();
  });
});
