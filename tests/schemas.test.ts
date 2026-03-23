/**
 * ServalSheets v4 - Tests
 */

import { describe, it, expect } from 'vitest';
import {
  TOOL_COUNT,
  ACTION_COUNT,
  SheetsCoreInputSchema,
  SheetsDataInputSchema,
  SheetsDimensionsInputSchema,
  SheetsAppsScriptInputSchema,
  SafetyOptionsSchema,
  ColorSchema,
} from '../src/schemas/index.js';

describe('ServalSheets v4', () => {
  describe('Tool Registry', () => {
    it('should have reasonable number of tools', () => {
      expect(TOOL_COUNT).toBeGreaterThanOrEqual(15);
      expect(TOOL_COUNT).toBeLessThanOrEqual(25);
      expect(Number.isInteger(TOOL_COUNT)).toBe(true);
    });

    it('should have reasonable number of actions', () => {
      expect(ACTION_COUNT).toBeGreaterThanOrEqual(200);
      expect(ACTION_COUNT).toBeLessThanOrEqual(450);
      expect(Number.isInteger(ACTION_COUNT)).toBe(true);
    });
  });

  describe('Schema Validation', () => {
    describe('SheetsCoreInputSchema', () => {
      it('should validate get action', () => {
        const result = SheetsCoreInputSchema.safeParse({
          request: {
            action: 'get',
            spreadsheetId: 'abc123',
          },
        });
        expect(result.success).toBe(true);
      });

      it('should validate create action', () => {
        const result = SheetsCoreInputSchema.safeParse({
          request: {
            action: 'create',
            title: 'New Spreadsheet',
          },
        });
        expect(result.success).toBe(true);
      });

      it('should reject invalid action', () => {
        const result = SheetsCoreInputSchema.safeParse({
          request: {
            action: 'invalid',
            spreadsheetId: 'abc123',
          },
        });
        expect(result.success).toBe(false);
      });
    });

    describe('SheetsDataInputSchema', () => {
      it('should validate read action with A1 range', () => {
        const result = SheetsDataInputSchema.safeParse({
          request: {
            action: 'read',
            spreadsheetId: 'abc123',
            range: { a1: 'Sheet1!A1:C10' },
          },
        });
        expect(result.success).toBe(true);
      });

      it('should validate write action with safety options', () => {
        const result = SheetsDataInputSchema.safeParse({
          request: {
            action: 'write',
            spreadsheetId: 'abc123',
            range: { a1: 'Sheet1!A1' },
            values: [['Hello', 'World']],
            safety: {
              dryRun: true,
              effectScope: {
                maxCellsAffected: 1000,
              },
            },
          },
        });
        expect(result.success).toBe(true);
      });

      it('should validate semantic range', () => {
        const result = SheetsDataInputSchema.safeParse({
          request: {
            action: 'read',
            spreadsheetId: 'abc123',
            range: {
              semantic: {
                sheet: 'Sales',
                column: 'Revenue',
              },
            },
          },
        });
        expect(result.success).toBe(true);
      });
    });

    describe('SheetsDimensionsInputSchema', () => {
      it('should validate insert action with dimension', () => {
        const result = SheetsDimensionsInputSchema.safeParse({
          request: {
            action: 'insert',
            dimension: 'ROWS',
            spreadsheetId: 'abc123',
            sheetId: 0,
            startIndex: 5,
            count: 10,
          },
        });
        expect(result.success).toBe(true);
      });

      it('should validate delete action with safety', () => {
        const result = SheetsDimensionsInputSchema.safeParse({
          request: {
            action: 'delete',
            dimension: 'ROWS',
            spreadsheetId: 'abc123',
            sheetId: 0,
            startIndex: 0,
            endIndex: 5,
            safety: {
              dryRun: true,
              expectedState: {
                rowCount: 100,
              },
            },
          },
        });
        expect(result.success).toBe(true);
      });
    });

    describe('SheetsAppsScriptInputSchema', () => {
      it('should default create runtimeVersion to V8', () => {
        const result = SheetsAppsScriptInputSchema.safeParse({
          request: {
            action: 'create',
            title: 'Runtime Default Test',
          },
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.request.runtimeVersion).toBe('V8');
        }
      });
    });

    describe('SafetyOptionsSchema', () => {
      it('should validate complete safety options', () => {
        const result = SafetyOptionsSchema.safeParse({
          dryRun: true,
          expectedState: {
            rowCount: 100,
            checksum: 'abc123',
          },
          transactionId: '550e8400-e29b-41d4-a716-446655440000',
          autoSnapshot: true,
          effectScope: {
            maxCellsAffected: 5000,
            requireExplicitRange: true,
          },
        });
        expect(result.success).toBe(true);
      });
    });

    describe('ColorSchema', () => {
      it('should validate 0-1 scale colors', () => {
        const result = ColorSchema.safeParse({
          red: 0.5,
          green: 0.75,
          blue: 1,
          alpha: 0.9,
        });
        expect(result.success).toBe(true);
      });

      it('should reject 0-255 scale colors', () => {
        const result = ColorSchema.safeParse({
          red: 255,
          green: 128,
          blue: 0,
        });
        expect(result.success).toBe(false);
      });
    });
  });
});
