---
title: ServalSheets Debugging Guide
category: guide
last_updated: 2026-03-10
description: Comprehensive debugging techniques and troubleshooting for ServalSheets developers.
version: 1.6.0
audience: user
difficulty: intermediate
---

# ServalSheets Debugging Guide

Comprehensive debugging techniques and troubleshooting for ServalSheets developers.

**Last Updated:** 2026-02-17
**Difficulty:** All Levels

---

## Table of Contents

1. [Common Issues & Solutions](#common-issues--solutions)
2. [Debugging Tools](#debugging-tools)
3. [Log Analysis](#log-analysis)
4. [Performance Debugging](#performance-debugging)
5. [Memory Debugging](#memory-debugging)
6. [MCP Protocol Debugging](#mcp-protocol-debugging)
7. [Testing & Reproduction](#testing--reproduction)

---

## Common Issues & Solutions

### 1. "action is required" Error

**Symptom:**

```
ValidationError: action is required
```

**Cause:** Missing legacy envelope wrapper in test input

**Solution:**

```typescript
// ❌ Wrong
const input = {
  action: 'read',
  spreadsheetId: 'test-123',
};

// ✅ Correct
const input = {
  request: {
    action: 'read',
    spreadsheetId: 'test-123',
  },
};
```

**Why:** The MCP layer expects a `request` envelope for backward compatibility.

---

### 2. Metadata Drift Detected

**Symptom:**

```bash
$ npm run check:drift
❌ Metadata drift detected
```

**Cause:** Schema files modified without regenerating metadata

**Solution:**

```bash
npm run schema:commit
```

This regenerates:

- `src/schemas/index.ts` (action counts)
- `src/schemas/annotations.ts` (per-tool metadata)
- `src/mcp/completions.ts` (autocomplete)
- `server.json` (MCP metadata)

**Prevention:** Always run `npm run schema:commit` after modifying any file in `src/schemas/`

---

### 3. TypeScript Errors After Schema Change

**Symptom:**

```
Type 'new_action' is not assignable to type 'read' | 'write' | ...
```

**Cause:** Generated types not updated

**Solution:**

```bash
npm run gen:metadata
npm run build
```

**Check:** Verify action is in discriminated union:

```typescript
export const SheetsDataInputSchema = z.discriminatedUnion('action', [
  ReadInputSchema,
  WriteInputSchema,
  NewActionInputSchema, // ← Must be added
]);
```

---

### 4. Tests Pass Locally But Fail in CI

**Possible Causes:**

- Metadata drift
- Missing `npm run verify` before commit
- Hard-coded file paths
- Environment-specific behavior
- Race conditions in parallel tests

**Solution:**

```bash
# Run full verification locally
npm run verify

# Check for metadata drift
npm run check:drift

# Run tests with same config as CI
npm run test:quick

# Check for race conditions
npm test -- --pool=forks
```

---

### 5. "Service not found" in DI Container

**Symptom:**

```
Error: Service 'googleClient' not found
```

**Cause:** Service not registered in DI container

**Solution:**

```typescript
// In src/di/service-registrations.ts
container.register(registerGoogleApiClient(googleApiOptions));
```

---

### 6. Circuit Breaker OPEN State

**Symptom:**

```
CircuitBreakerError: Circuit breaker is OPEN
```

**Cause:** Too many failures to Google API endpoint

**Solution:**

```bash
# Check circuit breaker status
npm run monitor:health

# Reset circuit breaker
curl -X POST http://localhost:3000/admin/circuit-breakers/reset

# Or wait for half-open timeout (30 seconds)
```

**Prevention:** Add retry logic and better error handling

---

### 7. Response Validation Warnings

**Symptom:**

```
⚠️  Output validation warning: Missing field 'data'
```

**Cause:** Handler returning wrong response format

**Solution:**

```typescript
// ❌ Wrong
return { success: true, result: data };

// ✅ Correct
return { response: { success: true, data } };
```

**Why:** Response builder expects specific format

---

## Debugging Tools

### 1. Verbose Logging

```bash
# Enable debug logs
LOG_LEVEL=debug npm start

# Enable trace logs (very verbose)
LOG_LEVEL=trace npm start

# Log to file
LOG_LEVEL=debug npm start > debug.log 2>&1
```

### 2. MCP Inspector

```bash
# Start MCP Inspector
npm run inspect

# Opens browser UI on http://localhost:6274
# - View tool definitions
# - Test tool calls
# - Inspect protocol messages
```

### 3. Performance Profiling

```bash
# CPU profiling
npm run profile:cpu

# Memory profiling
npm run profile:memory

# Flame graph generation
npm run profile:flame

# Opens visualization in browser
```

### 4. Memory Heap Snapshots

```bash
# Take heap snapshot
node --expose-gc --inspect dist/http-server.js

# In Chrome DevTools:
# 1. Go to chrome://inspect
# 2. Click "inspect" on your Node process
# 3. Go to Memory tab
# 4. Take heap snapshot
```

### 5. Request Tracing

```bash
# Enable request tracing
ENABLE_TRACING=true npm start

# View traces
npm run monitor:live
```

---

## Log Analysis

### Log Levels

```typescript
logger.error('Critical failure', { error }); // Always logged
logger.warn('Non-critical issue', { details }); // Production
logger.info('Normal operation', { data }); // Production
logger.debug('Detailed info', { trace }); // Development
logger.trace('Very verbose', { everything }); // Debugging
```

### Reading Logs

**Structure:**

```json
{
  "timestamp": "2026-02-17T12:34:56.789Z",
  "level": "info",
  "message": "Handler executed",
  "service": "sheets_data",
  "action": "read",
  "duration": 45,
  "requestId": "abc-123"
}
```

**Key Fields:**

- `timestamp` - When event occurred
- `level` - Log severity
- `message` - Human-readable description
- `requestId` - Trace requests across services
- `duration` - Performance metrics

### Common Log Patterns

**Successful Operation:**

```
INFO: Handler started {action: 'read', spreadsheetId: '...'}
INFO: API call started {endpoint: 'spreadsheets.get'}
INFO: API call completed {duration: 45ms}
INFO: Handler completed {duration: 52ms}
```

**Failed Operation:**

```
INFO: Handler started {action: 'read'}
ERROR: API call failed {error: '404 Not Found'}
ERROR: Handler failed {error: 'Spreadsheet not found'}
```

**Performance Issue:**

```
WARN: Slow operation detected {duration: 5000ms, threshold: 1000ms}
```

---

## Performance Debugging

### 1. Identify Slow Operations

```bash
# Run performance benchmarks
npm run perf:bench-handlers

# Run regression tests
npm run perf:compare

# Check for regressions
npm test tests/benchmarks/performance-regression.test.ts
```

### 2. Profile Specific Handler

```typescript
import { performance } from 'perf_hooks';

async handleRead(params: ReadParams): Promise<ReadOutput> {
  const start = performance.now();

  // Your code here
  const result = await this.readRange(...);

  const duration = performance.now() - start;
  if (duration > 1000) {
    logger.warn('Slow read operation', { duration, range: params.range });
  }

  return result;
}
```

### 3. Analyze Performance Baselines

```bash
# Check current performance vs baseline
npm run perf:compare

# View performance dashboard
npm run perf:dashboard
```

---

## Memory Debugging

### 1. Detect Memory Leaks

```bash
# Run memory leak detection tests
npm run perf:memory-leaks

# With heap snapshots on leaks
HEAP_SNAPSHOT_ON_LEAK=true npm run perf:memory-leaks
```

### 2. Monitor Memory Usage

```typescript
// In your code
const memBefore = process.memoryUsage().heapUsed;

// ... operations ...

const memAfter = process.memoryUsage().heapUsed;
const growth = memAfter - memBefore;

if (growth > 10 * 1024 * 1024) {
  // 10MB
  logger.warn('Excessive memory growth', {
    growthMB: (growth / 1024 / 1024).toFixed(2),
  });
}
```

### 3. Force Garbage Collection

```bash
# Run with GC exposed
node --expose-gc dist/http-server.js

# In code
if (global.gc) {
  global.gc();
}
```

---

## MCP Protocol Debugging

### 1. Inspect Protocol Messages

```bash
# Enable protocol logging
MCP_DEBUG=true npm start

# Logs show full JSON-RPC messages:
# → Request: {"jsonrpc":"2.0","method":"tools/call",...}
# ← Response: {"jsonrpc":"2.0","result":{...}}
```

### 2. Test Tool Calls

```bash
# Start inspector
npm run inspect

# Use web UI to:
# - Browse all 25 tools
# - View input/output schemas
# - Execute tool calls
# - See raw MCP messages
```

### 3. Validate MCP Compliance

```bash
# Run MCP protocol tests
npm run test:compliance

# Validate tool definitions
npm run validate:mcp-protocol
```

---

## Testing & Reproduction

### 1. Reproduce Bug with Test

```typescript
it('should reproduce bug #123', async () => {
  // Exact scenario from bug report
  const input = {
    request: {
      action: 'read',
      spreadsheetId: 'problematic-id',
      range: { a1: 'Sheet1!A1:Z1000' },
    },
  };

  // This should fail with the reported error
  await expect(handler.executeAction(input)).rejects.toThrow('Expected error');
});
```

### 2. Isolate the Problem

```typescript
// Test each layer separately

// 1. Schema validation
it('schema validates input', () => {
  const result = SheetsDataInputSchema.safeParse(input);
  expect(result.success).toBe(true);
});

// 2. Handler execution
it('handler processes request', async () => {
  const result = await handler.executeAction(input);
  expect(result.response.success).toBe(true);
});

// 3. API call
it('API returns expected data', async () => {
  const result = await googleClient.sheets.spreadsheets.get({...});
  expect(result.data).toBeDefined();
});
```

### 3. Add Regression Test

Once fixed, add a test to prevent regression:

```typescript
it('should not regress on bug #123', async () => {
  // Test case that previously failed
  const result = await handler.executeAction(problematicInput);
  expect(result.response.success).toBe(true);
});
```

---

## Debugging Checklist

Before reporting a bug:

- [ ] Can you reproduce it consistently?
- [ ] Does it happen in development only or production too?
- [ ] Have you checked the logs?
- [ ] Have you run `npm run verify`?
- [ ] Have you checked for metadata drift?
- [ ] Have you tried with verbose logging?
- [ ] Can you write a failing test?
- [ ] Have you checked GitHub issues for similar problems?

---

## Getting Help

If you're stuck:

1. **Check documentation** - [ONBOARDING.md](./ONBOARDING.md), [SOURCE_OF_TRUTH.md](../development/SOURCE_OF_TRUTH.md)
2. **Search GitHub Issues** - Someone may have had the same problem
3. **Ask in Discussions** - Community can help
4. **Open an issue** - Provide reproduction steps and logs

---

**Remember:** Good debugging is methodical. Start with the simplest explanation and work your way up!
