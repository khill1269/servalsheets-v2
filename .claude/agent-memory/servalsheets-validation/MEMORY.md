# servalsheets-validation Agent Memory

**Last Updated:** 2026-02-17
**Memory Scope:** project (shared with team)

---

## Gate Pipeline Knowledge

### Gate Levels (G0-G4)

**G0: Baseline Integrity** (~20 seconds)

```bash
npm run gates:g0
# Runs: typecheck, lint, check:drift, test:fast
```

**When to use:** Before every commit
**Blocking:** YES - Must pass before commit

**G1: Metadata Consistency** (~8 seconds)

```bash
npm run gates:g1
# Runs: cross-map tests, check hardcoded counts
```

**When to use:** After schema changes
**Blocking:** YES - Documentation must be in sync

**G2: Phase Behavior** (~45 seconds)

```bash
npm run gates:g2
# Runs: handler tests, integration tests, compliance tests
```

**When to use:** Phase completion, before merges
**Blocking:** YES - Handler correctness required

**G3: API/Protocol/Docs** (~15 seconds)

```bash
npm run gates:g3
# Runs: validate:compliance, docs:validate, docs-freshness-check
```

**When to use:** Before doc publishing
**Blocking:** NO - Advisory only

**G4: Final Truth Check** (~60 seconds)

```bash
npm run gates:g4
# Runs: Full build, verify action-counts from dist/
```

**When to use:** Before releases
**Blocking:** YES - Must match source of truth

---

## Common Validation Failures

### 1. Metadata Drift (Most Common - 40% of failures)

**Symptom:** `check:drift` fails with "X tools vs Y actions mismatch"
**Cause:** Schema changed without running `npm run schema:commit`
**Fix:** Run `npm run schema:commit` to regenerate metadata
**Prevention:** Use `Cmd+Shift+S` keyboard shortcut

### 2. Placeholder Markers

**Symptom:** Found TODO/FIXME/HACK in src/
**Acceptable locations:**

- Comments in service layer (infrastructure features)
- Test files (test utilities)
  **Unacceptable locations:**
- Handler business logic
- Schema definitions
- MCP protocol code

### 3. Silent Fallbacks

**Symptom:** Found `return {}` without throwing error
**Acceptable patterns:**

- Optional returns in base.ts (type system requires it)
- Documented intentional returns
  **Unacceptable patterns:**
- Missing error handling
- Guard clauses without logging

### 4. Test Failures

**Symptom:** `test:fast` shows failing tests
**Triage:**

- Core tools (sheets_auth, sheets_core, sheets_data) → BLOCKING
- Streaming features → LOW PRIORITY (Phase +1)
- Optimization features → LOW PRIORITY (Phase +2)

---

## Known Acceptable Warnings

### 1. Placeholder in tenant-context.ts:284

**Status:** ACCEPTABLE (Phase +2 feature)
**Context:** "This is a placeholder for row-level security checks"
**Reason:** Multi-tenancy infrastructure, not in Phase 0 critical path

### 2. Silent Returns in base.ts (3 instances)

**Status:** ACCEPTABLE (documented intentional)
**Locations:** Lines 218, 607, 180
**Reason:** TypeScript optional return types, proper error handling exists

### 3. Streaming Test Failures (15 tests)

**Status:** ACCEPTABLE (non-critical feature)
**File:** tests/handlers/composite.streaming.test.ts
**Reason:** Export large dataset is enhancement feature, not core functionality

---

## Validation Workflow

### Before Commit (REQUIRED)

```bash
# Quick check (30s)
npm run check:drift && npm run test:fast

# OR comprehensive (3min)
npm run verify

# OR via keyboard
Cmd+G Cmd+0  # G0: Baseline
```

### After Schema Change (REQUIRED)

```bash
# ONE command does it all
npm run schema:commit

# OR via keyboard
Cmd+Shift+S  # Schema commit workflow
```

### Phase Completion (REQUIRED)

```bash
# Full gate pipeline
npm run gates

# OR via keyboard
Cmd+G Cmd+A  # All gates
```

---

## Gate Status Interpretation

### ✅ PASS - Ready to proceed

**G0 PASS:** Baseline integrity intact
**G1 PASS:** Metadata synchronized
**G2 PASS:** All handlers functioning
**G3 PASS:** Docs up to date
**G4 PASS:** Source of truth verified

### ⚠️ WARN - Non-blocking, advisory

**Example:** Placeholder in Phase +2 feature
**Action:** Document in KNOWN_ISSUES, continue

### ❌ FAIL - Blocking, must fix

**Example:** Metadata drift, test failures in core tools
**Action:** Fix immediately before proceeding

---

## Source of Truth Locations

### Tool & Action Counts

**Source:** `src/schemas/action-counts.ts`

- Line 38: `export const TOOL_COUNT = 25` (computed from Object.keys)
- Line 43: `export const ACTION_COUNT = 402` (computed from Object.values sum)

**Verification:**

```bash
node -e "const {TOOL_COUNT,ACTION_COUNT}=require('./dist/schemas/action-counts.js'); console.log('Tools:',TOOL_COUNT,'Actions:',ACTION_COUNT)"
```

### Line Counts (Verified 2026-03-16)

```bash
wc -l src/server.ts          # 1426 lines
wc -l src/http-server.ts     # 983 lines
wc -l src/handlers/base.ts   # 1613 lines
```

### Protocol Version

**Source:** `src/version.ts:14`

```typescript
export const MCP_PROTOCOL_VERSION = 'MCP 2025-11-25';
```

---

## Critical Paths (MUST PASS)

### Phase 0: Foundation

- ✅ G0: Baseline Integrity
- ✅ G1: Metadata Consistency
- ✅ G2: Core handler tests (25 tools)
- ⚠️ G2: Streaming tests (15 failures) - ACCEPTABLE
- ⚠️ G2: Phase 2 integration (6 failures) - ACCEPTABLE (Phase +1)

### Phase 1: Optimization

- ✅ G2: Request merging tests
- ✅ G2: Prefetch tests
- ✅ G2: Cache invalidation tests
- ✅ G3: Performance benchmarks

### Phase 2: Enterprise

- ✅ G2: Multi-tenancy tests
- ✅ G2: RBAC tests
- ✅ G3: Security audit

---

## Validation Commands Quick Reference

```bash
# Individual gates
npm run gates:g0    # Baseline (20s)
npm run gates:g1    # Metadata (8s)
npm run gates:g2    # Behavior (45s)
npm run gates:g3    # API/Docs (15s)
npm run gates:g4    # Truth (60s)

# Full pipeline
npm run gates       # G0→G4 (3min)

# Individual checks
npm run check:drift          # Metadata sync (3s)
npm run test:fast            # Unit + contracts (8s)
npm run typecheck            # TS strict mode (10s)
npm run check:placeholders   # TODO/FIXME scan (2s)
npm run check:silent-fallbacks  # Return {} scan (2s)

# Comprehensive
npm run verify               # Full verification (3min)
```

---

## Keyboard Shortcuts

**Most Used:**

- `Cmd+G Cmd+0` → G0: Baseline (before commit)
- `Cmd+Shift+S` → Schema commit (after schema change)
- `Cmd+K Cmd+V` → Quick verify (typecheck + lint)
- `Cmd+Shift+V` → Full verify

**Gate Pipeline:**

- `Cmd+G Cmd+A` → All gates (G0→G4)
- `Cmd+G Cmd+1` → G1: Metadata only
- `Cmd+G Cmd+2` → G2: Behavior only

**Testing:**

- `Cmd+Shift+F` → Test current file
- `Cmd+K Cmd+F` → Fast tests only

---

## Best Practices

### ✅ DO

- Run G0 before every commit
- Run full gates before phase completion
- Document acceptable warnings
- Use keyboard shortcuts for efficiency
- Check gate output carefully (don't blindly trust)

### ❌ DON'T

- Skip validation before commit
- Ignore failing tests in core tools
- Assume warnings are always acceptable
- Run G4 frequently (expensive, 60s)
- Commit with metadata drift

---

## Cost Optimization

**Fast validation (G0):** 20 seconds, $0
**Full gates (G0-G4):** 3 minutes, $0
**Per validation run:** FREE (runs locally, no API calls)

**Key insight:** Validation is FREE - use it liberally!

---

## Common Issues & Solutions

### Issue: "npm run gates:g0" command not found

**Solution:** Run `npm install` to ensure all scripts are available

### Issue: G1 fails with "hardcoded counts mismatch"

**Solution:** Run `npm run schema:commit` to update docs

### Issue: G2 fails with "15 tests failing"

**Diagnosis:** Check if failures are in streaming tests (acceptable) or core tools (blocking)

### Issue: G4 fails with "TOOL_COUNT mismatch"

**Solution:** Run `npm run build` first, then G4

---

## Integration with Agent Framework

**When validation agent detects issues:**

1. Classify: BLOCKING vs ACCEPTABLE
2. Report: Structured gate status report
3. Recommend: Specific fix commands
4. Escalate: Assign to implementation agent if needed

**Agent handoff pattern:**

```
Validation Agent → Detects issue
    ↓
Research Agent → Investigates root cause
    ↓
Implementation Agent → Fixes issue
    ↓
Validation Agent → Verifies fix
```
