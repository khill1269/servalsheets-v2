/**
 * ServalSheets - Transaction Types
 *
 * Type definitions for transaction support system:
 * - Multi-operation atomicity
 * - Automatic snapshots and rollback
 * - Batch operation merging
 * - Transaction lifecycle management
 *
 * Phase 4, Task 4.1
 */

import type { GoogleApiClient } from '../services/google-api.js';

/**
 * Transaction status
 */
export type TransactionStatus =
  | 'pending'
  | 'queued'
  | 'executing'
  | 'committed'
  | 'rolled_back'
  | 'failed';

/**
 * Operation type for transaction queuing
 */
export type OperationType =
  | 'values_write'
  | 'values_append'
  | 'values_update'
  | 'format_apply'
  | 'sheet_create'
  | 'sheet_delete'
  | 'cell_merge'
  | 'cell_unmerge'
  | 'row_insert'
  | 'row_delete'
  | 'column_insert'
  | 'column_delete'
  | 'formula_write'
  | 'validation_add'
  | 'custom';

/**
 * Queued operation within a transaction
 */
export interface QueuedOperation {
  /** Operation ID */
  id: string;

  /** Operation type */
  type: OperationType;

  /** Tool name */
  tool: string;

  /** Action name */
  action: string;

  /** Operation parameters */
  params: Record<string, unknown>;

  /** Order within transaction */
  order: number;

  /** Estimated duration in ms */
  estimatedDuration?: number;

  /** Dependencies on other operations */
  dependsOn?: string[];

  /** Operation status */
  status: 'pending' | 'executing' | 'completed' | 'failed';

  /** Result (when completed) */
  result?: unknown;

  /** Error (when failed) */
  error?: Error;

  /** Execution duration */
  duration?: number;

  /** Timestamp */
  timestamp: number;
}

/**
 * Transaction snapshot for rollback
 */
export interface TransactionSnapshot {
  /** Snapshot ID */
  id: string;

  /** Spreadsheet ID */
  spreadsheetId: string;

  /** Spreadsheet state */
  state: SpreadsheetState;

  /** Timestamp */
  timestamp: number;

  /** Size in bytes */
  size?: number;

  /** Metadata */
  metadata?: Record<string, unknown>;

  /**
   * Pre-commit cell data captured immediately before batchUpdate execution.
   * Present only for transactions that include write/clear operations.
   * Used by restoreSnapshot() to write back the original values on rollback.
   */
  preCommitCellData?: Array<{ range: string; values: unknown[][] }>;
}

/**
 * Spreadsheet state for snapshot
 */
export interface SpreadsheetState {
  /** Spreadsheet properties */
  properties: Record<string, unknown>;

  /** Sheet data */
  sheets: SheetState[];

  /** Named ranges */
  namedRanges?: NamedRangeState[];

  /** Developer metadata */
  developerMetadata?: MetadataState[];
}

/**
 * Sheet state within snapshot
 */
export interface SheetState {
  /** Sheet ID */
  sheetId: number;

  /** Sheet name */
  title: string;

  /** Grid properties */
  gridProperties: {
    rowCount: number;
    columnCount: number;
    frozenRowCount?: number;
    frozenColumnCount?: number;
  };

  /** Cell data */
  data?: CellData[][];

  /** Merged cells */
  merges?: MergeState[];

  /** Conditional format rules */
  conditionalFormats?: ConditionalFormatState[];

  /** Protected ranges */
  protectedRanges?: ProtectedRangeState[];
}

/**
 * Cell data for snapshot
 */
export interface CellData {
  /** User-entered value */
  userEnteredValue?: unknown;

  /** Effective value */
  effectiveValue?: unknown;

  /** Formatted value */
  formattedValue?: string;

  /** User-entered format */
  userEnteredFormat?: Record<string, unknown>;

  /** Effective format */
  effectiveFormat?: Record<string, unknown>;

  /** Note */
  note?: string;
}

/**
 * Merge state
 */
export interface MergeState {
  range: {
    sheetId: number;
    startRowIndex: number;
    endRowIndex: number;
    startColumnIndex: number;
    endColumnIndex: number;
  };
}

/**
 * Conditional format state
 */
export interface ConditionalFormatState {
  ranges: Array<{
    sheetId: number;
    startRowIndex: number;
    endRowIndex: number;
    startColumnIndex: number;
    endColumnIndex: number;
  }>;
  rule: Record<string, unknown>;
}

/**
 * Protected range state
 */
export interface ProtectedRangeState {
  protectedRangeId: number;
  range?: {
    sheetId: number;
    startRowIndex: number;
    endRowIndex: number;
    startColumnIndex: number;
    endColumnIndex: number;
  };
  editors?: {
    users?: string[];
    groups?: string[];
    domainUsersCanEdit?: boolean;
  };
  description?: string;
  warningOnly?: boolean;
}

/**
 * Named range state
 */
export interface NamedRangeState {
  namedRangeId: string;
  name: string;
  range: {
    sheetId: number;
    startRowIndex: number;
    endRowIndex: number;
    startColumnIndex: number;
    endColumnIndex: number;
  };
}

/**
 * Metadata state
 */
export interface MetadataState {
  metadataId: number;
  metadataKey: string;
  metadataValue: string;
  visibility: 'DOCUMENT' | 'PROJECT';
}

/**
 * Transaction definition
 */
export interface Transaction {
  /** Transaction ID */
  id: string;

  /** Spreadsheet ID */
  spreadsheetId: string;

  /** Queued operations */
  operations: QueuedOperation[];

  /** Snapshot before execution */
  snapshot?: TransactionSnapshot;

  /** Transaction status */
  status: TransactionStatus;

  /** Start time */
  startTime?: number;

  /** End time */
  endTime?: number;

  /** Total duration */
  duration?: number;

  /** User who initiated */
  userId?: string;

  /** Isolation level */
  isolationLevel?: 'read_uncommitted' | 'read_committed' | 'serializable';

  /** Auto-commit */
  autoCommit?: boolean;

  /** Auto-rollback on error */
  autoRollback?: boolean;

  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Transaction commit result
 */
export interface CommitResult {
  /** Transaction ID */
  transactionId: string;

  /** Success */
  success: boolean;

  /** Batch API response */
  batchResponse?: unknown;

  /** Operation results */
  operationResults: OperationResult[];

  /** Total duration */
  duration: number;

  /** API calls made */
  apiCallsMade: number;

  /** API calls saved (vs individual calls) */
  apiCallsSaved: number;

  /** Error (if failed) */
  error?: Error;

  /** Rolled back */
  rolledBack?: boolean;

  /** Snapshot ID (for manual rollback) */
  snapshotId?: string;
}

/**
 * Individual operation result
 */
export interface OperationResult {
  /** Operation ID */
  operationId: string;

  /** Success */
  success: boolean;

  /** Result data */
  data?: unknown;

  /** Duration */
  duration: number;

  /** Error */
  error?: Error;
}

/**
 * Transaction rollback result
 */
export interface RollbackResult {
  /** Transaction ID */
  transactionId: string;

  /** Success */
  success: boolean;

  /** Snapshot restored */
  snapshotId: string;

  /** Duration */
  duration: number;

  /** Operations reverted */
  operationsReverted: number;

  /** Error */
  error?: Error;
}

/**
 * Batch request for Google Sheets API
 */
export interface BatchRequest {
  /** Requests */
  requests: BatchRequestEntry[];

  /** Include gridData in response */
  includeSpreadsheetInResponse?: boolean;

  /** Response ranges */
  responseRanges?: string[];

  /** Response include grid data */
  responseIncludeGridData?: boolean;
}

/**
 * Single batch request entry
 */
export interface BatchRequestEntry {
  /** Update cells */
  updateCells?: unknown;

  /** Update sheet properties */
  updateSheetProperties?: unknown;

  /** Add sheet */
  addSheet?: unknown;

  /** Delete sheet */
  deleteSheet?: unknown;

  /** Append cells */
  appendCells?: unknown;

  /** Merge cells */
  mergeCells?: unknown;

  /** Unmerge cells */
  unmergeCells?: unknown;

  /** Insert range */
  insertRange?: unknown;

  /** Delete range */
  deleteRange?: unknown;

  /** Update dimension properties */
  updateDimensionProperties?: unknown;

  /** Add conditional format rule */
  addConditionalFormatRule?: unknown;

  /** Update conditional format rule */
  updateConditionalFormatRule?: unknown;

  /** Delete conditional format rule */
  deleteConditionalFormatRule?: unknown;

  /** Add named range */
  addNamedRange?: unknown;

  /** Delete named range */
  deleteNamedRange?: unknown;

  /** Add protected range */
  addProtectedRange?: unknown;

  /** Update protected range */
  updateProtectedRange?: unknown;

  /** Delete protected range */
  deleteProtectedRange?: unknown;
}

/**
 * Transaction manager configuration
 */
export interface TransactionConfig {
  /** Enable transactions */
  enabled?: boolean;

  /** Auto-create snapshots before transactions */
  autoSnapshot?: boolean;

  /** Auto-rollback on any error */
  autoRollback?: boolean;

  /** Max operations per transaction */
  maxOperationsPerTransaction?: number;

  /** Transaction timeout (ms) */
  transactionTimeoutMs?: number;

  /** Snapshot retention (ms) */
  snapshotRetentionMs?: number;

  /** Max concurrent transactions */
  maxConcurrentTransactions?: number;

  /** Enable verbose logging */
  verboseLogging?: boolean;

  /** Default isolation level */
  defaultIsolationLevel?: 'read_uncommitted' | 'read_committed' | 'serializable';

  /** Google API client for batch operations */
  googleClient?: GoogleApiClient;

  /** Optional transaction WAL directory for crash recovery */
  walDir?: string;
}

/**
 * Transaction manager statistics
 */
export interface TransactionStats {
  /** Total transactions */
  totalTransactions: number;

  /** Successful transactions */
  successfulTransactions: number;

  /** Failed transactions */
  failedTransactions: number;

  /** Rolled back transactions */
  rolledBackTransactions: number;

  /** Success rate */
  successRate: number;

  /** Average transaction duration */
  avgTransactionDuration: number;

  /** Average operations per transaction */
  avgOperationsPerTransaction: number;

  /** Total API calls saved */
  apiCallsSaved: number;

  /** Total snapshots created */
  snapshotsCreated: number;

  /** Active transactions */
  activeTransactions: number;

  /** Total data processed (bytes) */
  totalDataProcessed: number;
}

/**
 * Snapshot service configuration
 */
export interface SnapshotConfig {
  /** Enable snapshots */
  enabled?: boolean;

  /** Compression enabled */
  compression?: boolean;

  /** Max snapshot size (bytes) */
  maxSnapshotSize?: number;

  /** Snapshot storage path */
  storagePath?: string;

  /** Auto-cleanup old snapshots */
  autoCleanup?: boolean;

  /** Snapshot retention period (ms) */
  retentionPeriodMs?: number;

  /** Verbose logging */
  verboseLogging?: boolean;
}

/**
 * Transaction isolation level
 */
export type IsolationLevel = 'read_uncommitted' | 'read_committed' | 'serializable';

/**
 * Transaction event
 */
export interface TransactionEvent {
  /** Event type */
  type: 'begin' | 'queue' | 'commit' | 'rollback' | 'fail';

  /** Transaction ID */
  transactionId: string;

  /** Timestamp */
  timestamp: number;

  /** Event data */
  data?: unknown;
}

/**
 * Transaction listener
 */
export type TransactionListener = (event: TransactionEvent) => void;
