import { useEffect, useRef } from 'react';
import { useTabs } from '../contexts/TabsContext';
import { resolveRepresentedFile } from '../utils/representedFile';

/**
 * #1375: Push the window's represented file (AXDocument) to the main process.
 *
 * Call from a component that stays mounted for as long as it could own the
 * window's identity. Agent mode unmounts its editor tabs in the
 * transcript-only layout, and an unmounted component cannot clear what it set.
 *
 * `isActive` marks the owner. The memo of what was last sent resets when this
 * instance goes inactive, so the next activation re-asserts its own file
 * rather than trusting what another owner left behind.
 */
export function usePushRepresentedFile(isActive: boolean, filePath: string | null): void {
    const lastSentRef = useRef<string | null | undefined>(undefined);

    useEffect(() => {
        if (!isActive) {
            lastSentRef.current = undefined;
            return;
        }
        if (filePath === lastSentRef.current) return;

        lastSentRef.current = filePath;
        window.electronAPI?.setRepresentedFile?.(filePath);
    }, [isActive, filePath]);
}

/**
 * Represent the active tab of the surrounding TabsProvider. For editor-mode
 * style hosts, whose tabs and visibility live and die together.
 */
export function useRepresentedFileSync(isActive: boolean): void {
    const { activeTab } = useTabs();
    usePushRepresentedFile(isActive, resolveRepresentedFile(activeTab?.filePath));
}
