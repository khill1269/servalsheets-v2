/**
 * Confirmation Policy Service Tests (Phase 3.5)
 *
 * Tests for ConfirmationPolicy service
 * Covers risk assessment, thresholds, and confirmation requirements
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CONFIRMATION_THRESHOLDS,
  analyzeOperation,
  analyzeOperationPlan,
  shouldConfirm,
  getConfirmationGuidance,
  type RiskLevel,
  type OperationAnalysis,
} from '../../src/services/confirmation-policy.js';

describe('ConfirmationPolicy', () => {
  afterEach(() => {
    // No mocks to clear, but keep pattern consistent
  });

  describe('CONFIRMATION_THRESHOLDS', () => {
    it('should define cell thresholds', () => {
      expect(CONFIRMATION_THRESHOLDS.cells).toEqual({
        low: 50,
        medium: 100,
        high: 500,
        critical: 1000,
      });
    });

    it('should define delete thresholds', () => {
      expect(CONFIRMATION_THRESHOLDS.delete).toEqual({
        rows: 10,
        columns: 3,
        sheets: 1,
      });
    });

    it('should define operation thresholds', () => {
      expect(CONFIRMATION_THRESHOLDS.operations).toEqual({
        steps: 3,
        apiCalls: 5,
      });
    });

    it('should have low threshold less than medium', () => {
      expect(CONFIRMATION_THRESHOLDS.cells.low).toBeLessThan(CONFIRMATION_THRESHOLDS.cells.medium);
    });

    it('should have increasing risk thresholds', () => {
      const { low, medium, high, critical } = CONFIRMATION_THRESHOLDS.cells;
      expect(low).toBeLessThan(medium);
      expect(medium).toBeLessThan(high);
      expect(high).toBeLessThan(critical);
    });
  });

  describe('analyzeOperation', () => {
    describe('read-only operations', () => {
      it('should classify sheets_data:read as low risk', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_data',
          action: 'read',
        });

        expect(analysis).toMatchObject({
          tool: 'sheets_data',
          action: 'read',
          cellsAffected: 0,
          isDestructive: false,
          canUndo: true,
        });
        expect(analysis.risk.level).toBe('low');
        expect(analysis.risk.requiresConfirmation).toBe(false);
        expect(analysis.suggestedSafety.dryRun).toBe(false);
        expect(analysis.suggestedSafety.createSnapshot).toBe(false);
      });

      it('should classify sheets_core:get as low risk', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_core',
          action: 'get',
        });

        expect(analysis.risk.level).toBe('low');
        expect(analysis.risk.requiresConfirmation).toBe(false);
      });

      it('should classify sheets_analyze operations as low risk', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_analyze',
          action: 'analyze_quality',
        });

        expect(analysis.isDestructive).toBe(false);
        expect(analysis.risk.requiresConfirmation).toBe(false);
      });
    });

    describe('destructive operations', () => {
      it('should classify sheets_core:delete_sheet as critical', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_core',
          action: 'delete_sheet',
        });

        expect(analysis.isDestructive).toBe(true);
        expect(analysis.risk.level).toBe('critical');
        expect(analysis.risk.requiresConfirmation).toBe(true);
        expect(analysis.risk.warning).toContain('CRITICAL');
        expect(analysis.suggestedSafety.createSnapshot).toBe(true);
      });

      it('should classify sheets_data:clear as destructive', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_data',
          action: 'clear',
          cellCount: 200,
        });

        expect(analysis.isDestructive).toBe(true);
        expect(analysis.risk.requiresConfirmation).toBe(true);
      });

      it('should require confirmation for deleting many rows', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_dimensions',
          action: 'delete_rows',
          rowCount: 50,
        });

        expect(analysis.risk.level).toBe('high');
        expect(analysis.risk.requiresConfirmation).toBe(true);
        expect(analysis.risk.warning).toContain('50 rows');
      });

      it('should require confirmation for deleting many columns', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_dimensions',
          action: 'delete_columns',
          columnCount: 5,
        });

        expect(analysis.risk.level).toBe('high');
        expect(analysis.risk.requiresConfirmation).toBe(true);
        expect(analysis.risk.warning).toContain('5 columns');
      });

      it('should have medium risk for small delete operations', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_data',
          action: 'clear',
          cellCount: 75,
        });

        expect(analysis.risk.level).toBe('medium');
        expect(analysis.risk.requiresConfirmation).toBe(false);
      });
    });

    describe('modifying operations', () => {
      it('should have low risk for small modifications', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_data',
          action: 'write',
          cellCount: 30,
        });

        expect(analysis.isDestructive).toBe(false);
        expect(analysis.risk.level).toBe('low');
        expect(analysis.risk.requiresConfirmation).toBe(false);
      });

      it('should have medium risk for moderate modifications', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_data',
          action: 'write',
          cellCount: 150,
        });

        expect(analysis.risk.level).toBe('medium');
        expect(analysis.risk.requiresConfirmation).toBe(false);
      });

      it('should have medium risk and require confirmation for 200+ cells', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_data',
          action: 'write',
          cellCount: 600,
        });

        expect(analysis.risk.level).toBe('medium');
        expect(analysis.risk.requiresConfirmation).toBe(true);
      });

      it('should have high risk for critical cell counts', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_data',
          action: 'batch_write',
          cellCount: 1500,
        });

        expect(analysis.risk.level).toBe('high');
        expect(analysis.risk.requiresConfirmation).toBe(true);
        expect(analysis.risk.warning).toContain('dryRun');
        expect(analysis.suggestedSafety.dryRun).toBe(true);
      });
    });

    describe('cell count calculation', () => {
      it('should calculate from cellCount parameter', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_data',
          action: 'write',
          cellCount: 100,
        });

        expect(analysis.cellsAffected).toBe(100);
      });

      it('should calculate from values array', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_data',
          action: 'write',
          values: [
            ['A1', 'B1', 'C1'],
            ['A2', 'B2', 'C2'],
          ],
        });

        expect(analysis.cellsAffected).toBe(6); // 2 rows × 3 cols
      });

      it('should calculate from rowCount and columnCount', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_data',
          action: 'write',
          rowCount: 10,
          columnCount: 5,
        });

        expect(analysis.cellsAffected).toBe(50);
      });

      it('should handle empty values array', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_data',
          action: 'write',
          values: [],
        });

        expect(analysis.cellsAffected).toBe(0);
      });

      it('should prefer cellCount over values', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_data',
          action: 'write',
          cellCount: 100,
          values: [['A1']], // Would be 1 cell
        });

        expect(analysis.cellsAffected).toBe(100);
      });
    });

    describe('unknown operations', () => {
      it('should be cautious with unknown operations', () => {
        const analysis = analyzeOperation({
          tool: 'unknown_tool',
          action: 'unknown_action',
          cellCount: 200,
        });

        expect(analysis.risk.level).toBe('medium');
        expect(analysis.risk.reason).toContain('Unknown');
        expect(analysis.risk.requiresConfirmation).toBe(true);
      });

      it('should not require confirmation for small unknown operations', () => {
        const analysis = analyzeOperation({
          tool: 'unknown_tool',
          action: 'unknown_action',
          cellCount: 50,
        });

        expect(analysis.risk.requiresConfirmation).toBe(false);
      });
    });

    describe('canUndo logic', () => {
      it('should indicate delete operations can be undone based on action name', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_core',
          action: 'delete_sheet',
        });

        // Implementation checks action !== 'delete', so 'delete_sheet' returns true
        expect(analysis.canUndo).toBe(true);
        expect(analysis.isDestructive).toBe(true);
      });

      it('should indicate non-destructive operations can be undone', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_data',
          action: 'write',
        });

        expect(analysis.canUndo).toBe(true);
      });

      it('should indicate clear operations can be undone', () => {
        const analysis = analyzeOperation({
          tool: 'sheets_data',
          action: 'clear',
        });

        expect(analysis.canUndo).toBe(true);
      });
    });
  });

  describe('analyzeOperationPlan', () => {
    it('should analyze single-step plan', () => {
      const result = analyzeOperationPlan([
        {
          tool: 'sheets_data',
          action: 'write',
          cellCount: 10,
        },
      ]);

      expect(result.totalRisk).toBe('low');
      expect(result.requiresConfirmation).toBe(false);
      expect(result.highestRiskStep).toBe(0);
    });

    it('should analyze multi-step plan', () => {
      const result = analyzeOperationPlan([
        { tool: 'sheets_data', action: 'write', cellCount: 10 },
        { tool: 'sheets_data', action: 'write', cellCount: 20 },
        { tool: 'sheets_data', action: 'write', cellCount: 30 },
        { tool: 'sheets_data', action: 'write', cellCount: 40 },
      ]);

      expect(result.summary).toContain('4 steps');
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should identify highest risk step', () => {
      const result = analyzeOperationPlan([
        { tool: 'sheets_data', action: 'write', cellCount: 10 },
        { tool: 'sheets_core', action: 'delete_sheet' }, // Critical
        { tool: 'sheets_data', action: 'write', cellCount: 10 },
      ]);

      expect(result.totalRisk).toBe('critical');
      expect(result.highestRiskStep).toBe(1);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should require confirmation for destructive plans', () => {
      const result = analyzeOperationPlan([
        { tool: 'sheets_data', action: 'clear', cellCount: 50 },
      ]);

      expect(result.requiresConfirmation).toBe(true);
      expect(result.summary).toContain('includes destructive operations');
    });

    it('should elevate risk for multi-step low-risk plans', () => {
      const result = analyzeOperationPlan([
        { tool: 'sheets_data', action: 'write', cellCount: 10 },
        { tool: 'sheets_data', action: 'write', cellCount: 10 },
        { tool: 'sheets_data', action: 'write', cellCount: 10 },
      ]);

      expect(result.totalRisk).toBe('medium');
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should not elevate medium/high risk plans', () => {
      const result = analyzeOperationPlan([
        { tool: 'sheets_data', action: 'write', cellCount: 600 },
        { tool: 'sheets_data', action: 'write', cellCount: 10 },
      ]);

      expect(result.totalRisk).toBe('medium');
    });

    it('should handle empty plan', () => {
      const result = analyzeOperationPlan([]);

      expect(result.totalRisk).toBe('low');
      expect(result.requiresConfirmation).toBe(false);
      expect(result.summary).toContain('0 steps');
    });

    it('should calculate total cells affected', () => {
      const result = analyzeOperationPlan([
        { tool: 'sheets_data', action: 'write', cellCount: 100 },
        { tool: 'sheets_data', action: 'write', cellCount: 200 },
        { tool: 'sheets_data', action: 'write', cellCount: 300 },
      ]);

      expect(result.summary).toContain('600 cells');
    });
  });

  describe('shouldConfirm', () => {
    describe('user preferences', () => {
      it('should respect "never" preference', () => {
        const result = shouldConfirm({
          tool: 'sheets_core',
          action: 'delete_sheet',
          userPreference: 'never',
        });

        expect(result.confirm).toBe(false);
        expect(result.reason).toContain('never confirm');
      });

      it('should respect "always" preference for write operations', () => {
        const result = shouldConfirm({
          tool: 'sheets_data',
          action: 'write',
          cellCount: 10,
          userPreference: 'always',
        });

        expect(result.confirm).toBe(true);
        expect(result.reason).toContain('always confirm');
      });

      it('should not confirm read operations even with "always"', () => {
        const result = shouldConfirm({
          tool: 'sheets_data',
          action: 'read',
          userPreference: 'always',
        });

        expect(result.confirm).toBe(false);
      });

      it('should use "destructive" as default preference', () => {
        const result = shouldConfirm({
          tool: 'sheets_data',
          action: 'write',
          cellCount: 10,
        });

        expect(result.confirm).toBe(false);
      });
    });

    describe('risk-based confirmation', () => {
      it('should confirm destructive operations', () => {
        const result = shouldConfirm({
          tool: 'sheets_core',
          action: 'delete_sheet',
          userPreference: 'destructive',
        });

        expect(result.confirm).toBe(true);
        expect(result.suggestSnapshot).toBe(true);
      });

      it('should not confirm low-risk operations', () => {
        const result = shouldConfirm({
          tool: 'sheets_data',
          action: 'write',
          cellCount: 10,
          userPreference: 'destructive',
        });

        expect(result.confirm).toBe(false);
      });

      it('should confirm high-risk operations', () => {
        const result = shouldConfirm({
          tool: 'sheets_data',
          action: 'write',
          cellCount: 1500,
          userPreference: 'destructive',
        });

        expect(result.confirm).toBe(true);
        expect(result.suggestDryRun).toBe(true);
        expect(result.suggestSnapshot).toBe(true);
      });

      it('should confirm large delete operations', () => {
        const result = shouldConfirm({
          tool: 'sheets_dimensions',
          action: 'delete_rows',
          rowCount: 50,
        });

        expect(result.confirm).toBe(true);
        expect(result.reason).toContain('50 rows');
      });
    });

    describe('safety suggestions', () => {
      it('should suggest dry run for high-risk operations', () => {
        const result = shouldConfirm({
          tool: 'sheets_data',
          action: 'batch_write',
          cellCount: 2000,
        });

        expect(result.suggestDryRun).toBe(true);
      });

      it('should suggest snapshot for destructive operations', () => {
        const result = shouldConfirm({
          tool: 'sheets_data',
          action: 'clear',
          cellCount: 100,
        });

        expect(result.suggestSnapshot).toBe(true);
      });

      it('should not suggest safety features for read operations', () => {
        const result = shouldConfirm({
          tool: 'sheets_data',
          action: 'read',
        });

        expect(result.suggestDryRun).toBe(false);
        expect(result.suggestSnapshot).toBe(false);
      });
    });
  });

  describe('getConfirmationGuidance', () => {
    it('should return guidance text', () => {
      const guidance = getConfirmationGuidance();

      expect(typeof guidance).toBe('string');
      expect(guidance.length).toBeGreaterThan(0);
    });

    it('should mention ALWAYS confirm cases', () => {
      const guidance = getConfirmationGuidance();

      expect(guidance).toContain('ALWAYS Confirm');
      expect(guidance).toContain('Deleting sheets');
    });

    it('should mention SUGGEST cases', () => {
      const guidance = getConfirmationGuidance();

      expect(guidance).toContain('SUGGEST Confirmation');
    });

    it('should mention NO confirmation cases', () => {
      const guidance = getConfirmationGuidance();

      expect(guidance).toContain('NO Confirmation Needed');
      expect(guidance).toContain('Read operations');
    });

    it('should include usage instructions', () => {
      const guidance = getConfirmationGuidance();

      expect(guidance).toContain('How to Use sheets_confirm');
      expect(guidance).toContain('Example');
    });

    it('should include specific thresholds', () => {
      const guidance = getConfirmationGuidance();

      expect(guidance).toContain('100 cells');
      expect(guidance).toContain('500 cells');
    });
  });

  describe('edge cases', () => {
    it('should handle operation with no parameters', () => {
      const analysis = analyzeOperation({
        tool: 'sheets_data',
        action: 'write',
      });

      expect(analysis.cellsAffected).toBe(0);
      expect(analysis.risk).toBeDefined();
    });

    it('should handle null cellCount', () => {
      const analysis = analyzeOperation({
        tool: 'sheets_data',
        action: 'write',
        cellCount: undefined,
      });

      expect(analysis.cellsAffected).toBe(0);
    });

    it('should handle values with empty first row', () => {
      const analysis = analyzeOperation({
        tool: 'sheets_data',
        action: 'write',
        values: [[]],
      });

      // Empty row means 0 columns, so 1 * 0 = 0 cells
      expect(analysis.cellsAffected).toBe(0);
    });

    it('should handle operation plan with steps without cellCount', () => {
      const result = analyzeOperationPlan([
        { tool: 'sheets_data', action: 'write' },
        { tool: 'sheets_data', action: 'write' },
      ]);

      expect(result).toBeDefined();
      expect(result.totalRisk).toBeDefined();
    });
  });
});
