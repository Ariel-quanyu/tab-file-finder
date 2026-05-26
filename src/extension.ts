import * as path from 'path';
import * as vscode from 'vscode';

type FileQuickPickItem = vscode.QuickPickItem & {
  uri: vscode.Uri;
};

type WorkspaceFileEntry = {
  uri: vscode.Uri;
  fileName: string;
  fileNameLower: string;
  relativePath: string;
  relativePathLower: string;
  isUsefulFile: boolean;
};

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
  quickPick.title = 'Tab File Finder: Search Workspace Files';
  quickPick.placeholder = 'Type a keyword to search workspace files';
  quickPick.matchOnDescription = true;
  quickPick.ignoreFocusOut = true;
  quickPick.busy = true;
  quickPick.show();

  const excluded = '**/{node_modules,.git,out,dist,build,.quarto,__pycache__}/**';
  const workspaceUris = await vscode.workspace.findFiles('**/*', excluded);
  const entries = workspaceUris
    .filter((uri) => !isExcludedWorkspaceFile(uri))
    .map((uri) => createWorkspaceFileEntry(uri, workspaceFolder));

  const updateItems = (value: string) => {
    const normalizedKeyword = value.trim().toLowerCase();
    quickPick.items = getWorkspaceSearchItems(entries, normalizedKeyword).slice(0, getMaxResults());
  };

  updateItems('');
  quickPick.busy = false;

  const disposables: vscode.Disposable[] = [];
  disposables.push(
    quickPick.onDidChangeValue((value) => updateItems(value)),
    quickPick.onDidAccept(async () => {
      const picked = quickPick.selectedItems[0];
      if (picked) {
        await vscode.window.showTextDocument(picked.uri, { preview: false });
        quickPick.hide();
      }
    }),
    quickPick.onDidHide(() => {
      disposables.forEach((disposable) => disposable.dispose());
      quickPick.dispose();
    })
  );
}

function isExcludedWorkspaceFile(uri: vscode.Uri): boolean {
  const relativePath = uri.path.toLowerCase();
  if (/(^|\/)(node_modules|\.git|out|dist|build|\.quarto|__pycache__)(\/|$)/.test(relativePath)) {
    return true;
  }

  if (!relativePath.includes('_files')) {
    return false;
  }

  if (/(^|\/)[^\/]*_files\/libs(\/|$)/.test(relativePath)) {
    return true;
  }

  if (/(^|\/)[^\/]*_files\/quarto-html(\/|$)/.test(relativePath)) {
    return true;
  }

  return /\.(js|css|html|json|png|svg|woff2?|ttf|map)$/i.test(relativePath);
}

function createWorkspaceFileEntry(uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder): WorkspaceFileEntry {
  const relativePath = toRelativePath(uri, workspaceFolder);
  const fileName = path.basename(uri.fsPath);
  return {
    uri,
    fileName,
    fileNameLower: fileName.toLowerCase(),
    relativePath,
    relativePathLower: relativePath.toLowerCase(),
    isUsefulFile: isUsefulProjectFile(relativePath.toLowerCase())
  };
}

function isUsefulProjectFile(relativePathLower: string): boolean {
  const usefulExtensions = new Set([
    '.qmd', '.r', '.rproj', '.csv', '.md', '.py', '.ipynb', '.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.json', '.tex', '.pdf'
  ]);
  const extension = path.extname(relativePathLower);
  if (usefulExtensions.has(extension)) {
    return true;
  }

  return /(^|\/)(sections|figures|results|assets|agents|relatedwork)(\/|$)/.test(relativePathLower);
}

function getWorkspaceSearchItems(entries: WorkspaceFileEntry[], normalizedKeyword: string): FileQuickPickItem[] {
  const matchedEntries = entries
    .map((entry) => {
      const fileNameIndex = normalizedKeyword.length === 0 ? -1 : entry.fileNameLower.indexOf(normalizedKeyword);
      const pathIndex = normalizedKeyword.length === 0 ? -1 : entry.relativePathLower.indexOf(normalizedKeyword);
      const hasFileNameMatch = fileNameIndex !== -1;
      const hasPathMatch = pathIndex !== -1;

      return {
        entry,
        fileNameIndex: hasFileNameMatch ? fileNameIndex : Number.MAX_SAFE_INTEGER,
        pathIndex: hasPathMatch ? pathIndex : Number.MAX_SAFE_INTEGER,
        hasFileNameMatch,
        hasPathMatch,
        pathDepth: entry.relativePath.split(path.sep).length,
        usefulPriority: entry.isUsefulFile ? 0 : 1
      };
    })
    .filter((meta) => normalizedKeyword.length === 0 || meta.hasFileNameMatch || meta.hasPathMatch);

  matchedEntries.sort((a, b) => {
    if (a.hasFileNameMatch !== b.hasFileNameMatch) {
      return a.hasFileNameMatch ? -1 : 1;
    }
    if (a.fileNameIndex !== b.fileNameIndex) {
      return a.fileNameIndex - b.fileNameIndex;
    }
    if (a.hasPathMatch !== b.hasPathMatch) {
      return a.hasPathMatch ? -1 : 1;
    }
    if (a.pathIndex !== b.pathIndex) {
      return a.pathIndex - b.pathIndex;
    }
    if (a.usefulPriority !== b.usefulPriority) {
      return a.usefulPriority - b.usefulPriority;
    }
    if (a.pathDepth !== b.pathDepth) {
      return a.pathDepth - b.pathDepth;
    }
    return a.entry.relativePath.localeCompare(b.entry.relativePath);
  });

  return matchedEntries.map((meta) => ({
    label: meta.entry.fileName,
    description: meta.entry.relativePath,
    uri: meta.entry.uri
  }));
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
  const items: FileQuickPickItem[] = uris
    .slice(0, maxResults)
    .map((uri) => ({
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
  const value = config.get<number>('maxResults', 20);
  if (value === 50) {
    return 50;
  }
  return 20;
}

function toRelativePath(uri: vscode.Uri, workspaceFolder?: vscode.WorkspaceFolder): string {
  const folder = workspaceFolder ?? vscode.workspace.getWorkspaceFolder(uri);
  return folder ? path.relative(folder.uri.fsPath, uri.fsPath) : path.basename(uri.fsPath);
}
