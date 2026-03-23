/**
 * HistoryService
 *
 * @purpose Tracks last 100 operations in circular buffer for debugging, undo support, and audit trail
 * @category Infrastructure
 * @usage Use to record all operations with timestamps; supports filtering by tool/action/spreadsheet, fast O(1) lookups by ID
 * @dependencies logger, history types
 * @stateful Yes - maintains circular buffer (max 100), operation ID index, statistics (total count, tool breakdown)
 * @singleton Yes - one instance per process to maintain global operation history
 *
 * @example
 * const history = new HistoryService({ maxSize: 100 });
 * history.record({ id: 'op123', tool: 'sheets_data', action: 'write', spreadsheetId: '1ABC', status: 'success' });
 * const ops = history.list({ tool: 'sheets_data', limit: 10 }); // Last 10 data operations
 * const stats = history.getStats(); // { totalOperations: 500, byTool: {...} }
 */

import type {
  OperationHistory,
  OperationHistoryStats,
  OperationHistoryFilter,
} from '../types/history.js';
import { resourceNotifications } from '../resources/notifications.js';
import { logger } from '../utils/logger.js';
import { BoundedCache } from '../utils/bounded-cache.js';
import { ServiceError } from '../core/errors.js';

/** Wrapper for operation ID arrays (required for BoundedCache object constraint) */
interface OperationStack {
  operationIds: string[];
}

export interface HistoryServiceOptions {
  /** Maximum number of operations to keep (default: 100) */
  maxSize?: number;
  /** Enable detailed logging (default: false) */
  verboseLogging?: boolean;
}

/**
 * Operation History Service
 *
 * Maintains a circular buffer of recent operations for:
 * - Debugging (view recent operations and errors)
 * - Undo/Redo (operations include snapshot IDs)
 * - Audit trail (compliance and security)
 * - Performance analysis (operation durations)
 */
export class HistoryService {
  private operations: OperationHistory[] = [];
  private operationsMap: Map<string, OperationHistory> = new Map();
  private maxSize: number;
  private verboseLogging: boolean;

  // Phase 1.4: Bounded caches for undo/redo stacks per spreadsheet
  private undoStacks: BoundedCache<string, OperationStack>; // spreadsheetId -> {operationIds}
  private redoStacks: BoundedCache<string, OperationStack>; // spreadsheetId -> {operationIds}

  constructor(options: HistoryServiceOptions = {}) {
    this.maxSize = options.maxSize ?? 100;
    this.verboseLogging = options.verboseLogging ?? false;

    // Phase 1.4: Initialize bounded caches for undo/redo stacks
    this.undoStacks = new BoundedCache<string, OperationStack>({
      maxSize: 1000, // Support up to 1000 active spreadsheets
      ttl: 24 * 60 * 60 * 1000, // 24 hour TTL (clean up abandoned spreadsheets)
      onEviction: (spreadsheetId) => {
        logger.debug('Undo stack evicted', { spreadsheetId });
      },
    });

    this.redoStacks = new BoundedCache<string, OperationStack>({
      maxSize: 1000,
      ttl: 24 * 60 * 60 * 1000,
      onEviction: (spreadsheetId) => {
        logger.debug('Redo stack evicted', { spreadsheetId });
      },
    });

    logger.info('History service initialized', {
      maxSize: this.maxSize,
      verboseLogging: this.verboseLogging,
    });
  }

  /**
   * Record an operation
   */
  record(operation: OperationHistory): void {
    // Add to array
    this.operations.push(operation);

    // Add to map for fast lookup
    this.operationsMap.set(operation.id, operation);

    // Add to undo stack if it has a snapshot (only successful write operations)
    if (operation.result === 'success' && operation.snapshotId && operation.spreadsheetId) {
      const stack = this.undoStacks.get(operation.spreadsheetId) || { operationIds: [] };
      stack.operationIds.push(operation.id);
      this.undoStacks.set(operation.spreadsheetId, stack);

      // Clear redo stack when new operation is performed
      this.redoStacks.set(operation.spreadsheetId, { operationIds: [] });
    }

    // Maintain circular buffer
    if (this.operations.length > this.maxSize) {
      const removed = this.operations.shift();
      if (removed) {
        this.operationsMap.delete(removed.id);
      }
    }

    if (this.verboseLogging) {
      logger.debug('Operation recorded in history', {
        id: operation.id,
        tool: operation.tool,
        action: operation.action,
        result: operation.result,
        duration: operation.duration,
        hasSnapshot: !!operation.snapshotId,
      });
    }

    resourceNotifications.notifyHistoryUpdated(this.operations.length, operation.spreadsheetId);
  }

  /**
   * Get operation by ID
   */
  getById(id: string): OperationHistory | undefined {
    return this.operationsMap.get(id);
  }

  /**
   * Get all operations (optionally filtered)
   */
  getAll(filter?: OperationHistoryFilter): OperationHistory[] {
    let filtered = [...this.operations];

    if (filter) {
      if (filter.tool) {
        filtered = filtered.filter((op) => op.tool === filter.tool);
      }

      if (filter.action) {
        filtered = filtered.filter((op) => op.action === filter.action);
      }

      if (filter.result) {
        filtered = filtered.filter((op) => op.result === filter.result);
      }

      if (filter.spreadsheetId) {
        filtered = filtered.filter((op) => op.spreadsheetId === filter.spreadsheetId);
      }

      if (filter.startTime) {
        const startTime = new Date(filter.startTime).getTime();
        filtered = filtered.filter((op) => new Date(op.timestamp).getTime() >= startTime);
      }

      if (filter.endTime) {
        const endTime = new Date(filter.endTime).getTime();
        filtered = filtered.filter((op) => new Date(op.timestamp).getTime() <= endTime);
      }

      if (filter.limit && filter.limit > 0) {
        filtered = filtered.slice(-filter.limit);
      }
    }

    return filtered;
  }

  /**
   * Get recent operations (last N)
   */
  getRecent(count: number = 10): OperationHistory[] {
    return this.operations.slice(-count);
  }

  /**
   * Get failed operations
   */
  getFailures(count?: number): OperationHistory[] {
    const failures = this.operations.filter((op) => op.result === 'error');
    return count ? failures.slice(-count) : failures;
  }

  /**
   * Get operations for a specific spreadsheet
   */
  getBySpreadsheet(spreadsheetId: string, count?: number): OperationHistory[] {
    const ops = this.operations.filter((op) => op.spreadsheetId === spreadsheetId);
    return count ? ops.slice(-count) : ops;
  }

  /**
   * Get statistics for all operations or a specific spreadsheet
   * @param spreadsheetId Optional spreadsheet ID to filter by
   */
  getStats(spreadsheetId?: string): OperationHistoryStats {
    const ops = spreadsheetId
      ? this.operations.filter((op) => op.spreadsheetId === spreadsheetId)
      : this.operations;

    const total = ops.length;
    const successful = ops.filter((op) => op.result === 'success').length;
    const failed = total - successful;

    const totalDuration = ops.reduce((sum, op) => sum + op.duration, 0);
    const averageDuration = total > 0 ? totalDuration / total : 0;

    const totalCells = ops.reduce((sum, op) => sum + (op.cellsAffected || 0), 0);

    // Find most common tool
    const toolCounts = new Map<string, number>();
    ops.forEach((op) => {
      toolCounts.set(op.tool, (toolCounts.get(op.tool) || 0) + 1);
    });
    const mostCommonTool = this.getMostCommon(toolCounts);

    // Find most common action
    const actionCounts = new Map<string, number>();
    ops.forEach((op) => {
      actionCounts.set(op.action, (actionCounts.get(op.action) || 0) + 1);
    });
    const mostCommonAction = this.getMostCommon(actionCounts);

    return {
      totalOperations: total,
      successfulOperations: successful,
      failedOperations: failed,
      successRate: total > 0 ? successful / total : 0,
      averageDuration,
      totalCellsAffected: totalCells,
      mostCommonTool,
      mostCommonAction,
      oldestOperation: ops[0]?.timestamp,
      newestOperation: ops[ops.length - 1]?.timestamp,
    };
  }

  /**
   * Helper to find most common value in a map
   */
  private getMostCommon(counts: Map<string, number>): string | undefined {
    let maxCount = 0;
    let maxKey: string | undefined;

    counts.forEach((count, key) => {
      if (count > maxCount) {
        maxCount = count;
        maxKey = key;
      }
    });

    return maxKey;
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.operations = [];
    this.operationsMap.clear();
    this.undoStacks.clear();
    this.redoStacks.clear();

    logger.info('Operation history cleared');
    resourceNotifications.notifyHistoryUpdated(0);
  }

  /**
   * Get current size
   */
  size(): number {
    return this.operations.length;
  }

  /**
   * Check if history is full
   */
  isFull(): boolean {
    return this.operations.length >= this.maxSize;
  }

  /**
   * Get the last undoable operation for a spreadsheet
   */
  getLastUndoable(spreadsheetId: string): OperationHistory | undefined {
    const stack = this.undoStacks.get(spreadsheetId);
    if (!stack || stack.operationIds.length === 0) {
      // OK: Explicit empty - typed as optional, no undoable operations available
      return undefined;
    }

    const operationId = stack.operationIds.at(-1);
    return operationId ? this.operationsMap.get(operationId) : undefined;
  }

  /**
   * Get the last redoable operation for a spreadsheet
   */
  getLastRedoable(spreadsheetId: string): OperationHistory | undefined {
    const stack = this.redoStacks.get(spreadsheetId);
    if (!stack || stack.operationIds.length === 0) {
      // OK: Explicit empty - typed as optional, no redoable operations available
      return undefined;
    }

    const operationId = stack.operationIds.at(-1);
    return operationId ? this.operationsMap.get(operationId) : undefined;
  }

  /**
   * Mark operation as undone (moves from undo stack to redo stack)
   */
  markAsUndone(operationId: string, spreadsheetId: string): void {
    const undoStack = this.undoStacks.get(spreadsheetId) || { operationIds: [] };
    const redoStack = this.redoStacks.get(spreadsheetId) || { operationIds: [] };

    // Remove from undo stack
    const index = undoStack.operationIds.indexOf(operationId);
    if (index !== -1) {
      undoStack.operationIds.splice(index, 1);
      this.undoStacks.set(spreadsheetId, undoStack);

      // Add to redo stack
      redoStack.operationIds.push(operationId);
      this.redoStacks.set(spreadsheetId, redoStack);
      resourceNotifications.notifyHistoryUpdated(this.operations.length, spreadsheetId);
    }
  }

  /**
   * Mark operation as redone (moves from redo stack to undo stack)
   */
  markAsRedone(operationId: string, spreadsheetId: string): void {
    const undoStack = this.undoStacks.get(spreadsheetId) || { operationIds: [] };
    const redoStack = this.redoStacks.get(spreadsheetId) || { operationIds: [] };

    // Remove from redo stack
    const index = redoStack.operationIds.indexOf(operationId);
    if (index !== -1) {
      redoStack.operationIds.splice(index, 1);
      this.redoStacks.set(spreadsheetId, redoStack);

      // Add to undo stack
      undoStack.operationIds.push(operationId);
      this.undoStacks.set(spreadsheetId, undoStack);
      resourceNotifications.notifyHistoryUpdated(this.operations.length, spreadsheetId);
    }
  }

  /**
   * Clear operations for a specific spreadsheet
   */
  clearForSpreadsheet(spreadsheetId: string): number {
    // Remove operations
    const before = this.operations.length;
    this.operations = this.operations.filter((op) => op.spreadsheetId !== spreadsheetId);
    const removed = before - this.operations.length;

    // Rebuild map
    this.operationsMap.clear();
    this.operations.forEach((op) => {
      this.operationsMap.set(op.id, op);
    });

    // Clear undo/redo stacks
    if (this.undoStacks.has(spreadsheetId)) {
      this.undoStacks.delete(spreadsheetId);
    }
    if (this.redoStacks.has(spreadsheetId)) {
      this.redoStacks.delete(spreadsheetId);
    }

    logger.info(`Cleared ${removed} operations for spreadsheet ${spreadsheetId}`);
    resourceNotifications.notifyHistoryUpdated(this.operations.length, spreadsheetId);
    return removed;
  }

  /**
   * Get undo stack size for a spreadsheet
   */
  getUndoStackSize(spreadsheetId: string): number {
    return this.undoStacks.get(spreadsheetId)?.operationIds.length || 0;
  }

  /**
   * Get redo stack size for a spreadsheet
   */
  getRedoStackSize(spreadsheetId: string): number {
    return this.redoStacks.get(spreadsheetId)?.operationIds.length || 0;
  }

  /**
   * Get undo stack for a spreadsheet
   * Returns array of operation IDs that can be undone
   */
  getUndoStack(spreadsheetId: string): string[] {
    return this.undoStacks.get(spreadsheetId)?.operationIds || [];
  }

  /**
   * Get redo stack for a spreadsheet
   * Returns array of operation IDs that can be redone
   */
  getRedoStack(spreadsheetId: string): string[] {
    return this.redoStacks.get(spreadsheetId)?.operationIds || [];
  }

  // ==================== Extended History Features ====================

  /**
   * Record an operation with extended tracking
   * Returns the operation ID for referencing
   */
  recordOperation(params: {
    spreadsheetId: string;
    tool: string;
    action: string;
    params: Record<string, unknown>;
    result?: { success: boolean; [key: string]: unknown };
    error?: Error;
    snapshotId?: string;
    timestamp: Date;
    cellsAffected?: number;
    rowsAffected?: number;
  }): string {
    const operationId = `op-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const operation: OperationHistory = {
      id: operationId,
      timestamp: params.timestamp.toISOString(),
      tool: params.tool,
      action: params.action,
      params: params.params,
      result: params.error ? 'error' : 'success',
      duration: 0, // Will be updated if duration tracking is added
      spreadsheetId: params.spreadsheetId,
      cellsAffected: params.cellsAffected,
      rowsAffected: params.rowsAffected,
      snapshotId: params.snapshotId,
      errorMessage: params.error?.message,
    };

    this.record(operation);
    return operationId;
  }

  /**
   * Get operation history for a specific spreadsheet
   * @param spreadsheetId The spreadsheet ID
   * @param options Optional parameters (limit, etc.)
   * @returns Array of operations in reverse chronological order
   */
  getHistory(spreadsheetId: string, options?: { limit?: number }): OperationHistory[] {
    let ops = this.operations.filter((op) => op.spreadsheetId === spreadsheetId);

    // Sort by timestamp (most recent first)
    ops.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Apply limit if specified
    if (options?.limit && options.limit > 0) {
      ops = ops.slice(0, options.limit);
    }

    return ops;
  }

  /**
   * Get a specific operation by ID for a spreadsheet
   * @param spreadsheetId The spreadsheet ID
   * @param operationId The operation ID
   * @returns The operation or undefined if not found
   */
  getOperation(spreadsheetId: string, operationId: string): OperationHistory | undefined {
    const operation = this.operationsMap.get(operationId);
    if (operation && operation.spreadsheetId === spreadsheetId) {
      return operation;
    }
    // OK: Explicit empty - typed as optional, operation not found
    return undefined;
  }

  /**
   * Search operation history with filters
   * @param spreadsheetId The spreadsheet ID
   * @param filters Search criteria
   * @returns Filtered operations
   */
  searchHistory(
    spreadsheetId: string,
    filters: {
      tool?: string;
      action?: string;
      startTime?: Date;
      endTime?: Date;
      result?: 'success' | 'error';
    }
  ): OperationHistory[] {
    let ops = this.operations.filter((op) => op.spreadsheetId === spreadsheetId);

    if (filters.tool) {
      ops = ops.filter((op) => op.tool === filters.tool);
    }

    if (filters.action) {
      ops = ops.filter((op) => op.action === filters.action);
    }

    if (filters.startTime) {
      const startTime = filters.startTime.getTime();
      ops = ops.filter((op) => new Date(op.timestamp).getTime() >= startTime);
    }

    if (filters.endTime) {
      const endTime = filters.endTime.getTime();
      ops = ops.filter((op) => new Date(op.timestamp).getTime() <= endTime);
    }

    if (filters.result) {
      ops = ops.filter((op) => op.result === filters.result);
    }

    return ops;
  }

  /**
   * Clear operation history for a specific spreadsheet
   * @param spreadsheetId The spreadsheet ID
   */
  clearHistory(spreadsheetId: string): void {
    // Remove operations from array
    this.operations = this.operations.filter((op) => op.spreadsheetId !== spreadsheetId);

    // Remove from map
    for (const [id, op] of this.operationsMap.entries()) {
      if (op.spreadsheetId === spreadsheetId) {
        this.operationsMap.delete(id);
      }
    }

    // Clear undo/redo stacks
    this.undoStacks.delete(spreadsheetId);
    this.redoStacks.delete(spreadsheetId);

    logger.info('Cleared history for spreadsheet', { spreadsheetId });
    resourceNotifications.notifyHistoryUpdated(this.operations.length, spreadsheetId);
  }
}

// Singleton instance
let historyService: HistoryService | null = null;

/**
 * Get or create the history service singleton
 */
export function getHistoryService(): HistoryService {
  if (!historyService) {
    historyService = new HistoryService();
  }
  return historyService;
}

/**
 * Set the history service (for testing or custom configuration)
 */
export function setHistoryService(service: HistoryService): void {
  historyService = service;
}

/**
 * Reset the history service (for testing only)
 * @internal
 */
export function resetHistoryService(): void {
  if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] !== 'true') {
    throw new ServiceError(
      'resetHistoryService() can only be called in test environment',
      'INTERNAL_ERROR',
      'HistoryService'
    );
  }
  historyService = null;
}
