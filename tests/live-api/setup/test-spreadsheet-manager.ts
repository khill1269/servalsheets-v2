/**
 * Test Spreadsheet Lifecycle Manager
 *
 * Creates, manages, and cleans up test spreadsheets for live API tests.
 * Ensures tests don't pollute production data.
 */

import type { LiveApiClient } from './live-api-client.js';
import { spreadsheetPool } from './spreadsheet-pool.js';

export interface TestSpreadsheet {
  id: string;
  title: string;
  url: string;
  sheets: Array<{ sheetId: number; title: string }>;
  createdAt: number;
}

export interface TestDataOptions {
  rows?: number;
  columns?: number;
  includeFormulas?: boolean;
  includeDates?: boolean;
  includeNumbers?: boolean;
}

const DEFAULT_TEST_PREFIX = 'SERVAL_TEST_';

/**
 * Manages test spreadsheet lifecycle for live API tests
 */
export class TestSpreadsheetManager {
  private client: LiveApiClient;
  private createdSpreadsheets: Set<string> = new Set();
  private borrowedFromPool: Set<string> = new Set();
  private testPrefix: string;

  constructor(client: LiveApiClient, testPrefix = DEFAULT_TEST_PREFIX) {
    this.client = client;
    this.testPrefix = testPrefix;
  }

  /**
   * Create a new test spreadsheet, borrowing from the shared pool when available.
   * Pool reuse avoids a create + delete API call pair per test file (~800ms saved each).
   */
  async createTestSpreadsheet(suffix?: string): Promise<TestSpreadsheet> {
    // Borrow from pool if it's been initialized (global setup wires this up)
    if (spreadsheetPool.isInitialized()) {
      const testName = suffix ? `${this.testPrefix}${suffix}` : this.testPrefix;
      const pooled = await spreadsheetPool.borrow(testName);

      // Clear all data sheets so each test file starts from a known clean state
      for (const sheetName of ['TestData', 'Benchmarks', 'Formulas']) {
        try {
          await this.client.sheets.spreadsheets.values.clear({
            spreadsheetId: pooled.id,
            range: `${sheetName}!A:ZZ`,
          });
        } catch {
          // Sheet may not exist in older pool spreadsheets — ignore
        }
      }

      const spreadsheet: TestSpreadsheet = {
        id: pooled.id,
        title: pooled.title,
        url: pooled.url,
        sheets: pooled.sheets,
        createdAt: Date.now(),
      };

      this.borrowedFromPool.add(spreadsheet.id);
      this.createdSpreadsheets.add(spreadsheet.id);
      return spreadsheet;
    }

    // Fall back to creating a fresh spreadsheet when pool is not available
    const timestamp = Date.now();
    const spreadsheetTitle = suffix
      ? `${this.testPrefix}${suffix}_${timestamp}`
      : `${this.testPrefix}${timestamp}`;

    const response = await this.client.executeWrite('createTestSpreadsheet', () =>
      this.client.sheets.spreadsheets.create({
        requestBody: {
          properties: { title: spreadsheetTitle },
          sheets: [
            { properties: { title: 'TestData', sheetId: 0 } },
            { properties: { title: 'Benchmarks', sheetId: 1 } },
            { properties: { title: 'Formulas', sheetId: 2 } },
          ],
        },
      })
    );

    const spreadsheet: TestSpreadsheet = {
      id: response.data.spreadsheetId!,
      title: spreadsheetTitle,
      url: response.data.spreadsheetUrl!,
      sheets:
        response.data.sheets?.map((s) => ({
          sheetId: s.properties!.sheetId!,
          title: s.properties!.title!,
        })) || [],
      createdAt: timestamp,
    };

    this.createdSpreadsheets.add(spreadsheet.id);
    return spreadsheet;
  }

  /**
   * Populate a spreadsheet with test data
   */
  async populateTestData(
    spreadsheetId: string,
    options: TestDataOptions = {}
  ): Promise<{ rowCount: number; cellCount: number }> {
    const {
      rows = 100,
      columns = 6,
      includeFormulas = true,
      includeDates = true,
      includeNumbers = true,
    } = options;

    // Generate header row
    const headers = ['ID', 'Name', 'Value', 'Date', 'Status', 'Formula'];
    const headerRow = headers.slice(0, columns);

    // Generate data rows
    const values: unknown[][] = [headerRow];
    const statuses = ['Active', 'Pending', 'Complete', 'Draft', 'Archived'];

    for (let i = 1; i <= rows; i++) {
      const row: unknown[] = [];

      // ID column
      row.push(i);

      // Name column
      if (columns >= 2) {
        row.push(`Item ${i}`);
      }

      // Value column (numbers)
      if (columns >= 3) {
        row.push(includeNumbers ? Math.round(Math.random() * 10000) / 100 : `Value ${i}`);
      }

      // Date column
      if (columns >= 4) {
        if (includeDates) {
          const daysAgo = Math.floor(Math.random() * 365);
          const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
          row.push(date.toISOString().split('T')[0]);
        } else {
          row.push(`Date ${i}`);
        }
      }

      // Status column
      if (columns >= 5) {
        row.push(statuses[i % statuses.length]);
      }

      // Formula column
      if (columns >= 6) {
        if (includeFormulas) {
          row.push(`=C${i + 1}*1.1`);
        } else {
          row.push(`Calculated ${i}`);
        }
      }

      values.push(row);
    }

    // Calculate end column letter
    const endColumn = String.fromCharCode(64 + columns);

    await this.client.executeWrite('populateTestData', () =>
      this.client.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `TestData!A1:${endColumn}${rows + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
      })
    );

    return {
      rowCount: rows + 1,
      cellCount: (rows + 1) * columns,
    };
  }

  /**
   * Add additional sheet to spreadsheet
   */
  async addSheet(spreadsheetId: string, title: string): Promise<number> {
    const response = await this.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title },
            },
          },
        ],
      },
    });

    const sheetId = response.data.replies?.[0]?.addSheet?.properties?.sheetId;
    return sheetId ?? 0;
  }

  /**
   * Clear all data from a sheet
   */
  async clearSheet(spreadsheetId: string, sheetName: string): Promise<void> {
    await this.client.sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A:ZZ`,
    });
  }

  /**
   * Delete a test spreadsheet, or return it to the pool if it was borrowed.
   */
  async deleteSpreadsheet(spreadsheetId: string): Promise<boolean> {
    // Return to pool instead of deleting — pool spreadsheets are cleaned before next borrow
    if (this.borrowedFromPool.has(spreadsheetId) && spreadsheetPool.isInitialized()) {
      await spreadsheetPool.release(spreadsheetId);
      this.borrowedFromPool.delete(spreadsheetId);
      this.createdSpreadsheets.delete(spreadsheetId);
      return true;
    }

    try {
      await this.client.drive.files.delete({ fileId: spreadsheetId });
      this.createdSpreadsheets.delete(spreadsheetId);
      return true;
    } catch (error) {
      console.warn(`Failed to delete spreadsheet ${spreadsheetId}:`, error);
      return false;
    }
  }

  /**
   * Cleanup all created spreadsheets
   */
  async cleanup(): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;

    for (const spreadsheetId of this.createdSpreadsheets) {
      const success = await this.deleteSpreadsheet(spreadsheetId);
      if (success) {
        deleted++;
      } else {
        failed++;
      }
    }

    this.createdSpreadsheets.clear();
    return { deleted, failed };
  }

  /**
   * Clean up old test spreadsheets (from previous test runs)
   */
  async cleanupOldTestSpreadsheets(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
    const response = await this.client.drive.files.list({
      q: `name contains '${this.testPrefix}' and trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'`,
      fields: 'files(id, name, createdTime)',
      pageSize: 100,
    });

    const cutoff = Date.now() - maxAgeMs;
    let deleted = 0;

    for (const file of response.data.files || []) {
      if (!file.createdTime || !file.id) continue;

      const createdTime = new Date(file.createdTime).getTime();
      if (createdTime < cutoff) {
        try {
          await this.client.drive.files.delete({ fileId: file.id });
          deleted++;
        } catch {
          // Ignore deletion errors for cleanup
        }
      }
    }

    return deleted;
  }

  /**
   * Get all spreadsheets created by this manager
   */
  getCreatedSpreadsheetIds(): string[] {
    return [...this.createdSpreadsheets];
  }

  /**
   * Get count of created spreadsheets
   */
  getCreatedCount(): number {
    return this.createdSpreadsheets.size;
  }

  /**
   * Track an externally created spreadsheet for cleanup
   */
  trackSpreadsheet(spreadsheetId: string): void {
    this.createdSpreadsheets.add(spreadsheetId);
  }
}

/**
 * Create a manager with default settings
 */
export function createTestSpreadsheetManager(
  client: LiveApiClient,
  prefix?: string
): TestSpreadsheetManager {
  return new TestSpreadsheetManager(client, prefix);
}

// Singleton instance for use across test files
let _managerInstance: TestSpreadsheetManager | null = null;

/**
 * Get or create the singleton TestSpreadsheetManager.
 * Requires the LiveApiClient to be initialized first.
 */
export function getTestSpreadsheetManager(
  client?: LiveApiClient,
  prefix?: string
): TestSpreadsheetManager {
  if (!_managerInstance) {
    if (!client) {
      throw new Error('LiveApiClient required for first call to getTestSpreadsheetManager');
    }
    _managerInstance = new TestSpreadsheetManager(client, prefix);
  }
  return _managerInstance;
}

/**
 * Reset the singleton manager (for test isolation)
 */
export function resetTestSpreadsheetManager(): void {
  _managerInstance = null;
}
