# Example Workflow: Natural Language Discovery (Phase 1)

**Feature:** Intent Classifier for Natural Language Action Discovery

**Estimated time:** 5-7 days with agents (vs 20 days manual)

**Agents used:** Research → Design → Implementation → Validation

---

## Step 1: Research (Day 1)

**Agent:** Research Agent

**Input:** Handler files (src/handlers/\*.ts)

**Output:** Pattern analysis (docs/analysis/handler-patterns.md)

**Command:**

```bash
# Start Claude Code in agent mode
claude --agent

# In Claude session:
"Use the research agent template to analyze handler patterns for intent classification"
```

**Task prompt:**

```
Task(
  subagent_type="Explore",
  prompt="""
  Analyze all 22 handlers in src/handlers/*.ts:

  Extract:
  1. Action naming patterns (verb_noun, noun_verb, etc.)
  2. Common verbs (list, get, create, update, delete, etc.)
  3. Parameter patterns (spreadsheetId, range, etc.)
  4. Response patterns

  Create frequency table showing most common patterns.

  Output: docs/analysis/handler-patterns.md
  """,
  description="Research: Handler patterns"
)
```

**Validation:**

```bash
# Verify output exists
ls -la docs/analysis/handler-patterns.md

# Should be 200-500 lines
wc -l docs/analysis/handler-patterns.md

# Should have file:line references
grep -c "src/handlers/.*:[0-9]" docs/analysis/handler-patterns.md
```

---

## Step 2: Design (Days 2-3)

**Agent:** Design Agent

**Input:** Pattern analysis (docs/analysis/handler-patterns.md)

**Output:** Architecture design (docs/design/intent-classifier.md)

**Task prompt:**

```
Task(
  subagent_type="Plan",
  prompt="""
  Design intent classifier architecture using docs/analysis/handler-patterns.md:

  Requirements:
  1. Map natural language → action names (342 actions)
  2. 70%+ accuracy on common queries
  3. <100ms latency (p95)
  4. No ML dependencies (rules-based)

  Design:
  1. Algorithm (fuzzy matching + synonym expansion)
  2. Data structures (action index, synonym dictionary)
  3. API interface (input/output contracts)
  4. Error handling (low confidence, ambiguous)
  5. Test plan (20+ test cases)

  Output: docs/design/intent-classifier.md
  """,
  description="Design: Intent classifier"
)
```

**Validation:**

```bash
# Verify design exists
ls -la docs/design/intent-classifier.md

# Should have TypeScript interfaces
grep -c "interface" docs/design/intent-classifier.md

# Should have test plan
grep -c "Test case" docs/design/intent-classifier.md
```

---

## Step 3: Implementation (Days 4-5)

**Agent:** Implementation Agent

**Input:** Architecture design (docs/design/intent-classifier.md)

**Output:** Production code + tests

**Task prompt:**

```
Task(
  subagent_type="general-purpose",
  prompt="""
  Implement intent classifier from docs/design/intent-classifier.md:

  TDD workflow:
  1. Write failing tests FIRST (tests/services/intent-classifier.test.ts)
  2. Implement service (src/services/intent-classifier.ts)
  3. Run tests until pass

  Test requirements (20+ cases):
  - Exact matches
  - Synonym expansion
  - Fuzzy matching
  - Ambiguous queries
  - Edge cases (empty, special chars)
  - Performance (<100ms)

  Implementation requirements:
  - TypeScript strict mode
  - Zod input validation
  - Structured errors
  - Export only public API

  Files:
  - src/services/intent-classifier.ts
  - src/services/intent-classifier-types.ts
  - tests/services/intent-classifier.test.ts

  Success: All tests pass + typecheck + lint
  """,
  description="Implement: Intent classifier (TDD)"
)
```

**Validation:**

```bash
# Tests should pass
npm run test:fast

# Typecheck should pass
npm run typecheck

# Lint should pass
npm run lint

# Check test coverage
npm run test:coverage
# Should show >80% coverage for intent-classifier.ts
```

---

## Step 4: Validation (Day 6)

**Agent:** Validation Agent

**Input:** Completed implementation

**Output:** Validation report

**Task prompt:**

```
Task(
  subagent_type="general-purpose",
  prompt="""
  Run G0-G2 validation on intent classifier implementation:

  G0: Baseline Integrity
  - npm run typecheck (should pass)
  - npm run lint (should pass)
  - npm run check:drift (should pass)
  - npm run test:fast (should pass)

  G1: Metadata Consistency
  - No schema changes, skip

  G2: Phase Behavior
  - npm run test:handlers (should pass)
  - npm run test:integration (should pass)

  Create validation report: docs/validation/intent-classifier.md
  """,
  description="Validate: Intent classifier (G0-G2)"
)
```

---

## Step 5: Integration & Handoff (Day 7)

**Manual step:** Human review and integration

**Review checklist:**

- [ ] Code follows ServalSheets conventions
- [ ] Tests cover happy path + edge cases
- [ ] Performance meets requirements (<100ms)
- [ ] Documentation is clear
- [ ] Validation gates passed

**Integration:**

```bash
# Run full gate pipeline before commit
Cmd+G Cmd+A  # Or: npm run gates

# If all pass, commit
git add .
git commit -m "feat(discovery): add natural language intent classifier

Implements intent classification for 342 actions across 22 tools.

Features:
- 3-stage pipeline (normalize, expand, fuzzy match)
- 70%+ accuracy on common queries
- <100ms p95 latency
- 20+ test cases with 82% coverage

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Total Time

**With agents:** 6-7 days (research: 1d, design: 2d, implement: 2d, validate: 1d, integration: 1d)

**Without agents:** 20 days (manual research: 5d, manual design: 5d, manual implement: 8d, manual validate: 2d)

**Speedup:** 3x

---

## Lessons Learned

**What worked:**

- TDD enforcement (implementation agent follows design)
- Clear templates (agents know expectations)
- Sequential workflow (research → design → implement → validate)

**What to improve:**

- Add more test case examples to design template
- Create reusable action index fixture
- Automate validation report generation
