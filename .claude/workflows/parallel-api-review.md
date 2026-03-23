# Workflow Template: Parallel API Review

**Pattern:** Parallel Expert Review → Aggregation
**Team Size:** 4 agents (parallel)
**Cost:** $10-15 total
**Time:** 3-5 minutes (parallel execution)

---

## Workflow Overview

```
Main Agent spawns 4 parallel subagents:
    ├─ google-api-expert (Sheets API v4)
    ├─ google-drive-expert (Drive API v3)
    ├─ google-bigquery-expert (BigQuery)
    └─ google-appsscript-expert (Apps Script)

All agents execute simultaneously ⚡
Results return in 3-5 minutes
Main agent aggregates findings
```

---

## Step 1: Spawn Parallel Reviews (Simultaneous)

### Agent 1: google-api-expert (Sonnet, $3-7, 2-3min)

**Task:**

```
Review Google Sheets API v4 usage in ServalSheets:
1. Check batch operations in src/handlers/*.ts
2. Verify field masks for quota optimization
3. Review error handling for 429/500 errors
4. Analyze HTTP/2 connection management
5. Report top 3 optimization opportunities
```

### Agent 2: google-drive-expert (Sonnet, $2-4, 2-3min)

**Task:**

```
Review Google Drive API v3 integration:
1. Check permission management in src/handlers/collaborate.ts
2. Verify file operation safety (duplicate checks)
3. Review OAuth scope configuration
4. Analyze export operations quota awareness
5. Report top 3 issues found
```

### Agent 3: google-bigquery-expert (Sonnet, $2-4, 2-3min)

**Task:**

```
Review BigQuery integration patterns:
1. Check query parameterization in src/handlers/bigquery.ts
2. Verify SQL injection prevention
3. Review quota controls (timeoutMs, maximumBytesBilled)
4. Analyze circuit breaker configuration
5. Report top 3 security/performance issues
```

### Agent 4: google-appsscript-expert (Sonnet, $2-4, 2-3min)

**Task:**

```
Review Apps Script automation:
1. Check script execution safety in src/handlers/appsscript.ts
2. Verify deployment validation
3. Review timeout configuration (30s vs 6min)
4. Analyze custom function patterns
5. Report top 3 safety issues
```

---

## Step 2: Aggregate Results (1 min)

**Main Agent Task:**

```
Synthesize findings from 4 API experts:
1. Group issues by severity (Critical/High/Medium/Low)
2. Identify common patterns across APIs
3. Prioritize fixes by impact
4. Generate consolidated recommendations
```

**Output Format:**

```markdown
# API Review Summary - ServalSheets

## Critical Issues (Must Fix)

1. [Issue from Expert X]
2. [Issue from Expert Y]

## High Priority (Should Fix)

1. [Issue from Expert Z]

## Medium Priority (Nice to Have)

...

## Common Patterns Observed

- Pattern 1 across Sheets/Drive/BigQuery
- Pattern 2 in error handling

## Recommended Actions

1. Priority 1: Fix [Issue]
2. Priority 2: Optimize [Pattern]
```

---

## Example Execution

### Spawn Command (Single Message)

```
Review API usage patterns in parallel:
- Use google-api-expert to analyze Sheets API in src/handlers/
- Use google-drive-expert to review Drive integration in collaborate.ts
- Use google-bigquery-expert to check BigQuery in bigquery.ts
- Use google-appsscript-expert to validate Apps Script in appsscript.ts

Report findings with severity ratings and file:line references.
```

### Expected Timeline

```
t=0s:    Spawn 4 agents simultaneously
t=30s:   First agent starts returning results
t=120s:  All agents complete (slowest finishes)
t=180s:  Aggregation complete
TOTAL:   3 minutes (vs 12 minutes sequential!)
```

---

## Success Criteria

- ✅ All 4 agents spawn successfully
- ✅ Each agent completes in < 3 minutes
- ✅ Findings include file:line references
- ✅ Severity ratings provided
- ✅ Aggregation identifies priorities
- ✅ Total cost < $15
- ✅ Total time < 5 minutes

---

## Workflow Variants

### Variant A: 2-Agent Quick Review

**Agents:** google-api-expert + google-drive-expert only
**Cost:** $5-11, **Time:** 2-3 min
**Use when:** Quick Sheets/Drive audit

### Variant B: Full 5-Agent Review

**Add:** testing-specialist for test coverage
**Cost:** $12-19, **Time:** 3-5 min
**Use when:** Comprehensive pre-release audit

### Variant C: Sequential Review (Detailed)

**Pattern:** One agent at a time, in-depth analysis
**Cost:** Same ($10-15), **Time:** 12-15 min (4x slower!)
**Use when:** Need detailed per-API analysis

---

## Cost Optimization

### Parallel vs Sequential

**Parallel (Recommended):**

```
Agent 1: $3 (runs 2min)
Agent 2: $2 (runs 2min)  } All execute simultaneously
Agent 3: $2 (runs 2min)  } Cost = sum, Time = max
Agent 4: $2 (runs 2min)
TOTAL: $9, 2 minutes
```

**Sequential (Not Recommended):**

```
Agent 1: $3 (2min) → wait
Agent 2: $2 (2min) → wait
Agent 3: $2 (2min) → wait
Agent 4: $2 (2min) → wait
TOTAL: $9, 8 minutes (4x slower, same cost!)
```

**Key Insight:** Parallel execution is FREE in terms of cost, 4x faster!

---

## Troubleshooting

### Issue: Agents Return Different Formats

**Solution:** Provide explicit output format in spawn prompt

### Issue: One Agent Times Out

**Solution:** Results from other 3 agents still valid, re-spawn failed agent

### Issue: Findings Overlap

**Solution:** Deduplication in aggregation step (expected, not a bug)

### Issue: Cost Exceeds $15

**Cause:** Agents using Opus instead of Sonnet
**Solution:** Verify `model: sonnet` in agent YAML frontmatter

---

## Integration with Test Failures

**When integration tests fail (e.g., Phase 2 failures):**

1. **Spawn parallel review** to identify API usage issues
2. **Aggregate findings** with test failure context
3. **Prioritize fixes** based on both reviews
4. **Assign to implementation agent** for fixes

**Example:**

```
Integration test shows: "graph.trackRead is not a function"
API review shows: No range tracking in CacheInvalidationGraph
Combined insight: Missing runtime tracking API
Priority: HIGH (blocks Phase 2 integration)
```

---

## Template Checklist

- [ ] All 4 expert agents available
- [ ] Spawn command includes all tasks
- [ ] Each task has clear deliverables
- [ ] Aggregation format defined
- [ ] Cost budget: $10-15
- [ ] Time budget: 3-5 minutes
- [ ] Parallel execution confirmed (not sequential)
