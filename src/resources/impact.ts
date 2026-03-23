/**
 * ServalSheets - Impact Resources
 *
 * Exposes impact detector capabilities as MCP resources for discovery and reference.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getImpactAnalyzer } from '../services/impact-analyzer.js';

/**
 * Register impact resources with the MCP server
 */
export function registerImpactResources(server: McpServer): number {
  const impactAnalyzer = getImpactAnalyzer();

  // Resource 1: impact://stats - Impact analyzer statistics
  server.registerResource(
    'Impact Analyzer Statistics',
    'impact://stats',
    {
      description:
        'Impact analyzer statistics: total analyses, operations prevented, warnings issued',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const stats = impactAnalyzer.getStats();

        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  stats: {
                    totalAnalyses: stats.totalAnalyses,
                    operationsPrevented: stats.operationsPrevented,
                    avgAnalysisTime: `${(stats.avgAnalysisTime / 1000).toFixed(2)}s`,
                    totalWarnings: stats.totalWarnings,
                    warningsBySeverity: stats.warningsBySeverity,
                  },
                  summary: `Analyzed ${stats.totalAnalyses} operation(s), prevented ${stats.operationsPrevented} risky operation(s), issued ${stats.totalWarnings} warning(s)`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  error: 'Failed to fetch transaction statistics',
                  message: errorMessage,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  // Resource 2: impact://help - Transaction capabilities documentation
  server.registerResource(
    'Impact Detector Help',
    'impact://help',
    {
      description: 'Documentation for the impact detector: atomicity, rollback, batch operations',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      try {
        const helpText = `# Transaction Manager

## Overview
The impact detector provides multi-operation atomicity with automatic snapshots and rollback capabilities.

## Key Features

### 1. Atomicity
All operations in a transaction succeed together or fail together. No partial updates.

### 2. Automatic Snapshots
Before executing a transaction, a snapshot of the spreadsheet state is created for potential rollback.

### 3. Batch Operation Merging
Multiple operations are merged into a single Google Sheets API batch request.
**Result**: N operations → 1 API call (saves N-1 API calls)

### 4. Auto-Rollback
If any operation fails, the entire transaction is automatically rolled back to the snapshot.

## Usage

### Begin Transaction
\`\`\`typescript
{
  action: 'begin',
  spreadsheetId: 'your-spreadsheet-id',
  autoSnapshot: true,        // optional: default true
  autoRollback: true,        // optional: default true
  isolationLevel: 'read_committed'  // optional: default read_committed
}
\`\`\`

Returns: \`transactionId\` for subsequent operations

### Queue Operations
\`\`\`typescript
{
  action: 'queue',
  transactionId: 'transaction-id-from-begin',
  operation: {
    tool: 'sheets_data',
    action: 'write',
    params: {
      spreadsheetId: 'your-spreadsheet-id',
      range: 'Sheet1!A1:B10',
      values: [[1, 2], [3, 4]]
    }
  }
}
\`\`\`

Queue as many operations as needed. They will be batched into a single API call.

### Commit Transaction
\`\`\`typescript
{
  action: 'commit',
  transactionId: 'transaction-id-from-begin'
}
\`\`\`

Executes all queued operations atomically. Returns:
- \`success\`: true if all operations succeeded
- \`operationsExecuted\`: number of operations executed
- \`apiCallsSaved\`: number of API calls saved by batching
- \`duration\`: total execution time

If any operation fails and \`autoRollback\` is true, the spreadsheet is restored to the snapshot.

### Rollback Transaction
\`\`\`typescript
{
  action: 'rollback',
  transactionId: 'transaction-id-from-begin'
}
\`\`\`

Manually rollback a transaction to the snapshot (before any operations were executed).

### Check Status
\`\`\`typescript
{
  action: 'status',
  transactionId: 'transaction-id-from-begin'
}
\`\`\`

Returns:
- Transaction status: pending, queued, executing, committed, rolled_back, failed
- Number of queued operations
- Snapshot ID (if created)

### List Transactions
\`\`\`typescript
{
  action: 'list',
  spreadsheetId: 'your-spreadsheet-id'  // optional: filter by spreadsheet
}
\`\`\`

Returns list of active transactions.

## Isolation Levels

### read_uncommitted (Default)
Fastest. No isolation between transactions.

### read_committed
Ensures committed data is read. Prevents dirty reads.

### serializable
Strictest. Transactions execute as if they were serial.

## Example: Multi-Operation Atomic Update

\`\`\`typescript
// 1. Begin transaction
const txId = await sheets_transaction.begin({
  action: 'begin',
  spreadsheetId: 'abc123',
  autoRollback: true
});

// 2. Queue operations
await sheets_transaction.queue({
  action: 'queue',
  transactionId: txId,
  operation: {
    tool: 'sheets_data',
    action: 'write',
    params: { range: 'A1:A10', values: [[1], [2], [3]] }
  }
});

await sheets_transaction.queue({
  action: 'queue',
  transactionId: txId,
  operation: {
    tool: 'sheets_format',
    action: 'bold',
    params: { range: 'A1:A10' }
  }
});

await sheets_transaction.queue({
  action: 'queue',
  transactionId: txId,
  operation: {
    tool: 'sheets_data',
    action: 'write',
    params: { range: 'B1', values: [['Summary']] }
  }
});

// 3. Commit (all operations executed in single API call!)
const result = await sheets_transaction.commit({
  action: 'commit',
  transactionId: txId
});

console.log(\`Executed \${result.operationsExecuted} operations\`);
console.log(\`Saved \${result.apiCallsSaved} API calls\`);
\`\`\`

## Statistics
View transaction statistics at: impact://stats

## Configuration
Set environment variables:
- \`TRANSACTIONS_ENABLED\`: Enable/disable transactions (default: true)
- \`TRANSACTIONS_AUTO_SNAPSHOT\`: Auto-create snapshots (default: true)
- \`TRANSACTIONS_AUTO_ROLLBACK\`: Auto-rollback on error (default: true)
- \`TRANSACTIONS_MAX_OPERATIONS\`: Max operations per transaction (default: 100)
- \`TRANSACTIONS_TIMEOUT_MS\`: Transaction timeout (default: 300000 = 5 minutes)
- \`TRANSACTIONS_MAX_CONCURRENT\`: Max concurrent transactions (default: 10)
- \`TRANSACTIONS_VERBOSE\`: Verbose logging (default: false)

## Performance Impact

### Without Transactions
5 operations = 5 API calls = 5-10 seconds

### With Transactions
5 operations = 1 API call = 1-2 seconds
**Result**: 70-80% faster, 80% fewer API calls

## Safety Features

### Automatic Snapshots
Before every transaction, a snapshot captures the entire spreadsheet state.

### Rollback on Error
If any operation fails, the transaction is rolled back to the snapshot automatically.

### Timeout Protection
Transactions timeout after 5 minutes (configurable) to prevent hanging operations.

### Concurrent Transaction Limits
Maximum 10 concurrent transactions (configurable) to prevent resource exhaustion.
`;

        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'text/markdown',
              text: helpText,
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'text/plain',
              text: `Error fetching transaction help: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  // Note: Using console.error for MCP server startup output (visible to user)
  console.error('[ServalSheets] Registered 2 impact resources:');
  console.error('  - impact://stats (impact detector statistics)');
  console.error('  - impact://help (impact detector documentation)');

  return 2;
}
