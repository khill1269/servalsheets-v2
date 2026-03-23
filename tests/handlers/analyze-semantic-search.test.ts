/**
 * Tests for sheets_analyze.semantic_search (ISSUE-174/175)
 *
 * Tests are structured to avoid real network calls:
 * - Missing API key path (synchronous config error)
 * - Embedding service error path (API failure)
 * - Successful search path (mocked fetch + cosine similarity)
 * - Empty spreadsheet path (no indexable content)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { sheets_v4 } from 'googleapis';

// ============================================================================
// Helpers
// ============================================================================

function makeRow(values: (string | number | null)[]): sheets_v4.Schema$RowData {
  return {
    values: values.map((v) => ({
      formattedValue: v !== null ? String(v) : undefined,
      effectiveValue: typeof v === 'number' ? { numberValue: v } : v ? { stringValue: v } : {},
    })),
  };
}

function makeSheetsApi(rows: sheets_v4.Schema$RowData[]): sheets_v4.Sheets {
  return {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({
        data: {
          sheets: [
            {
              properties: { title: 'Sheet1', sheetId: 0 },
              data: [
                {
                  rowData: rows,
                  startRow: 0,
                },
              ],
            },
          ],
        },
      }),
    },
  } as unknown as sheets_v4.Sheets;
}

// Fake embedding: returns a vector where each dim is the char code of the first char / 127
function textToFakeEmbedding(text: string): number[] {
  const dims = 16;
  const vec = Array.from({ length: dims }, (_, i) => {
    const char = text.charCodeAt(i % text.length) / 127;
    return char;
  });
  // Normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map((v) => (norm > 0 ? v / norm : 0));
}

function makeFetchMock(queryText?: string) {
  return vi.fn().mockImplementation(async (url: string, opts: RequestInit) => {
    const body = JSON.parse(opts.body as string) as { input: string[]; input_type: string };
    const embeddings = body.input.map((text) => ({
      embedding: textToFakeEmbedding(text),
    }));
    return {
      ok: true,
      json: async () => ({ data: embeddings }),
    };
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('sheets_analyze.semantic_search', () => {
  let originalEnv: string | undefined;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalEnv = process.env['VOYAGE_API_KEY'];
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['VOYAGE_API_KEY'];
    } else {
      process.env['VOYAGE_API_KEY'] = originalEnv;
    }
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('config error — missing API key', () => {
    it('returns CONFIG_ERROR when VOYAGE_API_KEY is not set', async () => {
      delete process.env['VOYAGE_API_KEY'];

      // Import fresh to avoid cached module state affecting env check
      const { handleSemanticSearchAction } = await import(
        '../../src/handlers/analyze-actions/semantic-search.js'
      );

      const result = await handleSemanticSearchAction(
        { spreadsheetId: 'ss-1', query: 'revenue data', topK: 3 },
        { sheetsApi: {} as sheets_v4.Sheets }
      );

      expect((result as { success: boolean }).success).toBe(false);
      const err = (result as { error: { code: string; retryable: boolean } }).error;
      expect(err.code).toBe('CONFIG_ERROR');
      expect(err.retryable).toBe(false);
    });
  });

  describe('successful search', () => {
    it('returns ranked results with relevanceScore and range', async () => {
      process.env['VOYAGE_API_KEY'] = 'test-key-123';
      globalThis.fetch = makeFetchMock() as unknown as typeof globalThis.fetch;

      // Clear cached index so we get a fresh index call
      const { clearSemanticIndex, semanticSearch } = await import(
        '../../src/services/semantic-search.js'
      );
      clearSemanticIndex('ss-success-1');

      const rows = [
        makeRow(['Month', 'Revenue', 'Cost', 'Profit']),
        makeRow(['Jan', 120000, 80000, 40000]),
        makeRow(['Feb', 135000, 85000, 50000]),
        makeRow(['Mar', 142000, 88000, 54000]),
      ];

      const sheetsApi = makeSheetsApi(rows);
      const results = await semanticSearch(
        'ss-success-1',
        'quarterly revenue targets',
        5,
        sheetsApi,
        'test-key-123',
        true // forceRefresh
      );

      expect(Array.isArray(results)).toBe(true);
      // Should have at least 1 result
      expect(results.length).toBeGreaterThan(0);
      // Each result has required fields
      for (const r of results) {
        expect(typeof r.range).toBe('string');
        expect(typeof r.relevanceScore).toBe('number');
        expect(r.relevanceScore).toBeGreaterThanOrEqual(0);
        expect(r.relevanceScore).toBeLessThanOrEqual(1);
        expect(typeof r.snippet).toBe('string');
      }
      // Results sorted descending by relevanceScore
      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.relevanceScore).toBeLessThanOrEqual(results[i - 1]!.relevanceScore);
      }
    });

    it('topK limits the number of results', async () => {
      process.env['VOYAGE_API_KEY'] = 'test-key-123';
      globalThis.fetch = makeFetchMock() as unknown as typeof globalThis.fetch;

      const { clearSemanticIndex, semanticSearch } = await import(
        '../../src/services/semantic-search.js'
      );
      clearSemanticIndex('ss-topk-1');

      const rows = [
        makeRow(['A', 'B', 'C']),
        ...Array.from({ length: 30 }, (_, i) => makeRow([`row${i}`, i, i * 2])),
      ];
      const sheetsApi = makeSheetsApi(rows);

      const results = await semanticSearch(
        'ss-topk-1',
        'find rows',
        3,
        sheetsApi,
        'test-key-123',
        true
      );

      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('caches index — second call does not re-fetch the spreadsheet', async () => {
      process.env['VOYAGE_API_KEY'] = 'test-key-123';
      const fetchMock = makeFetchMock();
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const { clearSemanticIndex, indexSpreadsheet } = await import(
        '../../src/services/semantic-search.js'
      );
      clearSemanticIndex('ss-cache-1');

      const rows = [makeRow(['Name', 'Value']), makeRow(['Alpha', 100]), makeRow(['Beta', 200])];
      const sheetsApi = makeSheetsApi(rows);

      // First call — triggers index build
      await indexSpreadsheet('ss-cache-1', sheetsApi, 'test-key-123', true);
      const callsAfterFirst = (sheetsApi.spreadsheets.get as ReturnType<typeof vi.fn>).mock.calls
        .length;

      // Second call — should use cache (forceRefresh=false)
      await indexSpreadsheet('ss-cache-1', sheetsApi, 'test-key-123', false);
      const callsAfterSecond = (sheetsApi.spreadsheets.get as ReturnType<typeof vi.fn>).mock.calls
        .length;

      expect(callsAfterSecond).toBe(callsAfterFirst); // no additional API calls
    });

    it('forceReindex bypasses cache', async () => {
      process.env['VOYAGE_API_KEY'] = 'test-key-123';
      globalThis.fetch = makeFetchMock() as unknown as typeof globalThis.fetch;

      const { clearSemanticIndex, indexSpreadsheet } = await import(
        '../../src/services/semantic-search.js'
      );
      clearSemanticIndex('ss-force-1');

      const rows = [makeRow(['X', 'Y']), makeRow([1, 2])];
      const sheetsApi = makeSheetsApi(rows);

      await indexSpreadsheet('ss-force-1', sheetsApi, 'test-key-123', false);
      const callsAfterFirst = (sheetsApi.spreadsheets.get as ReturnType<typeof vi.fn>).mock.calls
        .length;

      await indexSpreadsheet('ss-force-1', sheetsApi, 'test-key-123', true);
      const callsAfterSecond = (sheetsApi.spreadsheets.get as ReturnType<typeof vi.fn>).mock.calls
        .length;

      expect(callsAfterSecond).toBeGreaterThan(callsAfterFirst);
    });
  });

  describe('empty spreadsheet', () => {
    it('returns empty results for a spreadsheet with no content', async () => {
      process.env['VOYAGE_API_KEY'] = 'test-key-123';
      globalThis.fetch = makeFetchMock() as unknown as typeof globalThis.fetch;

      const { clearSemanticIndex, semanticSearch } = await import(
        '../../src/services/semantic-search.js'
      );
      clearSemanticIndex('ss-empty-1');

      const sheetsApi = makeSheetsApi([]); // no rows
      const results = await semanticSearch(
        'ss-empty-1',
        'find anything',
        5,
        sheetsApi,
        'test-key-123',
        true
      );

      expect(results).toEqual([]);
    });
  });

  describe('embedding API error', () => {
    it('throws when the embedding API returns an error status', async () => {
      process.env['VOYAGE_API_KEY'] = 'bad-key';
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      }) as unknown as typeof globalThis.fetch;

      const { clearSemanticIndex, indexSpreadsheet } = await import(
        '../../src/services/semantic-search.js'
      );
      clearSemanticIndex('ss-err-1');

      const rows = [makeRow(['A', 'B']), makeRow([1, 2])];
      const sheetsApi = makeSheetsApi(rows);

      await expect(
        indexSpreadsheet('ss-err-1', sheetsApi, 'bad-key', true)
      ).rejects.toThrow('Embedding API error 401');
    });
  });

  describe('index stats', () => {
    it('getSemanticIndexStats reflects cached spreadsheets', async () => {
      process.env['VOYAGE_API_KEY'] = 'test-key-123';
      globalThis.fetch = makeFetchMock() as unknown as typeof globalThis.fetch;

      const { clearSemanticIndex, indexSpreadsheet, getSemanticIndexStats } = await import(
        '../../src/services/semantic-search.js'
      );
      clearSemanticIndex('ss-stats-1');
      clearSemanticIndex('ss-stats-2');

      const rows = [makeRow(['Col']), makeRow(['Val'])];
      const sheetsApi = makeSheetsApi(rows);

      const beforeCount = getSemanticIndexStats().cached;
      await indexSpreadsheet('ss-stats-1', sheetsApi, 'test-key-123', true);
      await indexSpreadsheet('ss-stats-2', sheetsApi, 'test-key-123', true);

      const stats = getSemanticIndexStats();
      expect(stats.cached).toBeGreaterThanOrEqual(beforeCount + 2);
      expect(stats.spreadsheetIds).toContain('ss-stats-1');
      expect(stats.spreadsheetIds).toContain('ss-stats-2');
    });
  });
});
