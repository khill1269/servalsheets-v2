# Validation Agent Template

**Purpose:** Fast automated validation of code changes using gate pipeline

**Model:** Haiku 4.5 (Fastest, cheapest - $0.25/1M input tokens)
**Subagent Type:** `general-purpose`
**Typical Duration:** 3-10 minutes
**Average Cost:** $0.10-0.50 per validation run

---

## When to Use

✅ **Before Committing**

- Run G0 (baseline integrity)
- Check for common issues

✅ **After Schema Changes**

- Verify metadata regenerated
- Check for drift

✅ **Phase Completion**

- Run full gate pipeline (G0→G4)
- Generate completion report

✅ **CI/CD Integration**

- Automated validation
- Pre-merge checks

❌ **Not Suitable For**

- Complex debugging (use Sonnet)
- Root cause analysis (use Sonnet/Opus)
- Implementation work (use implementation-agent)

---

## Basic Template: Quick Validation

```typescript
Task({
  subagent_type: 'general-purpose',
  model: 'haiku',
  description: 'Quick validation (G0) - 5min',
  prompt: `
    Run baseline integrity checks:

    1. npm run gates:g0

    This runs:
    - TypeScript compilation
    - ESLint checks
    - Placeholder detection
    - Silent fallback detection
    - Debug print detection
    - Metadata drift check
    - Fast tests (unit + contracts)

    Report format:
    ## Validation Results

    ### Passed ✓
    - [List passing checks]

    ### Failed ✗
    - [Check name]: [Error message]
      File: [file:line]
      Fix: [Suggested fix]

    If any failures:
    - Provide file:line references
    - Suggest specific fixes
    - Do NOT auto-fix (just report)
  `,
});
```

---

## Example 1: Pre-Commit Validation

```typescript
Task({
  subagent_type: 'general-purpose',
  model: 'haiku',
  description: 'Pre-commit validation (5min)',
  prompt: `
    Before committing, run comprehensive checks:

    **Step 1: Baseline Integrity (G0)**
    npm run gates:g0

    **Step 2: Quick Verify**
    npm run check:drift
    npm run check:placeholders
    npm run check:silent-fallbacks

    **Step 3: Test Current Changes**
    - Identify modified files: git diff --name-only
    - Run tests for modified handlers
    - Report: Pass/Fail for each test file

    **Output Format:**
    ## Pre-Commit Validation

    ### Status: [PASS/FAIL]

    ### Checks:
    - ✓ TypeScript: 0 errors
    - ✓ ESLint: 0 errors
    - ✓ Tests: 142/142 passing
    - ✓ Metadata: No drift

    ### Modified Files:
    - src/handlers/data.ts (tests passing ✓)
    - src/schemas/data.ts (metadata regenerated ✓)

    ### Ready to Commit: [YES/NO]
  `,
});
```

---

## Example 2: Schema Change Validation

```typescript
Task({
  subagent_type: 'general-purpose',
  model: 'haiku',
  description: 'Validate schema changes (8min)',
  prompt: `
    After schema modifications, verify complete workflow:

    **Step 1: Metadata Generation**
    npm run gen:metadata

    **Step 2: Drift Check**
    npm run check:drift
    Expected: No drift detected

    **Step 3: Metadata Consistency (G1)**
    npm run gates:g1

    This runs:
    - Cross-map consistency tests
    - Schema-handler alignment tests
    - Hardcoded count detection
    - Schema validation alignment

    **Step 4: Fast Tests**
    npm run test:fast

    **Step 5: Verify Files Changed**
    git status | grep "modified:"
    Expected files:
    - src/schemas/[modified].ts
    - src/schemas/index.ts (tool/action counts)
    - src/schemas/annotations.ts (per-tool counts)
    - src/mcp/completions.ts (autocomplete map)
    - server.json (MCP metadata)
    - package.json (description)

    **Output Format:**
    ## Schema Change Validation

    ### Status: [PASS/FAIL]

    ### Metadata Files Updated:
    - ✓ src/schemas/index.ts
    - ✓ src/schemas/annotations.ts
    - ✓ src/mcp/completions.ts
    - ✓ server.json
    - ✓ package.json

    ### Tests: [Passed/Failed]
    ### Action Count: [Current count]
    ### Tool Count: [Current count]

    ### Ready for Commit: [YES/NO]
  `,
});
```

---

## Example 3: Full Gate Pipeline (Phase Completion)

```typescript
Task({
  subagent_type: 'general-purpose',
  model: 'haiku',
  description: 'Full gate validation (G0-G4) - 10min',
  prompt: `
    Run complete validation pipeline for phase completion:

    **G0: Baseline Integrity (~2 min)**
    npm run gates:g0

    **G1: Metadata Consistency (~1 min)**
    npm run gates:g1

    **G2: Phase Behavior (~3 min)**
    npm run gates:g2
    - Handler tests
    - Integration tests
    - Compliance tests

    **G3: API/Protocol/Docs (~2 min)**
    npm run gates:g3
    - API compliance validation
    - Documentation validation
    - Docs freshness check

    **G4: Final Truth Check (~2 min)**
    npm run gates:g4
    - Build verification
    - ESM-safe constant check
    - Source of truth validation

    **Output Format:**
    ## Phase Completion Validation

    ### Gate Results:
    | Gate | Status | Duration | Issues |
    |------|--------|----------|--------|
    | G0 | ✓ PASS | 95s | 0 |
    | G1 | ✓ PASS | 42s | 0 |
    | G2 | ✓ PASS | 156s | 0 |
    | G3 | ✓ PASS | 89s | 0 |
    | G4 | ✓ PASS | 103s | 0 |

    ### Overall Status: [PASS/FAIL]

    ### Phase Ready for Completion: [YES/NO]

    If any failures:
    - List all failing checks with file:line
    - Suggest specific fixes
    - Estimate time to fix
  `,
});
```

---

## Example 4: Regression Detection

```typescript
Task({
  subagent_type: 'general-purpose',
  model: 'haiku',
  description: 'Detect regressions (5min)',
  prompt: `
    After implementation changes, detect any regressions:

    **Step 1: Run Full Test Suite**
    npm test

    **Step 2: Compare with Previous Run**
    - Check test count: Should be same or higher
    - Check passing count: Should be same or higher
    - Identify any newly failing tests

    **Step 3: Test Specific Areas**
    - npm run test:handlers
    - npm run test:integration
    - npm run test:contracts (MUST all pass - 667 tests)

    **Step 4: Performance Check**
    npm run test:fast
    - Should complete in < 10 seconds
    - No significant slowdowns

    **Output Format:**
    ## Regression Detection

    ### Test Summary:
    - Total: [current] (was: [previous])
    - Passing: [current] (was: [previous])
    - Failing: [current] (was: [previous])

    ### Regressions Found:
    [If any tests that previously passed now fail]

    - Test: [test name]
      File: [file:line]
      Error: [error message]
      Impact: [HIGH/MEDIUM/LOW]

    ### Status: [NO REGRESSIONS/REGRESSIONS FOUND]
  `,
});
```

---

## Cost Comparison: Haiku vs Other Models

**Validation Task (5 minutes):**

| Model     | Input Tokens | Output Tokens | Cost       | vs Haiku           |
| --------- | ------------ | ------------- | ---------- | ------------------ |
| **Haiku** | 10k          | 2k            | **$0.005** | 1x (baseline)      |
| Sonnet    | 10k          | 2k            | $0.06      | 12x more expensive |
| Opus      | 10k          | 2k            | $0.30      | 60x more expensive |

**Running gates 10x per day:**

- Haiku: $0.05/day = $1.50/month
- Sonnet: $0.60/day = $18/month
- Opus: $3.00/day = $90/month

**Savings: 98% by using Haiku for validation**

---

## Integration with VS Code Keyboard Shortcuts

These validation tasks integrate with your existing shortcuts:

| Shortcut      | Task          | Agent Template            |
| ------------- | ------------- | ------------------------- |
| `Cmd+G Cmd+0` | G0: Baseline  | This template (Example 1) |
| `Cmd+G Cmd+1` | G1: Metadata  | This template (Example 2) |
| `Cmd+G Cmd+A` | Full pipeline | This template (Example 3) |
| `Cmd+K Cmd+V` | Quick verify  | This template (Example 1) |

---

## Tips for Fast Validation

1. **Run gates early**: Catch issues before they compound
2. **Use haiku**: 60x cheaper than Opus for validation
3. **Parallel checks**: Run multiple gates simultaneously when possible
4. **Cache results**: Don't re-run unchanged code
5. **Focus on failures**: Report only what needs fixing

---

## Success Metrics

**Good Validation Session:**

- ✓ Completes in < 10 minutes
- ✓ Clear pass/fail status
- ✓ Specific file:line references
- ✓ Actionable fix suggestions
- ✓ Cost: < $0.50 (Haiku)

**Needs Improvement:**

- ✗ Takes > 15 minutes (too much manual work)
- ✗ Vague error messages
- ✗ No file:line references
- ✗ No suggested fixes
- ✗ Cost: > $5 (used wrong model)

---

## Automation Opportunities

**GitHub Actions Integration:**

```yaml
- name: Validate with Claude Code Agent
  run: |
    claude --agent << EOF
    Task({
      subagent_type: "general-purpose",
      model: "haiku",
      description: "CI validation",
      prompt: "Run npm run gates:g0 and report results"
    })
    EOF
```

**Pre-commit Hook:**

```bash
# .husky/pre-commit
npx claude --agent << EOF
Use validation-agent template for pre-commit checks
EOF
```

---

**Related Templates:**

- `implementation-agent.md` - After implementing, validate with this
- `research-agent.md` - Research issues found during validation

## Runtime Guardrails

Before taking tool actions, load `.claude/AGENT_GUARDRAILS.md`.
If it exists, load `.agent-context/learning-memory.md` and apply the top recurring fixes first.
