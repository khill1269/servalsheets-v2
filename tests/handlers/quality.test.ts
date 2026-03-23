/**
 * ServalSheets - Quality Handler Tests
 *
 * Tests for data quality operations: validation, conflict detection/resolution, and impact analysis.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QualityHandler } from '../../src/handlers/quality.js';
import { SheetsQualityOutputSchema } from '../../src/schemas/quality.js';

// Mock the service getters
vi.mock('../../src/services/validation-engine.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/services/validation-engine.js')>(
      '../../src/services/validation-engine.js'
    );

  return {
    ...actual,
    getValidationEngine: vi.fn(() => ({
      validate: vi.fn().mockResolvedValue({
        valid: true,
        errors: [],
        warnings: [],
        infoMessages: [],
        totalChecks: 5,
        passedChecks: 5,
        duration: 10,
      }),
    })),
  };
});

vi.mock('../../src/services/conflict-detector.js', () => ({
  getConflictDetector: vi.fn(() => ({
    detectConflicts: vi.fn().mockResolvedValue({
      hasConflicts: false,
      conflicts: [],
      totalChecked: 10,
      conflictCount: 0,
    }),
    resolveConflict: vi.fn().mockResolvedValue({
      success: true,
      changesApplied: true,
      finalVersion: { version: 1, timestamp: new Date('2024-01-15T00:00:00Z').toISOString() },
    }),
  })),
}));

vi.mock('../../src/services/impact-analyzer.js', () => ({
  getImpactAnalyzer: vi.fn(() => ({
    analyzeOperation: vi.fn().mockResolvedValue({
      severity: 'low',
      cellsAffected: 10,
      rowsAffected: 2,
      columnsAffected: 5,
      formulasAffected: [],
      chartsAffected: [],
      pivotTablesAffected: [],
      validationRulesAffected: [],
      namedRangesAffected: [],
      protectedRangesAffected: [],
      warnings: [],
      recommendations: [],
      estimatedExecutionTime: 100,
      dependencies: [],
    }),
  })),
}));

describe('QualityHandler', () => {
  let handler: QualityHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new QualityHandler();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', () => {
      expect(handler).toBeDefined();
      expect(handler).toBeInstanceOf(QualityHandler);
    });
  });

  describe('validate action', () => {
    it('should validate data successfully', async () => {
      const result = await handler.handle({
        action: 'validate',
        value: { name: 'Alice', age: 30 },
        context: { spreadsheetId: 'test123', range: 'Sheet1!A1:B2' },
      });

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'validate');
      expect(result.response).toHaveProperty('valid', true);
      expect(result.response).toHaveProperty('errorCount', 0);
      expect(result.response).toHaveProperty('warningCount', 0);
      expect(result.response).toHaveProperty('totalChecks', 5);
      expect(result.response).toHaveProperty('passedChecks', 5);

      const parseResult = SheetsQualityOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should handle validation with errors', async () => {
      const { getValidationEngine } = await import('../../src/services/validation-engine.js');
      (getValidationEngine as any).mockReturnValueOnce({
        validate: vi.fn().mockResolvedValue({
          valid: false,
          errors: [
            {
              rule: { id: 'rule1', name: 'Required Field' },
              severity: 'error' as const,
              message: 'Field is required',
              value: null,
              cell: 'A1',
            },
          ],
          warnings: [
            {
              rule: { id: 'rule2', name: 'Data Format' },
              message: 'Unusual format detected',
            },
          ],
          infoMessages: [],
          totalChecks: 5,
          passedChecks: 3,
          duration: 15,
        }),
      });

      const result = await handler.handle({
        action: 'validate',
        value: { name: null, age: 'invalid' },
        context: { spreadsheetId: 'test123', range: 'Sheet1!A1:B2' },
      });

      // ISSUE-136 fix: success:false when validation finds errors (eliminates dual-success pattern)
      expect(result.response.success).toBe(false);
      // Error details are embedded in the error.details field
      expect(result.response).toHaveProperty('error');
      expect((result.response as any).error.code).toBe('VALIDATION_ERROR');
      expect((result.response as any).error.details.errorCount).toBe(1);
      expect((result.response as any).error.details.valid).toBe(false);
    });

    it('should support dryRun mode', async () => {
      const result = await handler.handle({
        action: 'validate',
        value: { name: 'Bob', age: 25 },
        context: { spreadsheetId: 'test123', range: 'Sheet1!A1:B2' },
        safety: { dryRun: true },
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('dryRun', true);
      expect(result.response).toHaveProperty('validationPreview');
    });

    it('should apply minimal verbosity filtering', async () => {
      const result = await handler.handle({
        action: 'validate',
        value: { name: 'Carol', age: 28 },
        context: { spreadsheetId: 'test123', range: 'Sheet1!A1:B2' },
        verbosity: 'minimal',
      });

      expect(result.response.success).toBe(true);
      expect(result.response).not.toHaveProperty('_meta');
    });

    it('should support custom comparison rules against context values', async () => {
      const result = await handler.handle({
        action: 'validate',
        value: 120,
        context: {
          spreadsheetId: 'test123',
          cogs: 95,
        },
        rules: [
          {
            type: 'comparison',
            operator: 'gt',
            compareTo: { contextKey: 'cogs' },
            message: 'Unit Price must exceed COGS',
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('valid', true);
      expect(result.response).toHaveProperty('passedChecks', 1);
    });

    it('should fail custom comparison rules when the business rule is violated', async () => {
      const result = await handler.handle({
        action: 'validate',
        value: 80,
        context: {
          spreadsheetId: 'test123',
          cogs: 95,
        },
        rules: [
          {
            type: 'comparison',
            operator: 'gt',
            compareTo: { contextKey: 'cogs' },
            message: 'Unit Price must exceed COGS',
          },
        ],
      });

      expect(result.response.success).toBe(false);
      expect((result.response as any).error.code).toBe('VALIDATION_ERROR');
      expect((result.response as any).error.details.errors[0].message).toBe(
        'Unit Price must exceed COGS'
      );
    });
  });

  describe('detect_conflicts action', () => {
    it('should detect conflicts successfully', async () => {
      const result = await handler.handle({
        action: 'detect_conflicts',
        spreadsheetId: 'test123',
        operations: [
          {
            type: 'update',
            range: 'Sheet1!A1:B2',
            timestamp: new Date('2024-01-15T00:00:00Z').toISOString(),
            userId: 'user1',
          },
        ],
      });

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'detect_conflicts');
      expect((result.response as any).conflicts).toBeDefined();
      expect(Array.isArray((result.response as any).conflicts)).toBe(true);
      expect((result.response as any).conflicts).toHaveLength(0);

      const parseResult = SheetsQualityOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });

  describe('resolve_conflict action', () => {
    it('should resolve conflicts successfully', async () => {
      const result = await handler.handle({
        action: 'resolve_conflict',
        spreadsheetId: 'test123',
        conflictId: 'conflict-123',
        strategy: 'keep_local',
      });

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'resolve_conflict');
      expect(result.response).toHaveProperty('resolved', true);
      expect((result.response as any).resolution).toBeDefined();
      expect((result.response as any).resolution.strategy).toBe('keep_local');

      const parseResult = SheetsQualityOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should support different resolution strategies', async () => {
      const strategies = ['keep_local', 'keep_remote', 'merge', 'manual'] as const;

      for (const strategy of strategies) {
        const result = await handler.handle({
          action: 'resolve_conflict',
          spreadsheetId: 'test123',
          conflictId: 'conflict-123',
          strategy,
        });

        expect(result.response.success).toBe(true);
      }
    });
  });

  describe('analyze_impact action', () => {
    it('should analyze operation impact successfully', async () => {
      const result = await handler.handle({
        action: 'analyze_impact',
        spreadsheetId: 'test123',
        operation: {
          type: 'delete',
          range: 'Sheet1!A1:B10',
        },
      });

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'analyze_impact');
      expect((result.response as any).impact).toBeDefined();
      expect((result.response as any).impact.severity).toBe('low');
      expect((result.response as any).impact.scope.cells).toBe(10);
      expect((result.response as any).impact.scope.rows).toBe(2);
      expect((result.response as any).impact.scope.columns).toBe(5);

      const parseResult = SheetsQualityOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should analyze high-severity operations', async () => {
      const { getImpactAnalyzer } = await import('../../src/services/impact-analyzer.js');
      (getImpactAnalyzer as any).mockReturnValueOnce({
        analyzeOperation: vi.fn().mockResolvedValue({
          severity: 'critical',
          cellsAffected: 1000,
          rowsAffected: 100,
          columnsAffected: 10,
          formulasAffected: [{ cell: 'C1', formula: '=SUM(A1:B10)', impactType: 'broken' }],
          chartsAffected: [
            { title: 'Chart 1', chartType: 'LINE', impactType: 'data_source_changed' },
          ],
          pivotTablesAffected: [],
          validationRulesAffected: [],
          namedRangesAffected: [],
          protectedRangesAffected: [],
          warnings: [
            {
              type: 'formula_break',
              severity: 'high',
              message: 'This operation will break 1 formula(s)',
              suggestedAction: 'Review formulas before proceeding',
            },
          ],
          recommendations: ['Review affected formulas'],
          estimatedExecutionTime: 500,
          dependencies: ['Sheet2!A1:B10'],
        }),
      });

      const result = await handler.handle({
        action: 'analyze_impact',
        spreadsheetId: 'test123',
        operation: {
          type: 'delete',
          range: 'Sheet1!A1:J100',
        },
      });

      expect(result.response.success).toBe(true);
      expect((result.response as any).impact).toBeDefined();
      expect((result.response as any).impact.severity).toBe('critical');
      expect((result.response as any).impact.scope.cells).toBe(1000);
    });
  });

  describe('error handling', () => {
    it('should handle unknown actions', async () => {
      const result = await handler.handle({
        action: 'unknown_action' as any,
      } as any);

      expect(result.response.success).toBe(false);
      expect((result.response as any).error).toBeDefined();
      expect((result.response as any).error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('verbosity filtering', () => {
    it('should apply minimal verbosity', async () => {
      const result = await handler.handle({
        action: 'validate',
        value: { test: 'data' },
        context: { spreadsheetId: 'test123', range: 'Sheet1!A1' },
        verbosity: 'minimal',
      });

      expect(result.response).not.toHaveProperty('_meta');
    });

    it('should preserve standard verbosity', async () => {
      const result = await handler.handle({
        action: 'validate',
        value: { test: 'data' },
        context: { spreadsheetId: 'test123', range: 'Sheet1!A1' },
        verbosity: 'standard',
      });

      expect(result.response.success).toBe(true);
      // Standard verbosity doesn't filter anything
    });

    it('should preserve detailed verbosity', async () => {
      const result = await handler.handle({
        action: 'validate',
        value: { test: 'data' },
        context: { spreadsheetId: 'test123', range: 'Sheet1!A1' },
        verbosity: 'detailed',
      });

      expect(result.response.success).toBe(true);
      // Detailed verbosity doesn't filter anything
    });
  });
});
