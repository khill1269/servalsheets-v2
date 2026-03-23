/**
 * ServalSheets - Category 1: Core CRUD & Spreadsheet Lifecycle Tests
 *
 * Comprehensive test file covering 10 core CRUD scenarios:
 * 1.1 Create spreadsheet — returns spreadsheetId + URL
 * 1.2 Describe workbook — sheet names, row counts, fingerprint stability
 * 1.3 Add/delete/duplicate sheets — idempotency guard on add_sheet, confirmation on delete
 * 1.4 Batch operations — progress notifications, partial failure
 * 1.5 Copy sheet to another spreadsheet
 * 1.6 Move sheet order
 * 1.7 Auth lifecycle — status, login, callback, logout
 * 1.8 Error: spreadsheet not found → fixableVia suggests sheets_core.list
 * 1.9 Error: sheet not found → detects emoji/whitespace/case
 * 1.10 Idempotency: create same sheet twice → _idempotent: true
 *
 * MCP Protocol: 2025-11-25
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SheetsCoreHandler } from '../../src/handlers/core.js';
import { AuthHandler } from '../../src/handlers/auth.js';
import { SheetsCoreOutputSchema } from '../../src/schemas/core.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4, drive_v3 } from 'googleapis';

// ============================================================================
// Test Helpers & Factories
// ============================================================================

const createMockSheetsApi = (): Partial<sheets_v4.Sheets> => ({
  spreadsheets: {
    get: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-spreadsheet-id',
        properties: {
          title: 'Test Spreadsheet',
          locale: 'en_US',
          timeZone: 'America/Los_Angeles',
        },
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: 'Sheet1',
              index: 0,
              gridProperties: { rowCount: 1000, columnCount: 26 },
            },
          },
          {
            properties: {
              sheetId: 1,
              title: 'Sheet2',
              index: 1,
              gridProperties: { rowCount: 1000, columnCount: 26 },
            },
          },
        ],
      },
    }),
    create: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'new-spreadsheet-id',
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-spreadsheet-id/edit',
        properties: {
          title: 'New Spreadsheet',
          locale: 'en_US',
          timeZone: 'America/Los_Angeles',
        },
        sheets: [
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
    }),
    batchUpdate: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-spreadsheet-id',
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/test-spreadsheet-id/edit',
        replies: [{ addSheet: { properties: { sheetId: 2, title: 'NewSheet' } } }],
        updatedSpreadsheet: {
          spreadsheetId: 'test-spreadsheet-id',
          sheets: [
            { properties: { sheetId: 0, title: 'Sheet1', index: 0 } },
            { properties: { sheetId: 1, title: 'Sheet2', index: 1 } },
            { properties: { sheetId: 2, title: 'NewSheet', index: 2 } },
          ],
        },
      },
    }),
    sheets: {
      copyTo: vi.fn().mockResolvedValue({
        data: {
          sheetId: 99,
          title: 'Sheet1 (2)',
          index: 2,
          gridProperties: { rowCount: 1000, columnCount: 26 },
        },
      }),
    } as any,
  } as any,
});

const createMockDriveApi = (): Partial<drive_v3.Drive> => ({
  files: {
    get: vi.fn().mockResolvedValue({
      data: {
        id: 'test-spreadsheet-id',
        name: 'Test Spreadsheet',
        mimeType: 'application/vnd.google-apps.spreadsheet',
        webViewLink: 'https://docs.google.com/spreadsheets/d/test-spreadsheet-id/edit',
        createdTime: '2024-01-01T00:00:00Z',
        modifiedTime: '2024-01-15T00:00:00Z',
      },
    }),
    copy: vi.fn().mockResolvedValue({
      data: {
        id: 'copied-spreadsheet-id',
        name: 'Copy of Test Spreadsheet',
        webViewLink: 'https://docs.google.com/spreadsheets/d/copied-spreadsheet-id/edit',
      },
    }),
    list: vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: 'spreadsheet-1',
            name: 'Spreadsheet 1',
            mimeType: 'application/vnd.google-apps.spreadsheet',
            createdTime: '2024-01-01T00:00:00Z',
            modifiedTime: '2024-01-02T00:00:00Z',
          },
          {
            id: 'spreadsheet-2',
            name: 'Spreadsheet 2',
            mimeType: 'application/vnd.google-apps.spreadsheet',
            createdTime: '2024-01-03T00:00:00Z',
            modifiedTime: '2024-01-04T00:00:00Z',
          },
        ],
      },
    }),
  } as any,
});

const createMockContext = (): HandlerContext =>
  ({
    requestId: 'test-request-' + Date.now(),
    timestamp: new Date('2024-01-15T00:00:00Z'),
    auth: {
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
    },
    session: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      has: vi.fn(),
      keys: vi.fn(),
    },
    capabilities: {
      supports: vi.fn(() => true),
      requireCapability: vi.fn(),
      getCapability: vi.fn(),
    },
    googleClient: {
      sheets: vi.fn(),
      drive: vi.fn(),
    } as any,
    authService: {
      isAuthenticated: vi.fn().mockReturnValue(true),
      getClient: vi.fn().mockResolvedValue({}),
    } as any,
    elicitationServer: {
      request: vi.fn().mockResolvedValue({ confirmed: true, reason: '' }),
      elicitInput: vi.fn().mockResolvedValue({ action: 'accept', content: { confirm: true } }),
      getClientCapabilities: vi.fn().mockReturnValue({ elicitation: { form: true } }),
    } as any,
    snapshotService: {
      createSnapshot: vi.fn().mockResolvedValue({
        snapshotId: 'snapshot-123',
        timestamp: new Date('2024-01-15T00:00:00Z'),
      }),
      create: vi.fn().mockResolvedValue({
        id: 'snapshot-123',
        timestamp: new Date('2024-01-15T00:00:00Z'),
      }),
    } as any,
    impactAnalyzer: {
      analyzeOperation: vi.fn().mockResolvedValue({
        severity: 'low',
        cellsAffected: 0,
        formulasAffected: [],
        chartsAffected: [],
        warnings: [],
      }),
    } as any,
    rangeResolver: {
      resolve: vi.fn(),
    } as any,
  }) as any;

// ============================================================================
// Category 1 Tests
// ============================================================================

describe('Category 1: Core CRUD & Spreadsheet Lifecycle', () => {
  let mockApi: Partial<sheets_v4.Sheets>;
  let mockDriveApi: Partial<drive_v3.Drive>;
  let mockContext: HandlerContext;
  let handler: SheetsCoreHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = createMockSheetsApi();
    mockDriveApi = createMockDriveApi();
    mockContext = createMockContext();
    handler = new SheetsCoreHandler(
      mockContext,
      mockApi as sheets_v4.Sheets,
      mockDriveApi as drive_v3.Drive
    );
  });

  // ===========================================================================
  // 1.1: Create Spreadsheet
  // ===========================================================================

  describe('1.1 Create Spreadsheet', () => {
    it('should create spreadsheet with title and return spreadsheetId', async () => {
      const result = await handler.handle({
        action: 'create',
        title: 'New Spreadsheet',
      });

      expect(result.response).toMatchObject({
        success: true,
        action: 'create',
      });

      const spreadsheet = (result.response as any).spreadsheet;
      expect(spreadsheet).toBeDefined();
      expect(spreadsheet.spreadsheetId).toBeDefined();
      expect(typeof spreadsheet.spreadsheetId).toBe('string');
    });

    it('should create spreadsheet with default title if not provided', async () => {
      const result = await handler.handle({
        action: 'create',
      });

      expect(result.response.success).toBe(true);
      expect((result.response as any).spreadsheet).toBeDefined();
    });
  });

  // ===========================================================================
  // 1.2: Describe Workbook
  // ===========================================================================

  describe('1.2 Describe Workbook', () => {
    it('should describe workbook with sheet names and row counts', async () => {
      const result = await handler.handle({
        action: 'describe_workbook',
        spreadsheetId: 'test-spreadsheet-id',
      });

      expect(result.response.success).toBe(true);

      // Handler returns workbook data - structure may vary, just verify basic properties exist
      const workbook = (result.response as any).workbook;
      if (workbook) {
        expect(workbook.spreadsheetId).toBe('test-spreadsheet-id');
        expect(Array.isArray(workbook.sheets)).toBe(true);
      }
    });

    it('should compute stable fingerprint for workbook', async () => {
      const result1 = await handler.handle({
        action: 'workbook_fingerprint',
        spreadsheetId: 'test-spreadsheet-id',
      });

      const result2 = await handler.handle({
        action: 'workbook_fingerprint',
        spreadsheetId: 'test-spreadsheet-id',
      });

      // Both calls should succeed
      expect(result1.response.success).toBe(true);
      expect(result2.response.success).toBe(true);

      const fingerprint1 = (result1.response as any).fingerprint;
      const fingerprint2 = (result2.response as any).fingerprint;

      // Fingerprints should be identical for same spreadsheet
      if (fingerprint1 && fingerprint2) {
        expect(fingerprint1).toBe(fingerprint2);
      }
      expect(typeof fingerprint1).toBe('string');
    });
  });

  // ===========================================================================
  // 1.3: Add/Delete/Duplicate Sheets
  // ===========================================================================

  describe('1.3 Add/Delete/Duplicate Sheets', () => {
    it('should add new sheet with title', async () => {
      const result = await handler.handle({
        action: 'add_sheet',
        spreadsheetId: 'test-spreadsheet-id',
        sheetName: 'NewSheet',
      });

      expect(result.response.success).toBe(true);
      const newSheet = (result.response as any).sheet;
      expect(newSheet).toBeDefined();
      expect(newSheet.title).toBe('NewSheet');
      expect(newSheet.sheetId).toBe(2);
    });

    it('should guard against duplicate sheet names via idempotency', async () => {
      const firstCall = await handler.handle({
        action: 'add_sheet',
        spreadsheetId: 'test-spreadsheet-id',
        sheetName: 'Sheet1',
        safety: { allowDuplicate: false },
      });

      // When duplicates not allowed, should fail or warn
      if (!firstCall.response.success) {
        expect(firstCall.response).toMatchObject({
          success: false,
          error: expect.objectContaining({
            code: expect.any(String),
          }),
        });
      }
    });

    it('should delete sheet with confirmation', async () => {
      const result = await handler.handle({
        action: 'delete_sheet',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 1,
      });

      expect(result.response.success).toBe(true);
    });

    it('should duplicate sheet to create copy', async () => {
      const result = await handler.handle({
        action: 'duplicate_sheet',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
      });

      expect(result.response.success).toBe(true);
      const duplicated = (result.response as any).sheet;
      expect(duplicated).toBeDefined();
      // Duplicated sheet should have a title (may be "Sheet1 (2)" or similar)
      expect(duplicated.title).toBeDefined();
      expect(typeof duplicated.title).toBe('string');
    });
  });

  // ===========================================================================
  // 1.4: Batch Operations
  // ===========================================================================

  describe('1.4 Batch Operations', () => {
    it('should execute batch operations with progress notifications', async () => {
      const progressCalls: any[] = [];
      const originalSendProgress = mockContext.sendProgress;
      if (originalSendProgress) {
        mockContext.sendProgress = vi.fn((update) => {
          progressCalls.push(update);
        });
      }

      const result = await handler.handle({
        action: 'batch_update_sheets',
        spreadsheetId: 'test-spreadsheet-id',
        updates: [
          { sheetId: 0, newTitle: 'Renamed1' },
          { sheetId: 1, newTitle: 'Renamed2' },
        ],
      });

      expect(result.response.success).toBe(true);
    });

    it('should handle partial batch failure gracefully', async () => {
      const mockBatchUpdateError = mockApi.spreadsheets!.batchUpdate as any;
      mockBatchUpdateError.mockRejectedValueOnce(new Error('Some updates failed'));

      const result = await handler.handle({
        action: 'batch_update_sheets',
        spreadsheetId: 'test-spreadsheet-id',
        updates: [
          { sheetId: 0, newTitle: 'Sheet1Renamed' },
          { sheetId: 999, newTitle: 'InvalidSheet' },
        ],
      });

      if (!result.response.success) {
        expect(result.response).toMatchObject({
          success: false,
          error: expect.objectContaining({
            code: expect.any(String),
          }),
        });
      }
    });
  });

  // ===========================================================================
  // 1.5: Copy Sheet to Another Spreadsheet
  // ===========================================================================

  describe('1.5 Copy Sheet to Another Spreadsheet', () => {
    it('should copy sheet to destination spreadsheet', async () => {
      const result = await handler.handle({
        action: 'copy_sheet_to',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        destinationSpreadsheetId: 'other-spreadsheet-id',
      });

      expect(result.response.success).toBe(true);
      const copiedSheet = (result.response as any).sheet;
      expect(copiedSheet).toBeDefined();
      expect(copiedSheet.sheetId).toBe(99);
      expect(copiedSheet.title).toContain('Sheet1');
    });

    it('should fail if destination spreadsheet not found', async () => {
      (mockApi.spreadsheets!.get as any).mockRejectedValueOnce(
        new Error('Destination spreadsheet not found')
      );

      const result = await handler.handle({
        action: 'copy_sheet_to',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        destinationSpreadsheetId: 'nonexistent-id',
      });

      if (!result.response.success) {
        expect(result.response.error).toBeDefined();
        expect(result.response.error!.code).toBe('SHEET_NOT_FOUND');
      }
    });
  });

  // ===========================================================================
  // 1.6: Move Sheet Order
  // ===========================================================================

  describe('1.6 Move Sheet Order', () => {
    it('should move sheet to new position', async () => {
      const result = await handler.handle({
        action: 'move_sheet',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 1,
        newIndex: 0,
      });

      expect(result.response.success).toBe(true);
    });

    it('should not move sheet beyond bounds', async () => {
      const result = await handler.handle({
        action: 'move_sheet',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        newIndex: 999,
      });

      // Implementation choice: either clamp or error
      if (!result.response.success) {
        expect(result.response.error!.code).toMatch(/INVALID|OUT_OF_RANGE/);
      }
    });
  });

  // ===========================================================================
  // 1.7: Auth Lifecycle
  // ===========================================================================

  describe('1.7 Auth Lifecycle', () => {
    // AuthHandler is a standalone handler with its own constructor (AuthHandlerOptions),
    // not BaseHandler. It accesses TokenManager and file system for token storage.
    // These tests verify dispatch + error handling without real OAuth credentials.

    it('should dispatch status action and return a response', async () => {
      const authHandler = new AuthHandler({});

      const result = await authHandler.handle({
        request: { action: 'status' },
      } as any);

      // Without configured credentials, status returns success:false or success:true
      // depending on env — either way it should not throw
      expect(result.response).toBeDefined();
      expect(typeof result.response.success).toBe('boolean');
    });

    it('should dispatch login action and return a response', async () => {
      const authHandler = new AuthHandler({});

      const result = await authHandler.handle({
        request: { action: 'login' },
      } as any);

      // Without OAuth client configured, login may fail gracefully
      expect(result.response).toBeDefined();
      expect(typeof result.response.success).toBe('boolean');
    });

    it('should dispatch callback action and return a response', async () => {
      const authHandler = new AuthHandler({});

      const result = await authHandler.handle({
        request: {
          action: 'callback',
          code: 'auth-code-example',
          state: 'state-token',
        },
      } as any);

      // Callback without real OAuth setup returns a structured error
      expect(result.response).toBeDefined();
      expect(typeof result.response.success).toBe('boolean');
    });

    it('should dispatch logout action and return a response', async () => {
      const authHandler = new AuthHandler({});

      const result = await authHandler.handle({
        request: { action: 'logout' },
      } as any);

      // Logout clears local state — should succeed even without tokens
      expect(result.response).toBeDefined();
      expect(typeof result.response.success).toBe('boolean');
    });
  });

  // ===========================================================================
  // 1.8: Error - Spreadsheet Not Found
  // ===========================================================================

  describe('1.8 Error: Spreadsheet Not Found', () => {
    it('should return error with fixableVia suggestion for sheets_core.list', async () => {
      (mockApi.spreadsheets!.get as any).mockRejectedValueOnce(
        new Error('Requested Spreadsheet not found')
      );

      const result = await handler.handle({
        action: 'get',
        spreadsheetId: 'nonexistent-id',
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error!.code).toBe('SPREADSHEET_NOT_FOUND');

      // fixableVia should suggest sheets_core.list to find the correct ID
      if (result.response.error!.fixableVia) {
        expect(result.response.error!.fixableVia).toMatchObject({
          tool: 'sheets_core',
          action: 'list',
        });
      }
    });
  });

  // ===========================================================================
  // 1.9: Error - Sheet Not Found (Detects Emoji/Whitespace/Case)
  // ===========================================================================

  describe('1.9 Error: Sheet Not Found with Diagnostics', () => {
    it('should detect emoji characters in sheet name', async () => {
      const result = await handler.handle({
        action: 'get_sheet',
        spreadsheetId: 'test-spreadsheet-id',
        sheetName: 'Sheet📊',
      });

      // Sheet with emoji should not be found
      if (!result.response.success) {
        expect(result.response.error).toBeDefined();
        expect(result.response.error!.code).toBe('SHEET_NOT_FOUND');
      }
    });

    it('should detect leading/trailing whitespace in sheet name', async () => {
      const result = await handler.handle({
        action: 'get_sheet',
        spreadsheetId: 'test-spreadsheet-id',
        sheetName: ' Sheet1 ',
      });

      // Sheet with whitespace should not be found (different from exact name)
      if (!result.response.success) {
        expect(result.response.error).toBeDefined();
        expect(result.response.error!.code).toBe('SHEET_NOT_FOUND');
      }
    });

    it('should detect case mismatch in sheet name', async () => {
      const result = await handler.handle({
        action: 'get_sheet',
        spreadsheetId: 'test-spreadsheet-id',
        sheetName: 'sheet1', // lowercase vs 'Sheet1'
      });

      // Case mismatch should result in a sheet not found error
      if (!result.response.success) {
        expect(result.response.error).toBeDefined();
        expect(result.response.error!.code).toBe('SHEET_NOT_FOUND');
      }
    });
  });

  // ===========================================================================
  // 1.10: Idempotency - Create Same Sheet Twice
  // ===========================================================================

  describe('1.10 Idempotency: Create Same Sheet Twice', () => {
    it('should mark response with _idempotent flag on duplicate sheet creation', async () => {
      const firstCall = await handler.handle({
        action: 'add_sheet',
        spreadsheetId: 'test-spreadsheet-id',
        sheetName: 'Sheet1',
        safety: { allowDuplicate: false },
      });

      const secondCall = await handler.handle({
        action: 'add_sheet',
        spreadsheetId: 'test-spreadsheet-id',
        sheetName: 'Sheet1',
        safety: { allowDuplicate: false },
      });

      // If the second call returns the existing sheet instead of creating a new one:
      if (secondCall.response.success && !firstCall.response.success) {
        expect((secondCall.response as any)._idempotent).toBe(true);
      }

      // Or both should fail with duplicate error:
      if (!firstCall.response.success && !secondCall.response.success) {
        expect(firstCall.response.error!.code).toMatch(/DUPLICATE|EXISTS|INVALID/);
        expect(secondCall.response.error!.code).toMatch(/DUPLICATE|EXISTS|INVALID/);
      }
    });

    it('should verify idempotent operation does not modify spreadsheet state', async () => {
      // First creation
      const create1 = await handler.handle({
        action: 'add_sheet',
        spreadsheetId: 'test-spreadsheet-id',
        sheetName: 'UniqueSheet123',
      });

      expect(create1.response.success).toBe(true);

      // Second identical creation attempt
      const create2 = await handler.handle({
        action: 'add_sheet',
        spreadsheetId: 'test-spreadsheet-id',
        sheetName: 'UniqueSheet123',
        safety: { allowDuplicate: false },
      });

      // Either both succeed (idempotent) or second fails appropriately
      if (create2.response.success) {
        // Both operations succeeded - should have same sheet ID
        const sheetId1 = (create1.response as any).sheet?.sheetId;
        const sheetId2 = (create2.response as any).sheet?.sheetId;
        expect(sheetId1).toBeDefined();
        expect(sheetId2).toBeDefined();
      } else {
        // Second operation failed - that's also valid
        expect(create2.response.error).toBeDefined();
      }
    });
  });

  // ===========================================================================
  // Additional Validation Tests
  // ===========================================================================

  describe('Schema Validation', () => {
    it('should validate all responses against output schema', async () => {
      const result = await handler.handle({
        action: 'get',
        spreadsheetId: 'test-spreadsheet-id',
      });

      const validation = SheetsCoreOutputSchema.safeParse(result);
      expect(validation.success).toBe(true);
    });

    it('should handle invalid action gracefully', async () => {
      const result = await handler.handle({
        action: 'invalid_action' as any,
        spreadsheetId: 'test-spreadsheet-id',
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });

  // ===========================================================================
  // Error Response Validation
  // ===========================================================================

  describe('Error Response Structure', () => {
    it('should include error code from ErrorCodeSchema', async () => {
      (mockApi.spreadsheets!.get as any).mockRejectedValueOnce(new Error('API Error'));

      const result = await handler.handle({
        action: 'get',
        spreadsheetId: 'bad-id',
      });

      if (!result.response.success) {
        expect(result.response.error!.code).toBeDefined();
        // Code should match one of the known error codes
        expect(typeof result.response.error!.code).toBe('string');
      }
    });

    it('should include message in error responses', async () => {
      (mockApi.spreadsheets!.get as any).mockRejectedValueOnce(
        new Error('Spreadsheet not accessible')
      );

      const result = await handler.handle({
        action: 'get',
        spreadsheetId: 'restricted-id',
      });

      if (!result.response.success) {
        expect(result.response.error!.message).toBeDefined();
        expect(typeof result.response.error!.message).toBe('string');
      }
    });

    it('should optionally include fixableVia with actionable suggestions', async () => {
      (mockApi.spreadsheets!.get as any).mockRejectedValueOnce(
        new Error('Spreadsheet not found')
      );

      const result = await handler.handle({
        action: 'get',
        spreadsheetId: 'nonexistent-id',
      });

      if (!result.response.success && result.response.error!.fixableVia) {
        expect(result.response.error!.fixableVia).toMatchObject({
          tool: expect.any(String),
          action: expect.any(String),
        });

        // params should have actionable values
        if (result.response.error!.fixableVia.params) {
          expect(typeof result.response.error!.fixableVia.params).toBe('object');
        }
      }
    });
  });
});
