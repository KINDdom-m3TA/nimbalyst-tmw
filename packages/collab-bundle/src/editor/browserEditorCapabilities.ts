/**
 * What a browser host can and cannot do for an extension editor.
 *
 * This table is the source of truth for the classification, not a doc: the
 * host in `browserExtensionHost.ts` builds every one of its members from it,
 * and `EditorHost.capabilities` hands the same table to the extension so it
 * can branch before it calls.
 *
 * Two rules drove every row.
 *
 * 1. **A capability the host cannot provide must be detectable.** Where the
 *    SDK member is optional the host simply omits it, which extensions already
 *    understand. Where the member is required by `EditorHost` and cannot be
 *    omitted, the host still answers `false` here.
 * 2. **A required member that cannot work must fail, not resolve.** The one
 *    that matters is `saveContent`: resolving it would tell an editor its
 *    document had been written to a file that does not exist, and the editor
 *    would clear its dirty state on the strength of it. It rejects with
 *    {@link BrowserEditorCapabilityError} instead.
 */

import type {
  EditorHostCapability,
  EditorHostCapabilities,
  EditorHostCapabilityGap,
} from '@nimbalyst/extension-sdk/types/editor';

export type { EditorHostCapability, EditorHostCapabilities, EditorHostCapabilityGap };

/** Identifies this host in `EditorHostCapabilities.environment`. */
export const BROWSER_EDITOR_ENVIRONMENT = 'browser';

/**
 * Capabilities a browser collaborative host provides for real.
 *
 * `collaboration` and `presence` head the list on purpose: this host exists to
 * run a document whose state lives in a Y.Doc, so the collaborative surface is
 * the *primary* contract here rather than the optional extra it is on desktop.
 */
export const BROWSER_EDITOR_SUPPORTED_CAPABILITIES = [
  'collaboration',
  'presence',
  'dirtyState',
  'theme',
  'readOnly',
  'visibility',
  'initialContent',
  'editorApi',
] as const satisfies readonly EditorHostCapability[];

/**
 * Capabilities a browser collaborative host cannot provide, each with the
 * reason an extension author would need to understand the gap.
 *
 * `history`, `menuItems`, `aiContext` and `binaryContent` are absent from BOTH
 * lists: they are conditional on what the embedding page wired up, so
 * {@link createBrowserEditorCapabilities} resolves them per mount.
 */
export const BROWSER_EDITOR_CAPABILITY_GAPS = [
  {
    capability: 'localFileSave',
    reason:
      'A browser host has no local file to write. Collaborative documents are '
      + 'persisted by the server from the Y.Doc; saveContent() rejects rather '
      + 'than resolving on a write that never happened.',
  },
  {
    capability: 'fileChangeNotifications',
    reason:
      'Nothing watches a file here. Out-of-band changes arrive as Y.Doc '
      + 'updates from other clients, not as onFileChanged callbacks.',
  },
  {
    capability: 'projectFileSystem',
    reason:
      'There is no workspace on disk to read or compare-and-swap, so host.fs '
      + 'is omitted entirely.',
  },
  {
    capability: 'workspace',
    reason: 'A browser host opens one shared document, not a workspace.',
  },
  {
    capability: 'sourceMode',
    reason:
      'Source mode renders Monaco, which this bundle deliberately does not '
      + 'ship. The toggle members are omitted and supportsSourceMode is false.',
  },
  {
    capability: 'diffMode',
    reason:
      'AI edit review is a desktop flow driven by on-disk history; the diff '
      + 'members are omitted.',
  },
  {
    capability: 'findCommand',
    reason:
      'Find arrives on desktop as a native menu accelerator over IPC. A '
      + 'browser page has no equivalent to route, so onFindRequested is omitted.',
  },
  {
    capability: 'persistentStorage',
    reason:
      'host.storage is per-mount and in-memory. It is a real store for the '
      + 'lifetime of the editor and empty again after a reload; the bundle '
      + 'never reaches for browser storage on the host page\'s behalf.',
  },
  {
    capability: 'secretStorage',
    reason:
      'There is no secret store to reach. getSecret/setSecret reject rather '
      + 'than pretending to hold a credential.',
  },
  {
    capability: 'configuration',
    reason:
      'Extension configuration lives in host settings this bundle does not '
      + 'load; getConfig is omitted.',
  },
] as const satisfies readonly EditorHostCapabilityGap[];

/**
 * Thrown by a host member that the host has already declared unavailable.
 *
 * Carries the capability id so a caller can map back to
 * `EditorHostCapabilities.unavailable` and to
 * `editorHostSupports(host, capability)` -- the check that would have avoided
 * the call.
 */
export class BrowserEditorCapabilityError extends Error {
  readonly capability: EditorHostCapability;

  constructor(capability: EditorHostCapability, reason: string) {
    super(`The browser editor host cannot provide "${capability}". ${reason}`);
    this.name = 'BrowserEditorCapabilityError';
    this.capability = capability;
  }
}

/**
 * Capabilities the embedding page can grant by supplying the matching hook.
 * Absent hook, absent capability -- there is no partial version of these.
 */
export interface BrowserEditorGrantedCapabilities {
  /** `openHistory()` reaches a real history surface. */
  history?: boolean;
  /** `registerMenuItems()` reaches a real actions menu. */
  menuItems?: boolean;
  /** `setEditorContext` / `setEditorContextItems` reach an AI surface. */
  aiContext?: boolean;
  /** `loadBinaryContent()` has real bytes to return. */
  binaryContent?: boolean;
  /** `openExternal()` is wired to the page's navigation policy. */
  externalLinks?: boolean;
}

const CONDITIONAL_GAP_REASONS: Record<
  keyof BrowserEditorGrantedCapabilities,
  string
> = {
  history: 'The embedding page did not supply a history surface for this document.',
  menuItems: 'The embedding page did not supply an actions menu to register into.',
  aiContext: 'The embedding page did not supply an AI surface to push selection context to.',
  binaryContent:
    'This document was opened without binary seed content, so there are no '
    + 'bytes to return. Read the document through host.collaboration.yDoc.',
  externalLinks:
    'The embedding page did not supply a URL opener, so the bundle will not '
    + 'navigate on its behalf.',
};

/**
 * Build the capability answer for one mount.
 *
 * The static gap list is fixed; the conditional ones are resolved from what
 * the embedding page actually wired up, so `supports()` never claims something
 * the page left unimplemented.
 */
export function createBrowserEditorCapabilities(
  granted: BrowserEditorGrantedCapabilities = {},
): EditorHostCapabilities {
  const conditionalGaps = (
    Object.keys(CONDITIONAL_GAP_REASONS) as (keyof BrowserEditorGrantedCapabilities)[]
  )
    .filter((capability) => !granted[capability])
    .map((capability): EditorHostCapabilityGap => ({
      capability,
      reason: CONDITIONAL_GAP_REASONS[capability],
    }));

  const unavailable: EditorHostCapabilityGap[] = [
    ...BROWSER_EDITOR_CAPABILITY_GAPS,
    ...conditionalGaps,
  ];
  const unavailableSet = new Set(unavailable.map((gap) => gap.capability));

  return {
    environment: BROWSER_EDITOR_ENVIRONMENT,
    unavailable,
    supports: (capability) => !unavailableSet.has(capability),
  };
}

/** Look up why a capability is unavailable, for error messages. */
export function browserEditorCapabilityReason(
  capabilities: EditorHostCapabilities,
  capability: EditorHostCapability,
): string {
  return capabilities.unavailable
    .find((gap) => gap.capability === capability)?.reason
    ?? 'This host does not provide that capability.';
}

// ---------------------------------------------------------------------------
// Manifest permissions
// ---------------------------------------------------------------------------

/** The manifest permission block, narrowed to what a browser host can answer. */
export interface BrowserExtensionPermissions {
  filesystem?: boolean;
  ai?: boolean;
  network?: boolean;
}

export interface BrowserPermissionOutcome {
  /** What the extension's manifest asked for. */
  declared: boolean;
  /** Whether this host granted it. */
  granted: boolean;
  /** Why, when it was refused. */
  reason?: string;
}

/**
 * How a browser host answers `permissions: { filesystem: true }`.
 *
 * **Declared-but-ungranted.** The manifest field stays valid and loading is
 * never refused over it; the host simply grants no filesystem capability
 * (`host.fs` absent, `saveContent` rejecting, `projectFileSystem` and
 * `localFileSave` in the gap list).
 *
 * The alternative -- refusing to load an extension that declares it -- was
 * rejected because the permission is declared for the extension's *services*
 * (`context.services.filesystem`, AI tools reading workspace files), not for
 * its editor contribution, and every editor extension that ships today
 * declares it. Refusing on the declaration alone would exclude all of them
 * from the browser to protect against a call the collaborative editor path
 * does not make. Making it a hard error is also the wrong shape for a manifest
 * that is written once and consumed by two hosts with different powers: the
 * grant belongs to the host, the declaration to the extension.
 *
 * What must NOT happen is a quiet grant. The gap is recorded, `supports()`
 * answers false, and the members reject -- so an extension that does reach for
 * disk finds out immediately instead of writing into a void.
 */
export function resolveBrowserFilesystemPermission(
  permissions: BrowserExtensionPermissions | undefined,
): BrowserPermissionOutcome {
  const declared = permissions?.filesystem === true;
  return {
    declared,
    granted: false,
    reason:
      'A browser host has no filesystem to grant. The extension loads and its '
      + 'collaborative editor runs; filesystem-backed host members are absent '
      + 'or reject.',
  };
}
