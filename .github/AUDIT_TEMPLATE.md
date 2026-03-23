# Audit Report Template

**Date:** YYYY-MM-DD
**Auditor:** [Name or automated tool]
**Scope:** [What was audited - e.g., "Schema-handler alignment", "Dead code detection", "Performance analysis"]

---

## Executive Summary

Brief 2-3 sentence summary of findings and impact.

---

## Validation Requirements

Before creating this audit, the following validations MUST be run:

- [ ] `npm run validate:alignment` - Schema-handler alignment check
- [ ] `npm test -- --coverage` - Test coverage report
- [ ] `npm run gates` - Full gate pipeline (G0-G5)

---

## Findings

### Finding 1: [Title]

**Severity:** [CRITICAL | HIGH | MEDIUM | LOW]
**Status:** [VERIFIED | NEEDS VERIFICATION | INVALID]

**Claim:**
Clear, specific claim about what's wrong. Use precise language:

- ✅ Good: "Handler has 3 extra cases: rename_sheet, hide_sheet, show_sheet"
- ❌ Bad: "Handler has extra cases"

**Evidence:**

```bash
# REQUIRED: Show actual command output that proves the claim

$ npm run validate:alignment
sheets_core:
  Schema: 19 actions
  Handler: 22 cases
  Extra: rename_sheet, hide_sheet, show_sheet

$ npm test -- tests/handlers/core.test.ts --coverage
PASS tests/handlers/core.test.ts
  Coverage: src/handlers/core.ts
    Lines: 85% (extra cases have 0% coverage)
```

**Impact:**

- What happens if this isn't fixed?
- Who is affected?
- What's the business/technical risk?

**Root Cause:**
Technical explanation of WHY this issue exists.

**Reproduction Steps:**

1. Step-by-step instructions to reproduce the issue
2. Expected behavior vs actual behavior
3. Any preconditions or setup required

**Fix:**
Concrete, actionable fix with:

- Which files to change
- What changes to make
- Estimated effort (hours or days)
- Risk level (LOW/MEDIUM/HIGH)

**Verification:**
How to verify the fix worked:

```bash
# Commands to run after fix
npm run validate:alignment
npm test -- tests/handlers/core.test.ts
npm run gates
```

---

## Dead Code Claims (if applicable)

**⚠️ CRITICAL: Dead code claims MUST include coverage proof**

### Example Dead Code Claim

**File:** `src/handlers/format.ts`
**Lines:** 1091-1207
**Claim:** Preset cases are unreachable dead code

**Coverage Proof:**

```bash
$ npm run validate:dead-code src/handlers/format.ts 1091 1207
Running tests with coverage...
Coverage for lines 1091-1207: 0/15 statements

⚠️  CODE APPEARS UNCOVERED
  Coverage: 0% (0/15 statements)
```

**Test Verification:**

```bash
$ npm test -- tests/handlers/format.test.ts --grep "apply_preset"
✓ should apply header_row preset
✓ should apply currency preset
... [all tests pass]
```

**Conclusion:**

- [ ] Tests pass ✓
- [ ] Code has 0% coverage ✓
- [ ] Confirmed dead code ✓

---

## Schema-Handler Alignment (if applicable)

**Required:** Run `npm run validate:alignment` and attach full output

```bash
$ npm run validate:alignment
[Paste full output here]
```

**Summary:**

- Aligned: X/22 tools
- Misaligned: Y tools
- Total extra cases: Z
- Total missing cases: W

---

## Action Required

### Immediate (P0)

List critical issues that block progress.

### Near-term (P1)

List high-priority issues for next sprint.

### Backlog (P2)

List medium/low priority issues for future consideration.

---

## Validation Checklist

Before submitting this audit:

- [ ] All claims include command output proof
- [ ] Dead code claims include 0% coverage proof
- [ ] Schema alignment includes `validate:alignment` output
- [ ] Reproduction steps are tested and work
- [ ] Fixes are actionable with effort estimates
- [ ] Impact assessment is realistic
- [ ] Ran `npm run gates` and all passed (or documented failures)
- [ ] Ran `npm run validate:audit` to verify this document

---

## Appendix

### Methodology

Describe how the audit was conducted:

- Tools used
- Manual inspection areas
- Automated checks run
- Sample size or coverage

### Assumptions

List any assumptions made during the audit.

### Limitations

List any limitations or areas not covered by this audit.

### References

- Link to related issues, PRs, or documentation
- References to best practices or standards used

---

## Sign-off

**Auditor:** [Name]
**Reviewer:** [Name]
**Date:** YYYY-MM-DD
**Status:** [DRAFT | REVIEW | APPROVED | INVALID]

---

## Template Usage Notes

**Do NOT include these notes in actual audit:**

1. **Evidence is mandatory** - Every claim needs proof
2. **Coverage for dead code** - Must show 0% coverage
3. **Validate before submitting** - Run `npm run validate:audit`
4. **Be specific** - Use exact file paths and line numbers
5. **Test your reproduction steps** - Verify they actually work
6. **Actionable fixes** - Tell people exactly what to do
7. **Risk assessment** - Every fix should have effort + risk estimate

**Good audit:**

- Includes command outputs
- Shows test results
- Has reproduction steps
- Provides specific fixes
- Estimates effort and risk

**Bad audit:**

- Makes claims without proof
- Uses vague language ("approximately", "around", "seems like")
- Lacks reproduction steps
- Proposes fixes without verifying they work
- Doesn't include coverage for dead code claims
