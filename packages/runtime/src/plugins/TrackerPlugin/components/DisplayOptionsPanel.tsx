/**
 * DisplayOptionsPanel -- the whole control surface for a tracker view: which
 * view mode renders it, which axis its columns group by, how items are ordered
 * within a group, and which columns the table shows.
 *
 * Every knob here belongs to the saved view, so the caller's change handlers
 * write view state rather than a local presentation flag.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  size,
  useFloating,
} from '@floating-ui/react';
import { windowControlsClearance } from '../../../ui/floating/windowControlsClearance';
import type { TrackerGroupBy } from '../models/trackerGrouping';
import type { TrackerOrdering } from '../models/trackerOrdering';
import { DisplayOptionsColumnList } from './DisplayOptionsColumnList';
import { DisplayViewSettings, type DisplayOptionsViewMode } from './DisplayViewSettings';
import type { TrackerColumnDef, TypeColumnConfig } from './trackerColumns';

export type { DisplayOptionsViewMode } from './DisplayViewSettings';

interface DisplayOptionsPanelProps {
  /** All available columns for this type */
  availableColumns: TrackerColumnDef[];
  /** Current column config */
  config: TypeColumnConfig;
  /** Called when config changes */
  onConfigChange: (config: TypeColumnConfig) => void;
  /** Close the panel */
  onClose: () => void;
  /**
   * The trigger the panel hangs off. Required, and never optional: a tracker
   * view lives inside scrolling and transformed containers, so an inline
   * `absolute` fallback clips against the wrong ancestor. `null` is only the
   * before-first-paint value of a trigger ref; the panel repositions the moment
   * the element exists.
   */
  anchorElement: HTMLElement | null;
  /** View modes to offer; omitted (or empty) drops the view-mode row. */
  viewModes?: readonly DisplayOptionsViewMode[];
  /** Currently rendered view mode. */
  viewMode?: string;
  onViewModeChange?: (viewMode: string) => void;
  /** Grouping axis for the board's columns and the list's groups. */
  groupBy?: TrackerGroupBy;
  onGroupByChange?: (groupBy: TrackerGroupBy) => void;
  /** Manual (dragged) order, or a sortable column to order by. */
  ordering?: TrackerOrdering;
  onOrderingChange?: (ordering: TrackerOrdering) => void;
  /**
   * Whether the view has table columns to configure. Board and inbox modes
   * still get the view settings above, just not the column properties.
   */
  showColumnProperties?: boolean;
}

export const DisplayOptionsPanel: React.FC<DisplayOptionsPanelProps> = ({
  availableColumns,
  config,
  onConfigChange,
  onClose,
  anchorElement,
  viewModes,
  viewMode,
  onViewModeChange,
  groupBy,
  onGroupByChange,
  ordering,
  onOrderingChange,
  showColumnProperties = true,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const { refs, floatingStyles } = useFloating({
    open: true,
    placement: 'bottom-end',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      windowControlsClearance(),
      size({
        padding: 8,
        apply({ availableHeight, elements, middlewareData }) {
          const pushed = middlewareData.windowControlsClearance?.pushed ?? 0;
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight - pushed)}px`;
        },
      }),
    ],
  });

  useEffect(() => {
    if (anchorElement) refs.setReference(anchorElement);
  }, [anchorElement, refs]);

  const setPanelElement = useCallback((element: HTMLDivElement | null) => {
    panelRef.current = element;
    refs.setFloating(element);
  }, [refs]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current
        && !panelRef.current.contains(target)
        && !anchorElement?.contains(target)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [anchorElement, onClose]);

  const panel = (
    <div
      ref={setPanelElement}
      style={floatingStyles}
      data-testid="tracker-display-options-panel"
      className="tracker-display-options-panel flex w-[272px] flex-col overflow-hidden rounded-lg border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] shadow-xl z-50"
    >
      <div className="px-3 py-2 border-b border-[var(--nim-border)]">
        <span className="text-xs font-semibold text-[var(--nim-text)]">Display Settings</span>
      </div>

      <div
        className="min-h-0 overflow-y-auto overscroll-contain"
        data-testid="tracker-display-options-scroll-region"
      >
        <DisplayViewSettings
          availableColumns={availableColumns}
          viewModes={viewModes}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          groupBy={groupBy}
          onGroupByChange={onGroupByChange}
          ordering={ordering}
          onOrderingChange={onOrderingChange}
        />

        {showColumnProperties && (
          <DisplayOptionsColumnList
            availableColumns={availableColumns}
            config={config}
            onConfigChange={onConfigChange}
          />
        )}
      </div>

      {showColumnProperties && (
        <div className="px-3 py-2 border-t border-[var(--nim-border)]">
          <button
            className="text-xs text-[var(--nim-text-faint)] hover:text-[var(--nim-text)] transition-colors"
            onClick={() => {
              const defaults = availableColumns.filter(c => c.defaultVisible).map(c => c.id);
              onConfigChange({ visibleColumns: defaults, columnWidths: {} });
            }}
          >
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );

  return <FloatingPortal>{panel}</FloatingPortal>;
};
