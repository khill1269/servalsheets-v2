# Google API Architect -- Agent Memory

## Architecture Analysis (2026-02-25)

### Pipeline (Verified)
- server.ts:708 -> PQueue -> runWithRequestContext -> tool-handlers.ts:285 createToolHandlerMap -> handler.handle() -> buildToolResponse()
- Auth-exempt tools: sheets_session, sheets_confirm, sheets_history.{list,get,stats}
- Legacy envelope wrapping via wrapInputSchemaForLegacyRequest at tool-handlers.ts:91-128

### Critical: No executeWithRetry in Most Handlers
- Only 3/22 handlers use retry: auth.ts, appsscript.ts, dependencies.ts
- cross-spreadsheet.ts also uses it for fetchRangeGrid helper
- Raw .sheets/.drive clients have NO retry wrapping; CachedSheetsApi also lacks retry
- Transient 429/5xx propagate immediately as failures in 19 handlers

### Cache Invalidation Graph: Stale Keys
- File: src/services/cache-invalidation-graph.ts
- Many tool.action keys use OLD names that don't match handler switch cases
- sheets_auth: all 4 wrong (authorize/status/revoke/refresh vs status/login/callback/logout)
- sheets_collaborate: share/unshare vs share_add/share_remove
- sheets_confirm: confirm/preview/validate_input vs request/wizard_start/wizard_step
- Auto-backfill at lines 593-626 catches unmapped actions but loses fine-grained patterns

### Transaction Manager Limitations
- Single spreadsheet only (begin() takes one spreadsheetId)
- Snapshots metadata-only (includeGridData:false) -- NO value rollback
- No per-spreadsheet locking; isolationLevel is cosmetic
- WAL opt-in via TRANSACTION_WAL_DIR env var

### Session Context
- Singleton shared across HTTP clients (problem in multi-client HTTP mode)
- Good memory bounds: max 5 recent spreadsheets, 20 ops, 100 sheet names, 20 alerts
- Redis persistence via SESSION_STORE_TYPE=redis

### Federation
- AbortController at federated-mcp-client.ts:222 NOT wired to callTool() signal
- Only HTTP transport implemented (STDIO declared in schema but not coded)
- 5-minute response cache with JSON.stringify key

### P16 DAG Pipeline (execute_pipeline)
- Correct Kahn's topological sort with cycle detection
- READ steps parallelized; WRITE steps sequential within wave
- Lives on sheets_session, NOT sheets_composite
- No output forwarding between steps (params static)
- Naming collision: composite.data_pipeline vs session.execute_pipeline

### Adapter Layer
- GoogleSheetsBackend wired to context.backend but UNUSED by any handler
- Bypasses cache/merge/parallel layers -- would regress performance
- 3 scaffold backends (Excel, Notion, Airtable) pass per-file typecheck only

### HTTP Server
- Per-session McpServer creation is expensive (full perf stack per client)
- 16-layer security middleware in correct order
- Event store supports Redis for horizontal scaling

### BaseHandler vs Standalone Gap
- 13 BaseHandler subclasses get: field masks, progress, verbosity, scope validation, batching
- 9 standalone handlers miss these capabilities
- Cross-cutting concerns must be manually propagated

### Key Architectural Facts (from prior audit)
- google-api.ts: Singleton with per-API circuit breakers (Sheets, Drive, BigQuery, Docs, Slides)
- Circuit breaker: failureThreshold=5, successThreshold=2, timeout=30s
- Connection pooling: keepAlive=true, maxSockets=50, LIFO
- HTTP/2 enabled by default with GOAWAY detection
- Token refresh: PQueue concurrency=1
- Field masks: 81 get() calls, vast majority include fields
- Batch API: 156 batchGet/batchUpdate refs across 13 handlers
- includeGridData: all calls properly scoped after P8/P9 fixes
- OAuth: 3-tier scope system (MINIMAL, STANDARD, FULL_ACCESS)
- Quotas: 300/min project, 60/min user (read and write each)
