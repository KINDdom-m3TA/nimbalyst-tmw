/**
 * DocumentSync awareness -> y-protocols `Awareness`.
 *
 * Extension editors consume the SDK's `host.collaboration.awareness`, which is
 * a real `y-protocols/awareness` instance (numeric clientIDs, `change`/`update`
 * events). DocumentSync speaks a different dialect: string member ids and a
 * whole-roster broadcast. This bridge is the translation, and it lives here
 * rather than in the Electron renderer because the browser collaborative host
 * needs the identical mapping -- two copies would be two presence dialects on
 * one room.
 *
 * Wire-format choice: the extension awareness path puts the full y-protocols
 * local state on the wire as-is. DocumentSync's `AwarenessState` was widened to
 * `Record<string, unknown> & { user: { name, color, id? } }` precisely so this
 * works without translation.
 *
 * What this is NOT is an event log. DocumentSync coalesces awareness to ~2Hz,
 * so a field set and then changed inside one window is only ever observed by a
 * peer in its final form -- the intermediate state is not delivered late, it is
 * not delivered at all. That is right for a cursor (a continuous value where
 * only the latest matters) and a trap for a *latched* field like "I have an
 * editor open on this cell": one stray local write retracts the latch, no peer
 * ever sees it set, and on the browser host the 5s presence heartbeat then
 * re-affirms the retraction indefinitely, so nothing self-heals. An extension
 * publishing a latch needs a single writer whose lifetime is the thing being
 * latched; see the CSV editor's `collab/localPresence.ts`.
 */

import { Awareness } from 'y-protocols/awareness';
import type { Doc } from 'yjs';

import type { AwarenessState as WireAwarenessState } from './documentSyncTypes';

/**
 * The slice of `DocumentSyncProvider` this bridge needs. Narrow on purpose:
 * the browser host wraps its provider in a presence surface, and a full
 * `DocumentSyncProvider` parameter would exclude it for no reason.
 */
export interface ExtensionAwarenessTransport {
  setLocalAwareness(state: WireAwarenessState): void;
  onAwarenessChange(listener: (states: Map<string, WireAwarenessState>) => void): () => void;
}

/** Standard awareness block every host publishes for generic presence UI. */
export interface ExtensionAwarenessUser {
  id: string;
  name: string;
  color: string;
}

export interface ExtensionAwarenessBridge {
  awareness: Awareness;
  destroy: () => void;
}

/** Origin tag for awareness updates we inject from remote broadcasts. */
const REMOTE_AWARENESS_ORIGIN = Symbol('nimbalyst:collab-remote-awareness');

export function createExtensionAwarenessBridge(args: {
  syncProvider: ExtensionAwarenessTransport;
  /** The Y.Doc owned by the sync provider; Awareness clientID derives from it. */
  yDoc: Doc;
  /** Local user identity to set on the Awareness instance immediately. */
  user: ExtensionAwarenessUser;
}): ExtensionAwarenessBridge {
  const { syncProvider, yDoc, user } = args;

  const awareness = new Awareness(yDoc);
  // Seed the local state with the standard user block so other clients can
  // dedupe and render avatars before the extension publishes anything.
  awareness.setLocalState({ user });

  // Forward local awareness changes -> DocumentSync wire.
  // We listen to the 'update' event so we catch every state change (including
  // field changes via setLocalStateField). The origin guard prevents the echo
  // when we inject remote state below.
  const localUpdateHandler = (
    _changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    if (origin === REMOTE_AWARENESS_ORIGIN) return;
    const state = awareness.getLocalState();
    if (state) {
      syncProvider.setLocalAwareness(state as WireAwarenessState);
    }
  };
  awareness.on('update', localUpdateHandler);

  // Map remote userIds (string) to stable numeric clientIDs in our Awareness.
  // Never reuse our own awareness.clientID for a remote user.
  const userIdToClientId = new Map<string, number>();
  let nextRemoteClientId = awareness.clientID + 1;
  const allocateClientId = (userId: string): number => {
    const existing = userIdToClientId.get(userId);
    if (existing !== undefined) return existing;
    // Skip past our own clientID if we collide.
    while (nextRemoteClientId === awareness.clientID) nextRemoteClientId++;
    const id = nextRemoteClientId++;
    userIdToClientId.set(userId, id);
    return id;
  };

  // Receive remote awareness from DocumentSync -> inject into Awareness.
  const awarenessUnsub = syncProvider.onAwarenessChange((states) => {
    const presentClientIds = new Set<number>();
    const added: number[] = [];
    const updated: number[] = [];

    for (const [userId, state] of states) {
      const clientId = allocateClientId(userId);
      presentClientIds.add(clientId);
      const wasPresent = awareness.states.has(clientId);
      // Ensure remote state carries `user.id` so SDK consumers can use it
      // for deduping; the DocumentSync wrapper provides userId out-of-band.
      const stateWithId = {
        ...(state as Record<string, unknown>),
        user: {
          ...(state.user as { name: string; color: string }),
          id: (state.user as { id?: string }).id ?? userId,
        },
      };
      awareness.states.set(clientId, stateWithId);
      const prevMeta = awareness.meta.get(clientId);
      awareness.meta.set(clientId, {
        clock: (prevMeta?.clock ?? 0) + 1,
        lastUpdated: Date.now(),
      });
      if (wasPresent) updated.push(clientId);
      else added.push(clientId);
    }

    // Anyone in our remote map but missing from the broadcast has gone away.
    const removed: number[] = [];
    for (const clientId of awareness.states.keys()) {
      if (clientId === awareness.clientID) continue;
      if (presentClientIds.has(clientId)) continue;
      awareness.states.delete(clientId);
      removed.push(clientId);
    }

    if (added.length === 0 && updated.length === 0 && removed.length === 0) {
      return;
    }
    const event = { added, updated, removed };
    awareness.emit('change', [event, REMOTE_AWARENESS_ORIGIN]);
    awareness.emit('update', [event, REMOTE_AWARENESS_ORIGIN]);
  });

  return {
    awareness,
    destroy: () => {
      awarenessUnsub();
      awareness.off('update', localUpdateHandler);
      awareness.destroy();
    },
  };
}
