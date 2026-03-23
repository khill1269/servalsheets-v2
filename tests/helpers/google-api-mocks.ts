/**
 * Comprehensive Google API Mock Factory
 *
 * Provides realistic mocks for Google Sheets and Drive APIs
 * to use across all test suites.
 */

import { vi } from 'vitest';
import type { sheets_v4, drive_v3 } from 'googleapis';

export interface MockSpreadsheetData {
  spreadsheetId: string;
  title: string;
  sheets: Array<{
    sheetId: number;
    title: string;
    rowCount: number;
    columnCount: number;
  }>;
  values?: Record<string, unknown[][]>;
}

export interface MockSheetsApiOptions {
  spreadsheets?: Record<string, MockSpreadsheetData>;
  throwErrors?: boolean;
}

/**
 * Create a mock Google Sheets API with realistic responses
 */
export function createMockSheetsApi(options: MockSheetsApiOptions = {}) {
  const spreadsheets = options.spreadsheets || {
    'test-spreadsheet-id': {
      spreadsheetId: 'test-spreadsheet-id',
      title: 'Test Spreadsheet',
      sheets: [
        { sheetId: 0, title: 'Sheet1', rowCount: 1000, columnCount: 26 },
        { sheetId: 1, title: 'Sheet2', rowCount: 1000, columnCount: 26 },
      ],
      values: {
        'Sheet1!A1:D10': [
          ['Header1', 'Header2', 'Header3', 'Header4'],
          ['A', 'B', 'C', 'D'],
          ['E', 'F', 'G', 'H'],
        ],
      },
    },
  };

  const api = {
    spreadsheets: {
      get: vi.fn().mockImplementation((params: { spreadsheetId?: string; fields?: string }) => {
        const spreadsheet = spreadsheets[params.spreadsheetId || 'test-spreadsheet-id'];
        if (!spreadsheet) {
          throw new Error(`Spreadsheet not found: ${params.spreadsheetId}`);
        }

        return Promise.resolve({
          data: {
            spreadsheetId: spreadsheet.spreadsheetId,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheet.spreadsheetId}`,
            properties: {
              title: spreadsheet.title,
              locale: 'en_US',
              timeZone: 'America/Los_Angeles',
              autoRecalc: 'ON_CHANGE',
            },
            sheets: spreadsheet.sheets.map((sheet) => ({
              properties: {
                sheetId: sheet.sheetId,
                title: sheet.title,
                index: sheet.sheetId,
                sheetType: 'GRID',
                gridProperties: {
                  rowCount: sheet.rowCount,
                  columnCount: sheet.columnCount,
                  frozenRowCount: 0,
                  frozenColumnCount: 0,
                },
              },
            })),
          },
        });
      }),

      create: vi
        .fn()
        .mockImplementation((params: { requestBody?: sheets_v4.Schema$Spreadsheet }) => {
          const newId = `new-spreadsheet-${Date.now()}`;
          return Promise.resolve({
            data: {
              spreadsheetId: newId,
              spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${newId}`,
              properties: {
                title: params.requestBody?.properties?.title || 'Untitled Spreadsheet',
                locale: 'en_US',
                timeZone: 'America/Los_Angeles',
              },
              sheets: params.requestBody?.sheets || [
                {
                  properties: {
                    sheetId: 0,
                    title: 'Sheet1',
                    index: 0,
                    gridProperties: { rowCount: 1000, columnCount: 26 },
                  },
                },
              ],
            },
          });
        }),

      batchUpdate: vi.fn().mockResolvedValue({
        data: {
          spreadsheetId: 'test-spreadsheet-id',
          replies: [{}],
        },
      }),

      values: {
        get: vi.fn().mockImplementation((params) =>
          Promise.resolve({
            data: {
              range: params.range || 'Sheet1!A1:D10',
              majorDimension: 'ROWS',
              values: [
                ['A1', 'B1'],
                ['A2', 'B2'],
              ],
            },
          })
        ),
        update: vi.fn().mockResolvedValue({ data: { updatedCells: 40 } }),
        append: vi.fn().mockResolvedValue({ data: { updates: { updatedCells: 4 } } }),
        clear: vi.fn().mockResolvedValue({ data: { clearedRange: 'Sheet1!A1:D10' } }),
        batchGet: vi.fn().mockResolvedValue({ data: { valueRanges: [] } }),
        batchUpdate: vi.fn().mockResolvedValue({ data: { totalUpdatedCells: 40 } }),
      },
    },
  };

  return api as unknown as sheets_v4.Sheets;
}

export function createMockDriveApi() {
  return {
    files: {
      copy: vi.fn().mockResolvedValue({ data: { id: 'copied-file' } }),
      get: vi.fn().mockResolvedValue({ data: { id: 'test-file' } }),
      list: vi.fn().mockResolvedValue({ data: { files: [] } }),
      delete: vi.fn().mockResolvedValue({}),
    },
    permissions: {
      list: vi.fn().mockResolvedValue({ data: { permissions: [] } }),
      create: vi.fn().mockResolvedValue({ data: { id: 'perm-1' } }),
      update: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({}),
    },
    comments: {
      list: vi.fn().mockResolvedValue({ data: { comments: [] } }),
      create: vi.fn().mockResolvedValue({ data: { id: 'comment-1' } }),
      update: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({}),
    },
    revisions: {
      list: vi.fn().mockResolvedValue({ data: { revisions: [] } }),
      get: vi.fn().mockResolvedValue({ data: { id: 'rev-1' } }),
      update: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({}),
    },
  } as unknown as drive_v3.Drive;
}

export function createMockContext(overrides = {}) {
  return {
    rangeResolver: {
      resolve: vi.fn().mockResolvedValue('Sheet1!A1:Z100'),
      clearCache: vi.fn(),
    },
    batchCompiler: {
      compile: vi.fn().mockResolvedValue({ requests: [], cellsAffected: 0 }),
    },
    policyEnforcer: {
      validateIntents: vi.fn().mockResolvedValue(undefined),
      validateEffectScope: vi.fn().mockResolvedValue(undefined),
    },
    auth: {
      hasElevatedAccess: false,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    },
    ...overrides,
  };
}
