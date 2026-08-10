// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { TrackerDataModel } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import {
  buildTrackerNavigationTree,
  partitionTrackerNavigationByOwnership,
} from '../trackerNavigationTree';

const model = (type: string): TrackerDataModel => ({
  type,
  displayName: type,
  displayNamePlural: `${type}s`,
  icon: 'check',
  color: '#000',
  modes: { inline: true, fullDocument: false },
  idPrefix: type.toUpperCase(),
  idFormat: 'uuid',
  fields: [],
});

describe('buildTrackerNavigationTree', () => {
  it('files built-in and custom types, preserves manual order, and leaves each type exactly once', () => {
    const tree = buildTrackerNavigationTree([model('bug'), model('custom'), model('task')], [
      { entryId: 'folder:delivery', kind: 'folder', folderId: 'delivery', name: 'Delivery', sortKey: 'a0' },
      { entryId: 'type:task', kind: 'type-placement', trackerType: 'task', folderId: 'delivery', sortKey: 'a1' },
      { entryId: 'type:custom', kind: 'type-placement', trackerType: 'custom', folderId: 'delivery', sortKey: 'a0' },
      { entryId: 'type:bug', kind: 'type-placement', trackerType: 'bug', folderId: null, sortKey: 'a0' },
    ]);
    expect(tree.folders[0].trackerTypes.map((row) => row.tracker.type)).toEqual(['custom', 'task']);
    expect(tree.rootTypes.map((row) => row.tracker.type)).toEqual(['bug']);
  });

  it('projects missing folder references and missing placements safely at root', () => {
    const tree = buildTrackerNavigationTree([model('bug'), model('task')], [
      { entryId: 'type:task', kind: 'type-placement', trackerType: 'task', folderId: 'gone', sortKey: 'a0' },
    ]);
    expect(tree.folders).toEqual([]);
    expect(new Set(tree.rootTypes.map((row) => row.tracker.type))).toEqual(new Set(['bug', 'task']));
  });
});

describe('partitionTrackerNavigationByOwnership', () => {
  const teamModel = (type: string): TrackerDataModel => ({ ...model(type), sharing: 'team' });

  const treeOf = (models: TrackerDataModel[], folder = false) => buildTrackerNavigationTree(
    models,
    folder
      ? [
        { entryId: 'folder:d', kind: 'folder', folderId: 'd', name: 'Delivery', sortKey: 'a0' },
        ...models.map((m, i) => ({
          entryId: `type:${m.type}` as `type:${string}`,
          kind: 'type-placement' as const,
          trackerType: m.type,
          folderId: 'd',
          sortKey: `a${i}`,
        })),
      ]
      : [],
  );

  it('gives a solo user no sections at all', () => {
    expect(partitionTrackerNavigationByOwnership(
      treeOf([model('plan'), teamModel('bug')]),
      { hasTeam: false },
    )).toBeNull();
  });

  it('splits trackers by ownership, treating an absent sharing bit as personal', () => {
    const sections = partitionTrackerNavigationByOwnership(
      treeOf([model('plan'), teamModel('bug'), model('reading')]),
      { hasTeam: true },
    );
    expect(sections?.map((s) => [s.ownership, s.tree.rootTypes.map((r) => r.tracker.type)])).toEqual([
      ['personal', ['plan', 'reading']],
      ['team', ['bug']],
    ]);
  });

  it('keeps folders in both sections carrying only that section\'s trackers', () => {
    const sections = partitionTrackerNavigationByOwnership(
      treeOf([model('plan'), teamModel('bug')], true),
      { hasTeam: true },
    );
    expect(sections?.map((s) => [
      s.ownership,
      s.tree.folders.map((f) => f.trackerTypes.map((r) => r.tracker.type)),
    ])).toEqual([
      ['personal', [['plan']]],
      ['team', [['bug']]],
    ]);
  });

  it('drops a section with nothing in it rather than showing an empty header', () => {
    const sections = partitionTrackerNavigationByOwnership(
      treeOf([teamModel('bug'), teamModel('feature')], true),
      { hasTeam: true },
    );
    expect(sections?.map((s) => s.ownership)).toEqual(['team']);
    expect(sections?.[0].tree.folders).toHaveLength(1);
  });
});
