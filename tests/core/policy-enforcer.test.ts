/**
 * ServalSheets v4 - Policy Enforcer Tests
 *
 * Verifies policy enforcement for safety limits
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEnforcer, PolicyViolationError } from '../../src/core/policy-enforcer.js';
import type { Intent } from '../../src/core/intent.js';

describe('PolicyEnforcer', () => {
  describe('Default configuration', () => {
    let enforcer: PolicyEnforcer;

    beforeEach(() => {
      enforcer = new PolicyEnforcer();
    });

    it('should have sensible defaults', () => {
      const config = enforcer.getConfig();

      expect(config.maxCellsPerOperation).toBe(50000);
      expect(config.maxRowsPerDelete).toBe(10000);
      expect(config.maxColumnsPerDelete).toBe(100);
      expect(config.maxIntentsPerBatch).toBe(100);
      expect(config.allowBatchDestructive).toBe(false);
      expect(config.requireExplicitRangeForDelete).toBe(true);
    });
  });

  describe('Custom configuration', () => {
    it('should accept partial configuration', () => {
      const enforcer = new PolicyEnforcer({
        maxCellsPerOperation: 1000,
      });

      const config = enforcer.getConfig();
      expect(config.maxCellsPerOperation).toBe(1000);
      expect(config.maxRowsPerDelete).toBe(10000); // Default
    });

    it('should allow updating configuration', () => {
      const enforcer = new PolicyEnforcer({ maxCellsPerOperation: 1000 });

      enforcer.updateConfig({ maxCellsPerOperation: 2000 });

      expect(enforcer.getConfig().maxCellsPerOperation).toBe(2000);
    });
  });

  describe('Intent validation', () => {
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

    describe('Cell limit', () => {
      it('should reject operations exceeding cell limit', async () => {
        const intent: Intent = {
          type: 'SET_VALUES',
          target: { spreadsheetId: 'test' },
          payload: {},
          metadata: {
            sourceTool: 'sheets_data',
            sourceAction: 'write',
            priority: 0,
            destructive: false,
            estimatedCells: 5000,
          },
        };

        await expect(enforcer.validateIntents([intent])).rejects.toThrow(PolicyViolationError);
      });

      it('should include details in error', async () => {
        const intent: Intent = {
          type: 'SET_VALUES',
          target: { spreadsheetId: 'test' },
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
          const policyError = error as PolicyViolationError;
          expect(policyError.code).toBe('EFFECT_SCOPE_EXCEEDED');
          expect(policyError.details?.['estimatedCells']).toBe(5000);
          expect(policyError.details?.['max']).toBe(1000);
        }
      });

      it('should allow operations within limit', async () => {
        const intent: Intent = {
          type: 'SET_VALUES',
          target: { spreadsheetId: 'test' },
          payload: {},
          metadata: {
            sourceTool: 'sheets_data',
            sourceAction: 'write',
            priority: 0,
            destructive: false,
            estimatedCells: 500,
          },
        };

        await expect(enforcer.validateIntents([intent])).resolves.not.toThrow();
      });
    });

    describe('Row delete limit', () => {
      it('should reject row deletion exceeding limit', async () => {
        const intent: Intent = {
          type: 'DELETE_DIMENSION',
          target: { spreadsheetId: 'test', sheetId: 0 },
          payload: {
            dimension: 'ROWS',
            startIndex: 0,
            endIndex: 500,
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

      it('should allow row deletion within limit', async () => {
        const intent: Intent = {
          type: 'DELETE_DIMENSION',
          target: { spreadsheetId: 'test', sheetId: 0 },
          payload: {
            dimension: 'ROWS',
            startIndex: 0,
            endIndex: 50,
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

    describe('Column delete limit', () => {
      it('should reject column deletion exceeding limit', async () => {
        const intent: Intent = {
          type: 'DELETE_DIMENSION',
          target: { spreadsheetId: 'test', sheetId: 0 },
          payload: {
            dimension: 'COLUMNS',
            startIndex: 0,
            endIndex: 50,
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

      it('should allow column deletion within limit', async () => {
        const intent: Intent = {
          type: 'DELETE_DIMENSION',
          target: { spreadsheetId: 'test', sheetId: 0 },
          payload: {
            dimension: 'COLUMNS',
            startIndex: 0,
            endIndex: 5,
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

    describe('Batch limit', () => {
      it('should reject batches exceeding intent limit', async () => {
        const intents: Intent[] = Array(100)
          .fill(null)
          .map(() => ({
            type: 'SET_VALUES' as const,
            target: { spreadsheetId: 'test' },
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

      it('should allow batches within limit', async () => {
        const intents: Intent[] = Array(25)
          .fill(null)
          .map(() => ({
            type: 'SET_VALUES' as const,
            target: { spreadsheetId: 'test' },
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

    describe('Batch destructive operations', () => {
      it('should reject multiple destructive ops when not allowed', async () => {
        const intents: Intent[] = [
          {
            type: 'DELETE_SHEET',
            target: { spreadsheetId: 'test', sheetId: 1 },
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
            target: { spreadsheetId: 'test' },
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

      it('should allow single destructive op', async () => {
        const intents: Intent[] = [
          {
            type: 'DELETE_SHEET',
            target: { spreadsheetId: 'test', sheetId: 1 },
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

      it('should allow batch destructive when enabled', async () => {
        const batchEnforcer = new PolicyEnforcer({
          allowBatchDestructive: true,
          requireExplicitRangeForDelete: false,
        });

        const intents: Intent[] = [
          {
            type: 'DELETE_SHEET',
            target: { spreadsheetId: 'test', sheetId: 1 },
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
            target: { spreadsheetId: 'test', sheetId: 2 },
            payload: {},
            metadata: {
              sourceTool: 'sheets_core',
              sourceAction: 'delete_sheet',
              priority: 0,
              destructive: true,
            },
          },
        ];

        await expect(batchEnforcer.validateIntents(intents)).resolves.not.toThrow();
      });
    });
  });

  describe('Explicit range requirement', () => {
    it('should reject destructive ops without range when required', async () => {
      const enforcer = new PolicyEnforcer({
        requireExplicitRangeForDelete: true,
      });

      const intent: Intent = {
        type: 'CLEAR_VALUES',
        target: { spreadsheetId: 'test' }, // No range specified
        payload: {},
        metadata: {
          sourceTool: 'sheets_data',
          sourceAction: 'clear',
          priority: 0,
          destructive: true,
        },
      };

      await expect(enforcer.validateIntents([intent])).rejects.toThrow(PolicyViolationError);
    });

    it('should allow destructive ops with range when required', async () => {
      const enforcer = new PolicyEnforcer({
        requireExplicitRangeForDelete: true,
      });

      const intent: Intent = {
        type: 'CLEAR_VALUES',
        target: { spreadsheetId: 'test', range: 'Sheet1!A1:B10' }, // Range specified
        payload: {},
        metadata: {
          sourceTool: 'sheets_data',
          sourceAction: 'clear',
          priority: 0,
          destructive: true,
        },
      };

      await expect(enforcer.validateIntents([intent])).resolves.not.toThrow();
    });
  });

  describe('PolicyViolationError', () => {
    it('should convert to ErrorDetail correctly', () => {
      const error = new PolicyViolationError('Test error message', 'EFFECT_SCOPE_EXCEEDED', {
        foo: 'bar',
      });

      const detail = error.toErrorDetail();

      expect(detail.code).toBe('EFFECT_SCOPE_EXCEEDED');
      expect(detail.message).toBe('Test error message');
      expect(detail.details).toEqual({ foo: 'bar' });
      expect(detail.retryable).toBe(false);
    });

    it('should handle missing details', () => {
      const error = new PolicyViolationError('Simple error', 'SOME_CODE');
      const detail = error.toErrorDetail();

      expect(detail.details).toBeUndefined();
    });
  });
});
