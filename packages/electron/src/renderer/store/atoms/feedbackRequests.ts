import { atom } from 'jotai';

import type {
  FeedbackRequestServiceState,
  FeedbackRequestServiceTarget,
} from '../../../shared/feedbackRequest';
import { atomFamily } from '../debug/atomFamilyRegistry';

export function feedbackRequestAtomKey(
  target: FeedbackRequestServiceTarget & { viewerUserId: string },
): string {
  return JSON.stringify([
    target.workspacePath,
    target.orgId,
    target.viewerUserId,
    target.requestId,
  ]);
}

export function feedbackRequestTargetKey(
  target: FeedbackRequestServiceTarget,
): string {
  return JSON.stringify([
    target.workspacePath,
    target.orgId,
    target.requestId,
  ]);
}

function targetFromViewerKey(
  key: string,
): FeedbackRequestServiceTarget & { viewerUserId: string } {
  const [workspacePath, orgId, viewerUserId, requestId] = JSON.parse(key) as string[];
  return { workspacePath, orgId, viewerUserId, requestId };
}

function targetFromTargetKey(key: string): FeedbackRequestServiceTarget {
  const [workspacePath, orgId, requestId] = JSON.parse(key) as string[];
  return { workspacePath, orgId, requestId };
}

/** Written only by the renderer-wide feedback request IPC listener. */
export const feedbackRequestStateAtomFamily = atomFamily((key: string) =>
  atom<FeedbackRequestServiceState>({
    ...targetFromViewerKey(key),
    status: 'idle',
  }));

/** Current org-scoped viewer for a target, switched before projected state is exposed. */
export const feedbackRequestActiveViewerAtomFamily = atomFamily((targetKey: string) =>
  atom(''));

/**
 * The active viewer's projection for a request. The indirection lets surfaces
 * address a request before main has returned the team member id without ever
 * placing two viewers' projected responses in the same atom.
 */
export const feedbackRequestStateForTargetAtomFamily = atomFamily((targetKey: string) =>
  atom((get) => {
    const viewerUserId = get(feedbackRequestActiveViewerAtomFamily(targetKey));
    if (!viewerUserId) {
      return {
        ...targetFromTargetKey(targetKey),
        viewerUserId: '',
        status: 'idle' as const,
      };
    }
    return get(feedbackRequestStateAtomFamily(feedbackRequestAtomKey({
      ...targetFromTargetKey(targetKey),
      viewerUserId,
    })));
  }));

export const feedbackRequestAtomFamily = atomFamily((key: string) =>
  atom((get) => get(feedbackRequestStateForTargetAtomFamily(key)).request));

export const feedbackRequestProgressAtomFamily = atomFamily((key: string) =>
  atom((get) => get(feedbackRequestStateForTargetAtomFamily(key)).progress));

/**
 * Responses exactly as projected for this viewer by the server. This selector
 * deliberately performs no visibility or attribution filtering in the client.
 */
export const feedbackRequestResponsesForViewerAtomFamily = atomFamily(
  (key: string) => atom(
    (get) => get(feedbackRequestStateForTargetAtomFamily(key)).request?.responses ?? [],
  ),
);
