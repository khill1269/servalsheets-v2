# Agent Templates for ServalSheets

**Purpose:** Pre-configured agent templates with optimal model selection for common workflows.

**Last Updated:** 2026-02-17
**Claude Code Version:** 2.1.44+

---

## Quick Reference

| Agent Type         | Model  | Cost     | Speed   | Best For                                  |
| ------------------ | ------ | -------- | ------- | ----------------------------------------- |
| **Research**       | Haiku  | $0.25/1M | Fastest | File searches, pattern extraction         |
| **Planning**       | Sonnet | $3/1M    | Fast    | Architecture design, implementation plans |
| **Implementation** | Sonnet | $3/1M    | Fast    | Feature development, bug fixes            |
| **Validation**     | Haiku  | $0.25/1M | Fastest | Running tests, gate checks                |
| **Complex**        | Opus   | $15/1M   | Slower  | Novel architecture, critical debugging    |

---

## Available Templates

1. **research-agent.md** - Codebase analysis and pattern discovery
2. **planning-agent.md** - Implementation planning and architecture design
3. **implementation-agent.md** - TDD-based feature implementation
4. **validation-agent.md** - Gate pipeline execution and validation
5. **design-agent.md** - UX/design planning for frontend work

---

## Usage

### 1. Direct Copy-Paste

```typescript
// Open template → Copy Task() block → Paste into Claude Code chat
```

### 2. Reference in Prompts

```
"Use the research-agent template to analyze all handlers"
```

### 3. Customize for Specific Task

```typescript
// Copy template → Modify prompt → Execute
Task({
  subagent_type: 'Explore',
  model: 'haiku',
  description: 'Custom research task',
  prompt: 'Your specific requirements...',
});
```

### 4. Apply Guardrails First

Read `.claude/AGENT_GUARDRAILS.md` before tool use.
If available, also read `.agent-context/learning-memory.md`.

---

## Model Selection Guidelines

### When to Use Haiku (80x cheaper than Opus)

✅ File searches (Grep, Glob, Read)
✅ Pattern extraction from code
✅ Running validation scripts
✅ Test execution
✅ Simple transformations

❌ Complex reasoning
❌ Novel algorithm design
❌ Multi-file refactoring

### When to Use Sonnet (5x cheaper than Opus)

✅ Feature implementation
✅ Bug fixes with debugging
✅ Architecture planning
✅ Multi-file changes
✅ Test-driven development

❌ Completely novel solutions
❌ Critical business logic requiring perfect accuracy

### When to Use Opus (Most expensive - use sparingly)

✅ Novel architecture design
✅ Complex debugging with multiple hypotheses
✅ Critical business logic
✅ Situations where mistakes are costly

❌ Routine searches
❌ Simple implementations
❌ Validation tasks

---

## Cost Optimization Tips

**Average Task Costs:**

| Task Type               | Haiku | Sonnet | Opus   | Savings (vs Opus) |
| ----------------------- | ----- | ------ | ------ | ----------------- |
| Research (5 min)        | $0.10 | $1.50  | $7.50  | 98%               |
| Planning (10 min)       | $0.50 | $3.00  | $15.00 | 97%               |
| Implementation (30 min) | $2.00 | $8.00  | $40.00 | 95%               |
| Validation (5 min)      | $0.10 | $1.50  | $7.50  | 98%               |

**Full Development Cycle:**

- All Opus: $70
- Optimized: $12 (83% savings)

---

## Examples

See `examples/` directory for complete workflows:

- `schema-change-workflow.md` - Full schema change automation
- `phase-1-natural-language.md` - End-to-end natural language workflow

---

## Integration with Keyboard Shortcuts

| Shortcut      | Task              | Agent Template          |
| ------------- | ----------------- | ----------------------- |
| `Cmd+G Cmd+0` | G0 validation     | validation-agent.md     |
| `Cmd+Shift+S` | Schema commit     | implementation-agent.md |
| `Cmd+Shift+F` | Test current file | validation-agent.md     |

---

## Troubleshooting

**Q: Agent returns "Permission denied"**
A: Check `.claude/settings.local.json` - ensure tool permissions are granted

**Q: Model costs too high**
A: Review task → Use haiku for research/validation, sonnet for implementation

**Q: Agent fails to complete task**
A: Task may be too complex → Break into smaller tasks or upgrade to sonnet/opus

---

**Next:** Open specific agent template for detailed usage instructions.
