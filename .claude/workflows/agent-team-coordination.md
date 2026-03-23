# Workflow Template: Agent Team Coordination

**Pattern:** Lead + Multiple Teammates with Shared Task List
**Team Size:** 5 agents (1 lead + 4 teammates)
**Cost:** $25-35 per complex feature
**Time:** 30-40 minutes

---

## When to Use Agent Teams

### ✅ Use Agent Teams When:

- Complex features requiring coordination (multi-file changes)
- Parallel work on independent subtasks
- Need peer-to-peer communication
- Task requires 30+ minutes
- Multiple domain experts needed

### ❌ Use Subagents Instead When:

- Simple features (< 20 min)
- Sequential workflow is fine
- No peer communication needed
- Single domain expert sufficient

---

## Team Structure

```
Team Lead (Main Agent)
    ├─ Creates team
    ├─ Defines tasks
    ├─ Assigns work
    ├─ Monitors progress
    └─ Aggregates results

Teammate 1: Researcher (servalsheets-research, Haiku)
    └─ Explores codebase, finds patterns

Teammate 2: Implementer (servalsheets-implementation, Sonnet)
    └─ Writes code with TDD

Teammate 3: Tester (testing-specialist, Sonnet)
    └─ Creates test suite

Teammate 4: Validator (servalsheets-validation, Haiku)
    └─ Runs gates, verifies quality
```

---

## Step 1: Create Team (Lead Agent)

```bash
# Create team with unique name
TeamCreate("feature-streaming")

# Team files created automatically:
# - ~/.claude/teams/feature-streaming/config.json
# - ~/.claude/tasks/feature-streaming/ (task list)
```

**Team Config:**

```json
{
  "name": "feature-streaming",
  "description": "Implement data streaming feature",
  "members": [
    {
      "name": "team-lead",
      "agentId": "main",
      "agentType": "general-purpose"
    },
    {
      "name": "researcher",
      "agentId": "a123456",
      "agentType": "Explore"
    },
    {
      "name": "implementer",
      "agentId": "a234567",
      "agentType": "general-purpose"
    },
    {
      "name": "tester",
      "agentId": "a345678",
      "agentType": "general-purpose"
    },
    {
      "name": "validator",
      "agentId": "a456789",
      "agentType": "Explore"
    }
  ]
}
```

---

## Step 2: Define Tasks (Lead Agent)

```bash
# Task 1: Research phase
TaskCreate({
  subject: "Research streaming patterns in codebase",
  description: "Find all streaming implementations, analyze patterns, extract reusable utilities",
  activeForm: "Researching streaming patterns"
})

# Task 2: Implementation
TaskCreate({
  subject: "Implement trackRead() and invalidateWrite() methods",
  description: "Add runtime tracking to CacheInvalidationGraph, write failing tests first",
  activeForm: "Implementing cache tracking"
})

# Task 3: Testing
TaskCreate({
  subject: "Create property-based tests for cache invalidation",
  description: "Add 100+ generated test cases using fast-check, verify edge cases",
  activeForm: "Creating property tests"
})

# Task 4: Validation
TaskCreate({
  subject: "Run full validation pipeline",
  description: "Execute G0-G4 gates, verify no regressions, check test coverage",
  activeForm: "Running validation gates"
})
```

---

## Step 3: Spawn Teammates (Lead Agent)

```bash
# Spawn Researcher
Task({
  subagent_type: "Explore",
  team_name: "feature-streaming",
  name: "researcher",
  description: "Exploring streaming patterns",
  prompt: "You are the researcher for team feature-streaming. Check TaskList for available work, claim tasks assigned to you, and communicate findings via SendMessage to team-lead."
})

# Spawn Implementer
Task({
  subagent_type: "general-purpose",
  team_name: "feature-streaming",
  name: "implementer",
  description: "Implementing streaming feature",
  prompt: "You are the implementer for team feature-streaming. Check TaskList, claim implementation tasks, write code with TDD, send updates to team-lead."
})

# Spawn Tester
Task({
  subagent_type: "general-purpose",
  team_name: "feature-streaming",
  name: "tester",
  description: "Creating test suite",
  prompt: "You are the tester for team feature-streaming. Check TaskList, claim testing tasks, write property-based tests, verify coverage."
})

# Spawn Validator
Task({
  subagent_type: "Explore",
  team_name: "feature-streaming",
  name: "validator",
  description: "Validating implementation",
  prompt: "You are the validator for team feature-streaming. Check TaskList, claim validation tasks, run gates, report results."
})
```

---

## Step 4: Assign Tasks (Lead Agent)

```bash
# Assign Task 1 to researcher
TaskUpdate({
  taskId: "1",
  owner: "researcher"
})

# Task 2 depends on Task 1 completing
TaskUpdate({
  taskId: "2",
  owner: "implementer",
  addBlockedBy: ["1"]
})

# Task 3 can run in parallel with Task 2
TaskUpdate({
  taskId: "3",
  owner: "tester"
})

# Task 4 waits for both Task 2 and 3
TaskUpdate({
  taskId: "4",
  owner: "validator",
  addBlockedBy: ["2", "3"]
})
```

---

## Step 5: Monitor Progress (Lead Agent)

### Automatic Notifications

Teammates send notifications automatically:

- **Task claimed:** "I'm starting on Task #1"
- **Task completed:** "Task #1 complete, findings attached"
- **Going idle:** "Waiting for assignment" (after each turn)
- **Blocked:** "Task #2 blocked, waiting for Task #1"

### Manual Check-Ins

```bash
# Check overall task status
TaskList

# Send message to specific teammate
SendMessage({
  type: "message",
  recipient: "implementer",
  content: "How's progress on Task #2?",
  summary: "Progress check"
})

# Broadcast to all teammates (use sparingly!)
SendMessage({
  type: "broadcast",
  content: "Taking 10-minute break, pause work",
  summary: "Team break"
})
```

---

## Step 6: Coordination Patterns

### Peer-to-Peer Communication

```bash
# Implementer asks Researcher for clarification
SendMessage({
  type: "message",
  recipient: "researcher",
  content: "Can you find more examples of range overlap logic?",
  summary: "Request for examples"
})

# Researcher responds with findings
SendMessage({
  type: "message",
  recipient: "implementer",
  content: "Found rangesOverlap() in request-merger.ts:542",
  summary: "Found utility function"
})
```

### Task Dependencies

```
Task 1 (Research) → Must complete first
    ↓
Task 2 (Implementation) → Blocked until Task 1 done
Task 3 (Testing) → Can run in parallel with Task 2
    ↓
Task 4 (Validation) → Blocked until both Task 2 & 3 done
```

---

## Step 7: Shutdown Team (Lead Agent)

### Graceful Shutdown

```bash
# Request shutdown for each teammate
SendMessage({
  type: "shutdown_request",
  recipient: "researcher",
  content: "All tasks complete, thanks for your work"
})

SendMessage({
  type: "shutdown_request",
  recipient: "implementer",
  content: "Implementation verified, shutting down"
})

# ... repeat for tester, validator
```

### Cleanup

```bash
# After all teammates shut down
TeamDelete()

# Removes:
# - ~/.claude/teams/feature-streaming/
# - ~/.claude/tasks/feature-streaming/
```

---

## Cost Breakdown

| Agent       | Model  | Duration  | Cost       |
| ----------- | ------ | --------- | ---------- |
| Team Lead   | Sonnet | 40min     | $5         |
| Researcher  | Haiku  | 5min      | $0.50      |
| Implementer | Sonnet | 15min     | $8         |
| Tester      | Sonnet | 12min     | $6         |
| Validator   | Haiku  | 3min      | $0.30      |
| **TOTAL**   | -      | **40min** | **$19.80** |

**Note:** Team overhead ≈ 7x standard sessions due to coordination

---

## Success Criteria

- ✅ Team created successfully
- ✅ All tasks defined with clear deliverables
- ✅ Teammates spawn and claim tasks
- ✅ Dependencies respected (blocked tasks wait)
- ✅ Peer communication works (messages delivered)
- ✅ All tasks complete
- ✅ Team shutdown gracefully
- ✅ Total cost < $35
- ✅ Total time < 45 minutes

---

## Common Issues & Solutions

### Issue: Teammate Idle, Not Claiming Tasks

**Cause:** Task not assigned (owner = undefined)
**Solution:** Use TaskUpdate to assign owner: "teammate-name"

### Issue: Task Blocked Indefinitely

**Cause:** Dependency task failed or stuck
**Solution:** Remove blocker: TaskUpdate({ taskId, blockedBy: [] })

### Issue: Teammates Not Communicating

**Cause:** Wrong recipient name (use name, not agentId)
**Solution:** Read team config to get correct names

### Issue: Team Cost Exceeds $35

**Cause:** Tasks too large, teammates idle
**Solution:** Size tasks appropriately (5-15 minutes each)

---

## Example: Fix Phase 2 Integration Test Failures

**Team:** "phase2-fixes"
**Members:** Lead + Researcher + Implementer + Validator

### Tasks

1. **Research:** "Find CacheInvalidationGraph implementation patterns"
2. **Implement:** "Add trackRead() and invalidateWrite() methods"
3. **Validate:** "Verify 6 Phase 2 integration tests pass"

### Timeline

```
t=0:    Team created, tasks defined
t=2:    Researcher claims Task 1, finds patterns
t=7:    Implementer claims Task 2 (blocked on Task 1)
t=7:    Task 1 complete, Task 2 unblocked
t=22:   Task 2 complete (implementation done)
t=22:   Validator claims Task 3
t=25:   Task 3 complete (all tests pass)
t=27:   Team shutdown
TOTAL:  27 minutes, $12.50
```

---

## Template Checklist

- [ ] Team name unique and descriptive
- [ ] Task descriptions are clear and self-contained
- [ ] Task sizes appropriate (5-15 minutes each)
- [ ] Dependencies properly defined (blockedBy)
- [ ] Teammates have correct tool access
- [ ] Coordinator monitoring progress
- [ ] Graceful shutdown after completion
- [ ] Cost < $35
- [ ] Time < 45 minutes
