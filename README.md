# Tab File Finder (VS Code Extension)

Tab File Finder is a Visual Studio Code extension that helps developers quickly locate files in large codebases. It provides fast, keyword-based search across workspace files, currently opened files, folders, and other project items so you can navigate projects more efficiently.

## Main Problem It Solves

In large projects, finding the right file can become slow and distracting—especially when you have many open tabs or deep folder structures. Tab File Finder reduces that friction by giving you focused, in-editor search commands to jump directly to the file you need.

## Features

- **Search Open Files**
  - Command: **Tab File Finder: Search Open Files**
  - Searches files currently opened in VS Code tabs/documents.
  - Matches keywords against both file names and relative paths.
  - Displays results in a Quick Pick list and opens the selected file.

- **Search Workspace Files**
  - Command: **Tab File Finder: Search Workspace Files**
  - Searches files across the current workspace.
  - Matches keywords against both file names and relative paths.
  - Excludes common generated/system folders: `node_modules`, `.git`, `dist`, `build`.
  - Displays results in a Quick Pick list and opens the selected file.

- **Fast Keyboard Access**
  - Keyboard shortcut for **Search Workspace Files**: **Ctrl+Shift+Q**.

## Example Use Cases

- Jump to a file quickly when you remember part of its name but not its location.
- Find one of many similarly named files in a monorepo or layered architecture.
- Switch between frequently used open files without manually scanning tabs.
- Locate project items in deep folder hierarchies during debugging or feature work.

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
