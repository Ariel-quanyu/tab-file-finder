import * as path from 'path';
import * as vscode from 'vscode';

type FileQuickPickItem = vscode.QuickPickItem & {
  uri: vscode.Uri;
  entryKind?: WorkspaceItemKind;
};

type WorkspaceItemKind = 'file' | 'folder';

type WorkspaceItemEntry = {
  uri: vscode.Uri;
  kind: WorkspaceItemKind;
  itemName: string;
  itemNameLower: string;
  relativePath: string;
  relativePathLower: string;
};

type SearchMode = 'filesAndFolders' | 'filesOnly' | 'foldersOnly';

type WorkspaceSearchSettings = {
  includeFiles: boolean;
  includeFolders: boolean;
  excludeFolders: string[];
  excludeFiles: string[];
  maxResults: number;
  showGeneratedFiles: boolean;
  searchMode: SearchMode;
};

const defaultExcludedFolders = [
  'node_modules',
  '.git',
  'out',
  'dist',
  'build',
  '.quarto',
  '__pycache__'
];

const defaultExcludedFiles = [
  '*.vsix'
];

const defaultGeneratedFolders = [
  ...defaultExcludedFolders,
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'coverage',
  'vendor'
];

const generatedFileNamePatterns = [
  /\.vsix$/i,
  /\.min\.(?:css|js)$/i,
  /\.map$/i,
  /\.d\.ts$/i,
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.yaml$/i
];

const generatedRelativePathPatterns = [
  /(^|\/)[^/]*_files\/(?:libs|quarto-html)(\/|$)/i,
  /(^|\/)[^/]*_files\/.*\.(?:js|css|html|json|png|svg|woff2?|ttf|map)$/i
];

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('tabFileFinder.searchOpenFiles', searchOpenFiles),
    vscode.commands.registerCommand('tabFileFinder.searchWorkspaceFiles', searchWorkspaceFiles)
  );
}

export function deactivate(): void {
  // No-op
}

async function searchOpenFiles(): Promise<void> {
  const keyword = await promptForKeyword('Search open files by name or path');
  if (keyword === undefined) {
    return;
  }

  const normalizedKeyword = keyword.trim().toLowerCase();
  const workspaceFolder = getPrimaryWorkspaceFolder();

  const openDocuments = vscode.workspace.textDocuments
    .filter((doc) => doc.uri.scheme === 'file')
    .map((doc) => doc.uri);

  const seen = new Set<string>();
  const uniqueUris = openDocuments.filter((uri) => {
    const key = uri.fsPath;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  const filteredUris = uniqueUris.filter((uri) => {
    const relativePath = workspaceFolder ? toRelativePath(uri, workspaceFolder) : path.basename(uri.fsPath);
    const fileName = path.basename(uri.fsPath);
    const haystack = `${fileName} ${relativePath}`.toLowerCase();
    return normalizedKeyword.length === 0 || haystack.includes(normalizedKeyword);
  });

  await showResultsQuickPick(filteredUris, workspaceFolder, 'No open files matched your search.');
}

async function searchWorkspaceFiles(): Promise<void> {
  const workspaceFolder = getPrimaryWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showInformationMessage('Open a workspace folder to search workspace files.');
    return;
  }

  const quickPick = vscode.window.createQuickPick<FileQuickPickItem>();
  const settings = getWorkspaceSearchSettings();
  quickPick.title = 'Tab File Finder: Search Workspace Files';
  quickPick.placeholder = 'Type a keyword to search workspace files';
  quickPick.matchOnDescription = true;
  quickPick.ignoreFocusOut = false;
  quickPick.busy = true;
  quickPick.items = [];
  quickPick.show();

  const entriesByPath = new Map<string, WorkspaceItemEntry>();
  let quickPickDisposed = false;

  const addEntries = (entries: WorkspaceItemEntry[]) => {
    for (const entry of entries) {
      if (entriesByPath.has(entry.uri.fsPath)) {
        continue;
      }

      entriesByPath.set(entry.uri.fsPath, entry);
    }
  };

  const updateItems = (value: string) => {
    if (quickPickDisposed) {
      return;
    }

    const normalizedKeyword = value.trim().toLowerCase();
    quickPick.items = limitQuickPickItemsForSafety(
      getWorkspaceSearchItems([...entriesByPath.values()], normalizedKeyword),
      settings.maxResults
    );
  };

  const disposables: vscode.Disposable[] = [];
  disposables.push(
    quickPick.onDidChangeValue((value) => updateItems(value)),
    quickPick.onDidAccept(async () => {
      const picked = quickPick.selectedItems[0];
      if (picked) {
        if (picked.entryKind === 'folder') {
          await vscode.commands.executeCommand('revealInExplorer', picked.uri);
        } else {
          await vscode.window.showTextDocument(picked.uri, { preview: false });
        }
        quickPick.hide();
      }
    }),
    quickPick.onDidHide(() => {
      quickPickDisposed = true;
      disposables.forEach((disposable) => disposable.dispose());
      quickPick.dispose();
    })
  );

  void (async () => {
    try {
      addEntries(await getWorkspaceItemEntries(settings));
      updateItems(quickPick.value);
    } catch (error) {
      if (!quickPickDisposed) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Unable to search workspace files: ${message}`);
      }
    } finally {
      if (!quickPickDisposed) {
        quickPick.busy = false;
      }
    }
  })();
}

function isExcludedDirectoryPath(relativePath: string, settings: WorkspaceSearchSettings): boolean {
  const normalizedPath = normalizeRelativePath(relativePath).toLowerCase();
  const excludedDirectories = settings.excludeFolders.map((folder) => normalizeRelativePath(folder).toLowerCase());
  const generatedDirectories = settings.showGeneratedFiles ? [] : defaultGeneratedFolders.map((folder) => folder.toLowerCase());

  if (!settings.showGeneratedFiles && generatedRelativePathPatterns.some((pattern) => pattern.test(normalizedPath))) {
    return true;
  }

  return [...excludedDirectories, ...generatedDirectories].some((excludedDirectory) => {
    const normalizedDirectory = excludedDirectory.replace(/^\/+|\/+$/g, '');

    if (!normalizedDirectory) {
      return false;
    }

    if (normalizedDirectory.includes('/')) {
      return normalizedPath === normalizedDirectory || normalizedPath.startsWith(`${normalizedDirectory}/`);
    }

    return normalizedPath.split('/').includes(normalizedDirectory);
  });
}

function isGeneratedFilePath(relativePath: string): boolean {
  const normalizedPath = normalizeRelativePath(relativePath);
  const fileName = path.basename(normalizedPath);
  return (
    generatedFileNamePatterns.some((pattern) => pattern.test(fileName)) ||
    generatedRelativePathPatterns.some((pattern) => pattern.test(normalizedPath))
  );
}

function isExcludedFilePath(relativePath: string, settings: WorkspaceSearchSettings): boolean {
  const normalizedPath = normalizeRelativePath(relativePath).toLowerCase();
  const fileName = path.basename(normalizedPath);

  return settings.excludeFiles.some((excludeFile) => {
    const normalizedPattern = normalizeRelativePath(excludeFile).toLowerCase().replace(/^\/+/, '');

    if (!normalizedPattern) {
      return false;
    }

    if (normalizedPattern.startsWith('*.')) {
      return fileName.endsWith(normalizedPattern.slice(1));
    }

    if (normalizedPattern.includes('*')) {
      return wildcardPatternToRegExp(normalizedPattern).test(normalizedPath);
    }

    if (normalizedPattern.includes('/')) {
      return normalizedPath === normalizedPattern;
    }

    return fileName === normalizedPattern;
  });
}

function wildcardPatternToRegExp(pattern: string): RegExp {
  const escapedPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escapedPattern}$`, 'i');
}

function shouldIncludeWorkspaceItem(kind: WorkspaceItemKind, settings: WorkspaceSearchSettings): boolean {
  if (kind === 'file') {
    return settings.includeFiles && settings.searchMode !== 'foldersOnly';
  }

  return settings.includeFolders && settings.searchMode !== 'filesOnly';
}

function createWorkspaceItemEntry(
  uri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder,
  kind: WorkspaceItemKind
): WorkspaceItemEntry {
  const relativePath = normalizeRelativePath(toRelativePath(uri, workspaceFolder));
  const itemName = path.basename(uri.fsPath);
  return {
    uri,
    kind,
    itemName,
    itemNameLower: itemName.toLowerCase(),
    relativePath,
    relativePathLower: relativePath.toLowerCase()
  };
}

function getWorkspaceSearchItems(entries: WorkspaceItemEntry[], normalizedKeyword: string): FileQuickPickItem[] {
  const matchedEntries = entries
    .map((entry) => {
      const itemNameIndex = normalizedKeyword.length === 0 ? -1 : entry.itemNameLower.indexOf(normalizedKeyword);
      const pathIndex = normalizedKeyword.length === 0 ? -1 : entry.relativePathLower.indexOf(normalizedKeyword);
      const hasItemNameMatch = itemNameIndex !== -1;
      const hasPathMatch = pathIndex !== -1;
      const hasExactItemNameMatch = normalizedKeyword.length > 0 && entry.itemNameLower === normalizedKeyword;

      return {
        entry,
        exactItemNamePriority: hasExactItemNameMatch ? 0 : 1,
        itemNamePriority: hasItemNameMatch ? 0 : 1,
        pathPriority: hasPathMatch ? 0 : 1,
        itemNameIndex: hasItemNameMatch ? itemNameIndex : Number.MAX_SAFE_INTEGER,
        pathIndex: hasPathMatch ? pathIndex : Number.MAX_SAFE_INTEGER,
        hasItemNameMatch,
        hasPathMatch,
        pathLength: entry.relativePath.length
      };
    })
    .filter((meta) => normalizedKeyword.length === 0 || meta.hasItemNameMatch || meta.hasPathMatch);

  matchedEntries.sort((a, b) => {
    if (a.exactItemNamePriority !== b.exactItemNamePriority) {
      return a.exactItemNamePriority - b.exactItemNamePriority;
    }
    if (a.itemNamePriority !== b.itemNamePriority) {
      return a.itemNamePriority - b.itemNamePriority;
    }
    if (a.itemNameIndex !== b.itemNameIndex) {
      return a.itemNameIndex - b.itemNameIndex;
    }
    if (a.pathPriority !== b.pathPriority) {
      return a.pathPriority - b.pathPriority;
    }
    if (a.pathIndex !== b.pathIndex) {
      return a.pathIndex - b.pathIndex;
    }
    if (a.pathLength !== b.pathLength) {
      return a.pathLength - b.pathLength;
    }
    if (a.entry.kind !== b.entry.kind) {
      return a.entry.kind === 'folder' ? -1 : 1;
    }
    return a.entry.relativePath.localeCompare(b.entry.relativePath);
  });

  return matchedEntries.map((meta) => ({
    label: `${meta.entry.kind === 'folder' ? '📁' : '📄'} ${meta.entry.itemName}`,
    description: meta.entry.relativePath,
    entryKind: meta.entry.kind,
    uri: meta.entry.uri
  }));
}

async function getWorkspaceItemEntries(settings: WorkspaceSearchSettings): Promise<WorkspaceItemEntry[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const results: WorkspaceItemEntry[] = [];

  for (const folder of folders) {
    await collectWorkspaceItemEntries(folder.uri, folder, results, settings);
  }

  return results;
}

async function collectWorkspaceItemEntries(
  directoryUri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder,
  results: WorkspaceItemEntry[],
  settings: WorkspaceSearchSettings
): Promise<void> {
  const children = await vscode.workspace.fs.readDirectory(directoryUri);

  for (const [name, fileType] of children) {
    const childUri = vscode.Uri.joinPath(directoryUri, name);
    const relativePath = normalizeRelativePath(toRelativePath(childUri, workspaceFolder));

    if (fileType === vscode.FileType.Directory) {
      if (isExcludedDirectoryPath(relativePath, settings)) {
        continue;
      }

      if (shouldIncludeWorkspaceItem('folder', settings)) {
        results.push(createWorkspaceItemEntry(childUri, workspaceFolder, 'folder'));
      }

      await collectWorkspaceItemEntries(childUri, workspaceFolder, results, settings);
      continue;
    }

    if (fileType === vscode.FileType.File) {
      if (isExcludedFilePath(relativePath, settings)) {
        continue;
      }

      if (!settings.showGeneratedFiles && isGeneratedFilePath(relativePath)) {
        continue;
      }

      if (shouldIncludeWorkspaceItem('file', settings)) {
        results.push(createWorkspaceItemEntry(childUri, workspaceFolder, 'file'));
      }
    }
  }
}

async function promptForKeyword(placeHolder: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: 'Tab File Finder',
    prompt: 'Type a keyword (e.g. login, auth, tree, src, page). Leave blank to show all results.',
    placeHolder,
    ignoreFocusOut: true
  });
}

async function showResultsQuickPick(
  uris: vscode.Uri[],
  workspaceFolder: vscode.WorkspaceFolder | undefined,
  noResultsMessage: string
): Promise<void> {
  if (uris.length === 0) {
    vscode.window.showInformationMessage(noResultsMessage);
    return;
  }

  const maxResults = getMaxResults();
  const items: FileQuickPickItem[] = limitUrisForSafety(uris, maxResults).map((uri) => ({
    label: path.basename(uri.fsPath),
    description: workspaceFolder ? toRelativePath(uri, workspaceFolder) : toRelativePath(uri),
    uri
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Tab File Finder Results',
    placeHolder: 'Select a file to open',
    matchOnDescription: true,
    ignoreFocusOut: true
  });

  if (!picked) {
    return;
  }

  await vscode.window.showTextDocument(picked.uri, { preview: false });
}

function getPrimaryWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const [folder] = vscode.workspace.workspaceFolders ?? [];
  return folder;
}

function getMaxResults(): number {
  const config = vscode.workspace.getConfiguration('tabFileFinder');
  const value = config.get<number>('maxResults', 1000);
  return clampNumber(value, 10, 1000);
}

function limitQuickPickItemsForSafety(items: FileQuickPickItem[], maxResults: number): FileQuickPickItem[] {
  if (items.length <= maxResults) {
    return items;
  }

  return items.filter((_, index) => index < maxResults);
}

function limitUrisForSafety(uris: vscode.Uri[], maxResults: number): vscode.Uri[] {
  if (uris.length <= maxResults) {
    return uris;
  }

  return uris.filter((_, index) => index < maxResults);
}

function getWorkspaceSearchSettings(): WorkspaceSearchSettings {
  const config = vscode.workspace.getConfiguration('tabFileFinder');
  const searchMode = config.get<SearchMode>('searchMode', 'filesAndFolders');

  return {
    includeFiles: config.get<boolean>('includeFiles', true),
    includeFolders: config.get<boolean>('includeFolders', true),
    excludeFolders: config.get<string[]>('excludeFolders', defaultExcludedFolders),
    excludeFiles: config.get<string[]>('excludeFiles', defaultExcludedFiles),
    maxResults: getMaxResults(),
    showGeneratedFiles: config.get<boolean>('showGeneratedFiles', false),
    searchMode: ['filesAndFolders', 'filesOnly', 'foldersOnly'].includes(searchMode) ? searchMode : 'filesAndFolders'
  };
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.min(Math.max(value, minimum), maximum);
}

function toRelativePath(uri: vscode.Uri, workspaceFolder?: vscode.WorkspaceFolder): string {
  const folder = workspaceFolder ?? vscode.workspace.getWorkspaceFolder(uri);
  return folder ? path.relative(folder.uri.fsPath, uri.fsPath) : path.basename(uri.fsPath);
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/');
}
