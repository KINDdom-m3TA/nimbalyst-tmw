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
import type { TrackerIdentity } from '../../../../runtime/src/core/DocumentService';
import type { TrackerRecord } from '../../../../runtime/src/core/TrackerRecord';
import type { TrackerMutationRejection } from '../../trackers/index';
import { type TeamMemberOption } from '../../../../runtime/src/plugins/TrackerPlugin/components/TrackerFieldEditor';
import { type TrackerCommentMutation } from '../TrackerCommentsSection';
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
export declare function TrackerItemDetailPanel({ item, identity, onFieldChange, commentMutate, formatTimestamp, teamMembers, bodySlot, onClose, mutationRejection, }: TrackerItemDetailPanelProps): React.JSX.Element;
