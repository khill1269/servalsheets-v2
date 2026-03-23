/**
 * Schema-Handler Alignment Contract Tests
 *
 * Ensures that handler switch statements align with schema action enums.
 * This prevents drift between schema definitions and handler implementations.
 *
 * Test Philosophy:
 * - Schema is source of truth (z.discriminatedUnion('action', [...]))
 * - Handler must have matching top-level cases
 * - Parameter-level switches are NOT tested (implementation detail)
 * - Documented deviations are acceptable (aliases, backward compat, etc.)
 *
 * Uses Shared Parser:
 * - src/utils/ast-schema-parser.ts - Advanced AST parsing (4 schema + 3 handler patterns)
 * - src/schemas/handler-deviations.ts - Documented acceptable deviations
 *
 * Expected Results:
 * - 24/25 tools: Perfect alignment (0 deviations)
 * - 1/25 tools: Alignment with documented deviations (sheets_core)
 * - 0 undocumented deviations allowed
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  extractSchemaActions,
  extractHandlerCases,
  isSingleActionTool,
} from '../../src/utils/ast-schema-parser.js';
import { ACCEPTABLE_DEVIATIONS, getToolDeviation } from '../../src/schemas/handler-deviations.js';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

const TOOLS = [
  'advanced',
  'agent',
  'analyze',
  'appsscript',
  'auth',
  'bigquery',
  'collaborate',
  'composite',
  'compute',
  'confirm',
  'connectors',
  'core',
  'data',
  'dependencies',
  'dimensions',
  'federation',
  'fix',
  'format',
  'history',
  'quality',
  'session',
  'templates',
  'transaction',
  'visualize',
  'webhook',
];

// Edge case: Some handlers have different names than schemas
const HANDLER_NAME_OVERRIDES: Record<string, string> = {
  webhook: 'webhooks', // Schema is webhook.ts, handler is webhooks.ts
};

describe('Schema-Handler Alignment', () => {
  describe('Contract: Handler cases must match schema actions', () => {
    TOOLS.forEach((tool) => {
      it(`sheets_${tool}: handler cases align with schema actions`, () => {
        const schemaPath = path.join(PROJECT_ROOT, `src/schemas/${tool}.ts`);
        const handlerName = HANDLER_NAME_OVERRIDES[tool] || tool;
        const handlerPath = path.join(PROJECT_ROOT, `src/handlers/${handlerName}.ts`);

        // Extract actions from schema using shared parser
        const schemaActions = extractSchemaActions(schemaPath);
        expect(schemaActions.length).toBeGreaterThan(0, `Schema ${tool}.ts has no actions defined`);

        // Extract cases from handler using shared parser
        const handlerCases = extractHandlerCases(handlerPath);

        // Special case: Single-action tools don't need switch statements
        if (isSingleActionTool(schemaActions, handlerCases)) {
          expect(schemaActions.length).toBe(1);
          expect(handlerCases.length).toBe(0);
          return; // Single-action tool - alignment verified
        }

        expect(handlerCases.length).toBeGreaterThan(0, `Handler ${tool}.ts has no switch cases`);

        // Check alignment
        const extra = handlerCases.filter((c) => !schemaActions.includes(c));
        const missing = schemaActions.filter((a) => !handlerCases.includes(a));

        // Get documented deviations for this tool
        const deviation = getToolDeviation(tool);

        if (deviation) {
          // Tool has documented deviations - validate they match
          const documentedExtra = deviation.extraCases || [];
          const documentedMissing = deviation.missingCases || [];

          // Check for UNDOCUMENTED extra cases
          const undocumentedExtra = extra.filter((c) => !documentedExtra.includes(c));
          const undocumentedMissing = missing.filter((a) => !documentedMissing.includes(a));

          // Report all misalignments for visibility
          if (extra.length > 0) {
            console.log(
              `✓ sheets_${tool}: ${extra.length} documented extra cases: ${extra.join(', ')}`
            );
            console.log(`  Reason: ${deviation.reason}`);
          }
          if (missing.length > 0) {
            console.log(
              `✓ sheets_${tool}: ${missing.length} documented missing cases: ${missing.join(', ')}`
            );
          }

          // Only FAIL on undocumented deviations
          if (undocumentedExtra.length > 0) {
            console.error(
              `❌ sheets_${tool}: Undocumented extra cases: ${undocumentedExtra.join(', ')}`
            );
            console.error(`   Add to ACCEPTABLE_DEVIATIONS in handler-deviations.ts`);
          }
          if (undocumentedMissing.length > 0) {
            console.error(
              `❌ sheets_${tool}: Undocumented missing cases: ${undocumentedMissing.join(', ')}`
            );
            console.error(`   Add to ACCEPTABLE_DEVIATIONS in handler-deviations.ts`);
          }

          expect(
            undocumentedExtra,
            `Undocumented extra cases in handler (document in handler-deviations.ts): ${undocumentedExtra.join(', ')}`
          ).toEqual([]);
          expect(
            undocumentedMissing,
            `Undocumented missing cases in handler (document in handler-deviations.ts): ${undocumentedMissing.join(', ')}`
          ).toEqual([]);
        } else {
          // No documented deviations - expect perfect alignment
          if (extra.length > 0) {
            console.error(`❌ sheets_${tool}: Extra cases in handler: ${extra.join(', ')}`);
            console.error(`   Either remove from handler or add to ACCEPTABLE_DEVIATIONS`);
          }
          if (missing.length > 0) {
            console.error(`❌ sheets_${tool}: Missing cases in handler: ${missing.join(', ')}`);
            console.error(`   Either add to handler or add to ACCEPTABLE_DEVIATIONS`);
          }

          expect(extra, `Extra cases in handler (not documented): ${extra.join(', ')}`).toEqual([]);
          expect(
            missing,
            `Missing cases in handler (not documented): ${missing.join(', ')}`
          ).toEqual([]);
        }
      });
    });
  });

  describe('Sanity checks: Expected action counts', () => {
    it('should have correct action counts per tool', () => {
      const expectedCounts: Record<string, number> = {
        advanced: 31,
        agent: 8,
        analyze: 26,
        appsscript: 19,
        auth: 5,
        bigquery: 17,
        collaborate: 41,
        composite: 21,
        compute: 16,
        confirm: 5,
        connectors: 10,
        core: 21,
        data: 25,
        dependencies: 10,
        dimensions: 30,
        federation: 4,
        fix: 6,
        format: 25,
        history: 10,
        quality: 4,
        session: 31,
        templates: 8,
        transaction: 6,
        visualize: 18,
        webhook: 10,
      };

      Object.entries(expectedCounts).forEach(([tool, expectedCount]) => {
        const schemaPath = path.join(PROJECT_ROOT, `src/schemas/${tool}.ts`);
        const actions = extractSchemaActions(schemaPath);

        expect(actions.length, `Tool ${tool} should have ${expectedCount} actions`).toBe(
          expectedCount
        );
      });
    });
  });

  describe('Deviations validation', () => {
    it('should have valid deviation structure', () => {
      ACCEPTABLE_DEVIATIONS.forEach((deviation) => {
        expect(typeof deviation.tool).toBe('string');
        expect(deviation.tool.length).toBeGreaterThan(0);
        expect(typeof deviation.reason).toBe('string');
        expect(deviation.reason.length).toBeGreaterThan(0);
        expect(typeof deviation.justification).toBe('string');
        expect(deviation.justification.length).toBeGreaterThan(0);
        expect(deviation.addedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(
          (deviation.extraCases && deviation.extraCases.length > 0) ||
            (deviation.missingCases && deviation.missingCases.length > 0)
        ).toBe(true);
      });
    });

    it('should only document deviations for existing tools', () => {
      ACCEPTABLE_DEVIATIONS.forEach((deviation) => {
        expect(TOOLS).toContain(deviation.tool);
      });
    });

    it('should have justifications for all deviations', () => {
      ACCEPTABLE_DEVIATIONS.forEach((deviation) => {
        expect(deviation.justification.length).toBeGreaterThan(
          50,
          `Justification for ${deviation.tool} is too short`
        );
      });
    });
  });

  describe('Statistics: Deviation summary', () => {
    it('should show deviation statistics', () => {
      const totalTools = TOOLS.length;
      const toolsWithDeviations = ACCEPTABLE_DEVIATIONS.length;
      const perfectAlignment = totalTools - toolsWithDeviations;

      console.log('\n📊 Schema-Handler Alignment Statistics:');
      console.log(`  Total tools: ${totalTools}`);
      console.log(
        `  Perfect alignment: ${perfectAlignment} (${Math.round((perfectAlignment / totalTools) * 100)}%)`
      );
      console.log(`  With documented deviations: ${toolsWithDeviations}`);

      ACCEPTABLE_DEVIATIONS.forEach((deviation) => {
        const extraCount = deviation.extraCases?.length || 0;
        const missingCount = deviation.missingCases?.length || 0;
        console.log(`    - sheets_${deviation.tool}: ${extraCount} extra, ${missingCount} missing`);
        console.log(`      Reason: ${deviation.reason}`);
      });

      // Assert expectations
      expect(perfectAlignment).toBeGreaterThanOrEqual(24); // At least 24/25 perfect
      expect(toolsWithDeviations).toBeLessThanOrEqual(1); // At most 1 with deviations
    });
  });
});
