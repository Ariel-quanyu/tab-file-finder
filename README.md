# Tab File Finder (VS Code Extension)

Tab File Finder is a Visual Studio Code extension that helps developers quickly locate and open files across the current workspace. Its primary command, **Tab File Finder: Search Workspace Files**, provides live search by file name and relative path so you can navigate large projects without leaving the editor.

## Main Problem It Solves

In large projects, finding the right file can become slow and distracting, especially with deeply nested folders. Tab File Finder reduces that friction with a focused workspace file search that updates as you type.

## Features

- **Live Workspace File Search**
  - Command: **Tab File Finder: Search Workspace Files**
  - Searches files across the entire current workspace, not just opened tabs.
  - Updates results while you type; you do not need to press Enter before seeing matches.
  - Matches against both file names and relative paths.
  - Works across deeply nested folders.
  - Opens the selected file from a Quick Pick list.

- **Generated Folder Exclusions**
  - Skips common generated, dependency, and system folders, including `node_modules`, `.git`, `out`, `dist`, `build`, `.quarto`, and `__pycache__`.
  - Useful project configuration files such as `.gitignore`, `README.md`, `package.json`, `.vscode/launch.json`, and `.vscode/tasks.json` remain searchable.

- **Optional Open File Search**
  - Command: **Tab File Finder: Search Open Files**
  - Searches only files currently open in VS Code tabs/documents.
  - This command is optional. The main recommended workflow is workspace search with `Ctrl+P`.

- **Fast Keyboard Access**
  - Keyboard shortcut for **Search Workspace Files**: **Ctrl+P**.
  - `Ctrl+P` opens the workspace search from anywhere inside VS Code.
## Keyboard Shortcut

- **Ctrl+P** runs **Tab File Finder: Search Workspace Files**.
- Start typing to filter workspace files and folders live by name or relative path.
- Select a file result to open it in the editor.
- Select a folder result to reveal it in the VS Code Explorer.

> Note: This extension is intended to replace VS Code's default `Ctrl+P` quick open behavior.
## Example Use Cases

- Jump to a file quickly when you remember part of its name but not its location.
- Find one of many similarly named files in a monorepo or layered architecture.
- Locate files in deeply nested project folders.
- Search across the full workspace even when the target file is not already open.
- Open project files while avoiding noise from generated and dependency folders.

## Tech Stack

- **TypeScript**
- **VS Code Extension API**

## Run Locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Compile the extension:
   ```bash
   npm run compile
   ```
3. Press `F5` in VS Code to launch an **Extension Development Host** window.

## Project Structure

- `package.json` - Extension metadata, commands, scripts, and dependencies.
- `tsconfig.json` - TypeScript compiler settings.
- `src/extension.ts` - Extension activation and command implementations.
- `README.md` - Project overview and local development instructions.

## Notes

- If the keyword is empty, the extension shows all eligible files for the selected command.
- For multi-root workspaces, this version resolves relative paths using the first workspace folder.
