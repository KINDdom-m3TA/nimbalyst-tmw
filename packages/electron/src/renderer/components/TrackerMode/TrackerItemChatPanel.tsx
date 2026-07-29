/**
 * "Chat" mode of the tracker document view's right panel: an AI chat scoped to
 * the tracker item you're reading.
 *
 * The chat surface is the ordinary `ChatSidebar` -- no second chat stack. This
 * component only chooses the initial session: a remembered/linked session wins
 * when one exists; otherwise ChatSidebar follows its normal behavior and
 * selects the latest chat or creates one. Its standard session dropdown remains
 * available for creating or selecting any other conversation.
 */

import React, { useCallback, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { trackerItemByIdAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { ChatSidebar } from '../ChatSidebar/ChatSidebar';
import { sessionRegistryAtom } from '../../store/atoms/sessions';
import {
  setTrackerDocumentChatSessionAtom,
  trackerModeLayoutAtom,
} from '../../store/atoms/trackers';
import { resolveLinkedSessions } from '../../utils/resolveLinkedSessions';
import { buildTrackerChatContext, resolveTrackerChatSessionId } from './trackerDocumentChat';

interface TrackerItemChatPanelProps {
  itemId: string;
  workspacePath: string;
  /** The panel is visible and the standard sidebar may initialize. */
  isActive: boolean;
  onFileOpen?: (filePath: string) => Promise<void> | void;
  onSwitchToAgentMode?: (sessionId?: string) => void;
}

export const TrackerItemChatPanel: React.FC<TrackerItemChatPanelProps> = ({
  itemId,
  workspacePath,
  isActive,
  onFileOpen,
  onSwitchToAgentMode,
}) => {
  const item = useAtomValue(trackerItemByIdAtom(itemId));
  const sessionRegistry = useAtomValue(sessionRegistryAtom);
  const modeLayout = useAtomValue(trackerModeLayoutAtom);
  const setChatSession = useSetAtom(setTrackerDocumentChatSessionAtom);

  const chatContext = useMemo(() => buildTrackerChatContext(itemId, item), [itemId, item]);

  const linkedSessions = useMemo(
    () => resolveLinkedSessions(item, sessionRegistry),
    [item, sessionRegistry],
  );

  const sessionId = useMemo(() => resolveTrackerChatSessionId({
    pairedSessionId: modeLayout.documentChatSessions[itemId],
    linkedSessions,
    sessionRegistry,
  }), [itemId, linkedSessions, modeLayout.documentChatSessions, sessionRegistry]);

  const handleSessionIdChange = useCallback((nextSessionId: string | null) => {
    setChatSession({ itemId, sessionId: nextSessionId });
  }, [itemId, setChatSession]);

  return (
    <div className="tracker-item-chat-panel flex h-full min-h-0 flex-col" data-testid="tracker-item-chat">
      <ChatSidebar
        workspacePath={workspacePath}
        isActive={isActive}
        sessionId={sessionId}
        onSessionIdChange={handleSessionIdChange}
        autoInitializeSession={!sessionId}
        newSessionTitle={chatContext.sessionTitle}
        newSessionDraft={chatContext.draftInput}
        onFileOpen={onFileOpen}
        onSwitchToAgentMode={onSwitchToAgentMode}
      />
    </div>
  );
};
