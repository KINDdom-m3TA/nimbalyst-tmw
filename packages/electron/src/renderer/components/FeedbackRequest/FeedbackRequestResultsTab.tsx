/**
 * The results surface as a tab.
 *
 * Everything IPC-shaped lives here -- opening the room, building the host --
 * so `FeedbackRequestResults` stays a component that reads atoms and calls
 * host methods. Mounted by TabContent for a `virtual://feedback-request/` tab.
 */

import React, { useEffect, useMemo } from 'react';

import type { FeedbackRequestServiceTarget } from '../../../shared/feedbackRequest';
import { FeedbackRequestResults } from './FeedbackRequestResults';
import { openSharedDocumentInTab } from '../../utils/openSharedDocumentInTab';
import {
  createFeedbackResultsHost,
  startFeedbackRequestSync,
} from './createFeedbackResultsHost';
import { parseFeedbackRequestTabUri } from './feedbackRequestTab';

export interface FeedbackRequestResultsTabProps {
  /** The tab's `virtual://feedback-request/<orgId>/<requestId>` key. */
  tabUri: string;
  /** Absent only while a window has no workspace resolved yet. */
  workspacePath?: string;
}

export const FeedbackRequestResultsTab: React.FC<FeedbackRequestResultsTabProps> = ({
  tabUri,
  workspacePath,
}) => {
  const ref = useMemo(() => parseFeedbackRequestTabUri(tabUri), [tabUri]);
  const target = useMemo<FeedbackRequestServiceTarget | null>(
    () => (ref && workspacePath
      ? { workspacePath, orgId: ref.orgId, requestId: ref.requestId }
      : null),
    [ref, workspacePath],
  );

  useEffect(() => {
    if (!target) return;
    void startFeedbackRequestSync(target);
  }, [target]);

  const host = useMemo(
    () => (target ? createFeedbackResultsHost({ target }) : undefined),
    [target],
  );

  if (!target) {
    return (
      <div
        data-testid="feedback-request-results-tab-invalid"
        className="feedback-request-results-tab-invalid select-text p-4 text-xs text-nim-muted"
      >
        This tab does not point at a feedback request any more.
      </div>
    );
  }

  return (
    <div className="feedback-request-results-tab h-full overflow-auto p-4">
      <FeedbackRequestResults
        target={target}
        host={host}
        onOpenArtifact={(artifact) => {
          // Same rule as the respond surface: only a published document is
          // addressable, and anything else stays inert rather than routing to
          // a path this window may not have.
          if (artifact.ref.kind !== 'document') return;
          openSharedDocumentInTab(artifact.ref.sourceId, 'feedback_request');
        }}
      />
    </div>
  );
};
