# Implementation Agent Template

**Purpose:** TDD-based feature implementation with automated testing

**Model:** Sonnet 4.5 (Balanced - $3/1M input tokens)
**Subagent Type:** `general-purpose`
**Typical Duration:** 20-60 minutes
**Average Cost:** $5-15 per feature

---

## When to Use

✅ **Feature Implementation**

- New tool actions
- Handler modifications
- Schema changes
- API integrations

✅ **Bug Fixes**

- Production bugs
- Test failures
- Integration issues

✅ **Refactoring**

- Code cleanup
- Pattern standardization
- Performance optimization

❌ **Not Suitable For**

- Novel architecture design (use Opus)
- Simple file searches (use Haiku research-agent)
- Just running tests (use Haiku validation-agent)

---

## TDD Workflow Template

```typescript
Task({
  subagent_type: 'general-purpose',
  model: 'sonnet',
  description: 'Implement [feature] with TDD (30min)',
  prompt: `
    Implement [feature] using strict TDD approach:

    **Phase 1: Write Failing Tests (10 min)**
    1. Create test file: tests/[category]/[feature].test.ts
    2. Write comprehensive test cases covering:
       - Happy path
       - Edge cases
       - Error scenarios
    3. Run: npm run test:fast
    4. Verify: Tests MUST fail (feature not implemented yet)
    5. Commit: "test: add failing tests for [feature]"

    **Phase 2: Minimum Implementation (15 min)**
    1. Implement ONLY enough code to pass tests
    2. Follow existing patterns from [similar-file.ts]
    3. Run: npm run test:fast after each change
    4. Commit: "feat: implement [feature] (tests passing)"

    **Phase 3: Validation (5 min)**
    1. Run: npm run gates:g0 (typecheck + lint + drift)
    2. Run: npm run gates:g1 (metadata consistency)
    3. If failures: Fix and re-run
    4. Commit: "chore: validation fixes"

    **Constraints:**
    - NO implementation before tests
    - NO refactoring in this PR (separate PR)
    - NO changes outside [specific-directory]
    - MUST follow existing error handling patterns
  `,
});
```

---

## Example 1: Add New Action to Existing Handler

```typescript
Task({
  subagent_type: 'general-purpose',
  model: 'sonnet',
  description: 'Add bulk_delete action to sheets_data (30min)',
  prompt: `
    Add bulk_delete action to sheets_data handler:

    **Requirements:**
    - Delete multiple rows by IDs in single API call
    - Input: spreadsheetId, sheetName, rowIds (array)
    - Output: { deleted: number, errors: RowError[] }
    - Error handling: Invalid IDs, permission errors

    **TDD Steps:**

    1. Write failing tests (10 min):
       File: tests/handlers/data.test.ts
       Tests:
       - ✓ Deletes multiple rows successfully
       - ✓ Returns deleted count
       - ✓ Handles invalid row IDs gracefully
       - ✓ Batches API calls if >500 rows
       - ✓ Returns partial success on errors

    2. Update schema (5 min):
       File: src/schemas/data.ts
       - Add 'bulk_delete' to action enum
       - Add BulkDeleteInput type
       - Add BulkDeleteOutput type
       - Run: npm run schema:commit

    3. Implement handler (15 min):
       File: src/handlers/data.ts
       - Add handleBulkDelete() method
       - Follow pattern from handleBulkUpdate()
       - Use batchUpdate API with delete operations
       - Handle errors with RowError[] format

    4. Validate:
       - npm run gates:g0
       - npm run gates:g1

    **Success Criteria:**
    - [ ] All tests passing
    - [ ] G0 and G1 gates passing
    - [ ] Schema metadata regenerated
    - [ ] Git history: test commit → feat commit → chore commit
  `,
});
```

---

## Example 2: Fix Bug with Root Cause Analysis

```typescript
Task({
  subagent_type: 'general-purpose',
  model: 'sonnet',
  description: 'Fix composite streaming test failures (45min)',
  prompt: `
    Fix 4 failing tests in tests/handlers/composite.streaming.test.ts

    **Phase 1: Root Cause Analysis (15 min)**
    1. Run failing tests: npm run test:handlers -- composite.streaming
    2. Analyze error messages
    3. Read src/handlers/composite.ts to understand current implementation
    4. Read src/schemas/composite.ts to check expected schema
    5. Identify root cause (likely: missing response fields)

    **Phase 2: Write Additional Tests (10 min)**
    1. Add tests for identified edge cases
    2. Ensure tests capture the bug scenario
    3. Run: npm test -- composite.streaming
    4. Verify: New tests also fail
    5. Commit: "test: add regression tests for streaming bug"

    **Phase 3: Fix Implementation (15 min)**
    1. Fix src/handlers/composite.ts
    2. Add missing response fields
    3. Improve error handling
    4. Run: npm test -- composite.streaming after each change
    5. Commit: "fix: composite streaming response structure"

    **Phase 4: Validation (5 min)**
    1. Run: npm run gates:g0
    2. Run full test suite: npm run test:fast
    3. Verify: No regressions introduced

    **Constraints:**
    - Fix ONLY the identified bug
    - NO unrelated changes
    - NO refactoring in same commit
    - Follow existing response patterns
  `,
});
```

---

## Example 3: Schema Change with Handler Updates

```typescript
Task({
  subagent_type: 'general-purpose',
  model: 'sonnet',
  description: 'Add optional timeout parameter to all tools (40min)',
  prompt: `
    Add optional timeout parameter to all 22 tool schemas:

    **Phase 1: Schema Design (10 min)**
    1. Read src/schemas/shared.ts for common types
    2. Design TimeoutOptions type:
       - timeout?: number (milliseconds)
       - default: 30000 (30s)
       - max: 300000 (5 min)
    3. Document in src/schemas/shared.ts

    **Phase 2: Update Schemas (15 min)**
    1. Add TimeoutOptions to all 22 schemas in src/schemas/*.ts
    2. Make it optional (z.optional())
    3. Add validation: z.number().min(1000).max(300000)
    4. Run: npm run schema:commit (auto-generates metadata)

    **Phase 3: Update BaseHandler (10 min)**
    1. Read src/handlers/base.ts
    2. Extract timeout from request
    3. Pass to Google API client
    4. Add timeout handling logic
    5. Write tests for timeout behavior

    **Phase 4: Validation (5 min)**
    1. Run: npm run gates:g0
    2. Run: npm run gates:g1
    3. Verify: All metadata updated correctly
    4. Check: No breaking changes to existing code

    **Constraints:**
    - Backward compatible (optional parameter)
    - Consistent across all 22 tools
    - Default timeout preserves existing behavior
  `,
});
```

---

## Cost Optimization: When to Use Sonnet vs Opus

**Use Sonnet (Default):** $3-8 per feature
✅ Standard feature implementation
✅ Bug fixes with clear reproduction
✅ Schema changes following patterns
✅ Test-driven development

**Upgrade to Opus:** $15-40 per feature (5x more expensive)
⚠️ Novel algorithm design
⚠️ Complex multi-system integration
⚠️ Critical bugs without clear root cause
⚠️ Architectural decisions

**Example Cost Comparison:**

| Task             | Sonnet Cost | Opus Cost | Savings |
| ---------------- | ----------- | --------- | ------- |
| Add new action   | $5          | $25       | 80%     |
| Fix standard bug | $3          | $15       | 80%     |
| Schema change    | $4          | $20       | 80%     |
| Complex refactor | $15         | $40       | 62%     |

---

## Integration with Other Agents

**Typical Workflow:**

1. **Research Agent** (Haiku - $0.50)
   - Analyze existing patterns
   - Find similar implementations

2. **Planning Agent** (Sonnet - $2)
   - Design implementation approach
   - Create file change plan

3. **Implementation Agent** (Sonnet - $8) ← **THIS TEMPLATE**
   - Write tests first
   - Implement feature
   - Run validation

4. **Validation Agent** (Haiku - $0.30)
   - Run full gate pipeline
   - Verify no regressions

**Total Cost:** ~$11 (vs $70 all-Opus approach)

---

## Tips for Successful Implementation

1. **Always TDD:** Write tests first - enforces clear requirements
2. **Small Commits:** test → feat → chore (easy to review/revert)
3. **Follow Patterns:** Reference similar code (less cognitive load)
4. **Validate Early:** Run gates:g0 after each commit
5. **No Scope Creep:** Fix only what's in the prompt

---

## Success Metrics

**Good Implementation Session:**

- ✓ Tests written before code
- ✓ All tests passing
- ✓ G0 and G1 gates passing
- ✓ 3-5 focused commits
- ✓ No unrelated changes
- ✓ Cost: $5-15 (Sonnet)

**Needs Improvement:**

- ✗ Code before tests
- ✗ Tests still failing
- ✗ Gates failing
- ✗ Single massive commit
- ✗ Refactoring + feature in same PR
- ✗ Cost: $25+ (used Opus unnecessarily)

---

**Related Templates:**

- `research-agent.md` - Find patterns before implementing
- `planning-agent.md` - Design before coding
- `validation-agent.md` - Verify after implementing

## Runtime Guardrails

Before taking tool actions, load `.claude/AGENT_GUARDRAILS.md`.
If it exists, load `.agent-context/learning-memory.md` and apply the top recurring fixes first.
