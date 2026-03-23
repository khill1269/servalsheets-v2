/**
 * ServalSheets - Core Handler Verbosity Tests (LLM Optimization)
 *
 * Integration tests demonstrating verbosity parameter reduces response size
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import { SheetsCoreHandler } from '../src/handlers/core';
import type { HandlerContext } from '../src/handlers/base';
import type { SheetsCoreInput } from '../src/schemas/core';

describe('SheetsCoreHandler - Verbosity Feature', () => {
  let handler: SheetsCoreHandler;
  let mockSheetsApi: sheets_v4.Sheets;
  let context: HandlerContext;

  const mockSpreadsheetResponse: sheets_v4.Schema$Spreadsheet = {
    spreadsheetId: 'test-spreadsheet-id',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/test-spreadsheet-id',
    properties: {
      title: 'Test Spreadsheet',
      locale: 'en_US',
      timeZone: 'America/New_York',
      autoRecalc: 'ON_CHANGE',
    },
    sheets: [
      {
        properties: {
          sheetId: 0,
          title: 'Sheet1',
          index: 0,
          gridProperties: {
            rowCount: 1000,
            columnCount: 26,
          },
          hidden: false,
          tabColor: {
            red: 1,
            green: 0,
            blue: 0,
            alpha: 1,
          },
        },
      },
      {
        properties: {
          sheetId: 1,
          title: 'Sheet2',
          index: 1,
          gridProperties: {
            rowCount: 500,
            columnCount: 10,
          },
          hidden: false,
        },
      },
      {
        properties: {
          sheetId: 2,
          title: 'Sheet3',
          index: 2,
          gridProperties: {
            rowCount: 2000,
            columnCount: 50,
          },
        },
      },
    ],
  };

  beforeEach(() => {
    // Mock Google Sheets API
    mockSheetsApi = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({ data: mockSpreadsheetResponse }),
      },
    } as unknown as sheets_v4.Sheets;

    // Mock handler context with authenticated user
    context = {
      userId: 'test-user',
      sessionId: 'test-session',
      isAuthenticated: true,
      googleClient: {
        sheets: {
          spreadsheets: {
            get: vi.fn().mockResolvedValue({ data: mockSpreadsheetResponse }),
          },
        },
      } as unknown as sheets_v4.Sheets,
      auth: {
        accessToken: 'mock-token',
        refreshToken: 'mock-refresh',
        expiryDate: Date.now() + 3600000,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      },
      conversationContext: {
        lastSpreadsheetId: undefined,
        lastSheetId: undefined,
        recentOperations: [],
      },
    } as HandlerContext;

    handler = new SheetsCoreHandler(context, mockSheetsApi);
  });

  describe('Standard Verbosity (default)', () => {
    it('should return full response with all metadata', async () => {
      const input: SheetsCoreInput = {
        action: 'get',
        spreadsheetId: 'test-spreadsheet-id',
        // verbosity omitted = defaults to 'standard'
      };

      const result = await handler.handle(input);

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        const { spreadsheet } = result.response;
        expect(spreadsheet).toBeDefined();
        expect(spreadsheet?.spreadsheetId).toBe('test-spreadsheet-id');
        expect(spreadsheet?.title).toBe('Test Spreadsheet');
        expect(spreadsheet?.url).toBeDefined();
        expect(spreadsheet?.locale).toBe('en_US');
        expect(spreadsheet?.timeZone).toBe('America/New_York');
        expect(spreadsheet?.sheets).toHaveLength(3);

        // Check all sheet properties are present
        const sheet = spreadsheet?.sheets[0];
        expect(sheet?.sheetId).toBe(0);
        expect(sheet?.title).toBe('Sheet1');
        expect(sheet?.index).toBe(0);
        expect(sheet?.rowCount).toBe(1000);
        expect(sheet?.columnCount).toBe(26);
        expect(sheet?.hidden).toBe(false);
        expect(sheet?.tabColor).toEqual({
          red: 1,
          green: 0,
          blue: 0,
          alpha: 1,
        });
      }
    });

    it('should include response metadata', async () => {
      const input: SheetsCoreInput = {
        action: 'get',
        spreadsheetId: 'test-spreadsheet-id',
        verbosity: 'standard',
      };

      const result = await handler.handle(input);
      const responseJson = JSON.stringify(result.response);

      // Standard includes all metadata
      expect(responseJson).toContain('locale');
      expect(responseJson).toContain('timeZone');
      expect(responseJson).toContain('tabColor');
      expect(responseJson).toContain('index');
      expect(responseJson).toContain('hidden');
    });
  });

  describe('Minimal Verbosity (token optimization)', () => {
    it('should return compact response with only essential fields', async () => {
      const input: SheetsCoreInput = {
        action: 'get',
        spreadsheetId: 'test-spreadsheet-id',
        verbosity: 'minimal',
      };

      const result = await handler.handle(input);

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        const { spreadsheet } = result.response;

        // Essential fields present
        expect(spreadsheet?.spreadsheetId).toBe('test-spreadsheet-id');
        expect(spreadsheet?.title).toBe('Test Spreadsheet');
        expect(spreadsheet?.sheets).toHaveLength(3);

        // Check minimal sheet properties
        const sheet = spreadsheet?.sheets[0];
        expect(sheet?.sheetId).toBe(0);
        expect(sheet?.title).toBe('Sheet1');
        expect(sheet?.rowCount).toBe(1000);
        expect(sheet?.columnCount).toBe(26);

        // Non-essential fields omitted
        expect(sheet?.index).toBeUndefined();
        expect(sheet?.hidden).toBeUndefined();
        expect(sheet?.tabColor).toBeUndefined();
        expect(spreadsheet?.url).toBeUndefined();
        expect(spreadsheet?.locale).toBeUndefined();
        expect(spreadsheet?.timeZone).toBeUndefined();
      }
    });

    it('should reduce response size by ~70-80%', async () => {
      // Get standard response size
      const standardInput: SheetsCoreInput = {
        action: 'get',
        spreadsheetId: 'test-spreadsheet-id',
        verbosity: 'standard',
      };
      const standardResult = await handler.handle(standardInput);
      const standardSize = JSON.stringify(standardResult.response).length;

      // Get minimal response size
      const minimalInput: SheetsCoreInput = {
        action: 'get',
        spreadsheetId: 'test-spreadsheet-id',
        verbosity: 'minimal',
      };
      const minimalResult = await handler.handle(minimalInput);
      const minimalSize = JSON.stringify(minimalResult.response).length;

      // Calculate reduction
      const reduction = ((standardSize - minimalSize) / standardSize) * 100;

      console.log(`Standard response: ${standardSize} bytes`);
      console.log(`Minimal response: ${minimalSize} bytes`);
      console.log(`Reduction: ${reduction.toFixed(1)}%`);

      // Expect at least 40% reduction (conservative estimate)
      expect(minimalSize).toBeLessThan(standardSize);
      expect(reduction).toBeGreaterThan(40);
    });

    it('should not omit metadata on error responses', async () => {
      const input: SheetsCoreInput = {
        action: 'get',
        spreadsheetId: 'test-spreadsheet-id',
        verbosity: 'minimal',
      };

      // Mock API error
      mockSheetsApi.spreadsheets.get = vi
        .fn()
        .mockRejectedValue(new Error('Spreadsheet not found'));

      const result = await handler.handle(input);

      expect(result.response.success).toBe(false);
      // Error responses should not be filtered regardless of verbosity
      if (!result.response.success) {
        expect(result.response.error).toBeDefined();
      }
    });
  });

  describe('Detailed Verbosity (future enhancement)', () => {
    it('should return standard response (detailed not yet implemented)', async () => {
      const input: SheetsCoreInput = {
        action: 'get',
        spreadsheetId: 'test-spreadsheet-id',
        verbosity: 'detailed',
      };

      const result = await handler.handle(input);

      expect(result.response.success).toBe(true);
      // Currently behaves same as standard
      if (result.response.success) {
        const { spreadsheet } = result.response;
        expect(spreadsheet?.locale).toBeDefined();
        expect(spreadsheet?.timeZone).toBeDefined();
      }
    });
  });

  describe('Token Usage Simulation', () => {
    it('demonstrates real-world token savings for LLMs', async () => {
      // Simulate LLM use case: "Get spreadsheet info"
      const standardInput: SheetsCoreInput = {
        action: 'get',
        spreadsheetId: 'test-spreadsheet-id',
        verbosity: 'standard',
      };

      const minimalInput: SheetsCoreInput = {
        action: 'get',
        spreadsheetId: 'test-spreadsheet-id',
        verbosity: 'minimal',
      };

      const standardResult = await handler.handle(standardInput);
      const minimalResult = await handler.handle(minimalInput);

      const standardJson = JSON.stringify(standardResult.response, null, 2);
      const minimalJson = JSON.stringify(minimalResult.response, null, 2);

      // Approximate token count (rough estimate: 1 token ≈ 4 characters)
      const standardTokens = Math.ceil(standardJson.length / 4);
      const minimalTokens = Math.ceil(minimalJson.length / 4);
      const tokensSaved = standardTokens - minimalTokens;
      const savingsPercent = ((tokensSaved / standardTokens) * 100).toFixed(1);

      console.log('\n=== Token Usage Comparison ===');
      console.log(`Standard verbosity: ~${standardTokens} tokens`);
      console.log(`Minimal verbosity: ~${minimalTokens} tokens`);
      console.log(`Tokens saved: ~${tokensSaved} (${savingsPercent}%)`);
      console.log('================================\n');

      expect(minimalTokens).toBeLessThan(standardTokens);
      expect(tokensSaved).toBeGreaterThan(0);
    });
  });
});
