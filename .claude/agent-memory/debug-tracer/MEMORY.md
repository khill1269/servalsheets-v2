# Debug Tracer Agent Memory

## Key Architecture Facts (Verified by Code Reading)

### Two Tool-Call Entry Paths
1. **MCP SDK registration** (server.ts:462-507): `server.registerTool(name, config, cb)` — cb calls `this.handleToolCall(tool.name, args, extra)`
2. **tool-handlers.ts `createToolCallHandler`** (lines 893-1236): used in a secondary path in `tool-handlers.ts:1382`. The primary serving path is the `handleToolCall` method in `ServalSheetsServer` at `src/server.ts:650`.

### normalizeToolArgs (tool-handlers.ts:808-841)
- Called at: `tool-handlers.ts:1019` (secondary path) and NOT in the primary `handleToolCall` path in `server.ts`.
- In the `server.ts` primary path, `args` are passed raw to `handler(args, ...)` at `server.ts:855`
- The Zod schema parse happens inside `parseForHandler` → `parseWithCache` in `createToolHandlerMap` lambdas (tool-handlers.ts:219-220)
- `normalizeToolArgs` IS called on the `createToolCallHandler` secondary path at line 1019

### ZodError is NEVER a JSON-RPC Error
- `parseForHandler` throws `z.ZodError` (tool-handlers.ts:222-262)
- That propagates up to `server.ts:895 catch(error)` block
- Caught, then `buildToolResponse({ response: { success: false, error: { code: 'INTERNAL_ERROR' }}})` is returned (server.ts:913-922)
- EXCEPTION: If `toolName` is provided AND `TOOL_ACTIONS[toolName]` exists, `parseForHandler` throws an enhanced `ZodError` with better messages (lines 240-262)
- In both cases, the outer catch at server.ts:895 converts it to `{ code: 'INTERNAL_ERROR' }` which is then classified as `isError: true` in `buildToolResponse` (since INTERNAL_ERROR is not in NON_FATAL_TOOL_ERROR_CODES at lines 126-142)

### VALIDATION_ERROR is NON_FATAL (isError: undefined)
- `NON_FATAL_TOOL_ERROR_CODES` set (tool-handlers.ts:126-142) includes VALIDATION_ERROR, NOT_FOUND, INVALID_PARAMS, etc.
- buildToolResponse sets `isError = hasFailure && !treatAsNonFatal` (line 703)
- So `VALIDATION_ERROR` → `isError: undefined` (non-fatal for LLM retry)
- But ZodError from parseForHandler gets converted to `INTERNAL_ERROR` which IS fatal (isError: true)

### Transaction Rollback Is Broken by Design
- `restoreSnapshot()` at transaction-manager.ts:484 intentionally `throws new Error('Automatic in-place snapshot restoration is not supported')`
- This means auto-rollback on commit failure ALWAYS fails if `autoRollback=true`
- The `rollbackError` is appended to the error message but `rolledBack` is set to false
- Snapshot only captures metadata (sheet structure), NOT cell data (transaction-manager.ts:406-407)

### Circuit Breaker Defaults (env.ts:112-114)
- failureThreshold: 5 (not configurable at handler level)
- successThreshold: 2 (half-open needs 2 successes to close)
- timeout: 30000ms = 30 seconds (with up to 30% jitter: circuit-breaker.ts:204)

### Shutdown Disposal Order (server.ts:1155-1235)
1. requestQueue.onIdle() with 10s timeout (line 1155-1158)
2. rangeResolver.clearCache() (line 1164)
3. cacheManager.stopCleanupTask() (line 1168)
4. healthMonitor.stop() (line 1171)
5. cleanupAllResources() (line 1175) — LIFO registry
6. context.backend.dispose() (line 1192)
7. googleClient.destroy() (line 1198)
8. requestMerger.destroy() (line 1204)
9. batchingSystem.destroy() via dynamic import (line 1209-1213)
10. prefetchingSystem.destroy() via dynamic import (line 1217-1221)
11. taskStore.dispose() (line 1228)
12. Null out all references (lines 1231-1235)

### 401 Auth Error Recovery Path (wrapGoogleApi)
- Lives at google-api.ts:1510-1533 inside the Proxy's function wrapper
- onRetry callback checks `status === 401` → calls `client.refreshTokenOnAuthError()` (line 1528-1529)
- `refreshTokenOnAuthError()` delegates to `tokenManager.refreshTokenOnAuthError()` (google-api.ts:592-593)
- TokenManager has 5-second cooldown between refreshes (token-manager.ts:192)
- Then retry executes again via `executeWithRetry` with the new token already in the OAuth client

## Common Trap: Two Separate createToolCallHandler Functions
There are TWO separate `createToolCallHandler` functions:
- `src/server.ts` private method (class method, primary serving path)
- `src/mcp/registration/tool-handlers.ts` exported function (used for tool-handlers.ts registration path at line 1382)

The PRIMARY call path for STDIO serving is: SDK callback → `ServalSheetsServer.handleToolCall()` → `handler()` from `createToolHandlerMap`.
The `normalizeToolArgs` in tool-handlers.ts is used in the SECONDARY path only.
