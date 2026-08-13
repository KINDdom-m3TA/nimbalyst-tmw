// @vitest-environment node

import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';

import {
  feedbackRequestActiveViewerAtomFamily,
  feedbackRequestAtomKey,
  feedbackRequestStateAtomFamily,
  feedbackRequestStateForTargetAtomFamily,
  feedbackRequestTargetKey,
} from '../feedbackRequests';

const TARGET = {
  workspacePath: '/work/acme',
  orgId: 'org-1',
  requestId: 'request-1',
};

describe('feedback request viewer projections', () => {
  it('switches viewers without exposing the previous viewer projection', () => {
    const store = createStore();
    const targetKey = feedbackRequestTargetKey(TARGET);
    const firstKey = feedbackRequestAtomKey({ ...TARGET, viewerUserId: 'member-a' });
    const secondKey = feedbackRequestAtomKey({ ...TARGET, viewerUserId: 'member-b' });

    store.set(feedbackRequestStateAtomFamily(firstKey), {
      ...TARGET,
      viewerUserId: 'member-a',
      status: 'cached',
      request: { responses: [{ id: 'visible-only-to-a' }] } as never,
    });
    store.set(feedbackRequestActiveViewerAtomFamily(targetKey), 'member-a');
    expect(
      store.get(feedbackRequestStateForTargetAtomFamily(targetKey)).request?.responses,
    ).toEqual([{ id: 'visible-only-to-a' }]);

    store.set(feedbackRequestActiveViewerAtomFamily(targetKey), 'member-b');
    expect(store.get(feedbackRequestStateForTargetAtomFamily(targetKey))).toMatchObject({
      viewerUserId: 'member-b',
      status: 'idle',
    });
    expect(store.get(feedbackRequestStateForTargetAtomFamily(targetKey)).request)
      .toBeUndefined();

    store.set(feedbackRequestStateAtomFamily(secondKey), {
      ...TARGET,
      viewerUserId: 'member-b',
      status: 'cached',
      request: { responses: [] } as never,
    });
    expect(
      store.get(feedbackRequestStateForTargetAtomFamily(targetKey)).request?.responses,
    ).toEqual([]);
  });
});
