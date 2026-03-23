/**
 * Tests for Response Enhancer - Quick Win #1: Semantic Priority Suggestions
 */

import { describe, it, expect } from 'vitest';
import {
  generateSuggestions,
  estimateCost,
  enhanceResponse,
  type EnhancementContext,
} from '../../src/utils/response-enhancer.js';

describe('Response Enhancer - Quick Win #1', () => {
  describe('generateSuggestions', () => {
    it('should prioritize quality issues as HIGH priority', () => {
      const context: EnhancementContext = {
        tool: 'sheets_data',
        action: 'read',
        input: {},
        result: {
          values: [
            ['A', 'B'],
            [1, 2],
          ],
          quality: {
            issues: [
              { type: 'empty_cells', count: 5 },
              { type: 'inconsistent_format', count: 3 },
            ],
          },
        },
      };

      const suggestions = generateSuggestions(context);

      // Should have quality fix as first suggestion (HIGH priority)
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].priority).toBe('high');
      expect(suggestions[0].tool).toBe('sheets_quality');
      expect(suggestions[0].action).toBe('fix');
      expect(suggestions[0].message).toContain('2 quality issues'); // 2 items in issues array
    });

    it('should flag destructive operations without dryRun as HIGH priority', () => {
      const context: EnhancementContext = {
        tool: 'sheets_data',
        action: 'clear',
        input: {}, // No safety.dryRun
        result: { success: true },
        cellsAffected: 100,
      };

      const suggestions = generateSuggestions(context);

      const destructiveWarning = suggestions.find((s) => s.message.includes('dryRun'));
      expect(destructiveWarning).toBeDefined();
      expect(destructiveWarning?.priority).toBe('high');
      expect(destructiveWarning?.type).toBe('warning');
    });

    it('should suggest batch operations for large writes as HIGH priority', () => {
      const context: EnhancementContext = {
        tool: 'sheets_data',
        action: 'write',
        input: {},
        result: { success: true },
        cellsAffected: 5000, // Large write
      };

      const suggestions = generateSuggestions(context);

      const batchSuggestion = suggestions.find((s) => s.action === 'batch_write');
      expect(batchSuggestion).toBeDefined();
      expect(batchSuggestion?.priority).toBe('high');
      expect(batchSuggestion?.message).toContain('5000 cells');
      expect(batchSuggestion?.reason).toContain('reduce API calls');
    });

    it('should suggest snapshots for large changes as HIGH priority', () => {
      const context: EnhancementContext = {
        tool: 'sheets_data',
        action: 'write',
        input: {},
        result: { success: true },
        cellsAffected: 10000, // Large change
      };

      const suggestions = generateSuggestions(context);

      const snapshotSuggestion = suggestions.find((s) =>
        s.action?.includes('version_create_snapshot')
      );
      expect(snapshotSuggestion).toBeDefined();
      expect(snapshotSuggestion?.priority).toBe('high');
      expect(snapshotSuggestion?.message).toContain('10000 cells');
    });

    it('should suggest visualization for data with patterns as MEDIUM priority', () => {
      const context: EnhancementContext = {
        tool: 'sheets_data',
        action: 'read',
        input: {},
        result: {
          values: [
            ['Month', 'Sales'],
            ['Jan', 100],
            ['Feb', 150],
            ['Mar', 200],
            // ... 20+ rows
            ...Array.from({ length: 20 }, (_, i) => [`Month${i}`, i * 10]),
          ],
        },
      };

      const suggestions = generateSuggestions(context);

      const vizSuggestion = suggestions.find((s) => s.tool === 'sheets_visualize');
      expect(vizSuggestion).toBeDefined();
      expect(vizSuggestion?.priority).toBe('medium');
      expect(vizSuggestion?.message).toContain('visualization');
    });

    it('should suggest batch_read for non-batch reads as MEDIUM priority', () => {
      const context: EnhancementContext = {
        tool: 'sheets_data',
        action: 'read',
        input: {},
        result: { values: [['A', 'B']] },
      };

      const suggestions = generateSuggestions(context);

      const batchSuggestion = suggestions.find((s) => s.action === 'batch_read');
      expect(batchSuggestion).toBeDefined();
      expect(batchSuggestion?.priority).toBe('medium');
      expect(batchSuggestion?.reason).toContain('80%');
    });

    it('should suggest formatting after writes as LOW priority', () => {
      const context: EnhancementContext = {
        tool: 'sheets_data',
        action: 'write',
        input: {},
        result: { success: true },
        cellsAffected: 50,
      };

      const suggestions = generateSuggestions(context);

      const formatSuggestion = suggestions.find((s) => s.tool === 'sheets_format');
      expect(formatSuggestion).toBeDefined();
      expect(formatSuggestion?.priority).toBe('low');
    });

    it('should sort suggestions by priority (HIGH > MEDIUM > LOW)', () => {
      const context: EnhancementContext = {
        tool: 'sheets_data',
        action: 'write',
        input: {},
        result: {
          success: true,
          quality: {
            issues: [{ type: 'empty_cells', count: 5 }],
          },
        },
        cellsAffected: 5000, // Triggers HIGH (batch), HIGH (snapshot), LOW (format)
      };

      const suggestions = generateSuggestions(context);

      // All HIGH priority suggestions should come first
      const priorities = suggestions.map((s) => s.priority);
      expect(priorities[0]).toBe('high');
      expect(priorities[priorities.length - 1]).toBe('low');

      // Verify sorting is stable
      const getPriorityValue = (priority: string | undefined): number => {
        if (priority === 'high') return 0;
        if (priority === 'medium') return 1;
        return 2;
      };

      let lastPriorityValue = 0;
      for (const s of suggestions) {
        const priorityValue = getPriorityValue(s.priority);
        expect(priorityValue).toBeGreaterThanOrEqual(lastPriorityValue);
        lastPriorityValue = priorityValue;
      }
    });

    it('should not suggest dryRun warning if dryRun was used', () => {
      const context: EnhancementContext = {
        tool: 'sheets_data',
        action: 'clear',
        input: {
          safety: { dryRun: true },
        },
        result: { success: true },
      };

      const suggestions = generateSuggestions(context);

      const dryRunWarning = suggestions.find((s) => s.message.includes('dryRun'));
      expect(dryRunWarning).toBeUndefined();
    });

    it('should not suggest visualization for non-numeric data', () => {
      const context: EnhancementContext = {
        tool: 'sheets_data',
        action: 'read',
        input: {},
        result: {
          values: [
            ['Name', 'Email'],
            ['Alice', 'alice@example.com'],
            ['Bob', 'bob@example.com'],
            // ... 25 rows (enough to trigger suggestion)
            ...Array.from({ length: 23 }, (_, i) => [`User${i}`, `user${i}@example.com`]),
          ],
        },
      };

      const suggestions = generateSuggestions(context);

      const vizSuggestion = suggestions.find((s) => s.tool === 'sheets_visualize');
      expect(vizSuggestion).toBeUndefined();
    });

    it('should include impact estimates in reasons', () => {
      const context: EnhancementContext = {
        tool: 'sheets_data',
        action: 'write',
        input: {},
        result: { success: true },
        cellsAffected: 2000, // > 1000 to trigger batch suggestion
      };

      const suggestions = generateSuggestions(context);

      // All suggestions should have reasons with impact information
      for (const suggestion of suggestions) {
        expect(suggestion.reason).toEqual(expect.any(String));
        expect(suggestion.reason.length).toBeGreaterThan(0);
        expect(suggestion.reason.length).toBeGreaterThan(20);
      }

      // Batch suggestion should include specific savings
      const batchSuggestion = suggestions.find((s) => s.action === 'batch_write');
      expect(batchSuggestion).toBeDefined();
      expect(batchSuggestion?.reason).toMatch(/\d+ms/); // Should include millisecond savings
    });
  });

  describe('estimateCost', () => {
    it('should estimate cost for batch operations', () => {
      const context: EnhancementContext = {
        tool: 'sheets_data',
        action: 'batch_read',
        input: {
          ranges: ['A1:A10', 'B1:B10', 'C1:C10'],
        },
        apiCallsMade: 1,
      };

      const cost = estimateCost(context);

      expect(cost.apiCalls).toBe(1);
      expect(cost.estimatedLatencyMs).toBeGreaterThan(0);
    });

    it('should track quota impact', () => {
      const context: EnhancementContext = {
        tool: 'sheets_data',
        action: 'read',
        input: {},
        apiCallsMade: 5,
      };

      const cost = estimateCost(context);

      expect(cost.quotaImpact).toBeDefined();
      expect(cost.quotaImpact?.limit).toBe(60);
      expect(cost.quotaImpact?.remaining).toBeLessThanOrEqual(60);
    });
  });

  describe('enhanceResponse', () => {
    it('should combine suggestions, cost, and related tools', () => {
      const context: EnhancementContext = {
        tool: 'sheets_data',
        action: 'read',
        input: {},
        result: {
          values: [['A', 'B']],
          quality: {
            issues: [{ type: 'empty_cells', count: 3 }],
          },
        },
        cellsAffected: 100,
        apiCallsMade: 1,
        duration: 250,
      };

      const meta = enhanceResponse(context);

      expect(meta.suggestions).toBeDefined();
      expect(meta.suggestions!.length).toBeGreaterThan(0);
      expect(meta.costEstimate).toBeDefined();
      expect(meta.relatedTools).toBeDefined();

      // First suggestion should be HIGH priority (quality issue)
      expect(meta.suggestions![0].priority).toBe('high');
    });

    it('should include next steps for common workflows', () => {
      const context: EnhancementContext = {
        tool: 'sheets_data',
        action: 'write',
        input: {},
        result: { success: true },
        cellsAffected: 50,
      };

      const meta = enhanceResponse(context);

      expect(meta.nextSteps).toBeDefined();
      expect(meta.nextSteps!.length).toBeGreaterThan(0);
    });

    it('should omit empty fields', () => {
      const context: EnhancementContext = {
        tool: 'sheets_auth',
        action: 'status',
        input: {},
        result: { authenticated: true },
      };

      const meta = enhanceResponse(context);

      // Should not include suggestions if there are none
      if (!meta.suggestions || meta.suggestions.length === 0) {
        expect(meta.suggestions).toBeUndefined();
      }
    });
  });
});
