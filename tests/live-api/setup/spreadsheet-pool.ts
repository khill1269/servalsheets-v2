/**
 * Shared Test Spreadsheet Pool
 *
 * Provides a pool of pre-created test spreadsheets to avoid quota exhaustion.
 * Tests can borrow spreadsheets from the pool and return them when done.
 *
 * Enhanced features:
 * - Integration with test configuration system
 * - Health checks for borrowed spreadsheets
 * - Borrow timeout/wait functionality
 * - Metrics tracking
 * - Persistent state awareness
 */

import type { LiveApiClient } from './live-api-client.js';
import { TEST_CONFIG } from './config.js';
import { getMetricsCollector } from './metrics-collector.js';

export interface PooledSpreadsheet {
  id: string;
  title: string;
  url: string;
  sheets: Array<{ sheetId: number; title: string }>;
  inUse: boolean;
  lastUsed: number;
  borrowedBy?: string;
  borrowedAt?: number;
  createdAt: number;
  healthCheckAt?: number;
  healthy: boolean;
}

export interface SpreadsheetPoolOptions {
  /** Maximum spreadsheets to keep in pool (default: from config) */
  maxSize?: number;
  /** Prefix for pool spreadsheet names */
  prefix?: string;
  /** Whether to populate with test data (default: true) */
  populateData?: boolean;
  /** Number of data rows to populate (default: 100) */
  dataRows?: number;
  /** Health check interval in ms */
  healthCheckIntervalMs?: number;
  /** Maximum wait time for borrow in ms */
  maxBorrowWaitMs?: number;
  /** Maximum spreadsheet age before recycling */
  maxSpreadsheetAgeMs?: number;
}

/**
 * Pool statistics
 */
export interface PoolStats {
  total: number;
  inUse: number;
  available: number;
  healthy: number;
  unhealthy: number;
  avgBorrowTimeMs: number;
  totalBorrows: number;
  totalReturns: number;
  healthCheckCount: number;
}

/**
 * Singleton pool of test spreadsheets
 */
class SpreadsheetPool {
  private client: LiveApiClient | null = null;
  private pool: PooledSpreadsheet[] = [];
  private options: Required<SpreadsheetPoolOptions>;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;

  // Metrics
  private totalBorrows = 0;
  private totalReturns = 0;
  private totalBorrowTimeMs = 0;
  private healthCheckCount = 0;

  // Waiting borrowers
  private waitQueue: Array<{
    resolve: (spreadsheet: PooledSpreadsheet) => void;
    reject: (error: Error) => void;
    testName?: string;
    timeout: NodeJS.Timeout;
  }> = [];

  constructor() {
    const poolConfig = TEST_CONFIG.pool;
    this.options = {
      maxSize: poolConfig.maxSize,
      prefix: poolConfig.spreadsheetPrefix,
      populateData: true,
      dataRows: 100,
      healthCheckIntervalMs: poolConfig.healthCheckIntervalMs,
      maxBorrowWaitMs: poolConfig.maxBorrowWaitMs,
      maxSpreadsheetAgeMs: poolConfig.maxSpreadsheetAgeMs,
    };
  }

  /**
   * Initialize the pool with a client
   */
  async initialize(client: LiveApiClient, options?: SpreadsheetPoolOptions): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize(client, options);
    return this.initPromise;
  }

  private async doInitialize(
    client: LiveApiClient,
    options?: SpreadsheetPoolOptions
  ): Promise<void> {
    if (this.initialized && this.client === client) {
      return;
    }

    this.client = client;
    this.options = { ...this.options, ...options };

    // Find existing pool spreadsheets
    await this.discoverExistingPool();

    // Create spreadsheets if needed (up to maxSize)
    while (this.pool.length < this.options.maxSize) {
      await this.createPoolSpreadsheet();
    }

    this.initialized = true;
  }

  /**
   * Find existing pool spreadsheets from previous test runs
   */
  private async discoverExistingPool(): Promise<void> {
    if (!this.client) return;

    try {
      const response = await this.client.drive.files.list({
        q: `name contains '${this.options.prefix}' and trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'`,
        fields: 'files(id, name, webViewLink)',
        pageSize: 10,
      });

      for (const file of response.data.files || []) {
        if (!file.id || !file.name) continue;

        // Get sheet info
        const sheetInfo = await this.client.sheets.spreadsheets.get({
          spreadsheetId: file.id,
          fields: 'sheets.properties',
        });

        const sheets =
          sheetInfo.data.sheets?.map((s) => ({
            sheetId: s.properties?.sheetId ?? 0,
            title: s.properties?.title ?? 'Sheet1',
          })) || [];

        this.pool.push({
          id: file.id,
          title: file.name,
          url: file.webViewLink || '',
          sheets,
          inUse: false,
          lastUsed: 0,
          createdAt: Date.now(), // Unknown, assume now
          healthy: true,
        });

        if (this.pool.length >= this.options.maxSize) break;
      }
    } catch (error) {
      // Ignore errors discovering pool - we'll create new ones
      console.warn('Could not discover existing pool spreadsheets:', error);
    }
  }

  /**
   * Create a new spreadsheet for the pool
   */
  private async createPoolSpreadsheet(): Promise<PooledSpreadsheet> {
    if (!this.client) {
      throw new Error('Pool not initialized');
    }

    const timestamp = Date.now();
    const title = `${this.options.prefix}${this.pool.length}_${timestamp}`;

    const response = await this.client.sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
        sheets: [
          { properties: { title: 'TestData', sheetId: 0 } },
          { properties: { title: 'Benchmarks', sheetId: 1 } },
          { properties: { title: 'Formulas', sheetId: 2 } },
          { properties: { title: 'Scratch', sheetId: 3 } },
        ],
      },
    });

    const spreadsheet: PooledSpreadsheet = {
      id: response.data.spreadsheetId!,
      title,
      url: response.data.spreadsheetUrl!,
      sheets:
        response.data.sheets?.map((s) => ({
          sheetId: s.properties?.sheetId ?? 0,
          title: s.properties?.title ?? '',
        })) || [],
      inUse: false,
      lastUsed: 0,
      createdAt: Date.now(),
      healthy: true,
    };

    // Populate with test data if configured
    if (this.options.populateData) {
      await this.populateSpreadsheet(spreadsheet.id);
    }

    this.pool.push(spreadsheet);
    return spreadsheet;
  }

  /**
   * Populate a spreadsheet with standard test data
   */
  private async populateSpreadsheet(spreadsheetId: string): Promise<void> {
    if (!this.client) return;

    const rows = this.options.dataRows;
    const headers = ['ID', 'Name', 'Value', 'Date', 'Status', 'Formula'];
    const statuses = ['Active', 'Pending', 'Complete', 'Draft', 'Archived'];

    const values: unknown[][] = [headers];

    for (let i = 1; i <= rows; i++) {
      const daysAgo = Math.floor(Math.random() * 365);
      const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

      values.push([
        i,
        `Item ${i}`,
        Math.round(Math.random() * 10000) / 100,
        date.toISOString().split('T')[0],
        statuses[i % statuses.length],
        `=C${i + 1}*1.1`,
      ]);
    }

    await this.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `TestData!A1:F${rows + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  /**
   * Borrow a spreadsheet from the pool
   * Will wait up to maxBorrowWaitMs if no spreadsheets are available
   */
  async borrow(testName?: string, maxWaitMs?: number): Promise<PooledSpreadsheet> {
    if (!this.initialized) {
      throw new Error('Pool not initialized. Call initialize() first.');
    }

    const waitMs = maxWaitMs ?? this.options.maxBorrowWaitMs;

    // Find an available healthy spreadsheet
    const available = this.pool.find((s) => !s.inUse && s.healthy);

    if (available) {
      return this.markBorrowed(available, testName);
    }

    // All in use - create a new one if under limit
    if (this.pool.length < this.options.maxSize * 2) {
      const newSpreadsheet = await this.createPoolSpreadsheet();
      return this.markBorrowed(newSpreadsheet, testName);
    }

    // Queue up and wait for one to become available
    return new Promise<PooledSpreadsheet>((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove from queue
        const index = this.waitQueue.findIndex((w) => w.resolve === resolve);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
        }
        reject(
          new Error(
            `Timeout waiting for pool spreadsheet after ${waitMs}ms. All ${this.pool.length} spreadsheets are in use.`
          )
        );
      }, waitMs);

      this.waitQueue.push({ resolve, reject, testName, timeout });
    });
  }

  /**
   * Mark a spreadsheet as borrowed
   */
  private markBorrowed(spreadsheet: PooledSpreadsheet, testName?: string): PooledSpreadsheet {
    spreadsheet.inUse = true;
    spreadsheet.lastUsed = Date.now();
    spreadsheet.borrowedAt = Date.now();
    spreadsheet.borrowedBy = testName;
    this.totalBorrows++;

    // Track in metrics
    getMetricsCollector().recordApiCall('read', 'POOL_BORROW', 0, true);

    return spreadsheet;
  }

  /**
   * Return a spreadsheet to the pool
   */
  async release(spreadsheetId: string, cleanup = false): Promise<void> {
    const spreadsheet = this.pool.find((s) => s.id === spreadsheetId);
    if (!spreadsheet) return;

    // Track borrow time
    if (spreadsheet.borrowedAt) {
      this.totalBorrowTimeMs += Date.now() - spreadsheet.borrowedAt;
    }
    this.totalReturns++;

    if (cleanup && this.client) {
      // Clear the Scratch sheet for next test
      try {
        await this.client.sheets.spreadsheets.values.clear({
          spreadsheetId,
          range: 'Scratch!A:ZZ',
        });
      } catch {
        // Ignore cleanup errors
      }
    }

    // Reset borrow state
    spreadsheet.inUse = false;
    spreadsheet.borrowedAt = undefined;
    spreadsheet.borrowedBy = undefined;

    // Track in metrics
    getMetricsCollector().recordApiCall('write', 'POOL_RELEASE', 0, true);

    // Notify waiting borrowers
    this.notifyWaitingBorrower(spreadsheet);
  }

  /**
   * Notify first waiting borrower that a spreadsheet is available
   */
  private notifyWaitingBorrower(spreadsheet: PooledSpreadsheet): void {
    if (this.waitQueue.length === 0 || spreadsheet.inUse) return;

    const waiter = this.waitQueue.shift();
    if (waiter) {
      clearTimeout(waiter.timeout);
      this.markBorrowed(spreadsheet, waiter.testName);
      waiter.resolve(spreadsheet);
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    const inUse = this.pool.filter((s) => s.inUse).length;
    const healthy = this.pool.filter((s) => s.healthy).length;

    return {
      total: this.pool.length,
      inUse,
      available: this.pool.length - inUse,
      healthy,
      unhealthy: this.pool.length - healthy,
      avgBorrowTimeMs: this.totalReturns > 0 ? this.totalBorrowTimeMs / this.totalReturns : 0,
      totalBorrows: this.totalBorrows,
      totalReturns: this.totalReturns,
      healthCheckCount: this.healthCheckCount,
    };
  }

  /**
   * Perform health check on a spreadsheet
   */
  async healthCheck(spreadsheetId: string): Promise<boolean> {
    if (!this.client) return false;

    const spreadsheet = this.pool.find((s) => s.id === spreadsheetId);
    if (!spreadsheet) return false;

    try {
      // Try to get basic metadata
      await this.client.sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'spreadsheetId',
      });

      spreadsheet.healthy = true;
      spreadsheet.healthCheckAt = Date.now();
      this.healthCheckCount++;
      return true;
    } catch {
      spreadsheet.healthy = false;
      spreadsheet.healthCheckAt = Date.now();
      this.healthCheckCount++;
      return false;
    }
  }

  /**
   * Run health checks on all pool spreadsheets
   */
  async healthCheckAll(): Promise<{ healthy: number; unhealthy: number }> {
    let healthy = 0;
    let unhealthy = 0;

    for (const spreadsheet of this.pool) {
      if (!spreadsheet.inUse) {
        const isHealthy = await this.healthCheck(spreadsheet.id);
        if (isHealthy) {
          healthy++;
        } else {
          unhealthy++;
        }
      }
    }

    return { healthy, unhealthy };
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks(): void {
    if (this.healthCheckTimer) return;

    this.healthCheckTimer = setInterval(async () => {
      await this.healthCheckAll();
    }, this.options.healthCheckIntervalMs);
  }

  /**
   * Stop periodic health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Recycle old or unhealthy spreadsheets
   */
  async recycleStale(): Promise<{ recycled: number }> {
    if (!this.client) return { recycled: 0 };

    let recycled = 0;
    const now = Date.now();
    const maxAge = this.options.maxSpreadsheetAgeMs;

    for (const spreadsheet of [...this.pool]) {
      const isOld = now - spreadsheet.createdAt > maxAge;
      const isUnhealthy = !spreadsheet.healthy;

      if (!spreadsheet.inUse && (isOld || isUnhealthy)) {
        try {
          // Delete the old spreadsheet
          await this.client.drive.files.delete({ fileId: spreadsheet.id });

          // Remove from pool
          const index = this.pool.indexOf(spreadsheet);
          if (index !== -1) {
            this.pool.splice(index, 1);
          }

          // Create replacement
          await this.createPoolSpreadsheet();
          recycled++;
        } catch {
          // Ignore errors during recycling
        }
      }
    }

    return { recycled };
  }

  /**
   * Clean up all pool spreadsheets (for test teardown)
   */
  async cleanup(): Promise<{ deleted: number; failed: number }> {
    // Stop health checks
    this.stopHealthChecks();

    // Reject all waiting borrowers
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error('Pool cleanup in progress'));
    }
    this.waitQueue = [];

    if (!this.client) {
      return { deleted: 0, failed: 0 };
    }

    let deleted = 0;
    let failed = 0;

    for (const spreadsheet of this.pool) {
      try {
        await this.client.drive.files.delete({ fileId: spreadsheet.id });
        deleted++;
      } catch {
        failed++;
      }
    }

    this.pool = [];
    this.initialized = false;
    this.initPromise = null;

    // Reset metrics
    this.totalBorrows = 0;
    this.totalReturns = 0;
    this.totalBorrowTimeMs = 0;
    this.healthCheckCount = 0;

    return { deleted, failed };
  }

  /**
   * Get the primary test spreadsheet (first in pool)
   */
  getPrimarySpreadsheet(): PooledSpreadsheet | null {
    return this.pool[0] || null;
  }

  /**
   * Check if pool is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance
export const spreadsheetPool = new SpreadsheetPool();

/**
 * Helper to get or initialize the pool
 */
export async function getTestSpreadsheetPool(
  client: LiveApiClient,
  options?: SpreadsheetPoolOptions
): Promise<SpreadsheetPool> {
  await spreadsheetPool.initialize(client, options);
  return spreadsheetPool;
}
