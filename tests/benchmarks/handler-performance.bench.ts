/**
 * Handler Performance Benchmarks
 *
 * P2-4: Benchmark all 24 handlers for performance tracking.
 * Uses vitest bench() API for precise performance measurement.
 */

import { describe, bench, beforeAll } from 'vitest';
import { createHandlers } from '../../src/handlers/index.js';
import { createMockContext, createMockSheetsApi } from '../helpers/google-api-mocks.js';
import type { HandlerContext } from '../../src/handlers/index.js';

describe('Handler Performance Benchmarks', () => {
  let handlers: ReturnType<typeof createHandlers>;
  let context: HandlerContext;

  beforeAll(() => {
    const mockApi = createMockSheetsApi();
    context = createMockContext();
    handlers = createHandlers({
      context,
      sheetsApi: mockApi.spreadsheets,
      driveApi: mockApi.drive,
    });
  });

  describe('sheets_core Handler', () => {
    bench(
      'get spreadsheet metadata',
      async () => {
        await handlers.core.executeAction({
          request: {
            action: 'get',
            spreadsheetId: 'test-spreadsheet-12345',
          },
        });
      },
      { iterations: 1000 }
    );

    bench(
      'create spreadsheet',
      async () => {
        await handlers.core.executeAction({
          request: {
            action: 'create',
            title: 'Benchmark Test',
          },
        });
      },
      { iterations: 500 }
    );
  });

  describe('sheets_data Handler', () => {
    bench(
      'read_range',
      async () => {
        await handlers.data.executeAction({
          request: {
            action: 'read',
            spreadsheetId: 'test-spreadsheet-12345',
            range: { a1: 'Sheet1!A1:D10' },
          },
        });
      },
      { iterations: 1000 }
    );

    bench(
      'write_range',
      async () => {
        await handlers.data.executeAction({
          request: {
            action: 'write',
            spreadsheetId: 'test-spreadsheet-12345',
            range: { a1: 'Sheet1!A1:D10' },
            values: [['A', 'B', 'C', 'D']],
          },
        });
      },
      { iterations: 500 }
    );

    bench(
      'batch_read (10 ranges)',
      async () => {
        await handlers.data.executeAction({
          request: {
            action: 'batch_read',
            spreadsheetId: 'test-spreadsheet-12345',
            ranges: Array(10)
              .fill(null)
              .map((_, i) => ({
                a1: `Sheet1!A${i * 10 + 1}:D${(i + 1) * 10}`,
              })),
          },
        });
      },
      { iterations: 200 }
    );
  });

  describe('sheets_format Handler', () => {
    bench(
      'set_format',
      async () => {
        await handlers.format.executeAction({
          request: {
            action: 'set_format',
            spreadsheetId: 'test-spreadsheet-12345',
            range: { a1: 'Sheet1!A1:D10' },
            format: {
              backgroundColor: { red: 1, green: 1, blue: 0 },
              textFormat: { bold: true },
            },
          },
        });
      },
      { iterations: 500 }
    );

    bench(
      'clear_format',
      async () => {
        await handlers.format.executeAction({
          request: {
            action: 'clear_format',
            spreadsheetId: 'test-spreadsheet-12345',
            range: { a1: 'Sheet1!A1:D10' },
          },
        });
      },
      { iterations: 500 }
    );
  });

  describe('sheets_dimensions Handler', () => {
    bench(
      'insert_rows',
      async () => {
        await handlers.dimensions.executeAction({
          request: {
            action: 'insert_rows',
            spreadsheetId: 'test-spreadsheet-12345',
            sheetId: 0,
            startIndex: 10,
            endIndex: 15,
          },
        });
      },
      { iterations: 300 }
    );

    bench(
      'delete_columns',
      async () => {
        await handlers.dimensions.executeAction({
          request: {
            action: 'delete_columns',
            spreadsheetId: 'test-spreadsheet-12345',
            sheetId: 0,
            startIndex: 5,
            endIndex: 8,
          },
        });
      },
      { iterations: 300 }
    );
  });

  describe('sheets_visualize Handler', () => {
    bench(
      'chart_create',
      async () => {
        await handlers.visualize.executeAction({
          request: {
            action: 'chart_create',
            spreadsheetId: 'test-spreadsheet-12345',
            sheetId: 0,
            chartType: 'LINE',
            data: {
              sourceRange: { a1: 'Sheet1!A1:D100' },
            },
          },
        });
      },
      { iterations: 200 }
    );
  });

  describe('sheets_collaborate Handler', () => {
    bench(
      'add_permission',
      async () => {
        await handlers.collaborate.executeAction({
          request: {
            action: 'add_permission',
            spreadsheetId: 'test-spreadsheet-12345',
            email: 'user@example.com',
            role: 'reader',
          },
        });
      },
      { iterations: 200 }
    );
  });

  describe('sheets_advanced Handler', () => {
    bench(
      'formula_evaluate',
      async () => {
        await handlers.advanced.executeAction({
          request: {
            action: 'formula_evaluate',
            spreadsheetId: 'test-spreadsheet-12345',
            formula: '=SUM(A1:A10)',
          },
        });
      },
      { iterations: 500 }
    );
  });

  describe('sheets_session Handler', () => {
    bench(
      'context_save',
      async () => {
        await handlers.session.executeAction({
          request: {
            action: 'context_save',
            spreadsheetId: 'test-spreadsheet-12345',
            context: {
              lastAccessedSheets: ['Sheet1', 'Sheet2'],
              recentRanges: ['A1:D10'],
            },
          },
        });
      },
      { iterations: 1000 }
    );
  });

  describe('Schema Validation Performance', () => {
    bench(
      'simple input validation',
      () => {
        // This is handled internally by handlers but we can measure the overhead
        handlers.core.executeAction({
          request: {
            action: 'get',
            spreadsheetId: 'test-spreadsheet-12345',
          },
        });
      },
      { iterations: 2000 }
    );

    bench(
      'complex input validation (batch write)',
      () => {
        handlers.data.executeAction({
          request: {
            action: 'batch_write',
            spreadsheetId: 'test-spreadsheet-12345',
            data: Array(20)
              .fill(null)
              .map((_, i) => ({
                range: { a1: `Sheet1!A${i * 5 + 1}:D${(i + 1) * 5}` },
                values: Array(5).fill(['A', 'B', 'C', 'D']),
              })),
          },
        });
      },
      { iterations: 200 }
    );
  });

  describe('Handler Overhead', () => {
    // Measure pure handler execution overhead (no API calls)
    bench(
      'handler dispatch overhead',
      () => {
        // Synchronous operation - just measures dispatch
        const action = {
          request: {
            action: 'get' as const,
            spreadsheetId: 'test',
          },
        };
        // Don't await - just measure sync overhead
        handlers.core.executeAction(action).catch(() => {});
      },
      { iterations: 5000 }
    );
  });
});
