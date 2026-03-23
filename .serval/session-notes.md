# Session Notes

> Updated by each Claude session as its last act. Captures intent, decisions, and next steps
> that code analysis alone cannot determine.
> Full session history (Sessions 8–49): `docs/development/CODEBASE_CONTEXT.md#historical-feature-milestones`

## Current Phase

**Session 100 (2026-03-22) — Merge remediation/phase-1 into main via PR #37.** Branch `remediation/phase-1`. 407 actions (25 tools). 25 tools / 407 actions. TypeScript clean. Working tree clean.

## What Was Just Completed (Session 100)

**Merge `remediation/phase-1` → `main` (PR #37):**

- Resolved all 11 merge conflicts from `git merge main --no-edit`
- **Conflict strategy:**
  - CI workflows, `.dependency-cruiser.cjs`, `docs/guides/ONBOARDING.md` → took main
  - `mutation-safety-middleware.ts` → took main (`hasFormulaPassthroughSafety` regression fix)
  - `security-agent.ts` → took main + fixed unused `context` param lint error
  - `worker-runner.ts` → merged: kept typed error imports + main's `assertAllowedWorkerScriptPath()`
  - `rest-generic.ts` → kept HEAD's typed error imports (`ConfigError`, `NotFoundError`, `ServiceError`)
  - `README.md` → main's badge/count text; kept HEAD's SDK 1.27.1
  - `package.json` → merged detailed e2e scripts + added main's `test:coverage:report`
- Fixed pre-commit failures: ONBOARDING.md frontmatter (`guides` → `guide`), doc count sync, unused param
- Synced `src/generated/manifest.json` stale count (397 → 404)
- Pushed to `remediation/phase-1` — PR #37 is conflict-free and ready to merge

**Remaining (maintainer-only, not blocking PR merge):**

- `npm publish @serval/core v0.2.0` (ISSUE-075)
- Add `ANTHROPIC_API_KEY` to `claude_desktop_config.json` env block (manual — user must add own key)

## What Was Just Completed (Session 99)

**8-commit bug fix batch (BUG-1 through BUG-20) + TypeScript follow-up:**

Unblocked by clearing stale `.git/index.lock` + `.git/refs/stash.lock` from FUSE bindfs mount.

- **Commit 1** (`0bd0d31`): A1 range normalization + conditional format rendering (BUG-2,6,7,14) — `range-resolver.ts`, `conditional.ts`
- **Commit 2** (`43be59f`): Output schema mismatches — `shared.ts` (removed duplicate `fixableVia` key), `agent.ts` (BUG-1,8,12,15)
- **Commit 3** (`acdcf00`): Google API params — `charts.ts`, `appsscript.ts`, `banding.ts`, `appsscript.test.ts` (BUG-4,5,13)
- **Commit 4** (`126e230`): Schema discriminators — `data.ts`, `quality.ts` (schema+handler), `analyze.ts` (BUG-3,11,16,17)
- **Commit 5** (`c3c200a`): Worker safety — `python-worker.ts`, `duckdb-worker.ts` (BUG-9,10)
- **Commit 6** (`b4f7336`): Auto-fill + compute — `auto-fill.ts`, `compute.ts` handler+schema (BUG-18,19,20)
- **Commit 7** (`206eb01`): Infra/metadata — `auth.ts`, `tool-response.ts`, `core.ts`, `spreadsheet-ops.ts`, `completions.ts`, `versions.ts`, `revision-timeline.ts`, `schema-handler-alignment.test.ts`, docs, CHANGELOG
- **Commit 8** (`22b59e5`): TypeScript strict-mode follow-up — `base.ts` (remove `explanation` from fixableVia + `any[]`→`unknown[]`), `compute.ts` (bracket notation), `auto-fill.ts` (cast for safety.dryRun)

**Key decision:** `explanation` field removed from `fixableVia` in `shared.ts` because it was only in the duplicate definition (the BUG-8 fix at line 1149 is the canonical one). `base.ts` error-fix-suggester still works — just without the explanation string in the schema output.

## What Was Just Completed (Session 98)

**Enterprise SSO/SAML 2.0 Service Provider implementation (ISSUE-173):**

- **`src/auth/saml-provider.ts`** (NEW): `SamlProvider` class with `issueToken()`, `verifyToken()`, `generateMetadata()`, `createRouter()`; factory `createSamlProviderFromEnv()`. Routes: GET /sso/login, POST /sso/callback, GET /sso/metadata, GET /sso/logout. JWT `scope='sso'` distinguishes from OAuth tokens; compatible with existing Bearer-token middleware.
- **`src/types/node-saml.d.ts`** (NEW): Minimal type declarations for `node-saml` (no @types package exists). Covers SAML, SamlConfig, SamlProfile, AuthorizeOptions, LogoutProfile.
- **`src/http-server.ts`**: Auto-wires `samlProvider.createRouter()` when `SAML_ENTRY_POINT` is configured; logs enabled state.
- **`src/config/env.ts`**: Added `SAML_ENTRY_POINT`, `SAML_ISSUER`, `SAML_CERT`, `SAML_CALLBACK_URL`, `SAML_PRIVATE_KEY`, `SAML_WANT_ASSERTIONS_SIGNED`, `SAML_SIGNATURE_ALGORITHM`, `SSO_JWT_TTL`, `SSO_ALLOWED_CLOCK_SKEW`.
- **`tests/auth/saml-provider.test.ts`** (NEW): 24 tests using DI pattern (mock SAML injected via constructor; no `vi.mock('node-saml')` needed). Covers: factory null returns, JWT structure/scope/TTL/attributes/sessionIndex, verifyToken valid/tampered/wrong-scope/expired/garbage, metadata XML, route registration, callback error paths (no profile, no nameId, assertion throws, loggedOut), callback success with/without RelayState.

**Key decisions:**

- DI pattern (`constructor(config, samlInstance?: SAML)`) avoids ESM `vi.mock` hoisting issues with constructors
- Token delivery: JSON for API/CLI clients; query-param redirect (`?sso_token=`) for app RelayState URLs
- `node-saml` installed as production dep (v3.1.2); `jsonwebtoken` already present

**Commit**: `c3c9f9d`

## What Was Just Completed (Session 97)

**8-item multi-tier implementation plan — all tiers complete:**

Tiers 1–3 were completed in Session 96. This session completed **Tier 4 (Item 8): Services decomposition**.

- **`src/services/agent-engine.ts`** (2467 lines → 75 lines): Converted to thin re-export facade. Split into 7 focused sub-modules under `src/services/agent/`:
  - `types.ts` (~155 lines) — all interfaces + `registerToolInputSchemas` setter (G3 constraint preserved)
  - `sampling.ts` (~145 lines) — MCP Sampling utilities, consent, model hints
  - `plan-store.ts` (~110 lines) — in-memory `Map<string, PlanState>` + disk persistence
  - `templates.ts` (~370 lines) — `WORKFLOW_TEMPLATES` + type exports
  - `plan-compiler.ts` (~320 lines) — `compilePlanAI`, `compilePlan`, `compileFromTemplate`, `listTemplates`
  - `plan-executor.ts` (~530 lines) — `executePlan`, `executeStep`, `resumePlan`, `aiValidateStepResult`
  - `checkpoints.ts` (~110 lines) — `createCheckpoint`, `rollbackToPlan`, `getPlanStatus`, `listPlans`, `deletePlan`, `clearAllPlans`
- **`src/services/transaction-wal.ts`** (NEW, ~220 lines): `WalManager` class extracted from `transaction-manager.ts` — owns all WAL state (`seq`, `orphanedTransactions`, `writeChain`, `ready`), exposes `append()`, `compact()`, `getRecoveryReport()`, `discardOrphaned()`.
- **`src/services/transaction-manager.ts`** (2371 → 2139 lines): Replaced 6 WAL private fields + 4 WAL private methods with `this.wal: WalManager | null`. All WAL delegation calls preserved.
- **`scripts/check-file-sizes.sh`**: Removed agent-engine.ts budget override; set transaction-manager.ts budget to 2200.
- **Annotation fix**: Added `sheets_analyze.semantic_search` to `ACTION_ANNOTATIONS` (missing entry from Session 95).
- **Doc count fix**: Updated 403→404 in README.md, add-on/README.md, SOURCE_OF_TRUTH.md, descriptions.ts.

**Verification**: TypeScript clean, 2742/2742 tests pass, validate:action-config passing.

**Commits**: `6c755e1` (Tier 4 decomposition), `86336c8` (CODEBASE_CONTEXT 407 actions update)

## What Was Just Completed (Session 96)

**Three-track post-audit improvement plan:**

- **Track A (pending commits)**: Already done by Session 95 — semantic_search feature committed in `116cd22`. Only 2 trivial doc changes remained; incorporated.
- **Track B (error typing sprint)**: Already complete — only 4 generic throws remain in `duckdb-worker.ts` (SQL injection guards in worker thread, appropriate as-is).
- **Track C (memory protection)**: Verified existing protections (MAX_ROWS_PER_SHEET=5000, heap-watchdog.ts with isHeapCritical() at 3 checkpoints, scout fallback on memory pressure) already cover the concern. Added **intermediate progress reporting** to `ComprehensiveAnalyzer.analyze()` — 8 phases now emit progress at 10/20/20-70/72-75/80/85/90% instead of only 0% and 100%. Each `sendProgress()` call between sheets also serves as a GC yield point.
- **semantic_search tests**: Already committed with the feature (`tests/handlers/analyze-semantic-search.test.ts`, 8 tests).

**Counts**: 25 tools, 407 actions (semantic_search added in Session 95), 2742/2742 tests pass.

**Commits this session**: `fec8cdc` (comprehensive.ts progress notifications)

## What Was Just Completed (Session 95)

**semantic_search feature (ISSUE-174/175) + live API test suite:**

- `sheets_analyze.semantic_search`: Vector search across spreadsheet content using Voyage AI embeddings. In-memory LRU index (max 20 spreadsheets), cosine similarity ranking.
- Files: `src/schemas/analyze.ts`, `src/handlers/analyze.ts`, `src/handlers/analyze-actions/semantic-search.ts` (101 lines), `src/services/semantic-search.ts` (354 lines), `src/config/env.ts` (VOYAGE_API_KEY), `scripts/generate-metadata.ts` (count 22→23 for analyze), `src/services/cache-invalidation-graph.ts`.
- Tests: `tests/handlers/analyze-semantic-search.test.ts` (8 tests covering config error, cache, forceReindex, topK, empty spreadsheet, API error, index stats).
- Live API tests added for agent/compute/connectors/federation handlers.

**Commits**: `116cd22` (semantic search), `c41daef` (live API tests), `36042d2` (session notes)

## What Was Just Completed (Session 94)

**Issue tracker triage + final backlog closure:**

- **ISSUE-073**: Closed in CSV (git worktree cleanup done Session 88 / fd00c00)
- **ISSUE-237**: Closed in CSV (test quality anti-patterns fixed Session 41 / d189c18)
- **ISSUE-240**: Closed with documented decision — MCP 2025-11-25 is the long-term compatibility boundary; upgrade will be a deliberate breaking-change release when Anthropic ships a newer stable spec
- **GAP-1 verified**: core.create (`elicitSpreadsheetCreation`) and transaction.begin (inline elicitation) are BOTH already wired — plan's "confirmed gap" was already resolved before this branch
- **Plan audit**: All 4 wiring gaps done; all P1-P3 benchmark fixes verified as already-implemented; all AQUI-VR v3.2 findings (54) are Done or Waived at 100% / A+
- **Committed**: `docs/research/REAL_WORLD_WORKFLOWS.md` and `docs/testing/MASTER_TEST_PLAN.md` (research + planning artifacts from prior sessions)
- **88 undescribed CSV issues**: From earlier audit waves; no descriptions or actionable content — not workable without reconstruction effort
- **Status**: No open actionable backlog remains. TASKS.md P18 complete. AQUI-VR 100%. 2731 tests pass.

**Commits this session**: c844313 (issue tracker closures)

## What Was Just Completed (Session 93)

**Wiring gap closure + benchmark fix verification (full plan from Session 92 executed):**

- **GAP-2 ✅**: ACTION_HINT_OVERRIDES added for 7 previously uncovered tools (sheets_analyze, sheets_fix, sheets_confirm, sheets_quality, sheets_transaction, sheets_templates, sheets_agent) — all 25 tools now have LLM tool discovery hints
- **GAP-3 ✅**: CoT hints (`_hints`) extended to 7 more action types: sheets_format.suggest_format, sheets_history.diff_revisions + timeline, sheets_visualize.chart_create, sheets_quality.validate, sheets_collaborate.share_add, sheets_fix.suggest_cleaning — now 13 action types total
- **GAP-4 ✅**: Non-critical Google Sheets API reachability preflight check added (skipped when no credentials configured; warns on network failure)
- **BUG-1 ✅**: `preserveDataValidation?: boolean` on `write` action — uses batchUpdate/updateCells with `fields=userEnteredValue` to preserve existing data validation rules (default path still uses values.update)
- **BUG-2 ✅**: `set_number_format` surfaces spreadsheet locale + timezone in response when format type is DATE/TIME/DATE_TIME — informational, non-blocking
- **Phase 3 ✅**: Verified all 35 P1-P3 benchmark fixes — every action referenced already exists (execute_pipeline in sheets_session, execute_plan in sheets_analyze, detect_spill_ranges in sheets_data, etc.). Plan was usage guidance, not missing features. Updated tool hints to embed P0 patterns (UNFORMATTED_VALUE for reads, context-in-plan, observe-before-execute)

**Commits**: dbf76a5, 7d2bb54, e4504ec, 6c268bd, c438208

## What Was Just Completed (Session 92)

**AQUI-VR remaining findings — all 20 open findings closed or waived:**

**Status corrections (already fixed in code, framework updated):**

- **M-4**: ✅ Done — `descriptions-minimal.ts:8` already references `schema://tools/{toolName}`
- **M-10**: ✅ Done — `HandlerContext.server` is typed as `HandlerMcpServer` (not raw `Server`)
- **M-17**: ✅ Done — no "402" found in `tests/live-api/` (updated in prior session)
- **M-23**: ✅ Done — all 3 companion servers already at `^1.27.1`
- **L-14**: ✅ Done — `constants.ts:72` already has "informational only" comment

**Waived (design intent or ops scope):**

- M-6 ⚪, M-11 ⚪, M-12 ⚪, M-13 ⚪, M-14 ⚪, M-15 ⚪, M-16 ⚪, L-10 ⚪, L-17 ⚪

**Code fixes:**

- **M-20**: `src/config/constants.ts` — replaced `.includes('http-server')` substring match with `path.basename()` exact match for DEFER_SCHEMAS detection

**Documentation:**

- **L-11**: `README.md` — added "Transport Security Model (RBAC)" section clarifying RBAC applies to HTTP only; STDIO trusts local process

**New tests (17/17 pass):**

- **L-8**: `tests/contracts/zod-compat.test.ts` — 4 tests verifying `zodToJsonSchemaCompat()` output is plain JSON Schema (no Zod internals, JSON-serializable)
- **L-9**: `tests/compliance/timeout-keepalive.test.ts` — added interval contract test; total 13 tests

**Additional closures (continuation):**

- **M-7**: ✅ Done — `RedisTaskStore` already at `src/core/task-store.ts:439`; `createTaskStore()` auto-selects Redis when `REDIS_URL` is set; production warning logged when using in-memory
- **M-2**: ✅ Done — `assertSamplingConsent()` called before LLM data transmission (line 683 in sampling.ts); ordering is correct
- All 12 audit gates pass (G1–G12 green, 84s)

**Framework update:** `AQUI-VR_v3.2_Framework.md` scoring updated to 100% → A+. Only M-8 (manual MCP inspector check) and L-6/L-12 (ongoing monitors) remain non-closed.

## What Was Just Completed (Session 91)

**AQUI-VR_v3.2_Framework.md created**: Living audit framework with 54-finding registry, G13–G25 gates, tier-based remediation plan, weighted scoring model.

**Findings resolved this session:**

- **G25/M-19**: `check:drift` macOS hang — `perl -e 'alarm N; exec @ARGV'` cross-platform timeout added to both sub-commands in `scripts/check-metadata-drift.sh`
- **H-7**: MutationVerifier strict mode — already wired (`mutation-verifier.ts:73` + `env.ts:379`); status corrected
- **M-5**: SSE deprecation `logger.warn()` added to `http-server.ts` when `ENABLE_LEGACY_SSE=true`
- **M-18**: `tools/test-intelligence-server/test-intelligence.db` added to `.gitignore`; untracked via `git rm --cached`
- **M-21**: `generate-state.mjs` now reads from `src/constants/protocol.ts` — Protocol shows `2025-11-25` not `unknown`
- **M-1**: `tests/integration/staged-registration-notifications.test.ts` (10 tests) — staged registration + list_changed notification coverage
- **M-22**: G3 architecture + G12 dead-code gates — all 12 audit gates now pass:
  - G3 fix 1: `agent-engine.ts` no longer imports from `mcp/registration/tool-definitions.ts` — replaced with `registerToolInputSchemas()` setter pattern
  - G3 fix 2: `cache-manager.ts` local `RequestMerger` interface breaks observability circular dependency
  - G12 fix: `audit-middleware.ts` added to `PUBLIC_API_FILES` (documented factory, tested, not auto-wired)
- **L-1/L-2/L-3/L-5**: All gitignored already — marked ⚪ Waived
- **L-7**: `tests/contracts/auth-exempt-actions.test.ts` (4 tests) — AUTH_EXEMPT_ACTIONS contract coverage
- **L-13**: `IMPLEMENTATION_GUARDRAILS.md` bumped v1.6.0 → v1.7.0
- **L-15**: Step 5b (write-lock parity) added to CLAUDE.md "Adding a New Action" checklist
- **L-16**: TOOL_ACTIONS and MUTATION_ACTIONS rows added to CLAUDE.md Source of Truth table

**New test files:**

- `tests/contracts/completions-cross-map.test.ts` (27 tests — G17)
- `tests/integration/staged-registration-notifications.test.ts` (10 tests — M-1)
- `tests/contracts/auth-exempt-actions.test.ts` (4 tests — L-7)

**New gate scripts:**

- `scripts/aquivr-check-doc-counts.mjs` (G15 — doc count validation)

## What Was Just Completed (Session 90)

**Production-ready release commit** (`255b15e`): `Prepare production-ready 1.7.0 release`

- `npm run verify:release` passed end-to-end, including HTTP smoke, HTTP task-contract, build, metadata generation, startup, and service verification
- Last production blocker fixed in `src/security/tool-hash-registry.ts`: transport-dependent tool integrity checks no longer fail under HTTP mode
- Regression coverage added in `tests/startup/tool-hash-registry.test.ts`
- Release set staged, validated, and committed as a clean production handoff point

**Analyze understanding follow-up** (`ad76899`): `Finish analyze understanding follow-up wiring`

- `query_natural_language` now consumes understanding-store context and semantic workbook hints:
  - `src/handlers/analyze-actions/query-natural-language.ts`
  - `src/analysis/conversational-helpers.ts`
- `scout` now routes elicitation answers back into the understanding store when the MCP client supports elicitation:
  - `src/handlers/analyze-actions/scout.ts`
- `comprehensive` now builds and persists a semantic index into the understanding store:
  - `src/handlers/analyze.ts`
  - `src/services/understanding-store.ts`
- Regression coverage added:
  - `tests/handlers/analyze-query-natural-language.test.ts`
  - `tests/handlers/analyze-scout-followup.test.ts`
  - `tests/handlers/analyze-followup-wiring.test.ts`
- Verification passed: `npx tsc -p tsconfig.json --noEmit --pretty false` + targeted analyze suites

**Branch state after Session 90**: branch head `255b15e` → `ad76899`. Working tree clean after this note commit.

## What Was Just Completed (Session 89)

**5-phase sequential enhancement plan — all phases complete:**

1. **Phase 1: Tier 2 ACTION_HINT_OVERRIDES** (`src/mcp/registration/tool-discovery-hints.ts`): Added override entries for 8 additional tools. Total tool coverage: 18+ tools.
2. **Phase 2: Fix sampling-enhancements test failure** (`tests/handlers/sampling-enhancements.test.ts`): Root cause — incomplete `vi.mock()` for `request-context.js`. Added `recordRequestLlmProvenance`, `getRequestLlmProvenance`, `getRequestAbortSignal` to mock factory. Result: 11/11 tests pass.
3. **Phase 3: Server instructions optimization** (`src/mcp/features-2025-11-25.ts`): Merged 4 redundant error recovery sections into 1, compressed examples to table format. ~22% size reduction.
4. **Phase 4: Completions expansion** (`src/mcp/completions.ts`): Added `connectorIdCache`, `serverNameCache`, `BUILTIN_CONNECTOR_IDS`, `recordConnectorId()`, `completeConnectorId()`, `recordServerName()`, `completeServerName()`. Wired into connectors and federation handlers.
5. **Phase 5: Compiled output verification**: All changes confirmed in `dist/` via `tsc -p tsconfig.build.json`.

**Build note**: Must use `tsc -p tsconfig.build.json` or `npm run build` for production builds — base tsconfig has `noEmit: true`.

## What Was Just Completed (Session 88)

**Audit remediation plan (8 steps) fully implemented:**

1. **`z.discriminatedUnion` / `.passthrough()` schema fixes** (`src/schemas/dependencies.ts`, `fix.ts`)
2. **`DataProfile` index signature** (`src/services/cleaning-engine.ts`): `[x: string]: unknown` for type compatibility
3. **`fixableVia` on ELICITATION_UNAVAILABLE** (`src/handlers/confirm.ts`)
4. **Error self-correction protocol** (`src/mcp/features-2025-11-25.ts`): 5-step protocol added to server instructions
5. **Spreadsheet context injection into `aiParsePlan`** (`src/services/agent-engine.ts`)
6. **`aiValidateStepResult()` implemented** (`src/services/agent-engine.ts`): Reflexion-style validation after each step. Tests: `tests/services/agent-engine-selfeval.test.ts` (5/5 pass)
7. **`_meta.aiMode` in responses** (`src/mcp/registration/response-intelligence.ts`, `tool-response.ts`): `aiMode: 'sampling' | 'heuristic' | 'cached'` injected into `_meta`
8. **`startOAuthCredentialsServer()`** (`src/utils/api-key-server.ts`, `src/handlers/connectors.ts`): Replaced MUST NOT-violating form-mode with localhost URL-mode server (MCP 2025-11-25 compliance)

**Working tree commit** (`fd00c00`): 45 files, 1870 insertions. Resolved 5 TypeScript errors, fixed ESLint issues, annotated silent fallback returns.

**ISSUE-073 resolved**: All stale git worktrees removed. 15 stale branches deleted.

## What Was Just Completed (Session 87)

**Comprehensive 8-category codebase re-audit** — parallel agents across all 25 tools. Score: A (excellent).

**6 schema/service hardening fixes** (committed `e2a55a4`):

1. **Federation superRefine** (`src/schemas/federation.ts`): Per-action required field validation
2. **Agent maxSteps cap** (`src/schemas/agent.ts`): `.max(50)` prevents DoS
3. **Core update_sheet newTitle deprecated** (`src/schemas/core.ts`)
4. **share_add schema validation** (`src/schemas/collaborate.ts`): emailAddress/domain required + format-validated
5. **DuckDB LIMIT safety** (`src/services/duckdb-engine.ts`): Queries without LIMIT get 10,000-row cap
6. **Dimensions descriptions** (`src/schemas/dimensions.ts`)

**Live MCP server probe** (`scripts/live-probe.mjs`): Spawned STDIO server with service account credentials:

- Phase 1: Protocol features — 9/9 pass (tools/list=25, resources=68, prompts=48, completions, logging)
- Phase 2: All 25 tool dispatch — 24/25 pass (1 timeout: preview_generation needs LLM API)
- Phase 3: Schema validation error paths — 6/7 pass (1 timeout: share_add elicitation wait)
- Phase 4: Multi-action spot checks — 18/21 pass (3 timeouts: LLM/network/elicitation)
- **Result: 57/60 pass — all 3 failures are network/LLM timeouts in sandboxed environment**

## What Was Just Completed (Session 86)

**Task #10 — Conditional webhook filtering**: `enrichInputSchema()` hides Redis-required actions when Redis is absent.
**Task #11 — share_add pre-flight validation**: `validateShareAddInput()` runs before `driveRateLimiter.acquire()`.
**Task #15 — MCP 2025-11-25 elicitation compliance**: Removed `elicitApiKeyViaForm()` fallback (MUST NOT violation).

## Genuine Remaining Work

1. **Error typing**: ~100 generic throws remain in src/services/ (google-api.ts, analysis/) — handlers already clean
2. **P18-D1–D10**: Handler decomposition — file-size budget system in place; actual decomposition deferred
3. ~~**16-F1–F6**: Formula evaluation engine~~ — **COMPLETE** ✅ `src/services/formula-evaluator.ts` (582 lines, HyperFormula v3.2.0) + `src/services/apps-script-evaluator.ts` (166 lines).
4. **ISSUE-073**: Git worktree cleanup (maintainer-only)
5. **ISSUE-075**: npm publish @serval/core v0.2.0 (maintainer-only)
6. **Sampling**: Add `ANTHROPIC_API_KEY` to claude_desktop_config.json env block (manual — user must add own key)

## Verified False Claims (do not re-investigate)

- **G-1**: revision-timeline no pagination — FALSE. `revision-timeline.ts:119-140` paginates with 50-page cap.
- **G-2**: collaborate/versions no pagination — FALSE. `versions.ts:390-399` paginates with 100-page cap.
- **G-4**: Apps Script bypasses `wrapGoogleApi` retry — FALSE. `appsscript.ts:365` wraps with `executeWithRetry()`.
- **G-6**: core.list no pagination — FALSE. `core-actions/spreadsheet-read.ts:182-261` has cursor-based pagination.
- **NEW-1 (agent self-eval gap)**: RESOLVED. `executePlan()` calls `aiValidateStepResult()` after each step. Tests: `tests/services/agent-engine-selfeval.test.ts`.
- **NEW-2 (connector discover SSRF)**: RESOLVED. `connectors.ts:278` validates `req.endpoint` against `discovery.endpoints`.
- **connector manager unbounded maps** — FALSE. `cappedMapSet` used at tenant-context.ts:214,302,360,381,429.
- **OAuth redirect URI hardcoded** — FALSE. `oauth-config.ts:26` reads `OAUTH_REDIRECT_URI` from env.

## Key Decisions Made

- **Option D continuity**: auto-generated state.md + manual session-notes.md (no custom infrastructure)
- **Safety rail order**: `createSnapshotIfNeeded()` BEFORE `confirmDestructiveAction()` (snapshot must exist before user approves)
- **P18-X5 N/A**: SDK `ServerCapabilities` type doesn't include `progress` field — not fixable without SDK change; `sendProgress()` already works per-request
- **16-F1–F6 COMPLETE** (2026-03-15): `formula-evaluator.ts` (582 lines, HyperFormula v3.2.0) + `apps-script-evaluator.ts` (166 lines). Wired into scenario modeling actions.
- **Minimal change policy**: ≤3 src/ files per fix unless tests require more; no refactors while debugging

## Architecture Quick Reference

- Full handler map, service inventory, anti-patterns: `docs/development/CODEBASE_CONTEXT.md`
- Feature specs (F1–F6): `docs/development/FEATURE_PLAN.md`
- Current metrics (tools/actions/tests): `src/schemas/action-counts.ts` + `.serval/state.md`
- TASKS.md: open backlog (P2 phase-2 progress coverage tranche E, ISSUE-073, ISSUE-075)

## Session History (recent)

| Date       | Session | Summary                                                                                                                             |
| ---------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 2026-03-18 | 90      | Production-ready 1.7.0 release commit; analyze understanding follow-up wiring (query_natural_language, scout, comprehensive)        |
| 2026-03-17 | 89      | Tier 2 ACTION_HINT_OVERRIDES; sampling-enhancements test fix; server instructions -22%; completions expansion; dist verification    |
| 2026-03-16 | 88      | 8-step audit remediation; aiValidateStepResult; \_meta.aiMode; OAuth localhost server; ISSUE-073 resolved                           |
| 2026-03-15 | 87      | 8-category re-audit (A grade); 6 schema fixes; live MCP probe 57/60 pass                                                            |
| 2026-03-15 | 86      | Conditional webhook filtering; share_add pre-flight; elicitation MUST NOT fix; Tasks 9/12/13/14/16/17/18 verified                   |
| 2026-03-15 | 85      | Round 2 description fixes (C2/H5/H6/M1/Task7/8/13); federation ACTION_HINT_OVERRIDES; Task 12 MCP schema audit                      |
| 2026-03-15 | 84      | Usability audit: tool-discovery-hints.ts (NEW); BuiltinValidationRuleSchema; appsscript scriptId; defer-schema fixes                |
| 2026-03-15 | 83      | Google Cloud Monitoring 90-min window: QuotaCircuitBreaker; Retry-After alignment; spreadsheet existence pre-caching; Fix A+B wired |
| 2026-03-15 | 82      | Cache O(1) size tracking; CoT \_hints layer (response-hints-engine.ts, 17 tests); stash cleanup                                     |
| 2026-03-15 | 81      | Type safety sprint (53 typed errors, 11 files); tranche E regression tests; action-recommender 5 new rules                          |
| 2026-03-15 | 80      | LLM Intelligence Phases 1-3 (\_meta.apiCallsMade, performance tiers, batching hints); codebase enhancements A/C/D                   |
| 2026-03-15 | 79      | Dead code removal (42 noUnusedLocals); typed error sprint (89 throws); ESLint fix; 2654/2654 tests                                  |
| 2026-03-14 | 78      | Systematic test repair: 63 failing → 0; 14+ test files; hardcoded timestamps, WebhookManager, resource registration                 |
| 2026-03-14 | 77      | S3-A quick_insights + S3-B auto_fill (TDD); 2646/2646 tests; 402 actions                                                            |
| 2026-03-14 | 76      | Re-audit remediation: webhook DNS fail-closed; servalsheets init CLI; plan encryption; per-spreadsheet throttle                     |
| 2026-03-13 | 75      | MCP 2025-11-25 elicitation compliance: ElicitationServer interface fix, OAuth flow wiring, form-mode removal, api-key-server.ts     |
| 2026-03-11 | 58      | LLM Intelligence full plan (Sprints 1-4): quality scanner, action recommender, agent auto-retry, formula library, build_dashboard   |
| 2026-03-03 | 55      | MCP/API fixes (6); VERIFIED_FIX_PLAN (9 fixes); 2452/2452 tests, G0–G5 green                                                        |
| 2026-03-03 | 54      | Project audit execution: fixed 5 stale doc counts, created sync-doc-counts.mjs, historical-doc notes                                |
| 2026-03-03 | 53      | P2 phase-2 progress coverage tranches A–D + sampling-consent hardening; 272/272 tests                                               |
| 2026-03-02 | 52      | P18 verification sprint — all items closed or N/A                                                                                   |
| 2026-03-02 | 51      | P16 backlog verification, 5 prompt registrations added, state.md updated                                                            |
| 2026-03-01 | 50      | Advanced integrations: DuckDB/Pyodide/Drive Activity/Workspace Events/Scheduler/SERVAL Formula (+14 actions, 377→391)               |
| 2026-02-28 | 49      | P16 LLM usability, elicitation wiring (core.create + collaborate.share_add)                                                         |
| 2026-02-28 | 47-48   | G0–G5 gates green, connectors.ts fix, LLM UX polish (annotations, aliases)                                                          |
| 2026-02-27 | 46      | sheets_connectors metadata + full wiring verification (10 actions)                                                                  |
| 2026-02-25 | 41      | ISSUE-226/234/237 fixes; 24 issues verified already fixed                                                                           |
| 2026-02-24 | 39      | Remediation Phase 1: 9 tests fixed, security fixes, gate pipeline restored                                                          |
| 2026-02-23 | 35-38   | P6 API fixes, P7–P15 implementation (cache, safety rails, MCP wiring, 5 composite actions)                                          |
| 2026-02-23 | 24-34   | P4 features: F4 Suggestions, F3 Cleaning, F1 Generator, F5 Time-Travel, F6 Scenarios, F2 Federation                                 |
| 2026-02-22 | 18-23   | P2 feature flags, P3 backends (Excel/Notion/Airtable), P4 feature plan                                                              |
| 2026-02-21 | 13-17   | P0 serval-core migration, P1 DX polish (ESLint fix, drift check, silent FPs)                                                        |
| 2026-02-20 | 8-12    | Audit infrastructure (fixtures, coverage, gates, drift, agents)                                                                     |
