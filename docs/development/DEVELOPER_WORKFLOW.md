---
title: Developer Workflow Guide
category: development
last_updated: 2026-02-17
description: 'Complete onboarding and workflow guide for ServalSheets contributors'
version: 2.0
tags: [onboarding, workflow, development, testing, validation]
---

# Developer Workflow Guide

**Version:** 2.0 (Updated for Phase -1 validation infrastructure)
**For:** Contributors to ServalSheets
**Time to read:** 30-40 minutes
**Last Updated:** 2026-02-17

---

## Table of Contents

1. [Quick Start (5 minutes)](#quick-start-5-minutes)
2. [Setup (First Time)](#setup-first-time)
3. [⚡ Quick Reference Cards](#quick-reference-cards)
4. [Development Loop](#development-loop)
5. [Validation Gates (Phase -1)](#validation-gates-phase--1)
6. [Testing Discipline](#testing-discipline)
7. [Pre-PR Checklist](#pre-pr-checklist)
8. [Common Tasks](#common-tasks)
9. [Debugging Patterns](#debugging-patterns)
10. [Anti-Patterns](#anti-patterns)
11. [Common Error Scenarios](#common-error-scenarios)

---

## Quick Start (5 minutes)

**Goal:** Make your first contribution in 5 minutes.

```bash
# 1. Clone and setup
git clone https://github.com/khill1269/servalsheets.git
cd servalsheets
npm install

# 2. Create feature branch
git checkout -b fix/your-bug-name

# 3. Make changes (≤3 files recommended)
# Example: Edit src/handlers/values.ts

# 4. Verify locally
npm run verify  # typecheck + lint + format + test + drift

# 5. Commit and push
git add .
git commit -m "fix(values): handle empty arrays gracefully"
git push origin fix/your-bug-name

# 6. Create PR
# GitHub will show PR template - fill it out
```

**That's it!** The CI will run checks. See sections below for details.

---

## Setup (First Time)

### Prerequisites

```bash
# Required
node --version    # v20.0.0 or higher
npm --version     # v10.0.0 or higher
git --version     # v2.0 or higher

# Recommended
brew install ripgrep  # Faster search for verification scripts
```

### Environment Variables

**For local development:**

```bash
# Copy example (if it exists)
cp .env.example .env

# Or create .env with these values:
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
export NODE_ENV=development
export LOG_LEVEL=debug
```

**For testing:**

Tests use mock Google APIs by default (no real API calls required).

To test against real API (optional):

```bash
export TEST_REAL_API=true
npm run test:integration
```

### Verify Setup

```bash
npm run build     # Should complete without errors
npm test          # Should show 1761 passing tests
npm run verify    # Should pass all checks
```

If all three commands succeed, you're ready to contribute!

---

## ⚡ Quick Reference Cards

### Essential Commands (Memorize These)

```bash
# Verification (use before every commit)
npm run gates:g0               # 20s - Baseline checks
npm run verify                 # 45s - Full verification
npm run schema:commit          # 60s - Schema change workflow

# Testing (during development)
npm run test:fast              # 12s - Fast test suite
npm test -- <pattern>          # Run specific tests
npm run test:watch             # Auto-run on changes

# Checking (quick validation)
npm run check:drift            # 3s  - Metadata sync
npm run typecheck              # 10s - TypeScript errors
npm run lint                   # 8s  - Code quality
```

### VS Code Keyboard Shortcuts

Install from `.vscode/tasks.json`:

```
⌨️ VALIDATION GATES
Cmd+G Cmd+0    → G0: Baseline Integrity (20s)
Cmd+G Cmd+1    → G1: Metadata Consistency (8s)
Cmd+G Cmd+A    → All gates (3 min)

⌨️ TESTING
Cmd+Shift+T    → Run all tests
Cmd+Shift+F    → Test current file
Cmd+K Cmd+F    → Fast tests only

⌨️ QUICK CHECKS
Cmd+K Cmd+V    → Full verify
Cmd+K Cmd+C    → Check drift
Cmd+K Cmd+B    → Build

⌨️ SCHEMA WORKFLOW
Cmd+Shift+S    → Schema commit workflow
Cmd+Shift+M    → Generate metadata
```

**Setup:** Copy `.vscode/tasks.json` and `.vscode/keybindings.json` to your workspace.

### Common Workflows Cheat Sheet

#### 1️⃣ Bug Fix Workflow (10-20 min)

```bash
git checkout -b fix/issue-123
# 1. Write failing test
code tests/handlers/data.test.ts
npm test tests/handlers/data.test.ts  # ❌ Fails

# 2. Fix bug
code src/handlers/data.ts

# 3. Verify
npm test tests/handlers/data.test.ts  # ✅ Passes
npm run gates:g0                      # ✅ Quick check

# 4. Commit
git add tests/ src/
git commit -m "fix(data): handle empty arrays"
```

#### 2️⃣ Schema Change Workflow (2-5 min)

```bash
# 1. Edit schema
code src/schemas/data.ts
# Add action to z.enum([...])

# 2. ONE command completes everything
npm run schema:commit
# Runs: gen:metadata → check:drift → typecheck → test:fast → git add

# 3. Commit
git commit -m "feat(data): add export_csv action"
```

#### 3️⃣ Feature Addition Workflow (30-60 min)

```bash
git checkout -b feat/new-tool

# 1. Create files
code src/schemas/my-tool.ts       # Schema
code src/handlers/my-tool.ts      # Handler
code tests/handlers/my-tool.test.ts  # Tests

# 2. Register tool
code src/mcp/registration/tool-definitions.ts
# Add to TOOL_DEFINITIONS array

# 3. Generate metadata + verify
npm run schema:commit
npm run verify

# 4. Commit + PR
git add .
git commit -m "feat: add sheets_mytool handler"
git push origin feat/new-tool
```

### File Location Quick Reference

```
📁 Project Structure (What Goes Where)

src/
├── schemas/           → Zod schemas (source of truth)
│   ├── index.ts       → TOOL_COUNT, ACTION_COUNT (GENERATED)
│   ├── annotations.ts → ACTION_COUNTS map (GENERATED)
│   └── <tool>.ts      → Individual tool schemas
├── handlers/          → Business logic (1 per tool)
│   ├── base.ts        → BaseHandler class (inherit from this)
│   └── <tool>.ts      → Handler implementation
├── mcp/registration/  → MCP protocol layer
│   ├── tool-definitions.ts  → TOOL_DEFINITIONS array
│   ├── tool-handlers.ts     → Request routing
│   └── completions.ts       → TOOL_ACTIONS map (GENERATED)
├── services/          → Infrastructure services
├── utils/             → Shared utilities
└── cli.ts             → CLI entrypoint

tests/
├── contracts/         → Schema guarantees (667 tests)
├── handlers/          → Handler unit tests
├── integration/       → Cross-layer tests
└── unit/              → Pure unit tests

scripts/
├── generate-metadata.ts      → Regenerate counts
├── validation-gates.sh       → Multi-level gates
└── check-*.sh                → Verification scripts

docs/
├── development/       → Developer guides
├── guides/            → User guides
└── reference/         → API reference
```

### Error Message Quick Fixes

| Error                        | Cause                                 | Fix                             |
| ---------------------------- | ------------------------------------- | ------------------------------- |
| `❌ Metadata drift detected` | Schema changed without regen          | `npm run schema:commit`         |
| `❌ action is required`      | Missing action in discriminated union | Add to `z.enum([...])`          |
| `❌ Unknown action: xyz`     | Handler missing case                  | Add `case 'xyz':` to handler    |
| `❌ TODO found in src/`      | Placeholder in source                 | Remove or move to issue         |
| `❌ TypeScript error TS2345` | Type mismatch                         | Check schema vs handler types   |
| `❌ Schema/handler mismatch` | Action count mismatch                 | Check deviations or fix handler |

### Decision Tree: Which Command to Run?

```
START: What do you need?
│
├─ 📝 Changed schema file?
│  └─ npm run schema:commit (60s)
│
├─ 🐛 Fixed a bug?
│  └─ npm run gates:g0 (20s)
│
├─ ✨ Added new feature?
│  └─ npm run verify (45s)
│
├─ 🧪 Writing tests?
│  └─ npm run test:watch
│
├─ 📊 Before commit?
│  └─ npm run gates:g0 (20s)
│
├─ 🚀 Before PR?
│  └─ npm run verify (45s)
│
└─ 🎯 Before release?
   └─ npm run gates (3 min)
```

---

## Development Loop

Follow the **Red-Green-Refactor Cycle:**

### 1. Write Failing Test (Red 🔴)

```bash
# Create or edit test file
vim tests/handlers/values.test.ts

# Write test that fails
describe('values handler', () => {
  it('should handle empty arrays', async () => {
    const result = await handler.handle({
      action: 'read',
      spreadsheetId: 'test123',
      range: { a1: 'A1:A1' }
    });
    expect(result.values).toEqual([]);  // Currently fails
  });
});

# Run test to verify it fails
npm test tests/handlers/values.test.ts
# ❌ Expected [] but got undefined
```

### 2. Make It Pass (Green ✅)

```bash
# Edit handler
vim src/handlers/values.ts

# Add fix
if (!result.values || result.values.length === 0) {
  logger.debug('Empty values array', { spreadsheetId, range });
  return {
    response: {
      success: true,
      action: 'read',
      values: [],
      rowCount: 0
    }
  };
}

# Run test to verify it passes
npm test tests/handlers/values.test.ts
# ✅ 1 test passed
```

### 3. Refactor (Clean 🧹)

```bash
# Improve code quality
npm run lint       # Fix linting issues
npm run format     # Auto-format with Prettier
npm run typecheck  # Verify types

# Run all tests to ensure no regressions
npm test           # Should show 1762 passing tests now
```

### 4. Verify Before Commit

```bash
# Run full verification pipeline
npm run verify

# Output should show:
# ✅ Drift check passed
# ✅ No placeholders found
# ✅ Type check passed
# ✅ Lint passed
# ✅ Format check passed
# ✅ Tests passed (1762/1762)
```

---

## Validation Gates (Phase -1)

**Added:** 2026-02-17
**Purpose:** Incremental validation system for faster feedback

### What Are Validation Gates?

Validation gates are **progressive checkpoints** that validate different aspects of your code:

- **G0:** Quick baseline checks (20s) - Run before every commit
- **G1:** Metadata consistency (8s) - Run after schema changes
- **G2:** Phase behavior (45s) - Run after handler changes
- **G3:** API/Protocol/Docs (15s) - Run before doc updates
- **G4:** Final truth check (60s) - Run before releases

**Why gates?** Instead of running everything (3 min), run only what's needed (20s).

### Gate Levels Explained

#### G0: Baseline Integrity (MOST IMPORTANT)

**When:** Before EVERY commit
**Time:** ~20 seconds
**Command:** `npm run gates:g0` or `Cmd+G Cmd+0`

**What it checks:**

```bash
1. TypeScript compilation (tsc --noEmit)
2. ESLint rules
3. Metadata drift (schema sync)
4. Fast test suite (unit + contracts)
```

**Example output:**

```
🚦 Gate G0: Baseline Integrity
  ├─ TypeScript... ✅ (5.2s)
  ├─ ESLint... ✅ (3.8s)
  ├─ Drift check... ✅ (2.1s)
  └─ Fast tests... ✅ (8.9s)
✅ G0 passed (20.0s)
```

**If it fails:** Fix immediately - this is the minimum bar for code quality.

---

#### G1: Metadata Consistency

**When:** After schema changes
**Time:** ~8 seconds
**Command:** `npm run gates:g1` or `Cmd+G Cmd+1`

**What it checks:**

```bash
1. Schema/handler alignment (validate-action-counts.ts)
2. Documentation hardcoded counts (check-hardcoded-counts.sh)
```

**Example output:**

```
🚦 Gate G1: Metadata Consistency
  ├─ Action counts... ✅ (5.3s)
  └─ Doc counts... ✅ (2.8s)
✅ G1 passed (8.1s)
```

**Common failure:** Schema added action but handler didn't implement it.

**Fix:** Run `npm run schema:commit` which includes G1 automatically.

---

#### G2: Phase Behavior

**When:** After handler implementation, before phase completion
**Time:** ~45 seconds
**Command:** `npm run gates:g2` or `Cmd+G Cmd+2`

**What it checks:**

```bash
1. Handler tests (all 25 handlers)
2. Integration tests (cross-layer)
3. Compliance tests (MCP protocol)
```

**Use case:** You added a new action and handler - verify it works end-to-end.

---

#### G3: API/Protocol/Docs

**When:** Before documentation updates, after API changes
**Time:** ~15 seconds
**Command:** `npm run gates:g3` or `Cmd+G Cmd+3`

**What it checks:**

```bash
1. API compliance validation
2. MCP protocol compliance
3. Documentation validation (links, spelling, formatting)
```

**Use case:** You updated API documentation - verify all links work.

---

#### G4: Final Truth Check

**When:** Before npm publish, before releases
**Time:** ~60 seconds
**Command:** `npm run gates:g4` or `Cmd+G Cmd+4`

**What it checks:**

```bash
1. Production build (clean compile)
2. Runtime constant verification (TOOL_COUNT/ACTION_COUNT)
3. Smoke tests (--version check)
```

**Use case:** Final gate before release - ensures build artifacts are correct.

---

### Using Gates in Practice

#### Daily Development

```bash
# Morning: Start work
git pull
npm install
npm run gates:g0  # Baseline check (20s)

# During work: Quick checks
npm run test:fast  # Every 5-10 min

# Before each commit:
npm run gates:g0   # Quick validation (20s)
git add . && git commit -m "..."

# End of day:
npm run verify     # Full check (45s)
git push
```

#### Schema Changes

```bash
# Modify schema
code src/schemas/data.ts

# ONE command (includes G0 + G1)
npm run schema:commit  # 60s

# Commit
git commit -m "feat(data): add action"
```

#### Handler Changes

```bash
# Modify handler
code src/handlers/data.ts

# Run relevant gates
npm run gates:g0   # Baseline (20s)
npm run gates:g2   # Handler tests (45s)

# Commit
git add . && git commit -m "..."
```

#### Before PR

```bash
# Full verification
npm run verify     # 45s

# Or run all gates
npm run gates      # 3 min (G0→G4)
```

### Gate Failure Scenarios

#### Scenario 1: G0 Fails on Drift Check

```bash
npm run gates:g0

# Output:
# ✅ TypeScript (5.2s)
# ✅ ESLint (3.8s)
# ❌ Drift check failed (2.1s)
#    → Metadata out of sync

# Fix:
npm run schema:commit
```

#### Scenario 2: G1 Fails on Action Count

```bash
npm run gates:g1

# Output:
# ❌ Action count mismatch
#    sheets_data: 18 schema actions, 19 handler cases
#    Extra in handler: ['export_csv']

# Fix: Either
# 1. Add 'export_csv' to schema z.enum([...])
# OR
# 2. Remove case 'export_csv' from handler
```

#### Scenario 3: G2 Fails on Tests

```bash
npm run gates:g2

# Output:
# ❌ Handler tests failed (12.3s)
#    tests/handlers/data.test.ts:45
#    Expected 200 rows, got 0

# Fix: Debug test, fix handler logic
code tests/handlers/data.test.ts
npm test tests/handlers/data.test.ts
```

---

## Testing Discipline

### Test Types

ServalSheets uses three types of tests:

#### 1. Unit Tests (70% of tests)

- **Location:** `tests/handlers/`, `tests/services/`, `tests/schemas/`
- **Purpose:** Test individual functions/classes in isolation
- **Speed:** <100ms each
- **Mocks:** Mock Google APIs, external services

**Example:**

```typescript
// tests/handlers/values.test.ts
describe('ValuesHandler', () => {
  it('should return empty array for empty range', async () => {
    // Arrange
    mockApi.spreadsheets.values.get.mockResolvedValue({ data: {} });

    // Act
    const result = await handler.handle({
      action: 'read',
      spreadsheetId: 'test123',
      range: { a1: 'A1:A1' },
    });

    // Assert
    expect(result.response.values).toEqual([]);
  });
});
```

#### 2. Integration Tests (25% of tests)

- **Location:** `tests/integration/`
- **Purpose:** Test handler + service + schema interactions
- **Speed:** <1s each
- **Mocks:** Minimal (may use real API with `TEST_REAL_API=true`)

**Example:**

```typescript
// tests/integration/mcp-tools-list.test.ts
describe('MCP tools/list integration', () => {
  it('should return all 25 tools with valid schemas', async () => {
    const tools = await server.listTools();

    expect(tools.tools).toHaveLength(16);
    tools.tools.forEach((tool) => {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.name).toMatch(/^sheets_/);
    });
  });
});
```

#### 3. Contract Tests (5% of tests)

- **Location:** `tests/contracts/`
- **Purpose:** Verify schema transformations preserve semantics
- **Speed:** <100ms each

**Example:**

```typescript
// tests/contracts/schema-transformation.test.ts
describe('Zod → JSON Schema → MCP transformation', () => {
  it('should preserve discriminated union structure', () => {
    const zodSchema = SheetsValuesInputSchema;
    const jsonSchema = zodToJsonSchemaCompat(zodSchema);

    expect(jsonSchema.oneOf).toBeDefined();
    expect(jsonSchema.oneOf.length).toBeGreaterThan(0);
    expect(jsonSchema.oneOf[0].properties.action.const).toBe('read');

    // Verify no Zod properties leaked through
    verifyJsonSchema(jsonSchema);
  });
});
```

### When to Write Tests

**Before fixing a bug (TDD):**

1. Write test that reproduces the bug (fails)
2. Fix the bug
3. Verify test now passes

**When adding a feature:**

1. Write test for new functionality (fails)
2. Implement feature
3. Verify test passes

**When refactoring:**

1. Ensure existing tests pass
2. Refactor code
3. Verify tests still pass (no behavior change)

### Test Naming Convention

```typescript
describe('[Module/Class name]', () => {
  describe('[method/function name]', () => {
    it('should [expected behavior] when [condition]', () => {
      // Test implementation
    });
  });
});
```

**Examples:**

- `should return values when range exists`
- `should return empty array when range is empty`
- `should throw NotFoundError when spreadsheet missing`

---

## Pre-PR Checklist

Before creating a pull request, verify:

### 1. Code Quality ✓

```bash
- [ ] npm run typecheck       # No TypeScript errors
- [ ] npm run lint            # No linting issues
- [ ] npm run format:check    # Code is formatted
```

### 2. Tests ✓

```bash
- [ ] npm test                # All tests pass (1761+)
- [ ] npm run test:coverage   # Coverage meets thresholds (75%+)
- [ ] Added tests for new code
- [ ] Added tests for bug fixes
```

### 3. Build ✓

```bash
- [ ] npm run build           # Compiles successfully
- [ ] npm run verify:build    # Build + validation + smoke test
```

### 4. Verification Scripts ✓

```bash
- [ ] npm run check:drift          # Metadata synchronized
- [ ] npm run check:placeholders   # No TODO/FIXME in src/
- [ ] npm run check:silent-fallbacks  # No silent {} returns
```

### 5. Clean Diff ✓

```bash
- [ ] git status              # Only relevant files staged
- [ ] git diff --staged       # Diff is clean and focused
- [ ] ≤3 src/ files modified (or justified in PR)
```

### 6. Commit Message ✓

```bash
- [ ] Follows convention: type(scope): description

Examples:
  fix(values): handle empty arrays gracefully
  feat(charts): add bar chart support
  docs(readme): update installation steps
  test(values): add edge case coverage
```

### 7. PR Description ✓

```markdown
- [ ] Evidence provided (file paths + line ranges)
- [ ] Execution path documented (if multi-layer)
- [ ] Test coverage linked
- [ ] Follows Claude Code Rules (see CLAUDE_CODE_RULES.md)
```

---

## Common Tasks

### Task 1: Add New Tool

**Time:** 30-60 minutes

```bash
# 1. Define schema
vim src/schemas/my-tool.ts

export const MyToolInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('do_thing'),
    spreadsheetId: z.string(),
    param: z.string()
  }),
]);

export const MyToolOutputSchema = z.object({
  response: z.discriminatedUnion('success', [
    z.object({
      success: z.literal(true),
      action: z.string(),
      data: z.unknown()
    }),
    z.object({
      success: z.literal(false),
      error: ErrorDetailSchema
    })
  ])
});

# 2. Create handler
vim src/handlers/my-tool.ts

export class MyToolHandler extends BaseHandler<MyToolInput, MyToolOutput> {
  async handle(input: MyToolInput): Promise<HandlerResult<MyToolOutput>> {
    // Implementation
    const result = await this.apiService.doSomething();

    return {
      response: {
        success: true,
        action: input.action,
        data: result
      }
    };
  }
}

# 3. Register tool
vim src/mcp/registration/tool-definitions.ts

// Add to TOOL_DEFINITIONS array
{
  name: 'sheets_mytool',
  description: 'Does something with spreadsheets',
  inputSchema: MyToolInputSchema,
  outputSchema: MyToolOutputSchema
}

# 4. Generate metadata
npm run gen:metadata
# Updates: package.json, src/schemas/index.ts, src/mcp/completions.ts, server.json

# 5. Add tests
vim tests/handlers/my-tool.test.ts

describe('MyToolHandler', () => {
  it('should do thing successfully', async () => {
    // Test implementation
  });
});

# 6. Verify
npm run verify
```

### Task 2: Modify Schema

**Time:** 15-30 minutes

```bash
# 1. Update schema
vim src/schemas/values.ts

# Add new optional field
export const ReadValuesInput = z.object({
  action: z.literal('read'),
  spreadsheetId: z.string(),
  range: RangeInputSchema,
  newField: z.string().optional(),  # ← New field
});

# 2. Regenerate metadata
npm run gen:metadata
# ✅ Updates 5 generated files automatically

# 3. Check drift
npm run check:drift
# ✅ No drift detected

# 4. Update tests
vim tests/handlers/values.test.ts

it('should handle new field', async () => {
  const result = await handler.handle({
    action: 'read',
    spreadsheetId: 'test123',
    range: { a1: 'A1:B10' },
    newField: 'test-value'
  });
  // Assertions
});

# 5. Update handler (if needed)
vim src/handlers/values.ts

# 6. Verify
npm run verify
```

### Task 3: Fix Bug

**Time:** 20-40 minutes

```bash
# 1. Reproduce bug with test (fails first)
vim tests/handlers/values.test.ts

it('should handle edge case X', async () => {
  const result = await handler.handle({
    action: 'read',
    spreadsheetId: 'test123',
    range: { a1: '' }  # Edge case: empty range
  });
  expect(result.response.success).toBe(true);
});

npm test tests/handlers/values.test.ts
# ❌ Fails as expected

# 2. Fix bug
vim src/handlers/values.ts

if (!input.range || !input.range.a1) {
  throw new ValidationError(
    'INVALID_RANGE',
    'Range A1 notation is required'
  );
}

# 3. Verify test passes
npm test tests/handlers/values.test.ts
# ✅ Passes now

# 4. Run full suite
npm test
# ✅ All tests pass (1762/1762)

# 5. Commit
git add tests/handlers/values.test.ts src/handlers/values.ts
git commit -m "fix(values): validate range A1 notation before processing"
```

---

## Debugging Patterns

### Pattern 1: Trace from Entrypoint

**Problem:** Handler returns unexpected result.

**Solution:** Trace execution path from CLI → handler.

```bash
# 1. Enable debug logging
export LOG_LEVEL=debug
export NODE_ENV=development

# 2. Add strategic logging (remove after debugging)
# Entry: src/cli.ts:75
console.log('[DEBUG] CLI input:', process.argv);

# Server: src/server.ts:123
console.log('[DEBUG] Tool call:', toolName, args);

# Handler: src/handlers/values.ts:89
console.log('[DEBUG] Handler input:', input);

# Service: src/services/google-api.ts:234
console.log('[DEBUG] API response:', result);

# 3. Run with debugger (optional)
node --inspect-brk dist/cli.js

# 4. Or examine logs
npm run dev | grep DEBUG
```

### Pattern 2: Verify Schemas

**Problem:** Zod validation fails unexpectedly.

**Solution:** Use schema inspection utilities.

```bash
# 1. Inspect schema in REPL
npm run dev

> import { SheetsValuesInputSchema } from './src/schemas/values.js';
> const result = SheetsValuesInputSchema.safeParse({
    action: 'read',
    spreadsheetId: 'test123'
  });
> console.log(result);
# { success: false, error: [ZodError: Missing range] }

# 2. Use verifyJsonSchema in development mode
# File: src/utils/schema-compat.ts

if (process.env.NODE_ENV === 'development') {
  verifyJsonSchema(inputSchema, 'SheetsValuesInput');
}

# 3. Run contract tests
npm test tests/contracts/
```

### Pattern 3: Isolate with Unit Test

**Problem:** Integration test fails, unclear which component.

**Solution:** Write focused unit test.

```bash
# 1. Create minimal reproduction
vim tests/debug/reproduce-bug.test.ts

describe('Bug isolation', () => {
  it('isolates the specific issue', () => {
    const handler = new ValuesHandler(mockContext, mockApi);

    const result = handler.formatResponse({ values: [] });

    expect(result).toBeDefined();  // Fails here - found the issue!
    expect(result.values).toEqual([]);
  });
});

npm test tests/debug/reproduce-bug.test.ts

# 2. Fix the isolated issue in src/handlers/values.ts

# 3. Remove debug test (or move to regular tests)
rm tests/debug/reproduce-bug.test.ts
```

---

## Anti-Patterns

### ❌ Anti-Pattern 1: Silent Fallbacks

**Bad:**

```typescript
function getConfig(): Config {
  try {
    return loadConfig();
  } catch {
    return {}; // Silent failure - no logging!
  }
}
```

**Good:**

```typescript
function getConfig(): Config {
  try {
    return loadConfig();
  } catch (error) {
    logger.error('Failed to load config', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new ConfigurationError('CONFIG_LOAD_FAILED', 'Unable to load configuration');
  }
}
```

### ❌ Anti-Pattern 2: Generic Errors

**Bad:**

```typescript
throw new Error('Something went wrong');
```

**Good:**

```typescript
throw new SheetNotFoundError(`Sheet "${sheetName}" not found in spreadsheet ${spreadsheetId}`, {
  spreadsheetId,
  sheetName,
  availableSheets,
});
```

### ❌ Anti-Pattern 3: Direct API Calls

**Bad:**

```typescript
const result = await googleapis.sheets.spreadsheets.values.get({
  spreadsheetId,
  range,
});
```

**Good:**

```typescript
const result = await this.sheetsService.readValues(spreadsheetId, range, {
  valueRenderOption: 'FORMATTED_VALUE',
});
```

**Why:** Service layer provides:

- Rate limiting
- Caching
- Error handling
- Retry logic
- Logging

### ❌ Anti-Pattern 4: Skipping Verification

**Bad:**

```bash
# Make changes
git add .
git commit -m "fix"
git push
# CI fails - wastes time
```

**Good:**

```bash
# Make changes
npm run verify  # Run locally first (2-3 minutes)
git add .
git commit -m "fix(values): handle empty arrays gracefully"
git push
# CI passes - saves time
```

---

## IDE Setup (Optional)

### VS Code

**Recommended extensions:**

- ESLint (`dbaeumer.vscode-eslint`)
- Prettier (`esbenp.prettier-vscode`)
- TypeScript (`ms-vscode.vscode-typescript-next`)
- GitLens (`eamodio.gitlens`)
- Vitest (`vitest.explorer`)

**Settings (.vscode/settings.json):**

```json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "vitest.enable": true
}
```

### Debug Configuration (.vscode/launch.json)

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug CLI",
      "program": "${workspaceFolder}/src/cli.ts",
      "runtimeArgs": ["-r", "tsx"],
      "env": {
        "NODE_ENV": "development",
        "LOG_LEVEL": "debug"
      }
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Tests",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["test", "--", "${file}"]
    }
  ]
}
```

---

## Common Error Scenarios

**New in v2.0:** Comprehensive troubleshooting guide based on 6 months of development.

### Build & Compilation Errors

#### Error: `TS2345: Argument of type 'X' is not assignable to type 'Y'`

**Cause:** Type mismatch between schema definition and handler usage.

**Example:**

```typescript
// Schema defines:
action: z.literal('read_range');

// Handler tries:
const action: string = input.action; // ❌ Wrong type
```

**Fix:**

```typescript
// Use discriminated union properly:
const action: 'read_range' = input.action; // ✅ Correct

// Or use schema type:
type Input = z.infer<typeof SheetsDataInputSchema>;
const action: Input['action'] = input.action; // ✅ Also correct
```

**Prevention:** Always use `z.infer<typeof Schema>` for handler types.

---

#### Error: `TS2322: Type 'undefined' is not assignable to type 'string'`

**Cause:** Optional field not handled in handler.

**Example:**

```typescript
// Schema:
range: z.string().optional();

// Handler:
const range: string = input.range; // ❌ Might be undefined
```

**Fix:**

```typescript
// Option 1: Handle undefined
const range: string | undefined = input.range;
if (!range) throw new ValidationError('Range required');

// Option 2: Use default
const range = input.range ?? 'A1:Z100';

// Option 3: Non-null assertion (only if certain)
const range = input.range!;
```

---

#### Error: `Cannot find module './schemas/index.js'`

**Cause:** Import path uses `.ts` extension or is missing `.js`.

**Fix:**

```typescript
// ❌ Wrong
import { Schema } from './schemas/index';
import { Schema } from './schemas/index.ts';

// ✅ Correct (ESM requires .js)
import { Schema } from './schemas/index.js';
```

**Why:** TypeScript ESM modules require `.js` extensions even for `.ts` files.

---

### Metadata & Schema Errors

#### Error: `❌ Metadata drift detected`

**Cause:** Schema file modified without regenerating metadata.

**Files out of sync:**

- `src/schemas/index.ts` (TOOL_COUNT, ACTION_COUNT)
- `src/schemas/annotations.ts` (ACTION_COUNTS)
- `src/mcp/completions.ts` (TOOL_ACTIONS)
- `server.json` (full metadata)
- `package.json` (description)

**Fix:**

```bash
npm run schema:commit
# Automatically regenerates all 5 files + runs verification
```

**Prevention:** ALWAYS use `npm run schema:commit` after schema changes.

---

#### Error: `❌ Schema/handler action count mismatch`

**Cause:** Schema defines actions that handler doesn't implement (or vice versa).

**Example:**

```typescript
// Schema: 18 actions
action: z.enum(['read', 'write', 'update', 'delete', ...])

// Handler: 19 cases (extra 'export')
switch (action) {
  case 'read': ...
  case 'write': ...
  case 'export': ...  // ❌ Not in schema!
}
```

**Fix Option 1:** Add to schema

```typescript
action: z.enum(['read', 'write', 'update', 'delete', 'export', ...])
npm run schema:commit
```

**Fix Option 2:** Remove from handler

```typescript
switch (action) {
  case 'read': ...
  case 'write': ...
  // Removed 'export' case
}
```

**Fix Option 3:** Document as acceptable deviation

```typescript
// In src/schemas/handler-deviations.ts
export const ACCEPTABLE_DEVIATIONS = {
  sheets_data: ['export'], // Alias for 'export_csv'
};
```

---

#### Error: `❌ action is required`

**Cause:** Test input missing `action` field or not wrapped in legacy envelope.

**Example:**

```typescript
// ❌ Wrong (for tests)
const input = {
  spreadsheetId: 'test123',
  range: 'A1:B10',
};

// ✅ Correct (legacy envelope)
const input = {
  request: {
    action: 'read_range',
    spreadsheetId: 'test123',
    range: 'A1:B10',
  },
};
```

**Why:** Tests need legacy envelope wrapper, production MCP requests don't.

---

### Test Failures

#### Error: `Expected [] but got undefined`

**Cause:** Handler returns `undefined` instead of empty array.

**Example:**

```typescript
// ❌ Wrong
if (!values) return undefined;

// ✅ Correct
if (!values || values.length === 0) {
  return {
    response: {
      success: true,
      values: [],
    },
  };
}
```

---

#### Error: `Timeout of 5000ms exceeded`

**Cause:** Test makes real API call instead of using mock.

**Fix:**

```typescript
// Add mock before test
mockApi.spreadsheets.values.get.mockResolvedValue({
  data: { values: [['test']] },
});

// Verify mock was called
expect(mockApi.spreadsheets.values.get).toHaveBeenCalled();
```

---

#### Error: `Test suite failed to run` (import error)

**Cause:** Circular dependency or missing mock.

**Fix:**

```typescript
// Check for circular imports
npm run check:architecture

// Ensure vi.mock() is before imports
vi.mock('../services/google-api', () => ({
  GoogleApiClient: vi.fn()
}));

import { handler } from '../handlers/data.js';
```

---

### Runtime Errors

#### Error: `Unknown action: xyz`

**Cause:** MCP client sent action not defined in schema.

**Debug:**

```bash
# Check what actions are defined
npm run show:tools | grep xyz

# Check handler switch statement
grep "case 'xyz'" src/handlers/*.ts
```

**Fix:** Add action to schema and handler, then `npm run schema:commit`.

---

#### Error: `Sheet not found`

**Cause:** Invalid spreadsheet ID or missing permissions.

**Debug:**

```typescript
// Add logging in handler
logger.debug('Attempting to access spreadsheet', {
  spreadsheetId,
  sheetName,
  userId,
});

// Check Google API response
const result = await this.context.googleClient.sheets.spreadsheets.get({
  spreadsheetId,
});
logger.debug('Spreadsheet response', result);
```

**Common causes:**

1. Wrong spreadsheet ID format
2. Spreadsheet deleted
3. OAuth token expired
4. Missing Drive API scope

---

#### Error: `CircuitBreakerOpen: Too many failures`

**Cause:** Google API endpoint failing repeatedly (>5 times).

**Debug:**

```bash
# Check circuit breaker state
npm run metrics | grep circuit_breaker

# Check error logs
grep "Circuit breaker" logs/servalsheets.log
```

**Fix:**

1. Wait 30s for half-open state
2. Check Google API status: https://www.google.com/appsstatus
3. Verify OAuth credentials
4. Check rate limits

---

### Documentation Errors

#### Error: `❌ Hardcoded count found in docs`

**Cause:** Documentation has hardcoded tool/action counts instead of references.

**Example:**

```markdown
❌ Wrong:
ServalSheets has 25 tools and 407 actions.

✅ Correct:
ServalSheets has 25 tools and 407 actions (see src/schemas/index.ts:63).
```

**Fix:**

```bash
# Find all hardcoded counts
bash scripts/check-hardcoded-counts.sh

# Update documentation with source references
code docs/README.md
```

---

#### Error: `❌ Broken link: docs/guides/MISSING.md`

**Cause:** Documentation references file that doesn't exist.

**Fix:**

```bash
# Check all doc links
npm run docs:check-links

# Fix broken links
code docs/path/to/file.md
```

---

### VS Code / Editor Issues

#### Error: "Cannot find module" (red squiggles) but builds fine

**Cause:** VS Code TypeScript version out of sync.

**Fix:**

1. Open Command Palette (`Cmd+Shift+P`)
2. Run "TypeScript: Select TypeScript Version"
3. Choose "Use Workspace Version"
4. Reload window

---

#### Error: ESLint not running in VS Code

**Cause:** ESLint extension not installed or disabled.

**Fix:**

```bash
# Install extension
code --install-extension dbaeumer.vscode-eslint

# Verify in .vscode/settings.json
{
  "eslint.enable": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  }
}
```

---

### Quick Diagnostic Commands

```bash
# Check current state
npm run verify 2>&1 | tee verify.log   # Full verification with log

# TypeScript issues
npm run typecheck                      # Compile errors
npm run typecheck -- --listFilesOnly   # See all included files

# Metadata issues
npm run check:drift                    # Metadata sync
npm run validate:actions               # Action count alignment

# Test issues
npm test -- --reporter=verbose         # Detailed test output
npm test -- --no-coverage              # Skip coverage (faster)

# Build issues
npm run clean                          # Clean dist/
npm run build 2>&1 | tee build.log     # Build with log
```

---

## Resources

### Internal Documentation

- **[Claude Code Rules](./CLAUDE_CODE_RULES.md)** - Contribution guidelines (required reading)
- **[Codebase Audit Report](./AUDIT_REPORT_2026-01-11.md)** - Current violations + good patterns
- **[Handler Patterns](./HANDLER_PATTERNS.md)** - Handler implementation guide
- **[Testing Guide](./TESTING.md)** - Comprehensive testing strategies
- **[Documentation Index](./DOCUMENTATION.md)** - Complete documentation map

### External Resources

- **[MCP Protocol Spec](https://spec.modelcontextprotocol.io)** - Model Context Protocol specification
- **[Google Sheets API v4](https://developers.google.com/sheets/api)** - Official API documentation
- **[Zod Documentation](https://zod.dev)** - Schema validation library
- **[Vitest Documentation](https://vitest.dev)** - Test framework

### Getting Help

- **GitHub Issues:** https://github.com/khill1269/servalsheets/issues
- **Discussions:** https://github.com/khill1269/servalsheets/discussions

---

## Version History

**v1.0 (2026-01-11):** Initial workflow guide

---

## Feedback

Found an issue or have a suggestion? Open an issue or PR!
