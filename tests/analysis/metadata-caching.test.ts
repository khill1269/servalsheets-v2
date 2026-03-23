/**
 * Tests for metadata caching optimization in comprehensive analysis
 *
 * Note: Actual caching behavior is tested in cache-manager tests.
 * These tests verify correct usage of caching APIs and field mask optimization.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import { ComprehensiveAnalyzer } from '../../src/analysis/comprehensive.js';

/**
 * Test accessor type for private methods
 */
type ComprehensiveAnalyzerPrivate = {
  getSpreadsheetInfo: (spreadsheetId: string) => Promise<{
    locale?: string;
    timeZone?: string;
    namedRanges: Array<{ name: string; range: string }>;
  }>;
  enrichWithFormulas: (spreadsheetId: string, sheetAnalyses: unknown[]) => Promise<void>;
};

describe('Metadata Fetch Optimization', () => {
  let mockSheetsApi: sheets_v4.Sheets;

  beforeEach(() => {
    // Create mock Sheets API
    mockSheetsApi = {
      spreadsheets: {
        get: vi.fn(),
      },
    } as unknown as sheets_v4.Sheets;
  });

  describe('getSpreadsheetInfo optimization', () => {
    it('should fetch spreadsheet info with correct data', async () => {
      const spreadsheetId = 'test-123';
      const mockResponse = {
        data: {
          properties: {
            locale: 'en_US',
            timeZone: 'America/New_York',
          },
          namedRanges: [
            {
              name: 'TestRange',
              range: {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 10,
                startColumnIndex: 0,
                endColumnIndex: 5,
              },
            },
          ],
        },
      };

      vi.mocked(mockSheetsApi.spreadsheets.get).mockResolvedValue(mockResponse);

      const analyzer = new ComprehensiveAnalyzer(mockSheetsApi, {
        includeFormulas: false,
        includeVisualizations: false,
        includePerformance: false,
      });

      const result = await (analyzer as unknown as ComprehensiveAnalyzerPrivate).getSpreadsheetInfo(
        spreadsheetId
      );
      expect(result.locale).toBe('en_US');
      expect(result.timeZone).toBe('America/New_York');
      expect(result.namedRanges).toHaveLength(1);
      expect(result.namedRanges[0]?.name).toBe('TestRange');
    });

    it('should use optimized field mask to reduce payload size', async () => {
      const spreadsheetId = 'test-456';
      const mockResponse = {
        data: {
          properties: { locale: 'en_US' },
          namedRanges: [],
        },
      };

      vi.mocked(mockSheetsApi.spreadsheets.get).mockResolvedValue(mockResponse);

      const analyzer = new ComprehensiveAnalyzer(mockSheetsApi);
      await (analyzer as unknown as ComprehensiveAnalyzerPrivate).getSpreadsheetInfo(spreadsheetId);

      // Verify optimized field mask is used (not fetching full spreadsheet data)
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledWith({
        spreadsheetId,
        fields: 'properties,namedRanges',
      });
    });

    it('should handle API errors gracefully', async () => {
      const spreadsheetId = 'test-error';

      vi.mocked(mockSheetsApi.spreadsheets.get).mockRejectedValue(new Error('API error'));

      const analyzer = new ComprehensiveAnalyzer(mockSheetsApi);

      // Should return default values on error
      const result = await (analyzer as unknown as ComprehensiveAnalyzerPrivate).getSpreadsheetInfo(
        spreadsheetId
      );
      expect(result.namedRanges).toEqual([]);
      expect(result.locale).toBeUndefined();
    });
  });

  describe('enrichWithFormulas optimization', () => {
    it('should process formula data correctly', async () => {
      const spreadsheetId = 'test-formulas';
      const mockResponse = {
        data: {
          sheets: [
            {
              properties: { sheetId: 0 },
              data: [
                {
                  rowData: [
                    {
                      values: [
                        {
                          userEnteredValue: {
                            formulaValue: '=SUM(A1:A10)',
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      };

      vi.mocked(mockSheetsApi.spreadsheets.get).mockResolvedValue(mockResponse);

      const analyzer = new ComprehensiveAnalyzer(mockSheetsApi, {
        includeFormulas: true,
      });

      const sheetAnalyses = [
        {
          sheetId: 0,
          sheetName: 'Sheet1',
          rowCount: 10,
          columnCount: 5,
          dataRowCount: 10,
          headerRow: ['A', 'B', 'C', 'D', 'E'],
          columns: [],
          qualityIssues: [],
          trends: [],
          anomalies: [],
          correlations: [],
        },
      ];

      await (analyzer as unknown as ComprehensiveAnalyzerPrivate).enrichWithFormulas(
        spreadsheetId,
        sheetAnalyses
      );
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalled();
    });

    it('should use highly optimized field mask (formulas only, no effectiveValue)', async () => {
      const spreadsheetId = 'test-optimized';
      const mockResponse = {
        data: {
          sheets: [
            {
              properties: { sheetId: 0 },
              data: [{ rowData: [] }],
            },
          ],
        },
      };

      vi.mocked(mockSheetsApi.spreadsheets.get).mockResolvedValue(mockResponse);

      const analyzer = new ComprehensiveAnalyzer(mockSheetsApi, {
        includeFormulas: true,
      });

      await (analyzer as unknown as ComprehensiveAnalyzerPrivate).enrichWithFormulas(
        spreadsheetId,
        []
      );

      // Verify highly optimized field mask (fetches only formulas, not effectiveValue)
      // This reduces payload size by ~50% compared to fetching both fields
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledWith({
        spreadsheetId,
        includeGridData: true,
        fields: 'sheets(properties.sheetId,data.rowData.values.userEnteredValue.formulaValue)',
      });
    });

    it('should handle API errors gracefully without adding formula data', async () => {
      const spreadsheetId = 'test-error';

      vi.mocked(mockSheetsApi.spreadsheets.get).mockRejectedValue(new Error('Network error'));

      const analyzer = new ComprehensiveAnalyzer(mockSheetsApi, {
        includeFormulas: true,
      });

      const sheetAnalyses = [
        {
          sheetId: 0,
          sheetName: 'Sheet1',
          rowCount: 10,
          columnCount: 5,
          dataRowCount: 10,
          headerRow: [],
          columns: [],
          qualityIssues: [],
          trends: [],
          anomalies: [],
          correlations: [],
        },
      ];

      // Should handle error gracefully
      await (analyzer as unknown as ComprehensiveAnalyzerPrivate).enrichWithFormulas(
        spreadsheetId,
        sheetAnalyses
      );
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalled();

      // Formula data should not be added on error
      expect(sheetAnalyses[0]!.formulas).toBeUndefined();
    });
  });

  describe('field mask benefits', () => {
    it('should demonstrate payload reduction with getSpreadsheetInfo field mask', async () => {
      const spreadsheetId = 'test-payload-reduction';
      const mockResponse = {
        data: {
          properties: { locale: 'en_US', timeZone: 'America/New_York' },
          namedRanges: [],
        },
      };

      vi.mocked(mockSheetsApi.spreadsheets.get).mockResolvedValue(mockResponse);

      const analyzer = new ComprehensiveAnalyzer(mockSheetsApi);
      await (analyzer as unknown as ComprehensiveAnalyzerPrivate).getSpreadsheetInfo(spreadsheetId);

      const call = vi.mocked(mockSheetsApi.spreadsheets.get).mock.calls[0]![0];

      // Field mask should only fetch properties and namedRanges
      // This excludes sheets.data (largest payload component)
      expect(call.fields).toBe('properties,namedRanges');
      expect(call.fields).not.toContain('sheets.data');
      expect(call.includeGridData).toBeUndefined();
    });

    it('should use different field masks for different operations', async () => {
      const spreadsheetId = 'test-field-masks';

      // Mock for getSpreadsheetInfo
      vi.mocked(mockSheetsApi.spreadsheets.get).mockResolvedValueOnce({
        data: {
          properties: { locale: 'en_US' },
          namedRanges: [],
        },
      });

      // Mock for enrichWithFormulas
      vi.mocked(mockSheetsApi.spreadsheets.get).mockResolvedValueOnce({
        data: {
          sheets: [{ properties: { sheetId: 0 }, data: [{ rowData: [] }] }],
        },
      });

      const analyzer = new ComprehensiveAnalyzer(mockSheetsApi, {
        includeFormulas: true,
      });

      // Call getSpreadsheetInfo
      await (analyzer as unknown as ComprehensiveAnalyzerPrivate).getSpreadsheetInfo(spreadsheetId);
      const infoCall = vi.mocked(mockSheetsApi.spreadsheets.get).mock.calls[0]![0];
      expect(infoCall.fields).toBe('properties,namedRanges');

      // Call enrichWithFormulas
      await (analyzer as unknown as ComprehensiveAnalyzerPrivate).enrichWithFormulas(
        spreadsheetId,
        []
      );
      const formulaCall = vi.mocked(mockSheetsApi.spreadsheets.get).mock.calls[1]![0];
      expect(formulaCall.fields).toBe(
        'sheets(properties.sheetId,data.rowData.values.userEnteredValue.formulaValue)'
      );

      // Verify different optimizations for different use cases
      expect(infoCall.fields).not.toBe(formulaCall.fields);
    });
  });
});
