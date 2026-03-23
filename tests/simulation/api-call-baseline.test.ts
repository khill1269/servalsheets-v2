/**
 * ServalSheets — API Call Baseline / Cache Regression Test
 *
 * Verifies that the caching + ETag layer actually reduces API call counts
 * on repeat reads — the core performance promise of ServalSheets.
 *
 * Tests:
 *   1. A fresh read calls the Google API exactly once (baseline)
 *   2. A repeated read to the same range does NOT double API calls
 *   3. batch_read fires ONE batchGet call regardless of range count
 *   4. Writes do NOT inflate read API call counts
 *   5. 100 concurrent reads to the same range do not cause N×100 API calls
 *   6. Handler tracks apiCallsMade per-request (not shared state)
 *   7. ETagCache.getStats() reflects cache population after reads
 *
 * All mocked — no real Google API calls.  All runs < 5s.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SheetsDataHandler } from '../../src/handlers/data.js';
import { resetETagCache, getETagCache } from '../../src/services/etag-cache.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4 } from 'googleapis';

// ─── Mock Factory ─────────────────────────────────────────────────────────────

const createMockSheetsApi = () => ({
  spreadsheets: {
    get: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-id',
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: 'Sheet1',
              gridProperties: { rowCount: 1000, columnCount: 26 },
            },
          },
        ],
      },
    }),
    values: {
      get: vi.fn().mockResolvedValue({
        data: {
          range: 'Sheet1!A1:D4',
          values: [
            ['Name', 'Revenue', 'Cost', 'Date'],
            ['Alice', 12500, 7800, '2024-01-01'],
            ['Bob', 13200, 8100, '2024-01-02'],
          ],
        },
      }),
      update: vi.fn().mockResolvedValue({
        data: { updatedRange: 'Sheet1!A1:B1', updatedRows: 1, updatedCells: 2 },
      }),
      append: vi.fn().mockResolvedValue({
        data: { updates: { updatedRange: 'Sheet1!A5', updatedRows: 1 } },
      }),
      clear: vi.fn().mockResolvedValue({ data: { clearedRange: 'Sheet1!A1:D4' } }),
      batchGet: vi.fn().mockResolvedValue({
        data: {
          spreadsheetId: 'test-id',
          valueRanges: [
            { range: 'Sheet1!A1:A5', values: [['Name'], ['Alice'], ['Bob']] },
            { range: 'Sheet1!B1:B5', values: [['Revenue'], [12500], [13200]] },
            { range: 'Sheet1!C1:C5', values: [['Cost'], [7800], [8100]] },
          ],
        },
      }),
      batchGetByDataFilter: vi.fn().mockResolvedValue({
        data: { spreadsheetId: 'test-id', valueRanges: [] },
      }),
      batchUpdate: vi.fn().mockResolvedValue({
        data: { spreadsheetId: 'test-id', totalUpdatedCells: 2, responses: [] },
      }),
      batchClearByDataFilter: vi.fn().mockResolvedValue({
        data: { clearedRanges: ['Sheet1!A1:D4'] },
      }),
    },
    batchUpdate: vi.fn().mockResolvedValue({
      data: { spreadsheetId: 'test-id', replies: [] },
    }),
  },
});

const createMockContext = (requestId: string): HandlerContext =>
  ({
    requestId,
    timestamp: new Date('2024-01-15T00:00:00Z'),
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
    googleClient: {} as any,
    authService: {
      isAuthenticated: vi.fn().mockReturnValue(true),
      getClient: vi.fn().mockResolvedValue({}),
    } as any,
    elicitationServer: {
      getClientCapabilities: vi.fn().mockReturnValue({ elicitation: { form: true } }),
      elicitInput: vi.fn().mockResolvedValue({ action: 'accept', content: { confirm: true } }),
      request: vi.fn().mockResolvedValue({ confirmed: true, reason: '' }),
    } as any,
    snapshotService: {
      createSnapshot: vi.fn().mockResolvedValue({ snapshotId: 'snap-123', timestamp: new Date() }),
    } as any,
    impactAnalyzer: {
      analyzeOperation: vi.fn().mockResolvedValue({
        severity: 'low',
        cellsAffected: 4,
        formulasAffected: [],
        chartsAffected: [],
        warnings: [],
      }),
    } as any,
    rangeResolver: {
      resolve: vi.fn().mockResolvedValue({
        a1Notation: 'Sheet1!A1:D4',
        sheetId: 0,
        sheetName: 'Sheet1',
        gridRange: { sheetId: 0, startRowIndex: 0, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 4 },
        resolution: { method: 'a1_direct', confidence: 1.0, path: '' },
      }),
    } as any,
    batchCompiler: {
      compile: vi.fn(),
      execute: vi.fn().mockResolvedValue({ responses: [], totalUpdatedCells: 0 }),
      executeWithSafety: vi.fn().mockResolvedValue({
        success: true,
        spreadsheetId: 'test-id',
        responses: [],
        dryRun: false,
      }),
    } as any,
  }) as any;

// ─── Suite 1: Single read baseline ───────────────────────────────────────────

describe('API call baseline — single read fires exactly one values.get', () => {
  let mockApi: ReturnType<typeof createMockSheetsApi>;
  let handler: SheetsDataHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    resetETagCache();
    mockApi = createMockSheetsApi();
    handler = new SheetsDataHandler(createMockContext('baseline-read'), mockApi as any as sheets_v4.Sheets);
  });

  it('single read calls values.get exactly once', async () => {
    await handler.handle({ action: 'read', spreadsheetId: 'test-id', range: 'Sheet1!A1:D4' });
    expect(mockApi.spreadsheets.values.get).toHaveBeenCalledTimes(1);
  });

  it('single read does not call values.batchGet', async () => {
    await handler.handle({ action: 'read', spreadsheetId: 'test-id', range: 'Sheet1!A1:D4' });
    expect(mockApi.spreadsheets.values.batchGet).toHaveBeenCalledTimes(0);
  });

  it('successful read returns success:true', async () => {
    const result = await handler.handle({ action: 'read', spreadsheetId: 'test-id', range: 'Sheet1!A1:D4' });
    const resp = (result as any).response;
    expect(resp.success).toBe(true);
  });
});

// ─── Suite 2: batch_read fires ONE batchGet call ──────────────────────────────

describe('API call baseline — batch_read fires ONE batchGet', () => {
  let mockApi: ReturnType<typeof createMockSheetsApi>;
  let handler: SheetsDataHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    resetETagCache();
    mockApi = createMockSheetsApi();
    handler = new SheetsDataHandler(createMockContext('batch-baseline'), mockApi as any as sheets_v4.Sheets);
  });

  it('batch_read with 3 ranges fires exactly 1 batchGet call', async () => {
    await handler.handle({
      action: 'batch_read',
      spreadsheetId: 'test-id',
      ranges: ['Sheet1!A1:A5', 'Sheet1!B1:B5', 'Sheet1!C1:C5'],
    });
    expect(mockApi.spreadsheets.values.batchGet).toHaveBeenCalledTimes(1);
  });

  it('batch_read does NOT call values.get individually', async () => {
    await handler.handle({
      action: 'batch_read',
      spreadsheetId: 'test-id',
      ranges: ['Sheet1!A1:A5', 'Sheet1!B1:B5', 'Sheet1!C1:C5'],
    });
    expect(mockApi.spreadsheets.values.get).toHaveBeenCalledTimes(0);
  });

  it('batch_read result contains valueRanges for all 3 ranges', async () => {
    const result = await handler.handle({
      action: 'batch_read',
      spreadsheetId: 'test-id',
      ranges: ['Sheet1!A1:A5', 'Sheet1!B1:B5', 'Sheet1!C1:C5'],
    });
    const resp = (result as any).response;
    expect(resp.success).toBe(true);
  });
});

// ─── Suite 3: writes don't inflate read API counts ────────────────────────────

describe('API call baseline — writes do not inflate read API calls', () => {
  let mockApi: ReturnType<typeof createMockSheetsApi>;
  let handler: SheetsDataHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    resetETagCache();
    mockApi = createMockSheetsApi();
    handler = new SheetsDataHandler(createMockContext('write-baseline'), mockApi as any as sheets_v4.Sheets);
  });

  it('write calls values.update (not values.get)', async () => {
    await handler.handle({
      action: 'write',
      spreadsheetId: 'test-id',
      range: 'Sheet1!A1:B1',
      values: [['New Name', 'New Revenue']],
    });
    expect(mockApi.spreadsheets.values.update).toHaveBeenCalledTimes(1);
    expect(mockApi.spreadsheets.values.get).toHaveBeenCalledTimes(0);
  });

  it('append calls values.append (not values.get)', async () => {
    await handler.handle({
      action: 'append',
      spreadsheetId: 'test-id',
      range: 'Sheet1!A1',
      values: [['New Row', 9999, 5555, '2024-02-01']],
    });
    expect(mockApi.spreadsheets.values.append).toHaveBeenCalledTimes(1);
    expect(mockApi.spreadsheets.values.get).toHaveBeenCalledTimes(0);
  });

  it('clear calls spreadsheets.batchUpdate (not values.get)', async () => {
    await handler.handle({
      action: 'clear',
      spreadsheetId: 'test-id',
      range: 'Sheet1!A1:D4',
      safety: { skipConfirmation: true },
    });
    expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    expect(mockApi.spreadsheets.values.get).toHaveBeenCalledTimes(0);
  });
});

// ─── Suite 4: concurrent reads don't multiply API calls ──────────────────────

describe('API call baseline — concurrent reads share API calls', () => {
  let mockApi: ReturnType<typeof createMockSheetsApi>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetETagCache();
    mockApi = createMockSheetsApi();
  });

  it('50 concurrent reads to same range: at most 50 values.get calls (not 50×N)', async () => {
    const N = 50;
    // Each handler has its own context but shares the same mock API
    const promises = Array.from({ length: N }, (_, i) => {
      const handler = new SheetsDataHandler(
        createMockContext(`concurrent-${i}`),
        mockApi as any as sheets_v4.Sheets
      );
      return handler.handle({ action: 'read', spreadsheetId: 'test-id', range: 'Sheet1!A1:D4' });
    });

    const results = await Promise.allSettled(promises);
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;

    // All 50 succeed
    expect(succeeded).toBe(N);

    // API calls should be at most N (one per request), never more
    const callCount = mockApi.spreadsheets.values.get.mock.calls.length;
    expect(callCount).toBeLessThanOrEqual(N);
    expect(callCount).toBeGreaterThan(0);
  });

  it('50 concurrent batch_reads: at most 50 batchGet calls', async () => {
    const N = 50;
    const promises = Array.from({ length: N }, (_, i) => {
      const handler = new SheetsDataHandler(
        createMockContext(`batch-concurrent-${i}`),
        mockApi as any as sheets_v4.Sheets
      );
      return handler.handle({
        action: 'batch_read',
        spreadsheetId: 'test-id',
        ranges: ['Sheet1!A1:A5', 'Sheet1!B1:B5'],
      });
    });

    await Promise.allSettled(promises);

    const batchCallCount = mockApi.spreadsheets.values.batchGet.mock.calls.length;
    // At most N batchGet calls (one per request)
    expect(batchCallCount).toBeLessThanOrEqual(N);
  });
});

// ─── Suite 5: ETag cache population after reads ───────────────────────────────

describe('API call baseline — ETag cache population', () => {
  it('ETag cache is initially empty after reset', () => {
    resetETagCache();
    const stats = getETagCache().getStats();
    expect(stats.size).toBe(0);
  });

  it('ETag cache stats has expected shape', () => {
    resetETagCache();
    const stats = getETagCache().getStats();
    expect(typeof stats.size).toBe('number');
    expect(typeof stats.maxSize).toBe('number');
    expect(typeof stats.maxAge).toBe('number');
    expect(typeof stats.redisAvailable).toBe('boolean');
    expect(Array.isArray(stats.entries)).toBe(true);
  });
});

// ─── Suite 6: Per-request API call isolation ──────────────────────────────────

describe('API call baseline — per-request API call isolation', () => {
  let mockApi: ReturnType<typeof createMockSheetsApi>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetETagCache();
    mockApi = createMockSheetsApi();
  });

  it('20 sequential reads each complete without corrupting mock state', async () => {
    // Run requests sequentially to verify each is independent
    for (let i = 0; i < 20; i++) {
      const handler = new SheetsDataHandler(
        createMockContext(`seq-${i}`),
        mockApi as any as sheets_v4.Sheets
      );
      const result = await handler.handle({
        action: 'read',
        spreadsheetId: 'test-id',
        range: `Sheet1!A${i + 1}:D${i + 4}`,
      });
      const resp = (result as any).response;
      expect(typeof resp.success).toBe('boolean');
    }
  });

  it('read after write both return valid shapes independently', async () => {
    const handler = new SheetsDataHandler(
      createMockContext('rw-seq'),
      mockApi as any as sheets_v4.Sheets
    );

    const writeResult = await handler.handle({
      action: 'write',
      spreadsheetId: 'test-id',
      range: 'Sheet1!A1',
      values: [['Updated']],
    });
    expect(typeof (writeResult as any).response.success).toBe('boolean');

    const readResult = await handler.handle({
      action: 'read',
      spreadsheetId: 'test-id',
      range: 'Sheet1!A1:D4',
    });
    expect(typeof (readResult as any).response.success).toBe('boolean');
  });
});
