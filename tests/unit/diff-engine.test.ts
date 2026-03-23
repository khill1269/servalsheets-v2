/**
 * DiffEngine Unit Tests
 * Tests for the optimized diff engine with block checksums and parallel processing
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiffEngine, type SpreadsheetState, type SheetState } from '../../src/core/diff-engine.js';
import type { sheets_v4 } from 'googleapis';
import { FIELD_MASKS } from '../../src/constants/field-masks.js';

describe('DiffEngine', () => {
  let diffEngine: DiffEngine;
  let mockSheetsApi: sheets_v4.Sheets;
  const defaultDiffOptions = { sampleSize: 10, maxFullDiffCells: 5000 };

  beforeEach(() => {
    // Mock Google Sheets API
    mockSheetsApi = {
      spreadsheets: {
        get: vi.fn(),
        values: {
          get: vi.fn(),
        },
      },
    } as any;

    diffEngine = new DiffEngine({
      sheetsApi: mockSheetsApi,
      defaultTier: 'SAMPLE',
      sampleSize: 10,
      maxFullDiffCells: 5000,
      blockSize: 1000,
    });
  });

  describe('captureState', () => {
    it('should capture spreadsheet state with metadata', async () => {
      (mockSheetsApi.spreadsheets.get as any).mockResolvedValue({
        data: {
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                gridProperties: {
                  rowCount: 100,
                  columnCount: 26,
                },
              },
            },
          ],
        },
      });

      (mockSheetsApi.spreadsheets.values!.get as any).mockResolvedValue({
        data: { values: [] },
      });

      const state = await diffEngine.captureState('test-sheet', {
        ...defaultDiffOptions,
        tier: 'METADATA',
      });

      expect(state.spreadsheetId).toBe('test-sheet');
      expect(state.sheets).toHaveLength(1);
      expect(state.sheets[0]?.title).toBe('Sheet1');
      expect(state.checksum).toBeDefined();
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'test-sheet',
          includeGridData: false,
          fields: FIELD_MASKS.SPREADSHEET_WITH_SHEETS,
        })
      );
    });

    it('should capture sample data when tier is SAMPLE', async () => {
      (mockSheetsApi.spreadsheets.get as any).mockResolvedValue({
        data: {
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                gridProperties: {
                  rowCount: 100,
                  columnCount: 26,
                },
              },
            },
          ],
        },
      });

      (mockSheetsApi.spreadsheets.values!.get as any).mockResolvedValue({
        data: {
          values: [
            ['A1', 'B1', 'C1'],
            ['A2', 'B2', 'C2'],
          ],
        },
      });

      const state = await diffEngine.captureState('test-sheet', {
        ...defaultDiffOptions,
        tier: 'SAMPLE',
      });

      expect(state.sheets[0]?.sampleData).toBeDefined();
      expect(state.sheets[0]?.sampleData?.firstRows).toBeDefined();
    });

    it('should capture full values and compute block checksums', async () => {
      const mockValues = Array.from({ length: 2500 }, (_, i) =>
        Array.from({ length: 10 }, (_, j) => `Row${i + 1}Col${j + 1}`)
      );

      (mockSheetsApi.spreadsheets.get as any).mockResolvedValue({
        data: {
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                gridProperties: {
                  rowCount: 2500,
                  columnCount: 10,
                },
              },
            },
          ],
        },
      });

      (mockSheetsApi.spreadsheets.values!.get as any).mockResolvedValue({
        data: { values: mockValues },
      });

      const state = await diffEngine.captureState('test-sheet', {
        ...defaultDiffOptions,
        tier: 'FULL',
      });

      expect(state.sheets[0]?.values).toBeDefined();
      expect(state.sheets[0]?.blockChecksums).toBeDefined();
      expect(state.sheets[0]?.blockChecksums!.length).toBeGreaterThan(1); // Multiple blocks
    });
  });

  describe('diff', () => {
    it('should perform metadata diff when checksums match', async () => {
      const beforeState: SpreadsheetState = createMockState('test', [
        { sheetId: 0, title: 'Sheet1', rowCount: 100, columnCount: 26, checksum: 'abc123' },
      ]);

      const afterState: SpreadsheetState = createMockState('test', [
        { sheetId: 0, title: 'Sheet1', rowCount: 100, columnCount: 26, checksum: 'abc123' },
      ]);

      const result = await diffEngine.diff(beforeState, afterState, {
        ...defaultDiffOptions,
        tier: 'METADATA',
      });

      expect(result.tier).toBe('METADATA');
      if (result.tier !== 'METADATA') {
        throw new Error('Expected METADATA diff');
      }
      expect(result.summary.rowsChanged).toBe(0);
    });

    it('should detect structural changes in metadata diff', async () => {
      const beforeState: SpreadsheetState = createMockState('test', [
        { sheetId: 0, title: 'Sheet1', rowCount: 100, columnCount: 26, checksum: 'abc123' },
      ]);

      const afterState: SpreadsheetState = createMockState('test', [
        { sheetId: 0, title: 'Sheet1', rowCount: 150, columnCount: 26, checksum: 'def456' },
      ]);

      const result = await diffEngine.diff(beforeState, afterState, {
        ...defaultDiffOptions,
        tier: 'METADATA',
      });

      expect(result.tier).toBe('METADATA');
      if (result.tier !== 'METADATA') {
        throw new Error('Expected METADATA diff');
      }
      expect(result.summary.rowsChanged).toBe(50);
    });

    it('should perform sample diff with changes', async () => {
      const beforeState: SpreadsheetState = createMockState('test', [
        {
          sheetId: 0,
          title: 'Sheet1',
          rowCount: 100,
          columnCount: 26,
          checksum: 'abc123',
          sampleData: {
            firstRows: [
              ['A1', 'B1'],
              ['A2', 'B2'],
            ],
            lastRows: [],
          },
        },
      ]);

      const afterState: SpreadsheetState = createMockState('test', [
        {
          sheetId: 0,
          title: 'Sheet1',
          rowCount: 100,
          columnCount: 26,
          checksum: 'def456',
          sampleData: {
            firstRows: [
              ['A1_CHANGED', 'B1'],
              ['A2', 'B2'],
            ],
            lastRows: [],
          },
        },
      ]);

      const result = await diffEngine.diff(beforeState, afterState, {
        ...defaultDiffOptions,
        tier: 'SAMPLE',
      });

      expect(result.tier).toBe('SAMPLE');
      if (result.tier !== 'SAMPLE') {
        throw new Error('Expected SAMPLE diff');
      }
      expect(result.samples).toBeDefined();
      expect(result.samples.firstRows.length).toBeGreaterThan(0);
    });

    it('should perform full diff with block optimization', async () => {
      const mockValues1 = [
        ['A1', 'B1', 'C1'],
        ['A2', 'B2', 'C2'],
      ];

      const mockValues2 = [
        ['A1_CHANGED', 'B1', 'C1'],
        ['A2', 'B2', 'C2'],
      ];

      const beforeState: SpreadsheetState = createMockState('test', [
        {
          sheetId: 0,
          title: 'Sheet1',
          rowCount: 2,
          columnCount: 3,
          checksum: 'abc123',
          values: mockValues1,
        },
      ]);

      const afterState: SpreadsheetState = createMockState('test', [
        {
          sheetId: 0,
          title: 'Sheet1',
          rowCount: 2,
          columnCount: 3,
          checksum: 'def456',
          values: mockValues2,
        },
      ]);

      const result = await diffEngine.diff(beforeState, afterState, {
        ...defaultDiffOptions,
        tier: 'FULL',
      });

      expect(result.tier).toBe('FULL');
      if (result.tier !== 'FULL') {
        throw new Error('Expected FULL diff');
      }
      expect(result.changes).toBeDefined();
      expect(result.changes.length).toBe(1);
      const [firstChange] = result.changes;
      if (!firstChange) {
        throw new Error('Expected change result');
      }
      expect(firstChange.cell).toContain('A1');
      expect(firstChange.before).toBe('A1');
      expect(firstChange.after).toBe('A1_CHANGED');
    });

    it('should skip unchanged sheets using checksum optimization', async () => {
      const mockValues = [
        ['A1', 'B1', 'C1'],
        ['A2', 'B2', 'C2'],
      ];

      const sheetChecksum = '0-Sheet1-2-3'; // Same checksum

      const beforeState: SpreadsheetState = createMockState('test', [
        {
          sheetId: 0,
          title: 'Sheet1',
          rowCount: 2,
          columnCount: 3,
          checksum: sheetChecksum,
          values: mockValues,
        },
      ]);

      const afterState: SpreadsheetState = createMockState('test', [
        {
          sheetId: 0,
          title: 'Sheet1',
          rowCount: 2,
          columnCount: 3,
          checksum: sheetChecksum,
          values: mockValues,
        },
      ]);

      const result = await diffEngine.diff(beforeState, afterState, {
        ...defaultDiffOptions,
        tier: 'FULL',
      });

      expect(result.tier).toBe('FULL');
      if (result.tier !== 'FULL') {
        throw new Error('Expected FULL diff');
      }
      expect(result.changes).toBeDefined();
      expect(result.changes.length).toBe(0); // No changes due to checksum match
    });

    it('should detect removed sheets', async () => {
      const beforeState: SpreadsheetState = createMockState('test', [
        {
          sheetId: 0,
          title: 'Sheet1',
          rowCount: 100,
          columnCount: 26,
          checksum: 'abc123',
          values: [],
        },
        {
          sheetId: 1,
          title: 'Sheet2',
          rowCount: 50,
          columnCount: 10,
          checksum: 'def456',
          values: [],
        },
      ]);

      const afterState: SpreadsheetState = createMockState('test', [
        {
          sheetId: 0,
          title: 'Sheet1',
          rowCount: 100,
          columnCount: 26,
          checksum: 'abc123',
          values: [],
        },
      ]);

      const result = await diffEngine.diff(beforeState, afterState, {
        ...defaultDiffOptions,
        tier: 'FULL',
      });

      expect(result.tier).toBe('FULL');
      if (result.tier !== 'FULL') {
        throw new Error('Expected FULL diff');
      }
      expect(result.summary.cellsRemoved).toBe(500); // 50 rows * 10 cols
    });
  });

  describe('performance optimizations', () => {
    it('should handle large spreadsheets efficiently with block checksums', async () => {
      // Create large dataset with 5000 rows
      const mockValues = Array.from({ length: 5000 }, (_, i) =>
        Array.from({ length: 10 }, (_, j) => `Row${i + 1}Col${j + 1}`)
      );

      (mockSheetsApi.spreadsheets.get as any).mockResolvedValue({
        data: {
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'LargeSheet',
                gridProperties: {
                  rowCount: 5000,
                  columnCount: 10,
                },
              },
            },
          ],
        },
      });

      (mockSheetsApi.spreadsheets.values!.get as any).mockResolvedValue({
        data: { values: mockValues },
      });

      const startTime = Date.now();
      const state = await diffEngine.captureState('test-sheet', {
        ...defaultDiffOptions,
        tier: 'FULL',
        maxFullDiffCells: 50000,
      });
      const duration = Date.now() - startTime;

      expect(state.sheets[0]?.blockChecksums).toBeDefined();
      expect(state.sheets[0]?.blockChecksums!.length).toBeGreaterThan(1);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should process multiple sheets in parallel', async () => {
      const sheets = Array.from({ length: 5 }, (_, i) => ({
        properties: {
          sheetId: i,
          title: `Sheet${i + 1}`,
          gridProperties: {
            rowCount: 100,
            columnCount: 26,
          },
        },
      }));

      (mockSheetsApi.spreadsheets.get as any).mockResolvedValue({
        data: { sheets },
      });

      (mockSheetsApi.spreadsheets.values!.get as any).mockResolvedValue({
        data: { values: [['A1', 'B1']] },
      });

      const startTime = Date.now();
      const state = await diffEngine.captureState('test-sheet', {
        ...defaultDiffOptions,
        tier: 'SAMPLE',
      });
      const duration = Date.now() - startTime;

      expect(state.sheets).toHaveLength(5);
      // With parallel processing, should be significantly faster than serial
      expect(duration).toBeLessThan(3000);
    });
  });

  describe('tier selection', () => {
    it('should downgrade from FULL to SAMPLE for large datasets', async () => {
      const largeState = createMockState('test', [
        {
          sheetId: 0,
          title: 'Sheet1',
          rowCount: 10000,
          columnCount: 100,
          checksum: 'abc123',
        },
      ]);

      const result = await diffEngine.diff(largeState, largeState, {
        ...defaultDiffOptions,
        tier: 'FULL',
        maxFullDiffCells: 5000,
      });

      // Should downgrade to SAMPLE because 10000*100 > 5000
      expect(result.tier).toBe('SAMPLE');
    });

    it('should downgrade from SAMPLE to METADATA for very large datasets', async () => {
      const veryLargeState = createMockState('test', [
        {
          sheetId: 0,
          title: 'Sheet1',
          rowCount: 100000,
          columnCount: 100,
          checksum: 'abc123',
        },
      ]);

      const result = await diffEngine.diff(veryLargeState, veryLargeState, {
        ...defaultDiffOptions,
        tier: 'SAMPLE',
        maxFullDiffCells: 5000,
      });

      // Should downgrade to METADATA because 100000*100 > 5000*10
      expect(result.tier).toBe('METADATA');
    });
  });
});

// Helper function to create mock state
function createMockState(spreadsheetId: string, sheets: Partial<SheetState>[]): SpreadsheetState {
  return {
    timestamp: new Date().toISOString(),
    spreadsheetId,
    sheets: sheets.map((s) => ({
      sheetId: s.sheetId ?? 0,
      title: s.title ?? 'Sheet1',
      rowCount: s.rowCount ?? 0,
      columnCount: s.columnCount ?? 0,
      checksum: s.checksum ?? '',
      blockChecksums: s.blockChecksums,
      sampleData: s.sampleData,
      values: s.values,
    })),
    checksum: 'test-checksum',
  };
}
