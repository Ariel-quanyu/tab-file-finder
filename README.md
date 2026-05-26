# Tab File Finder (VS Code Extension)

Tab File Finder helps you quickly locate and open files when you have too many tabs or too many files in your project.

## Features

### 1) Search Open Files
- Command: **Tab File Finder: Search Open Files**
- Shows an input box for a keyword (for example: `login`, `auth`, `tree`, `src`, `page`).
- Searches only files currently open in VS Code editor tabs/documents.
- Matches keyword against both file name and relative path.
- Shows results in a Quick Pick list.
- Opens the selected file in the editor.

### 2) Search Workspace Files
- Command: **Tab File Finder: Search Workspace Files**
- Shows an input box for a keyword.
- Searches all files in the current workspace.
- Excludes: `node_modules`, `.git`, `dist`, and `build`.
- Matches keyword against both file name and relative path.
- Opens the selected file in the editor.

## Project Structure

- `package.json` - extension metadata, commands, scripts, dependencies.
- `tsconfig.json` - TypeScript compiler settings.
- `src/extension.ts` - extension activation and command implementations.
- `README.md` - usage and local development instructions.

## Run Locally in VS Code

1. Install dependencies:
   ```bash
   npm install
   ```
2. Compile the extension:
   ```bash
   npm run compile
   ```
3. Open this repository in VS Code.
4. Press `F5` to launch a new **Extension Development Host** window.
5. In the development host window, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
6. Run either:
   - `Tab File Finder: Search Open Files`
   - `Tab File Finder: Search Workspace Files`

## Test Locally

- Basic verification steps:
  1. Open multiple files in editor tabs.
  2. Run **Search Open Files**, type a partial keyword (like `src` or `auth`), and verify matching tabs appear.
  3. Select a result and verify VS Code switches to that file.
  4. Run **Search Workspace Files** and verify files from excluded folders (`node_modules`, `.git`, `dist`, `build`) do not appear.

## Notes

- If you leave the keyword empty, the extension shows all eligible files for that command.
- For multi-root workspaces, this version resolves relative paths against the first workspace folder.
