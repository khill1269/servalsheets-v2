/**
 * Tool: sheets_transaction
 * Multi-operation transaction support with atomicity and auto-rollback.
 */

import { z } from 'zod';
import { ErrorDetailSchema, ResponseMetaSchema, type ToolAnnotations } from './shared.js';

// ============================================================================
// Common Schemas
// ============================================================================

const CommonFieldsSchema = z.object({
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe(
      'Response detail level: minimal (essential info only, ~40% less tokens), standard (balanced), detailed (full metadata)'
    ),
});

// ============================================================================
// Individual Action Schemas
// ============================================================================

const BeginActionSchema = CommonFieldsSchema.extend({
  action: z.literal('begin').describe('Begin a new transaction'),
  spreadsheetId: z
    .string()
    .min(1)
    .describe(
      'Spreadsheet ID from the Google Sheets URL (the long alphanumeric string between /d/ and /edit). ' +
        'All queued operations in this transaction will target this spreadsheet. ' +
        'Example: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"'
    ),
  autoSnapshot: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'NOTE: Currently ignored — snapshots are controlled by server config. ' +
        'Metadata-only snapshots may fail for spreadsheets with >50MB metadata (spreadsheets with many sheets). ' +
        'For large spreadsheets, use sheets_history action:"create_snapshot" before the transaction instead.'
    ),
  autoRollback: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Whether to automatically attempt rollback when a queued operation fails during commit (default: false). ' +
        'WARNING: Automatic rollback cannot undo in-place writes — it requires manual recovery via ' +
        'sheets_history action:"undo" or version restore. ' +
        'Set to true only for non-critical transactions where partial rollback is acceptable.'
    ),
  isolationLevel: z
    .enum(['read_uncommitted', 'read_committed', 'serializable'])
    .optional()
    .default('read_committed')
    .describe(
      'Transaction isolation level (default: read_committed). ' +
        '"read_uncommitted": reads may see uncommitted changes from other transactions (fastest, least safe). ' +
        '"read_committed": reads only see committed data (default — recommended for most use cases). ' +
        '"serializable": full isolation, transactions execute as if sequential (slowest, safest for audits).'
    ),
});

const QueueActionSchema = CommonFieldsSchema.extend({
  action: z.literal('queue').describe('Queue an operation in the transaction'),
  transactionId: z
    .string()
    .min(1)
    .describe(
      'Transaction ID returned by the begin action. ' +
        'All queued operations with this ID are executed atomically on commit. ' +
        'Example: "txn_1709123456789_abc123"'
    ),
  operation: z.preprocess(
    (val) => {
      if (typeof val !== 'object' || val === null) return val;
      const op = val as Record<string, unknown>;
      // If tool and action are present but params is absent, collect remaining fields into params
      if (
        typeof op['tool'] === 'string' &&
        typeof op['action'] === 'string' &&
        op['params'] === undefined
      ) {
        const { tool, action, ...rest } = op;
        return { tool, action, params: rest };
      }
      return val;
    },
    z
      .object({
        tool: z
          .string()
          .min(1)
          .max(100, 'Tool name exceeds 100 character limit')
          .describe('Tool name (e.g., sheets_data, sheets_format)'),
        action: z
          .string()
          .min(1)
          .max(100, 'Action name exceeds 100 character limit')
          .describe('Action name (e.g., write, update, format)'),
        params: z
          .record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.null(),
              z.array(z.any()),
              z.record(z.string(), z.any()),
            ])
          )
          .describe('Operation parameters (string, number, boolean, null, array, or object)'),
      })
      .describe('Operation to queue for batch execution')
  ),
});

const CommitActionSchema = CommonFieldsSchema.extend({
  action: z.literal('commit').describe('Commit a transaction (execute all queued operations)'),
  transactionId: z
    .string()
    .min(1)
    .describe(
      'Transaction ID from the begin response. Executes all queued operations in order. ' +
        'Example: "txn_1709123456789_abc123"'
    ),
});

const RollbackActionSchema = CommonFieldsSchema.extend({
  action: z.literal('rollback').describe('Rollback a transaction (discard all queued operations)'),
  transactionId: z
    .string()
    .min(1)
    .describe(
      'Transaction ID from the begin response. Discards all queued operations without executing them. ' +
        'Safe to call even if the transaction has already failed. ' +
        'Example: "txn_1709123456789_abc123"'
    ),
});

const StatusActionSchema = CommonFieldsSchema.extend({
  action: z.literal('status').describe('Get status of a transaction'),
  transactionId: z
    .string()
    .min(1)
    .describe(
      'Transaction ID from the begin response. Returns current status: ' +
        'pending (not yet committed), queued (operations waiting), executing (commit in progress), ' +
        'committed (complete), rolled_back (discarded), or failed. ' +
        'Example: "txn_1709123456789_abc123"'
    ),
});

const ListActionSchema = CommonFieldsSchema.extend({
  action: z.literal('list').describe('List all active transactions'),
  spreadsheetId: z
    .string()
    .min(1)
    .optional()
    .describe('Filter by spreadsheet ID (omit to show all)'),
});

// ============================================================================
// Combined Input Schema
// ============================================================================

/**
 * All transaction operation inputs
 *
 * Proper discriminated union using Zod v4's z.discriminatedUnion() for:
 * - Better type safety at compile-time
 * - Clearer error messages for LLMs
 * - Each action has only its required fields (no optional field pollution)
 * - JSON Schema conversion handled by src/utils/schema-compat.ts
 */
export const SheetsTransactionInputSchema = z.object({
  request: z.discriminatedUnion('action', [
    BeginActionSchema,
    QueueActionSchema,
    CommitActionSchema,
    RollbackActionSchema,
    StatusActionSchema,
    ListActionSchema,
  ]),
});

const TransactionResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    action: z.string(),
    transactionId: z.string().optional().describe('Transaction ID'),
    status: z
      .enum(['pending', 'queued', 'executing', 'committed', 'rolled_back', 'failed'])
      .optional(),
    operationsQueued: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Number of operations queued'),
    operationsExecuted: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Number of operations executed'),
    apiCallsSaved: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe('API calls saved by batching'),
    duration: z.coerce.number().optional().describe('Execution duration in ms'),
    snapshotId: z.string().optional().describe('Snapshot ID for rollback'),
    message: z.string().optional(),
    transactions: z
      .array(
        z.object({
          id: z.string(),
          spreadsheetId: z.string(),
          status: z.string(),
          operationCount: z.coerce.number(),
          created: z.string(),
          updated: z.string().optional().describe('Last update time'),
          duration: z.coerce.number().optional().describe('Transaction duration in ms'),
          isolationLevel: z
            .enum(['read_uncommitted', 'read_committed', 'serializable'])
            .optional()
            .describe('Transaction isolation level'),
          snapshotId: z.string().optional().describe('Associated snapshot ID'),
        })
      )
      .optional()
      .describe('List of active transactions'),
    walOrphans: z
      .array(
        z.object({
          transactionId: z.string(),
          spreadsheetId: z.string().optional(),
          snapshotId: z.string().optional(),
          queuedOperations: z.number().int().min(0),
          lastEventType: z.string(),
          lastEventTimestamp: z.number(),
        })
      )
      .optional()
      .describe(
        'Orphaned transactions from WAL crash recovery — call rollback to discard each one'
      ),
    walEnabled: z.boolean().optional().describe('Whether WAL crash recovery is active'),
    _meta: ResponseMetaSchema.optional(),
  }),
  z.object({
    success: z.literal(false),
    error: ErrorDetailSchema,
  }),
]);

export const SheetsTransactionOutputSchema = z.object({
  response: TransactionResponseSchema,
});

export const SHEETS_TRANSACTION_ANNOTATIONS: ToolAnnotations = {
  title: 'Transaction Support',
  readOnlyHint: false,
  destructiveHint: true, // commit applies batched mutations to Google Sheets
  idempotentHint: false,
  openWorldHint: true, // commit calls Google Sheets API
};

export type SheetsTransactionInput = z.infer<typeof SheetsTransactionInputSchema>;
export type SheetsTransactionOutput = z.infer<typeof SheetsTransactionOutputSchema>;
export type TransactionResponse = z.infer<typeof TransactionResponseSchema>;
/** The unwrapped request type (the discriminated union of actions) */
export type TransactionRequest = SheetsTransactionInput['request'];

// Type narrowing helpers for handler methods
// These provide type safety similar to discriminated union Extract<>
export type TransactionBeginInput = SheetsTransactionInput['request'] & {
  action: 'begin';
  spreadsheetId: string;
};
export type TransactionQueueInput = SheetsTransactionInput['request'] & {
  action: 'queue';
  transactionId: string;
  operation: { tool: string; action: string; params: Record<string, unknown> };
};
export type TransactionCommitInput = SheetsTransactionInput['request'] & {
  action: 'commit';
  transactionId: string;
};
export type TransactionRollbackInput = SheetsTransactionInput['request'] & {
  action: 'rollback';
  transactionId: string;
};
export type TransactionStatusInput = SheetsTransactionInput['request'] & {
  action: 'status';
  transactionId: string;
};
export type TransactionListInput = SheetsTransactionInput['request'] & { action: 'list' };
