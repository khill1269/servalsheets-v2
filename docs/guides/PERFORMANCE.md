---
title: Performance Tuning Guide
category: guide
last_updated: 2026-02-03
description: This guide covers performance optimization strategies for ServalSheets in production environments, including distributed caching with Redis.
version: 1.6.0
tags: [performance, optimization, sheets, caching, redis, distributed-caching]
audience: user
difficulty: intermediate
---

# Performance Tuning Guide

This guide covers performance optimization strategies for ServalSheets in production environments.

## Table of Contents

- [Overview](#overview)
- [HTTP/2 Support](#http2-support)
- [Diff Tier Selection](#diff-tier-selection)
- [Batch Operations](#batch-operations)
- [Effect Scope Limits](#effect-scope-limits)
- [Rate Limiting](#rate-limiting)
- [Memory Management](#memory-management)
- [Caching Strategies](#caching-strategies)
- [Google API Quotas](#google-api-quotas)
- [Performance Benchmarks](#performance-benchmarks)
- [Optimization Checklist](#optimization-checklist)

---

## Overview

ServalSheets is designed for high performance with Google Sheets API v4. Key performance features:

- **Tiered Diff Engine**: METADATA → SAMPLE → FULL for optimal data fetching
- **Batch Operations**: Combine multiple operations into single API calls
- **Effect Scope Limits**: Prevent accidental large-scale operations
- **Token Bucket Rate Limiting**: Smart quota management
- **Streaming**: Memory-efficient processing of large datasets

### Performance Goals

| Operation         | Target  | Notes                |
| ----------------- | ------- | -------------------- |
| Read 1000 cells   | < 500ms | Single batch read    |
| Write 1000 cells  | < 1s    | Single batch write   |
| Format 1000 cells | < 800ms | Batch format request |
| Diff detection    | < 200ms | METADATA tier        |
| Full diff         | < 2s    | 10,000 cells         |

---

## HTTP/2 Support

ServalSheets automatically uses HTTP/2 for Google Sheets API requests, providing **5-15% latency reduction** compared to HTTP/1.1.

### What is HTTP/2?

HTTP/2 is a major revision of the HTTP protocol that provides:

- **Multiplexing**: Multiple requests over a single TCP connection
- **Header Compression**: Reduced overhead with HPACK compression
- **Binary Protocol**: More efficient parsing than text-based HTTP/1.1
- **Server Push**: Proactive resource delivery (if supported by server)
- **Stream Prioritization**: Better resource allocation

### Automatic HTTP/2 Negotiation

ServalSheets uses the googleapis library (v169.0.0+) with gaxios HTTP client, which automatically negotiates HTTP/2 via ALPN (Application-Layer Protocol Negotiation) when:

1. Node.js version >= 14.0.0 (with HTTP/2 support)
2. Google's servers support HTTP/2 (they do)
3. HTTP/2 is enabled in configuration (enabled by default)

### Performance Benefits

Expected improvements with HTTP/2 enabled:

| Operation Type      | Improvement   | Notes                               |
| ------------------- | ------------- | ----------------------------------- |
| Metadata fetches    | 10-15% faster | Reduced connection overhead         |
| Batch operations    | 5-10% faster  | Multiplexing benefit                |
| Sequential requests | 20-30% faster | Connection reuse                    |
| Concurrent requests | 15-25% faster | Multiplexing over single connection |

### Verification

Check that HTTP/2 is enabled in your logs:

```bash
# Start server in development mode
NODE_ENV=development npm start

# Look for log message:
# "HTTP/2 support: ENABLED"
# "Google API clients initialized" { http2Enabled: true, expectedLatencyReduction: "5-15%" }
```

### Configuration

#### Default Configuration (Recommended)

HTTP/2 is enabled by default. No configuration needed.

```typescript
// Automatically uses HTTP/2 if available
const client = new GoogleApiClient({
  credentials: { ... }
});
await client.initialize();
// HTTP/2 automatically negotiated via ALPN
```

#### Environment Variable

Disable HTTP/2 if needed (not recommended):

```bash
# Disable HTTP/2 (falls back to HTTP/1.1)
export GOOGLE_API_HTTP2_ENABLED=false

# Default: HTTP/2 enabled
# (no environment variable needed)
```

### Requirements

- **Node.js**: >= 14.0.0 (stable HTTP/2 support)
  - ServalSheets requires >= 20.0.0, so HTTP/2 is always available
- **googleapis**: >= 100.0.0 (gaxios with HTTP/2 support)
  - ServalSheets uses 169.0.0, so HTTP/2 is fully supported

### Technical Details

#### How It Works

1. **ALPN Negotiation**: During TLS handshake, client and server negotiate HTTP/2
2. **Automatic Fallback**: If server doesn't support HTTP/2, falls back to HTTP/1.1
3. **Connection Pooling**: Maintains persistent connections for reuse
4. **Multiplexing**: Multiple API requests share single TCP connection

#### Connection Reuse

HTTP/2 maintains persistent connections across requests:

```typescript
// With HTTP/2: All requests use single connection
await client.sheets.spreadsheets.get({ spreadsheetId: 'xxx' });      // Connection established
await client.sheets.spreadsheets.values.get({ ... });                // Reuses connection
await client.sheets.spreadsheets.values.batchGet({ ... });          // Reuses connection
// Result: 20-30% faster than HTTP/1.1 with connection overhead
```

#### Multiplexing Example

HTTP/2 allows concurrent requests over a single connection:

```typescript
// With HTTP/2: Concurrent requests multiplexed over single connection
await Promise.all([
  client.sheets.spreadsheets.get({ spreadsheetId: 'xxx' }),
  client.sheets.spreadsheets.values.get({ ... }),
  client.sheets.spreadsheets.values.batchGet({ ... }),
]);
// Result: ~15-25% faster than HTTP/1.1 with sequential connections
```

### Performance Testing

Run HTTP/2 benchmarks to verify performance improvements:

```bash
# Run HTTP/2 performance benchmarks (requires credentials)
RUN_BENCHMARKS=true npm test -- tests/benchmarks/http2-latency.test.ts

# Set test spreadsheet ID
export TEST_SPREADSHEET_ID=your-test-spreadsheet-id
export GOOGLE_CLIENT_ID=...
export GOOGLE_CLIENT_SECRET=...
export GOOGLE_ACCESS_TOKEN=...
```

Expected results:

- **Metadata fetch**: 10-15% faster than HTTP/1.1
- **Batch operations**: 5-10% faster
- **Connection reuse**: Subsequent calls 20-30% faster than first call

### Monitoring HTTP/2 Usage

Enable debug logging to monitor HTTP/2:

```bash
# Enable HTTP debugging
export NODE_ENV=development
export HTTP_DEBUG=true

# Start server and monitor logs
npm start

# Look for:
# "API request completed" { httpVersion: "HTTP/2", operation: "spreadsheets.get" }
```

### Troubleshooting

#### Issue: HTTP/2 not being used

**Symptom**: Logs show "HTTP/1.1" instead of "HTTP/2"

**Possible causes**:

1. HTTP/2 disabled via `GOOGLE_API_HTTP2_ENABLED=false`
2. Network proxy or firewall blocking HTTP/2
3. Server doesn't support HTTP/2 (unlikely with Google's servers)

**Solution**:

```bash
# Verify Node.js version (should be >= 14)
node --version

# Ensure HTTP/2 is not disabled
unset GOOGLE_API_HTTP2_ENABLED

# Check gaxios configuration
npm list googleapis
```

#### Issue: Performance not improved

**Symptom**: No noticeable latency improvement with HTTP/2

**Possible causes**:

1. Network latency dominates (slow connection)
2. Small number of requests (benefit is cumulative)
3. Server-side processing time dominates

**Solution**:

- HTTP/2 benefits are most noticeable with:
  - Multiple sequential requests (connection reuse)
  - Concurrent requests (multiplexing)
  - Low-latency networks (overhead reduction matters more)

### Best Practices

1. **Keep HTTP/2 Enabled**: Default configuration is optimal
2. **Use Batch Operations**: Combined with HTTP/2 for maximum performance
3. **Leverage Connection Reuse**: Sequential requests benefit from persistent connections
4. **Monitor Performance**: Track latency metrics to verify HTTP/2 benefits
5. **Test in Production**: Network characteristics affect HTTP/2 performance

### Compatibility

HTTP/2 is compatible with all ServalSheets features:

- ✅ All API operations (read, write, format, etc.)
- ✅ Batch operations
- ✅ Streaming
- ✅ Rate limiting
- ✅ Circuit breaker
- ✅ Retry logic
- ✅ Token refresh
- ✅ OAuth flow

### Further Reading

- [HTTP/2 Specification (RFC 7540)](https://tools.ietf.org/html/rfc7540)
- [Node.js HTTP/2 Documentation](https://nodejs.org/api/http2.html)
- [gaxios HTTP/2 Support](https://github.com/googleapis/gaxios)
- [Google API Performance Best Practices](https://developers.google.com/sheets/api/guides/performance)

---

## Diff Tier Selection

ServalSheets uses a **tiered diff engine** to optimize performance.

### Diff Tiers

```typescript
// From src/intents/operations/diff.ts
export enum DiffTier {
  METADATA = 'METADATA', // Fastest: Only metadata (100ms)
  SAMPLE = 'SAMPLE', // Medium: First 100 rows (500ms)
  FULL = 'FULL', // Slowest: All data (2-10s)
}
```

### When to Use Each Tier

#### METADATA (Fastest)

**Use when**: You only need to know IF data changed, not WHAT changed

**Detects**:

- Sheet additions/deletions
- Sheet renames
- Row/column count changes
- Grid size changes

**Performance**: ~100ms for any spreadsheet size

**Example**:

```typescript
// Check if spreadsheet structure changed
{
  action: 'diff',
  spreadsheetId: 'xxx',
  diffTier: 'METADATA',  // Fast metadata-only check
}
```

#### SAMPLE (Medium)

**Use when**: You need to detect changes in recent data

**Detects**:

- All METADATA changes
- Cell value changes in first 100 rows
- Formula changes in sample
- Format changes in sample

**Performance**: ~500ms (fixed, regardless of total size)

**Example**:

```typescript
// Check recent data for changes
{
  action: 'diff',
  spreadsheetId: 'xxx',
  diffTier: 'SAMPLE',  // Check first 100 rows
}
```

#### FULL (Slowest)

**Use when**: You need complete change detection

**Detects**:

- All changes across entire spreadsheet
- Every cell value change
- All formula changes
- All format changes

**Performance**: ~2s for 10,000 cells, scales linearly

**Example**:

```typescript
// Complete change detection
{
  action: 'diff',
  spreadsheetId: 'xxx',
  diffTier: 'FULL',  // Full comparison (slow)
}
```

### Automatic Tier Selection

ServalSheets intelligently selects diff tiers:

```typescript
// Strategy from src/compiler/orchestrator.ts
if (intent.diffTier === 'METADATA') {
  // Fast path: metadata only
  fetchMetadata();
} else if (intent.diffTier === 'SAMPLE') {
  // Medium path: first 100 rows
  fetchMetadata();
  fetchSampleData(100);
} else {
  // Slow path: all data
  fetchMetadata();
  fetchAllData();
}
```

### Optimization Tips

**Best Practice**: Start with METADATA, upgrade if needed

```typescript
// Good: Progressive diff checking
async function checkForChanges(spreadsheetId: string) {
  // Step 1: Fast metadata check
  const metadataDiff = await diff({
    action: 'diff',
    spreadsheetId,
    diffTier: 'METADATA',
  });

  if (metadataDiff.hasChanges) {
    // Step 2: Sample check if metadata changed
    const sampleDiff = await diff({
      action: 'diff',
      spreadsheetId,
      diffTier: 'SAMPLE',
    });

    if (sampleDiff.significantChanges) {
      // Step 3: Full check only if necessary
      return await diff({
        action: 'diff',
        spreadsheetId,
        diffTier: 'FULL',
      });
    }
  }

  return metadataDiff;
}
```

**Bad Practice**: Always using FULL

```typescript
// Bad: Always slow
const diff = await diff({
  action: 'diff',
  spreadsheetId,
  diffTier: 'FULL', // Slow for large sheets!
});
```

---

## Batch Operations

ServalSheets automatically batches operations for optimal performance.

### Batch Read

**Single Request**:

```typescript
// Bad: Multiple API calls
const a1 = await read({ action: 'read', spreadsheetId, range: 'A1' });
const b1 = await read({ action: 'read', spreadsheetId, range: 'B1' });
const c1 = await read({ action: 'read', spreadsheetId, range: 'C1' });
// 3 API calls = 300ms+
```

**Batch Request**:

```typescript
// Good: Single API call
const data = await read({
  action: 'read',
  spreadsheetId,
  range: 'A1:C1', // Single range
});
// 1 API call = 100ms
```

### Batch Write

ServalSheets batches writes automatically:

```typescript
// From src/compiler/batcher.ts
export function batchWrites(intents: WriteIntent[]): BatchRequest {
  // Combines multiple writes into single batchUpdate call
  return {
    requests: intents.map((intent) => ({
      updateCells: {
        range: intent.range,
        rows: intent.values,
        fields: 'userEnteredValue',
      },
    })),
  };
}
```

**Performance**:

- **1 write**: 100ms
- **10 writes (batched)**: 150ms (10x faster than individual)
- **100 writes (batched)**: 500ms (20x faster than individual)

### Batch Limits

Google Sheets API limits:

```typescript
// Batch size limits
const LIMITS = {
  maxBatchRequests: 100, // Max requests per batch
  maxBatchSizeBytes: 10_000_000, // 10 MB
  maxCellsPerUpdate: 5_000_000, // 5 million cells
};
```

**Optimization**: ServalSheets auto-splits large batches

```typescript
// From src/compiler/batcher.ts
export function splitBatch(intents: Intent[]): Intent[][] {
  const batches: Intent[][] = [];
  let currentBatch: Intent[] = [];
  let currentSize = 0;

  for (const intent of intents) {
    const intentSize = estimateSize(intent);

    if (
      currentSize + intentSize > LIMITS.maxBatchSizeBytes ||
      currentBatch.length >= LIMITS.maxBatchRequests
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }

    currentBatch.push(intent);
    currentSize += intentSize;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}
```

### Batch Operation Examples

#### Batch Read Multiple Ranges

```typescript
// Single API call for multiple ranges
const result = await read({
  action: 'read',
  spreadsheetId: 'xxx',
  ranges: ['Sheet1!A1:B10', 'Sheet2!D5:F20', 'Sheet3!A1:Z100'],
});
// 1 API call, 3 ranges
```

#### Batch Write Multiple Updates

```typescript
// Single API call for multiple updates
const result = await write({
  action: 'write',
  spreadsheetId: 'xxx',
  updates: [
    { range: 'A1:A10', values: [[1], [2], [3]] },
    { range: 'B1:B10', values: [[4], [5], [6]] },
    { range: 'C1:C10', values: [[7], [8], [9]] },
  ],
});
// 1 API call, 3 updates
```

#### Batch Format Operations

```typescript
// Single API call for multiple format changes
const result = await format({
  action: 'format',
  spreadsheetId: 'xxx',
  operations: [
    { range: 'A1:A10', format: { bold: true } },
    { range: 'B1:B10', format: { backgroundColor: { red: 1, green: 0, blue: 0 } } },
    { range: 'C1:C10', format: { numberFormat: { type: 'CURRENCY' } } },
  ],
});
// 1 API call, 3 format operations
```

---

## Effect Scope Limits

**Effect scope limits** prevent accidental large-scale operations.

### What is Effect Scope?

Effect scope is the number of cells affected by an operation.

```typescript
// From src/intents/schemas/shared.ts
export const EffectScopeLimitSchema = z.object({
  maxCells: z.number().int().positive().optional(),
  maxSheets: z.number().int().positive().optional(),
});
```

### Default Limits

```typescript
const DEFAULT_LIMITS = {
  maxCells: 10_000, // 10,000 cells
  maxSheets: 10, // 10 sheets
};
```

### Usage

```typescript
// Limit operation to 1000 cells
const result = await write({
  action: 'write',
  spreadsheetId: 'xxx',
  range: 'A1:Z100',
  values: data,
  effectScopeLimit: {
    maxCells: 1000, // Safety limit
  },
});

// Error if operation would affect > 1000 cells
// "Operation would affect 2600 cells, exceeding limit of 1000"
```

### Why Use Effect Scope Limits?

**Prevent accidents**:

```typescript
// Oops, meant A1:A100, wrote A1:Z100
const result = await clear({
  action: 'clear',
  spreadsheetId: 'xxx',
  range: 'A1:Z100', // 2600 cells!
  effectScopeLimit: {
    maxCells: 100, // Safety: only meant to clear 100 cells
  },
});
// Error: Would affect 2600 cells, exceeding 100 cell limit
```

**Production safety**:

```typescript
// Set global limits for production
const PRODUCTION_LIMITS = {
  maxCells: 50_000, // Max 50k cells per operation
  maxSheets: 5, // Max 5 sheets per operation
};

// Apply to all operations
const result = await operation({
  ...intent,
  effectScopeLimit: PRODUCTION_LIMITS,
});
```

### Performance Impact

Effect scope limits have **zero performance cost** - they're calculated from metadata before executing operations.

```typescript
// Fast: Only checks dimensions, doesn't fetch data
const cellCount = calculateEffectScope('A1:Z100'); // 2600
if (cellCount > limit.maxCells) {
  throw new Error(`Would affect ${cellCount} cells, exceeding ${limit.maxCells}`);
}
```

### Configuration

#### Per-Operation Limits

```typescript
// Strict limit for this specific operation
await clear({
  action: 'clear',
  spreadsheetId: 'xxx',
  range: 'A1:A10',
  effectScopeLimit: { maxCells: 10 },
});
```

#### Global Limits via Environment

```bash
# Set global limits
export SERVALSHEETS_MAX_CELLS=100000
export SERVALSHEETS_MAX_SHEETS=20
```

#### Disable Limits (Not Recommended)

```typescript
// Remove safety limits (use with caution!)
await operation({
  action: 'write',
  spreadsheetId: 'xxx',
  range: 'A1:ZZ10000',
  values: hugeData,
  effectScopeLimit: undefined, // No limits
});
```

---

## Rate Limiting

ServalSheets uses **token bucket rate limiting** to manage Google API quotas.

### Google Sheets API Quotas

Default quotas (per user per project):

| Quota                 | Limit   | Note        |
| --------------------- | ------- | ----------- |
| Read requests         | 300/min | Per user    |
| Write requests        | 60/min  | Per user    |
| Read requests (total) | 500/min | Per project |

### Token Bucket Algorithm

```typescript
// From src/rate-limiter/token-bucket.ts
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number, // Max tokens
    private refillRate: number // Tokens per second
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async acquire(tokens: number = 1): Promise<void> {
    await this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return;
    }

    // Wait for tokens to refill
    const waitTime = ((tokens - this.tokens) / this.refillRate) * 1000;
    await sleep(waitTime);
    await this.acquire(tokens);
  }

  private async refill(): Promise<void> {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}
```

### Configuration

#### Default Configuration

```typescript
// From src/config/rate-limiting.ts
export const DEFAULT_RATE_LIMITS = {
  reads: {
    capacity: 300, // 300 requests
    refillRate: 5, // 5 per second (300/min)
  },
  writes: {
    capacity: 60, // 60 requests
    refillRate: 1, // 1 per second (60/min)
  },
};
```

#### Environment Variables

```bash
# Adjust rate limits for your quota
export SERVALSHEETS_READS_PER_MINUTE=300
export SERVALSHEETS_WRITES_PER_MINUTE=60

# More aggressive (if you have higher quotas)
export SERVALSHEETS_READS_PER_MINUTE=500
export SERVALSHEETS_WRITES_PER_MINUTE=100
```

#### Custom Rate Limiter

```typescript
// Create custom rate limiter
import { TokenBucket } from './rate-limiter/token-bucket.js';

const customLimiter = new TokenBucket(
  500,   // 500 request capacity
  8.33   // 8.33 per second = 500/min
);

// Use in operations
await customLimiter.acquire();
const result = await sheetsAPI.read(...);
```

### Rate Limiting Strategies

#### Strategy 1: Conservative (Default)

```bash
# Stay well below quota
export SERVALSHEETS_READS_PER_MINUTE=250   # 83% of quota
export SERVALSHEETS_WRITES_PER_MINUTE=50   # 83% of quota
```

**Pros**: Safe, low risk of quota exhaustion
**Cons**: Slower throughput

#### Strategy 2: Aggressive

```bash
# Use full quota
export SERVALSHEETS_READS_PER_MINUTE=300   # 100% of quota
export SERVALSHEETS_WRITES_PER_MINUTE=60   # 100% of quota
```

**Pros**: Maximum throughput
**Cons**: Risk of quota errors if other apps use same project

#### Strategy 3: Burst

```bash
# Allow bursts, slower sustained rate
export SERVALSHEETS_READS_PER_MINUTE=400   # Above quota
export SERVALSHEETS_WRITES_PER_MINUTE=80   # Above quota
```

**Pros**: Fast initial operations
**Cons**: Will hit quota limits and slow down

### Monitoring Rate Limits

```typescript
// Log rate limit status
import { getRateLimitStatus } from './rate-limiter/status.js';

const status = getRateLimitStatus();
console.log('Rate limit status:', {
  readsAvailable: status.reads.tokens,
  writesAvailable: status.writes.tokens,
  readCapacity: status.reads.capacity,
  writeCapacity: status.writes.capacity,
});
```

---

## Memory Management

ServalSheets is designed for memory efficiency with large spreadsheets.

### Memory Limits

| Operation             | Memory Usage | Notes           |
| --------------------- | ------------ | --------------- |
| Read 1000 cells       | ~100 KB      | Efficient JSON  |
| Read 100,000 cells    | ~10 MB       | Streaming       |
| Diff METADATA         | ~50 KB       | Metadata only   |
| Diff FULL (10k cells) | ~2 MB        | Full comparison |

### Streaming for Large Data

```typescript
// From src/streams/data-stream.ts
export async function* streamRows(
  spreadsheetId: string,
  sheetName: string,
  batchSize: number = 1000
): AsyncGenerator<Row[]> {
  let offset = 0;

  while (true) {
    const range = `${sheetName}!A${offset + 1}:Z${offset + batchSize}`;
    const batch = await read({
      action: 'read',
      spreadsheetId,
      range,
    });

    if (batch.values.length === 0) break;

    yield batch.values;
    offset += batchSize;
  }
}

// Usage: Memory-efficient processing
for await (const batch of streamRows('xxx', 'Sheet1')) {
  // Process 1000 rows at a time
  processBatch(batch);
  // Memory is freed after each batch
}
```

### Memory Optimization Tips

#### 1. Use Streaming for Large Datasets

```typescript
// Good: Stream large data
for await (const batch of streamRows('xxx', 'Data', 1000)) {
  await processRows(batch);
}
// Memory: ~100 KB (constant)
```

```typescript
// Bad: Load all data at once
const allData = await read({
  action: 'read',
  spreadsheetId: 'xxx',
  range: 'A1:Z100000',
});
// Memory: ~1 GB (all at once)
```

#### 2. Use METADATA Diff When Possible

```typescript
// Good: Metadata only
const diff = await diff({
  action: 'diff',
  spreadsheetId: 'xxx',
  diffTier: 'METADATA',
});
// Memory: ~50 KB
```

```typescript
// Bad: Full data
const diff = await diff({
  action: 'diff',
  spreadsheetId: 'xxx',
  diffTier: 'FULL',
});
// Memory: ~10 MB
```

#### 3. Clear Unused Data

```typescript
// Free memory after processing
let data = await read({ action: 'read', spreadsheetId: 'xxx', range: 'A1:Z10000' });
processData(data);
data = null; // Allow GC to free memory
```

### Memory Leak Prevention

ServalSheets uses proper cleanup:

```typescript
// From src/cleanup/disposable.ts
export class Disposable {
  private disposers: (() => void)[] = [];

  register(disposer: () => void): void {
    this.disposers.push(disposer);
  }

  dispose(): void {
    for (const disposer of this.disposers) {
      disposer();
    }
    this.disposers = [];
  }
}

// Usage
const operation = new SpreadsheetOperation();
operation.onDispose(() => {
  operation.cache.clear();
  operation.streams.closeAll();
});
```

---

## Caching Strategies

ServalSheets uses intelligent caching to reduce API calls.

### What Gets Cached

```typescript
// From src/cache/cache-config.ts
export const CACHE_CONFIG = {
  metadata: {
    ttl: 300_000, // 5 minutes
    maxSize: 100, // 100 spreadsheets
  },
  cellData: {
    ttl: 60_000, // 1 minute
    maxSize: 1000, // 1000 ranges
  },
  formulaResults: {
    ttl: 30_000, // 30 seconds
    maxSize: 500, // 500 formulas
  },
};
```

### Cache Invalidation

```typescript
// Automatic invalidation on writes
await write({
  action: 'write',
  spreadsheetId: 'xxx',
  range: 'A1:A10',
  values: [[1], [2], [3]],
});
// Cache for A1:A10 is automatically invalidated
```

### Manual Cache Control

```typescript
// Clear cache for spreadsheet
await clearCache({
  action: 'cache_clear',
  spreadsheetId: 'xxx',
});

// Clear specific range
await clearCache({
  action: 'cache_clear',
  spreadsheetId: 'xxx',
  range: 'A1:B10',
});
```

### Cache Performance

| Operation         | Without Cache | With Cache | Improvement |
| ----------------- | ------------- | ---------- | ----------- |
| Read metadata     | 100ms         | 1ms        | 100x        |
| Read cells (hit)  | 100ms         | 1ms        | 100x        |
| Read cells (miss) | 100ms         | 100ms      | 1x          |

### Cache Configuration

```bash
# Adjust cache TTLs
export SERVALSHEETS_CACHE_METADATA_TTL=600000   # 10 minutes
export SERVALSHEETS_CACHE_DATA_TTL=120000       # 2 minutes

# Adjust cache sizes
export SERVALSHEETS_CACHE_METADATA_SIZE=200
export SERVALSHEETS_CACHE_DATA_SIZE=2000
```

---

## Distributed Caching (Redis L2)

ServalSheets supports two-tier distributed caching with Redis for horizontal scaling and cache persistence across pod restarts.

### Architecture

```
┌─────────────────────────────────────────┐
│ Request: GET spreadsheet metadata        │
└─────────────────────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│ L1 Cache (In-Memory)                     │
│ • TTL: 5 minutes                         │
│ • Max: 1000 entries                      │
│ • Latency: ~1ms                          │
└─────────────────────────────────────────┘
         ↓ miss              ↓ hit
┌─────────────────────┐     └→ Return data
│ L2 Cache (Redis)     │
│ • TTL: 10 minutes    │
│ • Distributed        │
│ • Latency: ~5ms      │
└─────────────────────┘
         ↓ miss    ↓ hit
┌──────────────┐  └→ Promote to L1 + Return
│ Google API   │
│ • Latency:   │
│   200-800ms  │
└──────────────┘
```

### Key Benefits

1. **15-25% Latency Improvement**: Across replicas sharing Redis cache
2. **Cache Survives Restarts**: Pod restarts don't lose cache warmth
3. **Horizontal Scaling**: Multiple replicas share cached data
4. **Reduced API Quota**: 30-50% fewer Google API calls (L1) + 15-25% more (L2)

### Configuration

**Enable Redis L2 Cache:**

```bash
# Required: Enable Redis L2 caching
CACHE_REDIS_ENABLED=true

# Required: Redis connection URL
REDIS_URL=redis://localhost:6379

# Optional: L2 cache TTL (default: 600 seconds = 10 minutes)
CACHE_REDIS_TTL_SECONDS=600

# Optional: L1 cache settings (existing)
CACHE_TTL_MS=300000  # 5 minutes (default)
```

**Docker Compose Example:**

```yaml
version: '3.8'
services:
  servalsheets:
    image: servalsheets:latest
    environment:
      - CACHE_REDIS_ENABLED=true
      - REDIS_URL=redis://redis:6379
      - CACHE_REDIS_TTL_SECONDS=600
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes

volumes:
  redis-data:
```

**Kubernetes Example:**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: servalsheets-config
data:
  CACHE_REDIS_ENABLED: 'true'
  REDIS_URL: 'redis://redis-service:6379'
  CACHE_REDIS_TTL_SECONDS: '600'
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: servalsheets
spec:
  replicas: 3 # Multiple replicas share Redis cache
  template:
    spec:
      containers:
        - name: servalsheets
          envFrom:
            - configMapRef:
                name: servalsheets-config
```

### How It Works

**Cache Promotion**: L2 hits are automatically promoted to L1 for faster subsequent access

```typescript
// First request (pod 1): L1 miss → L2 miss → Google API → Cache in L1+L2
await sheets_data.read({ range: 'A1:B10' }); // 250ms (API call)

// Second request (pod 1): L1 hit
await sheets_data.read({ range: 'A1:B10' }); // 1ms (L1 memory)

// Third request (pod 2): L1 miss → L2 hit → Promote to L1
await sheets_data.read({ range: 'A1:B10' }); // 5ms (Redis + promote)

// Fourth request (pod 2): L1 hit
await sheets_data.read({ range: 'A1:B10' }); // 1ms (L1 memory)
```

**Write-Through**: Writes to both L1 and L2 simultaneously

**Invalidation**: Clears both tiers on mutations

```typescript
// Write operation automatically invalidates both L1 and L2
await sheets_data.write({
  range: 'A1:B10',
  values: [
    [1, 2],
    [3, 4],
  ],
});
// Both L1 and L2 caches for A1:B10 are cleared
```

### Cache Keys

Redis keys use the pattern:

```
servalsheets:etag:{spreadsheetId}:{endpoint}:{range}?{params}
```

**Examples:**

```
servalsheets:etag:1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms:metadata
servalsheets:etag:1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms:values:Sheet1!A1:B10
```

### Monitoring

**Check Cache Stats:**

```bash
# View cache statistics via logs
curl http://localhost:3000/health | jq '.cache'

# Expected output:
{
  "l1": {
    "size": 245,
    "maxSize": 1000,
    "hitRate": 0.82
  },
  "l2": {
    "available": true,
    "hitRate": 0.15
  }
}
```

**Redis Monitoring:**

```bash
# Connect to Redis
redis-cli -h localhost -p 6379

# Check cache keys
KEYS servalsheets:etag:*

# Monitor cache operations in real-time
MONITOR

# Check memory usage
INFO memory

# View TTLs
TTL servalsheets:etag:1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms:metadata
```

**Application Logs:**

```json
{
  "timestamp": "2026-02-03T10:15:30.123Z",
  "level": "info",
  "message": "ETag cache initialized with Redis L2",
  "l1Ttl": 300,
  "l2Ttl": 600
}
```

```json
{
  "timestamp": "2026-02-03T10:15:31.456Z",
  "level": "debug",
  "message": "ETag data cache hit (L2 Redis)",
  "key": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms:values:A1:B10"
}
```

### Performance Impact

**Expected Latency by Cache Tier:**

| Cache Tier           | Latency   | Use Case                  |
| -------------------- | --------- | ------------------------- |
| L1 Hit (Memory)      | ~1ms      | Same pod, recent request  |
| L2 Hit (Redis)       | ~5ms      | Different pod, warm cache |
| L2 Miss (Google API) | 200-800ms | Cold cache or expired     |

**Cache Hit Rate Expectations:**

| Scenario            | L1 Hit Rate | L2 Hit Rate | Total API Reduction |
| ------------------- | ----------- | ----------- | ------------------- |
| Single pod          | 80%         | 0%          | 80%                 |
| 3 pods (no Redis)   | 27%         | 0%          | 27%                 |
| 3 pods (with Redis) | 27%         | 50%         | 77%                 |

**Calculation**: With 3 replicas and Redis L2:

- L1 hit rate drops from 80% → 27% (cache split across pods)
- L2 adds 50% hit rate on L1 misses (50% of 73% = 36.5%)
- Total: 27% + 36.5% = 63.5% → effective 77% with promotion

### Troubleshooting

**Redis Connection Issues:**

```bash
# Check Redis connectivity
redis-cli -h localhost -p 6379 ping
# Expected: PONG

# View server logs
docker logs servalsheets | grep "Redis"

# Expected:
# "ETag cache initialized with Redis L2"
# "Capability cache service initialized with Redis"
```

**Cache Not Working:**

```bash
# Verify configuration
echo $CACHE_REDIS_ENABLED  # Should be "true"
echo $REDIS_URL            # Should be valid URL

# Check Redis is running
docker ps | grep redis

# Test Redis manually
redis-cli -h localhost -p 6379 SET test "value"
redis-cli -h localhost -p 6379 GET test
```

**High Memory Usage:**

```bash
# Check Redis memory
redis-cli INFO memory | grep used_memory_human

# Evict old keys if needed (Redis will handle this automatically with TTLs)

# Reduce L2 TTL if memory constrained
export CACHE_REDIS_TTL_SECONDS=300  # 5 minutes instead of 10
```

**Graceful Degradation:**

If Redis becomes unavailable, ServalSheets automatically falls back to L1-only caching:

```json
{
  "level": "warn",
  "message": "Failed to cache ETag in Redis",
  "error": "Connection refused"
}
```

The system continues operating normally with only in-memory caching.

### Production Recommendations

1. **Redis Persistence**: Enable AOF (Append-Only File) for data durability

   ```bash
   redis-server --appendonly yes
   ```

2. **Redis Clustering**: For high availability, use Redis Sentinel or Redis Cluster

   ```yaml
   REDIS_URL: redis-sentinel://sentinel1:26379,sentinel2:26379,sentinel3:26379/mymaster
   ```

3. **Memory Limits**: Set appropriate maxmemory policy

   ```bash
   redis-server --maxmemory 2gb --maxmemory-policy allkeys-lru
   ```

4. **Monitoring**: Use Redis monitoring tools
   - **RedisInsight**: Visual dashboard
   - **redis-stat**: CLI monitoring
   - **Prometheus redis_exporter**: Metrics collection

5. **Security**: Use authentication and encryption

   ```bash
   REDIS_URL: rediss://:password@redis:6379  # TLS + auth
   ```

---

## Google API Quotas

### Understanding Quotas

Google Sheets API has multiple quota types:

#### 1. Per-User Quotas

| Quota          | Limit   | Scope                |
| -------------- | ------- | -------------------- |
| Read requests  | 300/min | Per user per project |
| Write requests | 60/min  | Per user per project |

#### 2. Per-Project Quotas

| Quota          | Limit   | Scope                  |
| -------------- | ------- | ---------------------- |
| Read requests  | 500/min | Total across all users |
| Write requests | 100/min | Total across all users |

#### 3. Concurrent Requests

| Quota             | Limit | Scope       |
| ----------------- | ----- | ----------- |
| Concurrent reads  | 300   | Per project |
| Concurrent writes | 100   | Per project |

### Quota Monitoring

```typescript
// From src/monitoring/quota.ts
export function logQuotaUsage(operation: string, duration: number): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      operation,
      duration,
      quotaType: operation.startsWith('read') ? 'read' : 'write',
    })
  );
}
```

### Handling Quota Errors

ServalSheets automatically retries with exponential backoff:

```typescript
// From src/api/retry.ts
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (isQuotaError(error)) {
        const waitTime = Math.pow(2, i) * 1000; // 1s, 2s, 4s
        await sleep(waitTime);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}
```

### Quota Optimization Strategies

#### Strategy 1: Batch Operations

```typescript
// Bad: 10 API calls
for (let i = 0; i < 10; i++) {
  await read({ action: 'read', spreadsheetId: 'xxx', range: `A${i}` });
}
// Quota: 10 read requests

// Good: 1 API call
await read({
  action: 'read',
  spreadsheetId: 'xxx',
  range: 'A1:A10',
});
// Quota: 1 read request
```

#### Strategy 2: Use Caching

```typescript
// Enable aggressive caching
export SERVALSHEETS_CACHE_METADATA_TTL=600000   # 10 min
export SERVALSHEETS_CACHE_DATA_TTL=300000       # 5 min
```

#### Strategy 3: Use METADATA Diff

```typescript
// Check if data changed before reading
const diff = await diff({
  action: 'diff',
  spreadsheetId: 'xxx',
  diffTier: 'METADATA',
});

if (!diff.hasChanges) {
  // Use cached data, save quota
  return getCachedData();
}

// Only read if data changed
return await read({ action: 'read', spreadsheetId: 'xxx', range: 'A1:Z100' });
```

---

## Performance Benchmarks

### Test Environment

- **Machine**: MacBook Pro M1, 16GB RAM
- **Network**: 100 Mbps
- **Spreadsheet**: 10 sheets, 10,000 cells each

### Benchmark Results

#### Read Operations

| Operation          | Time    | Quota Used         |
| ------------------ | ------- | ------------------ |
| Read 100 cells     | 95ms    | 1 read             |
| Read 1,000 cells   | 110ms   | 1 read             |
| Read 10,000 cells  | 280ms   | 1 read             |
| Read 100,000 cells | 1,850ms | 10 reads (batched) |

#### Write Operations

| Operation           | Time    | Quota Used          |
| ------------------- | ------- | ------------------- |
| Write 100 cells     | 150ms   | 1 write             |
| Write 1,000 cells   | 180ms   | 1 write             |
| Write 10,000 cells  | 420ms   | 1 write             |
| Write 100,000 cells | 3,200ms | 20 writes (batched) |

#### Diff Operations

| Operation                 | Time    | Quota Used |
| ------------------------- | ------- | ---------- |
| Diff METADATA             | 85ms    | 1 read     |
| Diff SAMPLE (100 rows)    | 420ms   | 1 read     |
| Diff FULL (1,000 cells)   | 180ms   | 1 read     |
| Diff FULL (10,000 cells)  | 850ms   | 1 read     |
| Diff FULL (100,000 cells) | 6,200ms | 10 reads   |

#### Format Operations

| Operation           | Time  | Quota Used |
| ------------------- | ----- | ---------- |
| Format 100 cells    | 170ms | 1 write    |
| Format 1,000 cells  | 220ms | 1 write    |
| Format 10,000 cells | 580ms | 1 write    |

### Performance Tips Summary

1. **Use batch operations**: 10-20x faster than individual calls
2. **Start with METADATA diff**: 100x faster than FULL
3. **Enable caching**: 100x faster for cache hits
4. **Use effect scope limits**: Prevent accidental large operations
5. **Stream large datasets**: Constant memory usage
6. **Configure rate limits**: Match your quota allocation

---

## Optimization Checklist

### Before Deployment

- [ ] **Configure rate limits** to match your quota

  ```bash
  export SERVALSHEETS_READS_PER_MINUTE=300
  export SERVALSHEETS_WRITES_PER_MINUTE=60
  ```

- [ ] **Enable caching** with appropriate TTLs

  ```bash
  export SERVALSHEETS_CACHE_METADATA_TTL=600000
  export SERVALSHEETS_CACHE_DATA_TTL=120000
  ```

- [ ] **Set effect scope limits** for safety

  ```bash
  export SERVALSHEETS_MAX_CELLS=100000
  export SERVALSHEETS_MAX_SHEETS=20
  ```

- [ ] **Use METADATA diff** by default

  ```typescript
  diffTier: 'METADATA'; // Fast default
  ```

- [ ] **Batch operations** where possible

  ```typescript
  // Combine multiple operations into single calls
  ```

### During Operation

- [ ] **Monitor quota usage** with structured logging
- [ ] **Watch for quota errors** and adjust rate limits
- [ ] **Profile slow operations** and optimize
- [ ] **Use streaming** for large datasets
- [ ] **Clear caches** when data is stale

### Performance Monitoring

```bash
# Enable performance logging
export LOG_LEVEL=debug
export LOG_FORMAT=json

# Monitor logs
tail -f ~/Library/Logs/Claude/mcp-server-servalsheets.log | jq 'select(.duration > 1000)'
```

### Alerting

Set up alerts for:

- Quota exhaustion (429 errors)
- Slow operations (> 5s)
- High memory usage (> 500 MB)
- Cache miss rate (> 50%)

---

## Summary

ServalSheets provides multiple performance optimization strategies:

| Strategy            | Performance Gain | Use Case            |
| ------------------- | ---------------- | ------------------- |
| HTTP/2              | 5-15% latency    | All API requests    |
| Batch operations    | 10-20x           | Multiple operations |
| METADATA diff       | 100x             | Change detection    |
| Caching             | 100x             | Repeated reads      |
| Effect scope limits | Prevents issues  | Safety              |
| Streaming           | Constant memory  | Large datasets      |
| Rate limiting       | Quota management | Production          |

**Key Takeaway**: Start with conservative defaults, monitor performance, and tune based on your workload.

For monitoring and observability, see `MONITORING.md`.
