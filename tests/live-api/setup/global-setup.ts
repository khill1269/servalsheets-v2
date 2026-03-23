/**
 * Global Setup for Live API Tests
 *
 * Initializes shared resources before any tests run.
 * This includes the spreadsheet pool to avoid quota exhaustion.
 */

import { getLiveApiClient, isLiveApiEnabled, resetLiveApiClient } from './live-api-client.js';
import { spreadsheetPool } from './spreadsheet-pool.js';

/**
 * Run before all live API tests
 */
export async function globalSetup(): Promise<void> {
  if (!isLiveApiEnabled()) {
    console.log('Live API tests disabled. Skipping global setup.');
    return;
  }

  console.log('Initializing live API test environment...');

  try {
    const client = await getLiveApiClient();

    // Initialize the spreadsheet pool with 3 reusable spreadsheets
    await spreadsheetPool.initialize(client, {
      maxSize: 3,
      prefix: 'SERVAL_POOL_',
      populateData: true,
      dataRows: 100,
    });

    const stats = spreadsheetPool.getStats();
    console.log(`Spreadsheet pool initialized: ${stats.total} spreadsheets available`);
  } catch (error) {
    console.error('Failed to initialize live API test environment:', error);
    throw error;
  }
}

/**
 * Run after all live API tests
 */
export async function globalTeardown(): Promise<void> {
  if (!isLiveApiEnabled()) {
    return;
  }

  console.log('Cleaning up live API test environment...');

  try {
    // Optionally clean up pool spreadsheets
    // Comment this out if you want to reuse spreadsheets across test runs
    // const result = await spreadsheetPool.cleanup();
    // console.log(`Cleaned up ${result.deleted} spreadsheets`);

    const stats = spreadsheetPool.getStats();
    console.log(`Test complete. Pool stats: ${stats.total} total, ${stats.inUse} in use`);

    resetLiveApiClient();
  } catch (error) {
    console.error('Error during teardown:', error);
  }
}

/**
 * Get a spreadsheet from the pool for a test
 */
export async function getPooledSpreadsheet(testName?: string) {
  return spreadsheetPool.borrow(testName);
}

/**
 * Release a spreadsheet back to the pool
 */
export async function releasePooledSpreadsheet(spreadsheetId: string, cleanup = false) {
  return spreadsheetPool.release(spreadsheetId, cleanup);
}

/**
 * Get the primary test spreadsheet (for simple tests)
 */
export function getPrimaryTestSpreadsheet() {
  const spreadsheet = spreadsheetPool.getPrimarySpreadsheet();
  if (!spreadsheet) {
    throw new Error('Pool not initialized. Run globalSetup() first.');
  }
  return spreadsheet;
}
