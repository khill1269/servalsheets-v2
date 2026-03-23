# Complete Workflow Example: Schema Change

**Scenario:** Add new `timeout` parameter to all 22 tool schemas

**Estimated Time:** 60 minutes
**Estimated Cost (Optimized):** $11.40
**Estimated Cost (All Opus):** $70.00
**Savings:** 84%

---

## Agent 1: Research Existing Patterns (Haiku)

**Cost:** ~$0.10 | **Time:** 5 minutes

```typescript
Task({
  subagent_type: 'Explore',
  model: 'haiku',
  description: 'Research timeout patterns (5min)',
  prompt: `
    Research how timeouts are currently handled:

    1. Search for existing timeout parameters:
       - grep -r "timeout" src/schemas/
       - Check if any schemas already have timeout
       - Look at src/handlers/base.ts for timeout handling

    2. Find similar optional parameters:
       - Look for other optional parameters in schemas
       - Identify the z.optional() pattern usage
       - Check validation patterns (min/max values)

    3. Analyze Google API timeout behavior:
       - Check src/services/google-api.ts
       - Identify where timeout would be applied
       - Document current default timeout (if any)

    Output:
    - Current timeout handling (if exists)
    - Common optional parameter patterns
    - Where timeout will be applied in code
    - Recommended default/max values
  `,
});
```

**Expected Output:**

````markdown
# Timeout Pattern Research

## Current State

- No explicit timeout parameters in schemas
- Default timeout: 30s (from Google API client config)
- Applied at: src/services/google-api.ts:42

## Optional Parameter Pattern

All optional parameters follow this pattern:

```typescript
z.object({
  requiredParam: z.string(),
  optionalParam: z.string().optional(),
});
```
````

## Recommendations

- timeout?: number (milliseconds)
- Default: 30000 (30s)
- Min: 1000 (1s)
- Max: 300000 (5min)
- Validation: z.number().min(1000).max(300000).optional()

````

---

## Agent 2: Plan Implementation (Sonnet)

**Cost:** ~$3.00 | **Time:** 10 minutes

```typescript
Task({
  subagent_type: "Plan",
  model: "sonnet",
  description: "Plan timeout implementation (10min)",
  prompt: `
    Based on research findings, create implementation plan:

    **Files to Modify:**
    1. src/schemas/shared.ts
       - Add TimeoutOptions type
       - Add validation schema
       - Document default/max values

    2. src/schemas/*.ts (22 files)
       - Add timeout?: number to each tool's input schema
       - Use TimeoutOptions validation
       - Maintain backward compatibility

    3. src/handlers/base.ts
       - Extract timeout from request
       - Pass to Google API client
       - Handle timeout errors

    4. tests/schemas/*.test.ts
       - Add timeout validation tests
       - Test min/max boundaries
       - Test optional behavior

    5. tests/handlers/base.test.ts
       - Test timeout extraction
       - Test timeout application
       - Test timeout error handling

    **Implementation Order:**
    1. Phase 1: Add shared types (10 min)
    2. Phase 2: Update schemas (20 min)
    3. Phase 3: Update BaseHandler (15 min)
    4. Phase 4: Add tests (15 min)
    5. Phase 5: Validate (G0-G1) (10 min)

    **Backward Compatibility:**
    - timeout is optional (maintains existing behavior)
    - Default: 30000ms (current implicit default)
    - Existing code works without changes

    **Metadata Impact:**
    - ACTION_COUNT: No change (not adding actions)
    - TOOL_COUNT: No change (not adding tools)
    - Schema metadata: Will regenerate

    **Success Criteria:**
    - [ ] All 22 schemas updated
    - [ ] Tests passing
    - [ ] G0 + G1 gates passing
    - [ ] Backward compatible
  `
})
````

**Expected Output:**

````markdown
# Timeout Implementation Plan

## Phase 1: Shared Types (10 min)

File: src/schemas/shared.ts

Add after line 50:

```typescript
export const TimeoutSchema = z
  .number()
  .min(1000, 'Timeout must be at least 1 second')
  .max(300000, 'Timeout cannot exceed 5 minutes')
  .optional()
  .describe('Request timeout in milliseconds (default: 30000)');
```
````

## Phase 2: Update All Schemas (20 min)

For each of 22 schemas in src/schemas/\*.ts:

```typescript
// Example: src/schemas/data.ts
export const SheetsDataInputSchema = z.object({
  action: z.enum([...]),
  spreadsheetId: z.string(),
  timeout: TimeoutSchema, // ← Add this
  // ... other fields
});
```

Automated with: scripts/bulk-schema-update.sh

## Phase 3: BaseHandler Integration (15 min)

File: src/handlers/base.ts

...
[Complete implementation steps]

````

---

## Agent 3: Implementation (Sonnet)

**Cost:** ~$8.00 | **Time:** 40 minutes

```typescript
Task({
  subagent_type: "general-purpose",
  model: "sonnet",
  description: "Implement timeout parameter (40min)",
  prompt: `
    Implement timeout parameter following the plan in
    .claude/agent-templates/examples/schema-change-workflow.md

    **TDD Workflow:**

    Phase 1: Write Failing Tests (10 min)
    1. Create tests/schemas/timeout.test.ts
       - Test timeout validation (min/max)
       - Test optional behavior
       - Test default value

    2. Update tests/handlers/base.test.ts
       - Test timeout extraction
       - Test timeout application
       - Test timeout errors

    3. Run: npm test -- timeout
       - Should fail (not implemented yet)

    4. Commit: "test: add timeout parameter tests"

    Phase 2: Implement Shared Types (5 min)
    1. Edit src/schemas/shared.ts
       - Add TimeoutSchema
       - Add documentation

    2. Commit: "feat: add TimeoutSchema to shared types"

    Phase 3: Update All Schemas (15 min)
    1. For each schema in src/schemas/*.ts:
       - Add timeout: TimeoutSchema

    2. Run: npm run schema:commit
       - Regenerates metadata
       - Runs typecheck
       - Runs fast tests
       - Auto-stages files

    3. Commit: "feat: add timeout to all 22 tool schemas"

    Phase 4: Update BaseHandler (10 min)
    1. Edit src/handlers/base.ts
       - Extract timeout from request
       - Pass to API client
       - Handle timeout errors

    2. Run: npm test -- base
       - Should pass

    3. Commit: "feat: implement timeout handling in BaseHandler"

    **Validation:**
    - npm run gates:g0 (baseline integrity)
    - npm run gates:g1 (metadata consistency)

    **Constraints:**
    - Follow TDD (tests first!)
    - NO implementation before tests
    - NO changes outside specified files
    - Run schema:commit after schema changes
  `
})
````

**Expected Commits:**

```
1. test: add timeout parameter tests
2. feat: add TimeoutSchema to shared types
3. feat: add timeout to all 22 tool schemas
4. feat: implement timeout handling in BaseHandler
```

---

## Agent 4: Validation (Haiku)

**Cost:** ~$0.30 | **Time:** 5 minutes

```typescript
Task({
  subagent_type: 'general-purpose',
  model: 'haiku',
  description: 'Validate timeout implementation (5min)',
  prompt: `
    Validate timeout implementation:

    **G0: Baseline Integrity**
    npm run gates:g0

    Expected to pass:
    - ✓ TypeScript compilation (0 errors)
    - ✓ ESLint checks (0 errors)
    - ✓ Metadata drift (none)
    - ✓ Placeholders (none)
    - ✓ Silent fallbacks (none)
    - ✓ Fast tests (all passing)

    **G1: Metadata Consistency**
    npm run gates:g1

    Expected to pass:
    - ✓ Cross-map consistency
    - ✓ Schema-handler alignment
    - ✓ Hardcoded counts (none)
    - ✓ Action count unchanged (still 299)
    - ✓ Tool count unchanged (still 24)

    **Output Format:**
    ## Validation Results

    ### G0: Baseline Integrity
    Status: PASS ✓
    Duration: 95s
    Tests: 142/142 passing

    ### G1: Metadata Consistency
    Status: PASS ✓
    Duration: 42s
    Metadata files updated: 5

    ### Files Changed:
    - src/schemas/shared.ts (TimeoutSchema added)
    - src/schemas/*.ts (22 schemas updated)
    - src/handlers/base.ts (timeout handling)
    - tests/schemas/timeout.test.ts (new)
    - tests/handlers/base.test.ts (updated)
    - Generated files: 5 (index.ts, annotations.ts, etc.)

    ### Ready for Commit: YES ✓

    If any failures, report file:line and suggested fixes.
  `,
});
```

**Expected Output:**

```markdown
## Validation Results

### G0: Baseline Integrity ✓

- TypeScript: 0 errors
- ESLint: 0 errors
- Metadata: No drift
- Tests: 142/142 passing
  Duration: 95s

### G1: Metadata Consistency ✓

- Cross-map: ✓ All 22 tools aligned
- Schema-handler: ✓ All aligned
- Action count: 299 (unchanged ✓)
- Tool count: 24 (unchanged ✓)
  Duration: 42s

### Ready for Commit: YES ✓
```

---

## Complete Workflow Summary

| Agent             | Model     | Cost       | Time      | Output               |
| ----------------- | --------- | ---------- | --------- | -------------------- |
| 1. Research       | Haiku     | $0.10      | 5min      | Pattern analysis     |
| 2. Planning       | Sonnet    | $3.00      | 10min     | Implementation plan  |
| 3. Implementation | Sonnet    | $8.00      | 40min     | Working code + tests |
| 4. Validation     | Haiku     | $0.30      | 5min      | PASS/FAIL report     |
| **Total**         | **Mixed** | **$11.40** | **60min** | **Complete feature** |

**vs All Opus:** $70.00 → **84% savings**

---

## Keyboard Shortcuts Used

| Shortcut      | Action                   | When                           |
| ------------- | ------------------------ | ------------------------------ |
| `Cmd+Shift+S` | Schema commit workflow   | After schema changes (Agent 3) |
| `Cmd+G Cmd+0` | G0: Baseline integrity   | Validation (Agent 4)           |
| `Cmd+G Cmd+1` | G1: Metadata consistency | Validation (Agent 4)           |
| `Cmd+K Cmd+V` | Quick verify             | Final check                    |

---

## Success Metrics

✅ **All gates passing**
✅ **Cost: $11.40** (84% under budget)
✅ **Time: 60min** (on estimate)
✅ **Backward compatible**
✅ **All 22 tools updated consistently**
✅ **Tests covering edge cases**

---

## Common Issues & Solutions

**Issue 1: Metadata drift after schema changes**

- **Cause:** Forgot to run `npm run schema:commit`
- **Solution:** Run it now, re-validate with G1

**Issue 2: Tests failing after implementation**

- **Cause:** Validation logic too strict or wrong default
- **Solution:** Review test expectations, adjust validation

**Issue 3: G1 fails (schema-handler alignment)**

- **Cause:** Handler doesn't extract new parameter
- **Solution:** Update BaseHandler to extract timeout

---

**Related Templates:**

- `research-agent.md` - Agent 1 template
- `planning-agent.md` - Agent 2 template (use Plan subagent)
- `implementation-agent.md` - Agent 3 template
- `validation-agent.md` - Agent 4 template
