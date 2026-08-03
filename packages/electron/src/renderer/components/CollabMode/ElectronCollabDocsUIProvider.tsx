import React from 'react';
import {
  CollabDocsUIProvider,
  type CollabDocsUIController,
} from '@nimbalyst/collab-client/docs-ui';
import type { CollabScope } from '@nimbalyst/collab-client/core';
import {
  getElectronCollabDocsSession,
  trashSharedDocument,
} from '../../store/atoms/collabDocuments';
import { useDocUnread } from '../../hooks/useDocUnread';
import { useCollabLocalOrigin } from '../../hooks/useCollabLocalOrigin';
import { createCollaborativeDocument } from '../../services/collaborativeDocumentCreationOrchestrator';
import {
  registerElectronCollabDocumentCreation,
} from '../../services/ElectronCollabHost';
import { sweepEmptySharedDocuments } from '../../utils/sharedDocumentCleanup';

registerElectronCollabDocumentCreation(async ({
  scope,
  descriptor,
  requestedName,
  parentFolderId,
  sourceContent,
}) => {
  await createCollaborativeDocument({
    scope,
    descriptor,
    requestedName,
    parentFolderId,
    sourceContent,
    analyticsSource: 'new_document',
    analyticsActorType: 'user',
  });
});

function useElectronCollabLocalOrigin(
  scopeKey: string,
  documentId: string | null | undefined,
  documentType?: string,
) {
  return {
    available: true,
    ...useCollabLocalOrigin(scopeKey, documentId, documentType),
  };
}

const electronCollabDocsUIController: CollabDocsUIController = {
  useLocalOrigin: useElectronCollabLocalOrigin,
  cleanupEmptyDocuments: async (scope, documents, onProgress) => {
    const { inspectSharedDocumentEmptiness } = await import('../../utils/documentSeedOrchestrator');
    return sweepEmptySharedDocuments(
      documents,
      (document) => inspectSharedDocumentEmptiness({
        workspacePath: scope.scopeKey,
        documentId: document.documentId,
        documentType: document.documentType,
        title: document.title,
      }),
      (documentId) => trashSharedDocument(scope, documentId),
      onProgress,
    );
  },
};

export function ElectronCollabDocsUIProvider({
  scope,
  children,
}: {
  scope: CollabScope;
  children: React.ReactNode;
}) {
  // Desktop read-receipt IPC hydration remains a host concern. The session
  // owns the receipt/unread atoms that this hook updates.
  useDocUnread();
  return (
    <CollabDocsUIProvider
      session={getElectronCollabDocsSession(scope)}
      controller={electronCollabDocsUIController}
    >
      {children}
    </CollabDocsUIProvider>
  );
}
