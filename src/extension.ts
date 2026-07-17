import * as path from 'path';
import * as vscode from 'vscode';
import { normalizeInputForFs, stripSurroundingQuotes } from './pathUtils';
import * as fsNode from 'fs';

type FileQuickPickItem = vscode.QuickPickItem & {
  uri: vscode.Uri;
  entryKind?: WorkspaceItemKind;
  alwaysShow?: boolean;
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

type WorkspaceSearchCache = {
  key: string;
  entries?: WorkspaceItemEntry[];
  indexPromise?: Promise<WorkspaceItemEntry[]>;
};

const liveSearchDebounceMilliseconds = 150;
const workspaceIndexRefreshDebounceMilliseconds = 400;
const quickPickResultLimit = 200;

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

let workspaceSearchCache: WorkspaceSearchCache | undefined;
const workspaceSearchCacheDidRefresh = new vscode.EventEmitter<void>();

export function activate(context: vscode.ExtensionContext): void {
  const workspaceFileSystemWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  const scheduleWorkspaceSearchCacheRefresh = createWorkspaceSearchCacheRefreshScheduler();

  context.subscriptions.push(
    vscode.commands.registerCommand('tabFileFinder.searchOpenFiles', searchOpenFiles),
    vscode.commands.registerCommand('tabFileFinder.searchWorkspaceFiles', searchWorkspaceFiles),
    workspaceFileSystemWatcher,
    workspaceFileSystemWatcher.onDidCreate(scheduleWorkspaceSearchCacheRefresh),
    workspaceFileSystemWatcher.onDidDelete(scheduleWorkspaceSearchCacheRefresh),
    vscode.workspace.onDidChangeWorkspaceFolders(refreshWorkspaceSearchCache),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('tabFileFinder')) {
        refreshWorkspaceSearchCache();
      }
    }),
    workspaceSearchCacheDidRefresh
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
  quickPick.placeholder = 'Indexing workspace...';
  quickPick.matchOnDescription = true;
  quickPick.ignoreFocusOut = false;
  quickPick.busy = true;
  quickPick.items = [];
  quickPick.show();

  let quickPickDisposed = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let filterVersion = 0;
  let indexRefreshVersion = 0;
  let resolveVersion = 0;
  let lastResolvePromise: Promise<void> | undefined;
  let exactResolvedItems: FileQuickPickItem[] | undefined;
  let isOpening = false;
  let indexedEntries: WorkspaceItemEntry[] = [];
  let indexReady = false;

  const showSearchResults = (entries: WorkspaceItemEntry[], value: string) => {
    if (quickPickDisposed) {
      return;
    }

    const normalizedKeyword = value.trim().toLowerCase();
    const workspaceItems = limitQuickPickItemsForSafety(
      getWorkspaceSearchItems(entries, normalizedKeyword, settings),
      getQuickPickResultLimit(settings)
    );

    // If we have exact-resolved path items, merge them at the front and ensure alwaysShow
    if (exactResolvedItems && exactResolvedItems.length > 0) {
      exactResolvedItems = exactResolvedItems.map((it) => ({ ...it, alwaysShow: true }));
      const merged = [...exactResolvedItems, ...workspaceItems.filter((w) => !exactResolvedItems!.some((e) => e.uri.fsPath === (w as any).uri?.fsPath))];
      quickPick.items = limitQuickPickItemsForSafety(merged as FileQuickPickItem[], getQuickPickResultLimit(settings));
    } else {
      quickPick.items = workspaceItems;
    }
  };

  const runFilter = (value: string, version: number) => {
    if (quickPickDisposed || version !== filterVersion || !indexReady) {
      return;
    }

    if (value.trim().length === 0) {
      // If there's an exact resolved item (e.g. user pasted a full path), show it even when no fuzzy keyword
      if (exactResolvedItems && exactResolvedItems.length > 0) {
        quickPick.items = limitQuickPickItemsForSafety(exactResolvedItems, getQuickPickResultLimit(settings));
        return;
      }

      quickPick.items = [];
      return;
    }

    showSearchResults(indexedEntries, value);
  };

  const scheduleFilter = (value: string) => {
    const currentFilterVersion = ++filterVersion;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      runFilter(value, currentFilterVersion);
    }, liveSearchDebounceMilliseconds);
  };

  async function tryResolveExact(value: string, myResolveVersion: number) {
    exactResolvedItems = undefined;
    if (quickPickDisposed) return;

    const raw = stripSurroundingQuotes(value.trim());
    if (raw.length === 0) return;

    // Only attempt exact resolution when input looks like a path or file URI
    const looksLikePath = /(^~)|(^file:\/\/)|[\\\/]/.test(raw) || path.isAbsolute(normalizeInputForFs(raw));
    if (!looksLikePath) return;

    quickPick.busy = true;
    try {
      const fsPath = normalizeInputForFs(raw);
      const candidates: vscode.Uri[] = [];

      // file:// or absolute path
      if (path.isAbsolute(fsPath)) {
        const uri = vscode.Uri.file(fsPath);
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.type & vscode.FileType.File) {
            candidates.push(uri);
          } else if (stat.type & vscode.FileType.Directory) {
            candidates.push(uri);
          }
        } catch {
          // fallback to Node fs existence check
          try {
            if (fsNode.existsSync(fsPath)) {
              candidates.push(uri);
            }
          } catch {
            // ignore
          }
        }
      }

      // workspace-relative: try each workspace folder
      if (candidates.length === 0) {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
          const joined = path.join(folder.uri.fsPath, fsPath);
          const uri = vscode.Uri.file(joined);
          try {
            const stat = await vscode.workspace.fs.stat(uri);
            candidates.push(uri);
          } catch {
            // fallback to Node fs
            try {
              if (fsNode.existsSync(joined)) {
                candidates.push(uri);
              }
            } catch {}
          }
        }
      }

      // If we have candidates and this resolve is still current, show them
      if (quickPickDisposed || myResolveVersion !== resolveVersion) {
        return;
      }

      if (candidates.length > 0) {
        exactResolvedItems = candidates.map((uri) => {
          const fullPath = normalizeInputForFs(uri.fsPath);
          const item: FileQuickPickItem = {
            label: path.basename(uri.fsPath),
            description: fullPath,
            uri,
            alwaysShow: true
          };
          return item;
        });

        // Prefer showing exact matches first, but keep existing fuzzy items after
        const existing = quickPick.items ?? [];
        const merged = [...exactResolvedItems, ...existing.filter((ex) => !exactResolvedItems?.some((e) => e.uri.fsPath === (ex as any).uri?.fsPath))];
        quickPick.items = limitQuickPickItemsForSafety(merged as FileQuickPickItem[], getQuickPickResultLimit(settings));
      }
    } finally {
      if (!quickPickDisposed) quickPick.busy = false;
    }
  }

  const disposables: vscode.Disposable[] = [];
    disposables.push(
    quickPick.onDidChangeValue((value) => {
      // kick off exact-path resolve; it uses resolveVersion to ignore stale results
      const myResolveVersion = ++resolveVersion;
      lastResolvePromise = tryResolveExact(value, myResolveVersion);
      scheduleFilter(value);
    }),
    workspaceSearchCacheDidRefresh.event(() => {
      void refreshIndex();
    }),
    quickPick.onDidAccept(async () => {
      if (quickPickDisposed) return;
      if (isOpening) return;
      isOpening = true;

      try {
        // if an exact resolve is in flight, wait for it
        const pending = lastResolvePromise;
        if (pending) {
          await pending;
        }

        const picked = quickPick.selectedItems[0] ?? quickPick.activeItems[0] ?? quickPick.items[0];
        if (!picked) {
          vscode.window.showInformationMessage('No item selected to open.');
          return;
        }

        try {
          if (picked.entryKind === 'folder') {
            await vscode.commands.executeCommand('revealInExplorer', picked.uri);
          } else {
            await vscode.window.showTextDocument(picked.uri, { preview: false });
          }
          quickPick.hide();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Unable to open item: ${message}`);
          // keep picker open
        }
      } finally {
        isOpening = false;
      }
    }),
    quickPick.onDidHide(() => {
      quickPickDisposed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      disposables.forEach((disposable) => disposable.dispose());
      quickPick.dispose();
    })
  );

  const refreshIndex = async () => {
    const currentRefreshVersion = ++indexRefreshVersion;

    if (!quickPickDisposed) {
      indexReady = false;
      quickPick.busy = true;
    }

    try {
      const entries = await getWorkspaceItemEntries(settings);

      if (quickPickDisposed || currentRefreshVersion !== indexRefreshVersion) {
        return;
      }

      indexedEntries = entries;
      indexReady = true;

      quickPick.busy = false;
      quickPick.placeholder = 'Type to search files and folders...';
      scheduleFilter(quickPick.value);
    } catch (error) {
      if (quickPickDisposed || currentRefreshVersion !== indexRefreshVersion) {
        return;
      }

      quickPick.busy = false;
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Unable to index workspace files: ${message}`);
    }
  };

  void refreshIndex();
}

function clearWorkspaceSearchCache(): void {
  workspaceSearchCache = undefined;
}

function refreshWorkspaceSearchCache(): void {
  clearWorkspaceSearchCache();
  workspaceSearchCacheDidRefresh.fire();
}

function createWorkspaceSearchCacheRefreshScheduler(): (uri: vscode.Uri) => void {
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  return () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      refreshWorkspaceSearchCache();
    }, workspaceIndexRefreshDebounceMilliseconds);
  };
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

function getWorkspaceSearchItems(
  entries: WorkspaceItemEntry[],
  normalizedKeyword: string,
  settings: WorkspaceSearchSettings
): FileQuickPickItem[] {
  const matchedEntries = entries
    .filter((entry) => shouldIncludeWorkspaceItem(entry.kind, settings))
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
  const cacheKey = getWorkspaceSearchCacheKey(settings);
  if (workspaceSearchCache?.key === cacheKey) {
    if (workspaceSearchCache.entries) {
      return workspaceSearchCache.entries;
    }

    if (workspaceSearchCache.indexPromise) {
      return workspaceSearchCache.indexPromise;
    }
  }

  const indexPromise = collectWorkspaceItemEntryCache(settings);
  workspaceSearchCache = {
    key: cacheKey,
    indexPromise
  };

  try {
    const entries = await indexPromise;
    if (workspaceSearchCache?.key === cacheKey && workspaceSearchCache.indexPromise === indexPromise) {
      workspaceSearchCache = {
        key: cacheKey,
        entries
      };
    }
    return entries;
  } catch (error) {
    if (workspaceSearchCache?.key === cacheKey && workspaceSearchCache.indexPromise === indexPromise) {
      clearWorkspaceSearchCache();
    }
    throw error;
  }
}

async function collectWorkspaceItemEntryCache(settings: WorkspaceSearchSettings): Promise<WorkspaceItemEntry[]> {
  const results: WorkspaceItemEntry[] = [];
  const excludeGlob = getWorkspaceFindFilesExcludeGlob(settings);
  const candidateUris = await vscode.workspace.findFiles('**/*', excludeGlob);

  for (const uri of candidateUris) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      continue;
    }

    const relativePath = normalizeRelativePath(toRelativePath(uri, folder));
    if (isExcludedFilePath(relativePath, settings) || (!settings.showGeneratedFiles && isGeneratedFilePath(relativePath))) {
      continue;
    }

    results.push(createWorkspaceItemEntry(uri, folder, 'file'));
    collectFolderEntriesFromFilePath(uri, folder, settings, results);
  }

  return getUniqueWorkspaceItemEntries(results);
}

function getUniqueWorkspaceItemEntries(entries: WorkspaceItemEntry[]): WorkspaceItemEntry[] {
  const entriesByPath = new Map<string, WorkspaceItemEntry>();

  for (const entry of entries) {
    if (!entriesByPath.has(entry.uri.fsPath)) {
      entriesByPath.set(entry.uri.fsPath, entry);
    }
  }

  return [...entriesByPath.values()];
}

function getWorkspaceSearchCacheKey(settings: WorkspaceSearchSettings): string {
  const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map((folder) =>
    normalizeRelativePath(folder.uri.fsPath).toLowerCase()
  );

  return JSON.stringify({
    workspaceFolders,
    excludeFolders: settings.excludeFolders.map((folder) => normalizeRelativePath(folder).toLowerCase()),
    excludeFiles: settings.excludeFiles.map((file) => normalizeRelativePath(file).toLowerCase()),
    showGeneratedFiles: settings.showGeneratedFiles
  });
}

function collectFolderEntriesFromFilePath(
  fileUri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder,
  settings: WorkspaceSearchSettings,
  results: WorkspaceItemEntry[]
): void {
  const relativeFilePath = normalizeRelativePath(toRelativePath(fileUri, workspaceFolder));
  const pathParts = relativeFilePath.split('/').slice(0, -1);

  for (let index = 0; index < pathParts.length; index += 1) {
    const folderRelativePath = pathParts.slice(0, index + 1).join('/');

    if (isExcludedDirectoryPath(folderRelativePath, settings)) {
      continue;
    }

    const folderUri = vscode.Uri.joinPath(workspaceFolder.uri, ...pathParts.slice(0, index + 1));
    results.push(createWorkspaceItemEntry(folderUri, workspaceFolder, 'folder'));
  }
}

function getWorkspaceFindFilesExcludeGlob(settings: WorkspaceSearchSettings): string {
  const excludedFolders = [
    ...settings.excludeFolders,
    ...(settings.showGeneratedFiles ? [] : defaultGeneratedFolders)
  ]
    .map((folder) => normalizeRelativePath(folder).replace(/^\/+|\/+$/g, ''))
    .filter((folder) => folder.length > 0);

  const folderExcludes = excludedFolders.map((folder) =>
    folder.includes('/') ? `${escapeGlobPattern(folder)}/**` : `**/${escapeGlobPattern(folder)}/**`
  );

  const fileExcludes = settings.excludeFiles
    .map((file) => normalizeRelativePath(file).replace(/^\/+/, ''))
    .filter((file) => file.length > 0)
    .map((file) => (file.includes('/') ? file : `**/${file}`));

  const generatedFileExcludes = settings.showGeneratedFiles ? [] : [
    '**/*.vsix',
    '**/*.min.css',
    '**/*.min.js',
    '**/*.map',
    '**/*.d.ts',
    '**/package-lock.json',
    '**/yarn.lock',
    '**/pnpm-lock.yaml',
    '**/*_files/libs/**',
    '**/*_files/quarto-html/**'
  ];

  return `{${[...folderExcludes, ...fileExcludes, ...generatedFileExcludes].join(',')}}`;
}

function escapeGlobPattern(value: string): string {
  return normalizeRelativePath(value).replace(/[{}[\]\\]/g, (character) => `[${character}]`);
}

function getQuickPickResultLimit(settings: WorkspaceSearchSettings): number {
  return Math.min(settings.maxResults, quickPickResultLimit);
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
