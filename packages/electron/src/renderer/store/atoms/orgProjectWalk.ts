/**
 * State for the post-sign-in project walk.
 *
 * `org` is the organization the account belongs to that has no folder on this
 * machine yet. It is what the persistent "Join {Org} project" entry point reads,
 * and it survives a dismissal — dismissing only clears `autoPresent`.
 *
 * Written by `orgProjectWalkListeners`; components only read.
 */

import { atom } from 'jotai';

import type { ProjectWalkPresentation } from '../../../shared/orgProjectWalk';

export const orgProjectWalkAtom = atom<ProjectWalkPresentation>({
  org: null,
  autoPresent: false,
});

/** Bumped to ask the listener to re-resolve (e.g. after the walk finishes). */
export const orgProjectWalkRefreshAtom = atom(0);

/**
 * Latest progress for a running clone, keyed by the clone the walk started.
 * Written by `orgProjectWalkListeners`; the dialog filters on its own id, so a
 * clone left running in the background can't drive another dialog's bar.
 */
export const orgProjectCloneProgressAtom = atom<{
  cloneId: string;
  phase: string;
  percent: number | null;
} | null>(null);
