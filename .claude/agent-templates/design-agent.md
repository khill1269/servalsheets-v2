# Design Agent Template

**Purpose:** Architecture and implementation planning

**Specialization:** Plan mode, architecture design, API design

**Typical usage:**

- Design system architecture
- Create implementation plans
- Design APIs and interfaces
- Plan testing strategies

## Task Template

```
Task(
  subagent_type="Plan",
  prompt="[DESIGN OBJECTIVE]",
  description="[SHORT DESCRIPTION]"
)
```

## Example: Intent Classifier Architecture

```
Task(
  subagent_type="Plan",
  prompt="""
  Based on the handler pattern analysis in docs/analysis/handler-patterns.md,
  design an intent classifier architecture:

  Requirements:
  1. Map natural language queries to action names
  2. Support 342 actions across 22 tools
  3. 70%+ accuracy on common queries
  4. <100ms latency (p95)
  5. Minimal dependencies (no ML models)

  Design decisions needed:
  1. Algorithm approach (fuzzy match, synonym mapping, rules-based)
  2. Data structures (action index, synonym dictionary)
  3. API interface (input/output contracts)
  4. Error handling (low confidence, ambiguous matches)
  5. Testing strategy (test cases, acceptance criteria)

  Deliverables:
  1. Architecture document (docs/design/intent-classifier.md)
  2. API specification (TypeScript interfaces)
  3. Test plan (acceptance criteria)
  4. Implementation estimate (effort + risk)

  Use ServalSheets conventions:
  - Zod schemas for validation
  - Structured errors with ErrorCode
  - Response format: { response: { success, data } }
  """,
  description="Design: Intent classifier architecture"
)
```

## Expected Output

- Architecture document (markdown)
- API specification (TypeScript interfaces)
- Test plan (acceptance criteria)
- Implementation estimate (effort + risk)

## Success Criteria

- [ ] Architecture addresses all requirements
- [ ] API specification is complete and unambiguous
- [ ] Test plan covers happy path + edge cases
- [ ] Estimate includes effort and risk assessment

## Common Patterns

### Pattern: Design new service

```
Task(
  subagent_type="Plan",
  prompt="""
  Design a new service for [FEATURE]:

  Requirements:
  - [Requirement 1]
  - [Requirement 2]
  - [Requirement 3]

  Constraints:
  - [Constraint 1]
  - [Constraint 2]

  Deliverables:
  1. Architecture document
  2. TypeScript interfaces
  3. Test plan
  4. Implementation estimate

  Follow ServalSheets patterns (see CLAUDE.md).
  """,
  description="Design: [FEATURE] service"
)
```

### Pattern: Design API endpoint

```
Task(
  subagent_type="Plan",
  prompt="""
  Design API endpoint for [ACTION]:

  Input schema:
  - [Field 1]: [Type + validation rules]
  - [Field 2]: [Type + validation rules]

  Output schema:
  - success: boolean
  - data: [Shape]

  Error handling:
  - [Error case 1] → [Error code]
  - [Error case 2] → [Error code]

  Deliverables:
  1. Zod schema definition
  2. TypeScript interfaces
  3. Error mapping
  4. Test cases (5+ scenarios)
  """,
  description="Design: [ACTION] API endpoint"
)
```

## Integration with Implementation

After design agent completes, implementation agent uses:

```bash
# Verify design document exists
ls -la docs/design/intent-classifier.md

# Check for TypeScript interfaces
grep -c "interface" docs/design/intent-classifier.md

# Verify test plan exists
grep -c "Test case" docs/design/intent-classifier.md
```

## Runtime Guardrails

Before taking tool actions, load `.claude/AGENT_GUARDRAILS.md`.
If it exists, load `.agent-context/learning-memory.md` and apply the top recurring fixes first.
