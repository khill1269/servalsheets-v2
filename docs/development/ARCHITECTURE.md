---
title: ServalSheets Architecture Reference
category: development
last_updated: 2026-03-10
description: 'Detailed architecture documentation moved from CLAUDE.md.'
version: 1.6.0
tags: [sheets, prometheus]
---

# ServalSheets Architecture Reference

> Detailed architecture documentation moved from CLAUDE.md.
> For rules and workflow, see the project root `CLAUDE.md`.
> For live state, see `.serval/state.md`.

## Entrypoints (3 transport modes)

| File                           | Lines | Transport           | Usage                         |
| ------------------------------ | ----- | ------------------- | ----------------------------- |
| `src/cli.ts` → `src/server.ts` | 1400  | STDIO               | Claude Desktop, CLI (default) |
| `src/http-server.ts`           | 2809  | HTTP/SSE/Streamable | Cloud deployment, connectors  |
| `src/remote-server.ts`         | 11    | HTTP + OAuth 2.1    | Multi-tenant remote access    |

## Request Flow Checkpoints (Execution Tracing)

When modifying handlers or debugging, verify these 4 layers:

### Layer 1: Input Validation (3 stages)

```
src/mcp/registration/tool-handlers.ts:81-118
├─ normalizeToolArgs() - Legacy envelope unwrapping
│  Converts { request: { action, ...params } } → { action, ...params }
├─ src/schemas/fast-validators.ts - Pre-Zod validation (0.1ms)
│  Fast fail on invalid spreadsheetId format, missing required fields
└─ Handler Zod schema - Full validation via parseWithCache()
   Strict schema validation with detailed error messages
```

Why 3 stages? Performance optimization — reject invalid requests in 0.1ms before expensive Zod parsing.

### Layer 2: Handler Execution

```
src/handlers/{tool-name}.ts:executeAction()
├─ Extract discriminated union action
│  const { action, ...params } = unwrapRequest(request);
├─ Switch statement dispatches to action handler
│  switch (action) { case 'read_range': return this.handleReadRange(params); }
└─ Returns structured response (NOT MCP format yet)
   { response: { success: true, data: {...} } }
```

All 25 tools follow this exact structure.

### Layer 3: Response Building

```
src/mcp/registration/tool-handlers.ts:500+
├─ buildToolResponse() - Converts to MCP CallToolResult format
│  Adds { content: [...], structuredContent: {...}, isError: false }
├─ Output validation (ADVISORY, not blocking)
│  Logs warnings if response doesn't match output schema
└─ Returns MCP-compliant response
   { content: [{ type: 'text', text: 'Success' }], ... }
```

**Critical:** Handlers NEVER call `buildToolResponse()` — only the tool layer does this.

### Layer 4: Service Layer (Auto-instrumented)

```
src/services/google-api.ts
├─ wrapGoogleApi() - Proxy pattern wraps all Google API calls
│  Automatically applied to sheets, drive, bigquery clients
├─ Auto-retry (3x exponential backoff + jitter)
│  Retries on 429 (rate limit), 500, 502, 503, 504
├─ Circuit breaker per endpoint
│  Opens after 5 failures, half-opens after 30s
└─ HTTP/2 connection pooling + metrics
   Prometheus metrics for latency, errors, circuit breaker state
```

All handlers extend `BaseHandler` which provides instrumented `this.context.googleClient`.

### Example Complete Trace

```
Client: sheets_data tool with action=read_range
  ↓
server.ts:428 → handleToolCall('sheets_data', args)
  ↓
tool-handlers.ts:85 → createToolCallHandler()
  ↓
tool-handlers.ts:102 → normalizeToolArgs(args)
  → Unwraps { request: { action: 'read_range', ... } }
  ↓
tool-handlers.ts:115 → parseWithCache(schema, normalizedArgs)
  → Zod validates input against sheets_data schema
  ↓
handlers/data.ts:34 → executeAction(validatedInput)
  ↓
handlers/data.ts:48 → switch (action) → handleReadRange(params)
  ↓
handlers/data.ts:156 → this.context.googleClient.sheets.spreadsheets.values.get(...)
  → wrapGoogleApi() intercepts call
  → Auto-retry logic + circuit breaker check
  → HTTP/2 request to Google Sheets API
  ↓
handlers/data.ts:170 → return { response: { success: true, data: values } }
  ↓
tool-handlers.ts:520 → buildToolResponse(result)
  → Converts to MCP format
  → Output validation (advisory)
  ↓
server.ts:435 → Returns CallToolResult to client
```

## Directory Structure

```
src/
├── cli.ts                    # CLI entry + auth setup wizard
├── server.ts                 # STDIO MCP server
├── http-server.ts            # HTTP MCP server + middleware chain
├── remote-server.ts          # OAuth wrapper over http-server
├── schemas/                  # Zod schemas (SOURCE OF TRUTH for actions)
│   ├── index.ts              # Re-exports + TOOL_COUNT/ACTION_COUNT constants
│   ├── annotations.ts        # Per-tool + per-action annotations
│   ├── descriptions.ts       # LLM-optimized tool descriptions
│   ├── fast-validators.ts    # Pre-Zod fast validation (0.1ms)
│   ├── auth.ts ... deps.ts   # 22 per-tool schema files
│   └── handler-deviations.ts # Documented schema-handler aliases
├── handlers/                 # Business logic (1 per tool)
│   ├── base.ts               # BaseHandler (circuit breaker, instrumented API)
│   ├── helpers/              # Shared helpers
│   ├── auth.ts ... deps.ts   # 25 handler files
│   └── index.ts              # Handler factory + registry
├── mcp/                      # MCP protocol layer
│   ├── registration/         # Tool definitions, handlers, schema helpers
│   ├── completions.ts        # TOOL_ACTIONS map for autocomplete
│   └── features-2025-11-25.ts
├── services/                 # Infrastructure (google-api, transaction, rate-limiter, etc.)
├── middleware/                # HTTP middleware (redaction)
├── utils/                    # Shared utilities (retry, circuit-breaker, errors, etc.)
├── knowledge/                # AI knowledge base (40 files)
├── config/                   # Environment + OAuth scope config
├── analysis/                 # AI analysis helpers (14 files)
├── startup/                  # Lifecycle/preflight/restart (5 files)
├── security/                 # Webhook signatures, resource indicators (4 files)
├── storage/                  # Session manager + store (3 files)
├── graphql/                  # GraphQL API (4 files)
├── admin/                    # Admin dashboard (2 files)
├── di/                       # Dependency injection (1 file)
├── adapters/                 # Backend adapters for serval-core
├── observability/            # Prometheus metrics
├── resources/                # MCP resources + temporary storage
└── core/                     # Core types + errors
```

### Test Structure

```
tests/
├── contracts/     # Schema guarantee tests (MUST always pass)
├── security/      # Redaction, input sanitization, resource indicators
├── handlers/      # Handler unit tests (per-tool)
├── schemas/       # Schema validation tests
├── utils/         # Utility function tests
├── services/      # Service integration tests
├── unit/          # Pure unit tests
├── compliance/    # MCP protocol compliance tests
├── property/      # Property-based (fuzz) tests
├── safety/        # Safety rail tests
├── benchmarks/    # Performance benchmarks
├── live-api/      # Real Google API tests (requires TEST_REAL_API=true)
├── audit/         # Coverage, performance, memory leak tests
└── snapshots/     # Response snapshot tests
```

## Handler Architecture

### BaseHandler vs Standalone

**13 handlers extend BaseHandler** (circuit breakers, `this.success()`, instrumented API):
advanced, analyze, appsscript, bigquery, collaborate, composite, core, data, dimensions, fix, format, templates, visualize

**9 handlers are standalone** (NO circuit breakers, different response patterns):
auth, confirm, dependencies, federation, history, quality, session, transaction, webhooks

### Full Handler Lifecycle

```typescript
// 1. Public entry point is handle() — NOT executeAction()
async handle(input: TInput): Promise<TOutput> {
  const req = unwrapRequest<TInput['request']>(input);
  this.setVerbosity(req.verbosity ?? 'standard');
  return this.executeAction(req);
}

// 2. Private dispatcher
private async executeAction(request: DataRequest): Promise<DataResponse> {
  switch (request.action) {
    case 'read': return this.handleRead(request);
    default: throw new ValidationError(`Unknown action: ${request.action}`);
  }
}

// 3. Per-action handlers
private async handleRead(input: DataReadInput): Promise<DataResponse> {
  try {
    const req = this.inferRequestParameters(input);
    return this.success('read', { values, range }, mutation);
  } catch (error) {
    return { response: this.mapError(error) };
  }
}
```

### Handler Response Patterns

```typescript
// BaseHandler success (13 handlers):
return this.success('action_name', data, optionalMutation);

// Standalone handler success (9 handlers):
return { response: { success: true, action: 'action_name', ...data } };

// Error path (both):
return { response: this.mapError(error) };
```

## Reliability Infrastructure

| Feature                              | File                                                       | Default             |
| ------------------------------------ | ---------------------------------------------------------- | ------------------- |
| Auto-retry (3x, exponential backoff) | `src/services/google-api.ts` via `wrapGoogleApi()`         | ON                  |
| Circuit breaker (per-client)         | `src/services/google-api.ts` via `wrapGoogleApi()`         | ON                  |
| Request deduplication                | `src/utils/request-deduplication.ts`                       | ON                  |
| Read merging (overlapping ranges)    | `src/services/request-merger.ts`                           | ON                  |
| Output schema validation             | `src/mcp/registration/tool-handlers.ts`                    | ON (advisory)       |
| Response redaction (tokens/keys)     | `src/middleware/redaction.ts`                              | ON in production    |
| Per-user rate limiting               | `src/http-server.ts` + `src/services/user-rate-limiter.ts` | ON (requires Redis) |
| HTTP/2 connection pooling            | `src/services/google-api.ts`                               | ON                  |
| Proactive token refresh              | `src/services/token-manager.ts`                            | ON                  |

## Key Configuration Files

| File                      | Purpose                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `server.json`             | MCP registry metadata + AI instructions (sent to all clients) |
| `package.json`            | Dependencies, scripts, version                                |
| `tsconfig.json`           | TypeScript strict mode config                                 |
| `tsconfig.build.json`     | Build-specific TS config                                      |
| `eslint.config.js`        | ESLint flat config                                            |
| `vitest.config.ts`        | Test runner config                                            |
| `.dependency-cruiser.cjs` | Architecture rule enforcement                                 |

## Metadata Generation

The `scripts/generate-metadata.ts` script automatically updates these files:

**Input (Source of Truth):** `src/schemas/*.ts` — individual tool schemas

**Output (Generated — DO NOT edit manually):**
`package.json`, `src/schemas/index.ts`, `src/schemas/annotations.ts`, `src/mcp/completions.ts`, `server.json`

```bash
npm run gen:metadata     # After modifying any schema file
npm run check:drift      # Verify no drift
npm run schema:commit    # All-in-one: regenerate + verify + test + stage
```

## Server Consolidation (2026-01-14)

The HTTP and OAuth servers were consolidated into a single implementation:

- `src/server.ts` — STDIO transport
- `src/http-server.ts` — HTTP/SSE with optional OAuth support
- `src/remote-server.ts` — Thin wrapper (calls http-server with OAuth enabled)

```typescript
createHttpServer({ port: 3000 });                          // Standard HTTP
createHttpServer({ port: 3000, enableOAuth: true, ... });  // OAuth mode
startRemoteServer({ port: 3000 });                         // Backward compat
```

## Safe Rollback Strategy

```bash
# Phase branches (recommended)
git checkout -b phase-0-foundation
git restore --source=HEAD~3 -- src/handlers/data.ts  # Per-file rollback
git restore --source=<commit-hash> -- <file>          # From specific commit

# ❌ NEVER use workspace-wide destructive commands:
# git checkout -- .  |  git reset --hard HEAD  |  git clean -fd
```

## Deleted Files (Do Not Reference)

| File                               | Deleted    | Reason                     |
| ---------------------------------- | ---------- | -------------------------- |
| `src/mcp/sdk-compat.ts`            | 2026-01-11 | Schema flattening complete |
| `src/server-v2.ts`                 | 2026-01-14 | V2 architecture abandoned  |
| `src/server-compat.ts`             | 2026-01-14 | V2 architecture abandoned  |
| `src/migration-v1-to-v2.ts`        | 2026-01-14 | V2 architecture abandoned  |
| `src/schemas-v2/`, `handlers-v2/`  | 2026-01-14 | V2 architecture abandoned  |
| `src/services/snapshot-service.ts` | 2026-01-14 | Unused V2 service          |
