---
title: Batching Strategies Guide
category: guide
last_updated: 2026-01-31
description: Quick Reference for AI Agents
version: 1.6.0
tags: [sheets]
audience: user
difficulty: intermediate
---

# Batching Strategies Guide

**Quick Reference for AI Agents**

Learn when and how to use batching for optimal Google Sheets API performance.

## What is Batching?

**Batching** combines multiple API operations into a single HTTP request, reducing:

- API call count (quota savings)
- Network roundtrips (latency reduction)
- Connection overhead (throughput improvement)

## ServalSheets Batching Tools

| Tool                   | Actions                     | Use Case                       |
| ---------------------- | --------------------------- | ------------------------------ |
| **sheets_data**        | `batch_read`, `batch_write` | Read/write multiple ranges     |
| **sheets_transaction** | `begin`, `queue`, `commit`  | Atomic multi-operation updates |
| **sheets_composite**   | `bulk_update`, `import_csv` | Pre-optimized common workflows |

## When to Use Batching

### Decision Tree

```
How many operations do you need?
  │
  ├─ 1 operation
  │   └─ Don't batch (use direct action)
  │
  ├─ 2-3 operations
  │   └─ Consider batching if:
  │       • Operations are on different ranges
  │       • Network latency is high
  │       • Otherwise: direct actions are fine
  │
  └─ 4+ operations
      └─ ALWAYS batch
          │
          ├─ All reads? → Use batch_read
          ├─ All writes? → Use transaction or batch_write
          └─ Mixed? → Use transaction
```

## Batch Read Strategy

### When to Use batch_read

**Use batch_read when:**

- Reading 2+ non-contiguous ranges
- Reading from multiple sheets
- Reading different data types (values, formulas, formats)

**Example:**

```typescript
// ❌ BAD: 3 API calls
const sheet1Data = await read({ action: 'read', spreadsheetId: 'xxx', range: 'Sheet1!A1:B10' });
const sheet2Data = await read({ action: 'read', spreadsheetId: 'xxx', range: 'Sheet2!C1:D10' });
const sheet3Data = await read({ action: 'read', spreadsheetId: 'xxx', range: 'Sheet3!E1:F10' });

// ✅ GOOD: 1 API call
const allData = await batch_read({
  action: 'batch_read',
  spreadsheetId: 'xxx',
  ranges: ['Sheet1!A1:B10', 'Sheet2!C1:D10', 'Sheet3!E1:F10'],
});
// Access: allData.valueRanges[0].values, allData.valueRanges[1].values, etc.
```

**Quota Savings**: 3 API calls → 1 API call (66% reduction)

### When NOT to Use batch_read

**DON'T use batch_read when:**

- Reading a single range (use `read` instead)
- Reading contiguous ranges (combine into one wide range)

**Example:**

```typescript
// ❌ BAD: batch_read for contiguous ranges
await batch_read({
  action: 'batch_read',
  spreadsheetId: 'xxx',
  ranges: ['A1:B10', 'C1:D10'], // Contiguous!
});

// ✅ GOOD: Single wide range
await read({
  action: 'read',
  spreadsheetId: 'xxx',
  range: 'A1:D10', // Combines both ranges
});
```

## Batch Write Strategy

### Option 1: batch_write (Simple)

**Best for:** Multiple independent writes, no atomicity needed

```typescript
await batch_write({
  action: 'batch_write',
  spreadsheetId: 'xxx',
  data: [
    { range: 'A1', values: [[1]] },
    { range: 'B1', values: [[2]] },
    { range: 'C1', values: [[3]] },
  ],
});
```

**Quota**: 1 API call for all writes

### Option 2: Transaction (Advanced)

**Best for:** Multiple writes requiring atomicity (all-or-nothing)

```typescript
// Begin transaction: 1 API call
await begin_transaction({
  action: 'begin',
  spreadsheetId: 'xxx',
});

// Queue operations: 0 API calls (local only)
await queue_operation({
  action: 'queue',
  operation: {
    type: 'write',
    range: 'A1',
    values: [[1]],
  },
});

await queue_operation({
  action: 'queue',
  operation: {
    type: 'write',
    range: 'B1',
    values: [[2]],
  },
});

// Commit: 1 API call (executes all)
await commit_transaction({
  action: 'commit',
});
```

**Quota**: 2 API calls total (begin + commit), regardless of operation count

**Atomicity**: If any operation fails, all are rolled back

### batch_write vs Transaction

| Feature    | batch_write        | Transaction          |
| ---------- | ------------------ | -------------------- |
| API Calls  | 1                  | 2 (begin + commit)   |
| Atomicity  | No                 | Yes (all-or-nothing) |
| Rollback   | No                 | Yes                  |
| Complexity | Simple             | Medium               |
| Use When   | Independent writes | Related writes       |

**Rule of Thumb:**

- **2-5 writes**: Use `batch_write` (simpler)
- **6+ writes** OR **need atomicity**: Use transaction
- **Complex workflow**: Use transaction for rollback capability

## Advanced Batching Patterns

### Pattern 1: Read → Process → Batch Write

```typescript
// Step 1: Read data (1 API call)
const data = await read({
  action: 'read',
  spreadsheetId: 'xxx',
  range: 'A1:A100',
});

// Step 2: Process locally (0 API calls)
const updates = [];
for (let i = 0; i < data.values.length; i++) {
  const value = data.values[i][0];
  if (typeof value === 'number' && value > 100) {
    updates.push({
      range: `B${i + 1}`,
      values: [['HIGH']],
    });
  }
}

// Step 3: Batch write results (1 API call)
await batch_write({
  action: 'batch_write',
  spreadsheetId: 'xxx',
  data: updates,
});
```

**Total Quota**: 2 API calls (1 read + 1 batch write)
**vs Naive**: 100+ API calls (1 read + N writes)

### Pattern 2: Multi-Sheet Aggregation

```typescript
// Step 1: Batch read from multiple sheets (1 API call)
const allData = await batch_read({
  action: 'batch_read',
  spreadsheetId: 'xxx',
  ranges: ['Sheet1!A1:A100', 'Sheet2!A1:A100', 'Sheet3!A1:A100'],
});

// Step 2: Aggregate locally (0 API calls)
const totals = allData.valueRanges.map((range) =>
  range.values.reduce((sum, row) => sum + (row[0] || 0), 0)
);

// Step 3: Write aggregated results (1 API call)
await write({
  action: 'write',
  spreadsheetId: 'xxx',
  range: 'Summary!A1:A3',
  values: totals.map((t) => [t]),
});
```

**Total Quota**: 2 API calls (1 batch read + 1 write)
**vs Naive**: 302 API calls (100 reads × 3 sheets + 1 write + 1 summary read)

### Pattern 3: Conditional Batch Updates

```typescript
// Step 1: Read multiple ranges (1 API call)
const data = await batch_read({
  action: 'batch_read',
  spreadsheetId: 'xxx',
  ranges: ['A1:A100', 'B1:B100'],
});

// Step 2: Build conditional updates (0 API calls)
const updates = [];
const colA = data.valueRanges[0].values;
const colB = data.valueRanges[1].values;

for (let i = 0; i < colA.length; i++) {
  if (colA[i][0] > colB[i][0]) {
    updates.push({
      range: `C${i + 1}`,
      values: [['A > B']],
    });
  } else {
    updates.push({
      range: `C${i + 1}`,
      values: [['A <= B']],
    });
  }
}

// Step 3: Batch write (1 API call)
await batch_write({
  action: 'batch_write',
  spreadsheetId: 'xxx',
  data: updates,
});
```

**Total Quota**: 2 API calls
**vs Naive**: 201 API calls (2 column reads + 100 individual writes)

## Batching Performance Benchmarks

### Read Operations

| Scenario   | Without Batch         | With Batch         | Improvement |
| ---------- | --------------------- | ------------------ | ----------- |
| 10 ranges  | 10 API calls, ~1000ms | 1 API call, ~150ms | 85% faster  |
| 50 ranges  | 50 API calls, ~5000ms | 1 API call, ~400ms | 92% faster  |
| 100 ranges | 100 API calls, ~10s   | 1 API call, ~800ms | 92% faster  |

### Write Operations

| Scenario   | Without Batch         | With Batch          | Improvement |
| ---------- | --------------------- | ------------------- | ----------- |
| 10 writes  | 10 API calls, ~1500ms | 1 API call, ~200ms  | 87% faster  |
| 50 writes  | 50 API calls, ~7500ms | 1 API call, ~500ms  | 93% faster  |
| 100 writes | 100 API calls, ~15s   | 1 API call, ~1000ms | 93% faster  |

## Batching Limits

### Google Sheets API Limits

| Limit                  | Value     | Notes                 |
| ---------------------- | --------- | --------------------- |
| Max requests per batch | 100       | Google API hard limit |
| Max batch size         | 10 MB     | Total request payload |
| Max cells per update   | 5,000,000 | Per batchUpdate call  |

### ServalSheets Auto-Splitting

ServalSheets automatically splits batches that exceed limits:

```typescript
// You provide 150 operations
await batch_write({
  action: 'batch_write',
  spreadsheetId: 'xxx',
  data: array150Operations,
});

// ServalSheets automatically splits into:
// - Batch 1: 100 operations (1 API call)
// - Batch 2: 50 operations (1 API call)
// Total: 2 API calls (vs 150 without batching)
```

## Batching Anti-Patterns

### Anti-Pattern 1: Batching Single Operation

```typescript
// ❌ BAD: Unnecessary batching overhead
await batch_read({
  action: 'batch_read',
  spreadsheetId: 'xxx',
  ranges: ['A1:B10'], // Only 1 range!
});

// ✅ GOOD: Direct read
await read({
  action: 'read',
  spreadsheetId: 'xxx',
  range: 'A1:B10',
});
```

### Anti-Pattern 2: Batching Contiguous Ranges

```typescript
// ❌ BAD: Batch for adjacent ranges
await batch_read({
  action: 'batch_read',
  spreadsheetId: 'xxx',
  ranges: ['A1:A10', 'A11:A20', 'A21:A30'],
});

// ✅ GOOD: Single wide range
await read({
  action: 'read',
  spreadsheetId: 'xxx',
  range: 'A1:A30',
});
```

### Anti-Pattern 3: Over-Batching with Dependencies

```typescript
// ❌ BAD: Can't batch dependent operations
const value1 = await read({ action: 'read', spreadsheetId: 'xxx', range: 'A1' });
// Process value1 to determine next operation
const value2 = await read({ action: 'read', spreadsheetId: 'xxx', range: 'B1' });
// These CANNOT be batched because value2 depends on value1
```

**Solution**: Identify truly independent operations for batching

## Composite Actions (Pre-Batched)

ServalSheets provides composite actions that handle batching automatically:

### import_csv (Optimized Import)

```typescript
await import_csv({
  action: 'import_csv',
  spreadsheetId: 'xxx',
  sheetName: 'Data',
  csvData: '...', // Large CSV
  mode: 'append',
});

// Internally optimized:
// 1. Parse CSV locally (0 API calls)
// 2. Find last row (1 API call)
// 3. Batch write all rows (1 API call)
// Total: 2 API calls (vs 100+ for row-by-row)
```

### bulk_update (Batch Conditional Updates)

```typescript
await bulk_update({
  action: 'bulk_update',
  spreadsheetId: 'xxx',
  sheetName: 'Data',
  updates: [
    { column: 'Status', oldValue: 'Pending', newValue: 'Complete' },
    { column: 'Priority', oldValue: 'Low', newValue: 'Medium' },
  ],
});

// Internally optimized:
// 1. Read data (1 API call)
// 2. Find matches locally (0 API calls)
// 3. Batch write updates (1 API call)
// Total: 2 API calls
```

### smart_append (Optimized Append)

```typescript
await smart_append({
  action: 'smart_append',
  spreadsheetId: 'xxx',
  sheetName: 'Logs',
  values: [[timestamp, event, data]],
});

// Internally optimized:
// 1. Find last row (1 API call, cached)
// 2. Append (1 API call)
// Total: 2 API calls (1 if cached)
```

## Best Practices Summary

1. **Always batch 4+ operations** of the same type
2. **Use batch_read** for non-contiguous ranges
3. **Use transactions** for atomicity or 6+ writes
4. **Prefer composite actions** (import_csv, bulk_update) when available
5. **Don't batch contiguous ranges** - use wide ranges instead
6. **Process data locally** between batch read and batch write
7. **Let ServalSheets handle splitting** for large batches (>100 ops)

## Quick Reference

| Scenario                       | Solution          | Quota Cost |
| ------------------------------ | ----------------- | ---------- |
| Read 1 range                   | read              | 1 call     |
| Read 2-5 non-contiguous ranges | batch_read        | 1 call     |
| Read contiguous ranges         | read (wide range) | 1 call     |
| Write 2-5 independent updates  | batch_write       | 1 call     |
| Write 6+ updates (atomic)      | transaction       | 2 calls    |
| Import large CSV               | import_csv        | 2 calls    |
| Conditional bulk update        | bulk_update       | 2 calls    |

## Related Resources

- **Quota Optimization**: `servalsheets://guides/quota-optimization`
- **Transaction Decision Tree**: `servalsheets://decisions/when-to-use-transaction`
- **Composite Actions**: `docs/guides/COMPOSITE_OPERATIONS.md`
