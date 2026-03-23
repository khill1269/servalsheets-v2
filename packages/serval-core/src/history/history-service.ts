/**
 * Serval Core - History Service
 *
 * Platform-agnostic operation history tracking.
 * Tracks last N operations in circular buffer for debugging, undo support, and audit trail.
 *
 * Uses `documentId` instead of platform-specific identifiers (spreadsheetId, workbookId).
 */

import type {
  OperationHistory,
  OperationHistoryStats,
  OperationHistoryFilter,
} from '../types/history.js';
import { defaultLogger } from '../utils/logger.js';
import { BoundedCache } from '../utils/bounded-cache.js';

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

  private undoStacks: BoundedCache<string, OperationStack>;
  private redoStacks: BoundedCache<string, OperationStack>;

  constructor(options: HistoryServiceOptions = {}) {
    this.maxSize = options.maxSize ?? 100;
    this.verboseLogging = options.verboseLogging ?? false;

    this.undoStacks = new BoundedCache<string, OperationStack>({
      maxSize: 1000,
      ttl: 24 * 60 * 60 * 1000,
      onEviction: (documentId) => {
        defaultLogger.debug('Undo stack evicted', { documentId });
      },
    });

    this.redoStacks = new BoundedCache<string, OperationStack>({
      maxSize: 1000,
      ttl: 24 * 60 * 60 * 1000,
      onEviction: (documentId) => {
        defaultLogger.debug('Redo stack evicted', { documentId });
      },
    });

    defaultLogger.info('History service initialized', {
      maxSize: this.maxSize,
      verboseLogging: this.verboseLogging,
    });
  }

  /**
   * Record an operation
   */
  record(operation: OperationHistory): void {
    this.operations.push(operation);
    this.operationsMap.set(operation.id, operation);

    // Add to undo stack if it has a snapshot (only successful write operations)
    if (operation.result === 'success' && operation.snapshotId && operation.documentId) {
      const stack = this.undoStacks.get(operation.documentId) || { operationIds: [] };
      stack.operationIds.push(operation.id);
      this.undoStacks.set(operation.documentId, stack);

      // Clear redo stack when new operation is performed
      this.redoStacks.set(operation.documentId, { operationIds: [] });
    }

    // Maintain circular buffer
    if (this.operations.length > this.maxSize) {
      const removed = this.operations.shift();
      if (removed) {
        this.operationsMap.delete(removed.id);
      }
    }

    if (this.verboseLogging) {
      defaultLogger.debug('Operation recorded in history', {
        id: operation.id,
        tool: operation.tool,
        action: operation.action,
        result: operation.result,
        duration: operation.duration,
        hasSnapshot: !!operation.snapshotId,
      });
    }
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
      if (filter.documentId) {
        filtered = filtered.filter((op) => op.documentId === filter.documentId);
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
   * Get operations for a specific document
   */
  getByDocument(documentId: string, count?: number): OperationHistory[] {
    const ops = this.operations.filter((op) => op.documentId === documentId);
    return count ? ops.slice(-count) : ops;
  }

  /**
   * Get statistics for all operations or a specific document
   */
  getStats(documentId?: string): OperationHistoryStats {
    const ops = documentId
      ? this.operations.filter((op) => op.documentId === documentId)
      : this.operations;

    const total = ops.length;
    const successful = ops.filter((op) => op.result === 'success').length;
    const failed = total - successful;

    const totalDuration = ops.reduce((sum, op) => sum + op.duration, 0);
    const averageDuration = total > 0 ? totalDuration / total : 0;
    const totalCells = ops.reduce((sum, op) => sum + (op.cellsAffected || 0), 0);

    const toolCounts = new Map<string, number>();
    ops.forEach((op) => {
      toolCounts.set(op.tool, (toolCounts.get(op.tool) || 0) + 1);
    });
    const mostCommonTool = this.getMostCommon(toolCounts);

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
    defaultLogger.info('Operation history cleared');
  }

  size(): number {
    return this.operations.length;
  }

  isFull(): boolean {
    return this.operations.length >= this.maxSize;
  }

  /**
   * Get the last undoable operation for a document
   */
  getLastUndoable(documentId: string): OperationHistory | undefined {
    const stack = this.undoStacks.get(documentId);
    if (!stack || stack.operationIds.length === 0) return undefined;
    const operationId = stack.operationIds.at(-1);
    return operationId ? this.operationsMap.get(operationId) : undefined;
  }

  /**
   * Get the last redoable operation for a document
   */
  getLastRedoable(documentId: string): OperationHistory | undefined {
    const stack = this.redoStacks.get(documentId);
    if (!stack || stack.operationIds.length === 0) return undefined;
    const operationId = stack.operationIds.at(-1);
    return operationId ? this.operationsMap.get(operationId) : undefined;
  }

  /**
   * Mark operation as undone (moves from undo stack to redo stack)
   */
  markAsUndone(operationId: string, documentId: string): void {
    const undoStack = this.undoStacks.get(documentId) || { operationIds: [] };
    const redoStack = this.redoStacks.get(documentId) || { operationIds: [] };

    const index = undoStack.operationIds.indexOf(operationId);
    if (index !== -1) {
      undoStack.operationIds.splice(index, 1);
      this.undoStacks.set(documentId, undoStack);
      redoStack.operationIds.push(operationId);
      this.redoStacks.set(documentId, redoStack);
    }
  }

  /**
   * Mark operation as redone (moves from redo stack to undo stack)
   */
  markAsRedone(operationId: string, documentId: string): void {
    const undoStack = this.undoStacks.get(documentId) || { operationIds: [] };
    const redoStack = this.redoStacks.get(documentId) || { operationIds: [] };

    const index = redoStack.operationIds.indexOf(operationId);
    if (index !== -1) {
      redoStack.operationIds.splice(index, 1);
      this.redoStacks.set(documentId, redoStack);
      undoStack.operationIds.push(operationId);
      this.undoStacks.set(documentId, undoStack);
    }
  }

  /**
   * Clear operations for a specific document
   */
  clearForDocument(documentId: string): number {
    const before = this.operations.length;
    this.operations = this.operations.filter((op) => op.documentId !== documentId);
    const removed = before - this.operations.length;

    this.operationsMap.clear();
    this.operations.forEach((op) => {
      this.operationsMap.set(op.id, op);
    });

    this.undoStacks.delete(documentId);
    this.redoStacks.delete(documentId);

    defaultLogger.info(`Cleared ${removed} operations for document ${documentId}`);
    return removed;
  }

  getUndoStackSize(documentId: string): number {
    return this.undoStacks.get(documentId)?.operationIds.length || 0;
  }

  getRedoStackSize(documentId: string): number {
    return this.redoStacks.get(documentId)?.operationIds.length || 0;
  }

  getUndoStack(documentId: string): string[] {
    return this.undoStacks.get(documentId)?.operationIds || [];
  }

  getRedoStack(documentId: string): string[] {
    return this.redoStacks.get(documentId)?.operationIds || [];
  }

  /**
   * Record an operation with extended tracking
   */
  recordOperation(params: {
    documentId: string;
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
      duration: 0,
      documentId: params.documentId,
      cellsAffected: params.cellsAffected,
      rowsAffected: params.rowsAffected,
      snapshotId: params.snapshotId,
      errorMessage: params.error?.message,
    };

    this.record(operation);
    return operationId;
  }

  /**
   * Get operation history for a specific document
   */
  getHistory(documentId: string, options?: { limit?: number }): OperationHistory[] {
    let ops = this.operations.filter((op) => op.documentId === documentId);
    ops.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (options?.limit && options.limit > 0) {
      ops = ops.slice(0, options.limit);
    }
    return ops;
  }

  /**
   * Get a specific operation by ID for a document
   */
  getOperation(documentId: string, operationId: string): OperationHistory | undefined {
    const operation = this.operationsMap.get(operationId);
    if (operation && operation.documentId === documentId) {
      return operation;
    }
    return undefined;
  }
}

// Singleton management
let historyService: HistoryService | null = null;

export function getHistoryService(): HistoryService {
  if (!historyService) {
    historyService = new HistoryService();
  }
  return historyService;
}

export function setHistoryService(service: HistoryService): void {
  historyService = service;
}

export function resetHistoryService(): void {
  if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] !== 'true') {
    throw new Error('resetHistoryService() can only be called in test environment');
  }
  historyService = null;
}
