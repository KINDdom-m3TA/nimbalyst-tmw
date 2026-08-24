/**
 * The table view: rows through RevoGrid, columns through the shared registry.
 *
 * Kept deliberately thin. `TrackerGridView` on desktop is a thousand lines
 * because it also owns an undo stack, a range-edit clipboard, a row context
 * menu, and a bulk-archive path -- none of which are what makes a tracker
 * readable in a browser tab, and all of which would have to be re-proved against
 * a different mutation path. What is shared is the part that must never fork:
 * `buildGridColumns` / `buildGridSource`, which decide what a cell contains and
 * how it compares.
 *
 * RevoGrid is a Stencil web component and its custom elements register
 * globally, so the host page owns exactly one copy (externalized peer,
 * `optimizeDeps.exclude`). A second copy under a different Vite `?v=` hash does
 * not throw -- it renders a blank grid with a clean console (NIM-2165). If this
 * surface is empty and the row count is not, look there first.
 */
import React from 'react';
import type { TrackerRecord } from '../../../../runtime/src/core/TrackerRecord';
import { type TypeColumnConfig } from '../../../../runtime/src/plugins/TrackerPlugin/components/trackerColumns';
import { type TrackerFilterSet, type TrackerRelationshipLabelResolver } from '../../../../runtime/src/plugins/TrackerPlugin/models/index';
import { type SortColumn, type SortDirection } from '../../trackers/index';
import './trackerGrid.css';
export interface TrackerGridSurfaceProps {
    rows: TrackerRecord[];
    /** `'all'` for a mixed-type grid; a tracker type resolves one schema. */
    trackerType: string;
    columnConfig?: TypeColumnConfig | null;
    sortBy?: SortColumn;
    sortDirection?: SortDirection;
    columnFilters?: TrackerFilterSet | null;
    onColumnFiltersChange?: (filters: TrackerFilterSet) => void;
    /** Names a relationship target from the live record rather than the link snapshot. */
    resolveRelationshipLabel?: TrackerRelationshipLabelResolver;
    /** Omit to render a read-only grid; a permission state, not a milestone. */
    isRowEditable?: (itemId: string) => boolean;
    /** One callback for one cell or a whole pasted range; hosts can batch it. */
    onItemsUpdate?: (entries: readonly TrackerGridUpdateEntry[]) => Promise<unknown> | unknown;
    /** False until the first snapshot resolves. */
    loaded: boolean;
}
export interface TrackerGridUpdateEntry {
    itemId: string;
    updates: Record<string, unknown>;
}
export declare function TrackerGridSurface({ rows, trackerType, columnConfig, sortBy, sortDirection, columnFilters, onColumnFiltersChange, resolveRelationshipLabel, isRowEditable, onItemsUpdate, loaded, }: TrackerGridSurfaceProps): React.JSX.Element;
