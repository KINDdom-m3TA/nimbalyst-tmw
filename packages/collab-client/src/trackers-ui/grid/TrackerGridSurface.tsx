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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RevoGrid, type RevoGridCustomEvent } from '@revolist/react-datagrid';
import type { AfterEditEvent, BeforeSaveDataDetails, SortingConfig } from '@revolist/revogrid';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  getDefaultColumnConfig,
  getFieldForColumn,
  resolveColumnFieldName,
  resolveColumnsForType,
  type TrackerColumnDef,
  type TypeColumnConfig,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerColumns';
import { coerceCellValue } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerCellEditors';
import {
  clausesForField,
  hasActiveFilters,
  withFieldClauses,
  type TrackerFilterSet,
  type TrackerRelationshipLabelResolver,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import {
  buildGridSource,
  ROW_ITEM_ID,
  type SortColumn,
  type SortDirection,
} from '@nimbalyst/collab-client/trackers';
import { TrackerSurfaceMessage } from '../primitives/TrackerSurfaceMessage';
import { buildGridActionsColumn, buildGridColumns } from './trackerGridColumns';
import { TrackerColumnFilterPopover } from './TrackerColumnFilterPopover';
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

const NEVER_EDITABLE = () => false;

export function TrackerGridSurface({
  rows,
  trackerType,
  columnConfig,
  sortBy,
  sortDirection = 'desc',
  columnFilters,
  onColumnFiltersChange,
  resolveRelationshipLabel,
  isRowEditable = NEVER_EDITABLE,
  onItemsUpdate,
  loaded,
}: TrackerGridSurfaceProps) {
  const [filterTarget, setFilterTarget] = useState<{ columnId: string; rect: DOMRect } | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const gridCanvasRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<(HTMLElement & {
    getVisibleSource?: (type: 'rgRow') => Promise<Array<Record<string, unknown>>>;
  }) | null>(null);

  const schemaType = trackerType === 'all' ? '' : trackerType;
  const allColumnDefs = useMemo(() => resolveColumnsForType(schemaType), [schemaType]);
  const effectiveConfig = useMemo(
    () => columnConfig ?? getDefaultColumnConfig(schemaType),
    [columnConfig, schemaType],
  );
  const visibleColumnDefs = useMemo(
    () => effectiveConfig.visibleColumns
      .map((id) => allColumnDefs.find((column) => column.id === id))
      .filter((column): column is TrackerColumnDef => column !== undefined),
    [effectiveConfig.visibleColumns, allColumnDefs],
  );

  const filteredColumnIds = useMemo(
    () => new Set((columnFilters?.clauses ?? []).map((clause) => clause.field)),
    [columnFilters],
  );

  const gridColumns = useMemo(
    () => [
      ...buildGridColumns(visibleColumnDefs, {
        trackerType: schemaType,
        columnWidths: effectiveConfig.columnWidths,
        isRowEditable,
        filteredColumnIds,
        onOpenFilter: onColumnFiltersChange
          ? (columnId, rect) => setFilterTarget({ columnId, rect })
          : undefined,
        // The favorite star is a personal-lane affordance; a host that has one
        // renders it through its own grid. Not reconstructed here.
        rowActions: false,
        resolveRelationshipLabel,
      }),
      buildGridActionsColumn(),
    ],
    [
      visibleColumnDefs, schemaType, effectiveConfig.columnWidths, isRowEditable,
      filteredColumnIds, onColumnFiltersChange, resolveRelationshipLabel,
    ],
  );

  const gridSource = useMemo(
    () => buildGridSource(rows, visibleColumnDefs),
    [rows, visibleColumnDefs],
  );

  const gridSorting = useMemo<SortingConfig | undefined>(() => {
    if (!sortBy || !visibleColumnDefs.some((column) => column.id === sortBy)) return undefined;
    return { columns: [{ prop: sortBy, order: sortDirection }] };
  }, [sortBy, sortDirection, visibleColumnDefs]);

  const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

  const resolveGridRecord = useCallback(async (rowIndex: number): Promise<TrackerRecord | null> => {
    try {
      const visible = await gridRef.current?.getVisibleSource?.('rgRow');
      const itemId = visible?.[rowIndex]?.[ROW_ITEM_ID];
      if (typeof itemId === 'string') return rowsById.get(itemId) ?? null;
    } catch {
      // The custom element can still be upgrading. The unsorted source is the
      // only safe fallback and matches RevoGrid until its sort model is active.
    }
    const itemId = gridSource[rowIndex]?.[ROW_ITEM_ID];
    return typeof itemId === 'string' ? rowsById.get(itemId) ?? null : null;
  }, [gridSource, rowsById]);

  const buildUpdate = useCallback(async (
    rowIndex: number,
    changes: Record<string, unknown>,
  ): Promise<TrackerGridUpdateEntry | null> => {
    const item = await resolveGridRecord(rowIndex);
    if (!item || !isRowEditable(item.id)) return null;
    const updates: Record<string, unknown> = {};
    for (const [columnId, rawValue] of Object.entries(changes)) {
      const column = visibleColumnDefs.find((candidate) => candidate.id === columnId);
      if (!column?.editable) continue;
      const fieldName = resolveColumnFieldName(item.primaryType, column);
      const field = getFieldForColumn(item.primaryType, fieldName);
      if (!field || field.readOnly) continue;
      const value = coerceCellValue(field, rawValue);
      if (JSON.stringify(item.fields[fieldName] ?? null) !== JSON.stringify(value ?? null)) {
        updates[fieldName] = value;
      }
    }
    return Object.keys(updates).length > 0 ? { itemId: item.id, updates } : null;
  }, [isRowEditable, resolveGridRecord, visibleColumnDefs]);

  const handleAfterEdit = useCallback(async (event: RevoGridCustomEvent<AfterEditEvent>) => {
    if (!onItemsUpdate) return;
    const detail = event.detail;
    const rawEntries = 'data' in detail && detail.data != null
      ? Object.entries(detail.data).map(([rowIndex, changes]) => ({
          rowIndex: Number(rowIndex),
          changes: changes as Record<string, unknown>,
        }))
      : [{
          rowIndex: (detail as BeforeSaveDataDetails).rowIndex,
          changes: {
            [String((detail as BeforeSaveDataDetails).prop)]: (detail as BeforeSaveDataDetails).val,
          },
        }];
    const resolved = await Promise.all(rawEntries.map(({ rowIndex, changes }) => buildUpdate(rowIndex, changes)));
    const entries = resolved.filter((entry): entry is TrackerGridUpdateEntry => entry !== null);
    if (entries.length === 0) return;
    setMutationError(null);
    try {
      await onItemsUpdate(entries);
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [buildUpdate, onItemsUpdate]);

  useEffect(() => {
    if (!onItemsUpdate) return undefined;
    let bound: typeof gridRef.current = null;
    const bind = (): boolean => {
      const grid = gridCanvasRef.current?.querySelector('revo-grid') as typeof gridRef.current;
      if (!grid || grid === bound) return Boolean(grid);
      bound?.removeEventListener('afteredit', listener);
      bound = grid;
      gridRef.current = grid;
      grid.addEventListener('afteredit', listener);
      return true;
    };
    const listener = (event: Event) => {
      void handleAfterEdit(event as RevoGridCustomEvent<AfterEditEvent>);
    };
    const observer = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => {
          if (bind()) observer?.disconnect();
        });
    if (!bind() && gridCanvasRef.current) observer?.observe(gridCanvasRef.current, { childList: true, subtree: true });
    return () => {
      observer?.disconnect();
      bound?.removeEventListener('afteredit', listener);
      if (gridRef.current === bound) gridRef.current = null;
    };
  }, [handleAfterEdit, onItemsUpdate]);

  if (!loaded) {
    return (
      <TrackerSurfaceMessage
        icon="table"
        message="Loading tracker items..."
        testId="tracker-grid-loading"
      />
    );
  }

  // With column filters active the grid keeps rendering even at zero rows: the
  // header holds the only affordance for clearing those filters, so swapping it
  // for an empty state would strand the reader with an unfilterable view.
  const columnFiltersActive = hasActiveFilters(columnFilters);
  const filterField = filterTarget
    ? visibleColumnDefs.find((column) => column.id === filterTarget.columnId)
    : undefined;

  return (
    <div
      className="tracker-grid-view relative flex h-full w-full min-h-0 flex-col bg-nim"
      data-testid="tracker-grid-view"
    >
      {mutationError ? (
        <div className="tracker-grid-mutation-error px-3 py-2 text-xs text-nim-error" role="alert">
          {mutationError}
        </div>
      ) : null}
      <div ref={gridCanvasRef} className="tracker-grid-canvas relative min-h-0 flex-1 outline-none">
        {rows.length === 0 && !columnFiltersActive ? (
          <TrackerSurfaceMessage
            icon="table"
            message="No tracker items yet."
            testId="tracker-grid-empty"
          />
        ) : (
          <RevoGrid
            key={`${schemaType}:${sortBy ?? ''}:${sortDirection}`}
            columns={gridColumns}
            source={gridSource}
            sorting={gridSorting}
            theme="compact"
            resize
            range
            readonly={!onItemsUpdate}
          />
        )}

        {rows.length === 0 && columnFiltersActive ? (
          <div
            className="absolute inset-x-0 top-10 flex flex-col items-center gap-2 pt-6 text-sm text-nim-muted"
            data-testid="tracker-grid-filtered-empty"
          >
            <span>No items match these column filters.</span>
            <button
              className="text-xs underline hover:text-nim"
              onClick={() => onColumnFiltersChange?.({ combinator: 'and', clauses: [] })}
            >
              Clear column filters
            </button>
          </div>
        ) : null}
      </div>

      {filterTarget && onColumnFiltersChange ? (
        <TrackerColumnFilterPopover
          anchorRect={filterTarget.rect}
          columnId={filterTarget.columnId}
          columnLabel={filterField?.label ?? filterTarget.columnId}
          field={filterField
            ? getFieldForColumn(schemaType, resolveColumnFieldName(schemaType, filterField))
            : undefined}
          clauses={clausesForField(columnFilters, filterTarget.columnId)}
          combinator={columnFilters?.combinator ?? 'and'}
          onApply={(clauses, combinator) => {
            onColumnFiltersChange({
              ...withFieldClauses(columnFilters, filterTarget.columnId, clauses),
              combinator,
            });
          }}
          onClose={() => setFilterTarget(null)}
        />
      ) : null}
    </div>
  );
}
