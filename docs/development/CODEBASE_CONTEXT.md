---
title: ServalSheets - Complete Codebase Context
category: development
last_updated: 2026-03-22
description: Persistent reference for coding sessions across tools, MCP compliance, API patterns, and architecture decisions.
version: 1.7.0
tags: [sheets, architecture, mcp]
---

# ServalSheets — Complete Codebase Context

> Persistent reference for coding sessions. Covers all 25 tools (407 actions), MCP compliance,
> Google API patterns, anti-patterns, and architecture decisions.
> Updated: 2026-03-22.

## Quick Reference

| Metric               | Value                          | Source                       |
| -------------------- | ------------------------------ | ---------------------------- |
| Tools                | 25                             | src/schemas/action-counts.ts |
| Actions              | 404                            | src/schemas/action-counts.ts |
| Version              | 1.7.0                          | package.json                 |
| MCP Protocol         | 2025-11-25                     | src/version.ts:14            |
| Contract Tests       | 2742/2742 pass                 | npm run test:fast            |
| Handler Architecture | 13 BaseHandler + 12 Standalone | src/handlers/                |

---

## Handler Architecture

### BaseHandler Subclasses (13 tools, unchanged)

These extend `BaseHandler<Input, Output>` and get: intent batching, snapshot support,
verbosity filtering, scope validation, progress reporting, error mapping.

<!-- BEGIN_GENERATED:handler-table-base -->
| Tool               | Handler Class           | File                                 | Actions | Key Service                        |
| ------------------ | ----------------------- | ------------------------------------ | ------- | ---------------------------------- |
| sheets_core        | SheetsCoreHandler       | handlers/core.ts (775 lines)         | 21      | Google Sheets + Drive API          |
| sheets_data        | SheetsDataHandler       | handlers/data.ts (366 lines)         | 25      | CachedSheetsApi, ParallelExecutor  |
| sheets_format      | SheetsFormatHandler     | handlers/format.ts (894 lines)       | 25      | BatchCompiler (intent system)      |
| sheets_dimensions  | SheetsDimensionsHandler | handlers/dimensions.ts (2147 lines)  | 30      | BatchCompiler                      |
| sheets_advanced    | AdvancedHandler         | handlers/advanced.ts (393 lines)     | 31      | BatchCompiler                      |
| sheets_visualize   | VisualizeHandler        | handlers/visualize.ts (335 lines)    | 18      | Sampling (chart suggestions)       |
| sheets_collaborate | CollaborateHandler      | handlers/collaborate.ts (652 lines)  | 41      | Drive API (sharing)                |
| sheets_composite   | CompositeHandler        | handlers/composite.ts (995 lines)    | 21      | CompositeOperationsService         |
| sheets_analyze     | AnalyzeHandler          | handlers/analyze.ts (1283 lines)     | 26      | Sampling, BackgroundAnalyzer       |
| sheets_fix         | FixHandler              | handlers/fix.ts (1253 lines)         | 6       | CleaningEngine, quality validators |
| sheets_templates   | SheetsTemplatesHandler  | handlers/templates.ts (803 lines)    | 8       | Drive appDataFolder                |
| sheets_bigquery    | SheetsBigQueryHandler   | handlers/bigquery.ts (1965 lines)    | 17      | BigQuery API, circuit breaker      |
| sheets_appsscript  | SheetsAppsScriptHandler | handlers/appsscript.ts (1665 lines)  | 19      | Apps Script API, circuit breaker   |
<!-- END_GENERATED:handler-table-base -->

### Standalone Handlers (12 tools)

These implement `handle()` directly without BaseHandler. They manage their own error
handling, verbosity filtering, and service access.

<!-- BEGIN_GENERATED:handler-table-standalone -->
| Tool                | Handler Class/Function                 | File                                 | Actions | Key Service                                        |
| ------------------- | -------------------------------------- | ------------------------------------ | ------- | -------------------------------------------------- |
| sheets_auth         | AuthHandler                            | handlers/auth.ts (1605 lines)        | 5       | EncryptedFileTokenStore                          |
| sheets_confirm      | ConfirmHandler                         | handlers/confirm.ts (475 lines)      | 5       | ElicitationServer, WizardSessions                |
| sheets_dependencies | DependenciesHandler                    | handlers/dependencies.ts (1162 lines) | 10      | ImpactAnalyzer (cached), ScenarioEngine          |
| sheets_quality      | QualityHandler                         | handlers/quality.ts (666 lines)      | 4       | ValidationEngine, ConflictDetector               |
| sheets_history      | HistoryHandler                         | handlers/history.ts (796 lines)      | 10      | HistoryService, SnapshotService, TimeTravelService |
| sheets_session      | SessionHandler + handleSheetsSession() | handlers/session.ts (956 lines)      | 31      | SessionContextManager                            |
| sheets_transaction  | TransactionHandler                     | handlers/transaction.ts (401 lines)  | 6       | TransactionManager                               |
| sheets_federation   | FederationHandler                      | handlers/federation.ts (409 lines)   | 4       | FederatedMcpClient                               |
| sheets_webhook      | WebhookHandler                         | handlers/webhooks.ts (670 lines)     | 10      | WebhookManager, Redis                            |
| sheets_agent        | AgentHandler                           | handlers/agent.ts (380 lines)        | 8       | AgentEngine (plan/execute/rollback)              |
| sheets_compute      | ComputeHandler                         | handlers/compute.ts (1765 lines)     | 16      | ComputeEngine (stats, regression, forecast)      |
| sheets_connectors   | ConnectorsHandler                      | handlers/connectors.ts (871 lines)   | 10      | ConnectorManager (external API connector registry) |
<!-- END_GENERATED:handler-table-standalone -->

---

## Request Pipeline (every tool call)

```
Client → MCP Request (STDIO/HTTP/Streamable HTTP)
  → src/server.ts:handleToolCall()
    → src/mcp/registration/tool-handlers.ts:createToolCallHandler()
      → normalizeToolArgs() [envelope wrapping: { request: { action, ... } }]
      → Zod validation (parseWithCache, 90% cache hit)
      → handler.handle(validatedInput) or handler.executeAction()
        → Action switch dispatch → private handler method
        → Google API call (via google-api.ts with retry + circuit breaker)
      → buildToolResponse() → validateOutputSchema() (advisory)
    → MCP CallToolResult
```

### Key Functions in Pipeline

| Function                | File:Line                | Purpose                                        |
| ----------------------- | ------------------------ | ---------------------------------------------- |
| normalizeToolArgs()     | tool-handlers.ts:85-124  | Wraps legacy args in { request: {} } envelope  |
| parseWithCache()        | utils/schema-cache.ts    | Cached Zod validation (5-10ms vs 50ms)         |
| createToolCallHandler() | tool-handlers.ts:276-494 | Maps tool name → handler instance              |
| buildToolResponse()     | tool-handlers.ts:598+    | Converts handler response → MCP CallToolResult |
| validateOutputSchema()  | tool-handlers.ts:547-596 | Advisory output validation (non-blocking)      |

---

## All 404 Actions by Tool

> Full action-by-action list moved to `docs/development/ACTION_REGISTRY.md` to reduce session context load.
> Load that file when verifying action names or adding new actions.

---

## MCP Protocol Features (2025-11-25)

| Feature                | Status | Key File                                  | Notes                                    |
| ---------------------- | ------ | ----------------------------------------- | ---------------------------------------- |
| STDIO Transport        | ✅     | server.ts                                 | McpServer + StdioServerTransport         |
| HTTP/SSE Transport     | ✅     | http-server.ts                            | Express + SSEServerTransport             |
| Streamable HTTP        | ✅     | mcp/event-store.ts                        | InMemoryEventStore, cursor-based replay  |
| Tool Registration      | ✅     | server.ts:400-456                         | 25 tools, discriminated union schemas    |
| Resources              | ✅     | mcp/registration/resource-registration.ts | 2 URI templates + knowledge resources    |
| Prompts                | ✅     | mcp/registration/prompt-registration.ts   | 38 guided workflows                      |
| Sampling (SEP-1577)    | ✅     | mcp/sampling.ts (960 lines)               | AI analysis, formula gen, chart suggest  |
| Elicitation (SEP-1036) | ✅     | mcp/elicitation.ts (759 lines)            | 5 form schemas + URL flows + wizards     |
| Tasks (SEP-1686)       | ✅     | core/task-store-adapter.ts                | 9 tools support task augmentation        |
| Logging                | ✅     | handlers/logging.ts                       | Dynamic log level via MCP request        |
| Progress               | ⚠️     | server.ts:294-299                         | Logged but not streamed as notifications |
| Completions            | ✅     | mcp/completions.ts                        | spreadsheetId + range autocompletion     |
| Icons (SEP-973)        | ✅     | mcp/features-2025-11-25.ts:76-231         | SVG icons for 25/25 tools                |
| Server Instructions    | ✅     | mcp/features-2025-11-25.ts                | LLM context for tool usage               |

### Sampling Usage Patterns

```typescript
// In handlers that use Sampling:
if (this.context.samplingServer) {
  const result = await analyzeData(this.context.samplingServer, data, prompt);
}
// Functions: analyzeData(), generateFormula(), recommendChart(), explainFormula(),
// identifyDataIssues(), analyzeDataStreaming(), streamAgenticOperation()
```

### Elicitation Usage Patterns

```typescript
// In BaseHandler subclasses:
await this.confirmDestructiveAction({
  description: 'Delete sheet "Sales"',
  impact: '500 rows will be permanently removed',
});
// Auto-skipped if client doesn't support elicitation
```

### Task-Capable Tools

`sheets_analyze`, `sheets_data`, `sheets_format`, `sheets_dimensions`, `sheets_visualize`,
`sheets_composite`, `sheets_appsscript`, `sheets_bigquery`, `sheets_federation`

---

## MCP Protocol Wiring (P13 Additions)

### Tasks (SEP-1686) — Transport-Level Background Execution

Use MCP `tasks/call` for background tracking on task-enabled tools:

| Action                                                                      | Tool              | Why                                         |
| --------------------------------------------------------------------------- | ----------------- | ------------------------------------------- |
| `export_to_bigquery`                                                        | sheets_bigquery   | Async export, can take minutes              |
| `import_from_bigquery`                                                      | sheets_bigquery   | Async import, large datasets                |
| `run`                                                                       | sheets_appsscript | Script execution, arbitrary duration        |
| `export_large_dataset`                                                      | sheets_composite  | Streaming export, multiple API calls        |
| `timeline`                                                                  | sheets_history    | Drive API revision scan, multiple revisions |
| `call_remote` + `list_servers` + `get_server_tools` + `validate_connection` | sheets_federation | Remote MCP calls, network latency           |

Task IDs are emitted by the MCP transport during `tasks/call`, not by ordinary `tools/call`
responses.

### Session Context Wiring — 10 Handler Actions

Actions that read/write `SessionContextManager` for LLM continuity:

| Action             | Tool              | Session Use                                               |
| ------------------ | ----------------- | --------------------------------------------------------- |
| `read`             | sheets_data       | Records last read range for "that range" references       |
| `cross_read`       | sheets_data       | Records all source spreadsheets for natural language refs |
| `suggest_format`   | sheets_format     | Records current sheet context for follow-up suggestions   |
| `clean`            | sheets_fix        | Records cleaned range for subsequent undo/re-run          |
| `suggest_cleaning` | sheets_fix        | Records analysis context for "apply the suggestions" refs |
| `hide`             | sheets_dimensions | Records hidden rows/cols for "show it again" refs         |
| `freeze`           | sheets_dimensions | Records freeze state for undo context                     |
| `sort_range`       | sheets_dimensions | Records sort params for "sort the other way" refs         |
| `chart_create`     | sheets_visualize  | Records chart ID for "update that chart" refs             |
| `timeline`         | sheets_history    | Records revision scope for "show me more" follow-ups      |

### Sampling Additions (SEP-1577) — 5 High-Value Actions

Actions upgraded with AI analysis via MCP Sampling:

| Action           | Tool                | Sampling Use                                                   |
| ---------------- | ------------------- | -------------------------------------------------------------- |
| `find_replace`   | sheets_data         | Dry-run estimate: AI predicts replacements before committing   |
| `suggest_format` | sheets_format       | AI rationale: explains why each format suggestion applies      |
| `model_scenario` | sheets_dependencies | AI narrative: plain-language explanation of impact cascade     |
| `diff_revisions` | sheets_history      | AI explanation: summarizes what changed and likely cause       |
| `comment_add`    | sheets_collaborate  | AI suggested reply: proposes a contextual reply to the comment |

### Elicitation Wizards (SEP-1036) — 4 Complex Actions

Actions with interactive wizard flows when key params are absent:

| Action                        | Tool               | Wizard                                                                                   |
| ----------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| `chart_create`                | sheets_visualize   | 2-step: chart type (all ChartTypeSchema options) → chart title                           |
| `add_conditional_format_rule` | sheets_format      | 1-step: rule preset (highlight_duplicates, color_scale, data_bars, top_10_percent, etc.) |
| `create`                      | sheets_core        | 1-step: spreadsheet title (defaults to "Untitled Spreadsheet")                           |
| `begin`                       | sheets_transaction | 1-step: transaction description for audit trail                                          |

All wizards are non-blocking (try/catch) and degrade gracefully when client doesn't support elicitation.

---

## Google API Patterns

### Retry Strategy (src/utils/retry.ts)

```
Config: maxRetries=3, baseDelay=100ms, maxDelay=32s, jitter=0.1
Retryable: 429, 5xx, ECONNRESET, ETIMEDOUT, userRateLimitExceeded (403)
NOT retryable: insufficientPermissions (403), invalid request (400)
Deadline check: Skips retry if backoff > remaining deadline
```

### Circuit Breaker (src/utils/circuit-breaker.ts)

```
Per-API breakers: Sheets, Drive, BigQuery, Docs, Slides
Failure threshold: 5 (BigQuery/AppsScript: 3)
Reset timeout: 30s
Fallback: readOnlyMode (Sheets-specific)
```

### Caching (src/services/cached-sheets-api.ts)

```
Layer 1: ETag conditional requests (If-None-Match → 304 Not Modified)
Layer 2: Local LRU cache (5-min TTL)
Invalidation: Dependency graph tracks mutation cascades
Result: 80-100x API call reduction for repeat reads
```

### Field Masks (ENABLE_AGGRESSIVE_FIELD_MASKS=true)

```
Metadata: 'spreadsheetId,properties(title,locale,timeZone)' → 95% reduction
Sheet list: 'spreadsheetId,sheets(properties(title,sheetId,...))' → 80% reduction
Auto-injected by getFieldMask() in validation-helpers.ts
```

### Batching (src/services/batching-system.ts)

```
Max batch: 100 operations per batchUpdate
Adaptive window: 20-200ms (scales with traffic)
Global coordination: ConcurrencyCoordinator prevents quota exhaustion
API savings: Tracked per-batch (operations/apiCalls ratio)
```

### Request Merging (ENABLE_REQUEST_MERGING=true)

```
Overlap detection: A1 range parsing → bounding box merge
Example: A1:C10 + B5:D15 → A1:D15 (1 call instead of 2)
Collection window: 50ms
Savings: 20-40% for overlapping read patterns
```

### Parallel Execution (ENABLE_PARALLEL_EXECUTOR=true)

```
Threshold: 100+ ranges triggers parallel mode
Concurrency: 20 requests (configurable, max 100)
Per-task retry: 3 attempts with exponential backoff
40% faster for batch reads above threshold
```

---

## Anti-Patterns (NEVER DO)

1. **Full column refs**: ❌ `Sheet1!A:Z` → ✅ `Sheet1!A1:Z100` (triggers full grid fetch)
2. **Missing field masks**: ❌ Bare `spreadsheets.get()` → ✅ Always pass `fields` param
3. **Unbounded batches**: ❌ 1000 ops in one call → ✅ Chunk at 100 per batchUpdate
4. **Direct API without retry**: ❌ Raw `sheets.spreadsheets.get()` → ✅ `executeWithRetry()`
5. **Retrying permission errors**: ❌ Retry on 403 `insufficientPermissions` → ✅ Only `userRateLimitExceeded`
6. **Concurrent token refreshes**: ❌ Multiple `refreshToken()` → ✅ PQueue concurrency=1
7. **Ignoring circuit breaker**: ❌ Hammering open circuit → ✅ Check state, use fallback
8. **Missing deadline checks**: ❌ Retry past deadline → ✅ Check deadline before backoff
9. **Hardcoded timeouts**: ❌ `Promise.timeout(30000)` → ✅ `getRequestContext().timeoutMs`
10. **Silent fallbacks**: ❌ `return {}` → ✅ Always log + throw typed error

---

## Safety Rail Pattern (all destructive ops)

```
1. confirmDestructiveAction()  → MCP Elicitation (SEP-1036)
   ↓ (user approves)
2. createSnapshotIfNeeded()    → Backup for rollback
   ↓
3. Google API mutation call    → With retry + circuit breaker
   ↓
4. Return success response     → Track in history service
```

**Destructive action count**: ~36 across 25 tools
**Confirmation count**: ~25 handlers use confirmDestructiveAction()
**Snapshot count**: ~20 handlers call createSnapshotIfNeeded()

---

## Key Services

| Service                    | File                             | Lines | Purpose                                                    |
| -------------------------- | -------------------------------- | ----- | ---------------------------------------------------------- |
| GoogleApiClient            | services/google-api.ts           | ~53K  | Core API with retry, circuit breaker, HTTP/2               |
| CachedSheetsApi            | services/cached-sheets-api.ts    | ~15K  | ETag cache layer                                           |
| BatchCompiler              | services/batching-system.ts      | ~31K  | Intent → batchUpdate compilation                           |
| ParallelExecutor           | services/parallel-executor.ts    | ~12K  | Concurrent range fetching                                  |
| RequestMerger              | services/request-merger.ts       | ~3K   | Overlapping range merge                                    |
| CompositeOperationsService | services/composite-operations.ts | ~27K  | CSV/XLSX import, dedup, smart append                       |
| CleaningEngine             | services/cleaning-engine.ts      | ~600  | 10 cleaning rules, 16 format converters, 3 anomaly methods |
| SheetGeneratorService      | services/sheet-generator.ts      | ~594  | AI-powered sheet generation, 4 fallback templates          |
| CrossSpreadsheetService    | services/cross-spreadsheet.ts    | ~290  | Cross-spreadsheet read/query/write/compare                 |
| HistoryService             | services/history-service.ts      | ~18K  | Operation tracking, undo                                   |
| ConflictDetector           | services/conflict-detector.ts    | ~26K  | Concurrent modification detection                          |
| ImpactAnalyzer (services)  | services/impact-analyzer.ts      | ~40K  | Dependency-aware impact prediction                         |
| FederatedMcpClient         | services/federated-mcp-client.ts | ~12K  | Remote MCP server calls                                    |
| SessionContextManager      | services/session-context.ts      | -     | Active spreadsheet, preferences                            |
| TransactionManager         | services/transaction-manager.ts  | -     | Atomic multi-op transactions                               |
| WebhookManager             | services/webhook-manager.ts      | -     | Event notifications (Redis-backed)                         |
| SnapshotService            | services/snapshot-service.ts     | -     | Backup/restore for undo                                    |

---

## Analysis Engine (src/analysis/)

| Module                 | Lines | Purpose                               |
| ---------------------- | ----- | ------------------------------------- |
| comprehensive.ts       | ~67K  | Full analysis (43 feature categories) |
| confidence-scorer.ts   | ~31K  | Analysis result quality scoring       |
| flow-orchestrator.ts   | ~30K  | Multi-step analysis pipelines         |
| structure-helpers.ts   | ~26K  | Sheet structure analysis              |
| tiered-retrieval.ts    | ~26K  | 4-level smart data loading            |
| formula-helpers.ts     | ~24K  | Formula parsing, validation           |
| planner.ts             | ~20K  | Analysis execution planning           |
| action-generator.ts    | ~19K  | Findings → executable params          |
| elicitation-engine.ts  | ~18K  | Sampling server integration           |
| understanding-store.ts | ~17K  | Analysis result cache                 |
| scout.ts               | ~17K  | Quick preliminary scan                |
| formula-parser.ts      | ~14K  | Google Sheets formula AST             |
| router.ts              | ~13K  | Fast vs AI path routing               |
| dependency-graph.ts    | ~13K  | Formula dependency graph              |
| impact-analyzer.ts     | ~12K  | Recalculation impact analysis         |
| streaming.ts           | ~6K   | Streaming export support              |

---

## Adapter Layer (src/adapters/)

| Adapter             | File                     | Lines | Status                         |
| ------------------- | ------------------------ | ----- | ------------------------------ |
| GoogleSheetsBackend | google-sheets-backend.ts | 509   | ✅ Active (wired in server.ts) |
| ExcelOnlineBackend  | excel-online-backend.ts  | 607   | Scaffold (P3, Session 19)      |
| NotionBackend       | notion-backend.ts        | 924   | Scaffold (P3, Session 20)      |
| AirtableBackend     | airtable-backend.ts      | 924   | Scaffold (P3, Session 21)      |

All implement `SpreadsheetBackend` interface from `packages/serval-core/src/interfaces/backend.ts` (417 lines).
Interface validated across 4 platform types with zero modifications needed.

---

## Dead Code Findings

| Item                            | Status                       | Action                          |
| ------------------------------- | ---------------------------- | ------------------------------- |
| ENABLE_COST_TRACKING flag       | Checked in tool/server paths | Extend beyond API-call counters |
| src/handlers/optimization.ts    | Possible unused utilities    | Verify usage or remove          |
| Scaffold backends (3)           | Intentional P3 scaffolds     | Keep                            |
| 0 TODOs/FIXMEs in src/          | Clean                        | —                               |
| All 25 tools registered         | Verified                     | —                               |
| All middleware properly guarded | Verified                     | —                               |

---

## Test Infrastructure

```bash
npm run test:fast        # Unit + contract (2253/2253)
npm run verify:safe      # Typecheck + test + drift (skip lint if OOM)
npm run verify           # Full (typecheck + lint + test + drift)
npm run schema:commit    # After ANY schema change (regenerates metadata)
npm run gates            # G0-G5 validation gates
npm run audit:full       # Coverage + perf + memory + gate + snapshot
```

### Test Envelope Format

Tests must use `{ request: { action: 'read', ... } }` not `{ action: 'read', ... }`.
See `normalizeToolArgs()` in tool-handlers.ts:85-124.

---

## Adding New Actions (Checklist)

1. Schema: Add to discriminated union in `src/schemas/{tool}.ts`
2. Handler: Add case to switch + private `handle{Action}()` method
3. Test: Success + error paths in `tests/handlers/{tool}.test.ts`
4. Run: `npm run schema:commit` (regenerates metadata, updates counts)
5. Verify: `npm run verify:safe`

### New Service Pattern

```typescript
// src/services/{name}.ts
export class MyService {
  constructor(private cachedApi: CachedSheetsApi, ...) {}
  async doThing(): Promise<Result> {
    return executeWithRetry(() => this.cachedApi.someMethod());
  }
}
```

### Handler Method Pattern (BaseHandler)

```typescript
private async handleMyAction(req: MyActionInput): Promise<MyOutput> {
  // 1. Validate (Zod already ran, but check business rules)
  // 2. Confirm if destructive: await this.confirmDestructiveAction(...)
  // 3. Snapshot if destructive: await this.createSnapshotIfNeeded(...)
  // 4. Execute: const result = await this.context.cachedApi.method(...)
  // 5. Return: return this.success('my_action', { data: result }, isMutation);
}
```

### Handler Method Pattern (Standalone)

```typescript
case 'my_action': {
  const result = await this.handleMyAction(req);
  return { response: { success: true, action: 'my_action', ...result } };
}
```

---

## Response Patterns

```typescript
// BaseHandler (13 handlers):
return this.success('action_name', data, isMutation);
// → { response: { success: true, action, ...data } }

// Standalone (9 handlers):
return { response: { success: true, action: 'action_name', ...data } };

// Error (both):
return { response: { success: false, error: { code, message, details } } };
// BaseHandler: return { response: this.mapError(error) };
```

---

## Import Ordering Convention

```typescript
// 1. Google APIs / external packages
// 2. Internal domain (BaseHandler, interfaces)
// 3. Core types (@serval/core)
// 4. Config (env.ts, constants)
// 5. Services (google-api, cached-sheets-api, etc.)
// 6. Utils (retry, circuit-breaker, etc.)
// 7. Schemas / types (Zod schemas, input/output types)
// 8. MCP layer (sampling, elicitation, etc.)
```

---

## Historical Feature Milestones (P4-P14)

Full specs: `docs/development/FEATURE_PLAN.md`

### P4 Features (315 → 335 actions)

| Feature                       | Tool                | New Actions | Key New File                         |
| ----------------------------- | ------------------- | ----------- | ------------------------------------ |
| F4: Smart Suggestions ✅      | sheets_analyze      | +2          | analysis/suggestion-engine.ts        |
| F3: Data Cleaning ✅          | sheets_fix          | +5          | services/cleaning-engine.ts          |
| F1: Sheet Generator ✅        | sheets_composite    | +3          | services/sheet-generator.ts          |
| F5: Time-Travel Debugger ✅   | sheets_history      | +3          | (inline in handlers/history.ts)      |
| F6: Scenario Modeling ✅      | sheets_dependencies | +3          | (inline in handlers/dependencies.ts) |
| F2: Cross-Sheet Federation ✅ | sheets_data         | +4          | services/cross-spreadsheet.ts        |

### P7-P9 Bug Fixes

- Cache invalidation rule names corrected (sheets_fix.fix, +20 P4 rules, slicer → dimensions)
- Safety rails (snapshot + confirmation) added to history.undo/redo/revert_to
- Safety rails added to 8 dimensions destructive actions
- analyze_performance unbounded fetch fixed (added maxSheets param)

### P10-P11 Type Safety

- 21 `as any` casts fixed across core.ts, session.ts, appsscript.ts, quality.ts
- SESSION_ERROR added to ErrorCode enum (was missing)
- `src/handlers/helpers/error-mapping.ts` — new standalone helper
- `src/handlers/helpers/verbosity-filter.ts` — extracted shared verbosity filter
- Switch default cases use `never` exhaustiveness checks in 13 handlers

### P12 Schema Quality

- Pagination added to list_data_validations, list_filter_views, cross_read
- ChartTypeSchema enum added to chartType fields
- A1NotationSchema added to cell fields
- Missing Google API params: textRotation, padding, spreadsheetTheme, filterCriteria, foregroundColorStyle, backgroundColorStyle
- superRefine validation: GetActionSchema requires `ranges` when includeGridData:true

### P13 MCP Feature Wiring

- Tasks (SEP-1686): transport-level `tasks/call` on task-enabled tools
- Session Context: 10 handler actions
- Sampling (SEP-1577): 5 high-value actions
- Elicitation wizards (SEP-1036): 4 complex actions

### P14 New Composite Actions (335 → 340 actions)

- audit_sheet, publish_report, data_pipeline, instantiate_template, migrate_spreadsheet

Historical total through P14: 315 → 340 actions (before P15+ additions).
