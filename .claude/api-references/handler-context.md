# HandlerContext API Reference

**File:** `src/handlers/base.ts`
**Interface:** `HandlerContext`

## Quick Reference

```typescript
import type { HandlerContext } from '../handlers/base.js';

// HandlerContext is passed to all handlers
async function myHandler(input: MyInput, context: HandlerContext) {
  // Access Google Sheets API
  const sheetsApi = context.googleClient?.sheets;

  // Use batching system
  await context.batchingSystem?.addToBatch(operation);

  // Resolve ranges
  const resolved = await context.rangeResolver.resolve(range);

  // Create snapshots for undo
  const snapshot = await context.snapshotService?.createSnapshot(spreadsheetId);
}
```

## Core Properties

### `googleClient?: GoogleApiClient | null`

**Type:** `GoogleApiClient` (from `google-api.ts`)
**Optional:** Yes
**Description:** Authenticated Google API client with auto-retry and circuit breakers

**Access:**

```typescript
if (!context.googleClient) {
  throw new Error('Authentication required');
}

const sheetsApi = context.googleClient.sheets;
const driveApi = context.googleClient.drive;
const bigqueryApi = context.googleClient.bigquery;
```

**Properties:**

- `sheets: sheets_v4.Sheets` - Google Sheets API v4
- `drive: drive_v3.Drive` - Google Drive API v3
- `bigquery?: bigquery_v2.Bigquery` - BigQuery API v2
- `hasElevatedAccess: boolean` - Whether user granted full access
- `scopes: string[]` - Granted OAuth scopes

### `batchCompiler: BatchCompiler`

**Type:** `BatchCompiler`
**Required:** Yes
**Description:** Compiles operations into optimized batch requests

**Usage:**

```typescript
const batch = context.batchCompiler.compile({
  operations: [...],
  spreadsheetId: 'abc123'
});

const results = await batch.execute();
```

### `rangeResolver: RangeResolver`

**Type:** `RangeResolver`
**Required:** Yes
**Description:** Resolves A1 notation to grid coordinates

**Usage:**

```typescript
const resolved = await context.rangeResolver.resolve({
  spreadsheetId: 'abc123',
  range: 'Sheet1!A1:B10',
});

console.log(resolved.sheetId); // number
console.log(resolved.startRow); // 0
console.log(resolved.endRow); // 10
```

## Performance Optimization Services

### `batchingSystem?: BatchingSystem`

**Optional:** Yes
**Description:** Time-window batching for reducing API calls

**Usage:**

```typescript
const batchId = await context.batchingSystem?.addToBatch({
  type: 'read',
  spreadsheetId: 'abc123',
  range: 'Sheet1!A1:B10',
});

// Operations are automatically flushed after 100ms or 100 operations
```

### `cachedSheetsApi?: CachedSheetsApi`

**Optional:** Yes
**Description:** ETag-based caching for reads (30-50% API savings)

**Usage:**

```typescript
const response = await context.cachedSheetsApi?.get({
  spreadsheetId: 'abc123',
  range: 'Sheet1!A1:B10',
});

// Subsequent calls return cached data if spreadsheet hasn't changed
```

### `requestMerger?: RequestMerger`

**Optional:** Yes
**Description:** Merges overlapping read requests (20-40% API savings)

**Usage:**

```typescript
// Multiple concurrent requests for overlapping ranges are merged
const [result1, result2] = await Promise.all([
  context.requestMerger?.read({ spreadsheetId, range: 'A1:B10' }),
  context.requestMerger?.read({ spreadsheetId, range: 'A5:B15' }),
]);
// Only 1 API call made for A1:B15
```

### `prefetchPredictor?: PrefetchPredictor`

**Optional:** Yes
**Description:** Predictive prefetching (200-500ms latency reduction)

**Usage:**

```typescript
// Automatically prefetches likely next ranges based on access patterns
await context.prefetchPredictor?.recordAccess({
  spreadsheetId,
  range: 'Sheet1!A1:A10',
});

// Next access to nearby range is instant from cache
```

### `parallelExecutor?: ParallelExecutor`

**Optional:** Yes
**Description:** Parallel batch execution (40% faster batch ops)

**Usage:**

```typescript
const results = await context.parallelExecutor?.executeBatch(operations);
```

## Snapshot & History

### `snapshotService?: SnapshotService`

**Optional:** Yes
**Description:** Create snapshots for undo/revert operations

**Usage:**

```typescript
// Create snapshot before modification
const snapshot = await context.snapshotService?.createSnapshot({
  spreadsheetId: 'abc123',
  description: 'Before bulk update',
});

// Later: revert to snapshot
await context.snapshotService?.restoreSnapshot(snapshot.id);
```

## Authentication

### `auth?: { hasElevatedAccess: boolean; scopes: string[] }`

**Optional:** Yes
**Description:** User's authentication status and granted scopes

**Usage:**

```typescript
if (!context.auth?.hasElevatedAccess) {
  throw new Error('This operation requires elevated access');
}

if (!context.auth.scopes.includes('https://www.googleapis.com/auth/drive')) {
  throw new Error('Drive access required');
}
```

## MCP-Specific

### `server?: Server`

**Optional:** Yes
**Description:** MCP Server instance for elicitation/sampling (SEP-1036, SEP-1577)

**Usage:**

```typescript
// For elicitation (user confirmation)
const confirmed = await context.server?.request({
  method: 'sampling/createMessage',
  params: { ... }
});
```

### `samplingServer?: SamplingServer`

**Optional:** Yes
**Description:** Legacy sampling server reference

## Utilities

### `requestDeduplicator?: RequestDeduplicator`

**Optional:** Yes
**Description:** Prevents duplicate in-flight requests

**Usage:**

```typescript
const result = await context.requestDeduplicator?.deduplicate(
  'key:spreadsheetId:range',
  async () => await fetchData()
);

// Concurrent requests with same key share single execution
```

### `circuitBreaker?: CircuitBreaker`

**Optional:** Yes
**Description:** Circuit breaker for this specific handler

**Usage:**

```typescript
const stats = context.circuitBreaker?.getStats();
if (stats?.state === 'open') {
  throw new Error('Service temporarily unavailable');
}
```

## Creating HandlerContext

### Pattern 1: From HTTP Request

```typescript
async function createHandlerContext(authToken: string): Promise<HandlerContext> {
  const googleClient = await createGoogleApiClient({
    accessToken: authToken,
    refreshToken: undefined,
  });

  const snapshotService = new SnapshotService({ driveApi: googleClient.drive });

  const { initializePerformanceOptimizations } = await import('./startup/performance-init.js');
  const {
    batchingSystem,
    cachedSheetsApi,
    requestMerger,
    parallelExecutor,
    prefetchPredictor,
    accessPatternTracker,
    queryOptimizer,
  } = await initializePerformanceOptimizations(googleClient.sheets);

  return {
    batchCompiler: new BatchCompiler({
      rateLimiter: new RateLimiter(),
      diffEngine: new DiffEngine({ sheetsApi: googleClient.sheets }),
      policyEnforcer: new PolicyEnforcer(),
      snapshotService,
      sheetsApi: googleClient.sheets,
      onProgress: async (event) => {
        logger.debug('Operation progress', event);
      },
    }),
    rangeResolver: new RangeResolver({ sheetsApi: googleClient.sheets }),
    googleClient,
    batchingSystem,
    cachedSheetsApi,
    requestMerger,
    parallelExecutor,
    prefetchPredictor,
    accessPatternTracker,
    queryOptimizer,
    snapshotService,
    auth: {
      get hasElevatedAccess() {
        return googleClient?.hasElevatedAccess ?? false;
      },
      get scopes() {
        return googleClient?.scopes ?? [];
      },
    },
    requestDeduplicator,
  };
}
```

### Pattern 2: Minimal Context (Testing)

```typescript
const mockContext: HandlerContext = {
  batchCompiler: mockBatchCompiler,
  rangeResolver: mockRangeResolver,
  googleClient: {
    sheets: mockSheetsApi,
    drive: mockDriveApi,
    hasElevatedAccess: true,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  },
  // All other properties optional
};
```

## Common Patterns

### Safe GoogleClient Access

```typescript
const googleClient = context.googleClient;
if (!googleClient) {
  throw new GraphQLError('Authentication required', {
    extensions: { code: 'UNAUTHENTICATED' },
  });
}

const sheetsApi = googleClient.sheets;
// Now safe to use
```

### Check Performance Services

```typescript
// Gracefully degrade if optional services not available
const data = context.cachedSheetsApi
  ? await context.cachedSheetsApi.get(params)
  : await context.googleClient.sheets.spreadsheets.values.get(params);
```

### Record Access Patterns

```typescript
// Record for prefetch prediction
await context.prefetchPredictor?.recordAccess({
  spreadsheetId,
  range,
  timestamp: Date.now(),
});
```

## Performance Notes

- HandlerContext is created once per request
- Performance services are opt-in (optional)
- GoogleApiClient is auto-instrumented with retry + circuit breakers
- All async operations use connection pooling

## Related

- `src/handlers/base.ts` - BaseHandler with HandlerContext usage
- `src/services/google-api.ts` - GoogleApiClient implementation
- `src/startup/performance-init.ts` - Performance services initialization
