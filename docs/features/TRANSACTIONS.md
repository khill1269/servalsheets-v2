# Transactions: Atomic Multi-Operation Workflows

## Overview

ServalSheets provides **ACID-compliant transactions** for multi-operation spreadsheet changes. This is a first-class capability across the platform—not a bolt-on feature. No competing Sheets MCP server offers transaction support.

A transaction guarantees that either all operations succeed or all fail, with automatic rollback and snapshot protection.

## The Problem: Partial Execution

Without transactions, a multi-step workflow can leave your spreadsheet in an inconsistent state:

```
Workflow: Add profit margin column + create summary + send notification
  ↓
Step 1: ✅ Column added successfully
Step 2: ✅ Summary created
Step 3: ❌ Network failure (notification fails)
  ↓
Result: Column exists, summary exists, but notification never sent.
→ Spreadsheet is in an intermediate, undocumented state.
```

With transactions:

```
Workflow: Same 3 steps in a transaction
  ↓
Step 1: ✅ Column added (in transaction buffer)
Step 2: ✅ Summary created (in transaction buffer)
Step 3: ❌ Network failure (rollback triggered)
  ↓
sheets_transaction.rollback()
  ↓
Result: All changes reverted. Spreadsheet returns to clean state.
```

## Core API: `sheets_transaction` Tool

The transaction lifecycle is controlled via 6 actions:

| Action   | Purpose                                                   | Input                            | Output                               |
| -------- | --------------------------------------------------------- | -------------------------------- | ------------------------------------ |
| `begin`  | Start a new transaction with optional description         | description?: string             | transactionId: string                |
| `commit` | Atomically apply all queued operations                    | transactionId: string            | appliedCount: number, summary: object |
| `rollback` | Discard all queued operations and restore snapshot       | transactionId: string            | restoredCells: number                |
| `status` | Get current state of a transaction (pending ops, progress) | transactionId: string            | state: TransactionState, queuedOps: number |
| `list`   | List all active transactions in this session              | none                             | transactions: Transaction[]          |
| `cleanup` | Force-cleanup orphaned transactions (ops timeout)        | transactionId?: string (optional) | cleaned: number                      |

## Three-Phase Transaction Model

### Phase 1: Begin

Open a transaction context:

```typescript
// API call
{
  "tool": "sheets_transaction",
  "action": "begin",
  "params": {
    "spreadsheetId": "1BxiMVs0XRA5nFMKUVfguc_lHSLv3GzCEujiF4MwWNAo",
    "description": "Q1 budget reconciliation"
  }
}

// Response
{
  "transactionId": "txn_92kd8f3_1711234567890",
  "status": "active",
  "createdAt": "2026-03-23T14:22:15Z",
  "expiresAt": "2026-03-23T14:32:15Z"  // 10-minute timeout
}
```

All subsequent operations are queued **without executing**.

### Phase 2: Queue Operations (Agent Mode Recommended)

Operations are queued via standard tool calls, tagged with the transaction ID:

```typescript
// Queue operation 1: Write formula
{
  "tool": "sheets_data",
  "action": "write",
  "params": {
    "spreadsheetId": "...",
    "range": "Sheet1!E2",
    "values": [["=(B2-C2)/B2"]],
    "_transactionId": "txn_92kd8f3_1711234567890"
  }
}

// Queue operation 2: Apply formatting
{
  "tool": "sheets_format",
  "action": "set_number_format",
  "params": {
    "spreadsheetId": "...",
    "range": "Sheet1!E2:E100",
    "numberFormat": "0.0%",
    "_transactionId": "txn_92kd8f3_1711234567890"
  }
}

// Queue operation 3: Create chart
{
  "tool": "sheets_visualize",
  "action": "chart_create",
  "params": {
    "spreadsheetId": "...",
    "sheetId": 0,
    "chartType": "LINE",
    "data": {"range": "Sheet1!A1:E100"},
    "_transactionId": "txn_92kd8f3_1711234567890"
  }
}
```

Each operation is **validated but not executed**. The response includes a "queued" status:

```json
{
  "queued": true,
  "queuePosition": 1,
  "transactionId": "txn_92kd8f3_1711234567890"
}
```

### Phase 3: Commit or Rollback

After all operations are queued, commit atomically:

```typescript
// Commit all 3 operations in one atomic batch
{
  "tool": "sheets_transaction",
  "action": "commit",
  "params": {
    "transactionId": "txn_92kd8f3_1711234567890"
  }
}

// Response
{
  "success": true,
  "appliedCount": 3,
  "summary": {
    "cellsModified": 147,
    "formulas": 99,
    "formatting": 48,
    "apiCalls": 1
  }
}
```

Or rollback if something goes wrong:

```typescript
{
  "tool": "sheets_transaction",
  "action": "rollback",
  "params": {
    "transactionId": "txn_92kd8f3_1711234567890"
  }
}

// Response
{
  "success": true,
  "restoredCells": 147,
  "snapshot": "snap_2c8d4e_1711234567890"  // For audit trail
}
```

## Snapshot-Based Rollback

Every transaction automatically creates a **snapshot** before any changes:

```
Transaction begins
  ↓
Spreadsheet state saved to hidden snapshot sheet
  ↓
Operations queued and executed
  ↓
If rollback needed:
  → Hidden sheet is restored
  → All changes reverted atomically
  → Original snapshot kept for audit
```

Snapshots are stored in a hidden `__serval_snapshots` sheet (not visible to users).

**Example:**

```
Before transaction: Column E doesn't exist, 1000 rows of data
  ↓
Snapshot created: E1:E1000 empty
  ↓
Operations: Write formulas to E2:E1000
  ↓
Network fails during commit
  ↓
Rollback: Delete column E (restore original state)
```

## Write-Ahead Log (WAL)

For durability, all transaction operations are logged to a Write-Ahead Log:

```
Transaction begins
  ↓
WAL entry created: "txn_xxx BEGIN"
  ↓
Each operation logged: "txn_xxx OP_1: sheets_data.write E2"
  ↓
Commit logged: "txn_xxx COMMIT"
  ↓
Process crashes
  ↓
On restart: WAL recovered
  - If "COMMIT" found: nothing to do
  - If no "COMMIT": orphaned txn cleaned up, snapshot restored
```

This guarantees **no lost data** even if the server crashes mid-commit.

## Example Workflow: Monthly Close

A typical month-end reconciliation uses transactions:

```typescript
const txn = await client.beginTransaction({
  spreadsheetId: "...",
  description: "March 2026 close"
});

// Queue all operations (no execution yet)
await client.queueOperation({
  tool: "sheets_data",
  action: "read",
  params: { range: "Journal!A1:D50000", transactionId: txn.id }
});

await client.queueOperation({
  tool: "sheets_composite",
  action: "import_csv",
  params: { csvData: bankStatement, transactionId: txn.id }
});

await client.queueOperation({
  tool: "sheets_data",
  action: "cross_read",
  params: {
    sources: [
      { spreadsheetId: journalSheet, range: "Journal!A:D" },
      { spreadsheetId: bankSheet, range: "Bank!A:D" }
    ],
    joinKey: "TransactionID",
    transactionId: txn.id
  }
});

await client.queueOperation({
  tool: "sheets_fix",
  action: "clean",
  params: { range: "Reconciliation!A:D", transactionId: txn.id }
});

// All queued. Now commit atomically.
const result = await client.commitTransaction(txn.id);
// → All 4 operations executed in 1 API call
// → If any fails: all 4 rolled back
```

**Result:** 4 logical operations, 1 API call, 100% atomicity guaranteed.

## Transaction Isolation

Transactions are isolated by default:

- **Your transaction:** Sees only its own changes
- **Other users:** Cannot see queued operations until commit
- **Conflicts:** If another user modifies the same range during your transaction:
  - Detected at commit time
  - Transaction fails with `ConflictError`
  - Rollback to snapshot happens automatically
  - User must retry with fresh data

## Key Advantages Over Competitors

| Feature                      | ServalSheets | Google Sheets | Copilot | Other MCP |
| ---------------------------- | ------------ | ------------- | ------- | --------- |
| ACID transactions            | ✅           | ❌            | ❌      | ❌        |
| Atomic multi-operation       | ✅           | ❌            | ❌      | ❌        |
| WAL-based durability         | ✅           | ❌            | ❌      | ❌        |
| Automatic snapshot backup    | ✅           | ❌            | ❌      | ❌        |
| Conflict detection           | ✅           | ⚠️ (manual)   | ❌      | ❌        |
| Rollback to snapshot         | ✅           | ❌            | ❌      | ❌        |
| Audit trail (WAL)            | ✅           | ❌            | ❌      | ❌        |
| Supports all 25 tools        | ✅           | N/A           | N/A     | N/A       |

## Configuration

```bash
# src/config/env.ts
ENABLE_TRANSACTIONS=true              # Default: enabled
TRANSACTION_TIMEOUT_MS=600000         # 10 minutes
MAX_PENDING_OPS_PER_TRANSACTION=100   # Safety limit
ENABLE_WAL_PERSISTENCE=true           # Durable log
WAL_CLEANUP_INTERVAL_MS=300000        # Orphan cleanup every 5 min
```

## Performance Impact

Transactions have minimal overhead:

- **Queuing:** <1ms per operation (no API call)
- **Commit:** Same as batch execute (1 batchUpdate for all ops)
- **Snapshot creation:** ~100-200ms (scales with data size)
- **Rollback:** ~200-500ms (restore from snapshot)

For a 100-operation transaction: ~500ms total (vs. 100 × 4s = 400s without transactions).

## Error Handling

```typescript
// Operation fails validation during queue:
{
  "error": {
    "code": "INVALID_RANGE",
    "message": "Range 'Sheet999' does not exist"
  }
  "transactionId": "txn_xxx",
  "queuePosition": 3,
  "suggestion": "Check sheet names and try again"
}

// Conflict detected at commit:
{
  "error": {
    "code": "CONCURRENT_MODIFICATION",
    "message": "Range E1:E100 was modified by another user",
    "conflictingCell": "E42",
    "theirValue": 5000,
    "ourValue": 5500
  },
  "snapshot": "snap_xxx"  // Rollback snapshot available
}
```

## Summary

Transactions are the foundation for **production-grade spreadsheet automation**. They enable:

- **Reliability:** All-or-nothing execution prevents partial states
- **Durability:** WAL guarantees recovery from crashes
- **Auditability:** Every operation logged for compliance
- **Performance:** Batched execution (80-95% API call reduction)
- **Confidence:** Automatic snapshots provide rollback safety

Combined with Agent Mode, transactions enable complex workflows with enterprise-grade guarantees.

**Next:** See `AGENT_MODE.md` for how transactions power single-call multi-step execution.
