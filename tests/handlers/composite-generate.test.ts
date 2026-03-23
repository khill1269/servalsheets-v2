/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-console */
/**
 * ServalSheets - F1 Natural Language Sheet Generator Tests
 *
 * Tests for generate_sheet, generate_template, preview_generation actions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompositeHandler } from '../../src/handlers/composite.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4 } from 'googleapis';

// ---------------------------------------------------------------------------
// Mock sheet-generator (module-level mock)
// ---------------------------------------------------------------------------

const mockGenerateDefinition = vi.fn();
const mockExecuteDefinition = vi.fn();
const requestContextState = vi.hoisted(() => ({
  abortSignal: undefined as AbortSignal | undefined,
}));

vi.mock('../../src/services/sheet-generator.js', () => ({
  generateDefinition: (...args: any[]) => mockGenerateDefinition(...args),
  executeDefinition: (...args: any[]) => mockExecuteDefinition(...args),
}));

// Mock composite-operations to prevent real initialization
vi.mock('../../src/services/composite-operations.js', () => {
  const MockService = vi.fn().mockImplementation(function (this: any) {
    return this;
  });
  return { CompositeOperationsService: MockService };
});

// Mock sheet-resolver
vi.mock('../../src/services/sheet-resolver.js', () => ({
  SheetResolver: vi.fn(),
  initializeSheetResolver: vi.fn().mockReturnValue({}),
}));

// Mock request-context
vi.mock('../../src/utils/request-context.js', () => ({
  getRequestLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  sendProgress: vi.fn().mockResolvedValue(undefined),
  getRequestAbortSignal: () => requestContextState.abortSignal,
}));

// Mock elicitation
vi.mock('../../src/mcp/elicitation.js', () => ({
  confirmDestructiveAction: vi.fn().mockResolvedValue(undefined),
}));

// Mock safety-helpers
vi.mock('../../src/utils/safety-helpers.js', () => ({
  createSnapshotIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

// Mock streaming-export
vi.mock('../../src/utils/streaming-export.js', () => ({
  readDataInChunks: vi.fn(),
  formatBytes: vi.fn((n: number) => `${n} bytes`),
}));

// Mock incremental scope
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

// Mock env
vi.mock('../../src/config/env.js', () => ({
  getEnv: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_DEFINITION = {
  title: 'Q1 Budget Tracker',
  sheets: [
    {
      name: 'Budget',
      columns: [
        { header: 'Category', type: 'text' as const, width: 180 },
        { header: 'Jan', type: 'currency' as const, width: 120 },
        { header: 'Feb', type: 'currency' as const, width: 120 },
        { header: 'Q1 Total', type: 'formula' as const, width: 130, formula: '=SUM(B{row}:C{row})' },
      ],
      rows: [
        { values: ['Revenue', 50000, 55000, null] },
        { values: ['COGS', 20000, 22000, null] },
      ],
      formatting: {
        headerStyle: 'bold_blue_background',
        numberFormat: '$#,##0',
        freezeRows: 1,
        freezeColumns: 0,
        alternatingRows: true,
      },
    },
  ],
};

const EXECUTION_RESULT = {
  spreadsheetId: 'new-spreadsheet-id',
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-spreadsheet-id/edit',
  title: 'Q1 Budget Tracker',
  sheetsCreated: 1,
  columnsCreated: 4,
  rowsCreated: 2,
  formulasApplied: 2,
  formattingApplied: true,
  definition: SAMPLE_DEFINITION,
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
        clear: vi.fn(),
        batchGet: vi.fn(),
        batchUpdate: vi.fn(),
        batchClear: vi.fn(),
      },
      batchUpdate: vi.fn(),
    },
  }) as any;

const createMockContext = (): HandlerContext =>
  ({
    spreadsheetId: 'test-spreadsheet-id',
    userId: 'test-user-id',
    cachedApi: {} as any,
    googleClient: {} as any,
    samplingServer: { createMessage: vi.fn() },
    elicitationServer: undefined,
    backend: undefined,
    auth: { hasElevatedAccess: false, scopes: ['https://www.googleapis.com/auth/spreadsheets'] },
  }) as any;

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------

describe('CompositeHandler (F1 Sheet Generator)', () => {
  let handler: CompositeHandler;
  let mockContext: HandlerContext;
  let mockSheetsApi: sheets_v4.Sheets;

  beforeEach(() => {
    vi.clearAllMocks();
    requestContextState.abortSignal = undefined;
    mockContext = createMockContext();
    mockSheetsApi = createMockSheetsApi();
    handler = new CompositeHandler(mockContext, mockSheetsApi);

    // Default mock implementations
    mockGenerateDefinition.mockResolvedValue(SAMPLE_DEFINITION);
    mockExecuteDefinition.mockResolvedValue(EXECUTION_RESULT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // generate_sheet
  // =========================================================================

  describe('generate_sheet', () => {
    it('should respect request-scoped cancellation before generation starts', async () => {
      const abortController = new AbortController();
      abortController.abort('cancelled in test');
      requestContextState.abortSignal = abortController.signal;

      const result = await handler.handle({
        request: {
          action: 'generate_sheet',
          description: 'Cancelled sheet generation',
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('OPERATION_CANCELLED');
      expect(mockGenerateDefinition).not.toHaveBeenCalled();
      expect(mockExecuteDefinition).not.toHaveBeenCalled();
    });

    it('should generate and execute a spreadsheet from description', async () => {
      const result = await handler.handle({
        request: {
          action: 'generate_sheet',
          description: 'Create a Q1 budget tracker with revenue and expenses',
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('generate_sheet');
      expect(response.spreadsheetId).toBe('new-spreadsheet-id');
      expect(response.sheetsCreated).toBe(1);
      expect(response.columnsCreated).toBe(4);
      expect(response.formulasApplied).toBe(2);
      expect(response.formattingApplied).toBe(true);

      // Verify generateDefinition was called with correct args
      expect(mockGenerateDefinition).toHaveBeenCalledWith(
        'Create a Q1 budget tracker with revenue and expenses',
        expect.objectContaining({ context: undefined, style: undefined }),
        mockContext.samplingServer
      );

      // Verify executeDefinition was called
      expect(mockExecuteDefinition).toHaveBeenCalledWith(
        expect.any(Object), // handler wraps sheetsApi via ensureRetriableGoogleApi
        SAMPLE_DEFINITION,
        undefined
      );
    });

    it('should pass style and context options through', async () => {
      const result = await handler.handle({
        request: {
          action: 'generate_sheet',
          description: 'Sales dashboard',
          style: 'dashboard',
          context: 'For the executive team',
        },
      } as any);

      expect(mockGenerateDefinition).toHaveBeenCalledWith(
        'Sales dashboard',
        expect.objectContaining({
          style: 'dashboard',
          context: 'For the executive team',
        }),
        mockContext.samplingServer
      );

      const response = result.response as any;
      expect(response.success).toBe(true);
    });

    it('should support dry-run mode without executing', async () => {
      const result = await handler.handle({
        request: {
          action: 'generate_sheet',
          description: 'Test sheet',
          safety: { dryRun: true },
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('generate_sheet');
      expect(response.spreadsheetId).toBe('');
      expect(response.sheetsCreated).toBe(1);
      expect(response.rowsCreated).toBe(0);

      // Should NOT call executeDefinition in dry-run
      expect(mockExecuteDefinition).not.toHaveBeenCalled();
    });

    it('should use existing spreadsheetId when provided', async () => {
      await handler.handle({
        request: {
          action: 'generate_sheet',
          description: 'Add sheet to existing',
          spreadsheetId: 'existing-sheet-123',
        },
      } as any);

      expect(mockGenerateDefinition).toHaveBeenCalledWith(
        'Add sheet to existing',
        expect.objectContaining({ spreadsheetId: 'existing-sheet-123' }),
        mockContext.samplingServer
      );

      expect(mockExecuteDefinition).toHaveBeenCalledWith(
        expect.any(Object), // handler wraps sheetsApi via ensureRetriableGoogleApi
        SAMPLE_DEFINITION,
        'existing-sheet-123'
      );
    });

    it('should handle generation failure gracefully', async () => {
      mockGenerateDefinition.mockRejectedValue(new Error('Sampling failed'));

      const result = await handler.handle({
        request: {
          action: 'generate_sheet',
          description: 'Test sheet',
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });
  });

  // =========================================================================
  // generate_template
  // =========================================================================

  describe('generate_template', () => {
    it('should generate a template definition', async () => {
      const result = await handler.handle({
        request: {
          action: 'generate_template',
          description: 'Monthly expense report',
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('generate_template');
      expect(response.templateId).toBeDefined();
      expect(response.templateId).toMatch(/^tpl_/);
      expect(response.name).toBe('Q1 Budget Tracker');
      expect(response.sheetsCount).toBe(1);
      expect(response.columnsCount).toBe(4);
      expect(response.definition).toEqual(SAMPLE_DEFINITION);
    });

    it('should parameterize text columns when requested', async () => {
      const result = await handler.handle({
        request: {
          action: 'generate_template',
          description: 'Invoice template',
          parameterize: true,
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.parameters).toBeDefined();
      expect(Array.isArray(response.parameters)).toBe(true);
      // The only text column is "Category" → parameterized as "{{category}}"
      expect(response.parameters).toContain('category');
    });

    it('should not include parameters when parameterize is false', async () => {
      const result = await handler.handle({
        request: {
          action: 'generate_template',
          description: 'Simple template',
          parameterize: false,
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.parameters).toBeUndefined();
    });
  });

  // =========================================================================
  // preview_generation
  // =========================================================================

  describe('preview_generation', () => {
    it('should return preview without creating anything', async () => {
      const result = await handler.handle({
        request: {
          action: 'preview_generation',
          description: 'Budget tracker preview',
        },
      } as any);

      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('preview_generation');
      expect(response.definition).toEqual(SAMPLE_DEFINITION);
      expect(response.estimatedCells).toBeGreaterThan(0);
      expect(response.estimatedFormulas).toBeGreaterThan(0);
      expect(Array.isArray(response.formattingPreview)).toBe(true);
      expect(response.formattingPreview.length).toBeGreaterThan(0);

      // Should NOT call executeDefinition
      expect(mockExecuteDefinition).not.toHaveBeenCalled();
    });

    it('should estimate cells correctly', async () => {
      const result = await handler.handle({
        request: {
          action: 'preview_generation',
          description: 'Test preview',
        },
      } as any);

      const response = result.response as any;
      // 4 columns × max(2 rows, 10) = 4 × 10 = 40 estimated cells
      expect(response.estimatedCells).toBe(40);
      // 1 formula column × 10 = 10 estimated formulas
      expect(response.estimatedFormulas).toBe(10);
    });

    it('should include formatting preview details', async () => {
      const result = await handler.handle({
        request: {
          action: 'preview_generation',
          description: 'Test formatting preview',
        },
      } as any);

      const response = result.response as any;
      const preview = response.formattingPreview as string[];
      // Should mention header style, freeze rows, alternating rows, and currency columns
      expect(preview.some((p: string) => p.includes('Header style'))).toBe(true);
      expect(preview.some((p: string) => p.includes('Freeze'))).toBe(true);
      expect(preview.some((p: string) => p.includes('Alternating'))).toBe(true);
      expect(preview.some((p: string) => p.includes('currency'))).toBe(true);
    });

    it('should pass style and context to generation', async () => {
      await handler.handle({
        request: {
          action: 'preview_generation',
          description: 'Dashboard preview',
          style: 'professional',
          context: 'For stakeholders',
        },
      } as any);

      expect(mockGenerateDefinition).toHaveBeenCalledWith(
        'Dashboard preview',
        expect.objectContaining({
          style: 'professional',
          context: 'For stakeholders',
        }),
        mockContext.samplingServer
      );
    });
  });
});
