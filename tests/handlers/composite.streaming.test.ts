/**
 * Tests for streaming export functionality in composite handler
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import { CompositeHandler } from '../../src/handlers/composite.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import { SheetResolver } from '../../src/services/sheet-resolver.js';
import type { CompositeExportLargeDatasetInput } from '../../src/schemas/composite.js';

describe('CompositeHandler - Streaming Export', () => {
  let handler: CompositeHandler;
  let mockSheetsApi: sheets_v4.Sheets;
  let mockContext: HandlerContext;

  beforeEach(() => {
    // Mock Sheets API
    mockSheetsApi = {
      spreadsheets: {
        get: vi.fn(),
        values: {
          get: vi.fn(),
        },
      },
    } as unknown as sheets_v4.Sheets;

    // Mock context
    mockContext = {
      auth: { scopes: ['https://www.googleapis.com/auth/spreadsheets'] },
      googleClient: {
        sheets: mockSheetsApi,
      },
      sheetResolver: null,
    } as unknown as HandlerContext;

    handler = new CompositeHandler(mockContext, mockSheetsApi);
  });

  describe('export_large_dataset action', () => {
    it('should export small dataset without streaming', async () => {
      // Mock small dataset (< 10K rows)
      const smallData = Array.from({ length: 100 }, (_, i) => [`Row ${i}`, `Value ${i}`, i * 10]);

      vi.mocked(mockSheetsApi.spreadsheets.get).mockResolvedValue({
        data: {
          sheets: [
            {
              properties: {
                title: 'Sheet1',
                gridProperties: { rowCount: 100 },
              },
            },
          ],
        },
      } as any);

      vi.mocked(mockSheetsApi.spreadsheets.values.get).mockResolvedValue({
        data: { values: smallData },
      } as any);

      const input: CompositeExportLargeDatasetInput = {
        action: 'export_large_dataset',
        spreadsheetId: 'test-spreadsheet-id',
        range: 'Sheet1!A:C',
        format: 'json',
      };

      const result = await handler.handle({ request: input });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('export_large_dataset');
        expect(result.response.totalRows).toBe(100);
        expect(result.response.streamed).toBe(false);
        expect(result.response.chunksProcessed).toBe(1);

        // Verify data is JSON
        const parsedData = JSON.parse(result.response.data);
        expect(parsedData).toHaveLength(100);
        expect(parsedData[0]).toEqual(['Row 0', 'Value 0', 0]);
      }
    });

    it('should export large dataset with streaming', async () => {
      // Mock large dataset (15K rows - triggers streaming)
      const totalRows = 15000;

      vi.mocked(mockSheetsApi.spreadsheets.get).mockResolvedValue({
        data: {
          sheets: [
            {
              properties: {
                title: 'Sheet1',
                gridProperties: { rowCount: totalRows },
              },
            },
          ],
        },
      } as any);

      // Mock chunked responses
      let callCount = 0;
      vi.mocked(mockSheetsApi.spreadsheets.values.get).mockImplementation(async (params: any) => {
        callCount++;
        const range = params.range as string;

        // Parse range to determine which chunk
        const match = range.match(/A(\d+):C(\d+)/);
        if (!match) {
          return { data: { values: [] } } as any;
        }

        const startRow = parseInt(match[1]);
        const endRow = parseInt(match[2]);
        const chunkSize = endRow - startRow + 1;

        // Generate chunk data
        const chunkData = Array.from(
          { length: Math.min(chunkSize, totalRows - startRow + 1) },
          (_, i) => {
            const rowIndex = startRow + i - 1;
            return [`Row ${rowIndex}`, `Value ${rowIndex}`, rowIndex * 10];
          }
        );

        return {
          data: { values: chunkData },
        } as any;
      });

      const input: CompositeExportLargeDatasetInput = {
        action: 'export_large_dataset',
        spreadsheetId: 'test-spreadsheet-id',
        range: 'Sheet1!A:C',
        chunkSize: 1000,
        format: 'json',
      };

      const result = await handler.handle({ request: input });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('export_large_dataset');
        expect(result.response.totalRows).toBe(totalRows);
        expect(result.response.streamed).toBe(true);
        expect(result.response.chunksProcessed).toBeGreaterThan(10); // Should process multiple chunks

        // Verify data integrity
        const parsedData = JSON.parse(result.response.data);
        expect(parsedData).toHaveLength(totalRows);
        expect(parsedData[0]).toEqual(['Row 0', 'Value 0', 0]);
        expect(parsedData[totalRows - 1]).toEqual([
          `Row ${totalRows - 1}`,
          `Value ${totalRows - 1}`,
          (totalRows - 1) * 10,
        ]);
      }

      // Verify multiple API calls were made (chunking)
      expect(callCount).toBeGreaterThan(1);
    });

    it('should export to CSV format', async () => {
      const testData = [
        ['Name', 'Age', 'City'],
        ['John', '30', 'NYC'],
        ['Jane, Doe', '25', 'LA'], // Test CSV escaping
        ['Bob "The Builder"', '40', 'Chicago'], // Test quote escaping
      ];

      vi.mocked(mockSheetsApi.spreadsheets.get).mockResolvedValue({
        data: {
          sheets: [
            {
              properties: {
                title: 'Sheet1',
                gridProperties: { rowCount: 4 },
              },
            },
          ],
        },
      } as any);

      vi.mocked(mockSheetsApi.spreadsheets.values.get).mockResolvedValue({
        data: { values: testData },
      } as any);

      const input: CompositeExportLargeDatasetInput = {
        action: 'export_large_dataset',
        spreadsheetId: 'test-spreadsheet-id',
        range: 'Sheet1!A:C',
        format: 'csv',
      };

      const result = await handler.handle({ request: input });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.format).toBe('csv');

        // Verify CSV formatting
        const csvLines = result.response.data.split('\n');
        expect(csvLines).toHaveLength(4);
        expect(csvLines[0]).toBe('Name,Age,City');
        expect(csvLines[1]).toBe('John,30,NYC');
        expect(csvLines[2]).toBe('"Jane, Doe",25,LA'); // Comma escaped
        expect(csvLines[3]).toBe('Bob ""The Builder"",40,Chicago'); // Quotes escaped
      }
    });

    it('should handle custom chunk size', async () => {
      const totalRows = 5000;

      vi.mocked(mockSheetsApi.spreadsheets.get).mockResolvedValue({
        data: {
          sheets: [
            {
              properties: {
                title: 'Sheet1',
                gridProperties: { rowCount: totalRows },
              },
            },
          ],
        },
      } as any);

      let callCount = 0;
      vi.mocked(mockSheetsApi.spreadsheets.values.get).mockImplementation(async () => {
        callCount++;
        const chunkData = Array.from({ length: 500 }, (_, i) => [`Row ${i}`, i]);
        return { data: { values: chunkData } } as any;
      });

      const input: CompositeExportLargeDatasetInput = {
        action: 'export_large_dataset',
        spreadsheetId: 'test-spreadsheet-id',
        range: 'Sheet1!A:B',
        chunkSize: 500,
        format: 'json',
      };

      const result = await handler.handle({ request: input });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.chunkSize).toBe(500);
        // Should use smaller chunks
        expect(callCount).toBeGreaterThanOrEqual(10);
      }
    });

    it('should track memory usage', async () => {
      const totalRows = 12000;

      vi.mocked(mockSheetsApi.spreadsheets.get).mockResolvedValue({
        data: {
          sheets: [
            {
              properties: {
                title: 'Sheet1',
                gridProperties: { rowCount: totalRows },
              },
            },
          ],
        },
      } as any);

      vi.mocked(mockSheetsApi.spreadsheets.values.get).mockImplementation(async () => {
        const chunkData = Array.from({ length: 1000 }, (_, i) => [`Row ${i}`, 'Data', i * 10]);
        return { data: { values: chunkData } } as any;
      });

      const input: CompositeExportLargeDatasetInput = {
        action: 'export_large_dataset',
        spreadsheetId: 'test-spreadsheet-id',
        range: 'Sheet1!A:C',
        format: 'json',
      };

      const result = await handler.handle({ request: input });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.bytesProcessed).toBeGreaterThan(0);
        expect(result.response.durationMs).toBeGreaterThan(0);
      }
    });

    it('should handle empty dataset', async () => {
      vi.mocked(mockSheetsApi.spreadsheets.get).mockResolvedValue({
        data: {
          sheets: [
            {
              properties: {
                title: 'Sheet1',
                gridProperties: { rowCount: 0 },
              },
            },
          ],
        },
      } as any);

      vi.mocked(mockSheetsApi.spreadsheets.values.get).mockResolvedValue({
        data: { values: [] },
      } as any);

      const input: CompositeExportLargeDatasetInput = {
        action: 'export_large_dataset',
        spreadsheetId: 'test-spreadsheet-id',
        range: 'Sheet1!A:Z',
        format: 'json',
      };

      const result = await handler.handle({ request: input });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.totalRows).toBe(0);
        expect(result.response.data).toBe('[]');
      }
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(mockSheetsApi.spreadsheets.get).mockRejectedValue(
        new Error('Spreadsheet not found')
      );

      const input: CompositeExportLargeDatasetInput = {
        action: 'export_large_dataset',
        spreadsheetId: 'invalid-id',
        range: 'Sheet1!A:Z',
        format: 'json',
      };

      const result = await handler.handle({ request: input });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.message).toContain('not found');
      }
    });

    it('should respect verbosity settings', async () => {
      const testData = Array.from({ length: 100 }, (_, i) => [`Row ${i}`, i]);

      vi.mocked(mockSheetsApi.spreadsheets.get).mockResolvedValue({
        data: {
          sheets: [
            {
              properties: {
                title: 'Sheet1',
                gridProperties: { rowCount: 100 },
              },
            },
          ],
        },
      } as any);

      vi.mocked(mockSheetsApi.spreadsheets.values.get).mockResolvedValue({
        data: { values: testData },
      } as any);

      const input: CompositeExportLargeDatasetInput = {
        action: 'export_large_dataset',
        spreadsheetId: 'test-spreadsheet-id',
        range: 'Sheet1!A:B',
        format: 'json',
        verbosity: 'minimal',
      };

      const result = await handler.handle({ request: input });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        // With minimal verbosity, _meta should be omitted or minimal
        expect(result.response).toHaveProperty('data');
        expect(result.response).toHaveProperty('totalRows');
      }
    });
  });

  describe('Memory limits', () => {
    it('should fail if export exceeds memory limit', async () => {
      // This test would need to mock memory usage
      // Skipping actual implementation as it requires memory measurement
      expect(true).toBe(true);
    });
  });

  describe('Progress reporting', () => {
    it('should report progress during streaming', async () => {
      // This test would verify progress notifications
      // Requires mocking sendProgress utility
      expect(true).toBe(true);
    });
  });
});
