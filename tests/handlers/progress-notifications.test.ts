/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ServalSheets - Progress Notification Tests
 *
 * Verifies that sendProgress is called at the correct points
 * during import_csv and that the ENABLE_GRANULAR_PROGRESS flag
 * controls whether notifications are emitted.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock references — must be declared before vi.mock() calls
// ---------------------------------------------------------------------------

const mockImportCsv = vi.hoisted(() => vi.fn());
const mockSendProgress = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetEnv = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/services/composite-operations.js', () => {
  const MockService = vi.fn().mockImplementation(function (this: any) {
    this.importCsv = mockImportCsv;
    return this;
  });
  return { CompositeOperationsService: MockService };
});

vi.mock('../../src/utils/request-context.js', () => ({
  getRequestLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  getRequestContext: vi.fn().mockReturnValue(undefined),
  getRequestAbortSignal: vi.fn().mockReturnValue(undefined),
  sendProgress: mockSendProgress,
}));

vi.mock('../../src/config/env.js', () => ({
  getEnv: mockGetEnv,
}));

vi.mock('../../src/services/sheet-generator.js', () => ({
  generateDefinition: vi.fn(),
  executeDefinition: vi.fn(),
}));

vi.mock('../../src/services/sheet-resolver.js', () => ({
  SheetResolver: vi.fn(),
  initializeSheetResolver: vi.fn().mockReturnValue({ invalidate: vi.fn() }),
}));

vi.mock('../../src/mcp/elicitation.js', () => ({
  confirmDestructiveAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/safety-helpers.js', () => ({
  createSnapshotIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/streaming-export.js', () => ({
  readDataInChunks: vi.fn(),
  formatBytes: vi.fn((n: number) => `${n} bytes`),
}));

vi.mock('../../src/security/incremental-scope.js', () => {
  const MockScopeValidator = vi.fn().mockImplementation(function (this: any) {
    this.requireScope = vi.fn();
    this.hasScope = vi.fn().mockReturnValue(true);
    this.validateOperation = vi.fn();
    return this;
  });
  return {
    ScopeValidator: MockScopeValidator,
    ScopeCategory: {},
    IncrementalScopeRequiredError: class extends Error {},
  };
});

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import after mocks are established
// ---------------------------------------------------------------------------

import { CompositeHandler } from '../../src/handlers/composite.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4 } from 'googleapis';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SPREADSHEET_ID = 'test-spreadsheet-id';

const CSV_IMPORT_RESULT = {
  rowsImported: 500,
  columnsImported: 8,
  range: 'Sheet1!A1:H501',
  sheetId: 0,
  sheetName: 'Sheet1',
  rowsSkipped: 0,
  newSheetCreated: false,
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const createMockSheetsApi = (): sheets_v4.Sheets =>
  ({
    spreadsheets: {
      get: vi.fn(),
      create: vi.fn(),
      values: {
        get: vi.fn(),
        update: vi.fn(),
        append: vi.fn(),
        batchGet: vi.fn(),
        batchUpdate: vi.fn(),
      },
      batchUpdate: vi.fn(),
    },
  }) as any;

const createMockContext = (): HandlerContext =>
  ({
    spreadsheetId: SPREADSHEET_ID,
    userId: 'test-user-id',
    cachedApi: {} as any,
    googleClient: {} as any,
    samplingServer: { createMessage: vi.fn() },
    elicitationServer: undefined,
    backend: undefined,
    batchCompiler: { compile: vi.fn(), execute: vi.fn(), executeAll: vi.fn() } as any,
    rangeResolver: {
      resolve: vi.fn().mockResolvedValue({
        a1Notation: 'Sheet1!A1:H501',
        sheetId: 0,
        sheetName: 'Sheet1',
      }),
      invalidate: vi.fn(),
    } as any,
    sheetResolver: { invalidate: vi.fn() } as any,
    auth: {
      hasElevatedAccess: false,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    },
  }) as any;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CompositeHandler — Progress Notifications', () => {
  let handler: CompositeHandler;
  let mockContext: HandlerContext;
  let mockSheetsApi: sheets_v4.Sheets;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = createMockContext();
    mockSheetsApi = createMockSheetsApi();
    mockImportCsv.mockResolvedValue(CSV_IMPORT_RESULT);
    handler = new CompositeHandler(mockContext, mockSheetsApi);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // import_csv with ENABLE_GRANULAR_PROGRESS = true
  // =========================================================================

  describe('import_csv with ENABLE_GRANULAR_PROGRESS enabled', () => {
    beforeEach(() => {
      mockGetEnv.mockReturnValue({ ENABLE_GRANULAR_PROGRESS: true });
    });

    it('should emit two progress events: start (0/2) and complete (2/2)', async () => {
      // Act
      await handler.handle({
        request: {
          action: 'import_csv',
          spreadsheetId: SPREADSHEET_ID,
          csvData: 'Name,Value\nAlice,1\nBob,2',
          hasHeader: true,
        },
      } as any);

      // Assert — exactly 2 sendProgress calls in order
      expect(mockSendProgress).toHaveBeenCalledTimes(2);

      const [firstCall, secondCall] = mockSendProgress.mock.calls;

      // First call: progress=0, total=2, message contains 'Starting'
      expect(firstCall[0]).toBe(0);
      expect(firstCall[1]).toBe(2);
      expect(firstCall[2]).toMatch(/starting/i);

      // Second call: progress=2, total=2, message contains row count
      expect(secondCall[0]).toBe(2);
      expect(secondCall[1]).toBe(2);
      expect(secondCall[2]).toContain('500');
    });

    it('should emit start progress before calling importCsv', async () => {
      // Arrange — track call order
      const callOrder: string[] = [];
      mockSendProgress.mockImplementation(async () => {
        callOrder.push('sendProgress');
      });
      mockImportCsv.mockImplementation(async () => {
        callOrder.push('importCsv');
        return CSV_IMPORT_RESULT;
      });

      // Act
      await handler.handle({
        request: {
          action: 'import_csv',
          spreadsheetId: SPREADSHEET_ID,
          csvData: 'col1\nval1',
        },
      } as any);

      // Assert — sendProgress(0) fires before importCsv
      expect(callOrder[0]).toBe('sendProgress');
      expect(callOrder[1]).toBe('importCsv');
      expect(callOrder[2]).toBe('sendProgress');
    });

    it('should emit completion progress after importCsv finishes', async () => {
      // Arrange — capture progress message content after import
      let capturedMessage = '';
      mockSendProgress.mockImplementation(async (_p: number, _t: number, msg?: string) => {
        if (msg && msg.includes('Imported')) capturedMessage = msg;
      });

      // Act
      await handler.handle({
        request: {
          action: 'import_csv',
          spreadsheetId: SPREADSHEET_ID,
          csvData: 'Name\nAlice',
        },
      } as any);

      // Assert — completion message includes the imported row count
      expect(capturedMessage).toContain('500');
    });

    it('should return success with correct import stats', async () => {
      // Act
      const result = await handler.handle({
        request: {
          action: 'import_csv',
          spreadsheetId: SPREADSHEET_ID,
          csvData: 'col\nval',
        },
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('import_csv');
      expect(response.rowsImported).toBe(500);
      expect(response.columnsImported).toBe(8);
    });
  });

  // =========================================================================
  // import_csv with ENABLE_GRANULAR_PROGRESS = false
  // =========================================================================

  describe('import_csv with ENABLE_GRANULAR_PROGRESS disabled', () => {
    beforeEach(() => {
      mockGetEnv.mockReturnValue({ ENABLE_GRANULAR_PROGRESS: false });
    });

    it('should not emit any progress events', async () => {
      // Act
      await handler.handle({
        request: {
          action: 'import_csv',
          spreadsheetId: SPREADSHEET_ID,
          csvData: 'col\nval',
        },
      } as any);

      // Assert — no sendProgress calls when flag is disabled
      expect(mockSendProgress).not.toHaveBeenCalled();
    });

    it('should still return correct import result without progress', async () => {
      // Act
      const result = await handler.handle({
        request: {
          action: 'import_csv',
          spreadsheetId: SPREADSHEET_ID,
          csvData: 'Name,Value\nAlice,100',
        },
      } as any);

      // Assert — functional result is unaffected by flag
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.rowsImported).toBe(500);
    });
  });

  // =========================================================================
  // import_csv error path
  // =========================================================================

  describe('import_csv error handling', () => {
    it('should return error response when importCsv service throws', async () => {
      // Arrange
      mockGetEnv.mockReturnValue({ ENABLE_GRANULAR_PROGRESS: false });
      mockImportCsv.mockRejectedValue(new Error('CSV parse error: invalid encoding'));

      // Act
      const result = await handler.handle({
        request: {
          action: 'import_csv',
          spreadsheetId: SPREADSHEET_ID,
          csvData: '\xFF\xFE invalid bytes',
        },
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should emit start progress but not completion progress on import failure', async () => {
      // Arrange — progress enabled; service throws after start notification
      mockGetEnv.mockReturnValue({ ENABLE_GRANULAR_PROGRESS: true });
      mockImportCsv.mockRejectedValue(new Error('Service unavailable'));

      // Act
      await handler.handle({
        request: {
          action: 'import_csv',
          spreadsheetId: SPREADSHEET_ID,
          csvData: 'col\nval',
        },
      } as any);

      // Assert — start progress was sent, but completion was not
      expect(mockSendProgress).toHaveBeenCalledTimes(1);
      expect(mockSendProgress.mock.calls[0][0]).toBe(0); // only the start call
    });
  });
});
