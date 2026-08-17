// @vitest-environment jsdom
/**
 * The two things about the respond surface a reader cannot check by looking:
 *
 * - a recipient sees, and can send, only the asks assigned to *them*
 * - the "Add a comment" link survives submitting
 *
 * The second is decision 12's whole substance. If it ever regresses to
 * disappearing once answers are in, discussion turns back into an escape hatch
 * you take instead of answering, which is exactly the shape the decision
 * rejected -- and nothing on screen would look wrong.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FeedbackRequestReadModel } from '@nimbalyst/collab-protocol';

import { FeedbackRequestRespond, type FeedbackRespondHost } from '../FeedbackRequestRespond';

const TARGET = {
  workspacePath: '/work/acme',
  orgId: 'org-1',
  requestId: 'req-1',
};

const VIEWER = 'u-karl';
const OTHER = 'u-dana';

function makeRequest(
  overrides: Partial<FeedbackRequestReadModel> = {},
): FeedbackRequestReadModel {
  return {
    id: 'req-1',
    urn: 'nimbalyst://feedback-request/req-1',
    orgId: 'org-1',
    author: { kind: 'user', userId: 'u-greg', onBehalfOfUserId: 'u-greg' },
    subjects: [],
    asks: [
      {
        type: 'singleSelect',
        id: 'ask-direction',
        label: 'Direction',
        description: 'Which of these should we build?',
        options: [
          { id: 'a', label: 'A · Split panel' },
          { id: 'b', label: 'B · Radial' },
        ],
      },
      {
        type: 'reorder',
        id: 'ask-priority',
        label: 'Priority',
        description: 'Rank these by what we ship first.',
        items: [
          { id: 'keyboard', title: 'Keyboard navigation' },
          { id: 'inline', title: 'Inline editing' },
        ],
      },
      {
        type: 'singleSelect',
        id: 'ask-requirements',
        label: 'Requirements',
        description: 'Does the spec cover the offline case?',
        options: [
          { id: 'yes', label: 'Covered already' },
          { id: 'no', label: 'Needs a section' },
        ],
      },
    ],
    recipients: [
      { userId: VIEWER, name: 'Karl Reyes' },
      { userId: OTHER, name: 'Dana Okafor' },
    ],
    // ask-requirements belongs to Dana alone.
    assignments: [
      { askId: 'ask-direction', target: { kind: 'user', userId: VIEWER } },
      { askId: 'ask-priority', target: { kind: 'user', userId: VIEWER } },
      { askId: 'ask-requirements', target: { kind: 'user', userId: OTHER } },
    ],
    responses: [],
    discussion: [],
    lifecycle: { status: 'open', changedAt: 1 },
    visibility: 'hiddenUntilAnswered',
    wakePolicy: 'quorumOrClose',
    quorum: { requiredRecipientCount: 2 },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function renderRespond(options: {
  host?: FeedbackRespondHost;
  request?: FeedbackRequestReadModel;
  viewerUserId?: string;
  discussion?: React.ReactNode;
} = {}) {
  const viewerUserId = options.viewerUserId ?? VIEWER;
  render(
    <FeedbackRequestRespond
      state={{
        ...TARGET,
        viewerUserId,
        status: 'connected',
        request: options.request ?? makeRequest(),
      }}
      host={options.host}
      discussion={options.discussion}
      now={1_000}
    />,
  );
}

/** Answers both of Karl's asks; the reorder arrives pre-ordered. */
function answerAssignedAsks() {
  const cards = screen.getAllByTestId('feedback-respond-option-card');
  fireEvent.click(cards[0].querySelector('[data-testid="feedback-respond-option-choose"]')!);
}

afterEach(() => cleanup());

describe('FeedbackRequestRespond', () => {
  it('renders and submits only the asks assigned to the viewer', async () => {
    const submitAnswers = vi.fn().mockResolvedValue({ success: true });
    renderRespond({ host: { submitAnswers } });

    answerAssignedAsks();
    fireEvent.click(screen.getByTestId('feedback-respond-submit'));

    await waitFor(() => expect(submitAnswers).toHaveBeenCalledTimes(1));
    expect(submitAnswers.mock.calls[0][0]).toEqual([
      { askId: 'ask-direction', answer: { type: 'singleSelect', selectedId: 'a' } },
      {
        askId: 'ask-priority',
        answer: { type: 'reorder', orderedIds: ['keyboard', 'inline'], removedIds: [] },
      },
    ]);
  });

  it('offers no submit to a viewer with nothing assigned to them', () => {
    const submitAnswers = vi.fn();
    renderRespond({ host: { submitAnswers }, viewerUserId: 'u-outsider' });

    expect(screen.queryByTestId('feedback-respond-submit')).toBeNull();
  });

  it('keeps the comment link available after submitting', async () => {
    const submitAnswers = vi.fn().mockResolvedValue({ success: true });
    renderRespond({
      host: { submitAnswers },
      discussion: <div data-testid="host-discussion">Host discussion</div>,
    });

    answerAssignedAsks();
    fireEvent.click(screen.getByTestId('feedback-respond-submit'));
    await waitFor(() => expect(submitAnswers).toHaveBeenCalled());

    // The asks stay on screen and the link is still there, so discussion reads
    // as an addition rather than a way out of answering.
    const link = screen.getByTestId('feedback-respond-add-comment');
    fireEvent.click(link);
    expect(screen.getByTestId('host-discussion')).toBeDefined();
  });

  it('explains when the host has no discussion surface', () => {
    renderRespond();

    fireEvent.click(screen.getByTestId('feedback-respond-add-comment'));

    expect(screen.getByTestId('feedback-respond-discussion-unavailable').textContent)
      .toBe('Commenting on this request is not available here yet.');
  });
});
