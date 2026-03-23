# Research Agent Template

**Purpose:** Fast codebase analysis and pattern discovery using read-only operations

**Model:** Haiku 4.5 (Fastest, cheapest - $0.25/1M input tokens)
**Subagent Type:** `Explore`
**Typical Duration:** 3-10 minutes
**Average Cost:** $0.10-0.50 per task

---

## When to Use

✅ **Pattern Discovery**

- Find common patterns across handlers
- Identify naming conventions
- Extract architectural patterns

✅ **Code Analysis**

- Count occurrences of patterns
- Find all usages of a function
- Analyze error handling approaches

✅ **Documentation Research**

- Find all TODOs
- Check for outdated comments
- Validate documentation accuracy

❌ **Not Suitable For**

- Complex reasoning about trade-offs
- Multi-step implementation planning
- Architectural decision-making

---

## Basic Template

```typescript
Task({
  subagent_type: 'Explore',
  model: 'haiku',
  description: 'Research [topic] (5min)',
  prompt: `
    Analyze [files/patterns] to identify:

    1. [Research question 1]
    2. [Research question 2]
    3. [Research question 3]

    Output: Markdown summary with findings
  `,
});
```

---

## Example 1: Handler Pattern Analysis

```typescript
Task({
  subagent_type: 'Explore',
  model: 'haiku',
  description: 'Research handler patterns (5min)',
  prompt: `
    Analyze all 22 handlers in src/handlers/*.ts to identify:

    1. Action naming patterns
       - Verb_noun (e.g., read_range)
       - Noun_verb (e.g., range_read)
       - Single word (e.g., list)

    2. Parameter validation patterns
       - Zod schema validation locations
       - Common required parameters
       - Optional parameter patterns

    3. Error handling conventions
       - Error codes used
       - Error message formats
       - Where errors are thrown

    4. Response structure patterns
       - Success response format
       - Error response format
       - Data wrapping conventions

    Create findings summary showing:
    - Frequency of each pattern
    - Most common conventions
    - Outliers and inconsistencies
    - Recommendations for standardization
  `,
});
```

**Expected Output:**

```markdown
# Handler Pattern Analysis

## Action Naming Patterns

- verb_noun: 68% (e.g., read_range, create_sheet)
- noun_verb: 22% (e.g., sheet_create, range_update)
- single_word: 10% (e.g., list, get)

**Recommendation:** Standardize on verb_noun pattern

## Parameter Validation

- All handlers use Zod schemas ✓
- 95% validate at handler entry point ✓
- 5% validate in sub-methods (outliers)
```

---

## Example 2: Find All TODOs

```typescript
Task({
  subagent_type: 'Explore',
  model: 'haiku',
  description: 'Find all TODOs (3min)',
  prompt: `
    Search all src/**/*.ts files for:

    1. TODO comments
    2. FIXME comments
    3. HACK comments
    4. XXX comments

    For each finding, extract:
    - File path and line number
    - Comment text
    - Surrounding context (function/class name)
    - Priority (critical/high/medium/low based on keywords)

    Group by priority and show file:line references.
  `,
});
```

---

## Example 3: Error Code Audit

```typescript
Task({
  subagent_type: 'Explore',
  model: 'haiku',
  description: 'Audit error codes (5min)',
  prompt: `
    Compare error codes in two locations:

    1. Defined: src/schemas/shared.ts:359+ (ErrorCodeSchema enum)
    2. Used: All throw statements in src/**/*.ts

    Identify:
    - Error codes defined but never used
    - Error codes used but not defined (will break!)
    - Most frequently used error codes
    - Handlers missing error handling

    Create table:
    | Error Code | Defined | Used | Frequency | Files |

    Flag any mismatches as CRITICAL issues.
  `,
});
```

---

## Example 4: Test Coverage Gaps

```typescript
Task({
  subagent_type: 'Explore',
  model: 'haiku',
  description: 'Find test coverage gaps (7min)',
  prompt: `
    For each handler in src/handlers/*.ts:

    1. List all public methods (executeAction, handle*)
    2. Check if test file exists in tests/handlers/
    3. If test exists, check if all methods are tested

    Identify:
    - Handlers with no test file (CRITICAL)
    - Handlers with partial test coverage
    - Methods tested but not called in production (dead code?)

    Report format:
    ## Critical Gaps (No Tests)
    - src/handlers/newfeature.ts → tests/handlers/newfeature.test.ts missing!

    ## Partial Coverage
    - src/handlers/core.ts
      - ✓ handleReadRange tested
      - ✓ handleWriteRange tested
      - ✗ handleBulkRead not tested
  `,
});
```

---

## Advanced: Parallel Research Tasks

For large codebases, spawn multiple research agents in parallel:

```typescript
// Agent 1: Handlers
Task({
  subagent_type: 'Explore',
  model: 'haiku',
  description: 'Research handlers (5min)',
  prompt: 'Analyze src/handlers/*.ts...',
});

// Agent 2: Schemas (parallel)
Task({
  subagent_type: 'Explore',
  model: 'haiku',
  description: 'Research schemas (5min)',
  prompt: 'Analyze src/schemas/*.ts...',
});

// Agent 3: Tests (parallel)
Task({
  subagent_type: 'Explore',
  model: 'haiku',
  description: 'Research test coverage (5min)',
  prompt: 'Analyze tests/**/*.ts...',
});
```

**Speedup:** 3x faster than sequential (15min → 5min)

---

## Tips for Optimal Results

1. **Be Specific**: "Find all error codes" better than "check errors"
2. **Structure Output**: Request markdown tables, JSON, or specific formats
3. **Set Boundaries**: "Top 10", "First 5 files", etc. to limit scope
4. **Request Examples**: "Show 3 examples of each pattern"
5. **Flag Priorities**: "Mark CRITICAL issues in caps"

---

## Cost Estimation

**Haiku 4.5 Pricing:**

- Input: $0.25 per 1M tokens
- Output: $1.25 per 1M tokens

**Typical 5-Minute Research Task:**

- Input: ~20k tokens (read files) = $0.005
- Output: ~5k tokens (summary) = $0.006
- **Total: ~$0.01 per task**

**vs Opus (same task):** $0.50 → **50x more expensive**

---

## Next Steps

After research is complete:

1. **Review findings** - Check research output
2. **Use planning-agent.md** - Design implementation
3. **Use implementation-agent.md** - Execute changes
4. **Use validation-agent.md** - Verify correctness

---

**Related Templates:**

- `planning-agent.md` - Use research findings to design implementation
- `validation-agent.md` - Validate research findings with tests

## Runtime Guardrails

Before taking tool actions, load `.claude/AGENT_GUARDRAILS.md`.
If it exists, load `.agent-context/learning-memory.md` and apply the top recurring fixes first.
