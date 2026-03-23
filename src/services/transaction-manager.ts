/**
 * TransactionManager
 *
 * @purpose Atomic multi-operation transactions with automatic snapshots, rollback, and 80% API savings (N ops → 1 batchUpdate)
 * @category Core
 * @usage Use for multi-step operations requiring atomicity; queues operations, creates snapshot, executes as single batch, rolls back on error
 * @dependencies sheets_v4, logger, uuid
 * @stateful Yes - maintains active transactions map (txId → state), queued operations, snapshots, metrics (commits, rollbacks, API savings)
 * @singleton Yes - one instance per process to coordinate transactions and prevent conflicts
 *
 * @example
 * const txManager = new TransactionManager(sheetsClient, { autoSnapshot: true, timeout: 30000 });
 * const tx = await txManager.begin(spreadsheetId);
 * await txManager.queue(tx.id, { type: 'write', range: 'A1', values: [[1]] });
 * await txManager.queue(tx.id, { type: 'format', range: 'A1', format: { bold: true } });
 * await txManager.commit(tx.id); // Both ops in single API call
 */

import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import type { sheets_v4 } from 'googleapis';
import {
  buildA1Notation,
  buildGridRangeInput,
  parseA1Notation,
  toGridRange,
} from '../utils/google-sheets-helpers.js';
import {
  Transaction,
  TransactionStatus as _TransactionStatus,
  QueuedOperation,
  OperationType,
  TransactionSnapshot,
  CommitResult,
  RollbackResult,
  OperationResult,
  BatchRequest,
  BatchRequestEntry,
  SpreadsheetState,
  TransactionConfig,
  TransactionStats,
  TransactionEvent,
  TransactionListener,
} from '../types/transaction.js';
import { registerCleanup } from '../utils/resource-cleanup.js';
import { getEnv } from '../config/env.js';
import { ServiceError, ValidationError, NotFoundError } from '../core/errors.js';
import { WalManager } from './transaction-wal.js';
import type { WalRecoveryReport } from './transaction-wal.js';
export type { WalRecoveryReport } from './transaction-wal.js';

interface SheetLookupContext {
  nameToId: Map<string, number>;
  idToName: Map<number, string>;
  defaultSheetId?: number;
  pendingSheetNames: Set<string>;
  nextSyntheticSheetId: number;
}

interface PreparedBatchRequest {
  batchRequest: BatchRequest;
  requestCounts: number[];
}

/**
 * Transaction Manager - Handles multi-operation transactions with atomicity
 */
export class TransactionManager {
  private config: Required<Omit<TransactionConfig, 'googleClient' | 'walDir'>>;
  private googleClient?: TransactionConfig['googleClient'];
  private stats: TransactionStats;
  private activeTransactions: Map<string, Transaction>;
  private snapshots: Map<string, TransactionSnapshot>;
  private listeners: TransactionListener[];
  private operationIdCounter: number;
  // Phase 1: Timer cleanup
  private snapshotCleanupInterval?: NodeJS.Timeout;
  // DR-01: Write-ahead log (null when WAL is disabled)
  private wal: WalManager | null;

  constructor(config: TransactionConfig = {}) {
    this.googleClient = config.googleClient;
    this.config = {
      enabled: config.enabled ?? true,
      autoSnapshot: config.autoSnapshot ?? true,
      autoRollback: config.autoRollback ?? false,
      maxOperationsPerTransaction: config.maxOperationsPerTransaction ?? 100,
      transactionTimeoutMs: config.transactionTimeoutMs ?? 300000, // 5 minutes
      snapshotRetentionMs: config.snapshotRetentionMs ?? 3600000, // 1 hour
      maxConcurrentTransactions: config.maxConcurrentTransactions ?? 10,
      verboseLogging: config.verboseLogging ?? false,
      defaultIsolationLevel: config.defaultIsolationLevel ?? 'read_committed',
    };

    this.stats = {
      totalTransactions: 0,
      successfulTransactions: 0,
      failedTransactions: 0,
      rolledBackTransactions: 0,
      successRate: 0,
      avgTransactionDuration: 0,
      avgOperationsPerTransaction: 0,
      apiCallsSaved: 0,
      snapshotsCreated: 0,
      activeTransactions: 0,
      totalDataProcessed: 0,
    };

    this.activeTransactions = new Map();
    this.snapshots = new Map();
    this.listeners = [];
    this.operationIdCounter = 0;

    // Start background cleanup
    this.startSnapshotCleanup();

    // DR-01: Initialize write-ahead log (enabled when TRANSACTION_WAL_DIR is set)
    const walDir = config.walDir ?? process.env['TRANSACTION_WAL_DIR'];
    this.wal = walDir ? new WalManager(join(walDir, 'transactions.wal.jsonl')) : null;
  }

  /**
   * Begin a new transaction
   */
  async begin(
    spreadsheetId: string,
    options: {
      autoCommit?: boolean;
      autoRollback?: boolean;
      autoSnapshot?: boolean;
      isolationLevel?: 'read_uncommitted' | 'read_committed' | 'serializable';
      userId?: string;
    } = {}
  ): Promise<string> {
    if (!this.config.enabled) {
      throw new ServiceError('Transactions are disabled', 'CONFIG_ERROR', 'TransactionManager');
    }

    if (this.activeTransactions.size >= this.config.maxConcurrentTransactions) {
      throw new ServiceError(
        'Maximum concurrent transactions reached',
        'QUOTA_EXCEEDED',
        'TransactionManager',
        true
      );
    }

    const transactionId = uuidv4();
    this.log(`Beginning transaction: ${transactionId}`);

    // Create snapshot if auto-snapshot enabled (per-call option overrides config)
    const takeSnapshot =
      options.autoSnapshot !== undefined ? options.autoSnapshot : this.config.autoSnapshot;
    let snapshot: TransactionSnapshot | undefined;
    if (takeSnapshot) {
      snapshot = await this.createSnapshot(spreadsheetId);
      this.log(`Created snapshot: ${snapshot.id}`);
    }

    const transaction: Transaction = {
      id: transactionId,
      spreadsheetId,
      operations: [],
      snapshot,
      status: 'pending',
      startTime: Date.now(),
      userId: options.userId,
      isolationLevel: options.isolationLevel ?? this.config.defaultIsolationLevel,
      autoCommit: options.autoCommit ?? false,
      autoRollback: options.autoRollback ?? this.config.autoRollback,
    };

    this.activeTransactions.set(transactionId, transaction);
    this.stats.totalTransactions++;
    this.stats.activeTransactions++;

    await this.emitEvent({
      type: 'begin',
      transactionId,
      timestamp: Date.now(),
      data: { spreadsheetId, snapshot: snapshot?.id },
    });

    return transactionId;
  }

  /**
   * Queue an operation in the transaction
   */
  async queue(
    transactionId: string,
    operation: {
      type: OperationType;
      tool: string;
      action: string;
      params: Record<string, unknown>;
      dependsOn?: string[];
      estimatedDuration?: number;
    }
  ): Promise<string> {
    const transaction = this.getTransaction(transactionId);

    // FIX: Allow both 'pending' and 'queued' states (Issue #4)
    // After first queue(), status changes to 'queued', so we need to accept both
    if (transaction.status !== 'pending' && transaction.status !== 'queued') {
      throw new ValidationError(
        `Transaction ${transactionId} is not in pending/queued state (current: ${transaction.status})`,
        'transactionId',
        'transaction in pending or queued state'
      );
    }

    if (transaction.operations.length >= this.config.maxOperationsPerTransaction) {
      throw new ServiceError(
        'Maximum operations per transaction reached',
        'QUOTA_EXCEEDED',
        'TransactionManager',
        false
      );
    }

    const operationId = `op_${this.operationIdCounter++}`;
    this.log(`Queuing operation ${operationId} in transaction ${transactionId}`);

    const queuedOp: QueuedOperation = {
      id: operationId,
      type: operation.type,
      tool: operation.tool,
      action: operation.action,
      params: operation.params,
      order: transaction.operations.length,
      estimatedDuration: operation.estimatedDuration,
      dependsOn: operation.dependsOn,
      status: 'pending',
      timestamp: Date.now(),
    };

    transaction.operations.push(queuedOp);
    transaction.status = 'queued';

    await this.emitEvent({
      type: 'queue',
      transactionId,
      timestamp: Date.now(),
      data: {
        operationId,
        operationType: operation.type,
        tool: operation.tool,
        action: operation.action,
        params: operation.params, // DR-01: stored for crash-recovery replay
      },
    });

    return operationId;
  }

  /**
   * Commit the transaction (execute all operations atomically)
   */
  async commit(transactionId: string): Promise<CommitResult> {
    const transaction = this.getTransaction(transactionId);
    const startTime = Date.now();

    this.log(`Committing transaction: ${transactionId}`);
    transaction.status = 'executing';

    try {
      // Validate all operations
      this.validateOperations(transaction);

      // Resolve sheet names to IDs for range-based operations and reserve
      // deterministic IDs for sheets created inside the same transaction.
      const sheetLookup = await this.buildSheetLookupContext(transaction.spreadsheetId);
      this.reservePendingSheetIds(transaction.operations, sheetLookup);

      // Merge operations into batch request
      const preparedBatch = await this.mergeToBatchRequest(
        transaction.operations,
        transaction.spreadsheetId,
        sheetLookup
      );

      // Capture pre-commit cell values for rollback (write operations only)
      if (transaction.snapshot) {
        await this.capturePreCommitValues(transaction, transaction.snapshot, sheetLookup);
      }

      // Execute batch request via Google Sheets API
      const batchResponse = await this.executeBatchRequest(
        transaction.spreadsheetId,
        preparedBatch.batchRequest
      );

      // Process results
      const operationResults = this.processOperationResults(
        transaction.operations,
        preparedBatch.requestCounts,
        batchResponse
      );

      // Check for failures
      const failedOps = operationResults.filter((r) => !r.success);
      if (failedOps.length > 0 && transaction.autoRollback) {
        throw new ServiceError(
          `${failedOps.length} operation(s) failed: ${failedOps[0]!.error?.message}`,
          'TRANSACTION_CONFLICT',
          'TransactionManager',
          true
        );
      }

      transaction.status = 'committed';
      transaction.endTime = Date.now();
      transaction.duration = transaction.endTime - transaction.startTime!;

      // Update stats
      this.stats.successfulTransactions++;
      this.updateStats(transaction);

      const apiCallsSaved = Math.max(0, transaction.operations.length - 1);
      this.stats.apiCallsSaved += apiCallsSaved;

      const result: CommitResult = {
        transactionId,
        success: true,
        batchResponse,
        operationResults,
        duration: Date.now() - startTime,
        apiCallsMade: 1,
        apiCallsSaved,
        snapshotId: transaction.snapshot?.id,
      };

      await this.emitEvent({
        type: 'commit',
        transactionId,
        timestamp: Date.now(),
        data: { success: true, operationCount: transaction.operations.length },
      });

      // DR-01: Compact WAL — remove completed transaction's entries
      if (this.wal) {
        await this.wal.compact(transactionId);
      }

      // Cleanup
      this.activeTransactions.delete(transactionId);
      this.stats.activeTransactions--;

      return result;
    } catch (error) {
      transaction.status = 'failed';
      transaction.endTime = Date.now();
      transaction.duration = transaction.endTime - transaction.startTime!;

      this.stats.failedTransactions++;
      this.updateStats(transaction);

      let rolledBack = false;
      let rollbackError: Error | undefined;

      // Auto-rollback if configured
      if (transaction.autoRollback && transaction.snapshot) {
        try {
          await this.rollback(transactionId);
          rolledBack = true;
        } catch (rbError) {
          rollbackError = rbError instanceof Error ? rbError : new Error(String(rbError));
        }
      }

      await this.emitEvent({
        type: 'fail',
        transactionId,
        timestamp: Date.now(),
        data: {
          error: error instanceof Error ? error.message : String(error),
          rolledBack,
        },
      });

      // DR-01: Compact WAL for terminal failed transactions.
      if (this.wal) {
        await this.wal.compact(transactionId);
      }

      // Cleanup
      this.activeTransactions.delete(transactionId);
      this.stats.activeTransactions--;

      const result: CommitResult = {
        transactionId,
        success: false,
        operationResults: [],
        duration: Date.now() - startTime,
        apiCallsMade: 0,
        apiCallsSaved: 0,
        error: error instanceof Error ? error : new Error(String(error)),
        rolledBack,
        snapshotId: transaction.snapshot?.id,
      };

      if (rollbackError && result.error) {
        result.error = new Error(
          `Transaction failed and rollback failed: ${result.error.message}, Rollback error: ${rollbackError.message}`
        );
      }

      return result;
    }
  }

  /**
   * Rollback a transaction
   */
  async rollback(transactionId: string): Promise<RollbackResult> {
    const transaction = this.getTransaction(transactionId);
    const startTime = Date.now();

    this.log(`Rolling back transaction: ${transactionId}`);

    const snapshot = transaction.snapshot;

    try {
      // Restore snapshot if one was created (metadata-only; see restoreSnapshot for details)
      if (snapshot) {
        await this.restoreSnapshot(snapshot);
      }

      transaction.status = 'rolled_back';
      this.stats.rolledBackTransactions++;

      await this.emitEvent({
        type: 'rollback',
        transactionId,
        timestamp: Date.now(),
        data: { snapshotId: snapshot?.id },
      });

      // DR-01: Compact WAL — remove rolled-back transaction's entries
      if (this.wal) {
        await this.wal.compact(transactionId);
      }

      return {
        transactionId,
        success: true,
        snapshotId: snapshot?.id ?? '',
        duration: Date.now() - startTime,
        operationsReverted: transaction.operations.length,
      };
    } catch (error) {
      return {
        transactionId,
        success: false,
        snapshotId: snapshot?.id ?? '',
        duration: Date.now() - startTime,
        operationsReverted: 0,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Get transaction by ID
   */
  getTransaction(transactionId: string): Transaction {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) {
      throw new NotFoundError('transaction', transactionId);
    }
    return transaction;
  }

  /**
   * Create a snapshot of spreadsheet state
   *
   * PRODUCTION: Fetches actual spreadsheet state from Google Sheets API
   */
  private async createSnapshot(spreadsheetId: string): Promise<TransactionSnapshot> {
    this.log(`Creating snapshot for spreadsheet: ${spreadsheetId}`);

    if (!this.googleClient) {
      throw new ServiceError(
        'Transaction manager requires Google API client for snapshots. Simulated snapshots have been removed for production safety.',
        'SERVICE_NOT_INITIALIZED',
        'TransactionManager'
      );
    }

    try {
      // Fetch spreadsheet metadata (structure only, NO cell data)
      // CRITICAL FIX: Removed 'data' from fields to prevent massive data fetch
      const response = await this.googleClient.sheets.spreadsheets.get({
        spreadsheetId,
        includeGridData: false, // Exclude cell data for performance
        fields: 'spreadsheetId,properties,sheets(properties)', // Fixed: removed ',data' which caused 500MB+ fetches
      });

      const state = response.data;

      // Calculate snapshot size with error handling for massive objects
      let size: number;
      try {
        const stateJson = JSON.stringify(state);
        size = stateJson.length;
      } catch (serializationError) {
        // Catch V8 string length limit errors (>512MB)
        if (
          serializationError instanceof RangeError &&
          String(serializationError.message).includes('string longer than')
        ) {
          throw new ServiceError(
            'Snapshot too large to serialize (exceeds 512MB JavaScript limit). This spreadsheet is too large for transactional snapshots. Options: (1) Disable autoSnapshot, (2) Use sheets_history for undo, (3) Reduce spreadsheet size.',
            'PAYLOAD_TOO_LARGE',
            'TransactionManager'
          );
        }
        throw serializationError;
      }

      // Enforce snapshot size limit (prevent memory exhaustion)
      const MAX_SNAPSHOT_SIZE = 50 * 1024 * 1024; // 50MB limit
      if (size > MAX_SNAPSHOT_SIZE) {
        throw new ServiceError(
          `Snapshot too large: ${Math.round(size / 1024 / 1024)}MB exceeds ${MAX_SNAPSHOT_SIZE / 1024 / 1024}MB limit. This spreadsheet has too much metadata for transactional snapshots. Options: (1) Begin transaction with autoSnapshot: false, (2) Use sheets_history instead, (3) Reduce number of sheets.`,
          'PAYLOAD_TOO_LARGE',
          'TransactionManager'
        );
      }

      const snapshot: TransactionSnapshot = {
        id: uuidv4(),
        spreadsheetId,
        state: state as unknown as SpreadsheetState, // Metadata-only snapshot shape is compatible subset
        timestamp: Date.now(),
        size,
      };

      this.snapshots.set(snapshot.id, snapshot);
      this.stats.snapshotsCreated++;

      this.log(`Snapshot created: ${snapshot.id} (${Math.round(size / 1024)}KB metadata-only)`);

      return snapshot;
    } catch (error) {
      this.log(
        `Snapshot creation failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Capture pre-commit cell values for write/clear operations.
   *
   * Fetches current cell values immediately before the batchUpdate so that
   * restoreSnapshot() can write them back if the transaction is rolled back.
   * Scoped to sheets_data write/clear operations only; format changes do not
   * have a simple inverse and must still be undone manually.
   */
  private async capturePreCommitValues(
    transaction: Transaction,
    snapshot: TransactionSnapshot,
    sheetLookup: SheetLookupContext
  ): Promise<void> {
    if (!this.googleClient) return;

    const ranges: string[] = [];
    for (const op of transaction.operations) {
      for (const range of this.collectPreCommitRanges(op, sheetLookup)) {
        ranges.push(range);
      }
    }

    if (ranges.length === 0) return;

    // Deduplicate ranges
    const uniqueRanges = [...new Set(ranges)];

    try {
      const response = await this.googleClient.sheets.spreadsheets.values.batchGet({
        spreadsheetId: transaction.spreadsheetId,
        ranges: uniqueRanges,
      });

      snapshot.preCommitCellData = (response.data.valueRanges ?? []).map((vr) => ({
        range: vr.range ?? '',
        values: (vr.values as unknown[][] | undefined) ?? [],
      }));

      this.log(`Captured pre-commit cell data for ${uniqueRanges.length} range(s)`);
    } catch (error) {
      // Non-fatal: log and continue — rollback will still mark the transaction rolled_back
      this.log(
        `WARNING: Could not capture pre-commit cell data: ${error instanceof Error ? error.message : String(error)}. ` +
          'Rollback will not restore cell values for this transaction.'
      );
    }
  }

  private collectPreCommitRanges(op: QueuedOperation, sheetLookup: SheetLookupContext): string[] {
    const toolAction = `${op.tool}:${op.action}`;
    switch (toolAction) {
      case 'sheets_data:write':
      case 'sheets_data:clear': {
        const range = this.normalizeRangeToA1(
          op.params['range'],
          op.params['sheetId'],
          sheetLookup
        );
        return range ? [range] : [];
      }

      case 'sheets_data:batch_write': {
        const data = Array.isArray(op.params['data']) ? op.params['data'] : [];
        return data
          .flatMap((entry) => {
            if (typeof entry !== 'object' || entry === null) {
              return [];
            }
            const range = this.normalizeRangeToA1(
              (entry as Record<string, unknown>)['range'],
              op.params['sheetId'],
              sheetLookup
            );
            return range ? [range] : [];
          })
          .filter(Boolean);
      }

      case 'sheets_data:batch_clear': {
        const ranges = Array.isArray(op.params['ranges']) ? op.params['ranges'] : [];
        return ranges
          .flatMap((rangeInput) => {
            const range = this.normalizeRangeToA1(rangeInput, op.params['sheetId'], sheetLookup);
            return range ? [range] : [];
          })
          .filter(Boolean);
      }

      default:
        return [];
    }
  }

  private normalizeRangeToA1(
    rangeInput: unknown,
    explicitSheetId: unknown,
    sheetLookup: SheetLookupContext
  ): string | undefined {
    if (rangeInput === undefined || rangeInput === null) {
      return undefined;
    }

    if (typeof rangeInput === 'string') {
      return this.isPendingSheetRange(rangeInput, sheetLookup)
        ? undefined
        : this.qualifyA1Range(rangeInput, explicitSheetId, sheetLookup);
    }

    if (typeof rangeInput !== 'object') {
      return undefined; // OK: Explicit empty — non-object range cannot be normalized
    }

    const rangeRecord = rangeInput as Record<string, unknown>;
    if (typeof rangeRecord['a1'] === 'string') {
      return this.normalizeRangeToA1(rangeRecord['a1'], explicitSheetId, sheetLookup);
    }

    const gridRange = this.extractGridRange(rangeRecord);
    if (!gridRange) {
      return undefined; // OK: Explicit empty — range object has no extractable grid coords
    }

    const sheetId = this.resolveSheetId(
      undefined,
      gridRange.sheetId ?? (typeof explicitSheetId === 'number' ? explicitSheetId : undefined),
      sheetLookup,
      'range'
    );
    const sheetName = sheetLookup.idToName.get(sheetId);
    if (!sheetName || sheetLookup.pendingSheetNames.has(sheetName)) {
      return undefined; // OK: Explicit empty — sheetId not yet known to lookup table
    }

    return buildA1Notation(
      sheetName,
      gridRange.startColumnIndex ?? 0,
      gridRange.startRowIndex ?? 0,
      gridRange.endColumnIndex ?? 1,
      gridRange.endRowIndex ?? 1
    );
  }

  private qualifyA1Range(
    range: string,
    explicitSheetId: unknown,
    sheetLookup: SheetLookupContext
  ): string {
    const parsed = parseA1Notation(range);
    if (parsed.sheetName) {
      return range;
    }

    const sheetId = this.resolveSheetId(
      undefined,
      typeof explicitSheetId === 'number' ? explicitSheetId : undefined,
      sheetLookup,
      'range'
    );
    const sheetName = sheetLookup.idToName.get(sheetId);
    if (!sheetName) {
      return range;
    }

    return buildA1Notation(
      sheetName,
      parsed.startCol,
      parsed.startRow,
      parsed.endCol,
      parsed.endRow
    );
  }

  private isPendingSheetRange(range: string, sheetLookup: SheetLookupContext): boolean {
    try {
      const parsed = parseA1Notation(range);
      return parsed.sheetName ? sheetLookup.pendingSheetNames.has(parsed.sheetName) : false;
    } catch {
      return false;
    }
  }

  /**
   * Restore snapshot — writes back pre-commit cell data captured before the batchUpdate.
   *
   * Restores cell values for sheets_data write/clear operations.
   * Format changes (sheets_format) and structural changes (sheet add/delete) are NOT
   * reverted automatically; use sheets_history or sheets_collaborate for those.
   */
  private async restoreSnapshot(snapshot: TransactionSnapshot): Promise<void> {
    if (!snapshot.preCommitCellData || snapshot.preCommitCellData.length === 0) {
      this.log(
        `Transaction rolled back. Snapshot ${snapshot.id} has no cell data to restore. ` +
          'For format/structural rollback use sheets_history or sheets_collaborate.'
      );
      return;
    }

    if (!this.googleClient) {
      this.log(
        `Transaction rolled back. Cannot restore cell data — no Google API client. ` +
          `Snapshot ${snapshot.id} captured ${snapshot.preCommitCellData.length} range(s); ` +
          'restore manually via sheets_history or sheets_collaborate.'
      );
      return;
    }

    this.log(`Restoring ${snapshot.preCommitCellData.length} range(s) to pre-transaction state...`);

    try {
      await this.googleClient.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: snapshot.spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: snapshot.preCommitCellData.map((d) => ({
            range: d.range,
            values: d.values,
          })),
        },
      });

      this.log(
        `Cell data restored for ${snapshot.preCommitCellData.length} range(s). ` +
          'Note: format changes are not reverted — use sheets_history for full undo.'
      );
    } catch (error) {
      // Non-fatal: log and continue — the transaction is still marked rolled_back
      this.log(
        `WARNING: Failed to restore cell data during rollback: ${error instanceof Error ? error.message : String(error)}. ` +
          `Snapshot ${snapshot.id} contains the pre-transaction values for manual recovery.`
      );
    }
  }

  /**
   * Validate operations before execution
   */
  private validateOperations(transaction: Transaction): void {
    if (transaction.operations.length === 0) {
      throw new ValidationError(
        'No operations to commit',
        'operations',
        'non-empty operations list'
      );
    }

    // Check for circular dependencies
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (opId: string): boolean => {
      if (recursionStack.has(opId)) return true;
      if (visited.has(opId)) return false;

      visited.add(opId);
      recursionStack.add(opId);

      const op = transaction.operations.find((o) => o.id === opId);
      if (op?.dependsOn) {
        for (const depId of op.dependsOn) {
          if (hasCycle(depId)) return true;
        }
      }

      recursionStack.delete(opId);
      return false;
    };

    for (const op of transaction.operations) {
      if (hasCycle(op.id)) {
        throw new ValidationError(
          'Circular dependency detected in operations',
          'operations',
          'acyclic dependency graph'
        );
      }
    }
  }

  /**
   * Merge operations into single batch request
   */
  private async mergeToBatchRequest(
    operations: QueuedOperation[],
    spreadsheetId: string,
    sheetLookup?: SheetLookupContext
  ): Promise<PreparedBatchRequest> {
    this.log(`Merging ${operations.length} operations into batch request`);

    const requests: BatchRequestEntry[] = [];
    const requestCounts: number[] = [];
    const unconvertedOps: string[] = [];

    for (const op of operations) {
      const entries = await this.operationToBatchEntries(op, spreadsheetId, sheetLookup);
      if (entries && entries.length > 0) {
        requests.push(...entries);
        requestCounts.push(entries.length);
      } else {
        requestCounts.push(0);
        unconvertedOps.push(`${op.tool}:${op.action} (id: ${op.id})`);
      }
    }

    if (unconvertedOps.length > 0) {
      this.log(
        `WARNING: ${unconvertedOps.length} operation(s) could not be converted to batch requests: ${unconvertedOps.join(', ')}. ` +
          `These operations will be skipped. Supported operations: sheets_data (write, append, clear, merge/unmerge), ` +
          `sheets_composite (smart_append with transaction-resolvable headers), ` +
          `sheets_format (set_format, set_background, etc.), sheets_core (add/delete/update_sheet), ` +
          `sheets_dimensions (insert/delete rows/columns, freeze), sheets_advanced (named/protected ranges).`
      );
    }

    if (requests.length === 0 && operations.length > 0) {
      throw new ValidationError(
        `None of the ${operations.length} queued operation(s) could be converted to batch requests. Unconverted operations: ${unconvertedOps.join(', ')}. Please use supported operations or execute them individually outside of transactions.`,
        'operations',
        'operations convertible to batch requests'
      );
    }

    return {
      batchRequest: {
        requests,
        includeSpreadsheetInResponse: false,
        responseIncludeGridData: false,
      },
      requestCounts,
    };
  }

  /**
   * Convert operation to batch request entries.
   *
   * Converts queued operations into Google Sheets API batchUpdate request entries.
   * Supports: values_write, format_apply, sheet_create, sheet_delete, and 'custom' operations.
   * Custom operations are mapped based on their tool/action parameters.
   */
  private async operationToBatchEntries(
    op: QueuedOperation,
    spreadsheetId: string,
    sheetLookup?: SheetLookupContext
  ): Promise<BatchRequestEntry[] | null> {
    switch (op.type) {
      case 'values_write':
        return [this.buildValueUpdateRequest(op.params, sheetLookup)];

      case 'format_apply':
        return [
          this.buildLegacyUpdateCellsRequest(op.params, 'userEnteredFormat', false, sheetLookup),
        ];

      case 'sheet_create':
        return [
          {
            addSheet: {
              properties: {
                title: op.params['title'],
                sheetId: op.params['sheetId'],
              },
            },
          },
        ];

      case 'sheet_delete':
        return [
          {
            deleteSheet: {
              sheetId: op.params['sheetId'],
            },
          },
        ];

      case 'custom':
        return this.convertCustomOperation(op, spreadsheetId, sheetLookup);

      default:
        this.log(`Unknown operation type: ${op.type}, skipping`);
        return null;
    }
  }

  /**
   * Convert custom operations to batch request entries based on tool/action
   *
   * Maps ServalSheets tool actions to Google Sheets API batchUpdate requests.
   * This enables transaction batching for operations queued via the generic queue() method.
   */
  private async convertCustomOperation(
    op: QueuedOperation,
    spreadsheetId: string,
    sheetLookup?: SheetLookupContext
  ): Promise<BatchRequestEntry[] | null> {
    const { tool, action, params } = op;
    const toolAction = `${tool}:${action}`;

    this.log(`Converting custom operation: ${toolAction}`);

    switch (toolAction) {
      // sheets_data operations
      case 'sheets_data:write':
        return [this.buildValueUpdateRequest(params, sheetLookup)];

      case 'sheets_data:batch_write':
        return this.buildBatchWriteRequests(params, sheetLookup);

      case 'sheets_data:clear':
        return [this.buildClearCellsRequest(params, sheetLookup)];

      case 'sheets_data:batch_clear':
        return this.buildBatchClearRequests(params, sheetLookup);

      case 'sheets_data:append':
        return [this.buildAppendCellsRequest(params, sheetLookup)];

      case 'sheets_composite:smart_append':
        return this.buildSmartAppendRequests(params, spreadsheetId, sheetLookup);

      case 'sheets_data:merge_cells':
        return [
          {
            mergeCells: {
              range: this.resolveRangeToGridRange(
                params['range'],
                params['sheetId'] as number | undefined,
                sheetLookup
              ),
              mergeType: (params['mergeType'] as string) || 'MERGE_ALL',
            },
          },
        ];

      case 'sheets_data:unmerge_cells':
        return [
          {
            unmergeCells: {
              range: this.resolveRangeToGridRange(
                params['range'],
                params['sheetId'] as number | undefined,
                sheetLookup
              ),
            },
          },
        ];

      // sheets_format operations
      case 'sheets_format:set_format':
      case 'sheets_format:set_background':
      case 'sheets_format:set_text_format':
      case 'sheets_format:set_number_format':
      case 'sheets_format:set_alignment':
      case 'sheets_format:set_borders':
        return [
          this.buildLegacyUpdateCellsRequest(params, 'userEnteredFormat', false, sheetLookup),
        ];

      case 'sheets_format:clear_format':
        return [this.buildLegacyUpdateCellsRequest(params, 'userEnteredFormat', true, sheetLookup)];

      // sheets_core operations
      case 'sheets_core:add_sheet':
        return [
          {
            addSheet: {
              properties: {
                title: params['title'] as string,
                index: params['index'] as number | undefined,
                sheetId: params['sheetId'] as number | undefined,
                gridProperties: params['gridProperties'] as Record<string, unknown> | undefined,
              },
            },
          },
        ];

      case 'sheets_core:delete_sheet':
        return [
          {
            deleteSheet: {
              sheetId: params['sheetId'] as number,
            },
          },
        ];

      case 'sheets_core:update_sheet':
        return [
          {
            updateSheetProperties: {
              properties: {
                sheetId: params['sheetId'] as number,
                title: params['title'] as string | undefined,
                index: params['index'] as number | undefined,
                hidden: params['hidden'] as boolean | undefined,
                gridProperties: params['gridProperties'] as Record<string, unknown> | undefined,
              },
              fields: this.buildFieldMask(params),
            },
          },
        ];

      // sheets_dimensions operations
      case 'sheets_dimensions:insert_rows':
        return [
          {
            insertRange: {
              range: toGridRange(
                buildGridRangeInput(
                  params['sheetId'] as number,
                  params['startIndex'] as number,
                  (params['startIndex'] as number) + ((params['count'] as number) || 1)
                )
              ),
              shiftDimension: 'ROWS',
            },
          },
        ];

      case 'sheets_dimensions:insert_columns':
        return [
          {
            insertRange: {
              range: toGridRange(
                buildGridRangeInput(
                  params['sheetId'] as number,
                  undefined,
                  undefined,
                  params['startIndex'] as number,
                  (params['startIndex'] as number) + ((params['count'] as number) || 1)
                )
              ),
              shiftDimension: 'COLUMNS',
            },
          },
        ];

      case 'sheets_dimensions:delete_rows':
        return [
          {
            deleteRange: {
              range: toGridRange(
                buildGridRangeInput(
                  params['sheetId'] as number,
                  params['startIndex'] as number,
                  params['endIndex'] as number
                )
              ),
              shiftDimension: 'ROWS',
            },
          },
        ];

      case 'sheets_dimensions:delete_columns':
        return [
          {
            deleteRange: {
              range: toGridRange(
                buildGridRangeInput(
                  params['sheetId'] as number,
                  undefined,
                  undefined,
                  params['startIndex'] as number,
                  params['endIndex'] as number
                )
              ),
              shiftDimension: 'COLUMNS',
            },
          },
        ];

      case 'sheets_dimensions:freeze_rows':
      case 'sheets_dimensions:freeze_columns':
        return [
          {
            updateSheetProperties: {
              properties: {
                sheetId: params['sheetId'] as number,
                gridProperties: {
                  frozenRowCount: params['frozenRowCount'] as number | undefined,
                  frozenColumnCount: params['frozenColumnCount'] as number | undefined,
                },
              },
              fields:
                action === 'freeze_rows'
                  ? 'gridProperties.frozenRowCount'
                  : 'gridProperties.frozenColumnCount',
            },
          },
        ];

      // Generic freeze action (used by LLMs via sheets_dimensions tool)
      case 'sheets_dimensions:freeze': {
        const dimension = params['dimension'] as string | undefined;
        const count = params['count'] as number | undefined;
        const isRows = !dimension || dimension.toUpperCase() === 'ROWS';
        return [
          {
            updateSheetProperties: {
              properties: {
                sheetId: params['sheetId'] as number,
                gridProperties: isRows
                  ? { frozenRowCount: count ?? 0 }
                  : { frozenColumnCount: count ?? 0 },
              },
              fields: isRows ? 'gridProperties.frozenRowCount' : 'gridProperties.frozenColumnCount',
            },
          },
        ];
      }

      // sheets_advanced operations
      case 'sheets_advanced:add_named_range':
        return [
          {
            addNamedRange: {
              namedRange: {
                name: params['name'] as string,
                range: this.resolveRangeToGridRange(
                  params['range'],
                  params['sheetId'] as number | undefined,
                  sheetLookup
                ),
              },
            },
          },
        ];

      case 'sheets_advanced:delete_named_range':
        return [
          {
            deleteNamedRange: {
              namedRangeId: params['namedRangeId'] as string,
            },
          },
        ];

      case 'sheets_advanced:add_protected_range':
        return [
          {
            addProtectedRange: {
              protectedRange: {
                range: this.resolveRangeToGridRange(
                  params['range'],
                  params['sheetId'] as number | undefined,
                  sheetLookup
                ),
                description: params['description'] as string | undefined,
                warningOnly: params['warningOnly'] as boolean | undefined,
                editors: params['editors'] as Record<string, unknown> | undefined,
              },
            },
          },
        ];

      case 'sheets_advanced:delete_protected_range':
        return [
          {
            deleteProtectedRange: {
              protectedRangeId: params['protectedRangeId'] as number,
            },
          },
        ];

      default:
        this.log(
          `Custom operation ${toolAction} cannot be batched. Consider using direct API call.`
        );
        return null;
    }
  }

  private buildValueUpdateRequest(
    params: Record<string, unknown>,
    sheetLookup?: SheetLookupContext
  ): BatchRequestEntry {
    const values = this.requireValuesMatrix(params['values'], 'values');
    return {
      updateCells: {
        range: this.resolveRangeToGridRange(
          params['range'],
          params['sheetId'] as number | undefined,
          sheetLookup
        ),
        rows: this.buildRowData(values, (params['valueInputOption'] as string) ?? 'USER_ENTERED'),
        fields: 'userEnteredValue',
      },
    };
  }

  private buildBatchWriteRequests(
    params: Record<string, unknown>,
    sheetLookup?: SheetLookupContext
  ): BatchRequestEntry[] {
    const data = this.requireObjectArray(params['data'], 'data');
    const valueInputOption = (params['valueInputOption'] as string) ?? 'USER_ENTERED';

    return data.map((entry, index) => {
      if (entry['dataFilter'] !== undefined) {
        throw new ValidationError(
          'Transactions do not support dataFilter-based batch_write entries. Use explicit ranges instead.',
          `data[${index}].dataFilter`,
          'data[].range'
        );
      }

      return this.buildValueUpdateRequest(
        {
          range: entry['range'],
          values: entry['values'],
          valueInputOption,
        },
        sheetLookup
      );
    });
  }

  private buildClearCellsRequest(
    params: Record<string, unknown>,
    sheetLookup?: SheetLookupContext
  ): BatchRequestEntry {
    return {
      updateCells: {
        range: this.resolveRangeToGridRange(
          params['range'],
          params['sheetId'] as number | undefined,
          sheetLookup
        ),
        fields: 'userEnteredValue',
      },
    };
  }

  private buildBatchClearRequests(
    params: Record<string, unknown>,
    sheetLookup?: SheetLookupContext
  ): BatchRequestEntry[] {
    const ranges = this.requireArray(params['ranges'], 'ranges');
    return ranges.map((range) =>
      this.buildClearCellsRequest(
        {
          range,
          sheetId: params['sheetId'],
        },
        sheetLookup
      )
    );
  }

  private buildAppendCellsRequest(
    params: Record<string, unknown>,
    sheetLookup?: SheetLookupContext
  ): BatchRequestEntry {
    const values = this.requireValuesMatrix(params['values'], 'values');
    const valueInputOption = (params['valueInputOption'] as string) ?? 'USER_ENTERED';
    const tableId = params['tableId'];

    if (typeof tableId === 'number') {
      return {
        appendCells: {
          tableId,
          rows: this.buildRowData(values, valueInputOption),
          fields: 'userEnteredValue',
        },
      };
    }

    const target = this.resolveAppendTarget(
      params['range'],
      params['sheetId'] as number | undefined,
      sheetLookup
    );

    return {
      appendCells: {
        sheetId: target.sheetId,
        rows: this.buildRowData(
          this.prependBlankColumns(values, target.startColumnIndex),
          valueInputOption
        ),
        fields: 'userEnteredValue',
      },
    };
  }

  private async buildSmartAppendRequests(
    params: Record<string, unknown>,
    spreadsheetId: string,
    sheetLookup?: SheetLookupContext
  ): Promise<BatchRequestEntry[]> {
    const data = this.requireObjectArray(params['data'], 'data');
    const sheetRef = params['sheet'];
    const skipEmptyRows = params['skipEmptyRows'] !== false;
    const requestedCreateMissingColumns = params['createMissingColumns'] === true;

    const sheetId =
      typeof sheetRef === 'number'
        ? sheetRef
        : this.resolveSheetId(sheetRef as string | undefined, undefined, sheetLookup, 'sheet');
    const sheetName =
      typeof sheetRef === 'string' ? sheetRef : sheetLookup?.idToName.get(sheetId as number);

    if (!sheetName) {
      throw new ValidationError(
        'Transaction smart_append requires a resolvable sheet name or sheetId.',
        'sheet',
        'sheet title or numeric sheetId'
      );
    }

    let existingHeaders: string[] = [];
    if (!sheetLookup?.pendingSheetNames.has(sheetName)) {
      if (!this.googleClient) {
        throw new ServiceError(
          'Transaction manager requires Google API client for smart_append header resolution.',
          'SERVICE_NOT_INITIALIZED',
          'TransactionManager'
        );
      }

      const headerResponse = await this.googleClient.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!1:1`,
      });

      existingHeaders = (headerResponse.data.values?.[0] ?? []).map((value) =>
        String(value ?? '').trim()
      );
    }

    const createMissingColumns =
      existingHeaders.length === 0 ? true : requestedCreateMissingColumns;
    const dataKeys = new Set<string>();
    for (const row of data) {
      Object.keys(row).forEach((key) => dataKeys.add(key));
    }

    const columnMap = new Map<string, number>();
    const columnsCreated: string[] = [];

    for (const key of dataKeys) {
      const headerIndex = existingHeaders.findIndex(
        (header) => header.toLowerCase() === key.toLowerCase()
      );
      if (headerIndex >= 0) {
        columnMap.set(key, headerIndex);
        continue;
      }

      if (!createMissingColumns) {
        continue;
      }

      const newIndex = existingHeaders.length + columnsCreated.length;
      columnMap.set(key, newIndex);
      columnsCreated.push(key);
    }

    const requests: BatchRequestEntry[] = [];
    if (columnsCreated.length > 0) {
      requests.push({
        updateCells: {
          range: toGridRange(
            buildGridRangeInput(
              sheetId,
              0,
              1,
              existingHeaders.length,
              existingHeaders.length + columnsCreated.length
            )
          ),
          rows: this.buildRowData([columnsCreated], 'RAW'),
          fields: 'userEnteredValue',
        },
      });
    }

    const totalCols = Math.max(
      existingHeaders.length,
      ...Array.from(columnMap.values(), (v) => v + 1),
      0
    );
    const rows: unknown[][] = [];

    for (const record of data) {
      const row = new Array(totalCols).fill('');
      let hasValue = false;

      for (const [key, value] of Object.entries(record)) {
        const colIndex = columnMap.get(key);
        if (colIndex === undefined) {
          continue;
        }

        row[colIndex] = value ?? '';
        if (value !== null && value !== undefined && value !== '') {
          hasValue = true;
        }
      }

      if (!skipEmptyRows || hasValue) {
        rows.push(row);
      }
    }

    if (rows.length > 0) {
      requests.push({
        appendCells: {
          sheetId,
          rows: this.buildRowData(rows, 'RAW'),
          fields: 'userEnteredValue',
        },
      });
    }

    if (requests.length === 0) {
      throw new ValidationError(
        'smart_append produced no batchable work. Ensure at least one row contains values that match existing or creatable headers.',
        'data',
        'non-empty records with matching headers'
      );
    }

    return requests;
  }

  private buildLegacyUpdateCellsRequest(
    params: Record<string, unknown>,
    fields: string,
    clear: boolean,
    sheetLookup?: SheetLookupContext
  ): BatchRequestEntry {
    return {
      updateCells: {
        range: this.resolveRangeToGridRange(
          params['range'],
          params['sheetId'] as number | undefined,
          sheetLookup
        ),
        rows: clear ? [] : undefined,
        fields,
      },
    };
  }

  private requireValuesMatrix(value: unknown, field: string): unknown[][] {
    if (!Array.isArray(value) || value.some((row) => !Array.isArray(row))) {
      throw new ValidationError(
        `Expected ${field} to be a 2D array of cell values.`,
        field,
        '[[1, 2], [3, 4]]'
      );
    }
    return value as unknown[][];
  }

  private requireArray(value: unknown, field: string): unknown[] {
    if (!Array.isArray(value)) {
      throw new ValidationError(`Expected ${field} to be an array.`, field, '[]');
    }
    return value;
  }

  private requireObjectArray(value: unknown, field: string): Record<string, unknown>[] {
    const items = this.requireArray(value, field);
    if (items.some((item) => typeof item !== 'object' || item === null)) {
      throw new ValidationError(`Expected ${field} to be an array of objects.`, field, '[{}]');
    }
    return items as Record<string, unknown>[];
  }

  private buildRowData(values: unknown[][], valueInputOption: string): sheets_v4.Schema$RowData[] {
    return values.map((rowValues) => ({
      values: rowValues.map((cellValue) => {
        const isFormula = typeof cellValue === 'string' && cellValue.startsWith('=');

        if (valueInputOption === 'USER_ENTERED' || valueInputOption === 'RAW') {
          if (isFormula) {
            return { userEnteredValue: { formulaValue: cellValue } };
          }
          if (typeof cellValue === 'number') {
            return { userEnteredValue: { numberValue: cellValue } };
          }
          if (typeof cellValue === 'boolean') {
            return { userEnteredValue: { boolValue: cellValue } };
          }
          return { userEnteredValue: { stringValue: String(cellValue ?? '') } };
        }

        return { userEnteredValue: { stringValue: String(cellValue ?? '') } };
      }),
    }));
  }

  private prependBlankColumns(values: unknown[][], count: number): unknown[][] {
    if (count <= 0) {
      return values;
    }

    return values.map((row) => [...new Array(count).fill(''), ...row]);
  }

  private resolveAppendTarget(
    rangeInput: unknown,
    explicitSheetId: number | undefined,
    sheetLookup?: SheetLookupContext
  ): { sheetId: number; startColumnIndex: number } {
    if (rangeInput === undefined || rangeInput === null) {
      return {
        sheetId: this.resolveSheetId(undefined, explicitSheetId, sheetLookup, 'range'),
        startColumnIndex: 0,
      };
    }

    if (typeof rangeInput === 'string') {
      const parsed = parseA1Notation(rangeInput);
      return {
        sheetId: parsed.sheetName
          ? this.resolveSheetId(parsed.sheetName, undefined, sheetLookup, 'range')
          : this.resolveSheetId(undefined, explicitSheetId, sheetLookup, 'range'),
        startColumnIndex: parsed.startCol,
      };
    }

    if (typeof rangeInput !== 'object') {
      throw new ValidationError('Unsupported append range format.', 'range', 'Sheet1!A:D');
    }

    const rangeRecord = rangeInput as Record<string, unknown>;
    if (typeof rangeRecord['a1'] === 'string') {
      return this.resolveAppendTarget(rangeRecord['a1'], explicitSheetId, sheetLookup);
    }

    const gridRange = this.extractGridRange(rangeRecord);
    if (gridRange) {
      return {
        sheetId: this.resolveSheetId(
          undefined,
          gridRange.sheetId ?? explicitSheetId,
          sheetLookup,
          'range'
        ),
        startColumnIndex: gridRange.startColumnIndex ?? 0,
      };
    }

    throw new ValidationError(
      'Transactions support append ranges as A1 strings, {a1}, or {grid}. Named and semantic ranges are not supported inside transactions.',
      'range',
      'Sheet1!A:D'
    );
  }

  private resolveRangeToGridRange(
    rangeInput: unknown,
    explicitSheetId: number | undefined,
    sheetLookup?: SheetLookupContext
  ): sheets_v4.Schema$GridRange {
    if (rangeInput === undefined || rangeInput === null) {
      const sheetId = this.resolveSheetId(undefined, explicitSheetId, sheetLookup, 'range');
      return toGridRange(buildGridRangeInput(sheetId));
    }

    if (typeof rangeInput === 'string') {
      return this.parseA1RangeToGridRange(rangeInput, explicitSheetId, sheetLookup);
    }

    if (typeof rangeInput !== 'object') {
      throw new ValidationError('Unsupported range format.', 'range', 'Sheet1!A1:B10');
    }

    const rangeRecord = rangeInput as Record<string, unknown>;
    if (typeof rangeRecord['a1'] === 'string') {
      return this.parseA1RangeToGridRange(rangeRecord['a1'], explicitSheetId, sheetLookup);
    }

    const gridRange = this.extractGridRange(rangeRecord);
    if (gridRange) {
      return {
        ...gridRange,
        sheetId: this.resolveSheetId(
          undefined,
          gridRange.sheetId ?? explicitSheetId,
          sheetLookup,
          'range'
        ),
      };
    }

    throw new ValidationError(
      'Transactions support explicit A1 or grid ranges only. Named and semantic ranges are not supported inside transactions.',
      'range',
      'Sheet1!A1:B10'
    );
  }

  private parseA1RangeToGridRange(
    a1Range: string,
    explicitSheetId: number | undefined,
    sheetLookup?: SheetLookupContext
  ): sheets_v4.Schema$GridRange {
    const parsed = parseA1Notation(a1Range);
    const sheetId = parsed.sheetName
      ? this.resolveSheetId(parsed.sheetName, undefined, sheetLookup, 'range')
      : this.resolveSheetId(undefined, explicitSheetId, sheetLookup, 'range');

    return toGridRange(
      buildGridRangeInput(sheetId, parsed.startRow, parsed.endRow, parsed.startCol, parsed.endCol)
    );
  }

  private extractGridRange(
    rangeRecord: Record<string, unknown>
  ): sheets_v4.Schema$GridRange | undefined {
    if (typeof rangeRecord['sheetId'] === 'number') {
      return rangeRecord as unknown as sheets_v4.Schema$GridRange;
    }

    const nestedGrid = rangeRecord['grid'];
    if (typeof nestedGrid === 'object' && nestedGrid !== null) {
      return nestedGrid as sheets_v4.Schema$GridRange;
    }

    return undefined;
  }

  private resolveSheetId(
    sheetName: string | undefined,
    explicitSheetId: number | undefined,
    sheetLookup: SheetLookupContext | undefined,
    field: string
  ): number {
    if (typeof explicitSheetId === 'number') {
      return explicitSheetId;
    }

    if (sheetName) {
      const resolved = sheetLookup?.nameToId.get(sheetName);
      if (resolved !== undefined) {
        return resolved;
      }

      throw new ValidationError(
        `Sheet '${sheetName}' could not be resolved in transaction commit.`,
        field,
        'existing sheet title or sheetId'
      );
    }

    if (sheetLookup?.defaultSheetId !== undefined) {
      return sheetLookup.defaultSheetId;
    }

    throw new ValidationError(
      'Transaction range resolution requires a sheet name or sheetId.',
      field,
      'Sheet1!A1:B10'
    );
  }

  private async buildSheetLookupContext(spreadsheetId: string): Promise<SheetLookupContext> {
    const nameToId = new Map<string, number>();
    const idToName = new Map<number, string>();
    let defaultSheetId: number | undefined;
    let nextSyntheticSheetId = 1;

    if (!this.googleClient) {
      this.log('No Google API client available, cannot resolve sheet names');
      return {
        nameToId,
        idToName,
        defaultSheetId,
        pendingSheetNames: new Set<string>(),
        nextSyntheticSheetId,
      };
    }

    try {
      const response = await this.googleClient.sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)',
      });

      const sheets = response.data.sheets || [];
      for (const [index, sheet] of sheets.entries()) {
        const title = sheet.properties?.title;
        const sheetId = sheet.properties?.sheetId;
        if (title == null || sheetId == null) {
          continue;
        }

        if (index === 0) {
          defaultSheetId = sheetId;
        }

        nextSyntheticSheetId = Math.max(nextSyntheticSheetId, sheetId + 1);
        nameToId.set(title, sheetId);
        idToName.set(sheetId, title);
      }

      this.log(`Built sheet lookup with ${nameToId.size} entries`);
    } catch (error) {
      this.log(`WARNING: Failed to fetch sheet metadata for name resolution: ${error}`);
    }

    return {
      nameToId,
      idToName,
      defaultSheetId,
      pendingSheetNames: new Set<string>(),
      nextSyntheticSheetId,
    };
  }

  private reservePendingSheetIds(
    operations: QueuedOperation[],
    sheetLookup: SheetLookupContext
  ): void {
    const usedSheetIds = new Set<number>(sheetLookup.idToName.keys());
    let nextSheetId = sheetLookup.nextSyntheticSheetId;

    const allocateSheetId = (): number => {
      while (usedSheetIds.has(nextSheetId) || nextSheetId <= 0) {
        nextSheetId++;
      }

      const allocated = nextSheetId;
      usedSheetIds.add(allocated);
      nextSheetId++;
      return allocated;
    };

    for (const op of operations) {
      const isAddSheet =
        op.type === 'sheet_create' || (op.tool === 'sheets_core' && op.action === 'add_sheet');
      if (!isAddSheet) {
        continue;
      }

      const title = typeof op.params['title'] === 'string' ? op.params['title'].trim() : '';
      if (!title) {
        continue;
      }

      let sheetId =
        typeof op.params['sheetId'] === 'number' ? (op.params['sheetId'] as number) : undefined;
      if (sheetId === undefined) {
        sheetId = allocateSheetId();
        op.params['sheetId'] = sheetId;
      } else {
        usedSheetIds.add(sheetId);
      }

      sheetLookup.nameToId.set(title, sheetId);
      sheetLookup.idToName.set(sheetId, title);
      sheetLookup.pendingSheetNames.add(title);
    }

    sheetLookup.nextSyntheticSheetId = nextSheetId;
  }

  /**
   * Build field mask from params for updateSheetProperties
   */
  private buildFieldMask(params: Record<string, unknown>): string {
    const fields: string[] = [];
    if (params['title'] !== undefined) fields.push('title');
    if (params['index'] !== undefined) fields.push('index');
    if (params['hidden'] !== undefined) fields.push('hidden');
    if (params['gridProperties'] !== undefined) fields.push('gridProperties');
    return fields.join(',') || 'title';
  }

  /**
   * Execute batch request against Google Sheets API
   *
   * PRODUCTION: Requires Google API client for real execution
   */
  private async executeBatchRequest(
    spreadsheetId: string,
    batchRequest: BatchRequest
  ): Promise<sheets_v4.Schema$BatchUpdateSpreadsheetResponse> {
    this.log(
      `Executing batch request for spreadsheet ${spreadsheetId} with ${batchRequest.requests.length} requests`
    );

    if (!this.googleClient) {
      throw new ServiceError(
        'Transaction manager requires Google API client for execution. Simulated execution has been removed for production safety.',
        'SERVICE_NOT_INITIALIZED',
        'TransactionManager'
      );
    }

    try {
      const response = await this.googleClient.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: batchRequest as sheets_v4.Schema$BatchUpdateSpreadsheetRequest,
      });

      this.log(`Batch request succeeded with ${response.data.replies?.length ?? 0} replies`);
      return response.data;
    } catch (error) {
      this.log(`Batch request failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Process operation results from batch response
   *
   * PRODUCTION: Parses actual Google Sheets API batch response
   */
  private processOperationResults(
    operations: QueuedOperation[],
    requestCounts: number[],
    batchResponse: sheets_v4.Schema$BatchUpdateSpreadsheetResponse
  ): OperationResult[] {
    const results: OperationResult[] = [];
    const replies = batchResponse.replies || [];
    let replyIndex = 0;

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i]!;
      const requestCount = requestCounts[i] ?? 0;
      const opReplies = replies.slice(replyIndex, replyIndex + requestCount);
      replyIndex += requestCount;
      const success = requestCount > 0 && opReplies.length === requestCount;

      results.push({
        operationId: op.id,
        success,
        data: requestCount <= 1 ? opReplies[0] || {} : opReplies,
        duration: op.estimatedDuration ?? 100,
        error: success
          ? undefined
          : new Error(
              requestCount === 0
                ? 'Operation could not be converted to a batch request'
                : 'Batch request did not return enough replies for operation'
            ),
      });
    }

    return results;
  }

  /**
   * Update statistics
   */
  private updateStats(transaction: Transaction): void {
    const totalTx = this.stats.totalTransactions;
    this.stats.successRate = this.stats.successfulTransactions / totalTx;

    if (transaction.duration) {
      this.stats.avgTransactionDuration =
        (this.stats.avgTransactionDuration * (totalTx - 1) + transaction.duration) / totalTx;
    }

    this.stats.avgOperationsPerTransaction =
      (this.stats.avgOperationsPerTransaction * (totalTx - 1) + transaction.operations.length) /
      totalTx;
  }

  /**
   * Start background snapshot cleanup
   */
  private startSnapshotCleanup(): void {
    this.snapshotCleanupInterval = setInterval(() => {
      const now = Date.now();
      const expired: string[] = [];

      for (const [id, snapshot] of this.snapshots.entries()) {
        if (now - snapshot.timestamp > this.config.snapshotRetentionMs) {
          expired.push(id);
        }
      }

      for (const id of expired) {
        this.snapshots.delete(id);
        this.log(`Cleaned up expired snapshot: ${id}`);
      }
    }, 60000); // Every minute

    // Phase 1: Register cleanup to prevent memory leak
    registerCleanup(
      'TransactionManager',
      () => {
        if (this.snapshotCleanupInterval) {
          clearInterval(this.snapshotCleanupInterval);
        }
      },
      'snapshot-cleanup-interval'
    );
  }

  /**
   * Add event listener
   */
  addEventListener(listener: TransactionListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: TransactionListener): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Emit event to listeners
   */
  private async emitEvent(event: TransactionEvent): Promise<void> {
    // DR-01: Append to WAL before notifying listeners.
    if (this.wal) {
      await this.wal.append(event);
    }
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        logger.error('Error in transaction event listener', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          transactionId: event.transactionId,
          eventType: event.type,
        });
      }
    }
  }

  /**
   * Log message
   */
  private log(message: string): void {
    if (this.config.verboseLogging) {
      logger.debug('[TransactionManager] ' + message);
    }
  }

  /**
   * Get statistics
   */
  getStats(): TransactionStats {
    return { ...this.stats };
  }

  /**
   * Return WAL recovery status captured at startup replay.
   */
  async getWalRecoveryReport(): Promise<WalRecoveryReport> {
    if (!this.wal) {
      return {
        enabled: false,
        orphanedTransactions: [],
      };
    }
    return this.wal.getRecoveryReport();
  }

  /**
   * Discard an orphaned WAL transaction entry (crash recovery cleanup).
   * Removes the transaction from the orphan list and compacts the WAL.
   */
  async discardOrphanedTransaction(transactionId: string): Promise<void> {
    if (this.wal) {
      await this.wal.discardOrphaned(transactionId);
    } else {
      // WAL disabled — error as NotFoundError (orphaned list is empty without WAL)
      throw new NotFoundError('orphaned transaction', transactionId);
    }
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalTransactions: 0,
      successfulTransactions: 0,
      failedTransactions: 0,
      rolledBackTransactions: 0,
      successRate: 0,
      avgTransactionDuration: 0,
      avgOperationsPerTransaction: 0,
      apiCallsSaved: 0,
      snapshotsCreated: 0,
      activeTransactions: this.activeTransactions.size,
      totalDataProcessed: 0,
    };
  }

  /**
   * Get all active transactions
   */
  getActiveTransactions(): Transaction[] {
    return Array.from(this.activeTransactions.values());
  }

  /**
   * Cancel a transaction (rollback if snapshot exists)
   */
  async cancel(transactionId: string): Promise<void> {
    const transaction = this.getTransaction(transactionId);

    if (transaction.snapshot) {
      await this.rollback(transactionId);
    } else {
      await this.emitEvent({
        type: 'fail',
        transactionId,
        timestamp: Date.now(),
        data: { error: 'Transaction cancelled without snapshot rollback', cancelled: true },
      });
      if (this.wal) {
        await this.wal.compact(transactionId);
      }
    }

    this.activeTransactions.delete(transactionId);
    this.stats.activeTransactions--;
  }
}

// Singleton instance
let transactionManagerInstance: TransactionManager | null = null;

/**
 * Initialize transaction manager (call once during server startup)
 */
export function initTransactionManager(
  googleClient?: TransactionConfig['googleClient']
): TransactionManager {
  if (!transactionManagerInstance) {
    const env = getEnv();
    transactionManagerInstance = new TransactionManager({
      enabled: env.TRANSACTIONS_ENABLED,
      autoSnapshot: env.TRANSACTIONS_AUTO_SNAPSHOT,
      autoRollback: env.TRANSACTIONS_AUTO_ROLLBACK,
      maxOperationsPerTransaction: parseInt(process.env['TRANSACTIONS_MAX_OPERATIONS'] || '100'),
      transactionTimeoutMs: parseInt(process.env['TRANSACTIONS_TIMEOUT_MS'] || '300000'),
      snapshotRetentionMs: parseInt(process.env['TRANSACTIONS_SNAPSHOT_RETENTION_MS'] || '3600000'),
      maxConcurrentTransactions: parseInt(process.env['TRANSACTIONS_MAX_CONCURRENT'] || '10'),
      verboseLogging: process.env['TRANSACTIONS_VERBOSE'] === 'true',
      defaultIsolationLevel:
        (process.env['TRANSACTIONS_DEFAULT_ISOLATION'] as
          | 'read_uncommitted'
          | 'read_committed'
          | 'serializable') || 'read_committed',
      googleClient,
      walDir: env.TRANSACTION_WAL_DIR,
    });
  }
  return transactionManagerInstance;
}

/**
 * Get transaction manager instance
 */
export function getTransactionManager(): TransactionManager {
  if (!transactionManagerInstance) {
    throw new ServiceError(
      'Transaction manager not initialized. Call initTransactionManager() first.',
      'SERVICE_NOT_INITIALIZED',
      'TransactionManager'
    );
  }
  return transactionManagerInstance;
}

/**
 * Reset transaction manager (for testing only)
 * @internal
 */
export function resetTransactionManager(): void {
  if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] !== 'true') {
    throw new ServiceError(
      'resetTransactionManager() can only be called in test environment',
      'INTERNAL_ERROR',
      'TransactionManager'
    );
  }
  transactionManagerInstance = null;
}
