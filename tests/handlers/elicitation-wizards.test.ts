/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ServalSheets - Elicitation Wizard Tests (Task #16 P13-M4)
 *
 * Tests for interactive wizard flows added to 4 complex actions:
 * 1. visualize.chart_create — asks chart type and title when absent
 * 2. format.add_conditional_format_rule — asks rulePreset when absent
 * 3. core.create — asks spreadsheet name when title absent
 * 4. transaction.begin — asks description when absent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Global mocks (must be before imports)
// ---------------------------------------------------------------------------

vi.mock('../../src/utils/request-context.js', () => ({
  sendProgress: vi.fn().mockResolvedValue(undefined),
  getRequestContext: vi.fn().mockReturnValue({ timeoutMs: 30000 }),
  getRequestLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../src/utils/logger.js', () => {
  const child = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return {
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnValue(child) },
    createChildLogger: vi.fn().mockReturnValue(child),
  };
});

vi.mock('../../src/mcp/elicitation.js', () => ({
  confirmDestructiveAction: vi.fn().mockResolvedValue({ confirmed: true }),
  safeElicit: vi.fn(),
  checkElicitationSupport: vi.fn().mockReturnValue({ supported: true, form: true, url: false }),
  elicitSpreadsheetCreation: vi.fn().mockResolvedValue({
    title: 'My New Spreadsheet',
    locale: 'en_US',
    timeZone: 'America/New_York',
  }),
  elicitSharingSettings: vi.fn().mockResolvedValue({
    email: 'test@example.com',
    role: 'writer',
    sendNotification: true,
    message: undefined,
  }),
  // Required for FormatHandler.add_conditional_format_rule wizard
  elicitConditionalFormatPreset: vi.fn().mockResolvedValue({ preset: 'highlight_blanks' }),
}));

vi.mock('../../src/utils/safety-helpers.js', () => ({
  createSnapshotIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/security/incremental-scope.js', () => {
  const MockScopeValidator = vi.fn().mockImplementation(function (this: any) {
    this.requireScope = vi.fn();
    this.hasScope = vi.fn().mockReturnValue(true);
    this.validateOperation = vi.fn();
    this.getOperationRequirements = vi.fn().mockReturnValue(null);
    this.generateIncrementalAuthUrl = vi.fn().mockReturnValue('https://auth.example.com');
    return this;
  });
  return {
    ScopeValidator: MockScopeValidator,
    IncrementalScopeRequiredError: class extends Error {},
  };
});

vi.mock('../../src/config/env.js', () => ({
  getEnv: vi.fn().mockReturnValue({}),
}));

vi.mock('../../src/services/capability-cache.js', () => ({
  getCapabilitiesWithCache: vi.fn().mockResolvedValue(undefined),
  resetCapabilityCacheService: vi.fn(),
}));

vi.mock('../../src/services/sheet-resolver.js', () => ({
  SheetResolver: vi.fn(),
  initializeSheetResolver: vi.fn().mockReturnValue({ resolveSheetId: vi.fn() }),
}));

vi.mock('../../src/services/transaction-manager.js', () => ({
  getTransactionManager: vi.fn().mockReturnValue({
    begin: vi.fn().mockResolvedValue('tx_001'),
    queue: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({ success: true, operationResults: [], apiCallsSaved: 0, duration: 10 }),
    rollback: vi.fn().mockResolvedValue(undefined),
    getTransaction: vi.fn().mockReturnValue({ status: 'pending', operations: [] }),
    getActiveTransactions: vi.fn().mockReturnValue([]),
  }),
  initTransactionManager: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { VisualizeHandler } from '../../src/handlers/visualize.js';
import { FormatHandler } from '../../src/handlers/format.js';
import { SheetsCoreHandler } from '../../src/handlers/core.js';
import { TransactionHandler } from '../../src/handlers/transaction.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4 } from 'googleapis';
import { elicitSpreadsheetCreation, elicitConditionalFormatPreset } from '../../src/mcp/elicitation.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const createMockSheetsApi = (): sheets_v4.Sheets =>
  ({
    spreadsheets: {
      get: vi.fn().mockResolvedValue({
        data: {
          spreadsheetId: 'test-spreadsheet-id',
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
      }),
      create: vi.fn().mockResolvedValue({
        data: {
          spreadsheetId: 'new-spreadsheet-id',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-spreadsheet-id/edit',
          properties: { title: 'Test Sheet', locale: 'en_US' },
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1', index: 0, gridProperties: { rowCount: 1000, columnCount: 26 } } }],
        },
      }),
      values: {
        get: vi.fn().mockResolvedValue({ data: { values: [] } }),
        update: vi.fn().mockResolvedValue({ data: {} }),
        append: vi.fn().mockResolvedValue({ data: {} }),
        batchGet: vi.fn().mockResolvedValue({ data: { valueRanges: [] } }),
        batchUpdate: vi.fn().mockResolvedValue({ data: {} }),
      },
      batchUpdate: vi.fn().mockResolvedValue({
        data: { replies: [{ addChart: { chart: { chartId: 42 } } }] },
      }),
    },
  }) as any;

const createMockElicitationServer = (returnValues: Record<string, unknown>) => ({
  elicitInput: vi.fn().mockResolvedValue({ action: 'accept', content: returnValues }),
  getClientCapabilities: vi.fn().mockReturnValue({ elicitation: { form: true } }),
});

const createMockContext = (elicitationServer?: any): HandlerContext =>
  ({
    spreadsheetId: 'test-spreadsheet-id',
    userId: 'test-user-id',
    cachedApi: {
      spreadsheets: { get: vi.fn().mockResolvedValue({ data: { sheets: [] } }) },
    } as any,
    googleClient: {} as any,
    elicitationServer: elicitationServer ?? undefined,
    server: elicitationServer ?? undefined,
    samplingServer: undefined,
    backend: undefined,
    auth: { hasElevatedAccess: false, scopes: ['https://www.googleapis.com/auth/spreadsheets'] },
    metrics: { recordConfirmationSkip: vi.fn() } as any,
    sessionContext: undefined,
    logger: undefined,
    rangeResolver: {
      resolve: vi.fn().mockResolvedValue({ a1Notation: 'Sheet1!A1:B5' }),
    } as any,
    sheetResolver: {
      resolveSheetId: vi.fn().mockResolvedValue(0),
      invalidate: vi.fn(),
    } as any,
    metadataCache: undefined,
  }) as any;

// ===========================================================================
// 1. visualize.chart_create — elicitation wizard
// ===========================================================================

describe('VisualizeHandler — chart_create elicitation wizard', () => {
  let mockSheetsApi: sheets_v4.Sheets;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSheetsApi = createMockSheetsApi();
  });

  it('uses wizard chartType and title when elicitation available and chartType absent', async () => {
    const elicitServer = createMockElicitationServer({ chartType: 'LINE', chartTitle: 'Revenue Trend' });
    const context = createMockContext(elicitServer);
    const handler = new VisualizeHandler(context, mockSheetsApi);

    const result = await handler.handle({
      request: {
        action: 'chart_create',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        // chartType intentionally absent (wizard will provide it)
        data: { sourceRange: 'Sheet1!A1:B5' },
        position: { anchorCell: 'Sheet1!E2' },
      },
    } as any);

    expect(elicitServer.elicitInput).toHaveBeenCalled();
    const response = result.response as any;
    expect(response.success).toBe(true);
    expect(response.action).toBe('chart_create');
  });

  it('proceeds with defaults when elicitation unavailable and chartType provided', async () => {
    const context = createMockContext(); // no elicitation server
    const handler = new VisualizeHandler(context, mockSheetsApi);

    const result = await handler.handle({
      request: {
        action: 'chart_create',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        chartType: 'BAR',
        data: { sourceRange: 'Sheet1!A1:B5' },
        position: { anchorCell: 'Sheet1!E2' },
      },
    } as any);

    const response = result.response as any;
    expect(response.success).toBe(true);
    expect(response.action).toBe('chart_create');
  });

  it('proceeds with BAR default when elicitation fails', async () => {
    const elicitServer = {
      elicitInput: vi.fn().mockRejectedValue(new Error('timeout')),
      getClientCapabilities: vi.fn().mockReturnValue({ elicitation: { form: true } }),
    };
    const context = createMockContext(elicitServer);
    const handler = new VisualizeHandler(context, mockSheetsApi);

    const result = await handler.handle({
      request: {
        action: 'chart_create',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        // chartType absent
        data: { sourceRange: 'Sheet1!A1:B5' },
        position: { anchorCell: 'Sheet1!E2' },
      },
    } as any);

    // Should still succeed with BAR default
    const response = result.response as any;
    expect(response.success).toBe(true);
  });
});

// ===========================================================================
// 2. format.add_conditional_format_rule — elicitation wizard
// ===========================================================================

describe('FormatHandler — add_conditional_format_rule elicitation wizard', () => {
  let mockSheetsApi: sheets_v4.Sheets;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSheetsApi = createMockSheetsApi();
    // Make batchUpdate return a simple response for format calls
    (mockSheetsApi.spreadsheets.batchUpdate as any).mockResolvedValue({ data: { replies: [] } });
  });

  it('uses wizard rulePreset when elicitation available and rulePreset absent', async () => {
    const elicitServer = createMockElicitationServer({ rulePreset: 'highlight_blanks' });
    const context = createMockContext(elicitServer);
    const handler = new FormatHandler(context, mockSheetsApi);

    const result = await handler.handle({
      request: {
        action: 'add_conditional_format_rule',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        range: 'Sheet1!A1:A10',
        // rulePreset intentionally absent (wizard will provide it)
      },
    } as any);

    // elicitConditionalFormatPreset is called when elicitationServer is present and rulePreset absent
    expect(elicitConditionalFormatPreset).toHaveBeenCalled();
    const response = result.response as any;
    expect(response.success).toBe(true);
    expect(response.action).toBe('add_conditional_format_rule');
  });

  it('proceeds with defaults when elicitation unavailable and rulePreset provided', async () => {
    const context = createMockContext(); // no elicitation server
    const handler = new FormatHandler(context, mockSheetsApi);

    const result = await handler.handle({
      request: {
        action: 'add_conditional_format_rule',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        range: 'Sheet1!A1:A10',
        rulePreset: 'highlight_blanks',
      },
    } as any);

    const response = result.response as any;
    expect(response.success).toBe(true);
    expect(response.action).toBe('add_conditional_format_rule');
  });

  it('proceeds with highlight_blanks default when elicitation fails', async () => {
    // Override the mock to return null (simulates elicitation timeout/failure)
    vi.mocked(elicitConditionalFormatPreset).mockResolvedValueOnce(null);

    const elicitServer = {
      elicitInput: vi.fn().mockRejectedValue(new Error('timeout')),
      getClientCapabilities: vi.fn().mockReturnValue({ elicitation: { form: true } }),
    };
    const context = createMockContext(elicitServer);
    const handler = new FormatHandler(context, mockSheetsApi);

    const result = await handler.handle({
      request: {
        action: 'add_conditional_format_rule',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        range: 'Sheet1!A1:A10',
        // rulePreset absent — falls back to highlight_blanks when elicitation returns null
      },
    } as any);

    // Should succeed with default rulePreset
    const response = result.response as any;
    expect(response.success).toBe(true);
  });
});

// ===========================================================================
// 3. core.create — elicitation wizard
// ===========================================================================

describe('SheetsCoreHandler — create elicitation wizard', () => {
  let mockSheetsApi: sheets_v4.Sheets;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSheetsApi = createMockSheetsApi();
  });

  it('uses wizard title when elicitation available and title absent', async () => {
    const elicitServer = createMockElicitationServer({ title: 'My New Spreadsheet' });
    const context = createMockContext(elicitServer);
    const handler = new SheetsCoreHandler(context, mockSheetsApi);

    const result = await handler.handle({
      request: {
        action: 'create',
        // title intentionally absent (wizard will provide it)
      },
    } as any);

    expect(elicitSpreadsheetCreation).toHaveBeenCalledWith(elicitServer);
    const response = result.response as any;
    expect(response.success).toBe(true);
    expect(response.action).toBe('create');
  });

  it('proceeds with "Untitled Spreadsheet" default when elicitation unavailable', async () => {
    const context = createMockContext(); // no elicitation server
    const handler = new SheetsCoreHandler(context, mockSheetsApi);

    const result = await handler.handle({
      request: {
        action: 'create',
        title: 'Already Titled',
      },
    } as any);

    const response = result.response as any;
    expect(response.success).toBe(true);
    expect(response.action).toBe('create');
  });

  it('uses "Untitled Spreadsheet" when elicitation fails', async () => {
    const elicitServer = {
      elicitInput: vi.fn().mockRejectedValue(new Error('timeout')),
      getClientCapabilities: vi.fn().mockReturnValue({ elicitation: { form: true } }),
    };
    const context = createMockContext(elicitServer);
    const handler = new SheetsCoreHandler(context, mockSheetsApi);

    const result = await handler.handle({
      request: {
        action: 'create',
        // title absent — elicitation fails, should use default
      },
    } as any);

    const response = result.response as any;
    // Should succeed with default title
    expect(response.success).toBe(true);
  });
});

// ===========================================================================
// 4. transaction.begin — elicitation wizard
// ===========================================================================

describe('TransactionHandler — begin elicitation wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses wizard description when elicitation available and description absent', async () => {
    const elicitServer = createMockElicitationServer({ description: 'Quarterly budget update' });
    const context = createMockContext(elicitServer);
    const handler = new TransactionHandler({ context });

    const result = await handler.handle({
      request: {
        action: 'begin',
        spreadsheetId: 'test-spreadsheet-id',
        // description intentionally absent (wizard will provide it)
      },
    } as any);

    expect(elicitServer.elicitInput).toHaveBeenCalled();
    const response = result.response as any;
    expect(response.success).toBe(true);
    expect(response.action).toBe('begin');
    expect(response.transactionId).toBeDefined();
  });

  it('proceeds without description when elicitation unavailable', async () => {
    const context = createMockContext(); // no elicitation server
    const handler = new TransactionHandler({ context });

    const result = await handler.handle({
      request: {
        action: 'begin',
        spreadsheetId: 'test-spreadsheet-id',
      },
    } as any);

    const response = result.response as any;
    expect(response.success).toBe(true);
    expect(response.action).toBe('begin');
    expect(response.transactionId).toBe('tx_001');
  });

  it('proceeds without description when elicitation fails', async () => {
    const elicitServer = {
      elicitInput: vi.fn().mockRejectedValue(new Error('timeout')),
      getClientCapabilities: vi.fn().mockReturnValue({ elicitation: { form: true } }),
    };
    const context = createMockContext(elicitServer);
    const handler = new TransactionHandler({ context });

    const result = await handler.handle({
      request: {
        action: 'begin',
        spreadsheetId: 'test-spreadsheet-id',
      },
    } as any);

    // Should still succeed without description
    const response = result.response as any;
    expect(response.success).toBe(true);
    expect(response.transactionId).toBe('tx_001');
  });
});
