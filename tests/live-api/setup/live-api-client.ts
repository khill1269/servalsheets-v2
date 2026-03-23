/**
 * Live API Client Wrapper
 *
 * Provides authenticated Google Sheets API client for live testing.
 * Handles credential loading, metrics tracking, and request logging.
 *
 * Enhanced features:
 * - Integration with test retry manager
 * - Rate limiting support
 * - Quota tracking
 * - Centralized metrics collection
 */

import { google, sheets_v4, drive_v3 } from 'googleapis';
import type { GaxiosResponse } from 'gaxios';
import {
  loadTestCredentials,
  shouldRunIntegrationTests,
  type TestCredentials,
} from '../../helpers/credential-loader.js';
import { executeWithTestRetry, type TestRetryOptions } from './test-retry-manager.js';
import { getTestRateLimiter, type TestRateLimiter } from './test-rate-limiter.js';
import { getQuotaManager, type QuotaManager } from './quota-manager.js';
import { getMetricsCollector, recordApiCallMetric } from './metrics-collector.js';
import { TEST_CONFIG } from './config.js';

export interface LiveApiClientOptions {
  /** Log all requests to console */
  logRequests?: boolean;
  /** Track metrics for all operations */
  trackMetrics?: boolean;
  /** Use retry manager for automatic retries */
  useRetryManager?: boolean;
  /** Use rate limiter for quota management */
  useRateLimiter?: boolean;
  /** Custom retry options */
  retryOptions?: TestRetryOptions;
}

export interface RequestMetrics {
  operation: string;
  method: string;
  startTime: number;
  duration: number;
  statusCode?: number;
  bytesTransferred?: number;
}

export interface ApiStats {
  totalRequests: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  byOperation: Record<string, { count: number; avgDuration: number }>;
}

/**
 * Live API Client with metrics tracking
 *
 * Note: For automatic metrics tracking, use trackOperation() method.
 * Direct API calls via client.sheets.* are not auto-tracked due to
 * Google API client limitations with JavaScript Proxies.
 *
 * Enhanced features:
 * - executeWithRetry() wraps operations with test retry manager
 * - Automatic rate limiting with acquireTokens()
 * - Quota tracking and reporting
 * - Integration with centralized metrics collector
 */
export class LiveApiClient {
  private sheetsApi: sheets_v4.Sheets;
  private driveApi: drive_v3.Drive;
  private credentials: TestCredentials;
  private metrics: RequestMetrics[] = [];
  private options: Required<LiveApiClientOptions>;

  // Infrastructure components
  private rateLimiter: TestRateLimiter;
  private quotaManager: QuotaManager;

  constructor(credentials: TestCredentials, options: LiveApiClientOptions = {}) {
    this.credentials = credentials;
    this.options = {
      logRequests: options.logRequests ?? false,
      trackMetrics: options.trackMetrics ?? true,
      useRetryManager: options.useRetryManager ?? true,
      useRateLimiter: options.useRateLimiter ?? true,
      retryOptions: options.retryOptions ?? {},
    };

    // Get infrastructure singletons
    this.rateLimiter = getTestRateLimiter();
    this.quotaManager = getQuotaManager();

    let auth;

    if (credentials.serviceAccount) {
      // Initialize with service account
      auth = new google.auth.GoogleAuth({
        credentials: credentials.serviceAccount,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive',
        ],
      });
    } else if (credentials.oauth) {
      // Initialize with OAuth credentials
      const oauth2Client = new google.auth.OAuth2(
        credentials.oauth.client_id,
        credentials.oauth.client_secret,
        credentials.oauth.redirect_uri
      );
      oauth2Client.setCredentials(credentials.oauth.tokens);
      auth = oauth2Client;
    } else {
      throw new Error(
        'No valid credentials found. Provide either serviceAccount or oauth credentials.'
      );
    }

    this.sheetsApi = google.sheets({ version: 'v4', auth });
    this.driveApi = google.drive({ version: 'v3', auth });
  }

  get sheets(): sheets_v4.Sheets {
    return this.sheetsApi;
  }

  get drive(): drive_v3.Drive {
    return this.driveApi;
  }

  get testSpreadsheetId(): string {
    return this.credentials.testSpreadsheet.id;
  }

  get testSpreadsheetName(): string | undefined {
    return this.credentials.testSpreadsheet.name;
  }

  /**
   * Track an operation and record metrics.
   * Use this method when you need explicit metrics tracking.
   */
  async trackOperation<T>(
    operation: string,
    method: string,
    fn: () => Promise<GaxiosResponse<T>>
  ): Promise<GaxiosResponse<T>> {
    const startTime = performance.now();
    const type = this.classifyOperation(method);

    try {
      const response = await fn();
      const duration = performance.now() - startTime;

      const metric: RequestMetrics = {
        operation,
        method,
        startTime,
        duration,
        statusCode: response.status,
      };

      this.metrics.push(metric);

      // Record to central metrics collector
      if (this.options.trackMetrics) {
        recordApiCallMetric(type, operation, duration, true, {
          statusCode: response.status,
        });
      }

      if (this.options.logRequests) {
        console.log(`[API] ${operation} ${method}: ${duration.toFixed(2)}ms (${response.status})`);
      }

      return response;
    } catch (error) {
      const duration = performance.now() - startTime;
      const statusCode = (error as { code?: number }).code;

      this.metrics.push({
        operation,
        method,
        startTime,
        duration,
        statusCode,
      });

      // Record to central metrics collector
      if (this.options.trackMetrics) {
        recordApiCallMetric(type, operation, duration, false, {
          statusCode,
          errorCode: String(statusCode),
        });
      }

      throw error;
    }
  }

  /**
   * Execute an operation with retry logic and rate limiting.
   * This is the recommended method for all API calls.
   */
  async executeWithRetry<T>(
    operation: string,
    method: string,
    fn: () => Promise<GaxiosResponse<T>>,
    retryOptions?: TestRetryOptions
  ): Promise<GaxiosResponse<T>> {
    const type = this.classifyOperation(method);

    // Acquire rate limit tokens if enabled
    if (this.options.useRateLimiter) {
      await this.rateLimiter.acquire(type);
    }

    // Wrap with retry if enabled
    if (this.options.useRetryManager) {
      return executeWithTestRetry(async () => this.trackOperation(operation, method, fn), {
        operationName: operation,
        ...this.options.retryOptions,
        ...retryOptions,
      });
    }

    // Otherwise just track
    return this.trackOperation(operation, method, fn);
  }

  /**
   * Execute a read operation (uses read rate limit tokens)
   */
  async executeRead<T>(
    operation: string,
    fn: () => Promise<GaxiosResponse<T>>,
    retryOptions?: TestRetryOptions
  ): Promise<GaxiosResponse<T>> {
    return this.executeWithRetry(operation, 'GET', fn, retryOptions);
  }

  /**
   * Execute a write operation (uses write rate limit tokens)
   */
  async executeWrite<T>(
    operation: string,
    fn: () => Promise<GaxiosResponse<T>>,
    retryOptions?: TestRetryOptions
  ): Promise<GaxiosResponse<T>> {
    return this.executeWithRetry(operation, 'POST', fn, retryOptions);
  }

  /**
   * Classify operation type based on HTTP method
   */
  private classifyOperation(method: string): 'read' | 'write' {
    const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    return writeMethods.includes(method.toUpperCase()) ? 'write' : 'read';
  }

  /**
   * Handle rate limit error (429) by entering throttle mode
   */
  handleRateLimitError(): void {
    this.rateLimiter.throttle(60000);
    this.quotaManager.enterThrottle(60000);
  }

  /**
   * Check if there's enough quota for planned operations
   */
  checkQuota(estimatedReads: number, estimatedWrites: number): boolean {
    const verification = this.quotaManager.verifyQuota({
      reads: estimatedReads,
      writes: estimatedWrites,
    });
    return verification.hasQuota;
  }

  /**
   * Get current quota state
   */
  getQuotaState() {
    return this.quotaManager.getState();
  }

  /**
   * Get rate limiter status
   */
  getRateLimiterStatus() {
    return this.rateLimiter.getStatus();
  }

  /**
   * Get all recorded metrics
   */
  getMetrics(): RequestMetrics[] {
    return [...this.metrics];
  }

  /**
   * Calculate aggregate statistics
   */
  getStats(): ApiStats {
    if (this.metrics.length === 0) {
      return {
        totalRequests: 0,
        totalDuration: 0,
        avgDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        byOperation: {},
      };
    }

    const durations = this.metrics.map((m) => m.duration);
    const totalDuration = durations.reduce((a, b) => a + b, 0);

    const byOperation: Record<string, { count: number; avgDuration: number }> = {};
    for (const metric of this.metrics) {
      if (!byOperation[metric.operation]) {
        byOperation[metric.operation] = { count: 0, avgDuration: 0 };
      }
      byOperation[metric.operation].count++;
      byOperation[metric.operation].avgDuration += metric.duration;
    }

    for (const op of Object.keys(byOperation)) {
      byOperation[op].avgDuration /= byOperation[op].count;
    }

    return {
      totalRequests: this.metrics.length,
      totalDuration,
      avgDuration: totalDuration / this.metrics.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      byOperation,
    };
  }

  /**
   * Reset all metrics
   */
  resetMetrics(): void {
    this.metrics = [];
  }

  /**
   * Get test configuration
   */
  getTestConfig(): TestCredentials['testConfig'] {
    return this.credentials.testConfig;
  }

  /**
   * Get the centralized test report
   */
  getTestReport(format: 'json' | 'markdown' | 'html' = 'json'): string {
    return getMetricsCollector().getReport(format);
  }

  /**
   * Get combined statistics from all infrastructure
   */
  getFullStats(): {
    api: ApiStats;
    rateLimiter: ReturnType<TestRateLimiter['getStats']>;
    quota: ReturnType<QuotaManager['getStats']>;
  } {
    return {
      api: this.getStats(),
      rateLimiter: this.rateLimiter.getStats(),
      quota: this.quotaManager.getStats(),
    };
  }

  /**
   * Reset all infrastructure state
   */
  resetAll(): void {
    this.resetMetrics();
    this.rateLimiter.reset();
    this.rateLimiter.resetStats();
    this.quotaManager.reset();
    this.quotaManager.resetStats();
  }

  // ─── Convenience Methods ────────────────────────────────────────────────────

  /**
   * Create a new spreadsheet and return its ID.
   */
  async createSpreadsheet(title: string): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
    const response = await this.executeWrite('createSpreadsheet', () =>
      this.sheetsApi.spreadsheets.create({
        requestBody: { properties: { title } },
      })
    );
    return {
      spreadsheetId: response.data.spreadsheetId!,
      spreadsheetUrl: response.data.spreadsheetUrl ?? '',
    };
  }

  /**
   * Get spreadsheet metadata.
   */
  async getSpreadsheet(spreadsheetId: string) {
    const response = await this.executeRead('getSpreadsheet', () =>
      this.sheetsApi.spreadsheets.get({ spreadsheetId })
    );
    return response.data;
  }

  /**
   * Delete a spreadsheet via Drive API.
   */
  async deleteSpreadsheet(spreadsheetId: string): Promise<void> {
    await this.executeWrite('deleteSpreadsheet', () =>
      this.driveApi.files.delete({ fileId: spreadsheetId })
    );
  }

  /**
   * Add a sheet to an existing spreadsheet.
   */
  async addSheet(spreadsheetId: string, title: string): Promise<{ sheetId: number | null }> {
    const response = await this.executeWrite('addSheet', () =>
      this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title } } }],
        },
      })
    );
    const reply = response.data.replies?.[0]?.addSheet;
    return { sheetId: reply?.properties?.sheetId ?? null };
  }

  /**
   * Delete a sheet from a spreadsheet.
   */
  async deleteSheet(spreadsheetId: string, sheetId: number): Promise<void> {
    await this.executeWrite('deleteSheet', () =>
      this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ deleteSheet: { sheetId } }],
        },
      })
    );
  }

  /**
   * Write data to a range.
   */
  async writeData(
    spreadsheetId: string,
    range: string,
    values: unknown[][],
    options?: { valueInputOption?: string }
  ): Promise<void> {
    await this.executeWrite('writeData', () =>
      this.sheetsApi.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: options?.valueInputOption ?? 'RAW',
        requestBody: { values },
      })
    );
  }

  /**
   * Read data from a range.
   */
  async readData(
    spreadsheetId: string,
    range: string,
    options?: { valueRenderOption?: string }
  ): Promise<{ values: string[][] }> {
    const response = await this.executeRead('readData', () =>
      this.sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range,
        valueRenderOption: options?.valueRenderOption ?? 'UNFORMATTED_VALUE',
      })
    );
    return { values: (response.data.values as string[][]) ?? [] };
  }

  /**
   * Batch read multiple ranges.
   */
  async batchReadData(
    spreadsheetId: string,
    ranges: string[]
  ): Promise<{ valueRanges: Array<{ values: string[][] }> }> {
    const response = await this.executeRead('batchReadData', () =>
      this.sheetsApi.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
      })
    );
    return {
      valueRanges: (response.data.valueRanges ?? []).map((vr) => ({
        values: (vr.values as string[][]) ?? [],
      })),
    };
  }

  /**
   * Batch write to multiple ranges.
   */
  async batchWriteData(
    spreadsheetId: string,
    writes: Array<{ range: string; values: unknown[][] }>
  ): Promise<void> {
    await this.executeWrite('batchWriteData', () =>
      this.sheetsApi.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: writes,
        },
      })
    );
  }

  /**
   * Append rows to a range.
   */
  async appendData(
    spreadsheetId: string,
    range: string,
    values: unknown[][]
  ): Promise<void> {
    await this.executeWrite('appendData', () =>
      this.sheetsApi.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values },
      })
    );
  }

  /**
   * Clear data from a range.
   */
  async clearData(spreadsheetId: string, range: string): Promise<void> {
    await this.executeWrite('clearData', () =>
      this.sheetsApi.spreadsheets.values.clear({
        spreadsheetId,
        range,
        requestBody: {},
      })
    );
  }

  /**
   * Delete rows from a sheet by index range (0-based, exclusive end).
   */
  async deleteRows(
    spreadsheetId: string,
    sheetId: number,
    startIndex: number,
    endIndex: number
  ): Promise<void> {
    await this.executeWrite('deleteRows', () =>
      this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: 'ROWS',
                  startIndex,
                  endIndex,
                },
              },
            },
          ],
        },
      })
    );
  }

  /**
   * Insert empty rows into a sheet at a given index (0-based).
   */
  async insertRows(
    spreadsheetId: string,
    sheetId: number,
    startIndex: number,
    count: number
  ): Promise<void> {
    await this.executeWrite('insertRows', () =>
      this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              insertDimension: {
                range: {
                  sheetId,
                  dimension: 'ROWS',
                  startIndex,
                  endIndex: startIndex + count,
                },
                inheritFromBefore: false,
              },
            },
          ],
        },
      })
    );
  }
}

// Singleton instance
let liveClientInstance: LiveApiClient | null = null;

/**
 * Get the singleton live API client
 * Throws if credentials are not configured
 */
export async function getLiveApiClient(options: LiveApiClientOptions = {}): Promise<LiveApiClient> {
  if (!shouldRunIntegrationTests()) {
    throw new Error('Live API tests are not enabled. Set TEST_REAL_API=true to run live tests.');
  }

  if (!liveClientInstance) {
    const credentials = await loadTestCredentials();
    if (!credentials) {
      throw new Error(
        'Live API credentials not configured. ' +
          'Set GOOGLE_APPLICATION_CREDENTIALS and TEST_SPREADSHEET_ID environment variables.'
      );
    }
    liveClientInstance = new LiveApiClient(credentials, options);
  }

  return liveClientInstance;
}

/**
 * Reset the singleton (for test isolation)
 */
export function resetLiveApiClient(): void {
  liveClientInstance = null;
}

/**
 * Check if live API tests should run
 */
export function isLiveApiEnabled(): boolean {
  return shouldRunIntegrationTests();
}
