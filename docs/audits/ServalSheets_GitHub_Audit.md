# ServalSheets GitHub Audit Report

**Repository:** [khill1269/servalsheets](https://github.com/khill1269/servalsheets)
**Date:** March 22, 2026
**Version:** 1.7.0 (25 tools, 407 actions)
**Total Commits:** 522

---

## 1. Repository Overview

ServalSheets is a production-grade MCP server for Google Sheets built with Node.js and TypeScript. It provides 25 tools with 407 actions covering AI-powered analysis, transactions, workflows, safety rails, and enterprise features.

The repo has 3 release tags (v1.3.0, v1.4.0, v1.7.0), 27 CI workflow files, and 458 test files. The current working branch is `remediation/phase-1`, which is 188 commits ahead of `main` and represents the bulk of recent development.

---

## 2. Branch Health

### Active Branches (17 total)

| Branch | Last Activity | Status | Recommendation |
|--------|--------------|--------|----------------|
| `main` | Mar 10, 2026 | Default branch, last merged PR #25 | Merge `remediation/phase-1` (PR #37 pending) |
| `remediation/phase-1` | Mar 22, 2026 | **188 commits ahead** of main, 11 uncommitted files | **Critical: merge ASAP** — massive divergence |
| `claude/wizardly-bhabha` | Mar 20, 2026 | Agent worktree branch | Clean up after merge |
| `feat/phase-0-mcp-protocol-compliance` | Jan 26, 2026 | Stale (~2 months) | **Delete** — likely superseded |
| `fix/concurrency-gate-timing` | Mar 10, 2026 | Already merged (PR #25) | **Delete** — merged |
| `publish/worker-runner-allowlist` | Mar 10, 2026 | Stale, likely merged via PR #23 | **Delete** — merged |

### Dependabot Branches (11 unmerged)

| Branch | Created | Update |
|--------|---------|--------|
| `dependabot/docker/node-25-alpine` | Jan 26 | Node 20 → 25 (major) |
| `dependabot/github_actions/actions/checkout-6` | Jan 26 | actions/checkout 4 → 6 |
| `dependabot/github_actions/actions/configure-pages-5` | Jan 26 | configure-pages 4 → 5 |
| `dependabot/github_actions/actions/upload-pages-artifact-4` | Jan 26 | upload-pages-artifact 3 → 4 |
| `dependabot/github_actions/github/codeql-action-4` | Jan 26 | codeql-action 3 → 4 |
| `dependabot/github_actions/google-github-actions/auth-3` | Jan 26 | google-auth 2 → 3 |
| `dependabot/npm_and_yarn/eslint-10.0.3` | Mar 9 | ESLint 9 → 10 (major) |
| `dependabot/npm_and_yarn/production-dependencies-*` | Feb 2 | Production dep group |
| `dependabot/npm_and_yarn/types/node-25.2.2` | Feb 9 | @types/node major bump |
| `dependabot/npm_and_yarn/types/node-25.3.5` | Mar 9 | @types/node major bump |
| `dependabot/npm_and_yarn/types/supertest-7.2.0` | Mar 2 | @types/supertest major bump |

### Git Health Issues

**20+ stale `.lock.z` files** found under `.git/refs/`. These are artifacts from FUSE bindfs mounts and cause warning noise on every git operation. They should be cleaned up:
```
.git/refs/heads/claude/lucid-sammet.lock.z
.git/refs/heads/main.lock.z
.git/refs/tags/v1.7.0.lock.z
(17 more...)
```

---

## 3. Issue Tracker Audit

The project tracks 243 issues in `docs/remediation/issue-tracker.csv`. Here's the breakdown:

### Status Summary

| Status | Count | % |
|--------|-------|---|
| DONE | 84 | 34.6% |
| **OPEN** | **79** | **32.5%** |
| FIXED_PRE | 60 | 24.7% |
| FALSE_ALARM | 20 | 8.2% |
| **Total** | **243** | 100% |

### Open Issue Analysis (79 issues)

**71 of 79 open issues are "orphaned"** — they have no owner, no wave assignment, no description, and no linked GitHub issue. This is the single biggest issue tracker problem. Without descriptions, these issues are essentially un-actionable placeholders.

Only **8 open issues have any metadata:**

| Issue | Status | Link | Context |
|-------|--------|------|---------|
| ISSUE-075 | OPEN | [#38](https://github.com/khill1269/servalsheets/issues/38) | npm publish @serval/core v0.2.0 (maintainer-only) |
| ISSUE-086 | OPEN | [#39](https://github.com/khill1269/servalsheets/issues/39) | Unknown |
| ISSUE-147 | OPEN | [#41](https://github.com/khill1269/servalsheets/issues/41) | Unknown |
| ISSUE-168 | OPEN | [#42](https://github.com/khill1269/servalsheets/issues/42) | Unknown |
| ISSUE-173 | OPEN | [#43](https://github.com/khill1269/servalsheets/issues/43) | SAML/SSO implementation |
| ISSUE-174 | OPEN | [#44](https://github.com/khill1269/servalsheets/issues/44) | Semantic search (Voyage AI) |
| ISSUE-175 | OPEN | [#44](https://github.com/khill1269/servalsheets/issues/44) | Semantic search (same GH issue as 174) |

### GitHub Issues Referenced (7 unique)

| GitHub # | Linked Internal Issue | Status |
|----------|----------------------|--------|
| #38 | ISSUE-075 | OPEN |
| #39 | ISSUE-086 | OPEN |
| #40 | ISSUE-094 | DONE |
| #41 | ISSUE-147 | OPEN |
| #42 | ISSUE-168 | OPEN |
| #43 | ISSUE-173 | OPEN |
| #44 | ISSUE-174, ISSUE-175 | OPEN |

### Issues That May Be Closable

Per the session notes, several open issues may already be resolved in the `remediation/phase-1` branch but haven't been updated in the tracker:

- **ISSUE-173** (SAML/SSO): Implemented in Session 98 — `src/auth/saml-provider.ts` exists with 24 tests
- **ISSUE-174/175** (Semantic search): Implemented in Session 95 — `src/services/semantic-search.ts` exists with 8 tests
- **88 undescribed issues** (noted in Session 94): "From earlier audit waves; no descriptions or actionable content — not workable without reconstruction effort"

---

## 4. Pull Requests & Merge Status

### Critical: PR #37 — Merge `remediation/phase-1` → `main`

This is the most important pending item. The `remediation/phase-1` branch is **188 commits ahead** of `main` and contains virtually all work from Sessions 39–100, including:

- 20+ bug fixes (BUG-1 through BUG-20)
- Enterprise SSO/SAML 2.0 implementation
- Semantic search feature
- Full AQUI-VR v3.2 audit framework (54 findings, 100% closure)
- 8-module agent engine decomposition
- WAL manager extraction
- Production-ready 1.7.0 release preparation

Per Session 100 notes, all 11 merge conflicts were resolved and PR #37 was pushed conflict-free. **This PR needs to be merged.**

### Previously Merged PRs

Based on git history, PRs #23 and #25 were merged into `main` (the `fix/concurrency-gate-timing` and `publish/worker-runner-allowlist` branches). Their remote branches should be deleted.

---

## 5. CI/CD & Workflow Health

### 27 Workflow Files

The repo has an unusually high number of CI workflows:

| Category | Workflows | Files |
|----------|----------|-------|
| Core CI | 3 | `ci.yml`, `test-gates.yml`, `schema-check.yml` |
| Security | 3 | `security.yml`, `scorecards.yml`, `dependency-validation.yml` |
| Quality | 4 | `actionlint.yml`, `architecture.yml`, `coverage.yml`, `mutation-testing.yml` |
| Documentation | 3 | `docs.yml`, `docs-validation.yml`, `sync-docs.yml` |
| Deploy | 3 | `deploy-dashboard.yml`, `deploy-demo.yml`, `docker.yml` |
| Release | 2 | `publish.yml`, `release-audit.yml` |
| Specialized | 5 | `audit-106.yml`, `benchmark.yml`, `file-size-check.yml`, `performance-tracking.yml`, `validate-server-json.yml` |
| AI/Agent | 3 | `claude.yml`, `claude-fix.yml`, `multi-agent-analysis.yml` |
| Auto | 1 | `auto-draft-pr.yml` |

This is comprehensive but potentially expensive in CI minutes. Consider consolidating overlapping workflows.

### Release Readiness

- **Version**: 1.7.0 (package.json)
- **Tags**: v1.3.0, v1.4.0, v1.7.0 (note: v1.5.0 and v1.6.0 are missing — version jumped)
- **Missing tag**: v1.7.0 tag exists but the code on `main` is from v1.4.0 era — the tag likely points to `remediation/phase-1`
- **Broken tag ref**: `refs/tags/v1.7.0.lock.z` exists (stale lock file)
- **Uncommitted changes**: 11 files (5 modified, 3 untracked directories, 3 untracked files)

---

## 6. Working Tree Status

11 uncommitted changes on `remediation/phase-1`:

| Status | File |
|--------|------|
| Staged (M) | `.github/workflows/actionlint.yml` |
| Staged (M) | `.github/workflows/docker.yml` |
| Modified | `docs/development/ACTION_REGISTRY.md` |
| Modified | `docs/development/CODEBASE_CONTEXT.md` |
| Modified | `docs/development/SOURCE_OF_TRUTH.md` |
| Modified | `tests/audit/action-coverage-fixtures.ts` |
| Untracked | `.serval/plans/` |
| Untracked | `benchmark/` |
| Untracked | `tests/fixtures/conflict-test.ts` |
| Untracked | `tests/fixtures/test-file.test.ts` |
| Untracked | `tests/fixtures/watch-test/` |

---

## 7. Key Findings & Recommendations

### CRITICAL (do now)

1. **Merge PR #37** (`remediation/phase-1` → `main`). 188 commits of work are sitting unmerged. This is a significant risk — if this branch is lost, months of work are gone. The PR was prepared conflict-free in Session 100.

2. **Clean up `.lock.z` files**. 20+ stale lock files under `.git/refs/` cause warnings on every git command:
   ```bash
   find .git/refs -name "*.lock.z" -delete
   ```

3. **Commit or stash the 11 uncommitted files** before merging. Decide which changes are intentional.

### HIGH (do this week)

4. **Delete merged branches**: `fix/concurrency-gate-timing` and `publish/worker-runner-allowlist` are already merged. Delete them from the remote.

5. **Triage Dependabot PRs** (11 pending). Several are 2 months old. Key decisions needed:
   - Node 20 → 25 Alpine: Major version bump, needs testing
   - ESLint 9 → 10: Major version bump, likely breaking
   - GitHub Actions bumps (5): Generally safe to merge
   - @types/node major bumps (2): Pick one and merge

6. **Close resolved issues in tracker**: ISSUE-173 (SAML) and ISSUE-174/175 (semantic search) appear to be fully implemented based on session notes and codebase evidence.

7. **Update ISSUE-075** status: npm publish of @serval/core v0.2.0 is listed as maintainer-only — decide if this is still needed or can be closed.

### MEDIUM (do this month)

8. **Audit the 71 orphaned open issues** (ISSUE-037 through ISSUE-238 with no metadata). Per Session 94, these came from earlier audit waves with no descriptions. Consider bulk-closing them with a note, or investing time to reconstruct descriptions for any that are still relevant.

9. **Delete stale branch** `feat/phase-0-mcp-protocol-compliance` (last touched Jan 26, likely superseded by the MCP 2025-11-25 compliance work in remediation/phase-1).

10. **Consolidate CI workflows**. 27 workflow files is high. Consider combining related checks (e.g., merge `docs.yml` + `docs-validation.yml` + `sync-docs.yml`) to reduce CI complexity and minutes.

11. **Add missing version tags**. v1.5.0 and v1.6.0 are missing from the tag history. Either retroactively tag the relevant commits or document why they were skipped.

### LOW (backlog)

12. **Remaining genuine work** (from session notes):
    - ~100 generic throws remain in `src/services/` (error typing)
    - Handler decomposition deferred (P18-D1–D10)
    - npm publish @serval/core v0.2.0 (ISSUE-075)
    - Add `ANTHROPIC_API_KEY` to `claude_desktop_config.json`

13. **Consider archiving the `claude/wizardly-bhabha` worktree branch** after confirming no useful uncommitted work.

---

## 8. Summary Scorecard

| Area | Grade | Notes |
|------|-------|-------|
| **Code Quality** | A | TypeScript strict, 2742 tests, comprehensive schemas |
| **Branch Hygiene** | C | 188-commit divergence, 11 Dependabot PRs stale, 3 merged branches not deleted |
| **Issue Tracking** | D | 71/79 open issues have no description or owner |
| **CI/CD** | B+ | 27 workflows (comprehensive but heavy), no recent CI data accessible |
| **Release Readiness** | B | v1.7.0 prepared but not on main, missing version tags |
| **Git Health** | C | 20+ stale .lock.z files, broken tag refs, uncommitted changes |
| **Documentation** | A | Extensive CLAUDE.md, CODEBASE_CONTEXT.md, session notes |

**Overall: B-** — The codebase itself is excellent (A-grade engineering), but the GitHub repo hygiene needs attention. The single most impactful action is merging PR #37 to get 188 commits of work onto `main`.
