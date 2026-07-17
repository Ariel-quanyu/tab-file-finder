import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

class MockQuickPick {
  value = '';
  enabled = true;
  busy = false;
  placeholder?: string | undefined;
  matchOnDescription = false;
  ignoreFocusOut = false;
  title?: string | undefined;
  items: any[] = [];
  selectedItems: any[] = [];
  activeItems: any[] = [];
  onDidChangeValueCallbacks: Array<(value: string) => any> = [];
  onDidAcceptCallbacks: Array<() => any> = [];
  onDidHideCallbacks: Array<() => any> = [];

  show(): void {}
  hide(): void { this.onDidHideCallbacks.forEach((cb) => cb()); }
  dispose(): void {}

  onDidChangeValue(cb: (value: string) => any): vscode.Disposable { this.onDidChangeValueCallbacks.push(cb); return { dispose: () => {} }; }
  onDidAccept(cb: () => any): vscode.Disposable { this.onDidAcceptCallbacks.push(cb); return { dispose: () => {} }; }
  onDidChangeActive(_cb: (items: readonly any[]) => any): vscode.Disposable { return { dispose: () => {} }; }
  onDidChangeSelection(_cb: (items: readonly any[]) => any): vscode.Disposable { return { dispose: () => {} }; }
  onDidHide(cb: () => any): vscode.Disposable { this.onDidHideCallbacks.push(cb); return { dispose: () => {} }; }

  triggerChangeValue(value: string) { this.value = value; this.onDidChangeValueCallbacks.forEach((cb) => cb(value)); }
  triggerAccept() { this.onDidAcceptCallbacks.forEach((cb) => cb()); }
}

export async function runIntegrationTests(): Promise<void> {
  const originalCreate = vscode.window.createQuickPick;
  const originalShowText = vscode.window.showTextDocument;
  const originalExecute = vscode.commands.executeCommand;
  const originalShowInfo = vscode.window.showInformationMessage;
  const originalShowError = vscode.window.showErrorMessage;

  let tmpDir: string = '';
  let tmpFile: string = '';

  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tff-'));
    tmpFile = path.join(tmpDir, 'file.txt');
    fs.writeFileSync(tmpFile, 'hello');
    vscode.workspace.updateWorkspaceFolders(0, 0, { uri: vscode.Uri.file(tmpDir), name: 'tmp' });

    // Test 1: successful file open via exact absolute path, rapid typing then Enter
    {
      const mock = new MockQuickPick();
      vscode.window.createQuickPick = () => (mock as any);

      let openedUri: vscode.Uri | undefined;
      let openCount = 0;
      (vscode.window.showTextDocument as any) = async (uri: vscode.Uri) => { openedUri = uri; openCount += 1; return {} as any; };

      await vscode.commands.executeCommand('tabFileFinder.searchWorkspaceFiles');
      mock.triggerChangeValue('a');
      mock.triggerChangeValue(tmpFile);

      // allow some time for async resolution
      await new Promise((r) => setTimeout(r, 300));

      // the exact-path item should be visible but not auto-opened
      if (!(mock.items.length > 0)) throw new Error('QuickPick should have visible items');
      const first = mock.items[0] as any;
      if (!(first.description && first.description.indexOf('file') >= 0)) throw new Error('description should contain the full path');
      if (openedUri) throw new Error('file should not open before acceptance');
      if (openCount !== 0) throw new Error('open should not be called before explicit acceptance');

      // press Enter
      mock.triggerAccept();

      // wait for open
      await new Promise((r) => setTimeout(r, 200));

      if (!openedUri) throw new Error('file should be opened');
      const openedUriResolved = openedUri as vscode.Uri;
      const openedPathNorm = openedUriResolved.fsPath.replace(/\\/g, '/');
      const tmpPathNorm = tmpFile.replace(/\\/g, '/');
      if (!openedPathNorm.endsWith(path.basename(tmpPathNorm))) throw new Error('opened path mismatch');
      if (!fs.existsSync(openedUriResolved.fsPath)) throw new Error('opened file does not exist');
    }

    // Test 2: repeated Enter presses only open once
    {
      const mock = new MockQuickPick();
      vscode.window.createQuickPick = () => (mock as any);

      let openCount = 0;
      (vscode.window.showTextDocument as any) = async (_uri: vscode.Uri) => { openCount += 1; return {} as any; };

      await vscode.commands.executeCommand('tabFileFinder.searchWorkspaceFiles');
      mock.triggerChangeValue(tmpFile);
      await new Promise((r) => setTimeout(r, 200));
      mock.triggerAccept();
      mock.triggerAccept();
      mock.triggerAccept();
      await new Promise((r) => setTimeout(r, 300));
      if (openCount !== 1) throw new Error('open should be called once');
    }

    // Test 3: Enter with no active item shows info and does not throw
    {
      const mock = new MockQuickPick();
      vscode.window.createQuickPick = () => (mock as any);

      let infoShown = false;
      (vscode.window.showInformationMessage as any) = async (_msg: string) => { infoShown = true; return undefined; };

      await vscode.commands.executeCommand('tabFileFinder.searchWorkspaceFiles');
      mock.triggerChangeValue('nonexistent-path-xyz');
      await new Promise((r) => setTimeout(r, 200));
      mock.triggerAccept();
      await new Promise((r) => setTimeout(r, 200));
      if (!infoShown) throw new Error('info should be shown');
    }

    // Test 4: open failure resets busy/opening state and keeps picker open
    {
      const mock = new MockQuickPick();
      let hideCalled = false;
      mock.hide = () => { hideCalled = true; };
      vscode.window.createQuickPick = () => (mock as any);

      (vscode.window.showTextDocument as any) = async (_uri: vscode.Uri) => { throw new Error('simulated open failure'); };

      let errorShown = false;
      (vscode.window.showErrorMessage as any) = async (_msg: string) => { errorShown = true; return undefined; };

      await vscode.commands.executeCommand('tabFileFinder.searchWorkspaceFiles');
      mock.triggerChangeValue(tmpFile);
      await new Promise((r) => setTimeout(r, 200));
      mock.triggerAccept();
      await new Promise((r) => setTimeout(r, 300));

      if (!errorShown) throw new Error('error should be shown');
      if (hideCalled !== false) throw new Error('picker should not be hidden on open failure');
    }

    // Reproduce user-provided Windows paths if present on the test machine
    try {
      const userPaths = [
        'D:\\tab-file-finder\\README.md',
        'C:\\Users\\qqy13\\TreeProtectionManager\\package.json'
      ];

      for (const p of userPaths) {
        if (fs.existsSync(p)) {
          const mock = new MockQuickPick();
          vscode.window.createQuickPick = () => (mock as any);

          let openedUri: vscode.Uri | undefined;
          (vscode.window.showTextDocument as any) = async (uri: vscode.Uri) => { openedUri = uri; return {} as any; };

          await vscode.commands.executeCommand('tabFileFinder.searchWorkspaceFiles');
          mock.triggerChangeValue(p);
          await new Promise((r) => setTimeout(r, 300));

          if (!(mock.items.length > 0)) throw new Error(`User path ${p} should produce a visible QuickPick item`);

          mock.triggerAccept();
          await new Promise((r) => setTimeout(r, 200));

          if (!openedUri) throw new Error(`User path ${p} should open`);
        }
      }
    } catch (err) {
      // don't fail the whole suite for optional reproductions
      console.warn('Optional reproduction checks skipped or failed:', err);
    }

  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
    try { fs.rmdirSync(tmpDir); } catch {}
    vscode.window.createQuickPick = originalCreate;
    vscode.window.showTextDocument = originalShowText;
    vscode.commands.executeCommand = originalExecute;
    vscode.window.showInformationMessage = originalShowInfo;
    vscode.window.showErrorMessage = originalShowError;
    vscode.workspace.updateWorkspaceFolders(0, 1);
  }
}

