import type {
  Actor,
  FeedbackAnswer,
  FeedbackRequestCreateInput,
  FeedbackRequestLifecycleStatus,
} from '@nimbalyst/collab-protocol';
import type {
  FeedbackRequestNudgeReceipt,
  FeedbackRequestSyncState,
  FeedbackRequestTarget,
} from '@nimbalyst/runtime/sync';

export interface FeedbackRequestServiceTarget extends FeedbackRequestTarget {
  workspacePath: string;
}

export type FeedbackRequestConnectionStatus =
  | 'idle'
  | 'cached'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface FeedbackRequestServiceState extends FeedbackRequestServiceTarget {
  /** Org-scoped member id derived from the team JWT in main. */
  viewerUserId: string;
  status: FeedbackRequestConnectionStatus;
  request?: FeedbackRequestSyncState['request'];
  progress?: FeedbackRequestSyncState['progress'];
  lastNudge?: FeedbackRequestNudgeReceipt;
  error?: { code: string; message: string };
}

/**
 * The author as the renderer can honestly describe it: the session that drafted
 * the request. `onBehalfOfUserId` is deliberately absent -- it is the *org-scoped*
 * member id, which differs per organization and is only derivable from the team
 * JWT. Main stamps it during `create`, so a renderer cannot name someone else as
 * the author, and a personal user id can never be mistaken for a team one.
 */
export type FeedbackRequestAuthorInput = Omit<Actor, 'onBehalfOfUserId'>;

export interface FeedbackRequestCreateIpcRequest {
  target: FeedbackRequestServiceTarget;
  clientMutationId: string;
  request: Omit<FeedbackRequestCreateInput, 'author'> & {
    author: FeedbackRequestAuthorInput;
  };
}

export interface FeedbackRequestRespondIpcRequest {
  target: FeedbackRequestServiceTarget;
  clientMutationId: string;
  askId: string;
  answer: FeedbackAnswer;
}

export interface FeedbackRequestCloseIpcRequest {
  target: FeedbackRequestServiceTarget;
  clientMutationId: string;
  status: Exclude<FeedbackRequestLifecycleStatus, 'open'>;
}

export interface FeedbackRequestNudgeIpcRequest {
  target: FeedbackRequestServiceTarget;
  clientMutationId: string;
  recipientUserIds?: string[];
}
