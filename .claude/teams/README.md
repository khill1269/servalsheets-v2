# Agent Team Configurations

**Purpose:** Multi-agent team definitions for parallel development

**When to use:** Phase 2-4 (Architecture, Innovations, Testing & Quality)

---

## Available Teams

| Team                                                         | Purpose               | Teammates     | Work Pattern                |
| ------------------------------------------------------------ | --------------------- | ------------- | --------------------------- |
| [servalsheets-dev.yaml](servalsheets-dev.yaml)               | Main development team | 8 specialists | Mixed (parallel + pipeline) |
| [servalsheets-enterprise.yaml](servalsheets-enterprise.yaml) | Enterprise features   | 6 specialists | Sequential                  |

---

## Usage

**Start team:**

```bash
claude --agent --team servalsheets-dev

# Or with explicit config path:
claude --agent --team-config .claude/teams/servalsheets-dev.yaml
```

**In Claude session:**

```
I'm the team lead for Phase 2: Architecture Excellence.

Load task board from: .claude/tasks/phase-2-architecture.yaml

Start phase with task assignment.
```

---

## Team Structure

### Team Lead (Orchestrator)

- Task decomposition and assignment
- Progress tracking and reporting
- Conflict resolution
- Quality gate enforcement
- Phase completion approval

### Teammates (8 Specialists)

1. **Frontend** - UI components and MCP resources
2. **Backend** - Services, handlers, APIs
3. **Testing** - Test design and quality assurance
4. **Documentation** - Docs, examples, guides
5. **Performance** - Benchmarking and optimization
6. **Security** - RBAC, audit logs, OAuth
7. **DevOps** - CI/CD, deployment, infrastructure
8. **Quality** - Validation gates, compliance

---

## Coordination Mechanisms

### Task Board

- Location: `.claude/tasks/current-phase.yaml`
- Format: YAML with DAG dependencies
- Updates: Real-time as tasks complete

### Messaging

- Location: `.claude/inbox/[teammate]/`
- Format: Markdown files
- Retention: 30 days

### Conflict Resolution

- Strategy: Lead decides
- Escalation: Ask user via AskUserQuestion

### Quality Gates

- Enforced: Yes
- Blocking gates: G0, G1, G2
- Gate runner: Quality teammate

---

## Success Criteria

Before phase completion:

- [ ] All tasks completed
- [ ] All tests passing (npm run verify)
- [ ] Quality gates G0-G4 passed
- [ ] Code review approved (human or lead)
- [ ] Documentation updated
- [ ] No merge conflicts
