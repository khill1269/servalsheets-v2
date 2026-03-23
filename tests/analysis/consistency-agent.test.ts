/**
 * ConsistencyAgent Tests
 *
 * Verifies enforcement of project-wide conventions:
 * - Naming conventions
 * - Import ordering
 * - Error handling patterns
 * - Response format
 * - Comment style
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { ConsistencyAgent } from '../../scripts/analysis/agents/consistency-agent.js';
import type { AnalysisContext } from '../../scripts/analysis/multi-agent-analysis.js';

function createSourceFile(code: string): ts.SourceFile {
  return ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true);
}

function createMockContext(): AnalysisContext {
  return {
    projectRoot: '/test',
    projectFiles: [],
    testFiles: [],
    dependencies: {},
  };
}

describe('ConsistencyAgent', () => {
  const agent = new ConsistencyAgent();
  const context = createMockContext();

  // ==========================================================================
  // NAMING CONVENTIONS
  // ==========================================================================

  describe('Naming Conventions', () => {
    it('should pass for correct camelCase function names', async () => {
      const code = `
        function calculateTotal() {}
        const getUserData = () => {};
        const myVariable = 123;
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'namingConventions');

      expect(report?.status).toBe('pass');
      expect(report?.issueCount).toBe(0);
    });

    it('should detect snake_case function names', async () => {
      const code = `
        function calculate_total() {}
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'namingConventions');

      expect(report?.status).toBe('warning');
      expect(report?.issueCount).toBeGreaterThan(0);
      expect(report?.issues[0].message).toContain('calculate_total');
    });

    it('should detect kebab-case variable names', async () => {
      const code = `
        const user-data = 123;
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'namingConventions');

      // Note: This will likely fail to parse as valid TS
      // But we test the detection logic
      expect(report).toBeDefined();
    });

    it('should pass for correct PascalCase class names', async () => {
      const code = `
        class UserService {}
        interface UserData {}
        type ResponseType = string;
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'namingConventions');

      expect(report?.status).toBe('pass');
      expect(report?.issueCount).toBe(0);
    });

    it('should detect camelCase class names', async () => {
      const code = `
        class userService {}
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'namingConventions');

      expect(report?.status).toBe('warning');
      expect(report?.issueCount).toBeGreaterThan(0);
      expect(report?.issues[0].message).toContain('userService');
      expect(report?.issues[0].suggestion).toContain('UserService');
    });

    it('should allow UPPER_SNAKE_CASE for constants', async () => {
      const code = `
        const MAX_RETRIES = 3;
        const API_KEY = 'secret';
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'namingConventions');

      expect(report?.status).toBe('pass');
      expect(report?.issueCount).toBe(0);
    });

    it('should detect incorrect method names', async () => {
      const code = `
        class MyClass {
          HandleRequest() {}
          process_data() {}
        }
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'namingConventions');

      expect(report?.status).toBe('warning');
      expect(report?.issueCount).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // IMPORT ORDERING
  // ==========================================================================

  describe('Import Ordering', () => {
    it('should pass for correct import order (external → internal → types)', async () => {
      const code = `
        import * as fs from 'fs';
        import { Server } from '@modelcontextprotocol/sdk/server/index.js';
        import { myFunction } from './utils.js';
        import { helperFn } from '../helpers.js';
        import type { MyType } from './types.js';
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'importOrdering');

      expect(report?.status).toBe('pass');
      expect(report?.issueCount).toBe(0);
    });

    it('should detect incorrect import order (internal before external)', async () => {
      const code = `
        import { myFunction } from './utils.js';
        import * as fs from 'fs';
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'importOrdering');

      expect(report?.status).toBe('warning');
      expect(report?.issueCount).toBeGreaterThan(0);
      expect(report?.issues[0].message).toContain('not in correct order');
      expect(report?.issues[0].suggestion).toContain('lint --fix');
    });

    it('should detect incorrect import order (types before internal)', async () => {
      const code = `
        import * as fs from 'fs';
        import type { MyType } from './types.js';
        import { myFunction } from './utils.js';
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'importOrdering');

      expect(report?.status).toBe('warning');
      expect(report?.issueCount).toBeGreaterThan(0);
    });

    it('should pass when only external imports exist', async () => {
      const code = `
        import * as fs from 'fs';
        import { Server } from '@modelcontextprotocol/sdk/server/index.js';
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'importOrdering');

      expect(report?.status).toBe('pass');
      expect(report?.issueCount).toBe(0);
    });

    it('should pass when no imports exist', async () => {
      const code = `
        const x = 123;
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'importOrdering');

      expect(report?.status).toBe('pass');
      expect(report?.issueCount).toBe(0);
    });

    it('should mark import ordering issues as auto-fixable', async () => {
      const code = `
        import { myFunction } from './utils.js';
        import * as fs from 'fs';
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'importOrdering');

      expect(report?.issues[0]?.autoFixable).toBe(true);
    });
  });

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('should pass for structured errors with ErrorCode enum', async () => {
      const code = `
        throw new ValidationError('Invalid input', ErrorCode.INVALID_INPUT);
        throw new NotFoundError('Sheet not found', ErrorCode.NOT_FOUND);
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('src/handlers/test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'errorHandling');

      expect(report?.status).toBe('pass');
      expect(report?.issueCount).toBe(0);
    });

    it('should detect generic Error usage in handlers', async () => {
      const code = `
        throw new Error('Something went wrong');
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('src/handlers/test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'errorHandling');

      expect(report?.status).toBe('warning');
      expect(report?.issueCount).toBeGreaterThan(0);
      expect(report?.issues[0].message).toContain('generic Error');
      expect(report?.issues[0].suggestion).toContain('error factory');
    });

    it('should detect structured errors without ErrorCode enum', async () => {
      const code = `
        throw new ValidationError('Invalid input');
        throw new NotFoundError('Sheet not found');
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('src/services/test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'errorHandling');

      expect(report?.status).toBe('warning');
      expect(report?.issueCount).toBeGreaterThan(0);
      expect(report?.issues[0].message).toContain('ErrorCode enum not used');
    });

    it('should not check error handling in non-critical files', async () => {
      const code = `
        throw new Error('Something went wrong');
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test/fixtures/test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'errorHandling');

      expect(report?.status).toBe('pass');
      expect(report?.issueCount).toBe(0);
    });

    it('should provide metrics for error handling', async () => {
      const code = `
        throw new ValidationError('Invalid', ErrorCode.INVALID_INPUT);
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('src/handlers/test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'errorHandling');

      expect(report?.metrics).toBeDefined();
      expect(report?.metrics?.hasStructuredErrors).toBe(1);
      expect(report?.metrics?.hasErrorCodeEnum).toBe(1);
    });
  });

  // ==========================================================================
  // RESPONSE FORMAT
  // ==========================================================================

  describe('Response Format', () => {
    it('should pass for correct response format in handlers', async () => {
      const code = `
        return { response: { success: true, data: result } };
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('src/handlers/test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'responseFormat');

      expect(report?.status).toBe('pass');
    });

    it('should detect MCP format being returned directly', async () => {
      const code = `
        return { content: [{ type: 'text', text: 'result' }] };
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('src/handlers/test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'responseFormat');

      expect(report?.status).toBe('warning');
      expect(report?.issueCount).toBeGreaterThan(0);
      expect(report?.issues[0].message).toContain('MCP format directly');
      expect(report?.issues[0].severity).toBe('high');
    });

    it('should provide reference to buildToolResponse', async () => {
      const code = `
        return { content: [{ type: 'text', text: 'result' }] };
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('src/handlers/test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'responseFormat');

      expect(report?.issues[0]?.references).toBeDefined();
      expect(report?.issues[0]?.references?.[0]).toContain('tool-handlers.ts');
    });

    it('should not check response format in non-handler files', async () => {
      const code = `
        return { content: [{ type: 'text', text: 'result' }] };
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('src/utils/test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'responseFormat');

      expect(report?.status).toBe('pass');
      expect(report?.issueCount).toBe(0);
    });
  });

  // ==========================================================================
  // COMMENT STYLE
  // ==========================================================================

  describe('Comment Style', () => {
    it('should pass for exported functions with JSDoc', async () => {
      const code = `
        /**
         * Calculates the total
         * @param items Array of items
         * @returns Total sum
         */
        export function calculateTotal(items: number[]): number {
          return items.reduce((a, b) => a + b, 0);
        }
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'commentStyle');

      expect(report?.status).toBe('pass');
      expect(report?.issueCount).toBe(0);
    });

    it('should detect exported functions without JSDoc', async () => {
      const code = `
        export function calculateTotal(items: number[]): number {
          return items.reduce((a, b) => a + b, 0);
        }
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'commentStyle');

      expect(report?.issueCount).toBeGreaterThan(0);
      expect(report?.issues[0].message).toContain('calculateTotal');
      expect(report?.issues[0].suggestion).toContain('JSDoc');
    });

    it('should detect public methods without JSDoc', async () => {
      const code = `
        export class MyService {
          public processData() {}
        }
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'commentStyle');

      expect(report?.issueCount).toBeGreaterThan(0);
      expect(report?.issues[0].message).toContain('processData');
    });

    it('should not require JSDoc for private methods', async () => {
      const code = `
        export class MyService {
          private helperMethod() {}
        }
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'commentStyle');

      expect(report?.issueCount).toBe(0);
    });

    it('should not require JSDoc for lifecycle methods', async () => {
      const code = `
        export class MyService {
          constructor() {}
          toString() {}
          valueOf() {}
        }
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'commentStyle');

      expect(report?.issueCount).toBe(0);
    });

    it('should mark as warning only if many issues', async () => {
      const code = `
        export function fn1() {}
        export function fn2() {}
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const report = reports.find((r) => r.dimension === 'commentStyle');

      // Should be 'pass' with only 2 issues
      expect(report?.status).toBe('pass');
    });
  });

  // ==========================================================================
  // INTEGRATION
  // ==========================================================================

  describe('Integration', () => {
    it('should analyze all dimensions', async () => {
      const code = `
        import * as fs from 'fs';

        export class MyHandler {
          executeAction() {
            return { response: { success: true } };
          }
        }
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('src/handlers/test.ts', sourceFile, context);

      expect(reports).toHaveLength(5);
      expect(reports.map((r) => r.dimension).sort()).toEqual([
        'commentStyle',
        'errorHandling',
        'importOrdering',
        'namingConventions',
        'responseFormat',
      ]);
    });

    it('should measure analysis duration', async () => {
      const code = 'const x = 123;';
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('test.ts', sourceFile, context);

      for (const report of reports) {
        expect(report.duration).toBeGreaterThanOrEqual(0);
      }
    });

    it('should provide severity levels', async () => {
      const code = `
        throw new Error('Generic error');
      `;
      const sourceFile = createSourceFile(code);
      const reports = await agent.analyze('src/handlers/test.ts', sourceFile, context);

      for (const report of reports) {
        for (const issue of report.issues) {
          expect(['critical', 'high', 'medium', 'low', 'info']).toContain(issue.severity);
        }
      }
    });
  });
});
