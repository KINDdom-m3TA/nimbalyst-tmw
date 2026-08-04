/**
 * Side-effect module: teach this host the reference nodes a desktop client can
 * write into a shared document, before any editor mounts.
 *
 * Without it, opening a document containing a tracker or shared-document
 * reference throws ``Node <type> is not registered`` inside the `@lexical/yjs`
 * observer and the document never paints at all.
 *
 * Read-only by design: the node classes and markdown transformers come from the
 * shared runtime registration, and the tracker chip uses the store-free
 * renderer. Creating or editing references needs the pickers and services this
 * host does not have.
 */

import { registerReferenceNodeContributions } from '@nimbalyst/runtime/plugins/referenceNodeContributions';
import { setTrackerReferenceNodeRenderer } from '@nimbalyst/runtime/plugins/TrackerLinkPlugin/TrackerReferenceNodeRenderer';
import { TrackerReferenceReadOnlyChip } from '@nimbalyst/runtime/plugins/TrackerLinkPlugin/TrackerReferenceReadOnlyChip';
// The document reference is a styled TextNode; its styles ship with the
// interactive plugin, which this host does not load.
import '@nimbalyst/runtime/plugins/DocumentLinkPlugin/DocumentLinkPlugin.css';

registerReferenceNodeContributions();
setTrackerReferenceNodeRenderer(TrackerReferenceReadOnlyChip);
