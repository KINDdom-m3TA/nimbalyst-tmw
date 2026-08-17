import { BrowserWindow } from 'electron';

import type {
  FeedbackRequestCloseIpcRequest,
  FeedbackRequestCommentIpcRequest,
  FeedbackRequestCreateIpcRequest,
  FeedbackRequestNudgeIpcRequest,
  FeedbackRequestRespondIpcRequest,
  FeedbackRequestServiceTarget,
} from '../../shared/feedbackRequest';
import {
  getFeedbackRequestService,
  shutdownFeedbackRequestService,
} from '../services/FeedbackRequestService';
import { safeHandle } from '../utils/ipcRegistry';

let cleanupSubscription: (() => void) | null = null;

export function registerFeedbackRequestHandlers(): void {
  if (cleanupSubscription) return;
  const service = getFeedbackRequestService();
  cleanupSubscription = service.subscribe((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('feedback-request:state-changed', state);
      }
    }
  });

  safeHandle(
    'feedback-request:start',
    async (_event, target: FeedbackRequestServiceTarget) => service.start(target),
  );
  safeHandle(
    'feedback-request:get-cached',
    async (_event, target: FeedbackRequestServiceTarget) => service.getCached(target),
  );
  safeHandle(
    'feedback-request:create',
    async (_event, input: FeedbackRequestCreateIpcRequest) => service.create(
      input.target,
      input.clientMutationId,
      input.request,
    ),
  );
  safeHandle(
    'feedback-request:respond',
    async (_event, input: FeedbackRequestRespondIpcRequest) => service.respond(
      input.target,
      input.clientMutationId,
      input.askId,
      input.answer,
    ),
  );
  safeHandle(
    'feedback-request:comment',
    async (_event, input: FeedbackRequestCommentIpcRequest) => service.comment(
      input.target,
      input.clientMutationId,
      input.body,
      input.replyToCommentId,
    ),
  );
  safeHandle(
    'feedback-request:close',
    async (_event, input: FeedbackRequestCloseIpcRequest) => service.close(
      input.target,
      input.clientMutationId,
      input.status,
    ),
  );
  safeHandle(
    'feedback-request:nudge',
    async (_event, input: FeedbackRequestNudgeIpcRequest) => service.nudge(
      input.target,
      input.clientMutationId,
      input.recipientUserIds,
    ),
  );
}

export function shutdownFeedbackRequestHandlers(): void {
  cleanupSubscription?.();
  cleanupSubscription = null;
  shutdownFeedbackRequestService();
}
