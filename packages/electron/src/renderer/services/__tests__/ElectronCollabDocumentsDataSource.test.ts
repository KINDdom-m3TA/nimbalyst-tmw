// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type { TeamSyncConfig } from '@nimbalyst/runtime/sync';
import type { CollabScope } from '@nimbalyst/collab-client/core';
import { ElectronCollabDocumentsDataSource } from '../ElectronCollabDocumentsDataSource';

const scope: CollabScope = {
  scopeKey: 'scope-one',
  orgId: 'org-one',
  indexConfig: {
    serverUrl: 'wss://example.test',
    teamProjectId: 'project-one',
    userId: 'member-one',
  },
};

describe('ElectronCollabDocumentsDataSource', () => {
  it('projects provider snapshots/events and routes commands through the provider', async () => {
    let config!: TeamSyncConfig;
    const observeStatus = vi.fn();
    const provider = {
      connect: vi.fn(async () => undefined),
      getStatus: vi.fn(() => 'connected' as const),
      getDocuments: vi.fn(() => [{
        documentId: 'doc-1',
        projectId: 'project-owned',
        title: 'One',
        documentType: 'markdown',
        createdBy: 'member-one',
        createdAt: 1,
        updatedAt: 2,
      }]),
      getFolders: vi.fn(() => [{
        folderId: 'folder-1',
        parentFolderId: null,
        name: 'Folder',
        sortOrder: 1,
        createdBy: 'member-one',
        createdAt: 1,
        updatedAt: 2,
      }]),
      getTeamState: vi.fn(() => ({ members: [] })),
      updateDocumentTitle: vi.fn(async () => undefined),
      refreshFolders: vi.fn(async () => []),
      destroy: vi.fn(),
    };
    const source = new ElectronCollabDocumentsDataSource({
      scope,
      getJwt: async () => 'team-jwt',
      events: { observeStatus },
      createProvider: (nextConfig) => {
        config = nextConfig;
        return provider as any;
      },
    });
    const changes: string[] = [];
    source.subscribe((change) => changes.push(change.type));

    await expect(source.snapshot()).resolves.toEqual({
      items: [expect.objectContaining({
        documentId: 'doc-1',
        title: 'One',
        teamProjectId: 'project-owned',
      })],
      containers: [expect.objectContaining({ folderId: 'folder-1', name: 'Folder' })],
    });
    config.onDocumentChanged?.({
      documentId: 'doc-2',
      projectId: 'project-two',
      title: 'Two',
      documentType: 'markdown',
      createdBy: 'member-two',
      createdAt: 3,
      updatedAt: 4,
    });
    config.onFoldersRemoved?.(['folder-1'], ['doc-1']);
    config.onStatusChange?.('connected');
    await source.command({ type: 'update-document-title', documentId: 'doc-1', title: 'Renamed' });

    expect(changes).toEqual(['items-upserted', 'containers-removed', 'status']);
    expect(observeStatus).toHaveBeenCalledWith('connected');
    expect(provider.updateDocumentTitle).toHaveBeenCalledWith('doc-1', 'Renamed');
    expect(provider.connect).toHaveBeenCalledTimes(1);
    source.dispose();
    expect(provider.destroy).toHaveBeenCalledTimes(1);
  });
});
