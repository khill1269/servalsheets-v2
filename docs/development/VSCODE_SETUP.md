---
title: VS Code Setup Guide for ServalSheets
category: development
last_updated: 2026-01-31
description: 'Last Updated: 2026-01-13'
version: 1.6.0
tags: [setup, configuration, sheets]
---

# VS Code Setup Guide for ServalSheets

**Last Updated:** 2026-01-13
**Version:** 2.0 (2026 MCP Best Practices)

Complete guide for setting up Visual Studio Code for ServalSheets MCP development with 2026 best practices and MCP-specific tooling.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Automatic Setup (Recommended)](#automatic-setup-recommended)
3. [Manual Setup](#manual-setup)
4. [Extensions Overview](#extensions-overview)
5. [Debugging Guide](#debugging-guide)
6. [Testing Workflow](#testing-workflow)
7. [Code Snippets](#code-snippets)
8. [Keyboard Shortcuts](#keyboard-shortcuts)
9. [Troubleshooting](#troubleshooting)

---

## Quick Start

If you've cloned the repository, VS Code should automatically:

1. Detect workspace settings ([.vscode/settings.json](.vscode/settings.json))
2. Prompt to install recommended extensions ([.vscode/extensions.json](.vscode/extensions.json))
3. Configure TypeScript, ESLint, Prettier, and Vitest

**First-time setup:**

```bash
# 1. Open project in VS Code
code .

# 2. Install recommended extensions (when prompted)
# Click "Install All" in the bottom-right notification

# 3. Reload window
# Press Cmd+Shift+P → "Developer: Reload Window"
```

---

## Automatic Setup (Recommended)

Use the automated setup script to configure everything at once:

```bash
# From project root
bash scripts/setup-vscode.sh
```

**What it does:**

- ✅ Installs 17 recommended extensions (including 2026 MCP tools)
- ✅ Creates [.vscode/settings.json](.vscode/settings.json) with workspace config
- ✅ Creates [.vscode/extensions.json](.vscode/extensions.json) with recommendations
- ✅ Creates [.prettierrc.json](.prettierrc.json) with formatting rules
- ✅ Updates dependencies (TypeScript ESLint, Vitest, TypeDoc)
- ✅ Verifies installation

**After running:**

```bash
# Reload VS Code
# Press Cmd+Shift+P → "Developer: Reload Window"
```

---

## Manual Setup

### 1. Install Core Extensions

```bash
# Core development tools
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
code --install-extension usernamehw.errorlens

# TypeScript support
code --install-extension yoavbls.pretty-ts-errors
code --install-extension mattpocock.ts-error-translator

# Testing
code --install-extension ZixuanChen.vitest-explorer

# Git
code --install-extension eamodio.gitlens

# Productivity
code --install-extension gruntfuggly.todo-tree
code --install-extension aaron-bond.better-comments
code --install-extension wix.vscode-import-cost
code --install-extension streetsidesoftware.code-spell-checker

# MCP Development (2026)
code --install-extension newbpydev.mcp-diagnostics-extension
code --install-extension maaz-tajammul.diagnostics-mcp-server

# Documentation
code --install-extension bierner.markdown-mermaid
code --install-extension yzhang.markdown-all-in-one
```

### 2. Verify TypeScript Version

Press `Cmd+Shift+P` → "TypeScript: Select TypeScript Version" → "Use Workspace Version"

This ensures you're using the project's TypeScript (not VS Code's bundled version).

---

## Extensions Overview

### 🔴 Critical Extensions

| Extension           | Purpose       | Why Critical                  |
| ------------------- | ------------- | ----------------------------- |
| **ESLint**          | Linting       | Catch errors before runtime   |
| **Prettier**        | Formatting    | Consistent code style         |
| **Error Lens**      | Inline errors | See errors without hovering   |
| **Vitest Explorer** | Test runner   | Visual test execution with UI |

### 🟡 TypeScript Enhancements

| Extension               | Feature                          |
| ----------------------- | -------------------------------- |
| **Pretty TS Errors**    | Human-readable TypeScript errors |
| **TS Error Translator** | Plain English error explanations |

### 🟢 MCP Development (2026)

| Extension                     | Feature                                          |
| ----------------------------- | ------------------------------------------------ |
| **MCP Diagnostics Extension** | Exposes VS Code diagnostics to AI agents via MCP |
| **Diagnostics MCP Server**    | HTTP-based MCP server for real-time diagnostics  |

### MCP Diagnostics Workflow

Use this workflow to ensure VS Code diagnostics are available to MCP clients:

1. Open the **Problems** panel and confirm diagnostics are populated.
2. Open the Command Palette and search for the diagnostics extension commands (try `Diagnostics MCP` or `MCP Diagnostics`).
3. Start the diagnostics MCP server from the command provided by the extension.
4. Check **Output** for the server URL/port and confirm it is running.
5. (Optional) Connect with MCP Inspector or your MCP client config to verify diagnostics are surfaced.

### 📦 Productivity

| Extension              | Feature                          |
| ---------------------- | -------------------------------- |
| **GitLens**            | Git blame, history, compare      |
| **TODO Tree**          | Find all TODOs in project        |
| **Import Cost**        | Show package import sizes inline |
| **Code Spell Checker** | Catch typos in strings/comments  |

---

## Debugging Guide

### Available Debug Configurations

Press `F5` or open **Run and Debug** panel to see all configurations:

#### 🚀 MCP Server Debugging

1. **Debug MCP Server (stdio)** - Debug stdio transport server
   - Builds project first (`preLaunchTask: "Build"`)
   - Sets `DEBUG=mcp:*` environment variable
   - Best for: Testing stdio MCP communication

2. **Debug MCP Server (HTTP)** - Debug HTTP transport server
   - Runs on `PORT=3000`
   - Best for: Testing HTTP endpoints

3. **Debug with MCP Inspector** - Visual MCP debugging
   - Launches MCP Inspector in browser
   - URL: `http://localhost:6274`
   - Best for: Interactive MCP testing

#### 🧪 Test Debugging

1. **Debug All Tests** - Run all Vitest tests with debugger
2. **Debug Current Test File** - Debug only the open test file
3. **Debug Test at Cursor** - Debug specific test (select test name, then debug)

#### 🔗 Advanced

1. **Attach to Process** - Attach to running Node process on port 9229
2. **Debug TypeScript Direct** - Debug TypeScript files directly with `tsx`

### Quick Debugging Tips

**Set breakpoints:**

- Click in gutter next to line number (or press `F9`)
- Red dot appears when breakpoint is set

**Debug current file:**

- Open test file
- Press `F5` → Select "Debug Current Test File"

**Use MCP Inspector:**

- Press `Cmd+Shift+P` → "Tasks: Run Task" → "🔬 MCP Inspector (stdio)"
- Browser opens at `http://localhost:6274`
- Test tools interactively

---

## Testing Workflow

### Run Tests from VS Code

**Option 1: Vitest Explorer (GUI)**

1. Open **Testing** panel (beaker icon in left sidebar)
2. Click play button next to test/file/folder
3. See results inline with ✓ or ✗

**Option 2: Tasks**

- `Cmd+Shift+P` → "Tasks: Run Task"
- Select:
  - "03 - Test" - Run all tests
  - "🧪 Test Current File" - Run open file's tests
  - "🧪 Test Watch" - Watch mode
  - "Test Coverage" - Generate coverage report

**Option 3: Keyboard**

- `Cmd+Shift+T` - Run all tests (if keybinding configured)

### View Coverage

```bash
# Generate coverage
npm run test:coverage

# Open report (VS Code task)
# Cmd+Shift+P → Tasks: Run Task → 📊 Open Coverage Report
```

Report opens in browser: [coverage/index.html](../../coverage/index.html)

---

## Code Snippets

Type these prefixes and press `Tab` to expand:

### MCP Tool Development

| Prefix         | Expands To                                |
| -------------- | ----------------------------------------- |
| `mcp-tool`     | Full MCP tool handler with action pattern |
| `mcp-annot`    | MCP tool annotations (readOnlyHint, etc.) |
| `mcp-resource` | MCP resource handler template             |
| `mcp-prompt`   | MCP prompt template                       |
| `mcp-error`    | Throw MCP error with context              |

**Example:**

```typescript
// Type "mcp-tool" and press Tab
import { z } from 'zod';
import type { ToolHandler, ToolContext } from '../types.js';

export const toolNameSchema = z.object({
  action: z.enum(['list', 'get', 'create']),
  // Add parameters
});
// ... full handler scaffolding
```

### Google Sheets API

| Prefix          | Expands To                 |
| --------------- | -------------------------- |
| `sheets-batch`  | batchUpdate request        |
| `sheets-get`    | spreadsheets.values.get    |
| `sheets-update` | spreadsheets.values.update |
| `sheets-append` | spreadsheets.values.append |

### Zod Schemas

| Prefix      | Expands To                      |
| ----------- | ------------------------------- |
| `zod-obj`   | Object schema with type export  |
| `zod-union` | Discriminated union for actions |
| `zod-enum`  | Enum schema                     |

### Testing

| Prefix        | Expands To                            |
| ------------- | ------------------------------------- |
| `vtest-suite` | Vitest test suite with setup/teardown |
| `vtest-mock`  | vi.mock() pattern                     |
| `vtest-spy`   | vi.spyOn() pattern                    |

### Utilities

| Prefix        | Expands To                        |
| ------------- | --------------------------------- |
| `try-async`   | Async try-catch with typed errors |
| `response`    | buildToolResponse() call          |
| `a1-notation` | A1 notation conversion helpers    |
| `dlog`        | Debug logger call                 |

---

## Keyboard Shortcuts

### Build & Run (Custom)

Add these to [.vscode/keybindings.json](../../.vscode/keybindings.json):

```json
{
  "key": "cmd+shift+b",
  "command": "workbench.action.tasks.runTask",
  "args": "Build"
},
{
  "key": "cmd+shift+r",
  "command": "workbench.action.tasks.runTask",
  "args": "🚀 Start MCP Server (HTTP)"
},
{
  "key": "cmd+shift+i",
  "command": "workbench.action.tasks.runTask",
  "args": "🔬 MCP Inspector (stdio)"
}
```

### Default Shortcuts

| Shortcut      | Action               |
| ------------- | -------------------- |
| `F5`          | Start debugging      |
| `Shift+F5`    | Stop debugging       |
| `Cmd+F5`      | Restart debugging    |
| `F9`          | Toggle breakpoint    |
| `F10`         | Step over            |
| `F11`         | Step into            |
| `Shift+F11`   | Step out             |
| `Cmd+Shift+P` | Command palette      |
| `Cmd+Shift+T` | Reopen closed editor |
| `Cmd+K Cmd+T` | Run tests (Vitest)   |

---

## Troubleshooting

### TypeScript Version Issues

**Problem:** TypeScript errors don't match build errors

**Solution:**

1. Press `Cmd+Shift+P`
2. Type "TypeScript: Select TypeScript Version"
3. Choose "Use Workspace Version"
4. Reload window (`Cmd+Shift+P` → "Developer: Reload Window")

### Extensions Not Working

**Problem:** ESLint/Prettier not formatting on save

**Solution:**

1. Check [.vscode/settings.json](.vscode/settings.json) exists
2. Verify extension installed: `code --list-extensions | grep eslint`
3. Reload window
4. Check output panel (`Cmd+Shift+U`) → Select "ESLint" in dropdown

### MCP Inspector Won't Launch

**Problem:** Task fails with "command not found"

**Solution:**

```bash
# Install MCP Inspector globally
npm install -g @modelcontextprotocol/inspector

# Or run with npx (slower first time)
npx @modelcontextprotocol/inspector node dist/server.js
```

### Vitest Explorer Not Finding Tests

**Problem:** Testing panel shows "No tests found"

**Solution:**

1. Check [.vscode/settings.json](.vscode/settings.json) has `vitest.enable: true`
2. Verify test files match pattern: `**/*.{test,spec}.ts`
3. Run `npm install` to ensure Vitest is installed
4. Reload window

### Debugger Not Hitting Breakpoints

**Problem:** Breakpoints ignored during debugging

**Solution:**

1. Ensure source maps enabled in [tsconfig.json](../../tsconfig.json): `"sourceMap": true`
2. Run build task before debugging (`Cmd+Shift+B`)
3. Check debug configuration has `"sourceMaps": true`
4. Verify `outFiles` path matches build output

### Import Cost Extension Shows Wrong Sizes

**Problem:** Import sizes incorrect or not showing

**Solution:**

1. Ensure `node_modules` is installed: `npm install`
2. Extension calculates on save - save the file
3. Check extension output: `Cmd+Shift+U` → "Import Cost"

---

## Advanced Configuration

### Custom Tasks

Add custom tasks to [.vscode/tasks.json](../../.vscode/tasks.json):

```json
{
  "label": "My Custom Task",
  "type": "shell",
  "command": "npm run my-script",
  "problemMatcher": [],
  "presentation": {
    "reveal": "always"
  }
}
```

### Custom Launch Configurations

Add to [.vscode/launch.json](../../.vscode/launch.json):

```json
{
  "name": "My Debug Config",
  "type": "node",
  "request": "launch",
  "program": "${workspaceFolder}/dist/my-file.js",
  "preLaunchTask": "Build",
  "skipFiles": ["<node_internals>/**"]
}
```

### Workspace-Specific Snippets

Add snippets to [.vscode/servalsheets.code-snippets](../../.vscode/servalsheets.code-snippets):

```json
{
  "My Snippet": {
    "prefix": "my-snippet",
    "body": ["// Your code here", "$0"],
    "description": "Description"
  }
}
```

---

## Additional Resources

- **Official VS Code Docs:** [TypeScript Tutorial](https://code.visualstudio.com/docs/typescript/typescript-tutorial)
- **Debugging Guide:** [Node.js Debugging](https://code.visualstudio.com/docs/nodejs/nodejs-debugging)
- **MCP Inspector:** [Documentation](https://modelcontextprotocol.io/docs/tools/inspector)
- **ServalSheets Docs:** [Developer Workflow](DEVELOPER_WORKFLOW.md)

---

## Support

**Issues with VS Code setup?**

1. Check [Troubleshooting](#troubleshooting) section above
2. Run setup script: `bash scripts/setup-vscode.sh`
3. File issue: [GitHub Issues](https://github.com/khill1269/servalsheets/issues)

**Developer workflow questions?**

- See [DEVELOPER_WORKFLOW.md](DEVELOPER_WORKFLOW.md)
- See [DEBUGGING_AND_TESTING.md](DEBUGGING_AND_TESTING.md)
