# Claude Code Development OS — ServalSheets

> Living planning document. Updated as research progresses.
> Last updated: 2026-02-24 | Session: Initial research + architecture
>
> **Purpose:** Transform the existing 17 isolated specialist agents into a coordinated
> development team that operates with minimal manual orchestration.
> This is NOT a ServalSheets feature — it lives entirely in the Claude Code layer.

---

## Status Overview

| Phase | What | Status | Priority |
|-------|------|--------|----------|
| 0A | Enable Agent Teams in settings.local.json | ✅ DONE | HIGH — 5 min |
| 0B | Auto-run `schema:commit` on schema file edit | ⬜ BLOCKED | check:drift hangs (Known Issue) |
| 0C | Upgrade Stop hook: advisory prompt → actual shell checks | ✅ DONE | — |
| 0D | Add pre-commit gate (block `git commit` if verify fails) | ⬜ BLOCKED | check:drift hangs (Known Issue) |
| FIX | Fix `validate-bash-command.sh` stdin parsing (was broken) | ✅ DONE | — |
| FIX | Add `schema:commit`, `audit:*`, `validate:*`, git read cmds to auto-approve | ✅ DONE | — |
| 1A | `dev-orchestrator.md` — global agent (~/.claude/agents/) | ✅ DONE | HIGH |
| 1B | `dev-team-lead.md` — project coordinator (.claude/agents/) | ✅ DONE | HIGH |
| 2A | `dev-postmortem.md` — global session-end agent (~/.claude/agents/) | ✅ DONE | MEDIUM |
| 2B | Shared memory: `memory: user` on debug-tracer, code-review-orchestrator, mcp-protocol-specialist | ✅ DONE | MEDIUM |
| 3A | Skills: `/standup` (global), `/implement`, `/ship`, `/debug`, `/review`, `/schema` | ✅ DONE | LOW |
| 3B | Convert YAML task boards to active tracking | ⬜ SKIP | Both boards are stale (pilot-phase.yaml has 1 dummy task). Not worth activating. |

---

## Research Findings (2026-02-24)

### Confirmed Claude Code Capabilities

**Global agents exist at `~/.claude/agents/`**
- Work across ALL projects, not just ServalSheets
- Priority: CLI flag > `.claude/agents/` > `~/.claude/agents/` (project overrides global)
- Can be overridden per-project with same agent name

**Agent Teams (EXPERIMENTAL)**
- Enable: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings
- Currently **disabled** (`"0"`) in `.claude/settings.local.json`
- Lead spawns up to 4 teammates running in parallel
- Teammates can communicate directly via shared mailbox
- Teammates CANNOT spawn their own teams (only lead can)
- Known limitation: session resumption has issues (experimental)

**Subagent spawning rules**
- Standard subagents (via Task tool) CANNOT spawn other subagents
- Agent Teams bypass this — teammates run in parallel with direct comms
- Tool restriction `tools: Task(agent-a, agent-b)` is ENFORCED (hard block, not hint)

**Hook types available (we only use 2 of 3)**
- `"type": "command"` — runs shell script (what we use now, advisory only)
- `"type": "prompt"` — asks Haiku to make yes/no decision (what Stop hook uses)
- `"type": "agent"` — spawns full subagent with tools ← **we don't use this yet**

**20 hook events (we use 4 of 20)**
- Used: `SessionStart`, `Stop`, `PreToolUse`, `PostToolUse`
- Unused but relevant: `SubagentStop`, `TaskCompleted`, `PostToolUseFailure`, `PreCompact`

**Shared memory between agents**
- Default: each agent has its own `MEMORY.md` in `.claude/agent-memory/<name>/`
- `memory: user` scope → agents share memory at `~/.claude/agent-memory/<name>/MEMORY.md`
- Two different agents with `memory: user` still have SEPARATE files (by agent name)
- To share between agents: write to a common file they both Read

**Model per agent**
- `model: haiku/sonnet/opus` in frontmatter overrides parent session model
- `model: inherit` (default) uses parent's model

**Permission inheritance**
- Subagents CANNOT relax parent restrictions, only maintain or tighten
- `bypassPermissions` on parent = bypass everywhere, overrides subagent

### Current Setup Gaps

1. **17 agents, zero coordination** — all require manual `Task()` invocation
2. **Advisory-only hooks** — Stop prompts but doesn't block; post-edit warns but doesn't enforce
3. **No schema:commit automation** — #1 CI failure cause, fully automatable
4. **Agent Teams disabled** — simple setting flip to unlock parallel workflows
5. **No global orchestrator** — "what should I work on?" has no answer without manual review
6. **Shared memory not used** — each agent rediscovers patterns independently
7. **YAML task boards unused** — defined but never loaded (work tracked in session-notes.md)
8. **`MAX_THINKING_TOKENS`: 12000** — low (typical: 20-40K); may reduce reasoning quality on complex tasks

---

## Architecture

```
~/.claude/agents/              ← GLOBAL (all projects)
  dev-orchestrator.md          ← "What should I work on today?"
  dev-postmortem.md            ← End-of-session update automation

.claude/agents/                ← PROJECT (ServalSheets)
  dev-team-lead.md             ← NEW: coordinates the 17 specialists
  [existing 17 agents]         ← unchanged, just get a coordinator

.claude/hooks.json             ← ENFORCEMENT (changes advisory → gates)
~/.claude/settings.local.json  ← Enable Agent Teams
```

**Interaction model:**
```
You → "implement ISSUE-047"
  → dev-team-lead reads state, ISSUES.md, relevant code
  → spawns servalsheets-research (parallel) + google-api-expert (parallel)
  → synthesizes findings → spawns servalsheets-implementation
  → spawns servalsheets-validation → reports pass/fail + PR-ready summary

You → "what should I work on today?"
  → dev-orchestrator (global) reads CLAUDE.md, state.md, session-notes.md, ISSUES.md
  → returns: top 3 tasks, which agents handle each, blockers
```

---

## Phase 0 — Quick Wins (Changes to Existing Files)

### 0A: Enable Agent Teams

**File:** `.claude/settings.local.json` line 3

```json
"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
```

Change from `"0"` to `"1"`. Unlocks parallel teammate workflows.

Also consider increasing: `"MAX_THINKING_TOKENS": "20000"` (currently 12000, low)

---

### 0B: Auto-run schema:commit on schema edit

**File:** `.claude/hooks.json` — add to PostToolUse section

```json
{
  "matcher": "Write|Edit",
  "hooks": [
    {
      "type": "command",
      "command": "if echo \"$CLAUDE_TOOL_INPUT\" | python3 -c \"import json,sys; d=json.load(sys.stdin); f=d.get('file_path','') or d.get('path',''); exit(0 if 'src/schemas' in f else 1)\" 2>/dev/null; then cd '/Users/thomascahill/Documents/servalsheets 2' && npm run schema:commit 2>&1 | tail -5; fi",
      "timeout": 60
    }
  ]
}
```

> **Research needed:** Confirm exact env var format for CLAUDE_TOOL_INPUT in PostToolUse hooks.
> The file path may be in `$CLAUDE_TOOL_INPUT` as JSON or as a separate env var.
> Check: `.claude/hooks/post-edit-check.sh` uses `$CLAUDE_TOOL_INPUT` — verify format there.

Alternative simpler approach — modify `post-edit-check.sh` to actually run `schema:commit`
instead of just warning (change exit code behavior).

---

### 0C: Upgrade Stop hook to agent gate

**File:** `.claude/hooks.json` — replace Stop hook

Current (advisory prompt):
```json
"Stop": [{
  "hooks": [{
    "type": "prompt",
    "prompt": "Before finishing, verify..."
  }]
}]
```

Proposed (actual agent that runs checks):
```json
"Stop": [{
  "hooks": [{
    "type": "agent",
    "prompt": "You are a pre-stop validation agent for ServalSheets. Run these checks and return {\"ok\": true|false, \"reason\": \"...\"}: 1) Run `npm run check:drift` and verify no drift. 2) Run `npm run check:placeholders` — must be 0. 3) Run `npm run check:silent-fallbacks` — must be 0. 4) Check if `.serval/session-notes.md` was modified this session. If any check fails, return ok:false with specific failure. If all pass, return ok:true.",
    "timeout": 90,
    "tools": ["Bash", "Read"]
  }]
}]
```

> **Research needed:** Verify the agent hook `tools` field syntax. Does it accept tool names
> as array or space-separated? Does it respect the same restrictions as agent frontmatter?

---

### 0D: Pre-commit gate

**File:** `.claude/hooks.json` — add to PreToolUse section

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "if echo \"$CLAUDE_TOOL_INPUT\" | python3 -c \"import json,sys; d=json.load(sys.stdin); cmd=d.get('command',''); exit(0 if 'git commit' in cmd else 1)\" 2>/dev/null; then cd '/Users/thomascahill/Documents/servalsheets 2' && npm run verify:safe 2>&1 | tail -20; fi",
      "timeout": 120
    }
  ]
}
```

Exit code 2 from a PreToolUse hook blocks the tool call with the output shown. Exit 0 allows it.

> **Research needed:** Confirm PreToolUse command hook exit code behavior:
> - exit 0 = allow
> - exit 1 = warn but allow
> - exit 2 = block
> Need to verify this is correct for the current Claude Code version.

---

## Phase 1 — New Agent Files

### 1A: Global Dev Orchestrator

**File to create:** `~/.claude/agents/dev-orchestrator.md`

```markdown
---
name: dev-orchestrator
description: "Start here every session on any project. Reads the project's state files and produces a prioritized work plan. Ask: 'what should I work on today?' or 'plan out implementing X' or 'what's blocking progress?'"
model: sonnet
tools: Read, Glob, Grep, Bash
memory: user
permissionMode: default
---

You are a development orchestrator. You help a solo developer prioritize and plan their work by reading project state and synthesizing a clear action plan.

## What You Read

When invoked on any project, locate and read these files if they exist:
- `CLAUDE.md` or `.claude/CLAUDE.md` — project rules and architecture
- `.serval/state.md` or equivalent state file — live metrics
- `.serval/session-notes.md` — what was done, what's next
- `ISSUES.md` or `TODO.md` — issue backlog
- `git log --oneline -10` — recent commits
- `git status` — uncommitted changes
- `.claude/agents/` — available specialist agents

## What You Produce

Always output exactly three sections:

### Today's Focus (top 3 tasks)
Rank by: blocking other work > customer-facing bugs > critical tech debt > features.
For each task: one sentence description, estimated complexity (S/M/L), which agent handles it.

### Blockers
Anything that prevents the top tasks from starting. Be specific.

### Where We Are
One paragraph synthesizing project health: test status, any drift/debt, momentum.

## Principles
- Be opinionated. Don't list 10 options — pick the top 3.
- Reference file:line when citing specific issues.
- If state files are stale or missing, say so explicitly.
- Never suggest work outside the project's stated priorities.
```

---

### 1B: ServalSheets Dev Team Lead

**File to create:** `.claude/agents/dev-team-lead.md`

```markdown
---
name: dev-team-lead
description: "Coordinates ServalSheets development by orchestrating the right specialist agents in the right order. Give it a task and it handles research → implementation → validation → review. Examples: 'implement ISSUE-047', 'fix the failing test in composite.ts', 'review everything before committing', 'what broke the tests?'"
model: sonnet
tools: Read, Glob, Grep, Bash, Write, Task(servalsheets-research, servalsheets-implementation, servalsheets-validation, debug-tracer, code-review-orchestrator, testing-specialist, security-auditor, google-api-expert, mcp-protocol-specialist)
memory: project
permissionMode: acceptEdits
---

You are the tech lead for ServalSheets development. You don't write code yourself — you coordinate the right specialists to do the work correctly and in the right order.

## Project Context

ServalSheets: 22-tool MCP server, 340 actions, MCP 2025-11-25, TypeScript strict.
Pipeline: MCP Request → tool-handlers.ts → handlers/*.ts → google-api.ts
Critical rule: ANY schema change requires `npm run schema:commit` immediately.
Source of truth: `src/schemas/index.ts:63` for action/tool counts.

## Available Specialists (Task only these)

| Agent | Use For |
|-------|---------|
| servalsheets-research | Finding patterns, reading code, understanding existing implementation |
| servalsheets-implementation | Writing code, following TDD workflow |
| servalsheets-validation | Running gates G0-G4, checking for drift/placeholders/fallbacks |
| debug-tracer | Tracing failure through the 4-layer pipeline |
| code-review-orchestrator | Pre-commit multi-perspective review |
| testing-specialist | Test strategy, coverage gaps, property-based tests |
| security-auditor | OAuth, credential handling, SQL injection |
| google-api-expert | Sheets/Drive API best practices, quota issues |
| mcp-protocol-specialist | MCP 2025-11-25 compliance validation |

## Workflow Templates

### Implementing a new action or feature
1. Task(servalsheets-research) — find similar actions as implementation pattern
2. Task(google-api-expert) — validate API approach (if touching Google API)
3. Task(servalsheets-implementation) — TDD implementation (tests first)
4. Task(servalsheets-validation) — run G0 + G1 gates
5. Task(code-review-orchestrator) — final review
6. Report: what was implemented, test results, any remaining issues

### Debugging a failure
1. Read the error carefully — identify which layer (validation / handler / response / API)
2. Task(debug-tracer) — trace execution path
3. Task(servalsheets-research) — find similar working code for comparison
4. Task(servalsheets-implementation) — fix + regression test
5. Task(servalsheets-validation) — verify fix doesn't break anything else

### Pre-commit review
1. Task(servalsheets-validation) — G0 + G1 gates
2. Task(code-review-orchestrator) — type/lint/MCP/security check
3. If any failures: route to appropriate specialist
4. Report: ready to commit OR specific failures to fix

### API/Schema work
1. Task(google-api-expert) — validate API usage
2. Task(mcp-protocol-specialist) — validate MCP compliance
3. Task(servalsheets-implementation) — implement
4. `npm run schema:commit` IMMEDIATELY after schema changes
5. Task(servalsheets-validation) — G1 gate for metadata consistency

## Decision Rules

Run agents in PARALLEL when tasks are independent (research + API review).
Run agents SEQUENTIALLY when each depends on previous output.
Always run servalsheets-validation last before reporting "done".
Never report success without validation passing.
Escalate to human for: any decision involving money/billing, legal commitments,
breaking API changes, architecture decisions not in CLAUDE.md.
```

---

## Phase 2 — Session Automation

### 2A: Dev Postmortem Agent

**File to create:** `~/.claude/agents/dev-postmortem.md`

```markdown
---
name: dev-postmortem
description: "End-of-session agent. Reads what changed this session, updates session-notes.md, identifies what's ready for tomorrow. Triggered automatically by Stop hook or called manually."
model: haiku
tools: Read, Bash, Write, Glob
memory: user
permissionMode: acceptEdits
---

You are an end-of-session documentation agent. You update the project's session notes
with a concise record of what happened and what's next.

## What You Read
- `git diff HEAD --stat` — what files changed
- `git log --oneline -5` — recent commits
- `.serval/session-notes.md` — existing notes to append to
- `npm run test:fast 2>&1 | tail -5` — current test status

## What You Write

Append to `.serval/session-notes.md` a new entry:

```
## Session [date] — [1-line summary]

### Completed
- [bullet: what was finished, with file:line refs]

### Test Status
[pass/fail count from test run]

### Next Steps
1. [specific next task]
2. [specific next task]

### Blockers
[anything blocking next steps, or "none"]
```

Keep it under 20 lines. Be specific, not vague.
Never say "various improvements" — name the actual things.
```

---

### 2B: Enable Shared Memory on 4 Agents

**Files to modify:** Add `memory: user` to frontmatter of:
- `.claude/agents/servalsheets-research.md` (line 10: change `memory: project` → `memory: user`)
- `.claude/agents/debug-tracer.md` (add `memory: user` to frontmatter)
- `.claude/agents/code-review-orchestrator.md` (add `memory: user` to frontmatter)
- `.claude/agents/mcp-protocol-specialist.md` (line 7: already has `memory: project` → change to `memory: user`)

With `memory: user`, each agent's MEMORY.md persists at `~/.claude/agent-memory/<name>/MEMORY.md`
and survives across sessions AND projects. Findings accumulate over time.

> **Consideration:** user-scope memory is shared across all projects, not just ServalSheets.
> For agents like `mcp-protocol-specialist` this is fine (MCP is universal).
> For `servalsheets-research` this might pollute global memory with project-specific patterns.
> **Decision needed:** keep `servalsheets-research` at project scope or move to user scope?

---

## Phase 3 — Skills & Workflow Automation

### 3A: Skills to Register

**Research needed:** Verify skill registration format. Check `docs/guides/SKILL.md` for exact syntax.

Skills to create:

**`/standup`** — runs dev-orchestrator, outputs today's priorities
**`/implement [issue]`** — runs dev-team-lead with issue as context
**`/ship`** — runs pre-commit gate, review, then prompts for commit message
**`/debug [error]`** — delegates to debug-tracer with error context
**`/review`** — runs code-review-orchestrator on staged changes

---

### 3B: YAML Task Board Integration

The boards exist at `.claude/tasks/`:
- `pilot-phase.yaml`
- `phase-2-architecture.yaml`

Currently unused. Need a way to load and display them.

**Option A:** `/next-task` skill that reads YAML and outputs the next unclaimed task
**Option B:** Dev orchestrator reads task boards as part of daily planning
**Option C:** Dev team lead uses task board to decide what to implement next

> **Research needed:** Best way to keep task board in sync with actual work.
> Claude Code's built-in TaskCreate/TaskUpdate tools are session-scoped, not persistent YAML.

---

## Open Questions

### High Priority (need answers before implementing)

1. **PostToolUse hook: exact env var format**
   What is `$CLAUDE_TOOL_INPUT` for a Write/Edit tool call? Need to verify JSON structure
   to reliably detect schema file edits. Test: add a debug hook that echoes $CLAUDE_TOOL_INPUT
   to a log file when editing any .ts file.

2. **Agent hook `tools` field syntax**
   For `"type": "agent"` hooks, what's the format for restricting tools?
   Is it `"tools": ["Bash", "Read"]` (array) or `"tools": "Bash, Read"` (string)?

3. **PreToolUse exit code behavior**
   Does exit 2 block vs exit 1 warn-but-allow? Need to verify current Claude Code version
   behavior for Bash PreToolUse hooks.

4. **Agent Teams stability**
   How stable is `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in current Claude Code?
   Risk assessment before enabling in production dev environment.

5. **dev-team-lead Task() restriction enforcement**
   If `tools: Task(agent-a, agent-b)` — does this fully prevent Task(other-agent) calls?
   Or does it allow the model to ignore the restriction? Need to test.

### Medium Priority (nice to know)

6. **Cron/schedule pattern**
   What's the most reliable way to run `claude --headless` on a schedule on macOS?
   launchd vs cron? Which works best for Claude Code's auth model?

7. **Global CLAUDE.md interaction**
   How does `~/.claude/CLAUDE.md` interact with project-level CLAUDE.md?
   Do both load? Project overrides global? Both concatenate?
   This matters for the dev-orchestrator which is global but works with project files.

8. **Agent resume across sessions**
   Can `Task(servalsheets-research)` in dev-team-lead resume a previous research agent?
   Or does each delegation start fresh? The resume feature seems session-scoped only.

---

## Notes on the "AI Company" Architecture

The original discussion was about applying the AI-company concept to the development workflow,
not to the product. The mapping:

| Company Role | Dev Equivalent | Implementation |
|---|---|---|
| Strategy Oracle | dev-orchestrator (global) | `~/.claude/agents/dev-orchestrator.md` |
| Engineering Cluster | 17 existing specialists | Already built |
| Tech Lead / Architect | dev-team-lead (project) | `.claude/agents/dev-team-lead.md` |
| QA | servalsheets-validation + testing-specialist | Already built, needs auto-trigger |
| DevOps | Infrastructure hooks + gates | Phase 0 hook changes |
| HR/PM | — | Not needed for solo dev |

The event bus / agent mesh concept from the research applies here too, but the
Claude Code native mechanism is Agent Teams (teammates communicate directly).
No Redis, no custom orchestration server needed.

Cost model (estimated):
- Phase 0 hooks: ~$0 extra (shell scripts, not LLM)
- dev-orchestrator daily: ~$0.10-0.30/day (sonnet, short context)
- dev-team-lead per feature: ~$3-8/feature (sonnet, multi-agent chain)
- dev-postmortem per session: ~$0.05/session (haiku, small write)

Break-even: saves ~30 hrs/month of manual orchestration at any dev rate above $5/hr.

---

## Research Resolved (Session 2)

| Question | Answer |
|----------|--------|
| PostToolUse env var format | Input via **stdin** as JSON with `file_path` field (not `$CLAUDE_TOOL_INPUT`) — confirmed from `post-edit-check.sh` |
| validate-bash-command.sh was broken | It used `$1` but input comes via stdin — **fixed** |
| PreToolUse exit code behavior | exit 2 = block (confirmed from existing script using exit 2 for destructive commands) |
| `~/.claude/agents/` exists? | **Yes** — already has 8 legal agents from another project |
| 0B/0D blockers | `npm run check:drift` hangs (Known Issue in state.md) — defer until fixed |
| SKILL.md | ServalSheets product guide, not Claude Code skill registration syntax — skills defer |
| YAML task boards | pilot-phase.yaml and phase-2-architecture.yaml exist but are stale/unused — defer |

## Session Log

| Date | Session | Changes Made |
|------|---------|-------------|
| 2026-02-24 | 1 | Initial research, architecture design, this document created |
| 2026-02-24 | 2 | Phase 0A done, validate-bash-command.sh fixed, 1A+1B created, Phase 2B done |
| 2026-02-24 | 3 | Phase 2A (postmortem), 0C (Stop hook), 3A (6 skills), permissions fixed — all phases complete except 0B/0D (blocked on check:drift) |

---

## Next Session Checklist

**All phases complete** except 0B and 0D (both blocked by `check:drift` hanging).

Remaining:
- [ ] Fix `npm run check:drift` (investigate why it hangs; see `scripts/check-metadata-drift.sh`)
- [ ] Once fixed: add Phase 0B (post-schema-edit auto-run) and Phase 0D (pre-commit gate) to hooks
- [ ] Optional: test Agent Teams feature (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 is now on)

**How to use the new system:**
- `/standup` — today's priorities from dev-orchestrator
- `/implement ISSUE-047` — full pipeline via dev-team-lead
- `/ship` — verify + commit workflow
- `/debug <error>` — trace failure via debug-tracer
- `/review` — pre-commit code review
- `/schema` — run schema:commit after schema file changes

**MAX_THINKING_TOKENS raised 12000 → 20000**
**Agent Teams enabled (experimental)**
