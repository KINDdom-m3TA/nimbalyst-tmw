/**
 * Attach and detach folders on a multi-root workspace.
 *
 * Single place the renderer calls into the attach/detach IPC, so every entry
 * point (explorer context menu, File menu, command palette, Finder drag-drop)
 * gets the same folder picker, the same trust prompt, and the same failure
 * messages. The main process broadcasts `workspace:folders-changed`, which
 * `fileTreeListeners` turns into the updated explorer forest -- callers do not
 * update the tree themselves.
 */

export interface AttachFolderOutcome {
  success: boolean;
  /** Absolute path the user chose, absent when they cancelled the picker. */
  folderPath?: string;
  error?: string;
}

/** Last path segment, for naming the project in the picker's message. */
function folderName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
}

/**
 * Prompt for a folder and attach it to `workspacePath`.
 *
 * There is no separate trust prompt: an attached folder is part of the
 * workspace, and agent permissions are resolved from the session's workspace --
 * the primary root -- so it inherits that project's trust level rather than
 * getting one of its own. The picker says so, because granting an agent access
 * to another folder on disk should not be a silent consequence.
 *
 * Returns `{ success: false }` with no error when the user cancels the picker,
 * so callers can distinguish "changed their mind" from "attach failed".
 */
export async function attachWorkspaceFolderWithPicker(
  workspacePath: string,
): Promise<AttachFolderOutcome> {
  const picked = await window.electronAPI?.invoke?.('dialog:openDirectory', {
    title: 'Attach Folder to Workspace',
    buttonLabel: 'Attach',
    message:
      `The folder you attach gets the same agent trust level as "${folderName(workspacePath)}", `
      + 'and agents in this project will be able to read and write it.',
  });

  const folderPath = picked?.canceled ? undefined : picked?.filePaths?.[0];
  if (!folderPath) {
    return { success: false };
  }

  return attachWorkspaceFolder(workspacePath, folderPath);
}

/** Attach a known folder path, skipping the picker (drag-drop, command args). */
export async function attachWorkspaceFolder(
  workspacePath: string,
  folderPath: string,
): Promise<AttachFolderOutcome> {
  try {
    const result = await window.electronAPI?.invoke?.('workspace:attach-folder', {
      workspacePath,
      folderPath,
    });
    if (!result?.success) {
      return { success: false, folderPath, error: result?.error ?? 'Failed to attach folder' };
    }
    return { success: true, folderPath };
  } catch (error) {
    console.error('[workspaceFolders] attach failed:', error);
    return {
      success: false,
      folderPath,
      error: error instanceof Error ? error.message : 'Failed to attach folder',
    };
  }
}

export async function detachWorkspaceFolder(
  workspacePath: string,
  folderPath: string,
): Promise<boolean> {
  try {
    const result = await window.electronAPI?.invoke?.('workspace:detach-folder', {
      workspacePath,
      folderPath,
    });
    return result?.success === true;
  } catch (error) {
    console.error('[workspaceFolders] detach failed:', error);
    return false;
  }
}
