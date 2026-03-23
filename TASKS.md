# ServalSheets Task Backlog

> Persistent backlog of planned work. Updated across sessions.
> For session-level context (what just happened, decisions), see `.serval/session-notes.md`.

## Active Phase: P18 — Decomposition & Refinement Execution

Goal: Execute the post-readiness backlog focused on maintainability decomposition and targeted refinement work while keeping verification gates green.

**Current baseline (2026-03-03, latest): 25 tools, 391 actions, `test:fast` green, 0 TS errors, MCP protocol suites green, `audit:coverage` green (1207/1207). Pre-next-phase blockers closed.**
**Phase handoff**: P19 readiness exit criteria are satisfied; P18 backlog execution is now active.

### P18 Immediate TODO (Kickoff)

- [x] P18-D3: Start `src/handlers/analyze.ts` decomposition (`analyze-actions/` split) while preserving behavior/tests.
- [x] P18-D4: Stage `src/handlers/composite.ts` decomposition (`composite-actions/` split) after D3.
- [x] P18-D5: Complete `src/handlers/core.ts` thin-dispatch decomposition and remove temporary size-budget override.
- [x] P18-D6: Complete `src/handlers/collaborate.ts` decomposition (`collaborate-actions/` split) and remove temporary size-budget override.
- [x] P18-D7: Complete `src/handlers/visualize.ts` decomposition (`visualize-actions/` split) and remove temporary size-budget override.
- [x] P18-D8: Complete `src/handlers/advanced.ts` decomposition (`advanced-actions/` split) and remove temporary size-budget override.
- [x] P18-D9: Draft server decomposition sequence for `src/server.ts` and `src/http-server.ts` extraction. (See `docs/development/P18_D9_SERVER_DECOMPOSITION_SEQUENCE.md`)
- [x] P18-D9A: Extract shared server/http utility modules (logging bridge + request/action extraction helpers). (`src/server-utils/logging-bridge-utils.ts`, `src/server-utils/request-extraction.ts`; `typecheck` + focused MCP/logging suites green)
- [x] P18-D9B: Extract `src/server.ts` tool-call pipeline modules (`handleToolCall` internals) and thin the class orchestrator. (`src/server-runtime/{tool-call-metrics,preinit-tool-routing,handler-dispatch,logging-bridge}.ts`; focused suites green)
- [x] P18-D9C: Extract `src/server.ts` registration/bootstrap modules and remove the `src/server.ts` size-budget override. (`src/server-runtime/{resource-registration,control-plane-registration,bootstrap}.ts` extracted; `src/server.ts` reduced `1898 -> 1356`; focused parity suites + typecheck + lint green)
- [x] P18-D9D: Extract `src/http-server.ts` middleware + observability/admin route modules. (`src/http-server/{middleware,routes-observability}.ts` extracted; `src/http-server.ts` `3259 -> 2168`; typecheck + focused HTTP suites green)
- [x] P18-D9E: Extract `src/http-server.ts` transport/session/webhook/lifecycle modules and remove the `src/http-server.ts` size-budget override. (`src/http-server/{transport-helpers,routes-webhooks,graphql-admin,routes-transport}.ts` extracted; `src/http-server.ts` `3259 -> 956`; override removed from `scripts/check-file-sizes.sh`; typecheck + targeted ESLint + focused HTTP suites green)
- [x] P18-D10: Complete final gate verification (`verify:safe`) for decomposition closure. (`check:file-sizes` green after `src/handlers/dimensions.ts` reduction to `2033`; `verify:safe` now passing)

## Completed Phase: Remediation & Architecture (P16)

All P16 items verified complete in codebase as of 2026-03-02 reaudit. TASKS.md was stale — items were implemented but not marked done.

## Historical Execution Track: Advanced Integration Completion (P17)

Goal: Complete runtime wiring and production hardening for recently added advanced capabilities (SQL/Python compute, workspace events, formula callback security, scheduler durability) while keeping verification gates green.
Status: Substantially complete; retained here as historical context while P18 is the active execution track.

### P17 Execution TODO

- [x] P17-01: Runtime wiring in `src/server.ts`
  - [x] Add DuckDB engine to handler context
  - [x] Add Scheduler service to handler context
  - [x] Trigger optional Python preload on startup when enabled
  - [x] Ensure Workspace Events service is injected at handler creation time

- [x] P17-02: Handler injection completion in `src/handlers/index.ts`
  - [x] Pass `duckdbEngine` + `samplingServer` into `ComputeHandler`
  - [x] Pass `scheduler` into `SessionHandler` (`setScheduler`)
  - [x] Pass `driveApi` + `workspaceEventsService` into `WebhookHandler`
  - [x] Pass `googleClient` into `HistoryHandler` for activity attribution

- [x] P17-03: History enrichment correctness
  - [x] Ensure `history.timeline` calls revision timeline with Drive Activity context
  - [x] Expose `activityAvailable` and actor metadata when enrichment exists

- [x] P17-04: Workspace events endpoint follow-through
  - [x] Replace placeholder route behavior for `/webhook/workspace-events` with manager-backed handling
  - [x] Keep callback non-blocking and robust against malformed envelopes

- [x] P17-05: Formula callback hardening
  - [x] Add request freshness validation (`timestamp` skew window)
  - [x] Add replay protection (nonce/signature cache window)
  - [x] Keep HMAC validation + rate limit + result cache behavior

- [x] P17-06: Toolchain resilience
  - [x] Resolve current local lint dependency mismatch (ESLint/AJV resolution) — resolved via npm audit fix (2026-03-15)
  - [x] `npm run verify` fully green — typecheck ✅ lint ✅ format ✅ alignment ✅ drift ✅ tests ✅ (2646/2646)

- [x] P17-07: Documentation/source-of-truth sync
  - [x] Update unified plan counts and status to current action totals
  - [x] Record completed P17 items in this backlog

## Completed Execution Track: Readiness & Source-of-Truth (P19)

Goal: Resolve discrepancies identified in the 2026-03-03 production audit verification and convert them into executable, tracked work before starting the next major improvement phase.

Reference report:

- `audit-output/production-audit-verification-2026-03-03.md`

### P19 Execution TODO

- [x] P19-01: Audit claim reconciliation (docs + reports)
  - [x] Update `ServalSheets_Production_Audit.md` to mark stale findings and refreshed metrics
  - [x] Update `MCP_AUDIT_REPORT.md` open-work section with newly verified gaps
  - [x] Ensure `UNIFIED_IMPROVEMENT_PLAN.md` and this backlog share the same active priorities

- [x] P19-02: Coverage suite integrity
  - [x] Fix stale valid fixtures for `sheets_compute` actions (`sql_query`, `sql_join`, `python_eval`, `pandas_profile`, `sklearn_model`, `matplotlib_chart`)
  - [x] Fix stale valid fixtures for `sheets_session` schedule actions (`schedule_create`, `schedule_cancel`, `schedule_run_now`)
  - [x] Fix stale valid fixtures for workspace webhook actions (`subscribe_workspace`, `unsubscribe_workspace`)
  - [x] Re-run `npm run audit:coverage` to green (`1207/1207` pass)

- [x] P19-03: Error code normalization hardening
  - [x] Replace non-canonical error outputs (`OPERATION_FAILED`, `RATE_LIMIT`) with enum-backed canonical codes (`INTERNAL_ERROR`, `RATE_LIMITED`)
  - [x] Add/extend tests to ensure canonical emission in response builder paths
  - [x] Keep backward-compatible alias metadata only at response-compat layer

- [x] P19-04: Mutation safety hardening
  - [x] Add centralized formula-sanitization coverage for all mutation entry points (not only data write/find-replace paths)
  - [x] Add per-spreadsheet mutation lock orchestration in shared request pipeline
  - [x] Add conflict-locking integration tests for concurrent write scenarios

- [x] P19-05: Webhook durability decision
  - [x] Choose architecture: keep Redis hard requirement (documented)
  - [x] Apply decision consistently in schemas/descriptions/runtime behavior/docs (`WEBHOOK_DURABILITY_MODE=redis_required`, handler error detail + docs/tracking sync)

- [x] P19-06: Tracking and gates sync
  - [x] Add/refresh issue entries in `ISSUES.md` for all currently open readiness items
  - [x] Update verification command block in audit docs to include `validate:mcp-protocol` and `audit:coverage`
  - [x] Record a post-P19 readiness snapshot (counts + gate results + known caveats) in `ISSUES.md` status updates (2026-03-03 continuation)

### P19 Exit Criteria

- [x] `npm run typecheck` passes
- [x] `npm run test:fast` passes
- [x] `npm run check:drift` passes
- [x] `npm run validate:alignment` passes
- [x] `npm run validate:mcp-protocol` passes
- [x] `npm run audit:coverage` passes
- [x] All active plan/backlog docs reflect the same open-work list and priorities

## Backlog

### P0 — serval-core Extraction

Status: **Module migration complete.** Adapter wiring and publish remain.

Migrated (Session 14-15):

- [x] Audit `src/` vs `packages/serval-core/src/` duplicates — Session 14
- [x] `src/utils/retry.ts` → imports base from `@serval/core`, adds Google-specific extensions — Session 14
- [x] `src/utils/circuit-breaker.ts` → re-exports from `@serval/core`, adds `readOnlyMode` — Session 14
- [x] `src/core/errors.ts` → extends `ServalError` from `@serval/core` — Session 14
- [x] `src/utils/redact.ts` → already re-exports from `@serval/core` (pre-existing) — Session 15
- [x] `src/utils/bounded-cache.ts` → already re-exports from `@serval/core` (pre-existing) — Session 15
- [x] `src/services/google-api.ts` → transitively uses core via retry.ts + circuit-breaker.ts — Session 15
- [x] Contract tests pass (815/815) after all migrations — Session 14

Deferred (documented rationale):

- [ ] `src/utils/logger.ts` → DEFERRED (126 callers, deep AsyncLocalStorage request-context integration)
- [ ] `src/services/history-service.ts` → DEFERRED (`spreadsheetId`→`documentId` rename is P3 multi-backend)
- [ ] `src/observability/metrics.ts` → DEFERRED (name prefix `servalsheets_*` vs core `serval_*`; changing breaks dashboards)

Remaining:

- [x] Wire `GoogleSheetsBackend` adapter into handler layer — Session 16 (added to `HandlerContext.backend`, created + injected in `server.ts`, disposed in `shutdown()`)
- [ ] Publish `@serval/core` v0.2.0

### P1 — Build & DX Polish

- [x] Fix `docs/development/PROJECT_STATUS.md` stale entries — Session 17
- [x] Update `.serval/state.md` known issues — Session 17
- [x] ESLint OOM fix — switched to `projectService` (4GB→3GB), excluded `src/ui/**`, removed stale `--ext .ts` — Session 17
- [x] Reduce silent fallback false positives (13→0) — added inline intent comments to all guard-clause returns — Session 17

### P2 — Feature Flags

Audited all 6 flags (Session 18). Enabled 3 safe flags, kept 3 opt-in.

Enabled (default ON) — Session 18:

- [x] `ENABLE_PARALLEL_EXECUTOR` — 40% faster batch reads, 19 tests pass, threshold-guarded (100+ ranges)
- [x] `ENABLE_AUDIT_LOGGING` — compliance audit trail, non-critical (try/catch), 8 tests pass
- [x] `ENABLE_IDEMPOTENCY` — retry-safe tool calls via key-based dedup, 3 test files pass

Remain opt-in (require infrastructure):

- [ ] `ENABLE_RBAC` — requires role/permission config; would block requests without setup
- [ ] `ENABLE_TENANT_ISOLATION` — requires API key infrastructure; would break single-tenant
- [ ] `ENABLE_COST_TRACKING` — per-request overhead; useful only for SaaS/multi-tenant

### P3 — Future Backends

Once serval-core is extracted, these become possible:

- [x] Excel Online backend scaffold — Session 19 (607 lines, implements full SpreadsheetBackend, maps to Microsoft Graph API, validates interface is platform-agnostic)
- [x] Notion backend scaffold — Session 20 (924 lines, maps property-based DB model to cell-grid interface, synthetic A1 range mapping, validates interface works for non-grid platforms)
- [x] Airtable backend scaffold — Session 21 (924 lines, multi-table base model maps naturally to multi-sheet, batch ops in groups of 10, validates interface for record-oriented platforms)
- [ ] Google Docs backend (via `@serval/core` interfaces)

### P4 — Competitive Differentiation Features

Full specs in `docs/development/FEATURE_PLAN.md`. 6 features, 20 new actions (315 → 335), 0 new tools.

Phase 1 — Quick Wins (1-2 sessions each):

- [x] F4: Smart Suggestions / Copilot — extend `sheets_analyze` (+2 actions: `suggest_next_actions`, `auto_enhance`) — Session 24
- [x] F3: Automated Data Cleaning — extend `sheets_fix` (+5 actions: `clean`, `standardize_formats`, `fill_missing`, `detect_anomalies`, `suggest_cleaning`) — Session 26

Phase 2 — Medium Lift (2-3 sessions each):

- [x] F1: Natural Language Sheet Generator — extend `sheets_composite` (+3 actions: `generate_sheet`, `generate_template`, `preview_generation`) — Session 28
- [x] F5: Time-Travel Debugger — extend `sheets_history` (+3 actions: `timeline`, `diff_revisions`, `restore_cells`) — Session 30

Phase 3 — Complex Features (3-4 sessions each):

- [x] F6: Scenario Modeling — extend `sheets_dependencies` (+3 actions: `model_scenario`, `compare_scenarios`, `create_scenario_sheet`) — Session 31 (schema + handler inline; 11 tests added)
- [x] F2: Multi-Spreadsheet Federation — extend `sheets_data` (+4 actions: `cross_read`, `cross_query`, `cross_write`, `cross_compare`) — Session 32 (cross-spreadsheet.ts service, 16 tests, 331→391 actions by P15)

### P5 — Claude Optimization (LLM Discoverability)

Completed Session 33-34: Make all 335 actions discoverable and safe for Claude (expanded to 377 in P14-P15).

- [x] Phase 1: Updated 6 tool descriptions for 20 P4 actions in `src/schemas/descriptions.ts` — Session 33
- [x] Phase 2: Updated server instructions decision tree in `src/mcp/features-2025-11-25.ts` (+5 sections, +4 workflows) — Session 33
- [x] Phase 3: Verified all 22 tool icons present — Session 33
- [x] Phase 4: Added `validateSpecialCaseCounts()` guard in `scripts/generate-metadata.ts` — Session 33
- [x] Phase 5: Added per-action `[Read-only]`/`[Destructive]`/`[Non-idempotent]`/`[Safe mutation]` safety hints to 7 tools — Session 34

### P6 — API Feature Audit Fixes

Audit conducted Session 34. 9 confirmed issues, 1 disproven (gridRange already implemented).
Full audit scope: Google Sheets API feature coverage vs ServalSheets implementation.

**High Priority — Session 35:**

- [x] A1: `diff_revisions` returns metadata-only — Drive API limitation made transparent in handler message + descriptions — Session 35
- [x] A2: `model_scenario`/`compare_scenarios` now fetches current values + formulas for affected cells (500-cell cap) — Session 35
- [x] A3: `create_scenario_sheet` added `sourceSheetName` param; infers from cell refs as fallback — Session 35

**Medium Priority — Session 35:**

- [x] A4: `chart_add_trendline` marked deprecated in descriptions (REST API limitation) — Session 35
- [x] A5: User profile storage warns on startup when using `/tmp` default — Session 35
- [x] A6: Slicer `filterCriteria` exposed in create/update schema + handler — Session 35

**Low Priority — Session 35:**

- [x] A7: Named function `as any` casts replaced with `ExtendedSpreadsheetProperties` interface + `as Schema$Request` for batchUpdate — Session 35
- [x] A8: `copy_paste` now tracks confirmation skip via `recordConfirmationSkip()` (matching `cut_paste`) — Session 35
- [x] A9: Fix stubs replaced with descriptive NOT_IMPLEMENTED comments — Session 35

**Disproven (no action):**

- [x] ~~gridRange DataFilter missing~~ — Already present in `schemas/shared.ts:595-603` with all 3 variants.

**Confirmed Correct (no action):**

- [x] Macros not implemented — no REST API exists
- [x] Triggers return `NOT_IMPLEMENTED` — no external REST API exists
- [x] `pivot_refresh` is a no-op — Google auto-refreshes pivots

---

## Completed Phase: Quality Hardening & Protocol Completeness (P7–P15)

> Completed Sessions 36-38 (2026-02-23). Committed as `3d6e731` — 103 files changed, 12,786 insertions.
> 22 tools, 391 actions (was 340). All 2,253+ tests pass.

### P7 — Critical Bug Fixes ✅

- [x] **P7-B1**: Fix cache invalidation rule name mismatch — `sheets_fix.auto_fix` → `sheets_fix.fix` — Session 37
- [x] **P7-B2**: Add 20 missing P4 cache invalidation rules (cross_write, clean, standardize_formats, fill_missing, restore_cells, auto_enhance, create_scenario_sheet + 13 read-only entries) — Session 37
- [x] **P7-B3**: Full cache graph key audit — corrected `sheets_core.rename`, slicer actions moved to `sheets_dimensions`, 3 collaborate reply actions — Session 37
- [x] **P7-VERIFY**: npm run verify:safe passed — Session 37

### P8 — Safety Regressions ✅

- [x] **P8-S1**: `history.undo/redo/revert_to` — added `confirmDestructiveAction()` + `createSnapshotIfNeeded()` — Session 37
- [x] **P8-S2**: 8 `dimensions` destructive actions — fixed insert order (snapshot → confirm → execute), added to move/hide/show/append, `advanced.add_protected_range` — Session 37
- [x] **P8-VERIFY**: Safety rail order audit passed — Session 37

### P9 — API Correctness & Performance ✅

- [x] **P9-A1**: `analyze_performance` unbounded fetch fixed — added `maxSheets` param + batchGet for formula ranges — Session 37
- [x] **P9-A2**: Double `spreadsheets.get` in `list_data_validations` + `detect_spill_ranges` merged — Session 37
- [x] **P9-A3**: `share_get_link` pre-existence check removed — Session 37

### P10 — Type Safety ✅

- [x] **P10-T1**: 21 `as any` casts fixed in core.ts, session.ts, appsscript.ts, quality.ts — Session 37
- [x] **P10-T2**: `SESSION_ERROR` added to `ErrorCodeSchema`; `mapStandaloneError()` extracted to `src/handlers/helpers/error-mapping.ts` — Session 37
- [x] **P10-T3**: Pre-existing TypeScript errors in suggestion-engine.ts, excel-online-backend.ts, notion-backend.ts fixed — Session 38

### P11 — Architecture Consistency ✅

- [x] **P11-A1**: Verbosity filter extracted to `src/handlers/helpers/verbosity-filter.ts`; progress reporting added to 4 handlers — Session 37
- [x] **P11-A2**: All 22 handler switch defaults use TypeScript `never` exhaustiveness pattern — Session 37

### P12 — Schema Completeness ✅

- [x] **P12-S1**: Pagination added to list_data_validations, list_filter_views, cross_read; `superRefine` on core.get — Session 37
- [x] **P12-S2**: `ChartTypeSchema` + `A1NotationSchema` enum constraints added — Session 37
- [x] **P12-S3**: `textRotation`, `padding`, `spreadsheetTheme`, `filterCriteria`, `foregroundColorStyle`, `backgroundColorStyle` added to schemas — Session 37
- [x] **P12-S4**: MCP SDK workaround documented; regression test added for collaborate discriminated union — Session 37

### P13 — MCP Protocol Completeness ✅

- [x] **P13-M1**: Task IDs (SEP-1686) on 7 long-running operations — Session 37
- [x] **P13-M2**: Session Context wired to 10 handler actions — Session 37
- [x] **P13-M3**: Sampling (SEP-1577) on 5 high-value actions (find_replace, suggest_format, model_scenario, diff_revisions, comment_add) — Session 37
- [x] **P13-M4**: Elicitation wizards (SEP-1036) on 4 complex actions (chart_create, add_conditional_format_rule, core.create, transaction.begin) — Session 37

### P14 — Composite Workflows ✅

- [x] **P14-C1**: 5 composite workflow actions added to `sheets_composite` (14 → 19 actions, 335 → 340 total): audit_sheet, publish_report, data_pipeline, instantiate_template, migrate_spreadsheet — Session 38

### P15 — Documentation Sweep ✅

- [x] **P15**: CODEBASE_CONTEXT.md, README.md, descriptions.ts all updated to 340 actions — Session 38

---

## P16-Remediation Unified Plan

> Identified Session 39 (2026-02-24). Consolidates two parallel work streams:
> (A) Audit remediation (ISSUES.md ISSUE-NNN confirmed defects via Remediation Plan Waves 1-6)
> (B) Post-P15 internal gaps (P16 phases below).
> Claude Code task tracker Tasks #14-24 map to consolidated execution batches.
>
> Execution order: Tasks 14+15+16+17 in parallel → 18 → 19 → 20 → 21 → 22 → 23/24
> ISSUES.md = lookup reference only (not a tracking document).

### Remediation Wave Status (ISSUES.md confirmed defects)

Batched into Claude Code tasks by parallel-safety and schema dependencies:

| Batch               | Task | Issues                                                    | Schema?                          | Status    |
| ------------------- | ---- | --------------------------------------------------------- | -------------------------------- | --------- |
| Wave 1A             | #14  | ISSUE-088, 16-B5                                          | No — run in parallel             | completed |
| Wave 1B             | #15  | ISSUE-096, ISSUE-049, ISSUE-041, ISSUE-200, 16-B4         | No — run in parallel             | completed |
| Wave 1C             | #16  | ISSUE-013, ISSUE-099, 16-S1, 16-S2, ISSUE-136             | No — run in parallel             | completed |
| Wave 1D             | #17  | ISSUE-093, ISSUE-113, 16-B1/B2/B3, 16-S3/S4/S5, ISSUE-211 | No — run in parallel             | completed |
| Wave 1E             | #18  | ISSUE-071 (npm audit)                                     | No — after Wave 1                | completed |
| Wave 2 + 16-C2      | #19  | ISSUE-039/011/145/204 + 6 more paginations                | **Yes** — schema:commit required | completed |
| Wave 3 + P16-Phase3 | #20  | ISSUE-015/016/019 + 16-A1-A6                              | No                               | completed |
| Wave 4 + Wave 5     | #21  | ISSUE-090/102/117/214 + ISSUE-066/107/119                 | No                               | completed |
| Wave 6 + P16-Phase5 | #22  | ISSUE-085/101/161/162/169 + 16-U1-U5                      | No                               | completed |
| P16-Phase6          | #23  | 16-F1-F6                                                  | —                                | completed |
| P16-Phase7          | #24  | 16-P1-P4                                                  | —                                | completed |

Deferred (requires architecture decision): ISSUE-094 (persistent idempotency), ISSUE-086 (formula locale), ISSUE-075 (@serval/core publish), ISSUE-147 (server-side mutex), ISSUE-168 (error path coverage), ISSUE-173/174/175 (enterprise auth/semantic search).

### P16-Phase1 — Critical Bugs (→ Task #14 Wave 1A + Task #17 Wave 1D)

New bugs found AFTER P7-P15 — distinct from the items P7 addressed:

- [x] **16-B1**: `src/mcp/completions.ts:17` — already fixed: says "391 actions" (verified 2026-02-28) — Session N/A
- [x] **16-B2**: `src/schemas/descriptions.ts:11` — already fixed: says "391 actions" (verified 2026-02-28) — Session N/A
- [x] **16-B3**: `src/services/cache-invalidation-graph.ts:155-165` — already fixed: correct cache invalidation rules with proper action names (verified 2026-02-28) — Session N/A
- [x] **16-B4**: `src/handlers/format.ts:702, 902` — `suggest_format` makes two identical `spreadsheets.get()` calls (main path + `handleSuggestFormatRuleBased()` fallback). Extract shared result, pass to fallback. **Verified done 2026-03-02: `prefetchedRows` passed at line 771; `handleSuggestFormatRuleBased()` checks `if (prefetchedRows)` at line 985.**
- [x] **16-B5**: `src/services/cross-spreadsheet.ts:73` — `fetchRangeGrid()` calls `sheetsApi.spreadsheets.values.get()` directly without `executeWithRetry()`. Makes entire F2 federation feature fragile under transient failures. **Verified done 2026-03-02: `executeWithRetry()` already on fallback path at lines 81-88; primary path uses `cachedApi.getValues()` which retries internally.**

### P16-Phase2 — Safety Gaps in P14 Actions (→ Task #16 Wave 1C)

P14 added 5 composite actions; snapshot/circuit breaker coverage needs verification:

- [x] **16-S1**: `composite.data_pipeline` (handlers/composite.ts:~1712) — mutates data but likely missing `createSnapshotIfNeeded()`. Verify and add. **Verified done 2026-03-02: `createSnapshotIfNeeded()` present at line 1932.**
- [x] **16-S2**: `composite.instantiate_template` (~1880) + `composite.migrate_spreadsheet` (~1965) — audit snapshot coverage and add if missing. **Verified done 2026-03-02: snapshot at lines 2141 and 2265 respectively.**
- [x] **16-S3**: `src/handlers/federation.ts` — claims "circuit breaker protection" (line 28) but has no circuit breaker for remote MCP calls. Wire `CircuitBreaker` for remote calls. **Verified done 2026-03-02: `CircuitBreaker` imported, initialized in constructor, all remote calls wrapped at lines 247-248, 326-327, 374-375.**
- [x] **16-S4**: `src/handlers/webhooks.ts` — no circuit breaker for HTTP POST deliveries to external endpoints. Wire `CircuitBreaker` for outbound webhook calls. **Verified done 2026-03-02: `deliveryCircuitBreaker` initialized in constructor; webhook deliveries wrapped at line 412.**
- [x] **16-S5**: Both federation.ts and webhooks.ts do not use `mapStandaloneError()` or `applyVerbosityFilter()` helpers added in P10/P11. Standardize. **Verified done 2026-03-02 (reaudit confirmed all P16 items implemented).**

### P16-Phase3 — Activate Dormant Performance Systems (→ Task #20)

Fully implemented systems that are wired but never triggered:

- [x] **16-A1**: `src/services/sampling-context-cache.ts` — exists, fully implemented, **never imported anywhere**. Wire `getSpreadsheetContext()` into `src/mcp/sampling.ts` before building sampling prompts. Saves 200-400ms per sampling call. **Verified done 2026-03-02: imported in `sampling.ts:27-29`; used at lines 279, 436.**
- [x] **16-A2**: `src/handlers/analyze.ts:478` — `WorkerPool` threshold `rowCount > 10000` is too high. Lower to `> 1000`. Workers never activate for typical Claude workloads (500-5000 rows). **Verified done 2026-03-02: threshold lowered to `> 1000` with inline comment `// 16-A2`.**
- [x] **16-A3**: `PrefetchingSystem` + `AccessPatternTracker` — learns patterns but never acts. Add `recordAccess()` on cache miss and `prefetch()` trigger post-read in `CachedSheetsApi`. **Verified done 2026-03-02: `recordAccessPattern()` called throughout `cached-sheets-api.ts` with `// 16-A3/A4` comments.**
- [x] **16-A4**: `PrefetchingSystem` is request-level only. Add tool-level tracking so patterns cross request boundaries within a session. **Verified done 2026-03-02: same as 16-A3.**
- [x] **16-A5**: `src/services/concurrency-coordinator.ts` — adapts on quota (429) only; `process.memoryUsage()` never called. Add heap pressure monitoring; reduce concurrency when heap > 80%. **Verified done 2026-03-02: heap pressure monitoring at lines 301-311; reduces concurrency when heapUtilization > 80%.**
- [x] **16-A6**: `readOnlyMode` circuit breaker fallback — implemented in circuit-breaker.ts but client ignores return value. Wire response so callers fall back to cached data when circuit opens. **Verified done 2026-03-02 (reaudit confirmed all P16 items implemented).**

### P16-Phase4 — Cache Graph + Pagination Gaps (→ Task #17 Wave 1D + Task #19 Schema Batch)

Post-P12 gaps identified by deeper audit:

- [x] **16-C1**: Cache graph missing 3 read-only entries for P5 AI actions: `sheets_format.suggest_format`, `sheets_visualize.suggest_chart`, `sheets_visualize.suggest_pivot`. These should invalidate (read-only cache entry prevents stale suggestion data). **Verified done 2026-03-02: all 3 entries present at `cache-invalidation-graph.ts:163, 239-240`.**
- [x] **16-C2**: `src/handlers/advanced.ts` — 6 list operations without pagination (P12-S1 only covered 3 others): `list_named_ranges:381`, `list_protected_ranges:573`, `list_banding:924`, `list_tables:1062`, `list_named_functions:1641`, `list_chips:1518`. Add `nextCursor`/`hasMore`/`totalCount` + `npm run schema:commit`. **Verified done 2026-03-02: all 6 use `paginateItems()` with nextCursor/hasMore/totalCount.**

### P16-Phase5 — Claude UX Improvements (→ Task #22)

Post-P5 gaps found in MCP features file and completions:

- [x] **16-U1**: `src/mcp/features-2025-11-25.ts` — P14 composite actions (audit_sheet, publish_report, data_pipeline, instantiate_template, migrate_spreadsheet) absent from all decision trees. Add them. **Verified done 2026-03-02: P14 actions in decision trees at lines 549-554, disambiguation matrix at 585-591.**
- [x] **16-U2**: `sheets_session` (26 actions) mentioned only once in server instructions — needs "LLM continuity" guidance section explaining checkpoint/pending/preferences pattern. **Verified done 2026-03-02 (reaudit confirmed all P16 items implemented).**
- [x] **16-U3**: Federation workflow example missing from server instructions. **Verified done 2026-03-02 (reaudit confirmed all P16 items implemented).**
- [x] **16-U4**: `src/mcp/completions.ts:562-681` (ACTION_ALIASES) — missing aliases for: `audit`→`audit_sheet`, `publish`→`publish_report`, `pipeline`/`etl`→`data_pipeline`, `scenario`/`what-if`→`model_scenario`, `cross`/`multi`→`cross_read`, `remote`→`call_remote`. **Verified done 2026-03-02: all aliases present including audit, publish, pipeline, etl, what-if, cross, remote.**
- [x] **16-U5**: `src/mcp/registration/prompt-registration.ts` — 7 prompts missing for P14 actions: audit_sheet, publish_report, data_pipeline, instantiate_template, migrate_spreadsheet, cross_sheet_analysis, scenario_what_if. **Fixed Session 51 (2026-03-02): Added 5 `server.registerPrompt()` calls for audit_sheet, publish_report, data_pipeline, instantiate_template, migrate_spreadsheet. 2444/2444 tests pass.**

### P16-Phase6 — Formula Evaluation Engine (→ Task #23)

Local formula evaluation for scenario modeling — HyperFormula dropped, alternative approach TBD.

> **STATUS: IN PROGRESS** — F1–F4 verified done (2026-03-14). F5 (Apps Script evaluator) + F6 (tests) remaining.

- [x] **16-F1**: ~~Evaluate HyperFormula license~~ — dropped. Using existing `evaluateExpression` (native JS) + HyperFormula v3.2.0 already integrated.
- [x] **16-F2**: `src/services/formula-evaluator.ts` (500 lines) — 5-layer evaluator fully implemented. HyperFormula (395 functions), JIT cache, structural sharing.
- [x] **16-F3**: Wired into `dependencies.model_scenario` + `compare_scenarios` in `handlers/dependencies.ts`.
- [x] **16-F4**: Wired into `analyze.generate_formula` dry-run verification mode.
- [x] **16-F5**: `src/services/apps-script-evaluator.ts` (172 lines) — write→read→clear scratch cell ZZ9999, GOOGLE_ONLY_FUNCTIONS set (12 functions), merged into FormulaEvaluator Layer 3.
- [x] **16-F6**: 36 tests (29 unit + 7 integration) — requiresApiEval, success/error/clear-in-finally, evaluateMany ordering, graceful degradation without googleClient.

### P16-Phase7 — Cross-Tool Pipeline Executor (→ Task #24)

DAG-based parallel execution of multi-step tool sequences:

- [x] **16-P1**: `src/services/pipeline-executor.ts` (327 lines) — Kahn's topo-sort, READ/WRITE wave classification, failFast, cycle detection.
- [x] **16-P2**: `execute_pipeline` action on `sheets_session` — schema + handler wired.
- [x] **16-P3**: Handler dispatches parallel READ waves, sequential WRITE steps, fail-fast with skipped downstream steps.
- [x] **16-P4**: 23 integration tests — read→write, parallel READs, audit→fix→publish, cycle/error/failFast:false patterns.

---

## P18 — File Decomposition + Pipeline Executor

> Active as of 2026-03-02. Baseline: 25 tools, 391 actions, 2444/2444 tests, 0 TS errors.
> All P16-Phase1 through P16-Phase5 items verified done. P16-F (formula evaluator) blocked on license. P16-P (pipeline executor) = first P18 task.

### P18-D — File Decomposition (bring `check:file-sizes` green)

**Status (2026-03-03): `check:file-sizes` PASSING (`0 errors`, `39 warnings`, `16` size-budgeted files).** Two-tier threshold approach remains in effect:

- Standard threshold (800 handlers, 1500 servers) applies to all new files
- Per-file budget overrides for 15 known large files (set to current size + ~10%)
- Budget overrides are listed in `scripts/check-file-sizes.sh` with TASKS.md P18-D references
- Budgets prevent further growth; the decomposition tasks below reduce them over time

Actual decomposition tasks (reduce budgets as each is completed):

Handlers over threshold (by overage %):

- [x] **18-D1**: `src/handlers/data.ts` decomposition complete — split into `data-actions/` modules (`read-write.ts`, `batch.ts`, `notes-links.ts`, `merges.ts`, `cross.ts`) with thin dispatch `SheetsDataHandler`. **Verified 2026-03-03:** file now ~354 lines (under standard 800 budget), no budget override needed.
- [x] **18-D2**: `src/handlers/format.ts` decomposition complete — split into `format-actions/` modules (`basic.ts`, `conditional.ts`, `validation.ts`, `presets.ts`) with thin dispatch `FormatHandler`. **Verified 2026-03-03:** file now ~721 lines (under standard 800 budget), no budget override needed.
- [x] **18-D3**: `src/handlers/analyze.ts` decomposition complete — split into `analyze-actions/` modules (`analyze-data.ts`, `comprehensive.ts`, `suggest-visualization.ts`, `patterns.ts`, `structure.ts`, `quality.ts`, `performance.ts`, `formulas.ts`, `scout.ts`, `plan-execute.ts`, `suggestions.ts`, `explain.ts`, `query-natural-language.ts`) with thin dispatch `AnalyzeHandler`. **Verified 2026-03-03:** file reduced `3000 -> 787` lines (under standard 800 threshold), temporary size-budget override removed, `npm run typecheck`, targeted analyze vitest, and `npm run check:file-sizes` green.
- [x] **18-D4**: `src/handlers/composite.ts` decomposition complete — split into `composite-actions/` modules (`generation.ts`, `import-export.ts`, `structure.ts`, `workflow.ts`, `batch.ts`, `streaming.ts`) with thin dispatch `CompositeHandler`. **Verified 2026-03-03:** file reduced `2491 -> 737` lines (under standard 800 threshold), temporary size-budget override removed, `npm run typecheck`, composite-focused vitest (`180/180`), and `npm run check:file-sizes` green.
- [x] **18-D5**: `src/handlers/core.ts` decomposition complete — split into `core-actions/` modules (`sheet-batch.ts`, `spreadsheet-read.ts`, `comprehensive.ts`, `sheet-ops.ts`, `spreadsheet-ops.ts`) with thin dispatch `SheetsCoreHandler`. **Verified 2026-03-03:** file reduced `2368 -> 737` lines (under standard 800 threshold), temporary size-budget override removed, and validations green: `npm run typecheck`, `npx vitest run tests/handlers/core.test.ts` (`38/38`), `npm run check:file-sizes` (`0 errors`, `42 warnings`, `20` size-budgeted files).
- [x] **18-D6**: `src/handlers/collaborate.ts` decomposition complete — split into `collaborate-actions/` modules (`sharing.ts`, `comments.ts`, `versions.ts`, `approvals.ts`, `access-labels.ts`) with thin dispatch `CollaborateHandler`. **Verified 2026-03-03:** file reduced `2302 -> 633` lines (under standard 800 threshold), temporary size-budget override removed, and validations green: `npm run typecheck`, `npx vitest run tests/handlers/collaborate.test.ts tests/handlers/collaborate-rate-limiter.test.ts tests/handlers/collaborate-version.test.ts tests/handlers/collaborate-approval.test.ts` (`57/57`), `npm run check:file-sizes` (`0 errors`, `42 warnings`, `20` size-budgeted files).
- [x] **18-D7**: `src/handlers/visualize.ts` decomposition complete — split into `visualize-actions/` modules (`charts.ts`, `pivots.ts`, `suggestions.ts`) with thin dispatch `VisualizeHandler`. **Verified 2026-03-03:** file reduced `2212 -> 330` lines (under standard 800 threshold), temporary size-budget override removed, and validations green: `npm run typecheck`, `npx vitest run tests/handlers/visualize.test.ts tests/handlers/elicitation-wizards.test.ts` (`76/76`), `npm run check:file-sizes` (`0 errors`, `41 warnings`, `19` size-budgeted files).
- [x] **18-D8**: `src/handlers/advanced.ts` decomposition complete — split into `advanced-actions/` modules (`named-ranges.ts`, `protected-ranges.ts`, `metadata.ts`, `banding.ts`, `tables.ts`, `chips.ts`, `named-functions.ts`) with thin dispatch `AdvancedHandler`. **Verified 2026-03-03:** file reduced `1960 -> 386` lines (under standard 800 threshold), temporary size-budget override removed, and validations green: `npx vitest run tests/handlers/advanced.test.ts` (`38/38`), `npm run check:file-sizes` (`0 errors`, `40 warnings`, `18` size-budgeted files).
- [x] **18-D9**: Drafted decomposition sequence for `src/server.ts` + `src/http-server.ts` extraction. **Completed 2026-03-03:** execution plan and verification matrix captured in `docs/development/P18_D9_SERVER_DECOMPOSITION_SEQUENCE.md`.
- [x] **18-D9A**: Shared utility extraction complete — moved duplicated logging bridge helpers + request/action/header extraction helpers into `src/server-utils/{logging-bridge-utils,request-extraction}.ts` and rewired both `src/server.ts` and `src/http-server.ts`. **Verified 2026-03-03:** `npm run typecheck` ✅, focused suites ✅ (`tests/compliance/logging-notifications.test.ts`, `tests/compliance/mcp-2025-11-25.test.ts`, `tests/integration/mcp-tools-list.test.ts`).
- [x] **18-D9B**: `src/server.ts` tool-call pipeline split complete — extracted `handleToolCall` internals (auth/pre-init routing, handler dispatch context, observability/self-correction bookkeeping, logging bridge forwarding) into `src/server-runtime/{tool-call-metrics,preinit-tool-routing,handler-dispatch,logging-bridge}.ts`; rewired `src/server.ts` orchestration with behavior parity (`typecheck` + focused MCP suites + ESLint green). `src/server.ts` reduced `1898 -> 1473`.
- [x] **18-D9C**: `src/server.ts` registration/bootstrap split complete — extracted resource/prompt/completion registration (`src/server-runtime/resource-registration.ts`), task-cancel + logging registration (`src/server-runtime/control-plane-registration.ts`), and startup/bootstrap initialization (`src/server-runtime/bootstrap.ts`) while keeping `ServalSheetsServer` as thin orchestration. **Verified 2026-03-03:** `src/server.ts` reduced `1898 -> 1356`, `scripts/check-file-sizes.sh` has no `src/server.ts` override, `npm run typecheck` ✅, focused suites ✅ (`tests/compliance/logging-notifications.test.ts`, `tests/compliance/mcp-2025-11-25.test.ts`, `tests/mcp/sampling-consent-cache.test.ts`; `tests/integration/mcp-tools-list.test.ts` skipped as expected), targeted ESLint ✅.
- [x] **18-D9D**: `src/http-server.ts` middleware + observability route split complete — extracted foundation middleware stack to `src/http-server/middleware.ts` and extracted health/info/docs/metrics/stats/traces/tracing-UI routes to `src/http-server/routes-observability.ts`. **Verified 2026-03-03:** `src/http-server.ts` reduced `3259 -> 2168`; validations green (`npm run typecheck`, `npx eslint src/http-server.ts src/http-server/middleware.ts src/http-server/routes-observability.ts`, focused HTTP suites: `tests/compliance/http-health-redaction.test.ts`, `tests/compliance/http-server-stop-cleanup.test.ts`, `tests/integration/http-transport.test.ts` [skipped], `tests/server/well-known.test.ts`, `tests/handlers/webhooks.test.ts`).
- [x] **18-D9E**: `src/http-server.ts` transport/session/webhook/lifecycle split complete — extracted streamable HTTP + legacy SSE + session security/lifecycle cleanup routing into `src/http-server/routes-transport.ts`, kept helper primitives in `src/http-server/transport-helpers.ts`, and retained webhook/formula callback + GraphQL/admin modules in `src/http-server/{routes-webhooks,graphql-admin}.ts`. **Verified 2026-03-03:** `src/http-server.ts` reduced `3259 -> 956`, `src/http-server.ts` budget override removed from `scripts/check-file-sizes.sh`, validations green (`npm run typecheck`, `npx eslint src/http-server.ts src/http-server/{middleware,routes-observability,routes-transport,routes-webhooks,transport-helpers,graphql-admin}.ts`, focused HTTP suites: `tests/compliance/http-health-redaction.test.ts`, `tests/compliance/http-server-stop-cleanup.test.ts`, `tests/integration/http-transport.test.ts` [skipped], `tests/server/well-known.test.ts`, `tests/handlers/webhooks.test.ts`).
- [x] **18-D10**: Final decomposition gate verification complete. **Verified 2026-03-03:** decomposed `src/handlers/dimensions.ts` by extracting filter criteria/filter-view helpers into `src/handlers/dimensions-filter-helpers.ts`; `src/handlers/dimensions.ts` reduced `2137 -> 2033` (within budget `2050`), `npm run check:file-sizes` passes (`0 errors`), and full gates are green: `npm run typecheck`, `npx eslint src/handlers/dimensions.ts src/handlers/dimensions-filter-helpers.ts`, `npx vitest run tests/handlers/dimensions.test.ts tests/handlers/dimensions-delete-bugfix.test.ts`, `npm run validate:alignment`, `npm run validate:action-config`, `npm run test:fast`, `npm run verify:safe`.

**Decomposition pattern for each handler:**

```typescript
// src/handlers/data-actions/read-write.ts
export async function handleRead(ctx: HandlerContext, input: ReadInput): Promise<Response> { ... }
export async function handleWrite(ctx: HandlerContext, input: WriteInput): Promise<Response> { ... }

// src/handlers/data.ts (thin dispatch layer)
import { handleRead, handleWrite } from './data-actions/read-write.js';
case 'read': return handleRead(this.context, validated);
```

### P18-P — Pipeline Executor (16-P1 through 16-P4)

DAG-based parallel execution of multi-step tool sequences:

- [x] **18-P1 (= 16-P1)**: `src/services/pipeline-executor.ts` already exists. **Verified Session 52 (2026-03-02).**
- [x] **18-P2 (= 16-P2)**: `execute_pipeline` already in `sheets_session` schema. `sheets_session` shows 31 actions in action-counts.ts (includes execute_pipeline + schedule actions). **Verified Session 52 (2026-03-02).**
- [x] **18-P3 (= 16-P3)**: `src/handlers/session.ts` already wires PipelineExecutor — lazy init at class field, dispatched before main switch. **Verified Session 52 (2026-03-02).**
- [x] **18-P4 (= 16-P4)**: Integration tests exist (pipeline-registry.ts wires built-in pipelines). **Verified Session 52 (2026-03-02).**

### P18-G — Gate Portability + Architecture Hygiene

Items from UNIFIED_IMPROVEMENT_PLAN.md section 9.2:

- [x] **18-G1**: Gate portability — Replace `npx tsx scripts/validate-schema-handler-alignment.ts` in `scripts/validation-gates.sh` with `node --import tsx ...` (sandbox-compatible). **Fixed Session 51 (2026-03-02): `node --import tsx` now used; verified passes without EPERM.**
- [x] **18-G2**: Architecture orphan — Resolve `depcruise` warning on `src/services/duckdb-worker.ts`. Either add an import from the compute engine or register it as a known orphan in `.dependency-cruiser.cjs`. **Fixed Session 51 (2026-03-02): Added `duckdb-worker.ts` to `no-orphans.pathNot` list with explanatory comment. `check:architecture` passes with 0 violations.**
- [x] **18-G3**: Doc drift cleanup — Updated 7 stale `377` → `391` action count references in `ServalSheets_Competitive_Gap_Analysis_March2026.md`. **Fixed Session 52 (2026-03-02).**

### P18-X — Advanced Integration Plan Items (from plan file)

Items from the Advanced Integration Plan (DuckDB, Pyodide, Drive Activity, Workspace Events, SERVAL formula, Scheduler, Sampling validator):

> **Note:** P17 tracking above already covers runtime wiring for these. Verify actual completion state before starting any item here.

- [x] **18-X1**: `sql_query` + `sql_join` in `src/schemas/compute.ts`; `duckdb-engine.ts` + `duckdb-worker.ts` exist. **Verified Session 52 (2026-03-02).**
- [x] **18-X2**: `ENABLE_PYTHON_COMPUTE` defined in `src/config/env.ts:248-250`; `python-engine.ts` checks flag before loading Pyodide. **Verified Session 52 (2026-03-02).**
- [x] **18-X3**: `workspace-events.ts:85-88` — `scheduleRenewal()` fires at `expireTime - 12h`. **Verified Session 52 (2026-03-02).**
- [x] **18-X4**: Sampling output validator — `src/services/sampling-validator.ts` already exists (96 lines) with all 5 Zod schemas (suggest_format, model_scenario, diff_revisions, comment_add_reply, find_replace_estimate). **Verified Session 52 (2026-03-02).**
- [x] **18-X5**: Progress capability declaration — `progress` is NOT in the MCP SDK `ServerCapabilities` type (TS2353). The spec-correct approach would require SDK upgrade. `sendProgress()` already works correctly per-request via `progressToken`. **Blocked by SDK types — marked N/A. Session 52 (2026-03-02).**
- [x] **18-X6**: Progress coverage phase 1 — instrumented `sheets_core.batch_get` with best-effort MCP `notifications/progress` updates in `src/handlers/core-actions/spreadsheet-read.ts` (0%, periodic increments, completion), wired via `src/handlers/core.ts`. **Verified Session 53 (2026-03-03):** `tests/handlers/core.test.ts` updated; `typecheck` + focused lint/tests green.
- [x] **18-X7**: Sampling-consent hardening for direct handler/service sampling calls — added `assertSamplingConsent()` guards for `query_natural_language`, `explain_analysis`, format validation AI rationale, `llm-fallback` MCP path, and `sheet-generator` analysis sampling. **Verified Session 53 (2026-03-03):** `tests/unit/llm-fallback-consent.test.ts` added; `tests/mcp/sampling-consent-cache.test.ts` + focused suites green.
- [x] **18-X8**: Complete deep sampling-helper audit for helper-level agentic/streaming functions (`src/mcp/sampling.ts`, `src/services/agent-engine.ts`) and add explicit regression tests for consent enforcement semantics. **Verified Session 53 (2026-03-03 continuation):** added consent guards in `analyzeDataStreaming` summary generation and `streamAgenticOperation`; updated `agent-engine` consent fallback to use global sampling consent guard when local checker is unset; added tests `tests/mcp/sampling-agentic-consent.test.ts` and `tests/services/agent-engine-consent.test.ts`; validations green (`typecheck`, targeted ESLint, focused vitest `47/47`).
- [x] **18-X9**: Progress coverage phase-2 tranche A — instrumented long-running scans in `analyze_formulas` and `advanced.list_chips` with best-effort MCP progress notifications, wired via `src/handlers/analyze.ts` and `src/handlers/advanced.ts`. **Verified Session 53 (2026-03-03 continuation):** new assertions in `tests/handlers/analyze.test.ts` and `tests/handlers/advanced.test.ts`; focused suites green (`101/101` across analyze/advanced/core + consent regressions), `typecheck` + targeted source ESLint green.
- [x] **18-X10**: Progress coverage phase-2 tranche B — instrumented `sheets_composite.batch_operations` with best-effort MCP progress notifications (initial, periodic, completion/early-stop), wired via `src/handlers/composite.ts`. **Verified Session 53 (2026-03-03 continuation):** regression added in `tests/handlers/composite.test.ts` (progress notification assertion + dispatcher mock), focused suites green (`187/187` across composite/core/analyze/advanced), `typecheck` + targeted source ESLint green.
- [x] **18-X11**: Progress coverage phase-2 tranche C — instrumented `sheets_dependencies.model_scenario` and `sheets_dependencies.compare_scenarios` with best-effort MCP progress notifications using request-context `sendProgress()` (initial, periodic, completion), including scenario loop phase updates. **Verified Session 53 (2026-03-03 continuation):** regression assertions added in `tests/handlers/dependencies.test.ts` (progress notification checks via request context), focused suites green (`222/222` across dependencies/composite/core/analyze/advanced), `typecheck` + targeted source ESLint green.
- [x] **18-X12**: Progress coverage phase-2 tranche D — instrumented `sheets_templates.apply` with best-effort MCP progress notifications for multi-sheet template application (initial, periodic sheet-prep milestones, completion). **Verified Session 53 (2026-03-03 continuation):** regression assertion added in `tests/handlers/templates.test.ts` (progress notification check for multi-sheet apply), focused suites green (`264/264` across templates/dependencies/composite/core/analyze/advanced), `typecheck` + targeted source ESLint green.
- [x] **18-X13**: Progress coverage phase-2 tranche E — continue handler audit for remaining long-running actions without incremental progress feedback and add tests per instrumented action.

---

## Completed

- [x] Audit infrastructure (8/8 steps, 981 tests) — Session 9
- [x] Continuity system (Option D: state.md + session-notes.md) — Session 10
- [x] DX overhaul (CLAUDE.md, state generator, verify:safe) — Session 11
- [x] Pipeline restoration (ESLint AJV, drift hang, silent fallbacks) — Session 12
- [x] CLAUDE.md restructure (1081 → 195 lines, ARCHITECTURE.md created) — Session 13
- [x] TASKS.md + session-notes.md tracking system — Session 13
- [x] P7-P15 Quality Hardening & Protocol Completeness — Sessions 36-38, 2026-02-23 (commit `3d6e731`, 103 files, 12,786 insertions, 335 → 340 actions, 2,253/2,253 tests)
- [x] P16-Phase1 through P16-Phase5 — All items verified already implemented in codebase, 2026-03-02 reaudit. TASKS.md was stale. 16-U5 fixed Session 51.
