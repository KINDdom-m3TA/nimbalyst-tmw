import type { CollabCommand, CollabCommandResult, Unsubscribe } from '@nimbalyst/collab-client/core';
import type { TrackerItem } from '@nimbalyst/runtime/core/DocumentService';

export type { TrackerItem } from '@nimbalyst/runtime/core/DocumentService';

export type TrackerSyncStatus = 'disconnected' | 'connecting' | 'syncing' | 'connected' | 'error';

export interface TrackerSyncState {
  workspacePath: string;
  status: TrackerSyncStatus;
  projectId: string | null;
}

/** Serialized shared-view row projected by TrackerPersistence. */
export interface TrackerSavedViewRecord {
  viewId: string;
  payload: string;
}

export interface TrackerDataSnapshot {
  items: TrackerItem[];
  savedViews: TrackerSavedViewRecord[];
  sync: TrackerSyncState;
}

export interface TrackerMutationRejection {
  workspacePath: string;
  itemId: string;
  clientMutationId?: string;
  code: 'staleKeyEpoch' | 'rotationLocked' | 'custodyUnavailable' | 'forbidden' | 'malformed';
  message?: string;
}

export type TrackerDataChange =
  | { type: 'items-replaced'; items: TrackerItem[] }
  | { type: 'items-upserted'; items: TrackerItem[] }
  | { type: 'items-removed'; itemIds: string[] }
  | { type: 'saved-views-replaced'; savedViews: TrackerSavedViewRecord[] }
  | { type: 'status'; sync: TrackerSyncState }
  | { type: 'mutation-rejected'; rejection: TrackerMutationRejection }
  | {
      type: 'config-changed';
      workspacePath: string;
      config: { issueKeyPrefix: string };
    };

export interface TrackerCreateItemInput {
  id: string;
  type: string;
  title: string;
  status: string;
  priority: string;
  workspace: string;
  description?: string;
  owner?: string;
  tags?: string[];
  customFields?: Record<string, unknown>;
  sharing?: 'personal' | 'team';
  draftByDefault?: boolean;
  content?: unknown;
  source?: string;
  sourceRef?: string;
}

export interface TrackerUpdateItemInput {
  itemId: string;
  updates: Record<string, unknown>;
  sharing?: 'personal' | 'team';
  draftByDefault?: boolean;
}

export interface TrackerBatchUpdateInput {
  entries: Array<{
    itemId: string;
    fileUpdates?: Record<string, unknown>;
    storeUpdates?: Record<string, unknown>;
    sharing?: 'personal' | 'team';
    draftByDefault?: boolean;
  }>;
}

export type TrackerDataCommand =
  | { type: 'list-items' }
  | { type: 'refresh-items' }
  | { type: 'create-item'; item: TrackerCreateItemInput }
  | { type: 'update-item'; input: TrackerUpdateItemInput }
  | { type: 'update-items'; input: TrackerBatchUpdateInput }
  | { type: 'archive-item'; itemId: string; archive: boolean }
  | { type: 'delete-item'; itemId: string }
  | { type: 'update-item-content'; itemId: string; content: unknown }
  | { type: 'add-comment'; itemId: string; body: string }
  | {
      type: 'update-comment';
      itemId: string;
      commentId: string;
      body?: string;
      deleted?: boolean;
    }
  | { type: 'share-saved-view'; savedView: TrackerSavedViewRecord }
  | { type: 'unshare-saved-view'; viewId: string }
  | { type: 'reconnect' };

export interface TrackerDataCommandResult extends CollabCommandResult {
  /** The existing host mutation result, preserved without renderer-side reshaping. */
  result?: unknown;
  items?: TrackerItem[];
  savedViews?: TrackerSavedViewRecord[];
}

/**
 * Projection/command seam between tracker UI state and a host-owned sync engine.
 *
 * Desktop proxies the engine through Electron IPC; browsers host it in-page.
 * The lifecycle deliberately matches CollabDataSource without exposing either
 * host's transport.
 */
export interface TrackerDataSource {
  snapshot(): Promise<TrackerDataSnapshot>;
  subscribe(cb: (change: TrackerDataChange) => void): Unsubscribe;
  command(command: TrackerDataCommand): Promise<TrackerDataCommandResult>;
  status(): TrackerSyncState;
  dispose(): void;
}

// Compile-time assertion that tracker commands retain the shared command shape.
const _trackerDataCommand: CollabCommand = {} as TrackerDataCommand;
void _trackerDataCommand;
