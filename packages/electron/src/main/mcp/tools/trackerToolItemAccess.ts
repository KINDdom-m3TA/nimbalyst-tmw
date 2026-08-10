import type { TrackerItem } from '@nimbalyst/runtime';
import { parseFullDocumentTrackerId } from '@nimbalyst/runtime/plugins/TrackerPlugin/documentHeader/frontmatterUtils';
import { isLocalIssueKey } from '../../../shared/localIssueKey';
import type { ElectronDocumentService } from '../../services/ElectronDocumentService';

export async function resolveTrackerRowByReference(
  db: { query: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }> },
  reference: string,
  workspacePath?: string,
): Promise<any | null> {
  // Legacy provisional keys are not stable references. New items never
  // receive them, but refusing old values prevents a stale LC reference from
  // resolving to whichever historical row happens to carry it.
  if (isLocalIssueKey(reference)) {
    return null;
  }

  const params: any[] = [reference];
  const workspaceClause = workspacePath ? ` AND workspace = $2` : '';
  if (workspacePath) params.push(workspacePath);

  const result = await db.query<any>(
    `SELECT *
     FROM tracker_items
     WHERE (id = $1 OR issue_key = $1)${workspaceClause}
     ORDER BY updated DESC
     LIMIT 1`,
    params
  );

  if (result.rows[0]) {
    return result.rows[0];
  }

  const parsed = parseFullDocumentTrackerId(reference);
  if (!parsed) {
    return null;
  }

  const frontmatterParams: any[] = [parsed.relativePath, parsed.trackerType];
  const frontmatterWorkspaceClause = workspacePath ? ` AND workspace = $3` : '';
  if (workspacePath) frontmatterParams.push(workspacePath);
  const frontmatterResult = await db.query<any>(
    `SELECT *
     FROM tracker_items
     WHERE source = 'frontmatter'
       AND source_ref = $1
       AND type = $2${frontmatterWorkspaceClause}
     ORDER BY updated DESC
     LIMIT 1`,
    frontmatterParams
  );

  return frontmatterResult.rows[0] || null;
}

export async function getDocumentServiceForWorkspace(
  workspacePath: string | undefined,
): Promise<{
  docService: ElectronDocumentService | undefined;
  tempDocService: ElectronDocumentService | undefined;
}> {
  if (!workspacePath) {
    return { docService: undefined, tempDocService: undefined };
  }

  const { documentServices } = await import('../../window/WindowManager');
  return {
    docService: documentServices.get(workspacePath),
    tempDocService: undefined,
  };
}

export async function resolveTrackerItemFromDocumentService(
  docService: ElectronDocumentService | undefined,
  reference: string,
): Promise<TrackerItem | null> {
  if (!docService) return null;

  const byId = await docService.getTrackerItemById(reference);
  if (byId) return byId;

  const allItems = await docService.listTrackerItems();
  return allItems.find((candidate) => candidate.issueKey === reference) || null;
}
