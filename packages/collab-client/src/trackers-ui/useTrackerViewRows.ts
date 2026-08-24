/**
 * Rows for a saved view, on a host that may not have a personal lane.
 *
 * One place decides what a view means so the list, the grid, and the board can
 * never disagree about it -- and one place decides what happens when part of the
 * view is unanswerable here. `filterTrackerItems` would happily evaluate a
 * `favorite` clause against an empty favorites set and return nothing; that is
 * the failure this hook exists to prevent (see `personalViewClauses`).
 */

import { useMemo } from 'react';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import type { Readiness } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerReadiness';
import type { TrackerIdentity } from '@nimbalyst/runtime/core/DocumentService';
import {
  filterTrackerItems,
  findPersonalViewClauses,
  sortBoardColumnItems,
  withoutPersonalViewClauses,
  type PersonalViewClause,
  type SavedViewDefinition,
} from '@nimbalyst/collab-client/trackers';
import { useTrackerUICapabilities } from './TrackersUIProvider';

export interface TrackerViewRowsOptions {
  identity: TrackerIdentity | null;
  /** Dependency readiness, derived once from the whole corpus by the host. */
  readinessByItemId?: ReadonlyMap<string, Readiness>;
  /** Personal favorites; only ever populated where a personal lane exists. */
  favoriteItemIds?: ReadonlySet<string>;
  viewedAtByItemId?: ReadonlyMap<string, number>;
  nowMs?: number;
}

export interface TrackerViewRows {
  rows: TrackerRecord[];
  /** Non-empty when the view asked something this host cannot answer. */
  personalClauses: PersonalViewClause[];
}

export function useTrackerViewRows(
  records: TrackerRecord[],
  definition: SavedViewDefinition,
  options: TrackerViewRowsOptions,
): TrackerViewRows {
  const { personalState } = useTrackerUICapabilities();
  const { identity, readinessByItemId, favoriteItemIds, viewedAtByItemId, nowMs } = options;

  const personalClauses = useMemo(
    () => (personalState ? [] : findPersonalViewClauses(definition)),
    [personalState, definition],
  );

  const effective = useMemo(
    () => (personalState ? definition : withoutPersonalViewClauses(definition)),
    [personalState, definition],
  );

  const rows = useMemo(() => sortBoardColumnItems(
    filterTrackerItems(
      effective.selectedType === 'all'
        ? records
        : records.filter((record) => record.typeTags.includes(effective.selectedType)),
      effective,
      { identity, readinessByItemId, favoriteItemIds, viewedAtByItemId, nowMs },
    ),
    effective.ordering,
  ), [records, effective, identity, readinessByItemId, favoriteItemIds, viewedAtByItemId, nowMs]);

  return { rows, personalClauses };
}
