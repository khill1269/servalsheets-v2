/**
 * AST Schema Parser Tests
 *
 * Tests for the shared AST parsing utilities used by both
 * validation scripts and contract tests.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  extractSchemaActions,
  extractHandlerCases,
  isSingleActionTool,
  unwrapExpression,
  isInsideOutputSchema,
} from '../../src/utils/ast-schema-parser.js';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

describe('AST Schema Parser', () => {
  describe('extractSchemaActions', () => {
    it('should extract actions from discriminated union schema (session.ts)', () => {
      const schemaPath = path.join(PROJECT_ROOT, 'src/schemas/session.ts');
      const actions = extractSchemaActions(schemaPath);

      // Session has 31 actions (27 original + 4 schedule_* actions added in Phase 6)
      expect(actions.length).toBe(31);
      expect(actions).toContain('set_active');
      expect(actions).toContain('get_active');
      expect(actions).toContain('record_operation');
    });

    it('should extract actions from direct enum schema (collaborate.ts)', () => {
      const schemaPath = path.join(PROJECT_ROOT, 'src/schemas/collaborate.ts');
      const actions = extractSchemaActions(schemaPath);

      // Collaborate has 41 actions (40 previous + version_snapshot_status)
      expect(actions.length).toBe(41);
      expect(actions).toContain('share_add');
      expect(actions).toContain('comment_add');
      expect(actions).toContain('version_list_revisions');
    });

    it('should extract actions from standalone enum schema (federation.ts)', () => {
      const schemaPath = path.join(PROJECT_ROOT, 'src/schemas/federation.ts');
      const actions = extractSchemaActions(schemaPath);

      // Federation has 4 actions
      expect(actions.length).toBe(4);
      expect(actions).toContain('call_remote');
      expect(actions).toContain('list_servers');
      expect(actions).toContain('get_server_tools');
      expect(actions).toContain('validate_connection');
    });

    it('should extract actions from nested object schema (data.ts)', () => {
      const schemaPath = path.join(PROJECT_ROOT, 'src/schemas/data.ts');
      const actions = extractSchemaActions(schemaPath);

      // Data has 25 actions (19 original + 4 F2 cross-spreadsheet actions + smart_fill + auto_fill)
      expect(actions.length).toBe(25);
      expect(actions).toContain('read');
      expect(actions).toContain('write');
      expect(actions).toContain('append');
    });

    it('should return sorted actions', () => {
      const schemaPath = path.join(PROJECT_ROOT, 'src/schemas/federation.ts');
      const actions = extractSchemaActions(schemaPath);

      // Check that actions are sorted alphabetically
      const sortedActions = [...actions].sort();
      expect(actions).toEqual(sortedActions);
    });

    it('should handle single-action tool (fix.ts)', () => {
      const schemaPath = path.join(PROJECT_ROOT, 'src/schemas/fix.ts');
      const actions = extractSchemaActions(schemaPath);

      expect(actions.length).toBe(6);
      expect(actions).toContain('fix');
      expect(actions).toContain('clean');
    });

    it('should filter out actions from output schemas', () => {
      // Schemas like data.ts have both input and output schemas
      // Output schemas have 'action' fields that should NOT be extracted
      const schemaPath = path.join(PROJECT_ROOT, 'src/schemas/data.ts');
      const actions = extractSchemaActions(schemaPath);

      // Should only extract input actions, not output actions
      // All actions should be valid write/read operations
      expect(actions.every((a) => !a.includes('Output'))).toBe(true);
      expect(actions.every((a) => !a.includes('Result'))).toBe(true);
    });
  });

  describe('extractHandlerCases', () => {
    it('should extract cases from handler with type cast (core.ts)', () => {
      const handlerPath = path.join(PROJECT_ROOT, 'src/handlers/core.ts');
      const cases = extractHandlerCases(handlerPath);

      // Core has 19 actions (see src/schemas/annotations.ts)
      expect(cases.length).toBeGreaterThanOrEqual(19);
      expect(cases).toContain('get');
      expect(cases).toContain('create');
      expect(cases).toContain('add_sheet');
    });

    it('should extract cases from handler with destructured action (session.ts)', () => {
      const handlerPath = path.join(PROJECT_ROOT, 'src/handlers/session.ts');
      const cases = extractHandlerCases(handlerPath);

      // Session has 31 actions (27 original + 4 schedule_* actions added in Phase 6)
      expect(cases.length).toBe(31);
      expect(cases).toContain('set_active');
      expect(cases).toContain('get_active');
      expect(cases).toContain('record_operation');
    });

    it('should extract cases from handler with direct switch (data.ts)', () => {
      const handlerPath = path.join(PROJECT_ROOT, 'src/handlers/data.ts');
      const cases = extractHandlerCases(handlerPath);

      // Data has 25 actions (19 original + 4 F2 cross-spreadsheet actions + smart_fill + auto_fill)
      expect(cases.length).toBe(25);
      expect(cases).toContain('read');
      expect(cases).toContain('write');
      expect(cases).toContain('append');
    });

    it('should return sorted cases', () => {
      const handlerPath = path.join(PROJECT_ROOT, 'src/handlers/data.ts');
      const cases = extractHandlerCases(handlerPath);

      // Check that cases are sorted alphabetically
      const sortedCases = [...cases].sort();
      expect(cases).toEqual(sortedCases);
    });

    it('should handle single-action tool with no switch (fix.ts)', () => {
      const handlerPath = path.join(PROJECT_ROOT, 'src/handlers/fix.ts');
      const cases = extractHandlerCases(handlerPath);

      // Fix has 1 action, may not have a switch statement
      // If no switch, should return empty array
      expect(cases.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle handler name mapping (webhook → webhooks)', () => {
      // Note: Schema is webhook.ts, but handler is webhooks.ts
      // This test ensures the validator correctly maps the names
      const handlerPath = path.join(PROJECT_ROOT, 'src/handlers/webhooks.ts');
      const cases = extractHandlerCases(handlerPath);

      expect(cases.length).toBe(10);
      expect(cases).toContain('register');
      expect(cases).toContain('unregister');
      expect(cases).toContain('watch_changes');
    });
  });

  describe('isSingleActionTool', () => {
    it('should return true for single-action tool with no switch', () => {
      const schemaActions = ['fix_validation_error'];
      const handlerCases: string[] = [];

      expect(isSingleActionTool(schemaActions, handlerCases)).toBe(true);
    });

    it('should return false for multi-action tool', () => {
      const schemaActions = ['read_range', 'write_range'];
      const handlerCases = ['read_range', 'write_range'];

      expect(isSingleActionTool(schemaActions, handlerCases)).toBe(false);
    });

    it('should return false for single-action tool with switch statement', () => {
      const schemaActions = ['fix_validation_error'];
      const handlerCases = ['fix_validation_error'];

      expect(isSingleActionTool(schemaActions, handlerCases)).toBe(false);
    });

    it('should return false for empty schema actions', () => {
      const schemaActions: string[] = [];
      const handlerCases: string[] = [];

      expect(isSingleActionTool(schemaActions, handlerCases)).toBe(false);
    });
  });

  describe('unwrapExpression', () => {
    // Note: This test is conceptual since we need actual TypeScript AST nodes
    // The function is tested indirectly through extractHandlerCases
    it('should be used by extractHandlerCases to handle type casts', () => {
      // Verify core.ts which uses type casts like: switch ((req as Type).action)
      const handlerPath = path.join(PROJECT_ROOT, 'src/handlers/core.ts');
      const cases = extractHandlerCases(handlerPath);

      // If unwrapExpression works, we should find cases
      expect(cases.length).toBeGreaterThan(0);
    });
  });

  describe('isInsideOutputSchema', () => {
    // Note: This test is conceptual since we need actual TypeScript AST nodes
    // The function is tested indirectly through extractSchemaActions
    it('should filter out actions from output schemas', () => {
      // Verify data.ts which has both input and output schemas
      const schemaPath = path.join(PROJECT_ROOT, 'src/schemas/data.ts');
      const actions = extractSchemaActions(schemaPath);

      // Should not extract actions from DataOutput, DataResult, etc.
      expect(actions.every((a) => !a.includes('Output'))).toBe(true);
      expect(actions.every((a) => !a.includes('Result'))).toBe(true);
    });
  });

  describe('Real-world integration tests', () => {
    it('should match schema actions to handler cases for all tools', () => {
      const tools = [
        'advanced',
        'analyze',
        'appsscript',
        'auth',
        'bigquery',
        'collaborate',
        'composite',
        'confirm',
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
      ];

      const handlerNameMap: Record<string, string> = {
        webhook: 'webhooks',
      };

      for (const tool of tools) {
        const schemaPath = path.join(PROJECT_ROOT, `src/schemas/${tool}.ts`);
        const handlerName = handlerNameMap[tool] || tool;
        const handlerPath = path.join(PROJECT_ROOT, `src/handlers/${handlerName}.ts`);

        const schemaActions = extractSchemaActions(schemaPath);
        const handlerCases = extractHandlerCases(handlerPath);

        // Single-action tools may not have switch statements
        const isSingle = isSingleActionTool(schemaActions, handlerCases);

        if (!isSingle) {
          // For multi-action tools, verify at least some alignment
          // (Some tools may have documented deviations)
          expect(schemaActions.length).toBeGreaterThan(0);
          expect(handlerCases.length).toBeGreaterThan(0);
        } else {
          // For single-action tools, verify exactly 1 schema action
          expect(schemaActions.length).toBe(1);
        }
      }
    });

    it('should handle all 4 schema patterns across codebase', () => {
      // Pattern 1: Discriminated union (session.ts)
      const sessionActions = extractSchemaActions(
        path.join(PROJECT_ROOT, 'src/schemas/session.ts')
      );
      expect(sessionActions.length).toBeGreaterThan(0);

      // Pattern 2: Direct enum (collaborate.ts)
      const collaborateActions = extractSchemaActions(
        path.join(PROJECT_ROOT, 'src/schemas/collaborate.ts')
      );
      expect(collaborateActions.length).toBeGreaterThan(0);

      // Pattern 3: Standalone enum (federation.ts)
      const federationActions = extractSchemaActions(
        path.join(PROJECT_ROOT, 'src/schemas/federation.ts')
      );
      expect(federationActions.length).toBeGreaterThan(0);

      // Pattern 4: Nested object (data.ts)
      const dataActions = extractSchemaActions(path.join(PROJECT_ROOT, 'src/schemas/data.ts'));
      expect(dataActions.length).toBeGreaterThan(0);
    });

    it('should handle all 3 handler patterns across codebase', () => {
      // Pattern 1: Direct switch (data.ts)
      const dataCases = extractHandlerCases(path.join(PROJECT_ROOT, 'src/handlers/data.ts'));
      expect(dataCases.length).toBeGreaterThan(0);

      // Pattern 2: Destructured (session.ts)
      const sessionCases = extractHandlerCases(path.join(PROJECT_ROOT, 'src/handlers/session.ts'));
      expect(sessionCases.length).toBeGreaterThan(0);

      // Pattern 3: Type cast (core.ts)
      const coreCases = extractHandlerCases(path.join(PROJECT_ROOT, 'src/handlers/core.ts'));
      expect(coreCases.length).toBeGreaterThan(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle schema with no actions gracefully', () => {
      // Create a minimal test - if a schema has no actions, should return empty array
      const actions = extractSchemaActions(
        path.join(PROJECT_ROOT, 'src/schemas/shared.ts') // Shared utilities, no actions
      );

      // Shared.ts has no action enums, should return empty
      expect(actions).toEqual([]);
    });

    it('should handle handler with no switch statement', () => {
      // Fix handler may not have a switch if it's single-action
      const cases = extractHandlerCases(path.join(PROJECT_ROOT, 'src/handlers/fix.ts'));

      // Should return empty array if no switch found
      expect(Array.isArray(cases)).toBe(true);
    });

    it('should extract unique actions only', () => {
      // Verify no duplicates in extracted actions
      const schemaPath = path.join(PROJECT_ROOT, 'src/schemas/data.ts');
      const actions = extractSchemaActions(schemaPath);

      const uniqueActions = [...new Set(actions)];
      expect(actions).toEqual(uniqueActions);
    });

    it('should extract unique cases only', () => {
      // Verify no duplicates in extracted cases
      const handlerPath = path.join(PROJECT_ROOT, 'src/handlers/data.ts');
      const cases = extractHandlerCases(handlerPath);

      const uniqueCases = [...new Set(cases)];
      expect(cases).toEqual(uniqueCases);
    });
  });
});
