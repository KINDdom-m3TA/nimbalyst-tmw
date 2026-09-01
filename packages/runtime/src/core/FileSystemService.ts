/**
 * Platform-agnostic file system service interface
 */

export interface FileSearchOptions {
  path?: string;
  filePattern?: string;
  caseSensitive?: boolean;
  maxResults?: number;
}

export interface FileSearchResult {
  file: string;
  line: number;
  content: string;
}

export interface FileListOptions {
  path?: string;
  pattern?: string;
  recursive?: boolean;
  includeHidden?: boolean;
  maxDepth?: number;
}

export interface FileInfo {
  path: string;
  name?: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
}

export interface FileReadOptions {
  encoding?: 'utf-8' | 'ascii' | 'base64' | 'hex' | 'latin1';
}

export interface FileSystemService {
  /**
   * Get the current workspace path
   */
  getWorkspacePath(): string | null;

  /**
   * Search for files containing specific text
   */
  searchFiles(query: string, options?: FileSearchOptions): Promise<{
    success: boolean;
    results?: FileSearchResult[];
    totalResults?: number;
    error?: string;
  }>;

  /**
   * List files and directories
   */
  listFiles(options?: FileListOptions): Promise<{
    success: boolean;
    files?: FileInfo[];
    error?: string;
  }>;

  /**
   * Read file contents
   */
  readFile(path: string, options?: FileReadOptions): Promise<{
    success: boolean;
    content?: string;
    size?: number;
    truncated?: boolean;
    error?: string;
  }>;
}

// Registry for file system service.
//
// Two-tier registry:
//
// - The legacy global slot (`fileSystemService`) holds the service for the
//   currently-visible workspace and is kept around for callers that
//   genuinely have no workspace context (older single-project paths,
//   embedded UI surfaces).
// - The per-path map (`fileSystemServicesByPath`) holds every warm rail
//   workspace's service. Callers that DO know which workspace they are
//   acting on (chiefly the AI tool dispatcher running an inactive rail
//   project's session) must resolve via this map so cross-workspace
//   leaks via the global are impossible.
let fileSystemService: FileSystemService | null = null;
const fileSystemServicesByPath = new Map<string, FileSystemService>();

export function setFileSystemService(service: FileSystemService): void {
  fileSystemService = service;
}

export function getFileSystemService(): FileSystemService | null {
  return fileSystemService;
}

export function clearFileSystemService(): void {
  fileSystemService = null;
}

export function setFileSystemServiceFor(workspacePath: string, service: FileSystemService): void {
  fileSystemServicesByPath.set(workspacePath, service);
}

export function getFileSystemServiceFor(workspacePath: string): FileSystemService | null {
  return fileSystemServicesByPath.get(workspacePath) ?? null;
}

/**
 * Resolve the service whose root owns an absolute file path.
 *
 * A multi-root workspace registers a service per root -- the primary root and
 * every attached folder -- so an absolute path into an attached folder must
 * resolve to that folder's service, not to the primary root's (which does not
 * contain the file) and not to the global (which points at whatever workspace
 * is visible). Deepest matching root wins, so a root nested inside another is
 * attributed to the nearer one.
 *
 * Returns null for a relative path or one outside every registered root.
 */
export function getFileSystemServiceForPath(filePath: string): FileSystemService | null {
  if (!filePath || !filePath.startsWith('/')) {
    return null;
  }

  let bestRoot: string | null = null;
  for (const root of fileSystemServicesByPath.keys()) {
    if (filePath === root || filePath.startsWith(root.endsWith('/') ? root : root + '/')) {
      if (!bestRoot || root.length > bestRoot.length) {
        bestRoot = root;
      }
    }
  }

  return bestRoot ? (fileSystemServicesByPath.get(bestRoot) ?? null) : null;
}

export function clearFileSystemServiceFor(workspacePath: string): void {
  fileSystemServicesByPath.delete(workspacePath);
}