# File Finder 

File Finder helps developers quickly locate files and folders across the current workspace or open an exact path from elsewhere on the local file system. Its primary command, **File Finder: Search Workspace Files**, provides live search by item name, relative path, or exact path so you can navigate large projects without leaving the editor.

## Quick Start

Press **Ctrl+P** anywhere in VS Code—including when the integrated terminal has focus—to open **File Finder: Search Workspace Files**.

Start typing a file name, folder name, relative path, or exact path. Results appear live; select an item and press **Enter** to open the file or reveal the folder.

## Main Problem It Solves

In large projects, finding the right file or folder can become slow and distracting, especially with deeply nested structures. File Finder reduces that friction with a focused workspace search that updates as you type.

## Features

- **Live Workspace File and Folder Search**
  - Command: **File Finder: Search Workspace Files**
  - Searches files and folders across the entire current workspace, not just opened tabs.
  - Updates results while you type; you do not need to press Enter before seeing matches.
  - Matches against both item names and relative paths.
  - Works across deeply nested folders.
  - Lets you scroll through matching results in the Quick Pick list.
  - Uses `📁` for folders and `📄` for files.
  - Opens selected files in the editor.
  - Reveals selected folders in the VS Code Explorer.

- **Exact Path Navigation**
  - Opens files and reveals folders using complete absolute paths.
  - Supports Windows and POSIX paths, quoted paths, `~` home paths, and `file://` URIs.
  - Supports paths relative to each folder in a multi-root workspace.
  - Displays the resolved path as a selectable result.
  - Requires an explicit click or **Enter** before opening.
  - Shows clear feedback when a path cannot be found.
    
- **Generated Item Exclusions**
  - Skips common generated, dependency, and system folders, including `node_modules`, `.git`, `out`, `dist`, `build`, `.quarto`, and `__pycache__`.
  - Folder exclusions apply to folder contents only, so useful dotfiles and config files such as `.gitignore`, `package.json`, `README.md`, `.env.example`, `.npmrc`, `.editorconfig`, `.prettierrc`, and `.eslintrc` remain searchable.
  - Does not exclude `.vscode` by default, so files like `.vscode/settings.json`, `.vscode/launch.json`, and `.vscode/tasks.json` can be found.
  - Skips generated package files such as `*.vsix`.

- **Optional Open File Search**
  - Command: **File Finder: Search Open Files**
  - Searches only files currently open in VS Code tabs/documents.
  - This command is optional. The main recommended workflow is workspace search with `Ctrl+P`.

## Keyboard Shortcut

- **Ctrl+P** opens File Finder globally in VS Code, including from the integrated terminal, and searches files and folders across the current workspace.
- Start typing to filter workspace items by name or relative path, or paste an exact path to open a file or reveal a folder.
- Scroll inside the Quick Pick list to browse more matching results.
- Click outside the Quick Pick to close it.
- Select a file to open it in the editor, or select a folder to reveal it in the Explorer.

## Configuration

File Finder can be customized from VS Code Settings under **Tab File Finder**.

- `FileFinder.includeFiles`
  - Default: `true`
  - Includes files in workspace search results.

- `FileFinder.includeFolders`
  - Default: `true`
  - Includes folders in workspace search results.

- `FileFinder.excludeFolders`
  - Default: `node_modules`, `.git`, `out`, `dist`, `build`, `.quarto`, `__pycache__`
  - Excludes folder names or relative folder paths from workspace search. These entries only exclude matching folders and their contents; similarly named files, such as `.gitignore`, are still searchable.

- `FileFinder.excludeFiles`
  - Default: `*.vsix`
  - Excludes file names, relative file paths, or wildcard patterns from workspace search.

- `FileFinder.maxResults`
  - Default: `1000`
  - Minimum: `10`
  - Maximum: `1000`
  - Optional safety limit for how many matches are loaded into the Quick Pick list. The list uses VS Code's normal Quick Pick scrolling.

- `FileFinder.showGeneratedFiles`
  - Default: `false`
  - Controls whether generated and dependency files are included in search results.

- `FileFinder.searchMode`
  - Default: `filesAndFolders`
  - Options: `filesAndFolders`, `filesOnly`, `foldersOnly`
  - Controls whether the main search includes files, folders, or both.

> Note: This extension is intended to replace VS Code's default `Ctrl+P` quick open behavior.
