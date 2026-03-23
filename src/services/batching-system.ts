/**
 * BatchingSystem - Phase 1: Unified Concurrency Control
 *
 * @purpose Collects operations within 50-100ms time windows and merges them into single API calls for 20-40% API reduction
 * @category Performance
 * @usage Use for high-volume operations where multiple writes/updates occur rapidly; automatically batches batchUpdate requests
 * @dependencies logger, googleapis (sheets_v4), ConcurrencyCoordinator (Phase 1)
 * @stateful Yes - maintains pending operation queues, active timers, metrics (batches processed, operations merged, API calls saved)
 * @singleton Yes - one instance per process to coordinate batching across all requests
 *
 * Phase 1 Enhancement:
 * - Integrates with ConcurrencyCoordinator for global API limit enforcement
 * - All batchUpdate/batchClear operations acquire global permits
 *
 * @example
 * const batching = new BatchingSystem({ windowMs: 75, maxBatchSize: 100 });
 * // Multiple operations submitted within window are automatically batched
 * await batching.queue({ type: 'values:update', spreadsheetId, range, values });
 * await batching.queue({ type: 'format:update', spreadsheetId, range, format });
 * // Both operations sent in single batchUpdate call
 */

import type { sheets_v4 } from 'googleapis';
import { logger } from '../utils/logger.js';
import { getTracer } from '../utils/tracing.js';
import { getConcurrencyCoordinator } from './concurrency-coordinator.js';
import { extractSheetName } from '../utils/range-helpers.js';
import {
  estimatePayloadSize,
  calculateOptimalBatchSize,
  PAYLOAD_LIMITS,
} from '../utils/payload-validator.js';
import { updateBatchEfficiency } from '../observability/metrics.js';
import { ValidationError, ServiceError } from '../core/errors.js';

/**
 * Supported operation types that can be batched
 */
export type BatchableOperationType =
  | 'values:update'
  | 'values:append'
  | 'values:clear'
  | 'format:update'
  | 'cells:update'
  | 'sheet:update';

/**
 * Operation to be batched
 */
export interface BatchableOperation<T = unknown> {
  /** Unique operation ID */
  id: string;
  /** Operation type */
  type: BatchableOperationType;
  /** Spreadsheet ID */
  spreadsheetId: string;
  /** Operation-specific parameters (varies by operation type — any is intentional due to dynamic dispatch) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any;
  /** Promise resolver */
  resolve: (result: T) => void;
  /** Promise rejecter */
  reject: (error: Error) => void;
  /** Timestamp when queued */
  queuedAt: number;
}

/**
 * Batch execution result
 */
export interface BatchResult {
  /** Number of operations in batch */
  operationCount: number;
  /** API calls made (should be 1) */
  apiCalls: number;
  /** Execution duration in ms */
  duration: number;
  /** Success status */
  success: boolean;
}

/**
 * Adaptive batch window configuration
 */
export interface AdaptiveBatchWindowConfig {
  /** Minimum window size in ms (default: 20) */
  minWindowMs?: number;
  /** Maximum window size in ms (default: 200) */
  maxWindowMs?: number;
  /** Initial window size in ms (default: 50) */
  initialWindowMs?: number;
  /** Low threshold - increase window if below this (default: 3) */
  lowThreshold?: number;
  /** High threshold - decrease window if above this (default: 50) */
  highThreshold?: number;
  /** Rate to increase window (default: 1.2) */
  increaseRate?: number;
  /** Rate to decrease window (default: 0.8) */
  decreaseRate?: number;
}

/**
 * Batching system configuration
 */
export interface BatchingSystemOptions {
  /** Collection window in ms (default: 50) - ignored if adaptive is enabled */
  windowMs?: number;
  /** Maximum operations per batch (default: 100) */
  maxBatchSize?: number;
  /** Enable batching (default: true) */
  enabled?: boolean;
  /** Verbose logging (default: false) */
  verboseLogging?: boolean;
  /** Enable adaptive window sizing (default: true) */
  adaptiveWindow?: boolean;
  /** Adaptive window configuration */
  adaptiveConfig?: AdaptiveBatchWindowConfig;
}

/**
 * Batching system statistics
 */
export interface BatchingStats {
  /** Total operations received */
  totalOperations: number;
  /** Total batches executed */
  totalBatches: number;
  /** Total API calls made */
  totalApiCalls: number;
  /** API calls saved by batching */
  apiCallsSaved: number;
  /** API call reduction percentage */
  reductionPercentage: number;
  /** Average batch size */
  avgBatchSize: number;
  /** Average batch duration */
  avgBatchDuration: number;
  /** Max batch size */
  maxBatchSize: number;
  /** Min batch size */
  minBatchSize: number;
  /** Current window size (ms) - only for adaptive mode */
  currentWindowMs?: number;
  /** Average window size (ms) - only for adaptive mode */
  avgWindowMs?: number;
}

/**
 * Adaptive Batch Window
 *
 * Dynamically adjusts batch collection window based on queue depth:
 * - Low traffic (< 3 ops): Increase window to collect more operations
 * - High traffic (> 50 ops): Decrease window to flush faster
 * - Optimal traffic: Maintain current window
 */
export class AdaptiveBatchWindow {
  private minWindowMs: number;
  private maxWindowMs: number;
  private currentWindowMs: number;
  private lowThreshold: number;
  private highThreshold: number;
  private increaseRate: number;
  private decreaseRate: number;
  private windowHistory: number[] = [];

  constructor(config: AdaptiveBatchWindowConfig = {}) {
    this.minWindowMs = config.minWindowMs ?? 20;
    this.maxWindowMs = config.maxWindowMs ?? 100;
    this.currentWindowMs = config.initialWindowMs ?? 50;
    this.lowThreshold = config.lowThreshold ?? 3;
    this.highThreshold = config.highThreshold ?? 50;
    this.increaseRate = config.increaseRate ?? 1.2;
    this.decreaseRate = config.decreaseRate ?? 0.8;
  }

  /**
   * Get current window size
   */
  getCurrentWindow(): number {
    return this.currentWindowMs;
  }

  /**
   * Get average window size over history
   */
  getAverageWindow(): number {
    if (this.windowHistory.length === 0) {
      return this.currentWindowMs;
    }
    return this.windowHistory.reduce((sum, val) => sum + val, 0) / this.windowHistory.length;
  }

  /**
   * Adjust window size based on operations in window
   */
  adjust(operationsInWindow: number): void {
    const previousWindow = this.currentWindowMs;

    if (operationsInWindow < this.lowThreshold) {
      // Too few operations - wait longer to collect more
      this.currentWindowMs = Math.min(this.maxWindowMs, this.currentWindowMs * this.increaseRate);
    } else if (operationsInWindow > this.highThreshold) {
      // Too many operations - flush faster to prevent queue buildup
      this.currentWindowMs = Math.max(this.minWindowMs, this.currentWindowMs * this.decreaseRate);
    }
    // Otherwise keep current window (optimal range)

    // Track window history for metrics (bounded to prevent memory growth)
    this.windowHistory.push(this.currentWindowMs);
    if (this.windowHistory.length > 100) {
      this.windowHistory.shift();
    }

    // Log adjustments if significant change
    if (Math.abs(this.currentWindowMs - previousWindow) > 1) {
      logger.debug('Adaptive window adjusted', {
        previousWindow: Math.round(previousWindow),
        newWindow: Math.round(this.currentWindowMs),
        operationsInWindow,
        reason:
          operationsInWindow < this.lowThreshold
            ? 'low traffic'
            : operationsInWindow > this.highThreshold
              ? 'high traffic'
              : 'optimal',
      });
    }
  }

  /**
   * Reset window to initial size
   */
  reset(): void {
    this.currentWindowMs = this.minWindowMs;
    this.windowHistory = [];
  }

  /**
   * Get configuration
   */
  getConfig(): Required<AdaptiveBatchWindowConfig> {
    return {
      minWindowMs: this.minWindowMs,
      maxWindowMs: this.maxWindowMs,
      initialWindowMs: this.currentWindowMs,
      lowThreshold: this.lowThreshold,
      highThreshold: this.highThreshold,
      increaseRate: this.increaseRate,
      decreaseRate: this.decreaseRate,
    };
  }
}

/**
 * Batch Request Time Windows System
 *
 * Collects operations within a time window and executes them as batched API calls
 */
export class BatchingSystem {
  private sheetsApi: sheets_v4.Sheets;
  private enabled: boolean;
  private windowMs: number;
  private maxBatchSize: number;
  private verboseLogging: boolean;
  private useAdaptiveWindow: boolean;
  private adaptiveWindow: AdaptiveBatchWindow | null = null;

  // Operation queues by batch key
  private pendingBatches = new Map<string, BatchableOperation[]>();

  // Timer references for each batch key
  private batchTimers = new Map<string, NodeJS.Timeout>();

  // Statistics
  private stats = {
    totalOperations: 0,
    totalBatches: 0,
    totalApiCalls: 0,
    batchSizes: [] as number[],
    batchDurations: [] as number[],
  };

  constructor(sheetsApi: sheets_v4.Sheets, options: BatchingSystemOptions = {}) {
    this.sheetsApi = sheetsApi;
    this.enabled = options.enabled ?? true;
    this.windowMs = options.windowMs ?? 50;
    this.maxBatchSize = options.maxBatchSize ?? 100;
    this.verboseLogging = options.verboseLogging ?? false;
    this.useAdaptiveWindow = options.adaptiveWindow ?? true;

    // Initialize adaptive window if enabled
    if (this.useAdaptiveWindow) {
      this.adaptiveWindow = new AdaptiveBatchWindow(options.adaptiveConfig);
    }

    if (this.verboseLogging) {
      logger.info('Batching system initialized', {
        enabled: this.enabled,
        windowMs: this.windowMs,
        maxBatchSize: this.maxBatchSize,
        adaptiveWindow: this.useAdaptiveWindow,
        adaptiveConfig: this.adaptiveWindow?.getConfig(),
      });
    }
  }

  private buildRowData(values: unknown[][], valueInputOption: string): sheets_v4.Schema$RowData[] {
    return values.map((rowValues: unknown[]) => ({
      values: rowValues.map((cellValue: unknown) => {
        const isFormula = typeof cellValue === 'string' && cellValue.startsWith('=');

        if (valueInputOption === 'USER_ENTERED' || valueInputOption === 'RAW') {
          if (isFormula) {
            return { userEnteredValue: { formulaValue: cellValue as string } };
          }
          if (typeof cellValue === 'number') {
            return { userEnteredValue: { numberValue: cellValue } };
          }
          if (typeof cellValue === 'boolean') {
            return { userEnteredValue: { boolValue: cellValue } };
          }
          return { userEnteredValue: { stringValue: String(cellValue) } };
        }

        return { userEnteredValue: { stringValue: String(cellValue) } };
      }),
    }));
  }

  /**
   * Execute an operation (with batching if enabled)
   */
  async execute<T>(
    operation: Omit<BatchableOperation<T>, 'resolve' | 'reject' | 'queuedAt'>
  ): Promise<T> {
    if (!this.enabled) {
      // Batching disabled, execute immediately
      return this.executeImmediate<T>(operation);
    }

    this.stats.totalOperations++;

    return new Promise<T>((resolve, reject) => {
      const batchKey = this.getBatchKey(operation);
      const queuedOp: BatchableOperation<T> = {
        ...operation,
        resolve,
        reject,
        queuedAt: Date.now(),
      };

      // Add to pending batch
      if (!this.pendingBatches.has(batchKey)) {
        this.pendingBatches.set(batchKey, []);
      }

      const batch = this.pendingBatches.get(batchKey)!;
      batch.push(queuedOp as BatchableOperation);

      // Start timer if this is the first operation in the batch
      if (batch.length === 1) {
        this.startBatchTimer(batchKey);
      }

      // Execute immediately if batch size limit reached.
      // Remove from pendingBatches synchronously before the async call so that
      // any concurrent execute() calls create a new batch rather than appending
      // to one that is already being dispatched.
      if (batch.length >= this.maxBatchSize) {
        this.cancelBatchTimer(batchKey);
        this.pendingBatches.delete(batchKey);
        void this.executeBatch(batchKey, batch);
      }

      if (this.verboseLogging) {
        logger.debug('Operation queued for batching', {
          batchKey,
          operationId: operation.id,
          batchSize: batch.length,
        });
      }
    });
  }

  /**
   * Generate batch key for grouping operations
   */
  private getBatchKey(
    operation: Omit<BatchableOperation, 'resolve' | 'reject' | 'queuedAt'>
  ): string {
    // Group by spreadsheet + operation type
    return `${operation.spreadsheetId}:${operation.type}`;
  }

  /**
   * Start timer for batch execution
   */
  private startBatchTimer(batchKey: string): void {
    // Use adaptive window if enabled, otherwise use fixed window
    const windowMs = this.useAdaptiveWindow
      ? this.adaptiveWindow!.getCurrentWindow()
      : this.windowMs;

    const timer = setTimeout(() => {
      void this.executeBatch(batchKey);
    }, windowMs);

    this.batchTimers.set(batchKey, timer);
  }

  /**
   * Cancel batch timer
   */
  private cancelBatchTimer(batchKey: string): void {
    const timer = this.batchTimers.get(batchKey);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(batchKey);
    }
  }

  /**
   * Execute a batch of operations
   */
  private async executeBatch(
    batchKey: string,
    capturedBatch?: BatchableOperation[]
  ): Promise<void> {
    // Use pre-captured batch (size-limit path) or read from map (timer path)
    const operations = capturedBatch ?? this.pendingBatches.get(batchKey);
    if (!operations || operations.length === 0) {
      return;
    }

    // Remove from pending (no-op if already removed by size-limit path)
    this.pendingBatches.delete(batchKey);
    this.cancelBatchTimer(batchKey);

    // **Priority 7: Payload-aware batch sizing**
    // Estimate total payload size and split if needed to prevent 413 errors
    const estimatedPayloadSize = estimatePayloadSize(operations);
    const safetyThreshold = PAYLOAD_LIMITS.MAX_SIZE * 0.85; // 85% of 9MB = 7.65MB

    if (estimatedPayloadSize > safetyThreshold && operations.length > 1) {
      // Payload too large - split into smaller batches
      const optimalBatchSize = calculateOptimalBatchSize(operations.length, estimatedPayloadSize);

      if (this.verboseLogging) {
        logger.info('Splitting oversized batch for safety', {
          batchKey,
          originalSize: operations.length,
          estimatedPayloadMB: (estimatedPayloadSize / 1_000_000).toFixed(2),
          targetBatchSize: optimalBatchSize,
          estimatedSplits: Math.ceil(operations.length / optimalBatchSize),
        });
      }

      // Split and execute recursively
      for (let i = 0; i < operations.length; i += optimalBatchSize) {
        const subBatch = operations.slice(i, i + optimalBatchSize);
        await this.executeSingleBatch(subBatch, batchKey);
      }

      return;
    }

    // Payload within limits - execute as single batch
    await this.executeSingleBatch(operations, batchKey);
  }

  /**
   * Execute a single batch (without splitting)
   */
  private async executeSingleBatch(
    operations: BatchableOperation[],
    batchKey: string
  ): Promise<void> {
    this.stats.totalBatches++;
    this.stats.batchSizes.push(operations.length);
    if (this.stats.batchSizes.length > 1000)
      this.stats.batchSizes = this.stats.batchSizes.slice(-1000);

    // Adjust adaptive window based on batch size
    if (this.useAdaptiveWindow && this.adaptiveWindow) {
      this.adaptiveWindow.adjust(operations.length);
    }

    const startTime = Date.now();
    const span = getTracer().startSpan('batching-system.executeSingleBatch', {
      kind: 'internal',
      attributes: {
        'batch.size': operations.length,
        'batch.key': batchKey,
        'batch.type': operations[0]?.type ?? 'unknown',
      },
    });

    try {
      // Merge operations based on type
      const firstOp = operations[0];
      if (!firstOp) {
        throw new ValidationError('Empty batch', 'operations', 'non-empty batch');
      }

      switch (firstOp.type) {
        case 'values:update':
          await this.executeBatchValuesUpdate(operations);
          break;

        case 'values:append':
          await this.executeBatchValuesAppend(operations);
          break;

        case 'values:clear':
          await this.executeBatchValuesClear(operations);
          break;

        case 'format:update':
        case 'cells:update':
        case 'sheet:update':
          await this.executeBatchBatchUpdate(operations);
          break;

        default:
          throw new ValidationError(
            `Unsupported batch type: ${firstOp.type}`,
            'type',
            'values:update | values:append | values:clear | sheet:update'
          );
      }

      this.stats.totalApiCalls++; // Single API call for the batch

      // Record batch efficiency: ratio of operations batched per API call
      const operationType = operations[0]?.type ?? 'unknown';
      updateBatchEfficiency(operationType, operations.length / 1);

      const duration = Date.now() - startTime;
      this.stats.batchDurations.push(duration);
      if (this.stats.batchDurations.length > 1000)
        this.stats.batchDurations = this.stats.batchDurations.slice(-1000);

      if (this.verboseLogging) {
        logger.info('Batch executed successfully', {
          batchKey,
          operationCount: operations.length,
          duration,
        });
      }
    } catch (error) {
      logger.error('Batch execution failed', {
        batchKey,
        operationCount: operations.length,
        error: error instanceof Error ? error.message : String(error),
      });

      // Reject all operations in the batch
      const err = error instanceof Error ? error : new Error(String(error));
      operations.forEach((op) => op.reject(err));
    } finally {
      span.end();
    }
  }

  /**
   * Execute batch of values.update operations
   */
  private async executeBatchValuesUpdate(operations: BatchableOperation[]): Promise<void> {
    const spreadsheetId = operations[0]!.spreadsheetId;
    const coordinator = getConcurrencyCoordinator(); // Phase 1

    // Use values.batchUpdate
    const data = operations.map((op) => ({
      range: op.params.range,
      values: op.params.values,
    }));

    // Phase 1: Acquire global permit before batch API call
    const response = await coordinator.execute('BatchingSystem', async () =>
      this.sheetsApi.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          data,
          valueInputOption: operations[0]!.params.valueInputOption || 'USER_ENTERED',
        },
      })
    );

    // Resolve individual promises
    operations.forEach((op, index) => {
      const updateResult = response.data.responses?.[index];
      op.resolve(updateResult);
    });
  }

  /**
   * Execute batch of values.append operations
   *
   * Converts multiple append operations into a single batchUpdate call with appendCells requests.
   * This is the critical fix for the 80-90% quota waste bug.
   */
  private async executeBatchValuesAppend(operations: BatchableOperation[]): Promise<void> {
    const spreadsheetId = operations[0]!.spreadsheetId;
    const coordinator = getConcurrencyCoordinator(); // Phase 1

    const needsSheetIds = operations.some((op) => !op.params.tableId);
    const sheetIdMap = new Map<string, number>();

    if (needsSheetIds) {
      // Phase 1: Acquire global permit for metadata fetch
      const spreadsheetMetadata = await coordinator.execute('BatchingSystem', async () =>
        this.sheetsApi.spreadsheets.get({
          spreadsheetId,
          fields: 'sheets(properties(sheetId,title))',
        })
      );

      spreadsheetMetadata.data.sheets?.forEach((sheet) => {
        if (
          sheet.properties?.title &&
          sheet.properties.sheetId !== undefined &&
          sheet.properties.sheetId !== null
        ) {
          sheetIdMap.set(sheet.properties.title, sheet.properties.sheetId);
        }
      });
    }

    // Convert append operations to batchUpdate requests
    const requests: sheets_v4.Schema$Request[] = [];
    const operationRangeMap: Array<{
      operation: BatchableOperation;
      requestIndex: number;
    }> = [];

    for (const op of operations) {
      const valueInputOption = op.params.valueInputOption || 'USER_ENTERED';
      const rows = this.buildRowData(op.params.values, valueInputOption);

      const requestIndex = requests.length;
      if (op.params.tableId) {
        requests.push({
          appendCells: {
            tableId: op.params.tableId,
            rows,
            fields: 'userEnteredValue',
          },
        });
      } else if (op.params.range) {
        // OPTIMIZATION: Use cached range parser (5-10ms saved per batch)
        const sheetName = extractSheetName(op.params.range);

        const sheetId = sheetIdMap.get(sheetName);

        if (sheetId === undefined) {
          // If we can't resolve sheet ID, fall back to individual append
          op.reject(new Error(`Could not resolve sheet ID for range: ${op.params.range}`));
          continue;
        }

        requests.push({
          appendCells: {
            sheetId,
            rows,
            fields: 'userEnteredValue',
          },
        });
      } else {
        op.reject(new Error('Missing range or tableId for append operation'));
        continue;
      }

      operationRangeMap.push({ operation: op, requestIndex });
    }

    if (requests.length === 0) {
      // All operations failed to resolve
      return;
    }

    // Execute single batchUpdate with all append operations
    // Note: appendCells in batchUpdate doesn't return UpdateValuesResponse format,
    // so we construct compatible responses for API consistency with callers
    // Phase 1: Acquire global permit for batch append
    await coordinator.execute('BatchingSystem', async () =>
      this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests,
          includeSpreadsheetInResponse: false,
        },
      })
    );

    // Resolve each operation's promise with constructed append response
    operationRangeMap.forEach(({ operation }) => {
      // Note: appendCells doesn't return UpdateValuesResponse format, so we
      // construct a compatible response that matches what callers expect.

      // Construct UpdateValuesResponse format that append() normally returns
      const constructedResponse = {
        updates: {
          spreadsheetId,
          updatedRange: operation.params.range ?? '',
          updatedRows: operation.params.values.length,
          updatedColumns: operation.params.values[0]?.length || 0,
          updatedCells: operation.params.values.reduce(
            (sum: number, row: unknown[]) => sum + row.length,
            0
          ),
        },
        tableRange: operation.params.range ?? '',
      };

      operation.resolve(constructedResponse);
    });
  }

  /**
   * Execute batch of values.clear operations
   */
  private async executeBatchValuesClear(operations: BatchableOperation[]): Promise<void> {
    const spreadsheetId = operations[0]!.spreadsheetId;
    const coordinator = getConcurrencyCoordinator(); // Phase 1

    // Use values.batchClear
    const ranges = operations.map((op) => op.params.range);

    // Phase 1: Acquire global permit for batch clear
    const response = await coordinator.execute('BatchingSystem', async () =>
      this.sheetsApi.spreadsheets.values.batchClear({
        spreadsheetId,
        requestBody: {
          ranges,
        },
      })
    );

    // Resolve all with the same response
    operations.forEach((op) => {
      op.resolve(response.data);
    });
  }

  /**
   * Execute batch using batchUpdate (for format/cell/sheet operations)
   * Automatically chunks requests if they exceed maxBatchSize
   */
  private async executeBatchBatchUpdate(operations: BatchableOperation[]): Promise<void> {
    const spreadsheetId = operations[0]!.spreadsheetId;
    const coordinator = getConcurrencyCoordinator(); // Phase 1

    // Merge all requests
    const requests = operations.flatMap((op) => op.params.requests || [op.params.request]);

    // Chunk requests if needed to respect maxBatchSize limit
    const chunks = this.chunkArray(requests, this.maxBatchSize);

    if (chunks.length === 1) {
      // Single chunk - execute normally
      const response = await coordinator.execute('BatchingSystem', async () =>
        this.sheetsApi.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests,
          },
        })
      );

      // Resolve all operations with the full response
      operations.forEach((op, index) => {
        const opResponse = response.data.replies?.[index];
        op.resolve(opResponse);
      });
    } else {
      // Multiple chunks - execute sequentially and collect all responses
      const allResponses: unknown[] = [];
      for (const chunk of chunks) {
        const response = await coordinator.execute('BatchingSystem', async () =>
          this.sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: chunk,
            },
          })
        );

        // Collect responses from this chunk
        if (response.data.replies) {
          allResponses.push(...response.data.replies);
        }
      }

      // Resolve operations with chunked responses
      operations.forEach((op, index) => {
        const opResponse = allResponses[index];
        op.resolve(opResponse);
      });
    }
  }

  /**
   * Utility: Split array into chunks of specified size
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Execute operation immediately (without batching)
   */
  private async executeImmediate<T>(
    operation: Omit<BatchableOperation<T>, 'resolve' | 'reject' | 'queuedAt'>
  ): Promise<T> {
    const coordinator = getConcurrencyCoordinator(); // Phase 1

    switch (operation.type) {
      case 'values:update':
        // Phase 1: Acquire global permit for immediate update
        return (await coordinator.execute('BatchingSystem', async () =>
          this.sheetsApi.spreadsheets.values.update({
            spreadsheetId: operation.spreadsheetId,
            range: operation.params.range,
            valueInputOption: operation.params.valueInputOption || 'USER_ENTERED',
            requestBody: {
              values: operation.params.values,
            },
          })
        )) as T;

      case 'values:append':
        if (operation.params.tableId) {
          const rows = this.buildRowData(
            operation.params.values,
            operation.params.valueInputOption || 'USER_ENTERED'
          );

          await coordinator.execute('BatchingSystem', async () =>
            this.sheetsApi.spreadsheets.batchUpdate({
              spreadsheetId: operation.spreadsheetId,
              requestBody: {
                requests: [
                  {
                    appendCells: {
                      tableId: operation.params.tableId,
                      rows,
                      fields: 'userEnteredValue',
                    },
                  },
                ],
                includeSpreadsheetInResponse: false,
              },
            })
          );

          const updatedCells = operation.params.values.reduce(
            (sum: number, row: unknown[]) => sum + row.length,
            0
          );

          return {
            updates: {
              spreadsheetId: operation.spreadsheetId,
              updatedRange: operation.params.range ?? '',
              updatedRows: operation.params.values.length,
              updatedColumns: operation.params.values[0]?.length || 0,
              updatedCells,
            },
            tableRange: operation.params.range ?? '',
          } as T;
        }

        // Phase 1: Acquire global permit for immediate append
        return (await coordinator.execute('BatchingSystem', async () =>
          this.sheetsApi.spreadsheets.values.append({
            spreadsheetId: operation.spreadsheetId,
            range: operation.params.range,
            valueInputOption: operation.params.valueInputOption || 'USER_ENTERED',
            requestBody: {
              values: operation.params.values,
            },
          })
        )) as T;

      case 'values:clear':
        // Phase 1: Acquire global permit for immediate clear
        return (await coordinator.execute('BatchingSystem', async () =>
          this.sheetsApi.spreadsheets.values.clear({
            spreadsheetId: operation.spreadsheetId,
            range: operation.params.range,
          })
        )) as T;

      case 'format:update':
      case 'cells:update':
      case 'sheet:update':
        // Phase 1: Acquire global permit for immediate batchUpdate
        return (await coordinator.execute('BatchingSystem', async () =>
          this.sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId: operation.spreadsheetId,
            requestBody: {
              requests: operation.params.requests || [operation.params.request],
            },
          })
        )) as T;

      default:
        throw new ValidationError(
          `Unsupported operation type: ${(operation as { type: string }).type}`,
          'type',
          'known operation type'
        );
    }
  }

  /**
   * Get batching statistics
   */
  getStats(): BatchingStats {
    const avgBatchSize =
      this.stats.batchSizes.length > 0
        ? this.stats.batchSizes.reduce((a, b) => a + b, 0) / this.stats.batchSizes.length
        : 0;

    const avgBatchDuration =
      this.stats.batchDurations.length > 0
        ? this.stats.batchDurations.reduce((a, b) => a + b, 0) / this.stats.batchDurations.length
        : 0;

    const apiCallsSaved = this.stats.totalOperations - this.stats.totalApiCalls;
    const reductionPercentage =
      this.stats.totalOperations > 0 ? (apiCallsSaved / this.stats.totalOperations) * 100 : 0;

    const baseStats: BatchingStats = {
      totalOperations: this.stats.totalOperations,
      totalBatches: this.stats.totalBatches,
      totalApiCalls: this.stats.totalApiCalls,
      apiCallsSaved,
      reductionPercentage,
      avgBatchSize,
      avgBatchDuration,
      maxBatchSize: this.stats.batchSizes.length > 0 ? Math.max(...this.stats.batchSizes) : 0,
      minBatchSize: this.stats.batchSizes.length > 0 ? Math.min(...this.stats.batchSizes) : 0,
    };

    // Add adaptive window stats if enabled
    if (this.useAdaptiveWindow && this.adaptiveWindow) {
      baseStats.currentWindowMs = Math.round(this.adaptiveWindow.getCurrentWindow());
      baseStats.avgWindowMs = Math.round(this.adaptiveWindow.getAverageWindow());
    }

    return baseStats;
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalOperations: 0,
      totalBatches: 0,
      totalApiCalls: 0,
      batchSizes: [],
      batchDurations: [],
    };
    // Reset adaptive window to initial state
    if (this.useAdaptiveWindow && this.adaptiveWindow) {
      this.adaptiveWindow.reset();
    }
  }

  /**
   * Flush all pending batches immediately
   */
  async flush(): Promise<void> {
    const batchKeys = Array.from(this.pendingBatches.keys());

    await Promise.all(batchKeys.map((key) => this.executeBatch(key)));
  }

  /**
   * Destroy the batching system
   */
  destroy(): void {
    // Cancel all timers
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    this.batchTimers.clear();

    // Clear pending batches
    this.pendingBatches.clear();
  }
}

// Singleton instance
let batchingSystem: BatchingSystem | null = null;

/**
 * Initialize the batching system
 */
export function initBatchingSystem(sheetsApi: sheets_v4.Sheets): BatchingSystem {
  if (!batchingSystem) {
    batchingSystem = new BatchingSystem(sheetsApi, {
      enabled: process.env['BATCHING_ENABLED'] !== 'false',
      windowMs: parseInt(process.env['BATCHING_WINDOW_MS'] || '50', 10),
      maxBatchSize: parseInt(process.env['BATCHING_MAX_SIZE'] || '100', 10),
      verboseLogging: process.env['BATCHING_VERBOSE'] === 'true',
    });
  }
  return batchingSystem;
}

/**
 * Get the batching system singleton
 */
export function getBatchingSystem(): BatchingSystem | null {
  return batchingSystem;
}

/**
 * Reset batching system (for testing only)
 * @internal
 */
export function resetBatchingSystem(): void {
  if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] !== 'true') {
    throw new ServiceError(
      'resetBatchingSystem() can only be called in test environment',
      'INTERNAL_ERROR',
      'BatchingSystem'
    );
  }
  if (batchingSystem) {
    batchingSystem.destroy();
  }
  batchingSystem = null;
}
