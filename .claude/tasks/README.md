# Task Board Templates

**Purpose:** Phase-specific task boards with DAG dependencies

**When to use:** Phase 2+ (when using Agent Teams)

---

## Available Task Boards

| Task Board                                             | Phase           | Tasks | Estimated Days |
| ------------------------------------------------------ | --------------- | ----- | -------------- |
| [pilot-phase.yaml](pilot-phase.yaml)                   | Pilot (testing) | 1     | 1 hour         |
| [phase-2-architecture.yaml](phase-2-architecture.yaml) | Phase 2         | 12    | 14 days        |
| [phase-3-innovations.yaml](phase-3-innovations.yaml)   | Phase 3         | 18    | 28 days        |
| [phase-4-testing.yaml](phase-4-testing.yaml)           | Phase 4         | 10    | 14 days        |

---

## Task Board Format

```yaml
phase:
  number: 2
  name: 'Phase Name'
  goal: 'Phase goal description'
  duration_weeks: 2

tasks:
  - id: task-001
    title: 'Task Title'
    description: 'What needs to be done'
    owner: null # Unclaimed (or teammate name)
    status: PENDING # PENDING, IN_PROGRESS, BLOCKED, COMPLETED
    priority: HIGH # HIGH, MEDIUM, LOW
    estimated_hours: 8
    dependencies: [] # List of task IDs that must complete first
    deliverables:
      - 'File or artifact to be created'
    acceptance_criteria:
      - 'Criteria for completion'
    labels: ['category', 'type']

metadata:
  total_tasks: 12
  estimated_hours: 138
```

---

## Task States

- **PENDING** - Ready to be claimed (no unmet dependencies)
- **IN_PROGRESS** - Actively being worked on
- **BLOCKED** - Waiting for dependencies to complete
- **COMPLETED** - Finished and validated

---

## Usage

**Load task board:**

```
Team Lead: Load task board from .claude/tasks/phase-2-architecture.yaml
```

**Claim task:**

```
Backend: Claiming arch-001
```

**Update status:**

```
Backend: arch-001 status changed to IN_PROGRESS
Backend: arch-001 status changed to COMPLETED
```

**Check progress:**

```
Team Lead: Show task completion status
```

---

## Creating New Task Boards

1. Copy template from existing task board
2. Update phase metadata
3. Define all tasks with dependencies
4. Verify dependency graph has no cycles
5. Save to `.claude/tasks/[phase-name].yaml`
