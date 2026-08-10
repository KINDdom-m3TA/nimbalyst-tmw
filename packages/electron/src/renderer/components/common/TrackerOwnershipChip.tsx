/**
 * The one visual grammar for "whose is this".
 *
 * A user learns it once — lock + "Personal" means this machine only, people +
 * the team's name means everyone on that team sees the same fields, items and
 * numbers — and then reads it everywhere ownership appears: the tracker
 * sidebar's section headers, the tracker settings rows, and (later) documents.
 * Everything here is presentational so a second surface can adopt it without
 * inheriting tracker plumbing.
 *
 * Do not invent a second treatment for the same idea in another component.
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TrackerOwnership } from '../TrackerMode/trackerNavigationTree';

/** Minimal member shape, kept local so this file pulls in no editor graph. */
export interface OwnershipMember {
  email: string;
  name?: string;
}

export function trackerOwnershipIcon(ownership: TrackerOwnership): string {
  return ownership === 'team' ? 'group' : 'lock';
}

/**
 * The words for an ownership. A team is named, because the name is the point:
 * "Bugs is Stravu's" answers the question that a generic "Shared" does not.
 */
export function trackerOwnershipLabel(
  ownership: TrackerOwnership,
  teamName?: string | null,
): string {
  if (ownership === 'personal') return 'Personal';
  return teamName?.trim() || 'Team';
}

/** One-line explanation of what the ownership means for the user's edits. */
export function trackerOwnershipDescription(
  ownership: TrackerOwnership,
  memberCount?: number,
): string {
  if (ownership === 'personal') return 'On this machine. Never synced.';
  const everyone = 'Everyone sees the same fields, items, and numbers.';
  return memberCount && memberCount > 1
    ? `Shared with ${memberCount} people. ${everyone}`
    : everyone;
}

export const TrackerOwnershipChip: React.FC<{
  ownership: TrackerOwnership;
  teamName?: string | null;
  /** Team trackers can start new items as private drafts. */
  draftByDefault?: boolean;
  className?: string;
}> = ({ ownership, teamName, draftByDefault = false, className = '' }) => {
  const isTeam = ownership === 'team';
  const label = trackerOwnershipLabel(ownership, teamName);
  return (
    <span
      className={`tracker-ownership-chip inline-flex items-center gap-1 px-[7px] py-[2px] rounded-[10px] text-[10px] font-semibold ${
        isTeam
          ? 'bg-[color-mix(in_srgb,var(--nim-primary)_15%,transparent)] text-[var(--nim-primary)]'
          : 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-faint)]'
      } ${className}`}
      data-ownership={ownership}
      title={
        isTeam
          ? `${label} owns this tracker — changing its fields changes them for everyone`
          : 'Only on this machine'
      }
    >
      <MaterialSymbol icon={trackerOwnershipIcon(ownership)} size={11} />
      {isTeam && draftByDefault ? `${label} · drafts` : label}
    </span>
  );
};

/**
 * Overlapping initials for the people a team tracker is shared with. Silent
 * when the roster is unknown — an empty ring would read as "shared with nobody".
 */
export const TrackerOwnershipAvatars: React.FC<{
  members: OwnershipMember[];
  max?: number;
}> = ({ members, max = 3 }) => {
  if (members.length === 0) return null;
  const shown = members.slice(0, max);
  const overflow = members.length - shown.length;
  return (
    <span className="tracker-ownership-avatars flex items-center -space-x-1" aria-hidden="true">
      {shown.map((member) => (
        <span
          key={member.email}
          className="flex size-[17px] shrink-0 items-center justify-center rounded-full border border-[var(--nim-bg-secondary)] bg-[color-mix(in_srgb,var(--nim-primary)_62%,var(--nim-bg))] text-[8px] font-semibold text-[var(--nim-on-primary)]"
          title={member.name || member.email}
        >
          {ownershipInitials(member)}
        </span>
      ))}
      {overflow > 0 && (
        <span className="flex size-[17px] shrink-0 items-center justify-center rounded-full border border-[var(--nim-bg-secondary)] bg-[var(--nim-bg-tertiary)] text-[8px] font-semibold text-[var(--nim-text-muted)]">
          +{overflow}
        </span>
      )}
    </span>
  );
};

function ownershipInitials(member: OwnershipMember): string {
  const source = member.name?.trim() || member.email;
  return source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

/**
 * Section header for an ownership group. Same shape wherever a surface splits
 * its navigation into mine/the team's, so the split reads as one idea.
 */
export const TrackerOwnershipSectionHeader: React.FC<{
  ownership: TrackerOwnership;
  teamName?: string | null;
  members?: OwnershipMember[];
}> = ({ ownership, teamName, members = [] }) => {
  const isTeam = ownership === 'team';
  return (
    <div className="tracker-ownership-section-header px-2 pt-1" data-ownership={ownership}>
      <div
        className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${
          isTeam ? 'text-[var(--nim-primary)]' : 'text-[var(--nim-text-faint)]'
        }`}
      >
        <MaterialSymbol icon={trackerOwnershipIcon(ownership)} size={13} />
        <span className="min-w-0 flex-1 truncate">
          {isTeam ? trackerOwnershipLabel(ownership, teamName) : 'My trackers'}
        </span>
        {isTeam && <TrackerOwnershipAvatars members={members} />}
      </div>
      <div className="mt-0.5 pl-[19px] text-[10px] leading-snug text-[var(--nim-text-faint)]">
        {trackerOwnershipDescription(ownership, isTeam ? members.length : undefined)}
      </div>
    </div>
  );
};
