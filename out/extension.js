"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
function activate(context) {
    context.subscriptions.push(vscode.commands.registerCommand('tabFileFinder.searchOpenFiles', searchOpenFiles), vscode.commands.registerCommand('tabFileFinder.searchWorkspaceFiles', searchWorkspaceFiles));
}
function deactivate() {
    // No-op
}
async function searchOpenFiles() {
    const keyword = await promptForKeyword('Search open files by name or path');
    if (keyword === undefined) {
        return;
    }
    const normalizedKeyword = keyword.trim().toLowerCase();
    const workspaceFolder = getPrimaryWorkspaceFolder();
    const openDocuments = vscode.workspace.textDocuments
        .filter((doc) => doc.uri.scheme === 'file')
        .map((doc) => doc.uri);
    const seen = new Set();
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
async function searchWorkspaceFiles() {
    const workspaceFolder = getPrimaryWorkspaceFolder();
    if (!workspaceFolder) {
        vscode.window.showInformationMessage('Open a workspace folder to search workspace files.');
        return;
    }
    const quickPick = vscode.window.createQuickPick();
    quickPick.title = 'Tab File Finder: Search Workspace Files';
    quickPick.placeholder = 'Type a keyword to search workspace files';
    quickPick.matchOnDescription = true;
    quickPick.ignoreFocusOut = true;
    quickPick.busy = true;
    quickPick.items = [];
    quickPick.show();
    const entriesByPath = new Map();
    let quickPickDisposed = false;
    const addEntries = (uris) => {
        for (const uri of uris) {
            if (isExcludedWorkspaceFile(uri) || entriesByPath.has(uri.fsPath)) {
                continue;
            }
            const folder = vscode.workspace.getWorkspaceFolder(uri) ?? workspaceFolder;
            entriesByPath.set(uri.fsPath, createWorkspaceFileEntry(uri, folder));
        }
    };
    const updateItems = (value) => {
        if (quickPickDisposed) {
            return;
        }
        const normalizedKeyword = value.trim().toLowerCase();
        quickPick.items = getWorkspaceSearchItems([...entriesByPath.values()], normalizedKeyword).slice(0, getMaxResults());
    };
    const disposables = [];
    disposables.push(quickPick.onDidChangeValue((value) => updateItems(value)), quickPick.onDidAccept(async () => {
        const picked = quickPick.selectedItems[0];
        if (picked) {
            await vscode.window.showTextDocument(picked.uri, { preview: false });
            quickPick.hide();
        }
    }), quickPick.onDidHide(() => {
        quickPickDisposed = true;
        disposables.forEach((disposable) => disposable.dispose());
        quickPick.dispose();
    }));
    void (async () => {
        try {
            addEntries(await getTopLevelWorkspaceFileUris());
            updateItems(quickPick.value);
            const excluded = '**/{node_modules,.git,out,dist,build,.quarto,__pycache__}/**';
            addEntries(await vscode.workspace.findFiles('**/*', excluded));
            updateItems(quickPick.value);
        }
        catch (error) {
            if (!quickPickDisposed) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Unable to search workspace files: ${message}`);
            }
        }
        finally {
            if (!quickPickDisposed) {
                quickPick.busy = false;
            }
        }
    })();
}
function isExcludedWorkspaceFile(uri) {
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
function createWorkspaceFileEntry(uri, workspaceFolder) {
    const relativePath = normalizeRelativePath(toRelativePath(uri, workspaceFolder));
    const fileName = path.basename(uri.fsPath);
    return {
        uri,
        fileName,
        fileNameLower: fileName.toLowerCase(),
        relativePath,
        relativePathLower: relativePath.toLowerCase(),
        isUsefulFile: isUsefulProjectFile(relativePath.toLowerCase()),
        isTopLevelFile: !relativePath.includes('/')
    };
}
function isUsefulProjectFile(relativePathLower) {
    const usefulExtensions = new Set([
        '.qmd', '.r', '.rproj', '.csv', '.md', '.py', '.ipynb', '.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.json', '.tex', '.pdf'
    ]);
    const extension = path.extname(relativePathLower);
    if (usefulExtensions.has(extension)) {
        return true;
    }
    return /(^|\/)(sections|figures|results|assets|agents|relatedwork)(\/|$)/.test(relativePathLower);
}
function getWorkspaceSearchItems(entries, normalizedKeyword) {
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
            pathDepth: entry.relativePath.split('/').length,
            pathLength: entry.relativePath.length,
            topLevelPriority: entry.isTopLevelFile ? 0 : 1,
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
        if (!a.hasFileNameMatch && a.pathIndex !== b.pathIndex) {
            return a.pathIndex - b.pathIndex;
        }
        if (a.topLevelPriority !== b.topLevelPriority) {
            return a.topLevelPriority - b.topLevelPriority;
        }
        if (a.usefulPriority !== b.usefulPriority) {
            return a.usefulPriority - b.usefulPriority;
        }
        if (a.pathDepth !== b.pathDepth) {
            return a.pathDepth - b.pathDepth;
        }
        if (a.pathLength !== b.pathLength) {
            return a.pathLength - b.pathLength;
        }
        return a.entry.relativePath.localeCompare(b.entry.relativePath);
    });
    return matchedEntries.map((meta) => ({
        label: meta.entry.fileName,
        description: meta.entry.relativePath,
        uri: meta.entry.uri
    }));
}
async function getTopLevelWorkspaceFileUris() {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const results = [];
    for (const folder of folders) {
        const entries = await vscode.workspace.fs.readDirectory(folder.uri);
        for (const [name, fileType] of entries) {
            if (fileType === vscode.FileType.File) {
                results.push(vscode.Uri.joinPath(folder.uri, name));
            }
        }
    }
    return results;
}
async function promptForKeyword(placeHolder) {
    return vscode.window.showInputBox({
        title: 'Tab File Finder',
        prompt: 'Type a keyword (e.g. login, auth, tree, src, page). Leave blank to show all results.',
        placeHolder,
        ignoreFocusOut: true
    });
}
async function showResultsQuickPick(uris, workspaceFolder, noResultsMessage) {
    if (uris.length === 0) {
        vscode.window.showInformationMessage(noResultsMessage);
        return;
    }
    const maxResults = getMaxResults();
    const items = uris
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
function getPrimaryWorkspaceFolder() {
    const [folder] = vscode.workspace.workspaceFolders ?? [];
    return folder;
}
function getMaxResults() {
    const config = vscode.workspace.getConfiguration('tabFileFinder');
    const value = config.get('maxResults', 20);
    if (value === 50) {
        return 50;
    }
    return 20;
}
function toRelativePath(uri, workspaceFolder) {
    const folder = workspaceFolder ?? vscode.workspace.getWorkspaceFolder(uri);
    return folder ? path.relative(folder.uri.fsPath, uri.fsPath) : path.basename(uri.fsPath);
}
function normalizeRelativePath(relativePath) {
    return relativePath.replace(/\\/g, '/');
}
//# sourceMappingURL=extension.js.map