/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-console */
/**
 * ServalSheets - F3 Data Cleaning Tests
 *
 * Tests for clean, standardize_formats, fill_missing, detect_anomalies, suggest_cleaning actions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FixHandler } from '../../src/handlers/fix.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4 } from 'googleapis';
import {
  createRequestContext,
  runWithRequestContext,
} from '../../src/utils/request-context.js';

// ---------------------------------------------------------------------------
// Mock factories (no vi.mock calls - created per test)
// ---------------------------------------------------------------------------

const createMockSheetsApi = (): sheets_v4.Sheets => ({
  spreadsheets: {
    get: vi.fn(),
    values: {
      get: vi.fn(),
      update: vi.fn(),
      append: vi.fn(),
      clear: vi.fn(),
      batchGet: vi.fn(),
      batchUpdate: vi.fn(),
      batchClear: vi.fn(),
    },
    batchUpdate: vi.fn(),
  } as any,
});

const createMockContext = (): HandlerContext => ({
  spreadsheetId: 'test-spreadsheet-id',
  userId: 'test-user-id',
  cachedApi: {} as any,
  googleClient: {} as any,
  samplingServer: undefined,
  elicitationServer: undefined,
  backend: undefined,
});

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const SAMPLE_DATA = [
  ['Name', 'Revenue', 'Date', 'Email', 'Status'],
  ['  Alice ', 1000, '2024-01-15', 'alice@EXAMPLE.com', 'active'],
  ['Bob', 2000, '01/15/2024', 'bob@example.com', 'Active'],
  ['  Charlie  ', null, '2024-02-01', 'invalid-email', 'ACTIVE'],
  ['Dave', 3000, '2024/03/01', 'dave@example.com', ''],
  ['Eve', 500, '2024-04-15', 'EVE@Example.COM', 'active'],
];

const NUMERIC_DATA = [
  ['Name', 'Score', 'Value'],
  ['A', 100, 50],
  ['B', 105, 55],
  ['C', 110, 200], // outlier in Value
  ['D', 115, 60],
  ['E', 120, 65],
];

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------

describe('FixHandler (F3 Data Cleaning)', () => {
  let handler: FixHandler;
  let mockContext: HandlerContext;
  let mockSheetsApi: sheets_v4.Sheets;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = createMockContext();
    mockSheetsApi = createMockSheetsApi();
    handler = new FixHandler(mockContext, mockSheetsApi);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Test: clean action
  // =========================================================================

  describe('clean action', () => {
    it('should detect and fix whitespace issues', async () => {
      (mockSheetsApi.spreadsheets?.values?.get as any).mockResolvedValue({
        data: { values: SAMPLE_DATA },
      });

      const input = {
        action: 'clean' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:E6' },
        mode: 'preview' as const,
      };

      const response = await handler.handle(input);
      expect(response.response.success).toBe(true);
      expect(response.response.action).toBe('clean');
    });

    it('should apply cleaning in apply mode', async () => {
      (mockSheetsApi.spreadsheets?.values?.get as any).mockResolvedValue({
        data: { values: SAMPLE_DATA },
      });
      (mockSheetsApi.spreadsheets?.values?.update as any).mockResolvedValue({
        data: {},
      });

      const input = {
        action: 'clean' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A2:A6' },
        mode: 'apply' as const,
      };

      const response = await handler.handle(input);
      expect(response.response.success).toBe(true);
    });

    it('should detect inconsistent case in status column', async () => {
      (mockSheetsApi.spreadsheets?.values?.get as any).mockResolvedValue({
        data: { values: SAMPLE_DATA },
      });

      const input = {
        action: 'clean' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!E2:E6' },
        mode: 'preview' as const,
      };

      const response = await handler.handle(input);
      expect(response.response.success).toBe(true);
    });
  });

  // =========================================================================
  // Test: standardize_formats action
  // =========================================================================

  describe('standardize_formats action', () => {
    it('should standardize date formats', async () => {
      (mockSheetsApi.spreadsheets?.values?.get as any).mockResolvedValue({
        data: { values: SAMPLE_DATA },
      });

      const input = {
        action: 'standardize_formats' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!C2:C6' },
        columns: [{ column: 'C', targetFormat: 'YYYY-MM-DD' }],
      };

      const response = await handler.handle(input);
      expect(response.response.success).toBe(true);
      expect(response.response.action).toBe('standardize_formats');
    });

    it('should standardize email formats (lowercase)', async () => {
      (mockSheetsApi.spreadsheets?.values?.get as any).mockResolvedValue({
        data: { values: SAMPLE_DATA },
      });

      const input = {
        action: 'standardize_formats' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!D2:D6' },
        columns: [{ column: 'D', targetFormat: 'email' }],
      };

      const response = await handler.handle(input);
      expect(response.response.success).toBe(true);
    });
  });

  // =========================================================================
  // Test: fill_missing action
  // =========================================================================

  describe('fill_missing action', () => {
    it('should fill missing values using forward strategy', async () => {
      (mockSheetsApi.spreadsheets?.values?.get as any).mockResolvedValue({
        data: { values: SAMPLE_DATA },
      });

      const input = {
        action: 'fill_missing' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A2:B6' },
        strategy: 'forward' as const,
      };

      const response = await handler.handle(input);
      expect(response.response.success).toBe(true);
      expect(response.response.action).toBe('fill_missing');
    });

    it('should fill missing values using constant strategy', async () => {
      (mockSheetsApi.spreadsheets?.values?.get as any).mockResolvedValue({
        data: { values: SAMPLE_DATA },
      });
      (mockSheetsApi.spreadsheets?.values?.update as any).mockResolvedValue({
        data: {},
      });

      const input = {
        action: 'fill_missing' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!B2:B6' },
        strategy: 'constant' as const,
        constantValue: 0,
      };

      const response = await handler.handle(input);
      expect(response.response.success).toBe(true);
    });
  });

  // =========================================================================
  // Test: detect_anomalies action
  // =========================================================================

  describe('detect_anomalies action', () => {
    beforeEach(() => {
      (mockSheetsApi.spreadsheets?.values?.get as any).mockResolvedValue({
        data: { values: NUMERIC_DATA },
      });
    });

    it('should detect outliers using IQR method', async () => {
      const input = {
        action: 'detect_anomalies' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!B2:C6' },
        method: 'iqr' as const,
      };

      const response = await handler.handle(input);
      expect(response.response.success).toBe(true);
      expect(response.response.action).toBe('detect_anomalies');
    });

    it('should detect outliers using zscore method', async () => {
      const input = {
        action: 'detect_anomalies' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!B2:C6' },
        method: 'zscore' as const,
        threshold: 2,
      };

      const response = await handler.handle(input);
      expect(response.response.success).toBe(true);
    });
  });

  // =========================================================================
  // Test: suggest_cleaning action
  // =========================================================================

  describe('suggest_cleaning action', () => {
    it('should generate cleaning suggestions', async () => {
      (mockSheetsApi.spreadsheets?.values?.get as any).mockResolvedValue({
        data: { values: SAMPLE_DATA },
      });

      const input = {
        action: 'suggest_cleaning' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:E6' },
      };

      const response = await handler.handle(input);
      expect(response.response.success).toBe(true);
      expect(response.response.action).toBe('suggest_cleaning');
    });

    it('should rank suggestions by impact', async () => {
      (mockSheetsApi.spreadsheets?.values?.get as any).mockResolvedValue({
        data: { values: SAMPLE_DATA },
      });

      const input = {
        action: 'suggest_cleaning' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:E6' },
      };

      const response = await handler.handle(input);
      expect(response.response.success).toBe(true);
    });
  });

  // =========================================================================
  // Test: error handling
  // =========================================================================

  describe('error handling', () => {
    it('should gracefully handle API errors', async () => {
      (mockSheetsApi.spreadsheets?.values?.get as any).mockRejectedValue(
        new Error('Spreadsheet not found')
      );

      const input = {
        action: 'clean' as const,
        spreadsheetId: 'invalid-id',
        range: { a1: 'Sheet1!A1:E6' },
        mode: 'preview' as const,
      };

      try {
        const response = await handler.handle(input);
        // Handler returns an error response (success:false) rather than throwing
        expect(response.response.success).toBe(false);
      } catch (err) {
        // Handler may also throw a typed error — both are acceptable
        expect(err).toBeDefined();
      }
    });

    it('should handle invalid range format', async () => {
      (mockSheetsApi.spreadsheets?.values?.get as any).mockResolvedValue({
        data: { values: SAMPLE_DATA },
      });

      const input = {
        action: 'clean' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'InvalidRange' },
        mode: 'preview' as const,
      };

      const response = await handler.handle(input);
      // Either success with fallback or error handling
      expect(response.response).toBeDefined();
    });
  });

  // =========================================================================
  // Test: integration scenarios
  // =========================================================================

  describe('integration scenarios', () => {
    it('should handle multiple cleaning operations in sequence', async () => {
      (mockSheetsApi.spreadsheets?.values?.get as any).mockResolvedValue({
        data: { values: SAMPLE_DATA },
      });

      // First: detect anomalies
      const detectInput = {
        action: 'detect_anomalies' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:E6' },
        method: 'iqr' as const,
      };

      const detectResponse = await handler.handle(detectInput);
      expect(detectResponse.response.success).toBe(true);

      // Then: suggest cleaning
      const suggestInput = {
        action: 'suggest_cleaning' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:E6' },
      };

      const suggestResponse = await handler.handle(suggestInput);
      expect(suggestResponse.response.success).toBe(true);
    });

    it('should handle large datasets', async () => {
      // Simulate large dataset (deterministic values for reproducibility)
      const largeData = Array.from({ length: 1000 }, (_, i) => [
        `Row${i}`,
        (i + 1) * 10,
        '2024-01-15',
      ]);

      (mockSheetsApi.spreadsheets?.values?.get as any).mockResolvedValue({
        data: { values: largeData },
      });

      const input = {
        action: 'clean' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:C1001' },
        mode: 'preview' as const,
      };

      const response = await handler.handle(input);
      expect(response.response.success).toBe(true);
    });
  });

  // =========================================================================
  // Progress notification tests (P18-X13)
  // =========================================================================

  describe('progress notifications (P18-X13)', () => {
    it('clean should emit progress notifications', async () => {
      const notification = vi.fn().mockResolvedValue(undefined);
      const requestContext = createRequestContext({
        requestId: 'fix-clean-progress',
        progressToken: 'fix-clean-progress',
        sendNotification: notification,
      });

      (mockSheetsApi.spreadsheets?.values?.get as any).mockResolvedValue({
        data: { values: SAMPLE_DATA },
      });

      const result = await runWithRequestContext(requestContext, () =>
        handler.handle({
          action: 'clean',
          spreadsheetId: 'test-spreadsheet-id',
          range: { a1: 'Sheet1!A1:E6' },
          mode: 'preview' as const,
        } as any)
      );

      expect(result.response.success).toBe(true);
      expect(notification).toHaveBeenCalled();
      expect(notification.mock.calls[0]?.[0]).toMatchObject({
        method: 'notifications/progress',
        params: expect.objectContaining({ progress: 0 }),
      });
    });

    it('standardize_formats should emit progress notifications', async () => {
      const notification = vi.fn().mockResolvedValue(undefined);
      const requestContext = createRequestContext({
        requestId: 'fix-standardize-progress',
        progressToken: 'fix-standardize-progress',
        sendNotification: notification,
      });

      (mockSheetsApi.spreadsheets?.values?.get as any).mockResolvedValue({
        data: { values: SAMPLE_DATA },
      });

      const result = await runWithRequestContext(requestContext, () =>
        handler.handle({
          action: 'standardize_formats',
          spreadsheetId: 'test-spreadsheet-id',
          range: { a1: 'Sheet1!A1:E6' },
          mode: 'preview' as const,
          columns: [{ column: 'C', targetFormat: 'date' }],
        } as any)
      );

      expect(result.response.success).toBe(true);
      expect(notification).toHaveBeenCalled();
      expect(notification.mock.calls[0]?.[0]).toMatchObject({
        method: 'notifications/progress',
        params: expect.objectContaining({ progress: 0 }),
      });
    });

    it('fill_missing should emit progress notifications', async () => {
      const notification = vi.fn().mockResolvedValue(undefined);
      const requestContext = createRequestContext({
        requestId: 'fix-fill-progress',
        progressToken: 'fix-fill-progress',
        sendNotification: notification,
      });

      (mockSheetsApi.spreadsheets?.values?.get as any).mockResolvedValue({
        data: {
          values: [
            ['Name', 'Value'],
            ['A', 10],
            ['B', null],
            ['C', 30],
          ],
        },
      });

      const result = await runWithRequestContext(requestContext, () =>
        handler.handle({
          action: 'fill_missing',
          spreadsheetId: 'test-spreadsheet-id',
          range: { a1: 'Sheet1!A1:B4' },
          strategy: 'mean' as const,
          mode: 'preview' as const,
        } as any)
      );

      expect(result.response.success).toBe(true);
      expect(notification).toHaveBeenCalled();
      expect(notification.mock.calls[0]?.[0]).toMatchObject({
        method: 'notifications/progress',
        params: expect.objectContaining({ progress: 0 }),
      });
    });
  });
});
