---
title: ServalSheets - Scripts Reference
category: development
last_updated: 2026-02-17
description: 'Comprehensive documentation of all scripts and npm commands'
version: 1.6.0
tags: [scripts, validation, gates, development]
---

# ServalSheets - Scripts Reference

**Last Updated:** 2026-02-17
**Purpose:** Complete reference for all scripts and npm commands in ServalSheets

---

## 🎯 Quick Reference

### Essential Commands (Use These Daily)

| Command                 | Purpose                    | When to Use             | Time   |
| ----------------------- | -------------------------- | ----------------------- | ------ |
| `npm run verify`        | Full verification pipeline | Before every commit     | 30-45s |
| `npm run schema:commit` | Schema change workflow     | After modifying schemas | 60s    |
| `npm run gates:g0`      | Baseline integrity check   | Quick verification      | 20s    |
| `npm run test:fast`     | Fast test suite            | During development      | 8-12s  |
| `npm run check:drift`   | Metadata sync check        | After schema changes    | 3s     |

### Validation Scripts (Part of Verify)

| Script                                 | Purpose                     | Usage                                    | Part of Verify    |
| -------------------------------------- | --------------------------- | ---------------------------------------- | ----------------- |
| `generate-metadata.ts`                 | Generate tool/action counts | `npm run gen:metadata`                   | Via `check:drift` |
| `check-metadata-drift.sh`              | Verify metadata sync        | `npm run check:drift`                    | ✅ Yes            |
| `no-placeholders.sh`                   | Check for TODO/FIXME        | `npm run check:placeholders`             | ✅ Yes            |
| `check-silent-fallbacks.sh`            | Find silent returns         | `npm run check:silent-fallbacks`         | ❌ No (optional)  |
| `check-debug-prints.sh`                | Find console.log            | `npm run check:debug-prints`             | ❌ No (optional)  |
| `validate-action-counts.ts`            | ESM-based action validation | `npm run validate:actions`               | ✅ Yes            |
| `validate-schema-handler-alignment.ts` | Schema/handler sync         | `npm run validate:alignment`             | ✅ Yes            |
| `check-hardcoded-counts.sh`            | Scan docs for count drift   | `bash scripts/check-hardcoded-counts.sh` | Via gates:g1      |

### Diagnostic Scripts

| Script                       | Purpose                    | Usage                |
| ---------------------------- | -------------------------- | -------------------- |
| `show-tools-list-schemas.ts` | Display tool schemas       | `npm run show:tools` |
| `show-metrics.ts`            | Display Prometheus metrics | `npm run metrics`    |
| `validation-gates.sh`        | Multi-level gate pipeline  | `npm run gates`      |

---

## 🚦 Validation Gates (Phase -1 Infrastructure)

**Added:** 2026-02-17
**Purpose:** Multi-level validation pipeline for incremental verification

### Gate Overview

ServalSheets uses a 5-level gate system (G0-G4) that progressively validates different aspects:

| Gate   | Name                 | Purpose                        | Time | Commands           |
| ------ | -------------------- | ------------------------------ | ---- | ------------------ |
| **G0** | Baseline Integrity   | Essential checks before commit | ~20s | `npm run gates:g0` |
| **G1** | Metadata Consistency | Schema/handler/doc alignment   | ~8s  | `npm run gates:g1` |
| **G2** | Phase Behavior       | Handler + integration tests    | ~45s | `npm run gates:g2` |
| **G3** | API/Protocol/Docs    | Compliance + documentation     | ~15s | `npm run gates:g3` |
| **G4** | Final Truth Check    | Build + runtime verification   | ~60s | `npm run gates:g4` |

### Gate Details

#### G0: Baseline Integrity (ALWAYS run before commit)

```bash
npm run gates:g0
# Runs: typecheck + lint + check:drift + test:fast
```

**What it checks:**

- TypeScript compilation (strict mode)
- ESLint rules
- Metadata synchronization
- Unit + contract tests (fast suite)

**When to run:** Before every commit (automated via VS Code shortcut `Cmd+G Cmd+0`)

**Exit on failure:** Yes - fix issues before committing

---

#### G1: Metadata Consistency

```bash
npm run gates:g1
# Runs: cross-map consistency test + hardcoded counts check
```

**What it checks:**

- Schema action counts match handler implementations
- Documentation has correct tool/action counts
- No hardcoded numbers out of sync

**When to run:** After schema changes (automated via `npm run schema:commit`)

**Exit on failure:** Yes - run `npm run gen:metadata` to fix

---

#### G2: Phase Behavior

```bash
npm run gates:g2
# Runs: test:handlers + test:integration + test:compliance
```

**What it checks:**

- All 25 tools work correctly
- Integration between layers
- MCP protocol compliance

**When to run:** Before phase completion, after major changes

**Exit on failure:** Yes - fix broken handlers/tests

---

#### G3: API/Protocol/Docs

```bash
npm run gates:g3
# Runs: validate:compliance + docs:validate
```

**What it checks:**

- Google Sheets API compliance
- MCP 2025-11-25 protocol compliance
- Documentation links + formatting

**When to run:** Before releasing, after API changes

**Exit on failure:** Yes - fix compliance issues

---

#### G4: Final Truth Check

```bash
npm run gates:g4
# Runs: build + runtime constant verification
```

**What it checks:**

- Clean production build
- Runtime TOOL_COUNT/ACTION_COUNT match source
- No build-time errors

**When to run:** Before npm publish, before releases

**Exit on failure:** Yes - critical issue, do not release

---

### Running All Gates

```bash
# Run complete gate pipeline G0→G4
npm run gates

# Output shows pass/fail for each gate:
# ✅ G0: Baseline Integrity (22.3s)
# ✅ G1: Metadata Consistency (8.1s)
# ✅ G2: Phase Behavior (46.7s)
# ✅ G3: API/Protocol/Docs (14.2s)
# ✅ G4: Final Truth Check (58.9s)
#
# 🎉 All gates passed (150.2s total)
```

**Use case:** Before releases, after major refactoring

---

### VS Code Integration

**Keyboard shortcuts configured in `.vscode/tasks.json`:**

```
Cmd+G Cmd+0  → G0: Baseline (before commit)
Cmd+G Cmd+1  → G1: Metadata (after schema change)
Cmd+G Cmd+2  → G2: Phase behavior
Cmd+G Cmd+3  → G3: API/Protocol/Docs
Cmd+G Cmd+4  → G4: Final truth
Cmd+G Cmd+A  → All gates (G0-G4)
```

**Why keyboard shortcuts?** Gates run frequently during development - shortcuts save 5-10 seconds per run.

---

## 📝 Metadata Generation Scripts

### `generate-metadata.ts` ⭐ CRITICAL

**Purpose:** Single source of truth for tool/action metadata generation

**What it does:**

1. Parses all `src/schemas/*.ts` files using TypeScript AST
2. Extracts action arrays from `z.enum([...])` or `z.literal('action')`
3. Updates 5 generated files with correct counts

**Input (Source of Truth):**

- `src/schemas/*.ts` (all current tool schemas)
- Looks for:

  ```typescript
  action: z.enum(['action1', 'action2', ...])
  // OR
  action: z.literal('single_action')
  ```

**Output (Generated - DO NOT edit manually):**

- `package.json` - Updates description with `"25 tools, 407 actions"`
- `src/schemas/index.ts` - Updates `TOOL_COUNT` and `ACTION_COUNT` constants
- `src/schemas/annotations.ts` - Updates `ACTION_COUNTS` object
- `src/mcp/completions.ts` - Updates `TOOL_ACTIONS` object
- `server.json` - Regenerates full MCP server metadata

**Special Cases Handled:**

- `fix.ts` - Single action tool (no enum)
- `analyze.ts` - 11 actions (comprehensive, analyze_data, suggest_visualization, generate_formula, detect_patterns, analyze_structure, analyze_quality, analyze_performance, analyze_formulas, query_natural_language, explain_analysis)
- `confirm.ts` - 2 actions (request, get_stats)

**Usage:**

```bash
# After modifying any schema file
npm run gen:metadata

# Output:
# 📊 Analyzing 16 schema files...
#   📝 advanced.ts → 19 actions [add_named_range, update_named_range, ...]
#   ...
# ✅ Total: 25 tools, 407 actions
# ✅ Updated src/schemas/index.ts constants
# ✅ Updated src/schemas/annotations.ts ACTION_COUNTS
# ✅ Updated src/mcp/completions.ts TOOL_ACTIONS
# ✅ Generated server.json
```

**Algorithm Details:**

- Uses TypeScript Compiler API (`ts.createSourceFile()`)
- Traverses AST to find `z.enum()` and `z.literal()` calls
- Handles method chaining (`.describe()`, `.optional()`, etc.)
- Falls back to special cases for tools not following standard pattern

**Line Reference:** `scripts/generate-metadata.ts:1-400`

**Critical:** This script MUST be run after ANY schema modification.

---

### `validate-action-counts.ts` ⭐ IMPROVED (Phase -1)

**Purpose:** ESM-based validation of action counts using real TypeScript imports

**What changed in Phase -1:**

- ❌ **Old:** Regex-based text parsing (brittle, missed aliases)
- ✅ **New:** ESM imports with TypeScript AST analysis

**What it validates:**

1. **Schema action counts** - Parses `z.enum([...])` arrays
2. **Handler case statements** - Counts `case 'action':` entries
3. **Acceptable deviations** - Checks `src/schemas/handler-deviations.ts`
4. **Aliases** - Tracks documented shortcuts (e.g., `copy_to` → `copy_sheet_to`)

**Usage:**

```bash
npm run validate:actions

# Success:
# ✅ All 25 tools validated
# ✅ Schema/handler alignment: 100%
# ✅ 0 undocumented deviations

# Failure:
# ❌ sheets_core: 6 schema actions, 8 handler cases
# Missing in handler: ['action_a', 'action_b']
# Extra in handler: ['action_x', 'action_y']
# Check src/handlers/core.ts and src/schemas/core.ts
```

**How it works:**

```typescript
// 1. Import schema directly (no parsing)
import { SheetsDataInputSchema } from '../src/schemas/data.ts';

// 2. Extract actions via Zod introspection
const actions = extractActionsFromSchema(SheetsDataInputSchema);

// 3. Parse handler file via TypeScript AST
const handlerActions = extractCasesFromHandler('src/handlers/data.ts');

// 4. Compare with acceptable deviations
const deviations = ACCEPTABLE_DEVIATIONS['sheets_data'] || [];
const mismatches = compareActions(actions, handlerActions, deviations);
```

**Why this matters:** Prevents "action not found" runtime errors by catching mismatches at CI time.

---

### `check-hardcoded-counts.sh` 🔍 NEW (Phase -1)

**Purpose:** Scan documentation for hardcoded tool/action counts that may drift

**What it scans:**

- `README.md`
- `docs/guides/*.md` (38 files)
- `docs/development/*.md` (12 files)
- `docs/reference/*.md` (8 files)
- `CLAUDE.md`

**Pattern detection:**

```bash
# Matches:
"25 tools"           # Hardcoded count
"407 actions"        # Hardcoded count
"Currently 25 tools" # Potentially stale
"All 25 tools"       # Hardcoded count

# Ignores:
"See src/schemas/index.ts:63" # Reference to source
"TOOL_COUNT constant"         # Reference to constant
"Currently ${TOOL_COUNT}"     # Template variable
```

**Usage:**

```bash
bash scripts/check-hardcoded-counts.sh

# Success:
# ✅ Checking 58 documentation files...
# ✅ No hardcoded counts found

# Failure:
# ❌ Found hardcoded counts in 3 files:
#
# README.md:42
#   "ServalSheets provides 25 tools with 407 actions"
#   → Should reference: src/schemas/index.ts:63
#
# docs/guides/QUICKSTART.md:18
#   "All 25 tools registered in server"
#   → Should reference: src/handlers/index.ts
#
# Fix: Replace hardcoded numbers with source references
```

**Why this matters:** Prevents documentation drift when tools/actions are added/removed.

**Part of:** `npm run gates:g1` (Metadata Consistency gate)

---

### `multi-agent-test.sh` 🤖 FIXED (Phase -1)

**Purpose:** Run multi-agent analysis tests using real vitest execution

**What changed in Phase -1:**

- ❌ **Old:** Simulator mode (always passed, no real validation)
- ✅ **New:** Real vitest execution with proper test discovery

**What it tests:**

1. **Pattern recognition agent** - Detects code patterns
2. **Type safety agent** - Checks TypeScript usage
3. **Code quality agent** - Reviews code quality
4. **Orchestrator** - Coordinates agents

**Usage:**

```bash
bash scripts/multi-agent-test.sh

# Success:
# ✅ Found 4 test files
# ✅ Running vitest...
# ✅ 8/8 tests passed
# ✅ All agents operational

# Failure:
# ❌ Pattern recognition agent: 2 tests failed
# ❌ See tests/analysis/pattern-recognition-agent.test.ts
```

**Location:** `scripts/multi-agent-test.sh`

**Part of:** CI pipeline, called by GitHub Actions

---

### `validation-gates.sh` 🚦 NEW (Phase -1)

**Purpose:** Execute multi-level validation pipeline (G0-G4)

**Location:** `scripts/validation-gates.sh`

**Usage:**

```bash
# Run all gates
bash scripts/validation-gates.sh

# Run specific gate
bash scripts/validation-gates.sh g0
bash scripts/validation-gates.sh g1
bash scripts/validation-gates.sh g2
bash scripts/validation-gates.sh g3
bash scripts/validation-gates.sh g4
```

**Output format:**

```
🚦 Validation Gates Pipeline
═══════════════════════════════════════

Running Gate G0: Baseline Integrity
  ├─ TypeScript check... ✅ (5.2s)
  ├─ ESLint... ✅ (3.8s)
  ├─ Metadata drift... ✅ (2.1s)
  └─ Fast tests... ✅ (8.9s)
✅ G0 passed (20.0s)

Running Gate G1: Metadata Consistency
  ├─ Cross-map consistency... ✅ (5.3s)
  └─ Hardcoded counts... ✅ (2.8s)
✅ G1 passed (8.1s)

... (G2-G4) ...

═══════════════════════════════════════
🎉 All gates passed (150.2s total)
```

**Exit codes:**

- `0` - All gates passed
- `1` - One or more gates failed

**Integration:** Called by `npm run gates` and VS Code tasks

---

### `check-metadata-drift.sh`

**Purpose:** Verify metadata is synchronized across all 5 generated files

**What it does:**

1. Runs `generate-metadata.ts` in dry-run mode
2. Compares output against current file contents
3. Reports any drift (files out of sync)

**Checks:**

- ✅ `package.json` - Description matches tool/action counts
- ✅ `src/schemas/index.ts` - Constants match
- ✅ `src/schemas/annotations.ts` - ACTION_COUNTS matches
- ✅ `src/mcp/completions.ts` - TOOL_ACTIONS matches
- ✅ `server.json` - Full metadata matches

**Usage:**

```bash
npm run check:drift

# Success output:
# ✅ No metadata drift detected - all 5 files are synchronized

# Failure output:
# ❌ Metadata drift detected in 2 files:
#   - package.json (expected 407 actions, found 53)
#   - src/schemas/index.ts (expected ACTION_COUNT = 207, found 53)
# Run 'npm run gen:metadata' to fix
```

**Part of:** `npm run verify` pipeline (critical check)

**Exit codes:**

- `0` - No drift
- `1` - Drift detected

---

## 🚨 Quality Check Scripts (Part of `npm run verify`)

### `no-placeholders.sh`

**Purpose:** Ensure no TODO/FIXME/HACK markers in `src/`

**What it checks:**

- `TODO` - Incomplete work
- `FIXME` - Known bugs
- `XXX` - Urgent attention needed
- `HACK` - Temporary solutions
- `stub` - Stub implementations
- `placeholder` - Placeholder code
- `simulate` - Simulation code
- `not implemented` - Unimplemented features
- `NotImplementedError` - Error for unimplemented features

**Exclusions:** (allowed in comments/docs)

- `tests/` directory
- `docs/` directory
- `*.md` files

**Usage:**

```bash
npm run check:placeholders

# Success:
# ✅ No placeholders found in source code

# Failure:
# ❌ PLACEHOLDER CHECK FAILED
# Found 1 placeholder(s) in source code:
# src/services/semantic-range.ts:359: // TODO: Implement formula detection
```

**Part of:** `npm run verify` pipeline

**Why it matters:** Per CLAUDE.md Rule #3, no TODOs allowed in `src/` before commit.

**Line Reference:** `scripts/no-placeholders.sh:1-100`

---

### `check-silent-fallbacks.sh`

**Purpose:** Find `return {}` or `return undefined` without logging

**What it checks:**

- `return {}` without preceding `logger.warn()` or `logger.error()`
- `return undefined` without logging
- Empty returns that could hide errors

**Allowed patterns:**

```typescript
// ✅ Good - logged
logger.warn('Empty result', { reason: '...' });
return {};

// ❌ Bad - silent
return {};
```

**Usage:**

```bash
npm run check:silent-fallbacks

# Success:
# ✅ No silent fallbacks detected

# Failure:
# ❌ Found 3 silent fallback(s):
# src/handlers/values.ts:234: return {};
# src/handlers/cells.ts:567: return undefined;
```

**Part of:** `npm run verify` pipeline

**Why it matters:** Per CLAUDE.md Rule #5, silent fallbacks hide errors and make debugging impossible.

---

### `check-debug-prints.sh`

**Purpose:** Find `console.log` in handlers (should use `logger` instead)

**What it checks:**

- `console.log()`
- `console.warn()`
- `console.error()`
- `console.debug()`

**Allowed:**

- `tests/` directory (test output is fine)
- `scripts/` directory (script output is fine)

**Usage:**

```bash
npm run check:debug-prints

# Success:
# ✅ No console.log statements in handlers

# Failure:
# ❌ Found 2 console.log statement(s):
# src/handlers/values.ts:123: console.log('Debug:', data);
```

**Part of:** `npm run verify` pipeline

**Why it matters:** Production code must use structured logging (`logger.debug()`, not `console.log()`).

---

## 📊 Diagnostic Scripts (NOT part of verify)

### `show-tools-list-schemas.ts`

**Purpose:** Display JSON schemas returned by `tools/list` MCP call

**What it shows:**

- Tool names
- Input schemas (JSON Schema format)
- Output schemas
- Annotations (hints)

**Usage:**

```bash
npm run show:tools

# Output:
# ┌─────────────────────┬────────────────┬──────────────┐
# │ Tool                │ Input Schema   │ Annotations  │
# ├─────────────────────┼────────────────┼──────────────┤
# │ sheets_auth         │ 4 actions      │ readOnly     │
# │ sheets_core  │ 8 actions      │ idempotent   │
# ...
```

**Use case:** Debugging schema registration issues

---

### `show-metrics.ts`

**Purpose:** Display current Prometheus metrics

**What it shows:**

- `tool_calls_total` - Counter per tool
- `tool_call_duration_seconds` - Histogram
- `queue_size` - Current queue depth
- `cache_hits_total` - Cache hit rate
- `api_calls_total` - Google API calls

**Usage:**

```bash
npm run metrics

# Output:
# 📊 ServalSheets Metrics
#
# Tool Calls:
#   sheets_auth: 142 calls
#   sheets_data: 523 calls
#   ...
#
# Performance:
#   p50 latency: 123ms
#   p95 latency: 456ms
#   p99 latency: 789ms
```

**Use case:** Performance analysis and monitoring

---

### `export-openapi.ts`

**Purpose:** Generate OpenAPI 3.1 specification from Zod schemas

**What it generates:**

- `docs/openapi.json` - Full OpenAPI spec
- `docs/openapi.yaml` - YAML format (optional)

**Usage:**

```bash
# JSON format (default)
npm run export-openapi

# YAML format
npm run export-openapi:yaml
```

**Output:** `docs/openapi.json` (500+ lines)

**Use case:** API documentation generation, Swagger UI integration

---

## 🔧 Development Scripts

### `check-commit-size.sh`

**Purpose:** Warn if commit touches >3 `src/` files (per CLAUDE.md Rule #4)

**What it checks:**

- Number of modified files in `src/`
- Excludes generated files (package.json, server.json, etc.)
- Warns if >3 files
- Fails if >10 files

**Usage:**

```bash
npm run check:commit-size

# Success (<= 3 files):
# ✅ Commit size OK: 2 src/ files modified

# Warning (4-10 files):
# ⚠️  Large commit: 5 src/ files modified
# Consider splitting into smaller commits

# Failure (>10 files):
# ❌ Commit too large: 12 src/ files modified
# Split into multiple commits (Rule #4)
```

**NOT part of verify** - advisory only

**Why it matters:** Per CLAUDE.md Rule #4, prefer ≤3 file changes for reviewability.

---

## 🧪 Benchmark Scripts

### `benchmark-validators.ts`

**Purpose:** Compare fast validators vs full Zod validation performance

**What it measures:**

- Fast validator speed (µs)
- Full Zod validation speed (ms)
- Speedup ratio

**Usage:**

```bash
tsx scripts/benchmark-validators.ts

# Output:
# ⚡ Validator Benchmarks
#
# Fast validators:    0.1ms  (100 µs)
# Full Zod:           1.2ms  (1200 µs)
# Speedup:            12x faster
```

---

### `benchmark-handlers.ts`

**Purpose:** Measure handler execution time for all tools

**Usage:**

```bash
tsx scripts/benchmark-handlers.ts

# Output per tool:
# sheets_auth:        45ms
# sheets_data:      123ms
# sheets_core: 89ms
# ...
```

---

### `benchmark-optimizations.ts`

**Purpose:** Compare batched vs unbatched API call performance

**Usage:**

```bash
tsx scripts/benchmark-optimizations.ts

# Output:
# Unbatched: 2.3s (10 calls)
# Batched:   0.3s (1 batch)
# Speedup:   7.6x faster
```

---

## 🔍 Investigation Scripts

### `diagnose-all.sh`

**Purpose:** Run all diagnostic scripts and collect output

**What it runs:**

1. `npm run check:drift`
2. `npm run check:placeholders`
3. `npm run check:silent-fallbacks`
4. `npm run check:debug-prints`
5. `npm run typecheck`
6. `npm test`

**Usage:**

```bash
bash scripts/diagnose-all.sh > diagnosis.txt

# Generates comprehensive report in diagnosis.txt
```

**Use case:** Debugging CI failures, collecting evidence for bug reports

---

## 🧪 Testing Scripts

### Test Categories

ServalSheets has **8 test categories** with different purposes:

| Category        | Command                    | Purpose              | Speed        | Files      |
| --------------- | -------------------------- | -------------------- | ------------ | ---------- |
| **Unit**        | `npm run test:unit`        | Pure unit tests      | Fast (8s)    | 450+ tests |
| **Fast**        | `npm run test:fast`        | Unit + contracts     | Fast (12s)   | 600+ tests |
| **Handlers**    | `npm run test:handlers`    | Handler tests        | Medium (15s) | 150+ tests |
| **Integration** | `npm run test:integration` | Cross-layer tests    | Medium (20s) | 200+ tests |
| **Contracts**   | `npm run test:contracts`   | Schema guarantees    | Fast (5s)    | 50+ tests  |
| **Compliance**  | `npm run test:compliance`  | MCP compliance       | Fast (8s)    | 30+ tests  |
| **E2E**         | `npm run test:e2e`         | End-to-end workflows | Slow (60s)   | 40+ tests  |
| **Live**        | `npm run test:live`        | Real Google API      | Slow (120s)  | 80+ tests  |

### Essential Test Commands

```bash
# Quick validation during development
npm run test:fast              # 8-12s - Unit + contracts

# Test specific layer
npm run test:handlers          # Handler layer only
npm run test:services          # Service layer only
npm run test:schemas           # Schema validation only

# Comprehensive testing
npm test                       # All tests (~3 min)
npm run test:coverage          # With coverage report

# CI/CD testing
npm run ci                     # Full CI pipeline
npm run verify                 # Verification suite
```

### Test Variants

```bash
# Watch mode
npm run test:watch             # Auto-run on file changes

# Parallel sharding
npm run test:shard 1/4         # Run 1st quarter of tests
npm run test:shard 2/4         # Run 2nd quarter of tests

# Specific test patterns
npm test -- handlers/data      # Test data handler only
npm test -- --grep="read_range" # Tests matching pattern
```

### Specialized Testing

```bash
# Property-based (fuzz) testing
npm run test:property          # fast-check generators

# Mutation testing
npm run test:mutation          # Stryker.js mutation tests
npm run test:mutation:critical # Critical paths only

# Chaos testing
npm run test:chaos             # Failure injection
npm run test:chaos:script      # Via bash script

# Load testing
npm run test:load              # Concurrent request load
npm run test:load:script       # Via bash script
```

---

## 📊 Analysis & Code Quality Scripts

### Multi-Agent Analysis System

**Purpose:** AI-powered code analysis with specialized agents

```bash
# Run all analysis agents
npm run analyze:all            # Analyze src/ directory

# Quick analysis (2 agents)
npm run analyze:quick          # Pattern + Type Safety

# Specific agents
npm run analyze:security       # Security analysis only

# File/directory specific
npm run analyze:file <path>    # Single file
npm run analyze:dir <path>     # Directory

# Watch mode
npm run analyze:watch          # Auto-analyze on changes

# Generate report
npm run analyze:report         # Aggregated findings
```

**Agents available:**

1. Pattern Recognition - Detects anti-patterns
2. Type Safety - TypeScript usage review
3. Code Quality - General quality checks
4. Security - Security vulnerability scan
5. Performance - Performance bottleneck detection

### Auto-Fixing

```bash
npm run analyze:fix            # Apply safe auto-fixes
```

---

## 🔍 Documentation Scripts

### Validation & Quality

```bash
# Full documentation audit
npm run docs:audit             # Lint + spell + links

# Individual checks
npm run docs:lint              # Markdownlint
npm run docs:spell             # Cspell check
npm run docs:check-links       # Internal link validation
npm run docs:prose             # Vale prose linting

# External link validation (slower)
npm run docs:check-external-links
```

### Content Management

```bash
# Frontmatter management
npm run docs:frontmatter       # Add missing frontmatter
npm run docs:frontmatter:check # Validate frontmatter
npm run docs:fix-dates         # Fix date formats

# Content analysis
npm run docs:freshness         # Check last_updated dates
npm run docs:find-todos        # Find TODO markers
npm run docs:suggest-tags      # AI tag suggestions

# Metrics
npm run docs:metrics           # Documentation metrics
npm run docs:catalog           # Generate catalog
```

### Documentation Site

```bash
# VitePress site
npm run docs:site:dev          # Local dev server
npm run docs:site              # Build static site
npm run docs:site:preview      # Preview built site
```

---

## 📦 Installation Scripts

### `setup-oauth.sh`

**Purpose:** Run OAuth auth flow and generate Claude Desktop config for local testing

**What it does:**

1. Runs `dist/cli/auth-setup.js` (browser OAuth)
2. Writes `claude_desktop_config.json` pointing to `dist/cli.js`
3. Verifies tokens and config files

**Usage:**

```bash
./scripts/setup-oauth.sh
```

---

## 🔄 Workflow Integration

### Complete Verification Pipeline

**Full pipeline:** `npm run verify`

**Order of execution:**

```
1. check:drift               (metadata sync)           ~3s
2. check:placeholders        (no TODOs)               ~2s
3. check:doc-action-counts   (doc accuracy)           ~2s
4. typecheck                 (TypeScript strict)      ~10s
5. lint                      (ESLint)                 ~8s
6. format:check              (Prettier)               ~3s
7. validate:alignment        (schema/handler sync)    ~5s
8. test:fast                 (unit + contracts)       ~12s
─────────────────────────────────────────────────────
Total: ~45s
```

**Exit behavior:** Fails on first error - fix before continuing

**Alternative pipelines:**

```bash
# Legacy pipeline (uses full test suite)
npm run verify:legacy        # ~3 min (includes all tests)

# Parallel pipeline (faster)
npm-run-all --parallel check:drift typecheck lint
```

---

### Development Workflows

#### Workflow 1: Schema Change

```bash
# Step 1: Modify schema
code src/schemas/data.ts
# Add new action to z.enum([...]) array

# Step 2: ONE command to complete
npm run schema:commit
# Automatically runs:
#   1. gen:metadata
#   2. check:drift
#   3. typecheck
#   4. test:fast
#   5. git add (5 generated files)

# Step 3: Commit
git commit -m "feat(data): add export_as_csv action"
```

**Time saved:** 5 manual steps → 1 command (2 min → 30s)

---

#### Workflow 2: Bug Fix

```bash
# Step 1: Write failing test
code tests/handlers/data.test.ts
npm test tests/handlers/data.test.ts
# ❌ Fails as expected

# Step 2: Fix bug
code src/handlers/data.ts

# Step 3: Verify fix
npm test tests/handlers/data.test.ts
# ✅ Passes now

# Step 4: Run fast checks
npm run gates:g0
# ✅ All checks pass (20s)

# Step 5: Commit
git add tests/handlers/data.test.ts src/handlers/data.ts
git commit -m "fix(data): handle empty range gracefully"
```

---

#### Workflow 3: Feature Addition

```bash
# Step 1: Create feature branch
git checkout -b feat/new-handler

# Step 2: Add schema, handler, tests
code src/schemas/my-tool.ts
code src/handlers/my-tool.ts
code tests/handlers/my-tool.test.ts

# Step 3: Register tool
code src/mcp/registration/tool-definitions.ts
# Add to TOOL_DEFINITIONS array

# Step 4: Generate metadata
npm run schema:commit

# Step 5: Full verification
npm run verify
# ✅ 45s - all checks pass

# Step 6: Commit and push
git add .
git commit -m "feat: add sheets_mytool handler"
git push origin feat/new-handler
```

---

### Pre-Commit Workflow (Recommended)

```bash
# Quick check before staging
npm run gates:g0               # 20s - baseline checks

# Full check before commit
npm run verify                 # 45s - comprehensive

# Emergency quick commit (use sparingly)
npm run test:fast && git commit -m "fix: quick patch"
```

---

### CI/CD Workflow

```bash
# What CI runs (in order):
npm run ci

# Expands to:
1. clean                       # Remove dist/
2. build                       # TypeScript compilation
3. verify                      # Full verification
4. validate:server-json        # server.json validation
5. smoke                       # Smoke test (--version)

# Total CI time: ~2-3 minutes
```

---

## 📚 Script Categories Summary

| Category        | Scripts                                                                    | Purpose                              |
| --------------- | -------------------------------------------------------------------------- | ------------------------------------ |
| **Metadata**    | `generate-metadata.ts`, `check-metadata-drift.sh`                          | Keep tool/action counts synchronized |
| **Quality**     | `no-placeholders.sh`, `check-silent-fallbacks.sh`, `check-debug-prints.sh` | Enforce code quality standards       |
| **Diagnostics** | `show-tools-list-schemas.ts`, `show-metrics.ts`, `diagnose-all.sh`         | Debugging and inspection             |
| **Benchmarks**  | `benchmark-*.ts`                                                           | Performance measurement              |
| **Development** | `check-commit-size.sh`, `quick-test.sh`                                    | Developer workflow aids              |
| **Integration** | `setup-oauth.sh`, `setup-vscode.sh`                                        | Setup and configuration              |
| **Export**      | `export-openapi.ts`                                                        | Documentation generation             |

---

## ⌨️ VS Code Keyboard Shortcuts

**Configured in `.vscode/tasks.json` and `.vscode/keybindings.json`:**

### Validation Gates

```
Cmd+G Cmd+0  → G0: Baseline Integrity (~20s)
Cmd+G Cmd+1  → G1: Metadata Consistency (~8s)
Cmd+G Cmd+2  → G2: Phase Behavior (~45s)
Cmd+G Cmd+3  → G3: API/Protocol/Docs (~15s)
Cmd+G Cmd+4  → G4: Final Truth Check (~60s)
Cmd+G Cmd+A  → All gates G0→G4 (~3 min)
```

### Testing

```
Cmd+Shift+T       → Run all tests
Cmd+Shift+F       → Test current file
Cmd+K Cmd+T       → Test current handler
Cmd+K Cmd+F       → Fast tests only
```

### Quick Checks

```
Cmd+K Cmd+V       → npm run verify
Cmd+K Cmd+C       → npm run check:drift
Cmd+K Cmd+B       → npm run build
```

### Schema Workflow

```
Cmd+Shift+S       → npm run schema:commit
Cmd+Shift+M       → npm run gen:metadata
```

### Documentation

```
Cmd+G Cmd+C       → Check hardcoded counts
Cmd+G Cmd+D       → Documentation audit
```

**Why keyboard shortcuts?**

- Save 5-10 seconds per command
- Reduce context switching
- Encourage frequent validation
- 50+ invocations per day = 5-10 min saved

---

## 🎯 Best Practices

### When to Run What

| Situation               | Command                 | Time  | Frequency         |
| ----------------------- | ----------------------- | ----- | ----------------- |
| **Before commit**       | `npm run gates:g0`      | 20s   | Always            |
| **After schema change** | `npm run schema:commit` | 60s   | Every schema edit |
| **During development**  | `npm run test:fast`     | 12s   | Every 5-10 min    |
| **Before PR**           | `npm run verify`        | 45s   | Once per PR       |
| **After merge**         | `npm run ci`            | 3 min | Automated         |
| **Before release**      | `npm run gates`         | 3 min | Every release     |

### Optimization Tips

**Parallel execution** (when checks are independent):

```bash
# Instead of sequential:
npm run check:drift && npm run typecheck && npm run lint
# Total: 23s (3s + 10s + 10s)

# Use parallel:
npm-run-all --parallel check:drift typecheck lint
# Total: 10s (max of all three)
```

**Incremental testing** (test what you changed):

```bash
# Instead of full suite:
npm test                       # 3 min

# Test specific layer:
npm run test:handlers          # 15s
npm test -- handlers/data      # 3s
```

**Cache utilization:**

```bash
# ESLint cache
npm run lint                   # 8s (no cache)
npm run lint                   # 2s (with cache)

# TypeScript cache
npm run typecheck              # 10s (no cache)
npm run typecheck              # 3s (with cache)
```

### Common Workflows

#### Daily Development

```bash
# Morning: Pull latest + verify
git pull && npm install && npm run verify

# During work: Quick checks
npm run test:fast              # Every 10 min
npm run gates:g0               # Before each commit

# End of day: Full verification
npm run verify && git push
```

#### Feature Development

```bash
# Start: Create branch
git checkout -b feat/my-feature

# Work: Test-driven development
npm test -- --watch            # Keep running

# Checkpoint: Verify progress
npm run gates:g0               # Quick check
npm run gates:g2               # Handler tests

# Finish: Full validation
npm run verify                 # Before PR
npm run gates                  # Before merge
```

#### Bug Fixing

```bash
# Step 1: Reproduce
npm test -- handlers/data      # Find failing test

# Step 2: Fix
code src/handlers/data.ts

# Step 3: Verify fix
npm test -- handlers/data      # Test passes?
npm run gates:g0               # No regressions?

# Step 4: Commit
git add . && git commit -m "fix: ..."
```

---

## 🤖 For AI Assistants

**Critical rules when working with scripts:**

1. **ALWAYS run `npm run schema:commit`** after modifying any `src/schemas/*.ts` file (NOT `gen:metadata` alone)
2. **ALWAYS run `npm run verify`** before claiming "changes complete"
3. **NEVER edit generated files manually:**
   - `package.json` (description field)
   - `src/schemas/index.ts` (TOOL_COUNT, ACTION_COUNT)
   - `src/schemas/annotations.ts` (ACTION_COUNTS object)
   - `src/mcp/completions.ts` (TOOL_ACTIONS map)
   - `server.json` (entire file)
4. **Use `npm run gates:g0`** for quick verification during development
5. **Check `npm run verify` output** - do NOT claim "verified" without running it

**Common mistakes:**

| ❌ Wrong                             | ✅ Correct                               |
| ------------------------------------ | ---------------------------------------- |
| Manually update `ACTION_COUNT = 299` | Run `npm run schema:commit`              |
| Skip verification                    | Always `npm run verify`                  |
| Leave TODOs in `src/`                | Remove or move to issues                 |
| Edit `server.json`                   | Let `gen:metadata` regenerate it         |
| Run full test suite                  | Use `npm run test:fast` for quick checks |
| Commit without gates                 | Run `npm run gates:g0` first             |

**Verification before claims:**

```bash
# When you say "metadata synchronized":
npm run check:drift
# Show actual output

# When you say "tests pass":
npm run test:fast
# Show pass/fail counts

# When you say "TypeScript clean":
npm run typecheck
# Show 0 errors output

# When you say "verified":
npm run verify
# Show complete output
```

---

## 📖 References

- **CLAUDE.md** - Rules that scripts enforce
- **PROJECT_STATUS.md** - Current verification status
- **SOURCE_OF_TRUTH.md** - Where scripts get authoritative data
- **package.json** - Script definitions and npm commands

---

**All scripts follow CLAUDE.md rules and are designed to enforce code quality, maintainability, and verifiability.**
