---
name: implement
description: Implement a ServalSheets feature or fix using the full research → implementation → validation → review pipeline.
disable-model-invocation: true
argument-hint: "[issue-id or feature description]"
---

Use the `dev-team-lead` agent to implement: $ARGUMENTS

The team lead will:
1. Research existing patterns (servalsheets-research)
2. Validate API approach if needed (google-api-expert)
3. Run TDD implementation (servalsheets-implementation)
4. Run validation gates (servalsheets-validation)
5. Run code review (code-review-orchestrator)
6. Report: what changed, test results, ready-to-commit status

If no arguments are provided, ask the user what to implement.
