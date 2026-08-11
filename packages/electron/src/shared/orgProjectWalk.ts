/**
 * Pure decisions behind the post-sign-in project walk.
 *
 * Organization membership is account-level, but the organization a project
 * window shows is resolved per workspace from that workspace's git remote
 * (`TeamService.findTeamForWorkspace`). An invited member who signs in and
 * opens an unrelated folder is a real active member whose folder matches
 * nothing, so every org surface reports "No organization". The walk gives that
 * lookup something to match; the functions here decide when to offer it, what
 * the account row should say meanwhile, and what a chosen folder may be used
 * for.
 *
 * Kept free of IPC and React so both the main process (which owns the git and
 * filesystem facts) and the renderer (which owns the dialog) can share one set
 * of rules. See nimbalyst-local/plans/simpler-org-signup-flow.md.
 */

export interface ProjectWalkOrg {
  orgId: string;
  name: string;
}

export interface ProjectWalkInput {
  /** Active-member organizations on the account. An invitation is not membership. */
  orgs: readonly ProjectWalkOrg[];
  /** Organizations an already-open workspace resolves to. */
  boundOrgIds: readonly string[];
  /** Organizations whose walk the user closed. */
  dismissedOrgIds?: readonly string[];
}

export interface ProjectWalkPresentation {
  /** The organization to walk into, or null when nothing needs walking. */
  org: ProjectWalkOrg | null;
  /** Whether to present the walk unprompted. */
  autoPresent: boolean;
}

/**
 * One open workspace bound to any of the account's organizations is enough to
 * stay quiet: the user already has a working project window, and the walk would
 * be an interruption rather than a rescue.
 *
 * A dismissal clears `autoPresent` but never `org` — the persistent "Join {Org}
 * project" entry point reads `org`, and it is what replaces the misleading
 * "No organization — Set up" row for someone who is in fact a member.
 */
export function resolveProjectWalkPresentation(
  input: ProjectWalkInput,
): ProjectWalkPresentation {
  const bound = new Set(input.boundOrgIds);
  if (input.orgs.some((org) => bound.has(org.orgId))) {
    return { org: null, autoPresent: false };
  }
  const org = input.orgs[0] ?? null;
  if (!org) return { org: null, autoPresent: false };
  return {
    org,
    autoPresent: !(input.dismissedOrgIds ?? []).includes(org.orgId),
  };
}

export type AccountOrgRow =
  /** The lookup has not answered yet; claiming either answer would be a guess. */
  | { kind: 'loading' }
  /** The workspace resolved to an organization — administer it. */
  | { kind: 'organization'; org: ProjectWalkOrg }
  /** A member with nothing bound yet — resume the walk. */
  | { kind: 'joinProject'; org: ProjectWalkOrg }
  /** Genuinely no organization — offer to create one. */
  | { kind: 'setUp' };

export function resolveAccountOrgRow(input: {
  projectOrg: ProjectWalkOrg | null;
  projectOrgLoading: boolean;
  /** The unbound organization from `resolveProjectWalkPresentation`, if any. */
  walkOrg: ProjectWalkOrg | null;
}): AccountOrgRow {
  if (input.projectOrgLoading) return { kind: 'loading' };
  if (input.projectOrg) return { kind: 'organization', org: input.projectOrg };
  if (input.walkOrg) return { kind: 'joinProject', org: input.walkOrg };
  return { kind: 'setUp' };
}

export interface ProjectFolderFacts {
  exists: boolean;
  isDirectory: boolean;
  isEmpty: boolean;
  /** Hash of the folder's own `origin` remote, when it has one. */
  folderRemoteHash: string | null;
}

export type ProjectFolderVerdict =
  /** Empty or absent: safe to clone into. */
  | { kind: 'clonable' }
  /** Already a clone of this project's repository: open it, don't clone twice. */
  | { kind: 'alreadyCloned' }
  /** A remote-less project can record this folder as its own. */
  | { kind: 'bindable' }
  /** The folder's remote connects it to something else. */
  | { kind: 'wrongRemote' }
  /** Non-empty and unrelated: cloning would merge into the user's files. */
  | { kind: 'occupied' }
  | { kind: 'notADirectory' };

/**
 * What a folder may be used for, given what the project is matched by.
 *
 * A project with a `gitRemoteHash` is matched to teammates by its repository,
 * so only that repository's clone will do. One without is matched by a local
 * binding instead, which any folder can carry.
 */
export function classifyProjectFolder(
  facts: ProjectFolderFacts,
  projectGitRemoteHash: string | null,
): ProjectFolderVerdict {
  if (facts.exists && !facts.isDirectory) return { kind: 'notADirectory' };

  if (!projectGitRemoteHash) return { kind: 'bindable' };

  if (facts.folderRemoteHash) {
    return facts.folderRemoteHash === projectGitRemoteHash
      ? { kind: 'alreadyCloned' }
      : { kind: 'wrongRemote' };
  }
  if (!facts.exists || facts.isEmpty) return { kind: 'clonable' };
  return { kind: 'occupied' };
}

/**
 * Whether a clone URL is safe to hand to `git` as argv.
 *
 * The URL comes off the organization's project record, so an admin (or anyone
 * who reached the server) could otherwise put an option there: `git clone
 * --upload-pack=...` runs a command on every member's machine. Only the
 * transports Nimbalyst actually offers are accepted.
 */
export function isSafeCloneUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('-')) return false;
  if (/\s/.test(trimmed)) return false;
  return (
    /^https?:\/\/[^/]+\/.+/.test(trimmed)
    || /^ssh:\/\/[^/]+\/.+/.test(trimmed)
    || /^git:\/\/[^/]+\/.+/.test(trimmed)
    // scp-style: user@host:path
    || /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:.+/.test(trimmed)
  );
}

export type CloneFailureKind = 'auth' | 'network' | 'cancelled' | 'unknown';

/**
 * Why a clone failed, from git's own stderr.
 *
 * A private repository answers "not found" to an unauthenticated client, so
 * that case is credentials rather than a bad address — telling the user their
 * admin recorded the wrong URL would send them somewhere pointless.
 */
export function classifyCloneFailure(stderr: string): CloneFailureKind {
  const text = (stderr || '').toLowerCase();
  if (!text) return 'unknown';
  if (
    text.includes('authentication failed')
    || text.includes('permission denied')
    || text.includes('could not read username')
    || text.includes('could not read password')
    || text.includes('terminal prompts disabled')
    || text.includes('not found')
    || text.includes('access denied')
    || text.includes('403')
  ) {
    return 'auth';
  }
  if (
    text.includes('could not resolve host')
    || text.includes('connection timed out')
    || text.includes('network is unreachable')
    || text.includes('failed to connect')
  ) {
    return 'network';
  }
  return 'unknown';
}

/**
 * Whether git refused the destination because it already held content.
 *
 * git checks this before it writes anything, so the message is direct evidence
 * that whatever is in the destination is somebody else's — not a half-clone of
 * ours to clean up.
 */
export function cloneRefusedExistingDestination(stderr: string): boolean {
  return /already exists and is not an empty directory/i.test(stderr || '');
}

/** What is known about the destination at the moment a failed clone cleans up. */
export interface FailedCloneDestinationEvidence {
  /** The destination did not exist when this clone started. */
  absentBeforeClone: boolean;
  /** git refused to touch the destination because it already held content. */
  gitRefusedExistingDestination: boolean;
  /** The destination is a directory right now. */
  isDirectoryNow: boolean;
  /** Its immediate entries right now; `null` when it is gone or unreadable. */
  entriesNow: readonly string[] | null;
}

/**
 * Whether a failed clone may delete its destination.
 *
 * The point of the cleanup is that a half-clone left behind is refused by the
 * next attempt as "not empty". The danger is that `rm -r` on the wrong folder
 * destroys files this app never created, so the pre-flight "it wasn't there
 * when we started" is treated as necessary but not sufficient: between that
 * check and git's own look at the path, anything could have created and filled
 * it. Deletion additionally requires evidence, read at cleanup time, that git
 * is what put the contents there — git refusing the path proves the opposite,
 * and a `.git` entry (or an empty directory) is what git's own work leaves.
 *
 * Anything else is left on disk for the user to see. A stranded partial clone
 * is a far better outcome than a deleted folder.
 */
export function shouldRemoveFailedCloneDestination(
  evidence: FailedCloneDestinationEvidence,
): boolean {
  if (!evidence.absentBeforeClone) return false;
  if (evidence.gitRefusedExistingDestination) return false;
  if (!evidence.isDirectoryNow || evidence.entriesNow === null) return false;
  if (evidence.entriesNow.length === 0) return true;
  return evidence.entriesNow.includes('.git');
}

// A URL, and the scp-style `user@host:path` form git also accepts. Quotes are
// excluded so git's own `repository '...' not found` phrasing survives intact.
const SCHEME_ADDRESS_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi;
const SCP_ADDRESS_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9._-]+(?::[^\s'"]*)?/g;

/**
 * Strip repository addresses (and the member emails they carry) out of text
 * bound for a log.
 *
 * git's failure output routinely quotes the address it was given — `repository
 * 'https://host/org/private-repo/' not found` — and an organization's
 * repository URL is org-sensitive. `main.log` is persistent and travels with
 * bug reports, so nothing raw goes into it unredacted.
 */
export function redactRemoteAddresses(text: string): string {
  if (!text) return '';
  return text
    .replace(SCHEME_ADDRESS_PATTERN, '[redacted]')
    .replace(SCP_ADDRESS_PATTERN, '[redacted]');
}

export interface CloneProgress {
  phase: string;
  percent: number | null;
}

/**
 * The latest progress line in a chunk of `git clone --progress` stderr. git
 * rewrites the same line with carriage returns, so a chunk routinely holds
 * several updates and only the last one is current.
 */
export function parseCloneProgress(chunk: string): CloneProgress | null {
  if (!chunk) return null;
  const matches = [...chunk.matchAll(/([A-Za-z][A-Za-z ]*?):\s+(\d{1,3})%/g)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  return { phase: last[1].trim(), percent: Number(last[2]) };
}
