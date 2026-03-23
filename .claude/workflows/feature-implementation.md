# Workflow Template: Feature Implementation

**Pattern:** Research → Implementation → Validation
**Team Size:** 3 agents (sequential)
**Cost:** $6-8 per feature
**Time:** 15-20 minutes

---

## Workflow Steps

### Step 1: Research Phase (3-5 min, $0.50)

**Agent:** `servalsheets-research` (Haiku)

**Task:**

```
Analyze existing patterns for [feature-name]:
1. Find similar implementations in src/handlers/
2. Identify reusable utility functions
3. Extract schema patterns from src/schemas/
4. Report findings with file:line references
```

**Expected Output:**

- List of similar handlers
- Utility functions to reuse
- Schema pattern examples
- File locations

### Step 2: Implementation Phase (10-12 min, $5-7)

**Agent:** `servalsheets-implementation` (Sonnet)

**Task:**

```
Implement [feature-name] using TDD:
1. Read research findings from .agent-context/patterns.json
2. Write failing test in tests/handlers/[tool].test.ts
3. Implement minimal code in src/handlers/[tool].ts
4. Run npm run test:fast to verify
5. Return file changes and test results
```

**Expected Output:**

- Test file with failing test
- Implementation file with minimal code
- Test results showing PASS
- Files modified count (≤3)

### Step 3: Validation Phase (2-3 min, $0.20)

**Agent:** `servalsheets-validation` (Haiku)

**Task:**

```
Validate [feature-name] implementation:
1. Run npm run gates:g0 (baseline)
2. Run npm run check:drift (metadata sync)
3. Run npm run test:fast (all tests)
4. Report gate status: PASS/FAIL
```

**Expected Output:**

- G0 status
- Metadata drift status
- Test results
- Ready for commit: YES/NO

---

## Example Usage

### Feature: Add trackRead() to CacheInvalidationGraph

**Step 1: Research (servalsheets-research)**

```
Use Explore agent (medium) to analyze range tracking patterns:
1. Find similar tracking implementations in src/services/
2. Identify range overlap utilities (parseA1Range, rangesOverlap)
3. Report reusable patterns from request-merger.ts
```

**Step 2: Implementation (servalsheets-implementation)**

```
Use general-purpose agent to implement trackRead():
1. Add private trackedReads: Map<string, Set<string>>
2. Implement trackRead(spreadsheetId, range) method
3. Write test in tests/integration/phase-2-integration.test.ts
4. Verify test passes with npm run test:fast
```

**Step 3: Validation (servalsheets-validation)**

```
Use Explore agent to validate implementation:
1. Run npm run gates:g0
2. Verify metadata sync
3. Confirm tests pass
4. Report: READY FOR COMMIT
```

---

## Success Criteria

- ✅ Research finds reusable patterns
- ✅ Implementation ≤3 files changed
- ✅ Tests pass (npm run test:fast)
- ✅ G0 gate passes
- ✅ No metadata drift
- ✅ Total time < 20 minutes
- ✅ Total cost < $8

---

## Workflow Variants

### Variant A: Simple Feature (No Research)

**Skip Step 1**, start with Step 2
**Cost:** $5-7, **Time:** 10-12 min

### Variant B: Complex Feature (With API Review)

**Add Step 0:** google-api-expert reviews API usage
**Cost:** $9-12, **Time:** 20-25 min

### Variant C: Bug Fix (Validation First)

**Step 1:** servalsheets-validation identifies issue
**Step 2:** servalsheets-implementation fixes
**Step 3:** servalsheets-validation verifies
**Cost:** $5-7, **Time:** 12-15 min

---

## Agent Communication

**Research → Implementation:**

```json
// .agent-context/patterns.json
{
  "reusableFunctions": [
    "parseA1Range from src/services/request-merger.ts:480",
    "rangesOverlap from src/services/request-merger.ts:542"
  ],
  "similarImplementations": ["src/services/request-merger.ts has range tracking pattern"]
}
```

**Implementation → Validation:**

```json
// .agent-context/task-progress.json
{
  "filesChanged": [
    "src/services/cache-invalidation-graph.ts",
    "tests/integration/phase-2-integration.test.ts"
  ],
  "testsAdded": 2,
  "testsPass": true
}
```

---

## Troubleshooting

### Research Agent Returns No Patterns

**Cause:** Pattern doesn't exist yet
**Solution:** Skip to implementation, document new pattern

### Implementation Exceeds 3 Files

**Cause:** Schema change required
**Solution:** Acceptable if schema + handler + test (3 files)

### Validation Fails on Drift

**Cause:** Forgot to run schema:commit
**Solution:** Run `npm run schema:commit`, re-validate

---

## Template Checklist

- [ ] Clear feature description provided
- [ ] Research phase completes in < 5 min
- [ ] Implementation follows TDD
- [ ] Tests pass before validation
- [ ] Validation runs full G0 gate
- [ ] Total cost < $8
- [ ] Total time < 20 min
- [ ] Ready for commit confirmation
