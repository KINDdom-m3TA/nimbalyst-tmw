import type { Store } from 'jotai/vanilla/store';

import type { FeedbackRequestServiceState } from '../../../shared/feedbackRequest';
import { store } from '..';
import {
  feedbackRequestActiveViewerAtomFamily,
  feedbackRequestAtomKey,
  feedbackRequestStateAtomFamily,
  feedbackRequestTargetKey,
} from '../atoms/feedbackRequests';

const FEEDBACK_REQUEST_RENDER_DEBOUNCE_MS = 40;

function isFeedbackRequestState(
  value: unknown,
): value is FeedbackRequestServiceState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FeedbackRequestServiceState>;
  return (
    typeof candidate.workspacePath === 'string'
    && typeof candidate.orgId === 'string'
    && typeof candidate.requestId === 'string'
    && typeof candidate.viewerUserId === 'string'
    && typeof candidate.status === 'string'
  );
}

/** Installs the only renderer subscription for feedback request sync state. */
export function initFeedbackRequestListeners(
  targetStore: Store = store,
): () => void {
  const pending = new Map<string, FeedbackRequestServiceState>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const unsubscribe = window.electronAPI.on(
    'feedback-request:state-changed',
    (value: unknown) => {
      if (!isFeedbackRequestState(value)) return;
      const key = feedbackRequestAtomKey(value);
      const targetKey = feedbackRequestTargetKey(value);
      // Switch identity before the debounced projection write. A newly active
      // viewer may see their own older cache briefly, but can never see the
      // previous viewer's response projection under the shared target key.
      targetStore.set(
        feedbackRequestActiveViewerAtomFamily(targetKey),
        value.viewerUserId,
      );
      pending.set(key, value);
      const current = timers.get(key);
      if (current) clearTimeout(current);
      timers.set(key, setTimeout(() => {
        timers.delete(key);
        const next = pending.get(key);
        pending.delete(key);
        if (next) targetStore.set(feedbackRequestStateAtomFamily(key), next);
      }, FEEDBACK_REQUEST_RENDER_DEBOUNCE_MS));
    },
  );

  return () => {
    unsubscribe();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    pending.clear();
  };
}
