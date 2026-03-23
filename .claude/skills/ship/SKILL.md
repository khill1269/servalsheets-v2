---
name: ship
description: Run the full pre-commit verification pipeline and prepare a commit. Checks types, tests, drift, placeholders, and silent fallbacks before committing.
disable-model-invocation: true
argument-hint: "[optional: commit message]"
---

Run the ServalSheets pre-commit pipeline:

1. Run `npm run verify:safe` in the project directory
   - This runs: typecheck + tests + drift check + placeholder check + silent fallback check
   - ESLint is skipped (use verify:safe to avoid OOM)

2. If any check fails: report exactly what failed with file:line references and stop.

3. If all checks pass:
   - Show a summary of what changed (`git diff --stat HEAD`)
   - If `$ARGUMENTS` was provided, use it as the commit message
   - If no message provided, suggest a conventional commit message based on the changes
   - Ask the user to confirm before committing

Commit message format: `type(scope): description` (conventional commits)
Types: feat, fix, chore, refactor, test, docs, perf
