/**
 * ServalSheets - Infrastructure Optimization
 *
 * Phase 5: Infrastructure optimizations for improved throughput and latency.
 *
 * Optimizations:
 * 1. Request coalescing - combine multiple requests to same spreadsheet
 * 2. Connection keep-alive management
 * 3. Prefetch hints for predictable access patterns
 * 4. Batch request queuing with smart scheduling
 *
 * @module utils/infrastructure
 */

import type { sheets_v4 } from 'googleapis';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum requests to coalesce into single batch */
const MAX_COALESCE_SIZE = 50;

/** Time window to wait for coalescing (ms) */
const COALESCE_WINDOW_MS = 10;

/** Maximum pending requests per spreadsheet */
const MAX_PENDING_PER_SPREADSHEET = 100;

/** Prefetch lookahead (predict next N ranges) */
const PREFETCH_LOOKAHEAD = 3;

// ============================================================================
// TYPES
// ============================================================================

export interface PendingRequest<T> {
  id: string;
  spreadsheetId: string;
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timestamp: number;
  priority: number;
}

export interface CoalescedBatch {
  spreadsheetId: string;
  requests: PendingRequest<unknown>[];
  scheduledTime: number;
}

export interface RequestQueueStats {
  pending: number;
  coalesced: number;
  executed: number;
  avgCoalesceSize: number;
  avgLatencyMs: number;
}

// ============================================================================
// REQUEST COALESCER
// ============================================================================

/**
 * Coalesces multiple requests to the same spreadsheet into batches
 *
 * Instead of executing requests immediately, queues them and waits
 * a short window to combine with other requests to the same spreadsheet.
 */
export class RequestCoalescer {
  private pendingRequests = new Map<string, PendingRequest<unknown>[]>();
  private scheduledFlushes = new Map<string, NodeJS.Timeout>();
  private stats = {
    pending: 0,
    coalesced: 0,
    executed: 0,
    totalCoalesceSize: 0,
    totalLatency: 0,
    batchCount: 0,
  };

  private coalesceWindowMs: number;
  private maxCoalesceSize: number;

  constructor(
    options: {
      coalesceWindowMs?: number;
      maxCoalesceSize?: number;
    } = {}
  ) {
    this.coalesceWindowMs = options.coalesceWindowMs ?? COALESCE_WINDOW_MS;
    this.maxCoalesceSize = options.maxCoalesceSize ?? MAX_COALESCE_SIZE;
  }

  /**
   * Queue a request for coalescing
   */
  async queue<T>(
    spreadsheetId: string,
    operation: () => Promise<T>,
    priority: number = 0
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const request: PendingRequest<T> = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        spreadsheetId,
        operation,
        resolve: resolve as (value: unknown) => void,
        reject,
        timestamp: Date.now(),
        priority,
      };

      this.addRequest(spreadsheetId, request as PendingRequest<unknown>);
      this.scheduleFlush(spreadsheetId);
    });
  }

  /**
   * Add request to pending queue
   */
  private addRequest(spreadsheetId: string, request: PendingRequest<unknown>): void {
    let pending = this.pendingRequests.get(spreadsheetId);
    if (!pending) {
      pending = [];
      this.pendingRequests.set(spreadsheetId, pending);
    }

    // Enforce max pending limit
    if (pending.length >= MAX_PENDING_PER_SPREADSHEET) {
      request.reject(new Error('Too many pending requests for spreadsheet'));
      return;
    }

    pending.push(request);
    this.stats.pending++;

    // If batch is full, flush immediately
    if (pending.length >= this.maxCoalesceSize) {
      this.flushNow(spreadsheetId);
    }
  }

  /**
   * Schedule a flush for the spreadsheet
   */
  private scheduleFlush(spreadsheetId: string): void {
    // Already scheduled
    if (this.scheduledFlushes.has(spreadsheetId)) {
      return;
    }

    const timeout = setTimeout(() => {
      this.flushNow(spreadsheetId);
    }, this.coalesceWindowMs);

    this.scheduledFlushes.set(spreadsheetId, timeout);
  }

  /**
   * Flush pending requests immediately
   */
  private async flushNow(spreadsheetId: string): Promise<void> {
    // Clear scheduled flush
    const timeout = this.scheduledFlushes.get(spreadsheetId);
    if (timeout) {
      clearTimeout(timeout);
      this.scheduledFlushes.delete(spreadsheetId);
    }

    // Get and clear pending requests
    const requests = this.pendingRequests.get(spreadsheetId);
    if (!requests || requests.length === 0) {
      return;
    }
    this.pendingRequests.delete(spreadsheetId);

    // Sort by priority (higher first)
    requests.sort((a, b) => b.priority - a.priority);

    // Track coalescing stats
    this.stats.coalesced += requests.length;
    this.stats.totalCoalesceSize += requests.length;
    this.stats.batchCount++;

    // Execute each request
    // Note: In a more advanced implementation, we could combine
    // compatible requests into actual batch API calls
    const startTime = Date.now();

    await Promise.all(
      requests.map(async (request) => {
        try {
          const result = await request.operation();
          request.resolve(result);
          this.stats.executed++;
          this.stats.pending--;
        } catch (error) {
          request.reject(error instanceof Error ? error : new Error(String(error)));
          this.stats.pending--;
        }
      })
    );

    this.stats.totalLatency += Date.now() - startTime;
  }

  /**
   * Flush all pending requests
   */
  async flushAll(): Promise<void> {
    const spreadsheetIds = Array.from(this.pendingRequests.keys());
    await Promise.all(spreadsheetIds.map((id) => this.flushNow(id)));
  }

  /**
   * Get queue statistics
   */
  getStats(): RequestQueueStats {
    return {
      pending: this.stats.pending,
      coalesced: this.stats.coalesced,
      executed: this.stats.executed,
      avgCoalesceSize:
        this.stats.batchCount > 0 ? this.stats.totalCoalesceSize / this.stats.batchCount : 0,
      avgLatencyMs: this.stats.batchCount > 0 ? this.stats.totalLatency / this.stats.batchCount : 0,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      pending: 0,
      coalesced: 0,
      executed: 0,
      totalCoalesceSize: 0,
      totalLatency: 0,
      batchCount: 0,
    };
  }
}

// ============================================================================
// PREFETCH PREDICTOR
// ============================================================================

/**
 * Predicts and prefetches data based on access patterns
 */
export class PrefetchPredictor {
  private accessHistory: Array<{
    spreadsheetId: string;
    range: string;
    timestamp: number;
  }> = [];
  private maxHistory = 100;
  private prefetchCache = new Map<string, { data: unknown; timestamp: number }>();
  private prefetchTtl = 30000; // 30 seconds

  /**
   * Record an access and predict next accesses
   */
  recordAccess(spreadsheetId: string, range: string): string[] {
    // Add to history
    this.accessHistory.push({
      spreadsheetId,
      range,
      timestamp: Date.now(),
    });

    // Trim history
    if (this.accessHistory.length > this.maxHistory) {
      this.accessHistory = this.accessHistory.slice(-this.maxHistory);
    }

    // Predict next ranges based on patterns
    return this.predictNextRanges(spreadsheetId, range);
  }

  /**
   * Predict next ranges based on access patterns
   */
  private predictNextRanges(spreadsheetId: string, currentRange: string): string[] {
    const predictions: string[] = [];

    // Pattern 1: Sequential row access (A1:E10 -> A11:E20)
    const sequentialNext = this.predictSequentialRange(currentRange);
    if (sequentialNext) {
      predictions.push(sequentialNext);
    }

    // Pattern 2: Common follow-up ranges from history
    const historicalNext = this.findHistoricalPatterns(spreadsheetId, currentRange);
    predictions.push(...historicalNext);

    return predictions.slice(0, PREFETCH_LOOKAHEAD);
  }

  /**
   * Predict next sequential range
   */
  private predictSequentialRange(range: string): string | null {
    // Parse range like "Sheet1!A1:E10"
    const match = range.match(/^([^!]+!)?([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
    if (!match) return null;

    const [, sheetPrefix, startCol, startRow, endCol, endRow] = match;
    const rowCount = parseInt(endRow!) - parseInt(startRow!) + 1;
    const nextStartRow = parseInt(endRow!) + 1;
    const nextEndRow = nextStartRow + rowCount - 1;

    return `${sheetPrefix ?? ''}${startCol}${nextStartRow}:${endCol}${nextEndRow}`;
  }

  /**
   * Find patterns from history
   */
  private findHistoricalPatterns(spreadsheetId: string, currentRange: string): string[] {
    const patterns: string[] = [];

    // Find sequences where currentRange was followed by another range
    for (let i = 0; i < this.accessHistory.length - 1; i++) {
      const current = this.accessHistory[i]!;
      const next = this.accessHistory[i + 1]!;

      if (
        current.spreadsheetId === spreadsheetId &&
        current.range === currentRange &&
        next.spreadsheetId === spreadsheetId &&
        next.range !== currentRange
      ) {
        if (!patterns.includes(next.range)) {
          patterns.push(next.range);
        }
      }
    }

    return patterns;
  }

  /**
   * Store prefetched data
   */
  storePrefetch(key: string, data: unknown): void {
    this.prefetchCache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Get prefetched data if available and not expired
   */
  getPrefetch(key: string): unknown | undefined {
    const entry = this.prefetchCache.get(key);
    // OK: Explicit empty - typed as optional, prefetch cache miss
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > this.prefetchTtl) {
      this.prefetchCache.delete(key);
      // OK: Explicit empty - typed as optional, prefetch cache expired
      return undefined;
    }

    return entry.data;
  }

  /**
   * Clear expired prefetch entries
   */
  clearExpired(): number {
    const now = Date.now();
    let cleared = 0;

    for (const [key, entry] of this.prefetchCache) {
      if (now - entry.timestamp > this.prefetchTtl) {
        this.prefetchCache.delete(key);
        cleared++;
      }
    }

    return cleared;
  }
}

// ============================================================================
// BATCH REQUEST SCHEDULER
// ============================================================================

interface ScheduledBatch {
  spreadsheetId: string;
  requests: sheets_v4.Schema$Request[];
  callbacks: Array<{
    resolve: (responses: sheets_v4.Schema$Response[]) => void;
    reject: (error: Error) => void;
    requestIndices: number[];
  }>;
  scheduledTime: number;
}

/**
 * Schedules and batches Google Sheets API requests
 */
export class BatchRequestScheduler {
  private pendingBatches = new Map<string, ScheduledBatch>();
  private scheduledFlushes = new Map<string, NodeJS.Timeout>();
  private sheetsApi: sheets_v4.Sheets;

  private batchWindowMs: number;
  private maxBatchSize: number;

  constructor(
    sheetsApi: sheets_v4.Sheets,
    options: {
      batchWindowMs?: number;
      maxBatchSize?: number;
    } = {}
  ) {
    this.sheetsApi = sheetsApi;
    this.batchWindowMs = options.batchWindowMs ?? 10;
    this.maxBatchSize = options.maxBatchSize ?? 50;
  }

  /**
   * Schedule requests for batching
   */
  async scheduleRequests(
    spreadsheetId: string,
    requests: sheets_v4.Schema$Request[]
  ): Promise<sheets_v4.Schema$Response[]> {
    return new Promise((resolve, reject) => {
      let batch = this.pendingBatches.get(spreadsheetId);

      if (!batch) {
        batch = {
          spreadsheetId,
          requests: [],
          callbacks: [],
          scheduledTime: Date.now() + this.batchWindowMs,
        };
        this.pendingBatches.set(spreadsheetId, batch);
      }

      // Record which request indices belong to this callback
      const startIndex = batch.requests.length;
      batch.requests.push(...requests);
      const endIndex = batch.requests.length;

      batch.callbacks.push({
        resolve,
        reject,
        requestIndices: Array.from({ length: endIndex - startIndex }, (_, i) => startIndex + i),
      });

      // Check if batch is full
      if (batch.requests.length >= this.maxBatchSize) {
        this.flushBatch(spreadsheetId);
      } else {
        this.scheduleFlush(spreadsheetId);
      }
    });
  }

  /**
   * Schedule a flush
   */
  private scheduleFlush(spreadsheetId: string): void {
    if (this.scheduledFlushes.has(spreadsheetId)) {
      return;
    }

    const timeout = setTimeout(() => {
      this.flushBatch(spreadsheetId);
    }, this.batchWindowMs);

    this.scheduledFlushes.set(spreadsheetId, timeout);
  }

  /**
   * Flush a batch immediately
   */
  private async flushBatch(spreadsheetId: string): Promise<void> {
    // Clear scheduled flush
    const timeout = this.scheduledFlushes.get(spreadsheetId);
    if (timeout) {
      clearTimeout(timeout);
      this.scheduledFlushes.delete(spreadsheetId);
    }

    const batch = this.pendingBatches.get(spreadsheetId);
    if (!batch || batch.requests.length === 0) {
      return;
    }
    this.pendingBatches.delete(spreadsheetId);

    try {
      // Execute batch
      const response = await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: batch.requests },
      });

      const replies = response.data.replies ?? [];

      // Distribute responses to callbacks
      for (const callback of batch.callbacks) {
        const callbackResponses = callback.requestIndices.map((idx) => replies[idx] ?? {});
        callback.resolve(callbackResponses);
      }
    } catch (error) {
      // Reject all callbacks
      const err = error instanceof Error ? error : new Error(String(error));
      for (const callback of batch.callbacks) {
        callback.reject(err);
      }
    }
  }

  /**
   * Flush all pending batches
   */
  async flushAll(): Promise<void> {
    const spreadsheetIds = Array.from(this.pendingBatches.keys());
    await Promise.all(spreadsheetIds.map((id) => this.flushBatch(id)));
  }
}

// ============================================================================
// CONNECTION POOL
// ============================================================================

/**
 * Simple connection state tracker for Google API clients
 * Note: googleapis handles actual HTTP connections internally
 */
export class ConnectionPool {
  private activeRequests = 0;
  private maxConcurrent: number;
  private queue: Array<{
    operation: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(maxConcurrent: number = 10) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Execute operation with concurrency limiting
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeRequests < this.maxConcurrent) {
      return this.runOperation(operation);
    }

    // Queue the operation
    return new Promise((resolve, reject) => {
      this.queue.push({
        operation: operation as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
    });
  }

  /**
   * Run operation and manage concurrency
   */
  private async runOperation<T>(operation: () => Promise<T>): Promise<T> {
    this.activeRequests++;

    try {
      return await operation();
    } finally {
      this.activeRequests--;
      this.processQueue();
    }
  }

  /**
   * Process queued operations
   */
  private processQueue(): void {
    while (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
      const next = this.queue.shift();
      if (next) {
        this.runOperation(next.operation).then(next.resolve).catch(next.reject);
      }
    }
  }

  /**
   * Get current stats
   */
  getStats(): { active: number; queued: number; maxConcurrent: number } {
    return {
      active: this.activeRequests,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

// ============================================================================
// SINGLETON INSTANCES
// ============================================================================

let requestCoalescer: RequestCoalescer | null = null;
let prefetchPredictor: PrefetchPredictor | null = null;
let connectionPool: ConnectionPool | null = null;

/**
 * Get or create request coalescer singleton
 */
export function getRequestCoalescer(options?: {
  coalesceWindowMs?: number;
  maxCoalesceSize?: number;
}): RequestCoalescer {
  if (!requestCoalescer) {
    requestCoalescer = new RequestCoalescer(options);
  }
  return requestCoalescer;
}

/**
 * Get or create prefetch predictor singleton
 */
export function getPrefetchPredictor(): PrefetchPredictor {
  if (!prefetchPredictor) {
    prefetchPredictor = new PrefetchPredictor();
  }
  return prefetchPredictor;
}

/**
 * Get or create connection pool singleton
 */
export function getConnectionPool(maxConcurrent?: number): ConnectionPool {
  if (!connectionPool) {
    connectionPool = new ConnectionPool(maxConcurrent);
  }
  return connectionPool;
}

// ============================================================================
// EXPORTS
// ============================================================================

export const Infrastructure = {
  // Request coalescing
  RequestCoalescer,
  getRequestCoalescer,

  // Prefetch prediction
  PrefetchPredictor,
  getPrefetchPredictor,

  // Batch scheduling
  BatchRequestScheduler,

  // Connection pool
  ConnectionPool,
  getConnectionPool,

  // Constants
  MAX_COALESCE_SIZE,
  COALESCE_WINDOW_MS,
  MAX_PENDING_PER_SPREADSHEET,
  PREFETCH_LOOKAHEAD,
};
