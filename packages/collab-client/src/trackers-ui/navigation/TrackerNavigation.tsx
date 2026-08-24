/**
 * Tracker navigation: saved views first, then the schema's tracker tree.
 *
 * This is not desktop's sidebar with sections deleted. `TrackerSidebar` is
 * already organized this way -- views on top, types under them -- because both
 * axes are server-owned lanes (`savedView` and `navigation` in
 * `TrackerSyncEngine`). Recents and favorites never structured that list; they
 * were filter chips inside a view.
 *
 * The tree renders **flat**: `partitionTrackerNavigationByOwnership` splits it
 * into "The team's" and "Mine", and in a browser tab the personal half is
 * structurally empty. A permanently empty "Mine" header does not read as "you
 * have no personal trackers here" -- it reads as a sync that failed. So this
 * takes the same flat path a solo user already gets, which is the path with no
 * ownership grammar in it at all.
 *
 * Personal tracker types are absent for the same reason, one level down: their
 * items live in the author's own workspace and no room carries them, so a host
 * with no personal lane would list a tracker that is permanently empty. An
 * empty tracker does not read as "this one was never the team's" -- it reads as
 * a sync that failed. `BrowserTrackerSchemaStore` already declines to project
 * them; the filter here is what makes that a property of the surface rather
 * than of whoever fed it.
 *
 * Reordering, folder creation, rename, and delete are deliberately absent.
 * Organizing the tree is a desktop action; this surface navigates it.
 */

import React, { useMemo } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TrackerDataModel } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import type { TrackerNavigationEntry } from '@nimbalyst/runtime/sync/trackerNavigation';
import {
  buildTrackerNavigationTree,
  isPersonalTrackerModel,
  type SavedView,
  type TrackerNavigationTree,
} from '@nimbalyst/collab-client/trackers';
import { TrackerSavedViewsSection } from '../TrackerSavedViewsSection';
import { useTrackerUICapabilities } from '../TrackersUIProvider';

export interface TrackerNavigationProps {
  trackerTypes: TrackerDataModel[];
  navigationEntries: TrackerNavigationEntry[];
  savedViews: SavedView[];
  activeSavedViewId: string | null;
  /** `'all'` or a tracker type. */
  selectedType: string;
  /** Item count per tracker type, for the trailing number. */
  countsByType?: ReadonlyMap<string, number>;
  expandedFolderIds: readonly string[];
  onToggleFolder: (folderId: string) => void;
  onSelectType: (type: string) => void;
  onApplyView: (view: SavedView) => void;
  /** Omit where a view cannot be deleted or reshared; the control is then absent. */
  onDeleteView?: (view: SavedView) => void;
  onToggleShareView?: (view: SavedView) => void;
}

function TypeRow({
  tracker,
  selected,
  count,
  nested,
  onSelect,
}: {
  tracker: TrackerDataModel;
  selected: boolean;
  count?: number;
  nested: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      data-testid="tracker-nav-type"
      data-tracker-type={tracker.type}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
        nested ? 'pl-7' : ''
      } ${selected ? 'bg-nim-active text-nim' : 'text-nim-muted hover:bg-nim-tertiary hover:text-nim'}`}
      onClick={onSelect}
    >
      <MaterialSymbol icon={tracker.icon || 'checklist'} size={16} />
      <span className="flex-1 text-left truncate">{tracker.displayNamePlural || tracker.displayName}</span>
      {count === undefined ? null : (
        <span className="text-[10px] font-semibold text-nim-faint min-w-[20px] text-right">{count}</span>
      )}
    </button>
  );
}

export function TrackerNavigation({
  trackerTypes,
  navigationEntries,
  savedViews,
  activeSavedViewId,
  selectedType,
  countsByType,
  expandedFolderIds,
  onToggleFolder,
  onSelectType,
  onApplyView,
  onDeleteView,
  onToggleShareView,
}: TrackerNavigationProps) {
  const { personalState } = useTrackerUICapabilities();
  const navigableTypes = useMemo(
    () => (personalState ? trackerTypes : trackerTypes.filter((model) => !isPersonalTrackerModel(model))),
    [personalState, trackerTypes],
  );
  const tree: TrackerNavigationTree = useMemo(
    () => buildTrackerNavigationTree(navigableTypes, navigationEntries),
    [navigableTypes, navigationEntries],
  );
  const expanded = useMemo(() => new Set(expandedFolderIds), [expandedFolderIds]);

  return (
    <div className="tracker-navigation flex flex-col h-full min-h-0" data-testid="tracker-navigation">
      <div className="px-3 py-1.5 border-b border-nim text-[11px] font-semibold text-nim-muted uppercase tracking-wider">
        Trackers
      </div>

      <div className="flex-1 overflow-y-auto">
        <TrackerSavedViewsSection
          savedViews={savedViews}
          activeSavedViewId={activeSavedViewId}
          isSharedLayout
          onApplyView={onApplyView}
          onDeleteView={onDeleteView}
          onToggleShareView={onToggleShareView}
        />

        <div className="px-1.5 py-2 border-t border-nim mt-1">
          <div className="px-2 mb-1 text-[10px] font-semibold text-nim-faint uppercase tracking-wider">
            Types
          </div>

          <button
            data-testid="tracker-nav-type"
            data-tracker-type="all"
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
              selectedType === 'all'
                ? 'bg-nim-active text-nim'
                : 'text-nim-muted hover:bg-nim-tertiary hover:text-nim'
            }`}
            onClick={() => onSelectType('all')}
          >
            <MaterialSymbol icon="checklist" size={16} />
            <span className="flex-1 text-left truncate">All</span>
          </button>

          {tree.folders.map(({ folder, trackerTypes: folderTypes }) => {
            const open = expanded.has(folder.folderId);
            return (
              <React.Fragment key={folder.entryId}>
                <button
                  data-testid="tracker-nav-folder"
                  data-folder-id={folder.folderId}
                  className="w-full flex items-center gap-1 px-1 py-1 rounded-md text-sm text-nim-muted hover:bg-nim-tertiary hover:text-nim"
                  onClick={() => onToggleFolder(folder.folderId)}
                >
                  <MaterialSymbol icon={open ? 'expand_more' : 'chevron_right'} size={15} />
                  <MaterialSymbol icon={open ? 'folder_open' : 'folder'} size={16} />
                  <span className="min-w-0 flex-1 text-left truncate">{folder.name}</span>
                </button>
                {open
                  ? folderTypes.map(({ tracker }) => (
                    <TypeRow
                      key={tracker.type}
                      tracker={tracker}
                      nested
                      selected={selectedType === tracker.type}
                      count={countsByType?.get(tracker.type)}
                      onSelect={() => onSelectType(tracker.type)}
                    />
                  ))
                  : null}
              </React.Fragment>
            );
          })}

          {tree.rootTypes.map(({ tracker }) => (
            <TypeRow
              key={tracker.type}
              tracker={tracker}
              nested={false}
              selected={selectedType === tracker.type}
              count={countsByType?.get(tracker.type)}
              onSelect={() => onSelectType(tracker.type)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
