export interface FileDirectoryNode<T> {
  path: string;
  displayPath: string;
  files: T[];
  subdirectories: Map<string, FileDirectoryNode<T>>;
  fileCount: number;
}

/** Normalize filesystem separators for renderer-side path comparison and display. */
export function normalizeFilePath(filePath: string): string {
  return filePath.replace(/[\\/]+/g, '/');
}

export function getFilePathBasename(filePath: string): string {
  const normalizedPath = normalizeFilePath(filePath).replace(/\/+$/, '');
  return normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1);
}

/** Relative to one root, or null when the file is not inside it. */
function relativeToRoot(normalizedFile: string, rootPath: string): string | null {
  const normalizedRoot = normalizeFilePath(rootPath).replace(/\/$/, '');
  if (!normalizedRoot) return null;

  const windowsDrivePath = /^[A-Za-z]:\//.test(normalizedFile)
    && /^[A-Za-z]:\//.test(normalizedRoot);
  const comparableFile = windowsDrivePath ? normalizedFile.toLowerCase() : normalizedFile;
  const comparableRoot = windowsDrivePath ? normalizedRoot.toLowerCase() : normalizedRoot;

  if (comparableFile === comparableRoot) return '';
  if (comparableFile.startsWith(`${comparableRoot}/`)) {
    return normalizedFile.slice(normalizedRoot.length + 1);
  }
  return null;
}

/**
 * Return a forward-slash path relative to the workspace when the file is inside it.
 * Windows drive paths are compared case-insensitively to match filesystem behavior.
 *
 * A multi-root workspace passes every root, primary first. The primary root
 * still yields a bare relative path, so a single-folder workspace is unchanged;
 * a file in an attached root is prefixed with that root's folder name, which is
 * what groups it under its own heading in the directory tree instead of
 * spelling out an absolute path. Deepest matching root wins, so a root checked
 * out inside another root keeps its own prefix.
 */
export function getWorkspaceRelativeFilePath(
  filePath: string,
  workspacePath?: string | string[],
): string {
  const normalizedFile = normalizeFilePath(filePath);
  const roots = typeof workspacePath === 'string' ? [workspacePath] : workspacePath;
  if (!roots || roots.length === 0) return normalizedFile;

  let bestIndex = -1;
  let bestRelative: string | null = null;
  let bestRootLength = -1;
  roots.forEach((rootPath, index) => {
    const relative = relativeToRoot(normalizedFile, rootPath);
    if (relative === null) return;
    const rootLength = normalizeFilePath(rootPath).replace(/\/$/, '').length;
    if (rootLength <= bestRootLength) return;
    bestIndex = index;
    bestRelative = relative;
    bestRootLength = rootLength;
  });

  if (bestRelative === null) return normalizedFile;
  if (bestIndex === 0) return bestRelative;

  // Attached root: name it, so two files called `src/index.ts` in two repos do
  // not collapse into one directory group.
  return `${getFilePathBasename(roots[bestIndex])}/${bestRelative}`;
}

function collapseDirectoryTree<T>(node: FileDirectoryNode<T>): FileDirectoryNode<T> {
  node.subdirectories.forEach((subdirectory, key) => {
    node.subdirectories.set(key, collapseDirectoryTree(subdirectory));
  });

  if (node.subdirectories.size === 1 && node.files.length === 0) {
    const childNode = node.subdirectories.values().next().value as FileDirectoryNode<T>;
    return {
      ...childNode,
      displayPath: node.displayPath
        ? `${node.displayPath}/${childNode.displayPath}`
        : childNode.displayPath,
    };
  }

  return node;
}

function updateFileCounts<T>(node: FileDirectoryNode<T>): number {
  let count = node.files.length;
  node.subdirectories.forEach(subdirectory => {
    count += updateFileCounts(subdirectory);
  });
  node.fileCount = count;
  return count;
}

/** Build a collapsed directory tree for arbitrary file records. */
export function buildFileDirectoryTree<T>(
  files: T[],
  getFilePath: (file: T) => string,
  workspacePath?: string | string[],
): FileDirectoryNode<T> {
  const root: FileDirectoryNode<T> = {
    path: '',
    displayPath: '',
    files: [],
    subdirectories: new Map(),
    fileCount: 0,
  };

  files.forEach(file => {
    const relativePath = getWorkspaceRelativeFilePath(getFilePath(file), workspacePath);
    const parts = relativePath.split('/').filter(Boolean);

    if (parts.length <= 1) {
      root.files.push(file);
      return;
    }

    let currentNode = root;
    const directoryParts = parts.slice(0, -1);
    directoryParts.forEach((part, index) => {
      const path = directoryParts.slice(0, index + 1).join('/');
      let childNode = currentNode.subdirectories.get(part);
      if (!childNode) {
        childNode = {
          path,
          displayPath: part,
          files: [],
          subdirectories: new Map(),
          fileCount: 0,
        };
        currentNode.subdirectories.set(part, childNode);
      }
      currentNode = childNode;
    });
    currentNode.files.push(file);
  });

  updateFileCounts(root);
  return collapseDirectoryTree(root);
}

export function getFileDirectoryPaths<T>(node: FileDirectoryNode<T>): string[] {
  const paths = node.path ? [node.path] : [];
  node.subdirectories.forEach(subdirectory => {
    paths.push(...getFileDirectoryPaths(subdirectory));
  });
  return paths;
}
