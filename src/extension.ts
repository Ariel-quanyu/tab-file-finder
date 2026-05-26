import * as path from 'path';
import * as vscode from 'vscode';

type FileQuickPickItem = vscode.QuickPickItem & {
  uri: vscode.Uri;
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
  const keyword = await promptForKeyword('Search workspace files by name or path');
  if (keyword === undefined) {
    return;
  }

  const workspaceFolder = getPrimaryWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showInformationMessage('Open a workspace folder to search workspace files.');
    return;
  }

  const normalizedKeyword = keyword.trim().toLowerCase();
  const excluded = '**/{node_modules,.git,dist,build}/**';
  const workspaceUris = await vscode.workspace.findFiles('**/*', excluded);

  const filteredUris = workspaceUris.filter((uri) => {
    const relativePath = toRelativePath(uri, workspaceFolder);
    const fileName = path.basename(uri.fsPath);
    const haystack = `${fileName} ${relativePath}`.toLowerCase();
    return normalizedKeyword.length === 0 || haystack.includes(normalizedKeyword);
  });

  await showResultsQuickPick(filteredUris, workspaceFolder, 'No workspace files matched your search.');
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

  const items: FileQuickPickItem[] = uris
    .map((uri) => ({
      label: path.basename(uri.fsPath),
      description: workspaceFolder ? toRelativePath(uri, workspaceFolder) : uri.fsPath,
      uri
    }))
    .sort((a, b) => {
      const byLabel = a.label.localeCompare(b.label);
      if (byLabel !== 0) {
        return byLabel;
      }
      return (a.description ?? '').localeCompare(b.description ?? '');
    });

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

function toRelativePath(uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder): string {
  return path.relative(workspaceFolder.uri.fsPath, uri.fsPath) || path.basename(uri.fsPath);
}
