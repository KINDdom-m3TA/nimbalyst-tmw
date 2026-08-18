// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { getCellValue, getEffectiveUpdatedDate, resolveColumnsForType } from '../trackerColumns';
import { resolveTrackerOrderingValue } from '../../models/trackerOrdering';
import type { TrackerRecord } from '../../../../core/TrackerRecord';

describe('trackerColumns', () => {
  it('gives the structural type column enough width for the grid header and icon', () => {
    const typeColumn = resolveColumnsForType('').find(column => column.id === 'type');

    expect(typeColumn).toBeDefined();
    expect(typeColumn?.width).toBe(64);
    expect(typeColumn?.minWidth).toBe(64);
  });

  it('exposes creator identity as a read-only structural user column', () => {
    const createdByColumn = resolveColumnsForType('').find(column => column.id === 'createdBy');
    const authorIdentity = {
      email: 'alice@example.com',
      displayName: 'Alice Example',
      gitName: null,
      gitEmail: null,
    };
    const record: TrackerRecord = {
      id: 'bug-creator',
      primaryType: 'bug',
      typeTags: ['bug'],
      source: 'native',
      archived: false,
      syncStatus: 'synced',
      fields: {},
      system: {
        workspace: '/repo',
        createdAt: '2026-07-24T00:00:00.000Z',
        updatedAt: '2026-07-24T00:00:00.000Z',
        authorIdentity,
      },
    };

    expect(createdByColumn).toMatchObject({
      label: 'Created by',
      render: 'avatar',
      editable: false,
    });
    expect(getCellValue(record, 'createdBy')).toEqual(authorIdentity);
  });

  it('exposes viewed and updater identity as read-only structural columns', () => {
    const columns = resolveColumnsForType('');
    const viewedColumn = columns.find(column => column.id === 'viewed');
    const updatedByColumn = columns.find(column => column.id === 'updatedBy');
    const lastModifiedBy = {
      email: 'bob@example.com',
      displayName: 'Bob Example',
      gitName: null,
      gitEmail: null,
    };
    const record: TrackerRecord = {
      id: 'bug-viewed',
      primaryType: 'bug',
      typeTags: ['bug'],
      source: 'native',
      archived: false,
      syncStatus: 'synced',
      fields: { viewed: new Date('2026-07-24T10:00:00.000Z') },
      system: {
        workspace: '/repo',
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-24T00:00:00.000Z',
        lastModifiedBy,
      },
    };

    expect(viewedColumn).toMatchObject({ label: 'Viewed', render: 'date', editable: false });
    expect(updatedByColumn).toMatchObject({ label: 'Updated by', render: 'avatar', editable: false });
    expect(getCellValue(record, 'viewed')).toEqual(record.fields.viewed);
    expect(getCellValue(record, 'updatedBy')).toEqual(lastModifiedBy);
    expect(getCellValue(record, 'created')).toBe('2026-07-23T00:00:00.000Z');
  });

  it('uses file mtime for frontmatter rows with day-precision updated timestamps', () => {
    const record: TrackerRecord = {
      id: 'plan-branching',
      primaryType: 'plan',
      typeTags: ['plan'],
      source: 'frontmatter',
      archived: false,
      syncStatus: 'local',
      fields: {},
      system: {
        workspace: '/repo',
        documentPath: 'nimbalyst-local/plans/branching.md',
        lineNumber: 0,
        createdAt: '2026-07-08',
        updatedAt: '2026-07-08T00:00:00.000Z',
        lastIndexed: '2026-07-08T16:36:30.000Z',
      },
    };

    expect(getEffectiveUpdatedDate(record)?.toISOString()).toBe('2026-07-08T16:36:30.000Z');
  });

  /**
   * The Key column showed nothing for an unshared item even after the local
   * numbering sweep had given every row a number, because it read `issueKey`
   * alone. The detail pane got the fallback and the columns did not.
   */
  describe('the key column', () => {
    function keyRecord(keys: { issueKey?: string; localKey?: string }): TrackerRecord {
      return {
        id: 'bug-key',
        primaryType: 'bug',
        typeTags: ['bug'],
        source: 'native',
        archived: false,
        syncStatus: 'local',
        fields: {},
        system: { workspace: '/repo', createdAt: '2026-08-01', updatedAt: '2026-08-01' },
        ...keys,
      };
    }

    it('prefers the team key, which is the only one that means the same thing to everyone', () => {
      expect(getCellValue(keyRecord({ issueKey: 'NIM-2999', localKey: 'NIC.42' }), 'key')).toBe('NIM-2999');
    });

    it('falls back to this machine local number', () => {
      expect(getCellValue(keyRecord({ localKey: 'NIC.42' }), 'key')).toBe('NIC.42');
    });

    /**
     * `LC-###` is a leftover from the rolled-back provisional scheme. Those
     * values were reissued as items were acked, so one of them displayed
     * where a stable number exists points at nothing in particular.
     */
    it('ignores a leftover provisional key in favour of the local number', () => {
      expect(getCellValue(keyRecord({ issueKey: 'LC-1', localKey: 'NIC.42' }), 'key')).toBe('NIC.42');
    });

    it('shows nothing when the item has neither', () => {
      expect(getCellValue(keyRecord({}), 'key')).toBe('');
    });

    it('sorts on whichever key it displays', () => {
      expect(resolveTrackerOrderingValue(keyRecord({ localKey: 'NIC.42' }), 'key')).toBe('NIC.42');
      expect(resolveTrackerOrderingValue(keyRecord({ issueKey: 'LC-1', localKey: 'NIC.42' }), 'key')).toBe('NIC.42');
    });
  });
});
