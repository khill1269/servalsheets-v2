---
title: ServalSheets Developer Onboarding Guide
category: guide
last_updated: 2026-02-17
description: 'Complete onboarding guide for new ServalSheets contributors'
version: 1.0
tags: [onboarding, setup, getting-started, architecture]
---

# ServalSheets Developer Onboarding Guide

**Welcome to ServalSheets!** This guide will take you from zero to productive contributor in 30-60 minutes.

**Version:** 1.0
**Last Updated:** 2026-02-17
**Target Audience:** New contributors to ServalSheets

---

## Table of Contents

1. [Welcome & Project Overview](#welcome--project-overview)
2. [Quick Setup (15 minutes)](#quick-setup-15-minutes)
3. [Architecture Overview](#architecture-overview)
4. [Key Concepts](#key-concepts)
5. [Your First Contribution](#your-first-contribution)
6. [Development Workflows](#development-workflows)
7. [Testing Philosophy](#testing-philosophy)
8. [Code Quality Standards](#code-quality-standards)
9. [Getting Help](#getting-help)
10. [Next Steps](#next-steps)

---

## Welcome & Project Overview

### What is ServalSheets?

ServalSheets is a **production-grade MCP (Model Context Protocol) server** that provides AI assistants like Claude with powerful Google Sheets capabilities.

**Key Stats:**

- 25 tools with 407 actions
- 8,500+ tests with CI coverage reporting
- TypeScript strict mode
- MCP 2025-11-25 protocol compliant
- ~50,000 lines of code

**What makes it special:**

- ✅ Safety rails (confirmation gates, undo/redo, transactions)
- ✅ Production-ready (circuit breakers, rate limiting, auto-retry)
- ✅ Enterprise features (multi-tenant, RBAC, audit logging)
- ✅ AI-optimized (smart batching, formula analysis, natural language queries)

### Project Philosophy

1. **Safety first** - Never lose user data
2. **Type safety** - Catch errors at compile time
3. **Test everything** - No untested code in production
4. **Minimal changes** - Small, focused PRs
5. **Documentation** - Code should be self-explanatory

---

## Quick Setup (15 minutes)

### Prerequisites

```bash
# Required
node >= 20.0.0
npm >= 10.0.0
git >= 2.0

# Verify versions
node --version  # Should show v20.x.x or higher
npm --version   # Should show 10.x.x or higher
```

### Installation

```bash
# 1. Clone repository
git clone https://github.com/khill1269/servalsheets.git
cd servalsheets

# 2. Install dependencies
npm install

# 3. Build project
npm run build

# 4. Run verification
npm run verify
```

**Expected output:**

```
✅ Drift check passed
✅ No placeholders found
✅ Type check passed (0 errors)
✅ Lint passed
✅ Format check passed
✅ Tests passed (1761/1761)

✨ All verification checks passed!
```

**If verification fails:** See [Common Setup Issues](#common-setup-issues) below.

### Optional: Google Sheets Authentication

For testing against real Google Sheets API:

```bash
# Run OAuth setup
npm run auth

# Follow browser prompts to authorize
# Tokens stored in ~/.config/servalsheets/
```

**Note:** Most development uses mocked APIs (no real credentials needed).

---

## Architecture Overview

### Project Structure

```
servalsheets/
├── src/                    # Source code
│   ├── cli.ts              # CLI entrypoint
│   ├── server.ts           # STDIO MCP server (1289 lines)
│   ├── http-server.ts      # HTTP MCP server (2390 lines)
│   ├── schemas/            # Zod schemas (SOURCE OF TRUTH)
│   │   ├── index.ts        # TOOL_COUNT, ACTION_COUNT (GENERATED)
│   │   ├── annotations.ts  # Per-tool metadata (GENERATED)
│   │   └── *.ts            # Individual tool schemas
│   ├── handlers/           # Business logic (22 handlers)
│   │   ├── base.ts         # BaseHandler class (1425 lines)
│   │   └── *.ts            # Tool handlers
│   ├── mcp/                # MCP protocol layer
│   │   ├── registration/   # Tool registration
│   │   └── completions.ts  # Action autocomplete (GENERATED)
│   ├── services/           # Infrastructure services
│   ├── utils/              # Shared utilities
│   └── knowledge/          # AI knowledge base (40 files)
├── tests/                  # Test suites
│   ├── contracts/          # Schema guarantees (667 tests)
│   ├── handlers/           # Handler unit tests
│   ├── integration/        # Cross-layer tests
│   └── unit/               # Pure unit tests
├── scripts/                # Automation scripts
│   ├── generate-metadata.ts      # Regenerate counts
│   ├── validation-gates.sh       # Multi-level validation
│   └── check-*.sh                # Quality checks
└── docs/                   # Documentation
    ├── development/        # Developer guides
    ├── guides/             # User guides
    └── reference/          # API reference
```

### Data Flow

```
MCP Client (Claude)
    ↓
src/server.ts → handleToolCall()
    ↓
src/mcp/registration/tool-handlers.ts → createToolCallHandler()
    ↓ (validation)
src/schemas/*.ts → Zod validation
    ↓
src/handlers/*.ts → executeAction()
    ↓
src/services/google-api.ts → Google Sheets API
    ↓ (auto-retry, circuit breaker)
Google Sheets API
    ↓ (response)
src/handlers/*.ts → return structured response
    ↓
src/mcp/registration/tool-handlers.ts → buildToolResponse()
    ↓
MCP Client (CallToolResult)
```

### Three Transport Modes

ServalSheets supports 3 ways to connect:

1. **STDIO** (`src/server.ts`) - Claude Desktop, CLI
2. **HTTP** (`src/http-server.ts`) - Cloud deployment, webhooks
3. **Remote** (`src/remote-server.ts`) - OAuth 2.1 multi-tenant

---

## Key Concepts

### 1. Schema-First Architecture

**Schemas are the source of truth.** Everything derives from Zod schemas:

```typescript
// src/schemas/data.ts
export const SheetsDataInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('read_range'),
    spreadsheetId: z.string(),
    range: z.string(),
  }),
  z.object({
    action: z.literal('write_range'),
    spreadsheetId: z.string(),
    range: z.string(),
    values: z.array(z.array(z.string())),
  }),
]);

// Infer TypeScript type from schema
export type SheetsDataInput = z.infer<typeof SheetsDataInputSchema>;
```

**Why schema-first?**

- Single source of truth
- Compile-time type safety
- Runtime validation
- Auto-generated documentation

### 2. Discriminated Unions

All tool inputs use **discriminated unions** with `action` as the discriminator:

```typescript
// Schema defines actions
action: z.enum(['read_range', 'write_range', 'update_cells', ...])

// Handler switches on action
switch (input.action) {
  case 'read_range':
    return this.handleReadRange(input);
  case 'write_range':
    return this.handleWriteRange(input);
  // ...
}
```

**Benefits:**

- TypeScript narrows types automatically
- Impossible to forget handling an action
- Clear action-to-handler mapping

### 3. Metadata Generation

Schema changes trigger metadata regeneration:

```bash
# After editing any src/schemas/*.ts file:
npm run schema:commit

# Automatically updates 5 files:
# 1. package.json (description)
# 2. src/schemas/index.ts (TOOL_COUNT, ACTION_COUNT)
# 3. src/schemas/annotations.ts (ACTION_COUNTS)
# 4. src/mcp/completions.ts (TOOL_ACTIONS)
# 5. server.json (full MCP metadata)
```

**Never edit these 5 files manually!**

### 4. Validation Gates (Phase -1)

Progressive validation system:

- **G0:** Baseline integrity (20s) - Run before every commit
- **G1:** Metadata consistency (8s) - Run after schema changes
- **G2:** Phase behavior (45s) - Run after handler changes
- **G3:** API/Protocol/Docs (15s) - Run before doc updates
- **G4:** Final truth (60s) - Run before releases

```bash
# Quick check before commit
npm run gates:g0

# Or use keyboard shortcut
Cmd+G Cmd+0
```

### 5. Three-Layer Validation

Every request goes through 3 validation layers:

1. **Fast validators** (0.1ms) - Quick format checks
2. **Zod validation** (1-2ms) - Full schema validation
3. **Output validation** (advisory) - Response structure check

```typescript
// Layer 1: Fast validator
fastValidateSpreadsheet(input);

// Layer 2: Zod schema
const validated = SheetsDataInputSchema.parse(input);

// Layer 3: Output validation (in tool-handlers.ts)
validateOutput(result, outputSchema);
```

### 6. Handler Pattern

All 22 handlers follow this exact structure:

```typescript
export class DataHandler extends BaseHandler<DataInput, DataOutput> {
  async executeAction(request: DataInput): Promise<DataOutput> {
    // 1. Unwrap legacy envelope
    const unwrapped = unwrapRequest(request);

    // 2. Extract discriminated union
    const { action, ...params } = unwrapped;

    // 3. Switch on action
    switch (action) {
      case 'read_range':
        return this.handleReadRange(params);
      case 'write_range':
        return this.handleWriteRange(params);
      default:
        throw createValidationError(`Unknown action: ${action}`);
    }
  }

  private async handleReadRange(params: ReadRangeParams): Promise<DataOutput> {
    // 4. Call instrumented Google API
    const result = await this.context.googleClient.sheets.spreadsheets.values.get({
      spreadsheetId: params.spreadsheetId,
      range: params.range,
    });

    // 5. Return structured response (NOT MCP format)
    return {
      response: {
        success: true,
        action: 'read_range',
        values: result.data.values || [],
      },
    };
  }
}
```

**Key points:**

- Handlers extend `BaseHandler`
- Handlers return `{ response: { success, data } }` (NOT MCP format)
- MCP formatting happens in `tool-handlers.ts`
- All API calls auto-retry via `BaseHandler`

---

## Your First Contribution

### Option 1: Fix a Good First Issue (30 minutes)

```bash
# 1. Find an issue labeled "good first issue"
# Visit: https://github.com/khill1269/servalsheets/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22

# 2. Create branch
git checkout -b fix/issue-123

# 3. Write failing test
code tests/handlers/data.test.ts
npm test tests/handlers/data.test.ts  # Should fail

# 4. Fix the bug
code src/handlers/data.ts

# 5. Verify fix
npm test tests/handlers/data.test.ts  # Should pass
npm run gates:g0                      # Quick validation

# 6. Commit and push
git add tests/ src/
git commit -m "fix(data): handle empty ranges gracefully"
git push origin fix/issue-123

# 7. Create PR
# Use GitHub UI or: gh pr create
```

### Option 2: Add a Simple Action (60 minutes)

Follow the complete tutorial: [ADDING_AN_ACTION.md](./ADDING_AN_ACTION.md)

Example: Add `clear_range` action to `sheets_data` tool.

### Option 3: Improve Documentation (20 minutes)

```bash
# 1. Find outdated or unclear docs
grep -r "TODO" docs/

# 2. Update documentation
code docs/guides/QUICKSTART.md

# 3. Verify links and formatting
npm run docs:validate

# 4. Commit
git add docs/
git commit -m "docs: clarify OAuth setup steps"
git push
```

---

## Development Workflows

### Workflow 1: Schema Change

```bash
# 1. Edit schema
code src/schemas/data.ts
# Add action to z.enum([...]) array

# 2. ONE command for metadata + validation
npm run schema:commit
# Runs: gen:metadata → check:drift → typecheck → test:fast → git add

# 3. Commit
git commit -m "feat(data): add export_as_csv action"
```

### Workflow 2: Bug Fix

```bash
# 1. Write failing test (TDD)
code tests/handlers/data.test.ts
npm test tests/handlers/data.test.ts  # ❌ Fails

# 2. Fix bug
code src/handlers/data.ts

# 3. Verify fix
npm test tests/handlers/data.test.ts  # ✅ Passes
npm run gates:g0                      # ✅ Quick check (20s)

# 4. Commit
git add tests/ src/
git commit -m "fix(data): handle null values"
```

### Workflow 3: Add Handler

Follow complete tutorial: [ADDING_A_HANDLER.md](./ADDING_A_HANDLER.md)

---

## Testing Philosophy

ServalSheets has **8,500+ tests** with CI coverage reporting:

### Test Categories

1. **Unit Tests** (70%) - Test individual functions
2. **Integration Tests** (25%) - Test cross-layer interactions
3. **Contract Tests** (5%) - Guarantee schema transformations

### When to Write Tests

**Always write tests BEFORE implementation (TDD):**

```bash
# 1. Write failing test
code tests/handlers/data.test.ts
npm test tests/handlers/data.test.ts  # ❌ Red

# 2. Implement feature
code src/handlers/data.ts
npm test tests/handlers/data.test.ts  # ✅ Green

# 3. Refactor if needed
npm test tests/handlers/data.test.ts  # ✅ Still green
```

### Running Tests

```bash
# Quick tests during development
npm run test:fast              # 12s - Unit + contracts

# Test specific file
npm test tests/handlers/data.test.ts

# Test with pattern
npm test -- --grep="read_range"

# Watch mode
npm run test:watch

# Full test suite
npm test                       # 3 min - All tests

# With coverage
npm run test:coverage
```

---

## Code Quality Standards

### TypeScript Strict Mode

ServalSheets uses TypeScript strict mode:

```json
{
  "strict": true,
  "noImplicitReturns": true,
  "noFallthroughCasesInSwitch": true,
  "noUncheckedIndexedAccess": true
}
```

**If you get TypeScript errors:** See [TYPESCRIPT_ERROR_GUIDE.md](../development/TYPESCRIPT_ERROR_GUIDE.md)

### ESLint Rules

```bash
# Check linting
npm run lint

# Auto-fix
npm run lint:fix
```

### Code Formatting

```bash
# Check formatting
npm run format:check

# Auto-format
npm run format
```

### Pre-Commit Checklist

Before every commit:

```bash
# Run baseline validation
npm run gates:g0               # 20s

# Or full verification
npm run verify                 # 45s
```

**If gates fail:** Fix issues before committing.

---

## Getting Help

### Documentation

- **[Developer Workflow Guide](../development/DEVELOPER_WORKFLOW.md)** - Complete workflow reference
- **[Scripts Reference](../development/SCRIPTS_REFERENCE.md)** - All npm commands
- **[TypeScript Error Guide](../development/TYPESCRIPT_ERROR_GUIDE.md)** - TS error troubleshooting
- **[Source of Truth](../development/SOURCE_OF_TRUTH.md)** - Architecture reference

### Tutorials

- **[Adding a Handler](./ADDING_A_HANDLER.md)** - Create new tool
- **[Adding an Action](./ADDING_AN_ACTION.md)** - Add action to existing tool
- **[Debugging Guide](./DEBUGGING.md)** - Debugging techniques

### Community

- **GitHub Issues:** https://github.com/khill1269/servalsheets/issues
- **Discussions:** https://github.com/khill1269/servalsheets/discussions

### Quick Diagnostic Commands

```bash
# Check current state
npm run verify 2>&1 | tee verify.log

# TypeScript errors
npm run typecheck

# Metadata issues
npm run check:drift

# Test failures
npm test -- --reporter=verbose
```

---

## Next Steps

### After completing onboarding

1. **Read architecture docs:**
   - [Handler Patterns](../development/HANDLER_PATTERNS.md)
   - [Schema Design](../development/SCHEMA_DESIGN.md)
   - [Testing Guide](../development/TESTING.md)

2. **Complete a tutorial:**
   - [Add your first action](./ADDING_AN_ACTION.md)
   - [Add your first handler](./ADDING_A_HANDLER.md)

3. **Join the community:**
   - Watch the repository for updates
   - Introduce yourself in Discussions
   - Find a "good first issue" to work on

4. **Set up VS Code:**
   - Install recommended extensions (`.vscode/extensions.json`)
   - Configure keyboard shortcuts (`.vscode/keybindings.json`)
   - Enable format-on-save

---

## Common Setup Issues

### Issue: `npm install` fails with EACCES

**Cause:** Permission issues with global npm.

**Fix:**

```bash
# Option 1: Use nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20

# Option 2: Fix npm permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### Issue: `npm run build` fails with TS errors

**Cause:** Node or npm version too old.

**Fix:**

```bash
# Verify versions
node --version  # Must be >= 20.0.0
npm --version   # Must be >= 10.0.0

# Upgrade if needed
nvm install 20
nvm use 20
```

### Issue: `npm test` fails with module errors

**Cause:** Stale build artifacts.

**Fix:**

```bash
npm run clean
npm install
npm run build
npm test
```

### Issue: VS Code shows TypeScript errors but build succeeds

**Cause:** VS Code using wrong TypeScript version.

**Fix:**

1. Open Command Palette (`Cmd+Shift+P`)
2. Run "TypeScript: Select TypeScript Version"
3. Choose "Use Workspace Version"
4. Reload window

---

## Glossary

- **MCP:** Model Context Protocol - Standard for AI tool integration
- **Handler:** Class that implements tool business logic
- **Schema:** Zod schema defining input/output types
- **Action:** Specific operation within a tool (e.g., `read_range`)
- **Tool:** Collection of related actions (e.g., `sheets_data`)
- **Gate:** Validation checkpoint in progressive verification
- **Discriminated Union:** TypeScript pattern using `action` field
- **TDD:** Test-Driven Development - Write tests first

---

**Welcome aboard! We're excited to have you contributing to ServalSheets.**

**Questions?** Open a [GitHub Discussion](https://github.com/khill1269/servalsheets/discussions) or reach out in issues.

---

**Version:** 1.0
**Last Updated:** 2026-02-17
**Maintainers:** ServalSheets Core Team
