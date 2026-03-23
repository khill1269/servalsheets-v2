---
title: Caching Patterns Guide
category: guide
last_updated: 2026-01-31
description: Quick Reference for AI Agents
version: 1.6.0
audience: user
difficulty: intermediate
---

# Caching Patterns Guide

**Quick Reference for AI Agents**

Learn how to leverage ServalSheets' intelligent caching system to reduce API calls and improve performance.

## What Gets Cached

ServalSheets caches three types of data:

| Cache Type    | TTL        | Max Size         | Use Case                           |
| ------------- | ---------- | ---------------- | ---------------------------------- |
| **Metadata**  | 5 minutes  | 100 spreadsheets | Spreadsheet structure, sheet lists |
| **Cell Data** | 1 minute   | 1000 ranges      | Cell values, formulas              |
| **Schemas**   | 10 minutes | 50 spreadsheets  | Column schemas, data types         |

## How Caching Works

### Automatic Cache Keys

ServalSheets generates cache keys automatically:

```typescript
// Read operation
await read({
  action: 'read',
  spreadsheetId: 'xxx',
  range: 'A1:B10',
});
// Cache key: "read:xxx:A1:B10"
// Subsequent reads with same params = cache hit (0 API calls)
```

### Cache Invalidation

Caches are automatically invalidated on writes:

```typescript
// Step 1: Read data (cached)
await read({ action: 'read', spreadsheetId: 'xxx', range: 'A1:B10' });
// Cache: read:xxx:A1:B10 stored

// Step 2: Write to same range
await write({ action: 'write', spreadsheetId: 'xxx', range: 'A1', values: [[1]] });
// Cache: read:xxx:A1:B10 INVALIDATED (range overlaps)

// Step 3: Read again
await read({ action: 'read', spreadsheetId: 'xxx', range: 'A1:B10' });
// Cache miss: Fresh API call
```

## Cache Hit Patterns

### Pattern 1: Repeated Metadata Queries

**Scenario**: Multiple operations on same spreadsheet

```typescript
// First call: Cache miss (1 API call)
const sheets1 = await list_sheets({
  action: 'list_sheets',
  spreadsheetId: 'xxx',
});
// Cache: metadata:xxx stored (TTL: 5 min)

// Subsequent calls within 5 min: Cache hit (0 API calls)
const sheets2 = await list_sheets({
  action: 'list_sheets',
  spreadsheetId: 'xxx',
});
// Cache hit: Returns cached metadata
```

**Performance**: 1 API call → 0 API calls (100% savings on repeated queries)

### Pattern 2: Read-Heavy Workflows

**Scenario**: Analyzing data without modifying it

```typescript
// Step 1: Read data (1 API call)
const data = await read({
  action: 'read',
  spreadsheetId: 'xxx',
  range: 'A1:Z100',
});
// Cache: read:xxx:A1:Z100 stored (TTL: 1 min)

// Step 2: Analyze locally (0 API calls)
const analysis = analyzeData(data.values);

// Step 3: Re-read for verification (0 API calls - cache hit!)
const verification = await read({
  action: 'read',
  spreadsheetId: 'xxx',
  range: 'A1:Z100',
});
// Cache hit: Returns same data (within 1 min TTL)
```

**Performance**: 2 API calls → 1 API call (50% savings)

### Pattern 3: Schema-Based Operations

**Scenario**: Multiple operations requiring column schema

```typescript
// First operation: Fetches and caches schema (1 API call)
await analyze_data({
  action: 'analyze_data',
  spreadsheetId: 'xxx',
  sheetName: 'Data',
});
// Cache: schema:xxx:Data stored (TTL: 10 min)

// Subsequent operations: Use cached schema (0 extra API calls)
await detect_issues({
  action: 'detect_issues',
  spreadsheetId: 'xxx',
  sheetName: 'Data',
});
// Cache hit: Schema not refetched
```

**Performance**: Shared schema = fewer API calls across operations

## Cache Control Strategies

### Strategy 1: Aggressive Caching (Read-Heavy Workloads)

**Use when**: Data changes infrequently, many read operations

```typescript
// Configure longer TTLs (environment variables)
export SERVALSHEETS_CACHE_METADATA_TTL=600000   // 10 minutes
export SERVALSHEETS_CACHE_DATA_TTL=300000       // 5 minutes
export SERVALSHEETS_CACHE_SCHEMA_TTL=600000     // 10 minutes
```

**Benefits**:

- Fewer API calls
- Faster response times
- Lower quota usage

**Risks**:

- Stale data if external changes occur
- Memory usage increases

### Strategy 2: Conservative Caching (Write-Heavy Workloads)

**Use when**: Data changes frequently, freshness critical

```typescript
// Configure shorter TTLs
export SERVALSHEETS_CACHE_METADATA_TTL=60000    // 1 minute
export SERVALSHEETS_CACHE_DATA_TTL=30000        // 30 seconds
export SERVALSHEETS_CACHE_SCHEMA_TTL=120000     // 2 minutes
```

**Benefits**:

- Fresher data
- Lower memory usage
- Fewer cache invalidation issues

**Risks**:

- More API calls
- Higher quota usage

### Strategy 3: Selective Caching (Mixed Workload)

**Use when**: Some data is stable (metadata), other data changes frequently (values)

```typescript
// Long TTL for metadata (stable)
export SERVALSHEETS_CACHE_METADATA_TTL=600000   // 10 minutes

// Short TTL for cell data (volatile)
export SERVALSHEETS_CACHE_DATA_TTL=60000        // 1 minute

// Medium TTL for schemas (semi-stable)
export SERVALSHEETS_CACHE_SCHEMA_TTL=300000     // 5 minutes
```

**Benefits**: Optimized for mixed access patterns

## Manual Cache Control

### Clearing Caches

ServalSheets provides cache control actions:

```typescript
// Clear all caches for a spreadsheet
await session_clear_cache({
  action: 'session_clear_cache',
  spreadsheetId: 'xxx',
});

// Clear specific operation caches
await session_clear_cache({
  action: 'session_clear_cache',
  spreadsheetId: 'xxx',
  cacheTypes: ['metadata', 'cellData'],
});
```

### When to Clear Caches Manually

1. **External Changes**: Another user/app modified the spreadsheet
2. **Stale Data Detected**: You know data is outdated
3. **Testing**: Need to verify fresh API responses
4. **Memory Pressure**: Free up cache memory

**Example:**

```typescript
// User reports data looks wrong
// Force fresh fetch by clearing cache
await session_clear_cache({
  action: 'session_clear_cache',
  spreadsheetId: 'xxx',
});

// Next read will hit API (not cache)
const freshData = await read({
  action: 'read',
  spreadsheetId: 'xxx',
  range: 'A1:Z100',
});
```

## Cache Performance Benchmarks

### API Call Reduction

| Workflow              | Without Cache | With Cache | Savings |
| --------------------- | ------------- | ---------- | ------- |
| 10 metadata queries   | 10 API calls  | 1 API call | 90%     |
| 5 identical reads     | 5 API calls   | 1 API call | 80%     |
| Schema + 3 operations | 4 API calls   | 1 API call | 75%     |

### Latency Improvement

| Operation       | Without Cache | With Cache | Improvement |
| --------------- | ------------- | ---------- | ----------- |
| Metadata fetch  | ~100ms        | ~1ms       | 100x faster |
| Cell read (hit) | ~100ms        | ~1ms       | 100x faster |
| Schema fetch    | ~120ms        | ~2ms       | 60x faster  |

## Caching Best Practices

### Practice 1: Group Read Operations

**Maximize cache hits by grouping related reads:**

```typescript
// ✅ GOOD: Grouped reads benefit from cache
async function analyzeSpreadsheet(spreadsheetId: string) {
  // First read: Cache miss (1 API call)
  const metadata = await get({
    action: 'get',
    spreadsheetId,
    includeGridData: false,
  });

  // Subsequent operations: Cache hits (0 API calls)
  const sheets = await list_sheets({ action: 'list_sheets', spreadsheetId });
  const info = await get_info({ action: 'get_info', spreadsheetId });

  return { metadata, sheets, info };
}
// Total: 1 API call (metadata cached and reused)
```

### Practice 2: Avoid Unnecessary Cache Clears

**Only clear caches when truly necessary:**

```typescript
// ❌ BAD: Clearing cache unnecessarily
await session_clear_cache({ action: 'session_clear_cache', spreadsheetId: 'xxx' });
const data = await read({ action: 'read', spreadsheetId: 'xxx', range: 'A1:B10' });
// Forces fresh API call even if cache was valid

// ✅ GOOD: Trust cache unless you know it's stale
const data = await read({ action: 'read', spreadsheetId: 'xxx', range: 'A1:B10' });
// Uses cache if available (faster, saves quota)
```

### Practice 3: Leverage Long-Lived Metadata Caches

**Metadata (sheet structure) changes rarely:**

```typescript
// ✅ GOOD: Reuse metadata cache across operations
async function processMultipleSheets(spreadsheetId: string, sheetNames: string[]) {
  // Get metadata once: 1 API call
  const sheets = await list_sheets({
    action: 'list_sheets',
    spreadsheetId,
  });
  // Cache: metadata:xxx stored (TTL: 5 min)

  // Process each sheet using cached metadata: 0 extra API calls
  for (const sheetName of sheetNames) {
    // getSheetId uses cached metadata (no API call)
    const sheetId = sheets.find((s) => s.properties.title === sheetName)?.properties.sheetId;
    await processSheet(spreadsheetId, sheetId);
  }
}
```

### Practice 4: Use Cache-Friendly Access Patterns

**Access data in a cache-friendly order:**

```typescript
// ✅ GOOD: Read then process (cache-friendly)
const data = await read({ action: 'read', spreadsheetId: 'xxx', range: 'A1:Z100' });
// Cache: read:xxx:A1:Z100 stored

// Process locally (no API calls)
const result = processData(data.values);

// If you need to re-read (within TTL), it's cached
const verification = await read({ action: 'read', spreadsheetId: 'xxx', range: 'A1:Z100' });
// Cache hit (0 API calls)

// ❌ BAD: Interleaved reads and writes (cache-unfriendly)
for (let i = 1; i <= 100; i++) {
  const data = await read({ action: 'read', spreadsheetId: 'xxx', range: `A${i}` });
  await write({ action: 'write', spreadsheetId: 'xxx', range: `B${i}`, values: [[process(data)]] });
  // Each write invalidates cache, forcing fresh read next iteration
}
// Result: 100 API calls (no cache benefit)
```

## Monitoring Cache Performance

### Enable Cache Logging

```bash
# Enable cache hit/miss logging
export LOG_LEVEL=debug
export LOG_CACHE_STATS=true

npm start
```

### Example Log Output

```json
{
  "timestamp": "2026-01-15T12:00:00Z",
  "level": "debug",
  "message": "Cache hit",
  "cacheKey": "read:xxx:A1:B10",
  "ttlRemaining": 45000
}

{
  "timestamp": "2026-01-15T12:01:00Z",
  "level": "debug",
  "message": "Cache miss",
  "cacheKey": "read:xxx:C1:D10",
  "reason": "not_found"
}

{
  "timestamp": "2026-01-15T12:02:00Z",
  "level": "info",
  "message": "Cache stats",
  "hits": 127,
  "misses": 23,
  "hitRate": "84.7%",
  "avgHitLatency": "1.2ms",
  "avgMissLatency": "105ms"
}
```

### Cache Hit Rate Targets

| Workload Type            | Target Hit Rate | Notes                |
| ------------------------ | --------------- | -------------------- |
| Read-heavy (analysis)    | >80%            | Aggressive caching   |
| Mixed (read + write)     | 50-70%          | Balanced caching     |
| Write-heavy (data entry) | <30%            | Conservative caching |

## Cache Anti-Patterns

### Anti-Pattern 1: Clearing Cache Before Every Operation

```typescript
// ❌ BAD: Defeats the purpose of caching
async function getData(spreadsheetId: string, range: string) {
  await session_clear_cache({ action: 'session_clear_cache', spreadsheetId });
  return await read({ action: 'read', spreadsheetId, range });
}
// Result: 0% cache hit rate, wasted quota
```

### Anti-Pattern 2: Caching Configuration Mismatched to Workload

```typescript
// ❌ BAD: Long TTL for frequently changing data
// Environment:
export SERVALSHEETS_CACHE_DATA_TTL=600000  // 10 minutes

// Workflow: Real-time data entry
await write({ action: 'write', spreadsheetId: 'xxx', range: 'A1', values: [[1]] });
await read({ action: 'read', spreadsheetId: 'xxx', range: 'A1' });
// Problem: Read might return stale data (cache not yet expired)
```

**Solution**: Match TTL to data volatility

### Anti-Pattern 3: Over-Reliance on Cache for Critical Data

```typescript
// ❌ BAD: Assuming cache is always fresh
const balance = await read({ action: 'read', spreadsheetId: 'xxx', range: 'Balance' });
// Problem: If balance was updated externally, cache might be stale
await makeFinancialDecision(balance);

// ✅ GOOD: Force fresh read for critical data
await session_clear_cache({ action: 'session_clear_cache', spreadsheetId: 'xxx' });
const freshBalance = await read({ action: 'read', spreadsheetId: 'xxx', range: 'Balance' });
await makeFinancialDecision(freshBalance);
```

## Summary

### Cache Benefits

- **80-90% API call reduction** for read-heavy workloads
- **100x latency improvement** for cache hits
- **Lower quota usage** and higher throughput

### When to Use Aggressive Caching

- Read-heavy workflows (analysis, reporting)
- Infrequently changing data
- Multiple operations on same spreadsheet
- Quota-constrained environments

### When to Use Conservative Caching

- Write-heavy workflows (data entry)
- Frequently changing data
- Real-time requirements
- Memory-constrained environments

### Quick Reference

| Scenario              | Cache Strategy | TTL Recommendation |
| --------------------- | -------------- | ------------------ |
| Static reference data | Aggressive     | 10+ minutes        |
| Dashboard/reporting   | Aggressive     | 5-10 minutes       |
| Data analysis         | Moderate       | 1-5 minutes        |
| Collaborative editing | Conservative   | 30-60 seconds      |
| Real-time data entry  | Minimal        | 15-30 seconds      |

## Related Resources

- **Quota Optimization**: `servalsheets://guides/quota-optimization`
- **Performance Tuning**: `docs/guides/PERFORMANCE.md#caching-strategies`
- **Session Management**: `docs/guides/SESSION_CONTEXT.md`
