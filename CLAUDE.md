# Claude Code Rules (ServalSheets)

> **Size cap: 300 lines.** If this file exceeds 300 lines, move content to `docs/`.
> Architecture reference: `docs/development/ARCHITECTURE.md`

## Live State & Session Context

Live project state (auto-generated): @.serval/state.md
Session notes (decisions, next steps): @.serval/session-notes.md
Codebase deep context (all tools, MCP, API patterns): @docs/development/CODEBASE_CONTEXT.md
Feature roadmap (P4 differentiators): @docs/development/FEATURE_PLAN.md

## Project Overview

ServalSheets is a production-grade MCP server for Google Sheets with 25 tools and 407 actions.
Runtime: Node.js + TypeScript (strict). See `src/schemas/index.ts` for authoritative counts.

### Core Pipeline

```
MCP Request → src/server.ts:handleToolCall()
  → src/mcp/registration/tool-handlers.ts:createToolCallHandler()
    → normalizeToolArgs() → Zod validation → handler.executeAction()
      → src/services/google-api.ts (auto-retry + circuit breaker)
    → buildToolResponse() → CallToolResult
```

Full 4-layer trace with line numbers: `docs/development/ARCHITECTURE.md`

## Non-negotiable Workflow

1. **Verify before claiming** — every fact needs `file:line` OR `command → output`
2. **Trace execution paths** — prove reachability from entrypoint (STDIO/HTTP/Remote)
3. **No "fixes" without failing proof** — reproduce with script or failing test first
4. **Minimal change policy** — ≤3 src/ files unless tests require more; no refactors while debugging
5. **No silent fallbacks** — never `return {}` without logging; use `ErrorCode` enum
6. **Dead code claims need proof** — run `npm run validate:dead-code <file> <start> <end>`
7. **Schema-handler alignment** — run `npm run validate:alignment`; deviations must be in `src/schemas/handler-deviations.ts`
8. **Audit docs must validate** — `npm run validate:audit` with `.github/AUDIT_TEMPLATE.md` format

## Verification (single canonical reference)

```bash
# Before every commit
npm run verify              # Full pipeline (typecheck + lint + test + drift + checks)
npm run verify:safe         # Skips lint (use when ESLint OOMs in low-memory envs)

# After schema changes (ONE command)
npm run schema:commit       # Regenerate metadata + verify + test + stage

# Quick checks (< 15 seconds each)
npm run check:drift         # Metadata sync
npm run test:fast           # Unit + contract tests
npm run typecheck           # TypeScript strict mode

# Individual checks
npm run check:placeholders  # No TODO/FIXME in src/
npm run check:debug-prints  # No console.log in handlers
npm run check:silent-fallbacks  # No silent {} returns
npm run validate:alignment  # Schema-handler alignment
npm run validate:audit      # Audit document validation

# Full gate pipeline
npm run gates               # G0-G5 validation gates
npm run verify:build        # Build + validate + smoke
```

## No Documentation File Creation

Never create `*_REPORT.md`, `*_ANALYSIS.md`, `*_LOG.md`, `*_SUMMARY.md`, or session logs.
Report findings in chat. Code changes only — no meta-documentation.

## Common Gotchas

### 1. Metadata Drift After Schema Changes

Modified `src/schemas/*.ts` without regenerating → CI fails "metadata drift detected".
**Fix:** `npm run schema:commit` after ANY schema change. This is the #1 CI failure cause.
Generated files: `src/schemas/index.ts`, `annotations.ts`, `src/mcp/completions.ts`, `server.json`, `package.json`.

### 2. Response Builder Anti-Pattern

```typescript
// ❌ Handler returns MCP format directly
return { content: [{ type: 'text', text: 'result' }] };
// ✅ Handler returns data; tool layer converts
return buildToolResponse({ response: { success: true, data } });
```

### 3. Hardcoded Counts

Always reference `src/schemas/action-counts.ts:41,46` for TOOL_COUNT/ACTION_COUNT (re-exported via `src/schemas/index.ts:16`). Never hardcode.

### 4. Line Count Claims

Always run `wc -l file.ts`. Never use "~", "approximately", or "around".

### 5. Silent Fallbacks

```typescript
// ❌ if (!sheet) return {};
// ✅ if (!sheet) throw new SheetNotFoundError('Sheet not found', { spreadsheetId, sheetName });
```

### 6. Legacy Envelope Wrapping

Tests need `{ request: { action: 'read_range', ... } }` not `{ action: 'read_range', ... }`.
See `normalizeToolArgs()` in `tool-handlers.ts:81-118`.

### 7. Test Quality Anti-Patterns (ISSUE-237)

```typescript
// ❌ Tautological — always passes regardless of actual value
expect([true, false]).toContain(response.success);
// ✅ Assert the specific expected value
expect(response.success).toBe(false);

// ❌ Non-deterministic — different results each run
const largeData = Array.from({ length: 1000 }, (_, i) => [Math.random(), new Date()]);
// ✅ Deterministic — reproducible across all runs
const largeData = Array.from({ length: 1000 }, (_, i) => [(i + 1) * 10, '2024-01-15']);
```

### 8. Stale Hardcoded Action Names (ISSUE-231, P7-B1)

When renaming an action (e.g. `write_range` → `write`), also update:

- `MUTATION_ACTIONS` in `src/middleware/audit-middleware.ts`
- `AUTH_EXEMPT_ACTIONS` in `src/server.ts`
- Cache invalidation rules in `src/services/cache-invalidation-graph.ts`
- `scripts/check-integration-wiring.mjs` guards

Run `npm run check:integration-wiring` after any action rename to catch mismatches.

## Key Files

- `src/server.ts` — MCP server entrypoint
- `src/mcp/registration/*` — Tool + schema registration
- `src/handlers/*` — 25 tool handlers (13 extend BaseHandler, 12 standalone)
- `src/schemas/*` — Zod schemas (validation source of truth)
- `tests/contracts/*` — Contract tests (schema guarantees)

## Code Patterns

### Layered Validation

```typescript
fastValidateSpreadsheet(input); // 0.1ms pre-Zod
const validated = Schema.parse(input); // Full Zod
if (!result.response) throw new ResponseValidationError(); // Shape check
```

### Structured Errors

```typescript
// ✅ Typed: throw new SheetNotFoundError('...', { spreadsheetId, sheetName });
// ❌ Generic: throw new Error('Sheet not found');
```

### Response Patterns

```typescript
// BaseHandler (13 handlers): return this.success('action', data, mutation);
// Standalone (12 handlers):  return { response: { success: true, action, ...data } };
// Error (both):              return { response: this.mapError(error) };
```

## Coding Style

### Import Ordering

```typescript
// 1. Google APIs / external    2. Internal domain (base handler)
// 3. Core types                4. Config
// 5. Services                  6. Utils
// 7. Schemas / types           8. MCP layer
```

### Naming Conventions

- Handler methods: `private async handle{ActionName}(input): Promise<Response>`
- Test mocks: `createMock{Type}()`
- Converters: `{source}To{target}()`
- Validators: `validate{Thing}()`
- Types: `{Tool}{Action}Input`, `{Tool}Output`

## Adding a New Action

**Step 1:** Schema in `src/schemas/{tool}.ts` — add to discriminated union
**Step 2:** Handler in `src/handlers/{tool}.ts` — add case + private method
**Step 3:** Test in `tests/handlers/{tool}.test.ts` — success + error paths (no `Math.random()`, no tautological assertions)
**Step 4:** `npm run schema:commit`
**Step 5 (if mutating):** Add action name to `MUTATION_ACTIONS` in `src/middleware/audit-middleware.ts`
**Step 5b (if mutating):** Add action name to write-lock set in `src/middleware/mutation-safety-middleware.ts` — must match audit-middleware set or `npm run check:mutation-actions` fails
**Step 6 (always):** Add cache invalidation rule in `src/services/cache-invalidation-graph.ts` (use `invalidates: []` for read-only)
**Step 7 (if session-context wired):** Write back with `sessionContext.recordOperation()` — not just read/filter
**Step 8 (if new error code):** Add code to `ErrorCodeSchema` in `src/schemas/shared.ts` before using it in handlers

## Source of Truth

| Metric           | Source File                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| ACTION_COUNT     | `src/schemas/index.ts`                                                                         |
| TOOL_COUNT       | `src/schemas/index.ts`                                                                         |
| Protocol Version | `src/constants/protocol.ts` (re-exported via `src/version.ts:14`)                              |
| TOOL_ACTIONS map | `src/mcp/completions.ts` — verified by `tests/contracts/completions-cross-map.test.ts`         |
| MUTATION_ACTIONS | `src/middleware/audit-middleware.ts` (write-lock parity: `scripts/check-mutation-actions.mjs`) |

Never hardcode these values — always reference the source file with `file:line`.

## Audit Mode

1. Show exact execution path (entrypoint → callsite)
2. Run `npm run verify` and report failures
3. Reproduce bug with failing test
4. Propose minimal patch (≤3 files)
5. No refactors in same PR

## Feature Build Workflow

When implementing a new feature (e.g., F4 Smart Suggestions from `docs/development/FEATURE_PLAN.md`):

1. **Scope**: Read only the feature spec section + target handler/schema. Don't load all 22 handlers.
2. **Schema first**: Add to discriminated union in `src/schemas/{tool}.ts`
3. **Schema commit**: `npm run schema:commit` — do this IMMEDIATELY, not at the end
4. **Service**: Create new service in `src/services/` following existing patterns
5. **Handler**: Add case to switch + private `handle{Action}()` method
6. **Test**: Success + error paths in `tests/handlers/{tool}.test.ts`
7. **Verify**: `npm run verify:safe` (includes drift check, skips lint for memory safety)
8. **Session notes**: Update `.serval/session-notes.md` before ending

## Workflow Anti-Patterns

- **Don't read all handlers at session start** — scope to the module being worked on
- **Don't run full test suite in main context** — delegate to subagent (returns summary vs 5K tokens of output)
- **Don't batch commits** — commit per logical unit (schema change, handler, tests)
- **Don't skip schema:commit** — #1 CI failure cause; PostToolUse hook will remind you
- **Don't modify generated files directly** — `action-counts.ts`, `annotations.ts`, `completions.ts`, `server.json` are generated by `schema:commit`
- **Don't use `verify` in low-memory** — use `verify:safe` (skips ESLint, includes drift check)

## Subagent Delegation

Use Task tool (subagents) for heavy operations to keep main context clean:

- **Test runs**: `npm run test:fast` — delegate, get pass/fail summary
- **Typecheck**: `npm run typecheck` — delegate, get error list only
- **Audit**: `npm run audit:full` — always delegate (produces massive output)
- **Code exploration**: Use Explore agent for "find all usages of X" searches
- **Verification**: After feature complete, delegate `npm run verify:safe` to subagent

Pattern: `Task(Bash, "Run npm run test:fast in /path/to/project and report pass/fail count + any failures")`

## Hooks

Configured in `.claude/hooks.json`:

- **SessionStart**: Auto-generates `.serval/state.md` with live project metrics
- **Stop**: Prompts to verify tests pass, metadata synced, session notes updated
- **PreToolUse (Bash)**: Blocks destructive git commands (`reset --hard`, `push --force`)
- **PostToolUse (Write/Edit)**: Warns when schema files edited without `schema:commit`

## Known Issues

- ESLint may OOM in low-memory environments (~3GB heap needed) — use `verify:safe`
- Silent fallback checker: 0 false positives (all annotated with inline comments)

## Further Reading

- Architecture & directory structure: `docs/development/ARCHITECTURE.md`
- Complete rules with examples: `docs/development/CLAUDE_CODE_RULES.md`
- Current build status: `docs/development/PROJECT_STATUS.md`
- Source of truth reference: `docs/development/SOURCE_OF_TRUTH.md`
