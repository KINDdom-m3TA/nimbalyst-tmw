import type { FeedbackRequestNudgeReceipt, FeedbackRequestSyncState, FeedbackRequestTarget } from '../../../runtime/src/sync/FeedbackRequestSync';
export interface FeedbackRequestServiceTarget extends FeedbackRequestTarget {
    workspacePath: string;
}
export type FeedbackRequestConnectionStatus = 'idle' | 'cached' | 'connecting' | 'connected' | 'disconnected' | 'error';
export interface FeedbackRequestServiceState extends FeedbackRequestServiceTarget {
    /** Org-scoped member id derived from the team JWT in the host. */
    viewerUserId: string;
    status: FeedbackRequestConnectionStatus;
    request?: FeedbackRequestSyncState['request'];
    progress?: FeedbackRequestSyncState['progress'];
    lastNudge?: FeedbackRequestNudgeReceipt;
    error?: {
        code: string;
        message: string;
    };
}
