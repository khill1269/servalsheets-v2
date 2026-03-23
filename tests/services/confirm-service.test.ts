/**
 * ServalSheets - ConfirmService Tests
 *
 * Comprehensive tests for user confirmation service
 * Tests plan formatting, elicitation, result processing, risk calculation, and statistics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getConfirmationService,
  resetConfirmationService,
  type OperationPlan,
  type PlanStep,
  type RiskLevel,
} from '../../src/services/confirm-service.js';

describe('ConfirmService', () => {
  let service: ReturnType<typeof getConfirmationService>;

  beforeEach(() => {
    resetConfirmationService();
    service = getConfirmationService();
  });

  afterEach(() => {
    resetConfirmationService();
  });

  describe('Plan Formatting', () => {
    it('should format basic plan for display', () => {
      const plan: OperationPlan = {
        id: 'test-plan-1',
        title: 'Delete Rows',
        description: 'Remove empty rows from sheet',
        steps: [
          {
            stepNumber: 1,
            description: 'Identify empty rows',
            tool: 'sheets_data',
            action: 'read',
            risk: 'low',
          },
          {
            stepNumber: 2,
            description: 'Delete identified rows',
            tool: 'sheets_dimensions',
            action: 'delete',
            risk: 'high',
            isDestructive: true,
          },
        ],
        overallRisk: 'high',
        totalApiCalls: 5,
        estimatedTime: 3,
        willCreateSnapshot: true,
        warnings: ['2 step(s) will modify or delete data'],
      };

      const formatted = service.formatPlanForDisplay(plan);

      expect(formatted).toContain('Delete Rows');
      expect(formatted).toContain('Remove empty rows from sheet');
      expect(formatted).toContain('Identify empty rows');
      expect(formatted).toContain('Delete identified rows');
      expect(formatted).toContain('**Total steps:** 2');
      expect(formatted).toContain('**Estimated API calls:** 5');
      expect(formatted).toContain('**Estimated time:** 3s');
      expect(formatted).toContain('**Overall risk:** HIGH');
      expect(formatted).toContain('**Snapshot:** Will be created');
      expect(formatted).toContain('⚠️ Warnings:');
      expect(formatted).toContain('2 step(s) will modify or delete data');
    });

    it('should include risk emojis for each step', () => {
      const plan: OperationPlan = {
        id: 'test-plan-2',
        title: 'Test Plan',
        description: 'Test',
        steps: [
          { stepNumber: 1, description: 'Low risk', tool: 'test', action: 'test', risk: 'low' },
          {
            stepNumber: 2,
            description: 'Medium risk',
            tool: 'test',
            action: 'test',
            risk: 'medium',
          },
          { stepNumber: 3, description: 'High risk', tool: 'test', action: 'test', risk: 'high' },
          {
            stepNumber: 4,
            description: 'Critical risk',
            tool: 'test',
            action: 'test',
            risk: 'critical',
          },
        ],
        overallRisk: 'critical',
        totalApiCalls: 4,
        estimatedTime: 2,
        willCreateSnapshot: false,
        warnings: [],
      };

      const formatted = service.formatPlanForDisplay(plan);

      expect(formatted).toContain('🟢'); // low
      expect(formatted).toContain('🟡'); // medium
      expect(formatted).toContain('🟠'); // high
      expect(formatted).toContain('🔴'); // critical
    });

    it('should mark destructive steps with warning emoji', () => {
      const plan: OperationPlan = {
        id: 'test-plan-3',
        title: 'Test',
        description: 'Test',
        steps: [
          {
            stepNumber: 1,
            description: 'Destructive step',
            tool: 'test',
            action: 'test',
            risk: 'high',
            isDestructive: true,
          },
        ],
        overallRisk: 'high',
        totalApiCalls: 1,
        estimatedTime: 1,
        willCreateSnapshot: true,
        warnings: [],
      };

      const formatted = service.formatPlanForDisplay(plan);

      expect(formatted).toContain('⚠️'); // destructive marker
    });

    it('should include optional plan metadata sections when provided', () => {
      const plan: OperationPlan = {
        id: 'test-plan-metadata',
        title: 'Safe Migration',
        description: 'Move data to a new layout',
        steps: [
          {
            stepNumber: 1,
            description: 'Create destination sheet',
            tool: 'sheets_core',
            action: 'add_sheet',
            risk: 'low',
          },
        ],
        overallRisk: 'low',
        totalApiCalls: 2,
        estimatedTime: 1,
        willCreateSnapshot: true,
        warnings: [],
        successCriteria: ['All rows copied', 'No formula errors introduced'],
        rollbackStrategy: 'Restore pre-migration snapshot and delete destination sheet.',
        alternatives: [
          {
            description: 'In-place transformation',
            reason: 'Higher risk to existing formulas',
          },
        ],
      };

      const formatted = service.formatPlanForDisplay(plan);

      expect(formatted).toContain('### Success Criteria:');
      expect(formatted).toContain('All rows copied');
      expect(formatted).toContain('### Rollback Strategy:');
      expect(formatted).toContain('Restore pre-migration snapshot');
      expect(formatted).toContain('### Alternatives Considered:');
      expect(formatted).toContain('In-place transformation');
    });
  });

  describe('Elicitation Request Building', () => {
    it('should build valid elicitation request', () => {
      const plan: OperationPlan = {
        id: 'test-plan-4',
        title: 'Update Values',
        description: 'Batch update cells',
        steps: [
          {
            stepNumber: 1,
            description: 'Update cells',
            tool: 'sheets_data',
            action: 'batch_update',
            risk: 'medium',
          },
        ],
        overallRisk: 'medium',
        totalApiCalls: 3,
        estimatedTime: 2,
        willCreateSnapshot: true,
        warnings: [],
      };

      const request = service.buildElicitationRequest(plan);

      expect(request.mode).toBe('form');
      expect(request.message).toContain('Update Values');
      expect(request.requestedSchema.type).toBe('object');
      expect(request.requestedSchema.properties).toHaveProperty('approved');
      expect(request.requestedSchema.properties).toHaveProperty('modifications');
      expect(request.requestedSchema.properties).toHaveProperty('skipSnapshot');
      expect(request.requestedSchema.required).toEqual(['approved']);
    });

    it('should include schema with correct types', () => {
      const plan: OperationPlan = {
        id: 'test-plan-5',
        title: 'Test',
        description: 'Test',
        steps: [],
        overallRisk: 'low',
        totalApiCalls: 1,
        estimatedTime: 1,
        willCreateSnapshot: false,
        warnings: [],
      };

      const request = service.buildElicitationRequest(plan);
      const schema = request.requestedSchema;

      // Check approved field
      const approvedProp = schema.properties['approved'] as Record<string, unknown>;
      expect(approvedProp.type).toBe('boolean');
      expect(approvedProp.title).toBe('Execute this plan?');
      expect(approvedProp.default).toBe(true);

      // Check modifications field
      const modificationsProp = schema.properties['modifications'] as Record<string, unknown>;
      expect(modificationsProp.type).toBe('string');
      expect(modificationsProp.title).toBe('Modifications (optional)');

      // Check skipSnapshot field
      const skipSnapshotProp = schema.properties['skipSnapshot'] as Record<string, unknown>;
      expect(skipSnapshotProp.type).toBe('boolean');
      expect(skipSnapshotProp.default).toBe(false);
    });
  });

  describe('Result Processing', () => {
    it('should process accept result with approval', () => {
      const elicitResult = {
        action: 'accept',
        content: {
          approved: true,
          modifications: 'Skip step 2',
        },
      };

      const result = service.processElicitationResult(elicitResult, 1704067200000 - 1000);

      expect(result.approved).toBe(true);
      expect(result.action).toBe('accept');
      expect(result.modifications).toBe('Skip step 2');
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should process decline result', () => {
      const elicitResult = {
        action: 'decline',
      };

      const result = service.processElicitationResult(elicitResult, 1704067200000 - 500);

      expect(result.approved).toBe(false);
      expect(result.action).toBe('decline');
      expect(result.modifications).toBeUndefined();
    });

    it('should process cancel result', () => {
      const elicitResult = {
        action: 'cancel',
      };

      const result = service.processElicitationResult(elicitResult, 1704067200000 - 200);

      expect(result.approved).toBe(false);
      expect(result.action).toBe('cancel');
    });

    it('should update statistics after processing', () => {
      // Process multiple results
      service.processElicitationResult(
        { action: 'accept', content: { approved: true } },
        1704067200000 - 1000
      );
      service.processElicitationResult(
        { action: 'accept', content: { approved: true } },
        1704067200000 - 800
      );
      service.processElicitationResult({ action: 'decline' }, 1704067200000 - 600);

      const stats = service.getStats();

      expect(stats.totalConfirmations).toBe(3);
      expect(stats.approved).toBe(2);
      expect(stats.declined).toBe(1);
      expect(stats.cancelled).toBe(0);
      expect(stats.approvalRate).toBeCloseTo(66.67, 1);
      expect(stats.avgResponseTime).toBeGreaterThan(0);
    });
  });

  describe('Risk Calculation', () => {
    it('should calculate low risk for single low-risk step', () => {
      const steps: PlanStep[] = [
        { stepNumber: 1, description: 'Read data', tool: 'test', action: 'test', risk: 'low' },
      ];

      const risk = service.calculateOverallRisk(steps);

      expect(risk).toBe('low');
    });

    it('should calculate highest risk from multiple steps', () => {
      const steps: PlanStep[] = [
        { stepNumber: 1, description: 'Step 1', tool: 'test', action: 'test', risk: 'low' },
        { stepNumber: 2, description: 'Step 2', tool: 'test', action: 'test', risk: 'high' },
        { stepNumber: 3, description: 'Step 3', tool: 'test', action: 'test', risk: 'medium' },
      ];

      const risk = service.calculateOverallRisk(steps);

      expect(risk).toBe('high');
    });

    it('should escalate risk for many steps (>5)', () => {
      const steps: PlanStep[] = Array.from({ length: 6 }, (_, i) => ({
        stepNumber: i + 1,
        description: `Step ${i + 1}`,
        tool: 'test',
        action: 'test',
        risk: 'low' as RiskLevel,
      }));

      const risk = service.calculateOverallRisk(steps);

      // Should escalate from low to medium due to >5 steps
      expect(risk).toBe('medium');
    });

    it('should escalate risk for multiple destructive steps (>2)', () => {
      const steps: PlanStep[] = [
        {
          stepNumber: 1,
          description: 'Delete 1',
          tool: 'test',
          action: 'test',
          risk: 'low',
          isDestructive: true,
        },
        {
          stepNumber: 2,
          description: 'Delete 2',
          tool: 'test',
          action: 'test',
          risk: 'low',
          isDestructive: true,
        },
        {
          stepNumber: 3,
          description: 'Delete 3',
          tool: 'test',
          action: 'test',
          risk: 'low',
          isDestructive: true,
        },
      ];

      const risk = service.calculateOverallRisk(steps);

      // Should escalate due to >2 destructive steps
      expect(risk).toBe('medium');
    });

    it('should not escalate critical risk beyond critical', () => {
      const steps: PlanStep[] = Array.from({ length: 10 }, (_, i) => ({
        stepNumber: i + 1,
        description: `Step ${i + 1}`,
        tool: 'test',
        action: 'test',
        risk: 'critical' as RiskLevel,
        isDestructive: true,
      }));

      const risk = service.calculateOverallRisk(steps);

      expect(risk).toBe('critical'); // Should stay at critical, not exceed
    });
  });

  describe('Warning Generation', () => {
    it('should warn about destructive operations', () => {
      const plan: OperationPlan = {
        id: 'test',
        title: 'Test',
        description: 'Test',
        steps: [
          {
            stepNumber: 1,
            description: 'Delete',
            tool: 'test',
            action: 'test',
            risk: 'high',
            isDestructive: true,
          },
          {
            stepNumber: 2,
            description: 'Delete',
            tool: 'test',
            action: 'test',
            risk: 'high',
            isDestructive: true,
          },
        ],
        overallRisk: 'high',
        totalApiCalls: 2,
        estimatedTime: 1,
        willCreateSnapshot: false,
        warnings: [],
      };

      const warnings = service.generateWarnings(plan);

      expect(warnings).toContain('2 step(s) will modify or delete data');
    });

    it('should warn about non-undoable operations', () => {
      const plan: OperationPlan = {
        id: 'test',
        title: 'Test',
        description: 'Test',
        steps: [
          {
            stepNumber: 1,
            description: 'Permanent change',
            tool: 'test',
            action: 'test',
            risk: 'medium',
            canUndo: false,
          },
        ],
        overallRisk: 'medium',
        totalApiCalls: 1,
        estimatedTime: 1,
        willCreateSnapshot: false,
        warnings: [],
      };

      const warnings = service.generateWarnings(plan);

      expect(warnings).toContain('1 step(s) cannot be automatically undone');
    });

    it('should warn about high API usage (>20 calls)', () => {
      const plan: OperationPlan = {
        id: 'test',
        title: 'Test',
        description: 'Test',
        steps: [],
        overallRisk: 'medium',
        totalApiCalls: 25,
        estimatedTime: 15,
        willCreateSnapshot: false,
        warnings: [],
      };

      const warnings = service.generateWarnings(plan);

      expect(warnings).toContain('High API usage: 25 calls (may impact quota)');
    });

    it('should warn about long execution time (>30s)', () => {
      const plan: OperationPlan = {
        id: 'test',
        title: 'Test',
        description: 'Test',
        steps: [],
        overallRisk: 'low',
        totalApiCalls: 10,
        estimatedTime: 45,
        willCreateSnapshot: false,
        warnings: [],
      };

      const warnings = service.generateWarnings(plan);

      expect(warnings).toContain('Long execution time: ~45s');
    });

    it('should warn about critical risk level', () => {
      const plan: OperationPlan = {
        id: 'test',
        title: 'Test',
        description: 'Test',
        steps: [],
        overallRisk: 'critical',
        totalApiCalls: 5,
        estimatedTime: 3,
        willCreateSnapshot: false,
        warnings: [],
      };

      const warnings = service.generateWarnings(plan);

      expect(warnings).toContain('This plan has CRITICAL risk level - review carefully');
    });

    it('should combine multiple warnings', () => {
      const plan: OperationPlan = {
        id: 'test',
        title: 'Test',
        description: 'Test',
        steps: [
          {
            stepNumber: 1,
            description: 'Delete',
            tool: 'test',
            action: 'test',
            risk: 'critical',
            isDestructive: true,
            canUndo: false,
          },
        ],
        overallRisk: 'critical',
        totalApiCalls: 30,
        estimatedTime: 40,
        willCreateSnapshot: false,
        warnings: [],
      };

      const warnings = service.generateWarnings(plan);

      expect(warnings.length).toBeGreaterThanOrEqual(5);
    });

    it('should include annotation warning for non-idempotent actions', () => {
      const plan: OperationPlan = {
        id: 'test',
        title: 'Test',
        description: 'Test',
        steps: [
          {
            stepNumber: 1,
            description: 'Append rows',
            tool: 'sheets_data',
            action: 'append',
            risk: 'medium',
            estimatedApiCalls: 1,
          },
        ],
        overallRisk: 'medium',
        totalApiCalls: 1,
        estimatedTime: 1,
        willCreateSnapshot: false,
        warnings: [],
      };

      const warnings = service.generateWarnings(plan);

      expect(
        warnings.some((warning) =>
          warning.includes('Step 1 (sheets_data.append) is non-idempotent')
        )
      ).toBe(true);
    });
  });

  describe('Plan Creation Helper', () => {
    it('should create plan with calculated values', () => {
      const steps: PlanStep[] = [
        {
          stepNumber: 1,
          description: 'Step 1',
          tool: 'sheets_data',
          action: 'read',
          risk: 'low',
          estimatedApiCalls: 2,
        },
        {
          stepNumber: 2,
          description: 'Step 2',
          tool: 'sheets_data',
          action: 'update',
          risk: 'medium',
          estimatedApiCalls: 3,
        },
      ];

      const plan = service.createPlan('Test Operation', 'Test description', steps);

      expect(plan.id).toMatch(/^plan_\d+_[a-z0-9]+$/);
      expect(plan.title).toBe('Test Operation');
      expect(plan.description).toBe('Test description');
      expect(plan.steps).toHaveLength(2);
      expect(plan.overallRisk).toBe('medium'); // Highest from steps
      expect(plan.totalApiCalls).toBe(5); // 2 + 3
      expect(plan.estimatedTime).toBe(3); // Math.ceil(5 * 0.5)
      expect(plan.willCreateSnapshot).toBe(true); // Default
      expect(Array.isArray(plan.warnings)).toBe(true);
    });

    it('should accept custom snapshot option', () => {
      const steps: PlanStep[] = [
        { stepNumber: 1, description: 'Read', tool: 'test', action: 'test', risk: 'low' },
      ];

      const plan = service.createPlan('Test', 'Test', steps, { willCreateSnapshot: false });

      expect(plan.willCreateSnapshot).toBe(false);
    });

    it('should accept additional warnings', () => {
      const steps: PlanStep[] = [
        { stepNumber: 1, description: 'Read', tool: 'test', action: 'test', risk: 'low' },
      ];

      const plan = service.createPlan('Test', 'Test', steps, {
        additionalWarnings: ['Custom warning 1', 'Custom warning 2'],
      });

      expect(plan.warnings).toContain('Custom warning 1');
      expect(plan.warnings).toContain('Custom warning 2');
    });

    it('should default to 1 API call per step if not specified', () => {
      const steps: PlanStep[] = [
        { stepNumber: 1, description: 'Step 1', tool: 'test', action: 'test', risk: 'low' },
        { stepNumber: 2, description: 'Step 2', tool: 'test', action: 'test', risk: 'low' },
        { stepNumber: 3, description: 'Step 3', tool: 'test', action: 'test', risk: 'low' },
      ];

      const plan = service.createPlan('Test', 'Test', steps);

      expect(plan.totalApiCalls).toBe(3); // 3 steps × 1 call each
    });

    it('should carry optional plan metadata through createPlan', () => {
      const steps: PlanStep[] = [
        { stepNumber: 1, description: 'Read', tool: 'sheets_data', action: 'read', risk: 'low' },
      ];

      const plan = service.createPlan('Test', 'Test', steps, {
        successCriteria: ['Output sheet exists'],
        rollbackStrategy: 'Delete output sheet',
        alternatives: [{ description: 'Manual copy', reason: 'Too slow for large datasets' }],
      });

      expect(plan.successCriteria).toEqual(['Output sheet exists']);
      expect(plan.rollbackStrategy).toBe('Delete output sheet');
      expect(plan.alternatives?.[0]?.description).toBe('Manual copy');
    });
  });

  describe('Statistics', () => {
    it('should track approval rate correctly', () => {
      // Start with clean stats
      expect(service.getStats().approvalRate).toBe(0);

      // 3 approvals out of 4 total = 75%
      service.processElicitationResult(
        { action: 'accept', content: { approved: true } },
        1704067200000
      );
      service.processElicitationResult(
        { action: 'accept', content: { approved: true } },
        1704067200000
      );
      service.processElicitationResult(
        { action: 'accept', content: { approved: true } },
        1704067200000
      );
      service.processElicitationResult({ action: 'decline' }, 1704067200000);

      const stats = service.getStats();
      expect(stats.approvalRate).toBe(75);
    });

    it('should track average response time', () => {
      const now = Date.now();
      // Process with known response times
      service.processElicitationResult(
        { action: 'accept', content: { approved: true } },
        now - 1000
      ); // 1000ms
      service.processElicitationResult(
        { action: 'accept', content: { approved: true } },
        now - 2000
      ); // 2000ms
      service.processElicitationResult({ action: 'decline' }, now - 3000); // 3000ms

      const stats = service.getStats();

      // Average should be (1000 + 2000 + 3000) / 3 = 2000ms
      expect(stats.avgResponseTime).toBeCloseTo(2000, 0);
    });

    it('should reset statistics', () => {
      // Add some data
      service.processElicitationResult(
        { action: 'accept', content: { approved: true } },
        1704067200000
      );
      service.processElicitationResult({ action: 'decline' }, 1704067200000);

      let stats = service.getStats();
      expect(stats.totalConfirmations).toBe(2);

      // Reset
      service.resetStats();

      stats = service.getStats();
      expect(stats.totalConfirmations).toBe(0);
      expect(stats.approved).toBe(0);
      expect(stats.declined).toBe(0);
      expect(stats.cancelled).toBe(0);
      expect(stats.approvalRate).toBe(0);
      expect(stats.avgResponseTime).toBe(0);
    });

    it('should limit response time history to 100 entries', () => {
      const now = 1704067200100;
      const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
      // Process 150 confirmations
      try {
        for (let i = 0; i < 150; i++) {
          service.processElicitationResult(
            { action: 'accept', content: { approved: true } },
            now - 100
          );
        }
      } finally {
        dateNowSpy.mockRestore();
      }

      const stats = service.getStats();
      expect(stats.totalConfirmations).toBe(150);
      // Average should be based on last 100 only (internal limit)
      expect(stats.avgResponseTime).toBeCloseTo(100, 0);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance on multiple calls', () => {
      const service1 = getConfirmationService();
      const service2 = getConfirmationService();

      expect(service1).toBe(service2);
    });

    it('should return new instance after reset', () => {
      const service1 = getConfirmationService();

      resetConfirmationService();

      const service2 = getConfirmationService();

      expect(service1).not.toBe(service2);
    });

    it('should preserve stats across singleton calls', () => {
      const service1 = getConfirmationService();
      service1.processElicitationResult(
        { action: 'accept', content: { approved: true } },
        1704067200000
      );

      const service2 = getConfirmationService();
      const stats = service2.getStats();

      expect(stats.totalConfirmations).toBe(1);
    });
  });
});
