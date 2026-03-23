/**
 * ServalSheets v4 - Effect Scope Tests
 *
 * Verifies that policy enforcer limits are respected
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEnforcer, PolicyViolationError } from '../../src/core/policy-enforcer.js';
import type { Intent } from '../../src/core/intent.js';

describe('Effect Scope Enforcement', () => {
  describe('PolicyEnforcer with default limits', () => {
    let enforcer: PolicyEnforcer;

    beforeEach(() => {
      enforcer = new PolicyEnforcer({
        maxCellsPerOperation: 1000,
        maxRowsPerDelete: 100,
        maxColumnsPerDelete: 10,
        maxIntentsPerBatch: 50,
        allowBatchDestructive: false,
        requireExplicitRangeForDelete: false, // Disable for these tests
      });
    });

    describe('Cell limit enforcement', () => {
      it('should REJECT operations exceeding cell limit', async () => {
        const intent: Intent = {
          type: 'SET_VALUES',
          target: { spreadsheetId: 'test-id' },
          payload: {},
          metadata: {
            sourceTool: 'sheets_data',
            sourceAction: 'write',
            priority: 0,
            destructive: false,
            estimatedCells: 5000, // Exceeds 1000 limit
          },
        };

        await expect(enforcer.validateIntents([intent])).rejects.toThrow(PolicyViolationError);
      });

      it('should include error details when rejecting', async () => {
        const intent: Intent = {
          type: 'SET_VALUES',
          target: { spreadsheetId: 'test-id' },
          payload: {},
          metadata: {
            sourceTool: 'sheets_data',
            sourceAction: 'write',
            priority: 0,
            destructive: false,
            estimatedCells: 5000,
          },
        };

        try {
          await enforcer.validateIntents([intent]);
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(PolicyViolationError);
          const policyError = error as PolicyViolationError;
          expect(policyError.code).toBe('EFFECT_SCOPE_EXCEEDED');
          expect(policyError.details).toMatchObject({
            estimatedCells: 5000,
            max: 1000,
          });
        }
      });

      it('should ALLOW operations within cell limit', async () => {
        const intent: Intent = {
          type: 'SET_VALUES',
          target: { spreadsheetId: 'test-id' },
          payload: {},
          metadata: {
            sourceTool: 'sheets_data',
            sourceAction: 'write',
            priority: 0,
            destructive: false,
            estimatedCells: 500, // Within 1000 limit
          },
        };

        await expect(enforcer.validateIntents([intent])).resolves.not.toThrow();
      });

      it('should ALLOW operations at exact limit', async () => {
        const intent: Intent = {
          type: 'SET_VALUES',
          target: { spreadsheetId: 'test-id' },
          payload: {},
          metadata: {
            sourceTool: 'sheets_data',
            sourceAction: 'write',
            priority: 0,
            destructive: false,
            estimatedCells: 1000, // Exactly at limit
          },
        };

        await expect(enforcer.validateIntents([intent])).resolves.not.toThrow();
      });
    });

    describe('Row delete limit enforcement', () => {
      it('should REJECT row deletion exceeding limit', async () => {
        const intent: Intent = {
          type: 'DELETE_DIMENSION',
          target: { spreadsheetId: 'test-id', sheetId: 0 },
          payload: {
            dimension: 'ROWS',
            startIndex: 0,
            endIndex: 500, // 500 rows, exceeds 100 limit
          },
          metadata: {
            sourceTool: 'sheets_dimensions',
            sourceAction: 'delete_rows',
            priority: 0,
            destructive: true,
          },
        };

        await expect(enforcer.validateIntents([intent])).rejects.toThrow(PolicyViolationError);
      });

      it('should ALLOW row deletion within limit', async () => {
        const intent: Intent = {
          type: 'DELETE_DIMENSION',
          target: { spreadsheetId: 'test-id', sheetId: 0 },
          payload: {
            dimension: 'ROWS',
            startIndex: 0,
            endIndex: 50, // 50 rows, within 100 limit
          },
          metadata: {
            sourceTool: 'sheets_dimensions',
            sourceAction: 'delete_rows',
            priority: 0,
            destructive: true,
          },
        };

        await expect(enforcer.validateIntents([intent])).resolves.not.toThrow();
      });
    });

    describe('Column delete limit enforcement', () => {
      it('should REJECT column deletion exceeding limit', async () => {
        const intent: Intent = {
          type: 'DELETE_DIMENSION',
          target: { spreadsheetId: 'test-id', sheetId: 0 },
          payload: {
            dimension: 'COLUMNS',
            startIndex: 0,
            endIndex: 50, // 50 columns, exceeds 10 limit
          },
          metadata: {
            sourceTool: 'sheets_dimensions',
            sourceAction: 'delete_columns',
            priority: 0,
            destructive: true,
          },
        };

        await expect(enforcer.validateIntents([intent])).rejects.toThrow(PolicyViolationError);
      });

      it('should ALLOW column deletion within limit', async () => {
        const intent: Intent = {
          type: 'DELETE_DIMENSION',
          target: { spreadsheetId: 'test-id', sheetId: 0 },
          payload: {
            dimension: 'COLUMNS',
            startIndex: 0,
            endIndex: 5, // 5 columns, within 10 limit
          },
          metadata: {
            sourceTool: 'sheets_dimensions',
            sourceAction: 'delete_columns',
            priority: 0,
            destructive: true,
          },
        };

        await expect(enforcer.validateIntents([intent])).resolves.not.toThrow();
      });
    });

    describe('Batch intent limit enforcement', () => {
      it('should REJECT batches exceeding intent limit', async () => {
        const intents: Intent[] = Array(100)
          .fill(null)
          .map((_, i) => ({
            type: 'SET_VALUES' as const,
            target: { spreadsheetId: 'test-id' },
            payload: {},
            metadata: {
              sourceTool: 'sheets_data',
              sourceAction: 'write',
              priority: 0,
              destructive: false,
              estimatedCells: 1,
            },
          }));

        await expect(enforcer.validateIntents(intents)).rejects.toThrow(PolicyViolationError);
      });

      it('should ALLOW batches within intent limit', async () => {
        const intents: Intent[] = Array(25)
          .fill(null)
          .map(() => ({
            type: 'SET_VALUES' as const,
            target: { spreadsheetId: 'test-id' },
            payload: {},
            metadata: {
              sourceTool: 'sheets_data',
              sourceAction: 'write',
              priority: 0,
              destructive: false,
              estimatedCells: 1,
            },
          }));

        await expect(enforcer.validateIntents(intents)).resolves.not.toThrow();
      });
    });

    describe('Multiple destructive operations', () => {
      it('should REJECT multiple destructive ops when not allowed', async () => {
        const intents: Intent[] = [
          {
            type: 'DELETE_SHEET',
            target: { spreadsheetId: 'test-id', sheetId: 1 },
            payload: {},
            metadata: {
              sourceTool: 'sheets_core',
              sourceAction: 'delete_sheet',
              priority: 0,
              destructive: true,
            },
          },
          {
            type: 'CLEAR_VALUES',
            target: { spreadsheetId: 'test-id' },
            payload: {},
            metadata: {
              sourceTool: 'sheets_data',
              sourceAction: 'clear',
              priority: 0,
              destructive: true,
            },
          },
        ];

        await expect(enforcer.validateIntents(intents)).rejects.toThrow(PolicyViolationError);
      });

      it('should ALLOW single destructive op', async () => {
        const intents: Intent[] = [
          {
            type: 'DELETE_SHEET',
            target: { spreadsheetId: 'test-id', sheetId: 1 },
            payload: {},
            metadata: {
              sourceTool: 'sheets_core',
              sourceAction: 'delete_sheet',
              priority: 0,
              destructive: true,
            },
          },
        ];

        await expect(enforcer.validateIntents(intents)).resolves.not.toThrow();
      });
    });
  });

  describe('PolicyEnforcer with custom limits', () => {
    it('should respect custom cell limit', async () => {
      const enforcer = new PolicyEnforcer({
        maxCellsPerOperation: 100,
        requireExplicitRangeForDelete: false,
      });

      const intent: Intent = {
        type: 'SET_VALUES',
        target: { spreadsheetId: 'test-id' },
        payload: {},
        metadata: {
          sourceTool: 'sheets_data',
          sourceAction: 'write',
          priority: 0,
          destructive: false,
          estimatedCells: 150, // Exceeds custom 100 limit
        },
      };

      await expect(enforcer.validateIntents([intent])).rejects.toThrow(PolicyViolationError);
    });

    it('should ALLOW batch destructive when enabled', async () => {
      const enforcer = new PolicyEnforcer({
        allowBatchDestructive: true,
        requireExplicitRangeForDelete: false,
      });

      const intents: Intent[] = [
        {
          type: 'DELETE_SHEET',
          target: { spreadsheetId: 'test-id', sheetId: 1 },
          payload: {},
          metadata: {
            sourceTool: 'sheets_core',
            sourceAction: 'delete_sheet',
            priority: 0,
            destructive: true,
          },
        },
        {
          type: 'DELETE_SHEET',
          target: { spreadsheetId: 'test-id', sheetId: 2 },
          payload: {},
          metadata: {
            sourceTool: 'sheets_core',
            sourceAction: 'delete_sheet',
            priority: 0,
            destructive: true,
          },
        },
      ];

      await expect(enforcer.validateIntents(intents)).resolves.not.toThrow();
    });
  });

  describe('PolicyEnforcer configuration', () => {
    it('should allow updating configuration', () => {
      const enforcer = new PolicyEnforcer({ maxCellsPerOperation: 1000 });

      expect(enforcer.getConfig().maxCellsPerOperation).toBe(1000);

      enforcer.updateConfig({ maxCellsPerOperation: 2000 });

      expect(enforcer.getConfig().maxCellsPerOperation).toBe(2000);
    });

    it('should use default values for unspecified options', () => {
      const enforcer = new PolicyEnforcer({});
      const config = enforcer.getConfig();

      expect(config.maxCellsPerOperation).toBe(50000); // Default
      expect(config.maxRowsPerDelete).toBe(10000); // Default
      expect(config.maxColumnsPerDelete).toBe(100); // Default
      expect(config.maxIntentsPerBatch).toBe(100); // Default
    });
  });

  describe('PolicyViolationError', () => {
    it('should convert to ErrorDetail correctly', () => {
      const error = new PolicyViolationError('Test error message', 'EFFECT_SCOPE_EXCEEDED', {
        foo: 'bar',
      });

      const errorDetail = error.toErrorDetail();

      expect(errorDetail).toEqual({
        code: 'EFFECT_SCOPE_EXCEEDED',
        message: 'Test error message',
        details: { foo: 'bar' },
        retryable: false,
      });
    });
  });
});
