/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ServalSheets - Sampling Enhancement Tests (Task #15, P13-M3)
 *
 * Tests for MCP Sampling enhancements on 5 high-value actions:
 * 1. data.find_replace — aiEstimate in dryRun mode
 * 2. format.suggest_format — aiRationale per suggestion
 * 3. dependencies.model_scenario — aiNarrative on cascade result
 * 4. history.diff_revisions — aiExplanation on diff result
 * 5. collaborate.comment_add — aiSuggestedReply when question detected
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HandlerContext } from '../../src/handlers/base.js';
import { SheetsDataHandler } from '../../src/handlers/data.js';
import { FormatHandler } from '../../src/handlers/format.js';
import { DependenciesHandler, clearAnalyzerCache } from '../../src/handlers/dependencies.js';
import { HistoryHandler } from '../../src/handlers/history.js';
import { CollaborateHandler } from '../../src/handlers/collaborate.js';

// ---------------------------------------------------------------------------
// Module mocks (hoisted by vi.mock)
// ---------------------------------------------------------------------------

vi.mock('../../src/utils/logger.js', () => {
  const childLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return {
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnValue(childLogger),
    },
    createChildLogger: vi.fn().mockReturnValue(childLogger),
  };
});

vi.mock('../../src/utils/request-context.js', () => ({
  sendProgress: vi.fn(),
  getRequestContext: vi.fn().mockReturnValue({ timeoutMs: 30000 }),
  getRequestLogger: vi.fn().mockReturnValue({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  recordRequestLlmProvenance: vi.fn(),
  getRequestLlmProvenance: vi.fn(),
  getRequestAbortSignal: vi.fn(),
}));

vi.mock('../../src/services/history-service.js', () => {
  let mockService: any = null;
  return {
    getHistoryService: vi.fn(() => mockService),
    setHistoryService: vi.fn((service: any) => { mockService = service; }),
    resetHistoryService: vi.fn(() => { mockService = null; }),
  };
});

vi.mock('../../src/services/revision-timeline.js', () => ({
  getTimeline: vi.fn().mockResolvedValue([]),
  diffRevisions: vi.fn().mockResolvedValue({
    revisionId1: 'rev-1',
    revisionId2: 'rev-2',
    cellChanges: [
      { cell: 'B2', oldValue: 'foo', newValue: 'bar' },
    ],
    summary: {
      metadataOnly: false,
      totalChanges: 1,
      addedCells: 0,
      removedCells: 0,
      changedCells: 1,
    },
  }),
  restoreCells: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/services/etag-cache.js', () => ({
  getETagCache: vi.fn().mockReturnValue({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }),
  resetETagCache: vi.fn(),
}));

vi.mock('../../src/services/background-analyzer.js', () => ({
  getBackgroundAnalyzer: vi.fn().mockReturnValue({
    recordAccess: vi.fn(),
    getInsights: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock('../../src/utils/url.js', () => ({
  validateHyperlinkUrl: vi.fn().mockReturnValue({ valid: true }),
}));

vi.mock('../../src/mcp/sampling.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/mcp/sampling.js')>('../../src/mcp/sampling.js');
  return {
    ...actual,
    assertSamplingConsent: vi.fn().mockResolvedValue(undefined),
    withSamplingTimeout: vi.fn(<T>(operation: (() => Promise<T>) | Promise<T>) => {
      return typeof operation === 'function' ? operation() : operation;
    }),
    generateAIInsight: vi.fn().mockResolvedValue('AI-generated insight for test.'),
  };
});

vi.mock('../../src/utils/payload-validator.js', () => ({
  validateValuesPayload: vi.fn().mockReturnValue({ valid: true, sizeBytes: 100, warningMessage: undefined }),
  validateValuesBatchPayload: vi.fn().mockReturnValue({ valid: true, sizeBytes: 100, warningMessage: undefined }),
}));

// ---------------------------------------------------------------------------
// Mock sampling server factory
// ---------------------------------------------------------------------------
const createMockSamplingServer = (responseText: string) => ({
  getClientCapabilities: vi.fn().mockReturnValue({ sampling: {} }),
  createMessage: vi.fn().mockResolvedValue({
    content: { type: 'text', text: responseText },
    model: 'claude-sonnet',
    stopReason: 'end_turn',
    role: 'assistant',
  }),
});

// ---------------------------------------------------------------------------
// 1. data.find_replace — aiEstimate in dryRun mode
// ---------------------------------------------------------------------------
describe('Sampling: data.find_replace (dryRun aiEstimate)', () => {
  let mockSheetsApi: any;
  let mockContext: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSheetsApi = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({
          data: {
            spreadsheetId: 'test-id',
            sheets: [{ properties: { sheetId: 0, title: 'Sheet1', gridProperties: { rowCount: 100, columnCount: 10 } } }],
          },
        }),
        values: {
          get: vi.fn().mockResolvedValue({
            data: {
              range: 'Sheet1!A1:Z100',
              values: [['Alice', 'Bob'], ['Alice', 'Carol']],
            },
          }),
          batchGet: vi.fn().mockResolvedValue({ data: { valueRanges: [] } }),
        },
        batchUpdate: vi.fn().mockResolvedValue({ data: { replies: [{ findReplace: { occurrencesChanged: 2 } }] } }),
      },
    };

    mockContext = {
      googleClient: {} as any,
      batchCompiler: { compile: vi.fn(), execute: vi.fn(), executeAll: vi.fn() } as any,
      rangeResolver: {
        resolve: vi.fn().mockResolvedValue({
          a1Notation: 'Sheet1!A1:Z100',
          sheetId: 0,
          sheetName: 'Sheet1',
          gridRange: { sheetId: 0, startRowIndex: 0, endRowIndex: 100, startColumnIndex: 0, endColumnIndex: 26 },
          resolution: { method: 'a1_direct', confidence: 1.0, path: '' },
        }),
      } as any,
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('adds aiEstimate to dryRun response when samplingServer is available', async () => {
    const samplingServer = createMockSamplingServer('Estimated 2 matches for "Alice"');
    mockContext.samplingServer = samplingServer as any;
    const handler = new SheetsDataHandler(mockContext, mockSheetsApi);

    const result = await handler.handle({
      action: 'find_replace',
      spreadsheetId: 'test-id',
      find: 'Alice',
      replacement: 'Bob',
      safety: { dryRun: true },
    });

    expect(result.response.success).toBe(true);
    // aiEstimate should be present when sampling available and dryRun=true
    expect((result.response as any).aiEstimate).toBeDefined();
    expect((result.response as any).aiEstimate).toHaveProperty('matchCount');
    expect((result.response as any).aiEstimate).toHaveProperty('confidence');
  });

  it('succeeds without aiEstimate when samplingServer is unavailable', async () => {
    // No samplingServer in context
    const handler = new SheetsDataHandler(mockContext, mockSheetsApi);

    const result = await handler.handle({
      action: 'find_replace',
      spreadsheetId: 'test-id',
      find: 'Alice',
      replacement: 'Bob',
      safety: { dryRun: true },
    });

    expect(result.response.success).toBe(true);
    expect((result.response as any).aiEstimate).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. format.suggest_format — aiRationale per suggestion
// ---------------------------------------------------------------------------
describe('Sampling: format.suggest_format (aiRationale)', () => {
  let mockSheetsApi: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSheetsApi = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({
          data: {
            sheets: [{
              properties: { sheetId: 0, title: 'Sheet1' },
              data: [{
                rowData: [
                  { values: [{ formattedValue: 'Revenue', effectiveValue: { stringValue: 'Revenue' }, effectiveFormat: {} }] },
                  { values: [{ formattedValue: '1000', effectiveValue: { numberValue: 1000 }, effectiveFormat: {} }] },
                ],
              }],
            }],
          },
        }),
        batchUpdate: vi.fn().mockResolvedValue({ data: {} }),
        values: { get: vi.fn(), update: vi.fn(), clear: vi.fn() },
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('adds aiRationale to suggestions when samplingServer is available', async () => {
    const mockServer = {
      getClientCapabilities: vi.fn().mockReturnValue({ sampling: {} }),
      createMessage: vi.fn()
        // First call: primary suggest_format response
        .mockResolvedValueOnce({
          content: { type: 'text', text: JSON.stringify({ suggestions: [{ title: 'Bold Headers', explanation: 'Makes headers stand out', confidence: 90, formatOptions: {} }] }) },
          model: 'claude',
          stopReason: 'end_turn',
          role: 'assistant',
        })
        // Second call: aiRationale enrichment
        .mockResolvedValueOnce({
          content: { type: 'text', text: 'Bold headers improve readability by creating visual hierarchy.' },
          model: 'claude',
          stopReason: 'end_turn',
          role: 'assistant',
        }),
    };

    const mockContext: HandlerContext = {
      googleClient: {} as any,
      batchCompiler: { compile: vi.fn(), execute: vi.fn(), executeAll: vi.fn() } as any,
      rangeResolver: {
        resolve: vi.fn().mockResolvedValue({ a1Notation: 'Sheet1!A1:D10', sheetId: 0, sheetName: 'Sheet1', resolution: { method: 'a1_direct', confidence: 1.0, path: '' } }),
      } as any,
      server: mockServer as any,
      samplingServer: mockServer as any,
    } as any;

    const handler = new FormatHandler(mockContext, mockSheetsApi);

    const result = await handler.handle({
      action: 'suggest_format',
      spreadsheetId: 'test-id',
      range: { a1: 'Sheet1!A1:D10' },
    });

    expect(result.response.success).toBe(true);
    if (result.response.success) {
      const suggestions = (result.response as any).suggestions;
      expect(suggestions).toBeDefined();
      if (suggestions && suggestions.length > 0) {
        // createMessage called at least twice: once for LLM suggestion, once for aiRationale enrichment
        expect(mockServer.createMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
        // aiRationale should be added to each suggestion
        expect(suggestions[0]).toHaveProperty('aiRationale');
        expect(typeof suggestions[0].aiRationale).toBe('string');
      }
    }
  });

  it('succeeds without aiRationale when samplingServer is unavailable (but server available)', async () => {
    const mockServer = {
      getClientCapabilities: vi.fn().mockReturnValue({ sampling: {} }),
      createMessage: vi.fn().mockResolvedValue({
        content: { type: 'text', text: JSON.stringify({ suggestions: [{ title: 'Bold Headers', explanation: 'Makes headers stand out', confidence: 90, formatOptions: {} }] }) },
        model: 'claude',
        stopReason: 'end_turn',
        role: 'assistant',
      }),
    };

    const mockContext: HandlerContext = {
      googleClient: {} as any,
      batchCompiler: { compile: vi.fn(), execute: vi.fn(), executeAll: vi.fn() } as any,
      rangeResolver: {
        resolve: vi.fn().mockResolvedValue({ a1Notation: 'Sheet1!A1:D10', sheetId: 0, sheetName: 'Sheet1', resolution: { method: 'a1_direct', confidence: 1.0, path: '' } }),
      } as any,
      server: mockServer as any,
      // No samplingServer
    } as any;

    const handler = new FormatHandler(mockContext, mockSheetsApi);

    const result = await handler.handle({
      action: 'suggest_format',
      spreadsheetId: 'test-id',
      range: { a1: 'Sheet1!A1:D10' },
    });

    expect(result.response.success).toBe(true);
    if (result.response.success) {
      const suggestions = (result.response as any).suggestions;
      if (suggestions && suggestions.length > 0) {
        // aiRationale should NOT be present when samplingServer is unavailable
        expect(suggestions[0].aiRationale).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. dependencies.model_scenario — aiNarrative
// ---------------------------------------------------------------------------
describe('Sampling: dependencies.model_scenario (aiNarrative)', () => {
  let mockSheetsApi: any;

  beforeEach(() => {
    vi.clearAllMocks();
    clearAnalyzerCache();

    mockSheetsApi = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({
          data: {
            sheets: [{
              properties: { sheetId: 0, title: 'Sheet1' },
            }],
          },
        }),
        values: {
          get: vi.fn().mockResolvedValue({ data: { values: [] } }),
          batchGet: vi.fn().mockResolvedValue({ data: { valueRanges: [] } }),
        },
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearAnalyzerCache();
  });

  it('adds aiNarrative to model_scenario response when samplingServer is available', async () => {
    const samplingServer = createMockSamplingServer('Changing B2 will affect revenue totals in rows 5-10, reducing the quarterly sum by approximately 20%.');
    const handler = new DependenciesHandler(mockSheetsApi, { samplingServer: samplingServer as any });

    const result = await handler.handle({
      request: {
        action: 'model_scenario',
        spreadsheetId: 'test-scenario-id',
        changes: [{ cell: 'B2', newValue: 5000 }],
      },
    });

    expect(result.response.success).toBe(true);
    if (result.response.success) {
      // aiNarrative should be present when samplingServer is available
      expect((result.response as any).data?.aiNarrative).toBeDefined();
      expect(typeof (result.response as any).data?.aiNarrative).toBe('string');
    }
  });

  it('succeeds without aiNarrative when samplingServer is unavailable', async () => {
    const handler = new DependenciesHandler(mockSheetsApi);

    const result = await handler.handle({
      request: {
        action: 'model_scenario',
        spreadsheetId: 'test-scenario-id',
        changes: [{ cell: 'B2', newValue: 5000 }],
      },
    });

    expect(result.response.success).toBe(true);
    if (result.response.success) {
      expect((result.response as any).data?.aiNarrative).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. history.diff_revisions — aiExplanation
// ---------------------------------------------------------------------------
describe('Sampling: history.diff_revisions (aiExplanation)', () => {
  let mockHistoryService: any;
  let mockDriveApi: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    const { setHistoryService } = await import('../../src/services/history-service.js');
    mockHistoryService = {
      getRecent: vi.fn().mockReturnValue([]),
      getById: vi.fn(),
      getBySpreadsheet: vi.fn().mockReturnValue([]),
      getStats: vi.fn().mockReturnValue({ totalOperations: 0, successfulOperations: 0, failedOperations: 0, successRate: 100, averageDuration: 0 }),
      clear: vi.fn(),
      size: vi.fn().mockReturnValue(0),
      getLastUndoable: vi.fn(),
      getLastRedoable: vi.fn(),
      markAsUndone: vi.fn(),
      markAsRedone: vi.fn(),
      clearForSpreadsheet: vi.fn().mockReturnValue(0),
      getFailures: vi.fn().mockReturnValue([]),
    };
    setHistoryService(mockHistoryService);

    mockDriveApi = {
      revisions: { list: vi.fn(), get: vi.fn() },
      files: { export: vi.fn() },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('adds aiExplanation to diff_revisions response when samplingServer is available', async () => {
    const samplingServer = createMockSamplingServer('The value in B2 was changed from "foo" to "bar", suggesting a data correction was applied.');

    const handler = new HistoryHandler({
      samplingServer: samplingServer as any,
      driveApi: mockDriveApi as any,
    });

    const result = await handler.handle({
      action: 'diff_revisions',
      spreadsheetId: 'test-spreadsheet-id',
      revisionId1: 'rev-1',
      revisionId2: 'rev-2',
    });

    expect(result.response.success).toBe(true);
    if (result.response.success) {
      // aiExplanation should be present when samplingServer is available
      expect((result.response as any).aiExplanation).toBeDefined();
      expect(typeof (result.response as any).aiExplanation).toBe('string');
    }
  });

  it('succeeds without aiExplanation when samplingServer is unavailable', async () => {
    const handler = new HistoryHandler({ driveApi: mockDriveApi as any });

    const result = await handler.handle({
      action: 'diff_revisions',
      spreadsheetId: 'test-spreadsheet-id',
      revisionId1: 'rev-1',
      revisionId2: 'rev-2',
    });

    expect(result.response.success).toBe(true);
    if (result.response.success) {
      expect((result.response as any).aiExplanation).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. collaborate.comment_add — aiSuggestedReply
// ---------------------------------------------------------------------------
describe('Sampling: collaborate.comment_add (aiSuggestedReply)', () => {
  let mockDriveApi: any;
  let mockContext: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDriveApi = {
      permissions: {
        list: vi.fn().mockResolvedValue({ data: { permissions: [] } }),
        get: vi.fn().mockResolvedValue({ data: {} }),
        create: vi.fn().mockResolvedValue({ data: { id: 'perm-1' } }),
        update: vi.fn().mockResolvedValue({ data: {} }),
        delete: vi.fn().mockResolvedValue({}),
      },
      files: {
        get: vi.fn().mockResolvedValue({ data: { id: 'test-id', name: 'Test', mimeType: 'application/vnd.google-apps.spreadsheet' } }),
        copy: vi.fn().mockResolvedValue({ data: { id: 'copy-id', name: 'Copy' } }),
        export: vi.fn().mockResolvedValue({ data: Buffer.from('data') }),
      },
      comments: {
        create: vi.fn().mockResolvedValue({
          data: {
            id: 'comment-1',
            content: 'What is the Q4 target?',
            createdTime: '2026-01-01T00:00:00Z',
            modifiedTime: '2026-01-01T00:00:00Z',
            author: { displayName: 'Alice', emailAddress: 'alice@example.com' },
            resolved: false,
          },
        }),
        list: vi.fn().mockResolvedValue({ data: { comments: [] } }),
        get: vi.fn().mockResolvedValue({ data: {} }),
        update: vi.fn().mockResolvedValue({ data: {} }),
        delete: vi.fn().mockResolvedValue({}),
      },
      replies: {
        create: vi.fn().mockResolvedValue({ data: { id: 'reply-1', content: 'Reply' } }),
        list: vi.fn().mockResolvedValue({ data: { replies: [] } }),
        update: vi.fn().mockResolvedValue({ data: {} }),
        delete: vi.fn().mockResolvedValue({}),
      },
      revisions: {
        list: vi.fn().mockResolvedValue({ data: { revisions: [] } }),
        get: vi.fn().mockResolvedValue({ data: {} }),
        update: vi.fn().mockResolvedValue({ data: {} }),
      },
    };

    mockContext = {
      googleClient: {} as any,
      batchCompiler: { compile: vi.fn(), execute: vi.fn(), executeAll: vi.fn() } as any,
      rangeResolver: {
        resolve: vi.fn().mockResolvedValue({ a1Notation: 'Sheet1!A1:B10', sheetId: 0, sheetName: 'Sheet1', resolution: { method: 'a1_direct', confidence: 1.0, path: '' } }),
      } as any,
      auth: {
        hasElevatedAccess: true,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/drive.file',
        ],
      },
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('adds aiSuggestedReply when comment contains a question and samplingServer is available', async () => {
    const samplingServer = createMockSamplingServer('The Q4 target is $250,000 based on the current spreadsheet data.');
    mockContext.samplingServer = samplingServer as any;

    const handler = new CollaborateHandler(mockContext, mockDriveApi);

    const result = await handler.handle({
      action: 'comment_add',
      spreadsheetId: 'test-id',
      content: 'What is the Q4 target?',
    });

    expect(result.response.success).toBe(true);
    if (result.response.success) {
      // aiSuggestedReply should be present when content has "?" and samplingServer available
      expect((result.response as any).aiSuggestedReply).toBeDefined();
      expect(typeof (result.response as any).aiSuggestedReply).toBe('string');
    }
  });

  it('succeeds without aiSuggestedReply when samplingServer is unavailable', async () => {
    // No samplingServer in context
    const handler = new CollaborateHandler(mockContext, mockDriveApi);

    const result = await handler.handle({
      action: 'comment_add',
      spreadsheetId: 'test-id',
      content: 'What is the Q4 target?',
    });

    expect(result.response.success).toBe(true);
    if (result.response.success) {
      expect((result.response as any).aiSuggestedReply).toBeUndefined();
    }
  });

  it('sets aiSuggestedReply to null when comment has no question mark', async () => {
    const samplingServer = createMockSamplingServer('Some response');
    mockContext.samplingServer = samplingServer as any;

    const handler = new CollaborateHandler(mockContext, mockDriveApi);

    // Override mock to return a comment without question
    mockDriveApi.comments.create.mockResolvedValueOnce({
      data: {
        id: 'comment-2',
        content: 'Looks good to me.',
        createdTime: '2026-01-01T00:00:00Z',
        modifiedTime: '2026-01-01T00:00:00Z',
        author: { displayName: 'Bob', emailAddress: 'bob@example.com' },
        resolved: false,
      },
    });

    const result = await handler.handle({
      action: 'comment_add',
      spreadsheetId: 'test-id',
      content: 'Looks good to me.',
    });

    expect(result.response.success).toBe(true);
    if (result.response.success) {
      // No question mark → aiSuggestedReply should be null
      expect((result.response as any).aiSuggestedReply).toBeNull();
    }
  });
});
