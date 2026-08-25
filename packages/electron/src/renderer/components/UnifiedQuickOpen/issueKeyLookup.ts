/**
 * Tracker matching for quick open.
 *
 * The Memory pane is a pure embedding search, so a query like "NIM-2374" or a
 * bare "2374" ranks by meaning and never resolves to the item the user is
 * actually naming. These helpers recognise a key-shaped query and turn exact
 * matches into results that get pinned above the semantic hits.
 *
 * The plain text predicate lives here too, out of the 3000-line dialog, because
 * it is where a null title took the whole thing down.
 */

import type { TrackerItem } from '@nimbalyst/runtime/core/DocumentService';

export interface ParsedIssueKeyQuery {
  /** Key prefix the user typed (e.g. "NIM"), or null when they typed only a number. */
  prefix: string | null;
  /** Issue number, leading zeros stripped. */
  number: string;
}

/** Accepts "NIM-2374", "nim 2374", "nim2374", "#2374" and a bare "2374". */
const ISSUE_KEY_QUERY = /^#?\s*([a-z]+)?[\s-]*(\d{1,9})$/i;

/** Issue keys are always `<letters>-<digits>`. */
const ISSUE_KEY = /^([a-z]+)-(\d+)$/i;

export function parseIssueKeyQuery(query: string): ParsedIssueKeyQuery | null {
  const match = ISSUE_KEY_QUERY.exec(query.trim());
  if (!match) return null;
  return {
    prefix: match[1] ? match[1].toLowerCase() : null,
    number: match[2].replace(/^0+(?=\d)/, ''),
  };
}

function matchesIssueKey(issueKey: string, parsed: ParsedIssueKeyQuery): boolean {
  const match = ISSUE_KEY.exec(issueKey);
  if (!match) return false;
  if (parsed.prefix && match[1].toLowerCase() !== parsed.prefix) return false;
  return match[2] === parsed.number;
}

/**
 * Exact issue-key matches for `query`, newest first. A bare number matches any
 * prefix, so a workspace with more than one key prefix can still return several.
 */
export function findTrackersByIssueKey(
  query: string,
  items: readonly TrackerItem[],
): TrackerItem[] {
  const parsed = parseIssueKeyQuery(query);
  if (!parsed) return [];
  return items
    .filter(
      (item) =>
        !item.archived && !!item.issueKey && matchesIssueKey(item.issueKey, parsed),
    )
    .sort((a, b) => {
      const ta = a.updated ? Date.parse(a.updated) : 0;
      const tb = b.updated ? Date.parse(b.updated) : 0;
      return tb - ta;
    });
}

/**
 * Substring match across the fields the Trackers pane searches. `query` must
 * already be lowercased. Every field is optional-chained: a frontmatter item
 * with no heading has a null title, and an unguarded `.toLowerCase()` on it
 * threw straight into the dialog's error boundary.
 */
export function matchesTrackerText(item: TrackerItem, query: string): boolean {
  return (
    !!item.title?.toLowerCase().includes(query) ||
    !!item.issueKey?.toLowerCase().includes(query) ||
    !!item.description?.toLowerCase().includes(query) ||
    !!item.id?.toLowerCase().includes(query)
  );
}

/**
 * A search result, plus the tracker type when we know it. The engine's records
 * carry only `refType: 'tracker'`, so a semantic hit cannot say whether it is a
 * bug or a decision; an exact key match came from the item itself and can.
 */
export type QuickOpenSearchResult = SemanticSearchResult & {
  trackerType?: string;
};

/** Shape an exact key match like a search result so the pane renders it inline. */
export function trackerToSearchResult(item: TrackerItem): QuickOpenSearchResult {
  return {
    refType: 'tracker',
    refId: item.id,
    sourceClass: 'trackers',
    sourcePath: item.issueKey ?? item.id,
    // A frontmatter-projected item can arrive with no title; the pane falls
    // back to sourcePath rather than rendering a blank row.
    title: item.title ?? '',
    snippet: item.issueKey ?? '',
    score: 1,
    // Exact key hit, not an embedding hit — no "semantic match" marker.
    signals: { dense: false, sparse: true },
    trackerType: item.type,
  };
}

/** Exact key matches first, then the semantic results minus any duplicates. */
export function mergeIssueKeyMatches(
  matches: readonly TrackerItem[],
  semantic: readonly SemanticSearchResult[],
): QuickOpenSearchResult[] {
  if (matches.length === 0) return [...semantic];
  const matchedIds = new Set(matches.map((item) => item.id));
  return [
    ...matches.map(trackerToSearchResult),
    ...semantic.filter(
      (result) => !(result.refType === 'tracker' && matchedIds.has(result.refId)),
    ),
  ];
}
