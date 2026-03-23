/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ServalSheets - P14-C1 Composite Workflow Actions Tests
 *
 * Tests for audit_sheet, publish_report, data_pipeline, instantiate_template,
 * migrate_spreadsheet actions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompositeHandler } from '../../src/handlers/composite.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4 } from 'googleapis';

// ---------------------------------------------------------------------------
// Module mocks (must be before any imports that use them)
// ---------------------------------------------------------------------------

vi.mock('../../src/services/sheet-generator.js', () => ({
  generateDefinition: vi.fn(),
  executeDefinition: vi.fn(),
}));

vi.mock('../../src/services/composite-operations.js', () => {
  const MockService = vi.fn().mockImplementation(function (this: any) {
    return this;
  });
  return { CompositeOperationsService: MockService };
});

vi.mock('../../src/services/sheet-resolver.js', () => ({
  SheetResolver: vi.fn(),
  initializeSheetResolver: vi.fn().mockReturnValue({}),
}));

vi.mock('../../src/utils/request-context.js', () => ({
  getRequestLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  getRequestContext: vi.fn().mockReturnValue(undefined),
  getRequestAbortSignal: vi.fn().mockReturnValue(undefined),
  sendProgress: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/mcp/elicitation.js', () => ({
  confirmDestructiveAction: vi.fn().mockResolvedValue({ confirmed: true }),
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
    IncrementalScopeRequiredError: class extends Error {},
  };
});

vi.mock('../../src/config/env.js', () => ({
  getEnv: vi.fn().mockReturnValue({ ENABLE_GRANULAR_PROGRESS: false }),
}));

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
        clear: vi.fn(),
        batchGet: vi.fn(),
        batchUpdate: vi.fn(),
        batchClear: vi.fn(),
      },
      batchUpdate: vi.fn(),
      sheets: {
        copyTo: vi.fn(),
      },
    },
  }) as any;

const createMockDriveApi = () =>
  ({
    files: {
      get: vi.fn(),
      export: vi.fn(),
      create: vi.fn(),
    },
  }) as any;

const createMockContext = (): HandlerContext =>
  ({
    spreadsheetId: 'test-spreadsheet-id',
    userId: 'test-user-id',
    cachedApi: {} as any,
    googleClient: {} as any,
    samplingServer: undefined,
    elicitationServer: undefined,
    backend: undefined,
    auth: { hasElevatedAccess: false, scopes: ['https://www.googleapis.com/auth/spreadsheets'] },
    sheetResolver: { invalidate: vi.fn() },
  }) as any;

// ---------------------------------------------------------------------------
// Helper: build standard Sheets API grid data response
// ---------------------------------------------------------------------------

const makeValuesResponse = (values: any[][]) => ({
  data: { values },
});

const makeSpreadsheetResponse = (sheets: Array<{ title: string; sheetId: number }>) => ({
  data: {
    sheets: sheets.map((s) => ({
      properties: { title: s.title, sheetId: s.sheetId },
      data: [],
    })),
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CompositeHandler (P14-C1 Workflow Actions)', () => {
  let handler: CompositeHandler;
  let mockContext: HandlerContext;
  let mockSheetsApi: sheets_v4.Sheets;
  let mockDriveApi: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = createMockContext();
    mockSheetsApi = createMockSheetsApi();
    mockDriveApi = createMockDriveApi();
    handler = new CompositeHandler(mockContext, mockSheetsApi, mockDriveApi);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // audit_sheet
  // =========================================================================

  describe('audit_sheet', () => {
    it('should return a structured audit of a spreadsheet', async () => {
      // Mock spreadsheets.get for sheet listing
      (mockSheetsApi.spreadsheets.get as any).mockResolvedValue(
        makeSpreadsheetResponse([{ title: 'Sheet1', sheetId: 0 }])
      );

      // Mock values.get for reading the sheet
      (mockSheetsApi.spreadsheets.values.get as any).mockResolvedValue(
        makeValuesResponse([
          ['Name', 'Revenue', 'Cost'],
          ['Alpha', 100, 50],
          ['Beta', '=A2*2', 80],
          ['Gamma', '', ''],
        ])
      );

      const result = await handler.handle({
        request: {
          action: 'audit_sheet',
          spreadsheetId: 'test-id',
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('audit_sheet');
      expect(response.audit).toBeDefined();
      expect(typeof response.audit.totalCells).toBe('number');
      expect(typeof response.audit.formulaCells).toBe('number');
      expect(typeof response.audit.blankCells).toBe('number');
      expect(typeof response.audit.dataCells).toBe('number');
      expect(typeof response.audit.sheetsAudited).toBe('number');
      expect(Array.isArray(response.audit.issues)).toBe(true);
    });

    it('should count formula cells correctly', async () => {
      (mockSheetsApi.spreadsheets.get as any).mockResolvedValue(
        makeSpreadsheetResponse([{ title: 'Sheet1', sheetId: 0 }])
      );

      (mockSheetsApi.spreadsheets.values.get as any).mockResolvedValue(
        makeValuesResponse([
          ['Header1', 'Header2', 'Header3'],
          ['data', '=B1+1', '=C1*2'],
          ['more', 'plain', '=SUM(A1:A2)'],
        ])
      );

      const result = await handler.handle({
        request: {
          action: 'audit_sheet',
          spreadsheetId: 'test-id',
          includeFormulas: true,
          includeStats: true,
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      // 3 formula cells out of 9 total
      expect(response.audit.formulaCells).toBe(3);
      expect(response.audit.totalCells).toBe(9);
    });

    it('should detect empty headers as an issue', async () => {
      (mockSheetsApi.spreadsheets.get as any).mockResolvedValue(
        makeSpreadsheetResponse([{ title: 'Sheet1', sheetId: 0 }])
      );

      (mockSheetsApi.spreadsheets.values.get as any).mockResolvedValue(
        makeValuesResponse([
          ['Name', '', 'Revenue'],
          ['Alpha', 100, 200],
        ])
      );

      const result = await handler.handle({
        request: {
          action: 'audit_sheet',
          spreadsheetId: 'test-id',
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      const issues = response.audit.issues as Array<{ type: string; location: string; message: string }>;
      expect(issues.some((i) => i.type === 'empty_header')).toBe(true);
    });

    it('should handle API failure gracefully', async () => {
      (mockSheetsApi.spreadsheets.get as any).mockRejectedValue(new Error('API error'));

      const result = await handler.handle({
        request: {
          action: 'audit_sheet',
          spreadsheetId: 'test-id',
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });
  });

  // =========================================================================
  // publish_report
  // =========================================================================

  describe('publish_report', () => {
    it('should export as CSV and return report metadata', async () => {
      (mockSheetsApi.spreadsheets.values.get as any).mockResolvedValue(
        makeValuesResponse([
          ['Name', 'Revenue'],
          ['Alpha', 1000],
          ['Beta', 2000],
        ])
      );

      const result = await handler.handle({
        request: {
          action: 'publish_report',
          spreadsheetId: 'test-id',
          format: 'csv',
          title: 'Q1 Report',
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('publish_report');
      expect(response.report).toBeDefined();
      expect(response.report.format).toBe('csv');
      expect(response.report.title).toBe('Q1 Report');
      expect(response.report.generatedAt).toBeDefined();
      expect(typeof response.report.content).toBe('string');
      expect(response.report.content).toContain('Name');
      expect(response.report.content).toContain('Alpha');
    });

    it('should export as XLSX using Drive API', async () => {
      const pdfBuffer = Buffer.from('fake-xlsx-data');
      mockDriveApi.files.get.mockResolvedValue({ data: { name: 'My Sheet' } });
      mockDriveApi.files.export.mockResolvedValue({ data: pdfBuffer.buffer });

      const result = await handler.handle({
        request: {
          action: 'publish_report',
          spreadsheetId: 'test-id',
          format: 'xlsx',
          title: 'Annual Report',
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.report.format).toBe('xlsx');
      expect(response.report.title).toBe('Annual Report');
    });

    it('should export as PDF using Drive API', async () => {
      const pdfBuffer = Buffer.from('fake-pdf-data');
      mockDriveApi.files.export.mockResolvedValue({ data: pdfBuffer.buffer });

      const result = await handler.handle({
        request: {
          action: 'publish_report',
          spreadsheetId: 'test-id',
          format: 'pdf',
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.report.format).toBe('pdf');
      expect(typeof response.report.content).toBe('string'); // base64
    });

    it('should handle missing range gracefully (use full spreadsheet)', async () => {
      (mockSheetsApi.spreadsheets.values.get as any).mockResolvedValue(
        makeValuesResponse([['A', 'B'], [1, 2]])
      );

      const result = await handler.handle({
        request: {
          action: 'publish_report',
          spreadsheetId: 'test-id',
          format: 'csv',
          // no range specified
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.report.format).toBe('csv');
    });
  });

  // =========================================================================
  // data_pipeline
  // =========================================================================

  describe('data_pipeline', () => {
    const sourceData = [
      ['Name', 'Revenue', 'Region'],
      ['Alpha', 1000, 'East'],
      ['Beta', 2000, 'West'],
      ['Gamma', 500, 'East'],
      ['Delta', 3000, 'West'],
      ['Alpha', 1500, 'East'], // duplicate Name
    ];

    beforeEach(() => {
      (mockSheetsApi.spreadsheets.values.get as any).mockResolvedValue(
        makeValuesResponse(sourceData)
      );
      (mockSheetsApi.spreadsheets.values.update as any).mockResolvedValue({});
    });

    it('should execute a filter step', async () => {
      const result = await handler.handle({
        request: {
          action: 'data_pipeline',
          spreadsheetId: 'test-id',
          sourceRange: { a1: 'Sheet1!A1:C6' },
          steps: [
            { type: 'filter', config: { column: 'Region', value: 'East' } },
          ],
          dryRun: true,
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('data_pipeline');
      expect(response.pipeline).toBeDefined();
      expect(response.pipeline.stepsExecuted).toBe(1);
      // Source has 5 data rows (excluding header), 3 are East
      expect(response.pipeline.rowsOut).toBe(3);
    });

    it('should execute a sort step', async () => {
      const result = await handler.handle({
        request: {
          action: 'data_pipeline',
          spreadsheetId: 'test-id',
          sourceRange: { a1: 'Sheet1!A1:C6' },
          steps: [
            { type: 'sort', config: { column: 'Revenue', order: 'desc' } },
          ],
          dryRun: true,
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.pipeline.stepsExecuted).toBe(1);
      expect(response.pipeline.rowsOut).toBe(5); // all rows preserved
    });

    it('should execute a deduplicate step', async () => {
      const result = await handler.handle({
        request: {
          action: 'data_pipeline',
          spreadsheetId: 'test-id',
          sourceRange: { a1: 'Sheet1!A1:C6' },
          steps: [
            { type: 'deduplicate', config: { columns: ['Name'] } },
          ],
          dryRun: true,
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.pipeline.stepsExecuted).toBe(1);
      // 5 rows, "Alpha" appears twice → 4 unique
      expect(response.pipeline.rowsOut).toBe(4);
    });

    it('should include preview of first 5 rows', async () => {
      const result = await handler.handle({
        request: {
          action: 'data_pipeline',
          spreadsheetId: 'test-id',
          sourceRange: { a1: 'Sheet1!A1:C6' },
          steps: [],
          dryRun: true,
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(Array.isArray(response.pipeline.preview)).toBe(true);
      expect(response.pipeline.preview.length).toBeLessThanOrEqual(5);
    });

    it('should write output when outputRange provided and not dryRun', async () => {
      const result = await handler.handle({
        request: {
          action: 'data_pipeline',
          spreadsheetId: 'test-id',
          sourceRange: { a1: 'Sheet1!A1:C6' },
          outputRange: { a1: 'Output!A1' },
          steps: [
            { type: 'filter', config: { column: 'Region', value: 'West' } },
          ],
          dryRun: false,
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      // Should have called values.update to write results
      expect(mockSheetsApi.spreadsheets.values.update).toHaveBeenCalled();
    });

    it('should handle API failure gracefully', async () => {
      (mockSheetsApi.spreadsheets.values.get as any).mockRejectedValue(new Error('Read failed'));

      const result = await handler.handle({
        request: {
          action: 'data_pipeline',
          spreadsheetId: 'test-id',
          sourceRange: { a1: 'Sheet1!A1:C6' },
          steps: [],
          dryRun: true,
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });
  });

  // =========================================================================
  // instantiate_template
  // =========================================================================

  describe('instantiate_template', () => {
    const templateSpreadsheetId = 'template-spreadsheet-id';

    beforeEach(() => {
      // Mock getting template metadata (from Drive / appDataFolder)
      // In practice this would load from templates service, but for handler
      // tests we mock the sheetsApi calls it makes
      (mockSheetsApi.spreadsheets.get as any).mockResolvedValue({
        data: {
          sheets: [
            {
              properties: { title: 'Sheet1', sheetId: 0 },
              data: [],
            },
          ],
        },
      });

      (mockSheetsApi.spreadsheets.values.get as any).mockResolvedValue(
        makeValuesResponse([
          ['Company: {{companyName}}', 'Year: {{year}}'],
          ['Revenue', '{{revenueTarget}}'],
          ['plain value', 'another plain value'],
        ])
      );

      (mockSheetsApi.spreadsheets.values.update as any).mockResolvedValue({});

      (mockSheetsApi.spreadsheets.create as any).mockResolvedValue({
        data: {
          spreadsheetId: 'new-instance-id',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-instance-id/edit',
          sheets: [{ properties: { title: 'Sheet1', sheetId: 0 } }],
        },
      });
    });

    it('should substitute variables in template cells', async () => {
      const result = await handler.handle({
        request: {
          action: 'instantiate_template',
          templateId: templateSpreadsheetId,
          variables: {
            companyName: 'Acme Corp',
            year: '2026',
            revenueTarget: '1000000',
          },
          targetSpreadsheetId: 'target-id',
          targetSheetName: 'Sheet1',
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('instantiate_template');
      expect(response.instantiation).toBeDefined();
      expect(response.instantiation.substitutionsApplied).toBeGreaterThan(0);
      expect(response.instantiation.cellsUpdated).toBeGreaterThan(0);
      // values.update should have been called to write substituted data
      expect(mockSheetsApi.spreadsheets.values.update).toHaveBeenCalled();
    });

    it('should create a new spreadsheet when no targetSpreadsheetId given', async () => {
      const result = await handler.handle({
        request: {
          action: 'instantiate_template',
          templateId: templateSpreadsheetId,
          variables: { companyName: 'Beta Inc' },
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.instantiation.spreadsheetId).toBeDefined();
    });

    it('should handle API failure gracefully', async () => {
      (mockSheetsApi.spreadsheets.values.get as any).mockRejectedValue(new Error('Load failed'));

      const result = await handler.handle({
        request: {
          action: 'instantiate_template',
          templateId: 'bad-template-id',
          variables: { name: 'test' },
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });
  });

  // =========================================================================
  // migrate_spreadsheet
  // =========================================================================

  describe('migrate_spreadsheet', () => {
    const sourceData = [
      ['FirstName', 'LastName', 'Email', 'Revenue'],
      ['Alice', 'Smith', 'alice@example.com', 1000],
      ['Bob', 'Jones', 'BOB@EXAMPLE.COM', 2000],
      ['Carol', 'White', 'carol@example.com', 3000],
    ];

    beforeEach(() => {
      (mockSheetsApi.spreadsheets.values.get as any).mockResolvedValue(
        makeValuesResponse(sourceData)
      );
      (mockSheetsApi.spreadsheets.values.update as any).mockResolvedValue({});
      (mockSheetsApi.spreadsheets.values.append as any).mockResolvedValue({});
    });

    it('should migrate data with column mapping', async () => {
      const result = await handler.handle({
        request: {
          action: 'migrate_spreadsheet',
          sourceSpreadsheetId: 'source-id',
          sourceRange: { a1: 'Sheet1!A1:D4' },
          destinationSpreadsheetId: 'dest-id',
          destinationRange: { a1: 'Dest!A1' },
          columnMapping: [
            { sourceColumn: 'FirstName', destinationColumn: 'first_name', transform: 'none' },
            { sourceColumn: 'Email', destinationColumn: 'email', transform: 'lowercase' },
            { sourceColumn: 'Revenue', destinationColumn: 'amount', transform: 'number' },
          ],
          dryRun: true,
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('migrate_spreadsheet');
      expect(response.migration).toBeDefined();
      expect(response.migration.rowsMigrated).toBe(3); // 3 data rows
      expect(response.migration.columnsMapped).toBe(3);
      expect(Array.isArray(response.migration.preview)).toBe(true);
    });

    it('should apply lowercase transform', async () => {
      const result = await handler.handle({
        request: {
          action: 'migrate_spreadsheet',
          sourceSpreadsheetId: 'source-id',
          sourceRange: { a1: 'Sheet1!A1:D4' },
          destinationSpreadsheetId: 'dest-id',
          destinationRange: { a1: 'Dest!A1' },
          columnMapping: [
            { sourceColumn: 'Email', destinationColumn: 'email', transform: 'lowercase' },
          ],
          dryRun: true,
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      // BOB@EXAMPLE.COM should be lowercased in preview
      const preview = response.migration.preview as any[][];
      const emailIdx = 0; // only mapped column
      const bobRow = preview.find((r) => String(r[emailIdx]).includes('bob'));
      expect(bobRow).toBeDefined();
      expect(String(bobRow![emailIdx])).toBe('bob@example.com');
    });

    it('should write to destination when not dryRun (append mode)', async () => {
      const result = await handler.handle({
        request: {
          action: 'migrate_spreadsheet',
          sourceSpreadsheetId: 'source-id',
          sourceRange: { a1: 'Sheet1!A1:D4' },
          destinationSpreadsheetId: 'dest-id',
          destinationRange: { a1: 'Dest!A1' },
          columnMapping: [
            { sourceColumn: 'FirstName', destinationColumn: 'name', transform: 'none' },
          ],
          appendMode: true,
          dryRun: false,
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.migration.rowsMigrated).toBeGreaterThan(0);
      // Should have called values.append or values.update
      const writeCalled =
        (mockSheetsApi.spreadsheets.values.append as any).mock.calls.length > 0 ||
        (mockSheetsApi.spreadsheets.values.update as any).mock.calls.length > 0;
      expect(writeCalled).toBe(true);
    });

    it('should handle API failure gracefully', async () => {
      (mockSheetsApi.spreadsheets.values.get as any).mockRejectedValue(new Error('Source read failed'));

      const result = await handler.handle({
        request: {
          action: 'migrate_spreadsheet',
          sourceSpreadsheetId: 'source-id',
          sourceRange: { a1: 'Sheet1!A1:D4' },
          destinationSpreadsheetId: 'dest-id',
          destinationRange: { a1: 'Dest!A1' },
          columnMapping: [
            { sourceColumn: 'FirstName', destinationColumn: 'name', transform: 'none' },
          ],
          dryRun: true,
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });
  });
});
