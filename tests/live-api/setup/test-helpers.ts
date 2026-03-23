/**
 * ServalSheets - Test Helpers
 *
 * Common utilities for live API tests.
 * Provides helper functions for setup, assertions, and cleanup.
 */

import { TEST_CONFIG } from './config.js';
import { getQuotaManager, applyQuotaDelay } from './quota-manager.js';
import { getTestRateLimiter } from './test-rate-limiter.js';
import { getMetricsCollector, startTestMetrics, endTestMetrics } from './metrics-collector.js';
import { getRetryStats, clearRetryMetrics } from './test-retry-manager.js';
import type { LiveApiClient } from './live-api-client.js';
import type { PooledSpreadsheet } from './spreadsheet-pool.js';

/**
 * Test context passed to each test
 */
export interface TestContext {
  client: LiveApiClient;
  spreadsheet: PooledSpreadsheet;
  testName: string;
  startTime: number;
}

/**
 * Options for creating a test spreadsheet
 */
export interface CreateTestSheetOptions {
  /** Sheet name (default: 'TestSheet') */
  name?: string;
  /** Number of rows to populate (default: 10) */
  rows?: number;
  /** Number of columns to populate (default: 5) */
  cols?: number;
  /** Custom headers */
  headers?: string[];
  /** Custom data generator */
  dataGenerator?: (row: number, col: number) => unknown;
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delay helper with configurable default
 */
export async function delay(ms?: number): Promise<void> {
  const delayMs = ms ?? TEST_CONFIG.quota.delayBetweenTestsMs;
  await sleep(delayMs);
}

/**
 * Generate a unique test identifier
 */
export function generateTestId(prefix: string = 'test'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Generate column letter from index (0 = A, 25 = Z, 26 = AA, etc.)
 */
export function columnLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

/**
 * Generate A1 notation for a range
 */
export function a1Range(
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  sheetName?: string
): string {
  const start = `${columnLetter(startCol)}${startRow}`;
  const end = `${columnLetter(endCol)}${endRow}`;
  const range = `${start}:${end}`;
  return sheetName ? `'${sheetName}'!${range}` : range;
}

/**
 * Generate test data array
 */
export function generateTestData(
  rows: number,
  cols: number,
  generator?: (row: number, col: number) => unknown
): unknown[][] {
  const data: unknown[][] = [];
  const defaultGenerator = (row: number, col: number) => {
    const types = ['number', 'string', 'boolean', 'date'];
    const type = types[col % types.length];
    switch (type) {
      case 'number':
        return row * cols + col;
      case 'string':
        return `Cell_${row}_${col}`;
      case 'boolean':
        return row % 2 === 0;
      case 'date':
        return new Date(2024, 0, row + 1).toISOString().split('T')[0];
      default:
        return `${row},${col}`;
    }
  };

  const gen = generator ?? defaultGenerator;
  for (let r = 0; r < rows; r++) {
    const rowData: unknown[] = [];
    for (let c = 0; c < cols; c++) {
      rowData.push(gen(r, c));
    }
    data.push(rowData);
  }
  return data;
}

/**
 * Generate headers array
 */
export function generateHeaders(count: number, prefix: string = 'Col'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
}

/**
 * Wait for quota to recover if needed
 */
export async function waitForQuota(
  estimatedReads: number = 1,
  estimatedWrites: number = 1
): Promise<void> {
  const quota = getQuotaManager();
  const verification = quota.verifyQuota({ reads: estimatedReads, writes: estimatedWrites });

  if (!verification.hasQuota && verification.recommendedDelayMs > 0) {
    await sleep(verification.recommendedDelayMs);
  }
}

/**
 * Check if test should be skipped due to quota
 */
export function shouldSkipForQuota(estimatedReads: number, estimatedWrites: number): boolean {
  const quota = getQuotaManager();
  const verification = quota.verifyQuota({ reads: estimatedReads, writes: estimatedWrites });
  return (
    !verification.hasQuota && verification.recommendedDelayMs > TEST_CONFIG.quota.maxQuotaDelayMs
  );
}

/**
 * Create a test wrapper that handles setup/teardown
 */
export function withTestTracking<T>(testName: string, testFn: () => Promise<T>): () => Promise<T> {
  return async () => {
    startTestMetrics(testName);
    try {
      const result = await testFn();
      endTestMetrics('passed');
      return result;
    } catch (error) {
      endTestMetrics('failed', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  };
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30000;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !shouldRetry(error)) {
        throw error;
      }
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Assert that a value matches expected within tolerance
 */
export function assertApproxEqual(
  actual: number,
  expected: number,
  tolerance: number = 0.01,
  message?: string
): void {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(
      message ??
        `Expected ${actual} to be approximately ${expected} (tolerance: ${tolerance}, diff: ${diff})`
    );
  }
}

/**
 * Assert that an async function throws
 */
export async function assertThrows(
  fn: () => Promise<unknown>,
  errorMatch?: string | RegExp
): Promise<Error> {
  try {
    await fn();
    throw new Error('Expected function to throw but it did not');
  } catch (error) {
    if (error instanceof Error && error.message === 'Expected function to throw but it did not') {
      throw error;
    }
    if (errorMatch) {
      const message = error instanceof Error ? error.message : String(error);
      if (typeof errorMatch === 'string') {
        if (!message.includes(errorMatch)) {
          throw new Error(`Expected error message to include "${errorMatch}" but got "${message}"`);
        }
      } else {
        if (!errorMatch.test(message)) {
          throw new Error(`Expected error message to match ${errorMatch} but got "${message}"`);
        }
      }
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Assert that a condition is true with timeout
 */
export async function assertEventually(
  condition: () => boolean | Promise<boolean>,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    message?: string;
  } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const intervalMs = options.intervalMs ?? 100;
  const message = options.message ?? 'Condition not met within timeout';

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error(message);
}

/**
 * Get comprehensive test statistics
 */
export function getTestStats(): {
  metrics: ReturnType<typeof getMetricsCollector>['getRunMetrics'];
  retry: ReturnType<typeof getRetryStats>;
  quota: ReturnType<typeof getQuotaManager>['getStats'];
  rateLimiter: ReturnType<typeof getTestRateLimiter>['getStats'];
} {
  return {
    metrics: getMetricsCollector().getRunMetrics(),
    retry: getRetryStats(),
    quota: getQuotaManager().getStats(),
    rateLimiter: getTestRateLimiter().getStats(),
  };
}

/**
 * Reset all test infrastructure state
 */
export function resetTestInfrastructure(): void {
  getMetricsCollector().clear();
  clearRetryMetrics();
  getQuotaManager().reset();
  getQuotaManager().resetStats();
  getTestRateLimiter().reset();
  getTestRateLimiter().resetStats();
}

/**
 * Standard afterEach hook for live API tests
 */
export async function standardAfterEach(): Promise<void> {
  await applyQuotaDelay();
}

/**
 * Create standard beforeAll hook for live API tests
 */
export function createBeforeAllHook(
  clientGetter: () => Promise<LiveApiClient>,
  suiteNameSetter: (name: string) => void
): (suiteName: string) => () => Promise<LiveApiClient> {
  return (suiteName: string) => async () => {
    suiteNameSetter(suiteName);
    getMetricsCollector().setSuite(suiteName);
    const client = await clientGetter();
    return client;
  };
}

/**
 * Format duration in human readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format bytes in human readable format
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

/**
 * Deep compare two values
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  if (Array.isArray(a) || Array.isArray(b)) return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
}

/**
 * Sanitize sheet name for Google Sheets API
 */
export function sanitizeSheetName(name: string): string {
  // Sheet names cannot contain: * ? : / \ [ ]
  return name.replace(/[*?:/\\[\]]/g, '_').substring(0, 100);
}

/**
 * Parse A1 notation to row/column indices
 */
export function parseA1Notation(a1: string): {
  sheetName?: string;
  startRow: number;
  startCol: number;
  endRow?: number;
  endCol?: number;
} {
  // Remove sheet name if present
  let sheetName: string | undefined;
  let range = a1;

  if (a1.includes('!')) {
    const parts = a1.split('!');
    sheetName = parts[0].replace(/^'|'$/g, '');
    range = parts[1];
  }

  // Parse range (e.g., "A1:B2" or "A1")
  const match = range.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i);
  if (!match) {
    throw new Error(`Invalid A1 notation: ${a1}`);
  }

  const colToIndex = (col: string): number => {
    let index = 0;
    for (let i = 0; i < col.length; i++) {
      index = index * 26 + (col.charCodeAt(i) - 64);
    }
    return index - 1;
  };

  return {
    sheetName,
    startCol: colToIndex(match[1].toUpperCase()),
    startRow: parseInt(match[2], 10),
    endCol: match[3] ? colToIndex(match[3].toUpperCase()) : undefined,
    endRow: match[4] ? parseInt(match[4], 10) : undefined,
  };
}
