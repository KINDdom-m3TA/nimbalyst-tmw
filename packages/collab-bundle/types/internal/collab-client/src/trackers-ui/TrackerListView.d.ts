/**
 * The compact list: one row per item, grouped by the view's `groupBy`.
 *
 * The default landing view for a tracker, and the one surface that has to work
 * before any of the others matter. Grouping and ordering come from the shared
 * selectors so a list and a board built from the same saved view show the same
 * items in the same order.
 */
import React from 'react';
import type { TrackerRecord } from '../../../runtime/src/core/TrackerRecord';
import type { TrackerGroupBy } from '../../../runtime/src/plugins/TrackerPlugin/models/index';
export interface TrackerListViewProps {
    rows: TrackerRecord[];
    groupBy: TrackerGroupBy;
    selectedItemId?: string | null;
    onOpenItem: (itemId: string) => void;
    loaded: boolean;
    /**
     * Per-row unread dot. Personal lane, so a host with team auth only omits it
     * and the dot's module never enters that host's bundle graph.
     */
    renderUnreadSlot?: (itemId: string) => React.ReactNode;
}
export declare function TrackerListView({ rows, groupBy, selectedItemId, onOpenItem, loaded, renderUnreadSlot, }: TrackerListViewProps): React.JSX.Element;
