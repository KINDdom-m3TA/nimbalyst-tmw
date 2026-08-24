/**
 * Read-and-edit view of one tracker item.
 *
 * Scoped hard. Desktop's `TrackerItemDetail` is 2,100 lines because the item is
 * also where a session gets launched, a worktree gets created, a pull request
 * gets opened, and a chat panel gets docked -- all desktop capabilities. What a
 * teammate needs in a browser tab is the item: its identity, its fields, its
 * body, and its thread.
 *
 * The body is a slot, not an editor. Item bodies already run through
 * `CollabLexicalProvider`, so the host mounts the `editor` bundle entry it
 * already ships (`CollabEditorMount`) and passes it in. A second editor
 * integration here would be a second cold-paint contract to get wrong: the
 * binding only paints Y.Doc events observed *after* it mounts (NIM-1764), and
 * that is a property of the mount, not of this panel.
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TrackerIdentity } from '@nimbalyst/runtime/core/DocumentService';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import type { FieldDefinition } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel';
import type { TrackerMutationRejection } from '@nimbalyst/collab-client/trackers';
import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { getTypeColor } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerColumns';
import {
  TrackerFieldEditor,
  type TeamMemberOption,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/components/TrackerFieldEditor';
import {
  getRecordTitle,
  resolveRoleFieldName,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import { TrackerSwatchBadge } from '../primitives/TrackerSwatchBadge';
import {
  TrackerCommentsSection,
  type TrackerCommentMutation,
} from '../TrackerCommentsSection';

export interface TrackerItemDetailPanelProps {
  item: TrackerRecord;
  identity: TrackerIdentity | null;
  /** Absent for a read-only permission state; the fields render, disabled. */
  onFieldChange?: (fieldName: string, value: unknown) => void | Promise<unknown>;
  commentMutate: (mutation: TrackerCommentMutation) => Promise<unknown>;
  formatTimestamp: (createdAt: number) => string;
  teamMembers?: TeamMemberOption[];
  /** The item body, mounted by the host through the shared editor entry. */
  bodySlot?: React.ReactNode;
  onClose?: () => void;
  mutationRejection?: TrackerMutationRejection | null;
}

/**
 * Fields worth showing beside the body: everything the schema declares except
 * the title, which the header already renders.
 */
function detailFields(trackerType: string): FieldDefinition[] {
  const model = globalRegistry.get(trackerType);
  const titleField = resolveRoleFieldName(trackerType, 'title');
  return (model?.fields ?? []).filter((field) => field.name !== titleField);
}

export function TrackerItemDetailPanel({
  item,
  identity,
  onFieldChange,
  commentMutate,
  formatTimestamp,
  teamMembers,
  bodySlot,
  onClose,
  mutationRejection,
}: TrackerItemDetailPanelProps) {
  const fields = detailFields(item.primaryType);
  const readOnly = !onFieldChange;

  return (
    <div
      className="tracker-item-detail flex h-full min-h-0 flex-col bg-nim"
      data-testid="tracker-item-detail"
      data-item-id={item.id}
    >
      <div className="flex items-start gap-2 border-b border-nim px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <TrackerSwatchBadge label={item.primaryType} color={getTypeColor(item.primaryType)} />
            {item.issueKey ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-nim-faint">
                {item.issueKey}
              </span>
            ) : null}
          </div>
          <h2 className="mt-1 truncate text-base font-semibold text-nim select-text">
            {getRecordTitle(item)}
          </h2>
        </div>
        {onClose ? (
          <button
            type="button"
            className="text-nim-faint hover:text-nim"
            aria-label="Close item"
            onClick={onClose}
          >
            <MaterialSymbol icon="close" size={16} />
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {bodySlot ? <div className="tracker-item-detail-body border-b border-nim">{bodySlot}</div> : null}

        <div className="tracker-item-detail-fields grid gap-3 px-4 py-3">
          {fields.map((field) => (
            <TrackerFieldEditor
              key={field.name}
              field={readOnly ? { ...field, readOnly: true } : field}
              value={item.fields[field.name]}
              onChange={(value) => onFieldChange?.(field.name, value)}
              layout="horizontal"
              teamMembers={teamMembers}
            />
          ))}
        </div>

        <div className="border-t border-nim px-4 py-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-nim-faint">
            Comments
          </div>
          <TrackerCommentsSection
            comments={item.system.comments}
            identity={identity}
            mutate={commentMutate}
            formatTimestamp={formatTimestamp}
            readOnly={readOnly}
            mutationRejection={mutationRejection}
          />
        </div>
      </div>
    </div>
  );
}
