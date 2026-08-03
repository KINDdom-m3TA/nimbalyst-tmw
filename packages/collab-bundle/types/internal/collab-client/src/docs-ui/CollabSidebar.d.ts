import React from 'react';
export interface CollabSidebarProps {
    activeDocumentId?: string | null;
    /** Open the discovery hub (center pane). Shown as a Home action. */
    onShowHome?: () => void;
    /** Highlight the Home action when the hub is the active surface. */
    homeActive?: boolean;
}
export declare const CollabSidebar: React.FC<CollabSidebarProps>;
