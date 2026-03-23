/**
 * Type Safety Agent Tests
 *
 * Tests detection of:
 * - Explicit any types
 * - Type assertions (as and <>)
 * - Non-null assertions (!)
 * - @ts-ignore comments
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { TypeSafetyAgent } from '../../scripts/analysis/agents/type-safety-agent.js';
import type { AnalysisContext } from '../../scripts/analysis/multi-agent-analysis.js';

function createSourceFile(code: string): ts.SourceFile {
  return ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true);
}

function createContext(): AnalysisContext {
  return {
    projectRoot: '/test',
    projectFiles: [],
    testFiles: [],
    dependencies: {},
  };
}

describe('TypeSafetyAgent', () => {
  const agent = new TypeSafetyAgent();

  describe('Explicit any detection', () => {
    it('should detect explicit any in parameter', async () => {
      const code = `
        function test(param: any) {
          return param;
        }
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const anyReport = reports.find((r) => r.dimension === 'anyTypes');

      expect(anyReport).toBeDefined();
      expect(anyReport!.issueCount).toBe(1);
      expect(anyReport!.issues[0].message).toContain('Explicit "any" type found');
      expect(anyReport!.issues[0].line).toBe(2);
      expect(anyReport!.issues[0].suggestion).toContain('unknown');
    });

    it('should detect explicit any in return type', async () => {
      const code = `
        function test(): any {
          return {};
        }
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const anyReport = reports.find((r) => r.dimension === 'anyTypes');

      expect(anyReport!.issueCount).toBe(1);
      expect(anyReport!.issues[0].suggestion).toContain('unknown');
    });

    it('should detect any[] array type', async () => {
      const code = `
        const items: any[] = [];
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const anyReport = reports.find((r) => r.dimension === 'anyTypes');

      expect(anyReport!.issueCount).toBe(1);
      expect(anyReport!.issues[0].message).toContain('Explicit "any" type found');
      expect(anyReport!.issues[0].suggestion).toContain('any[]');
    });

    it('should detect multiple any types', async () => {
      const code = `
        function test(a: any, b: any): any {
          const c: any = a + b;
          return c;
        }
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const anyReport = reports.find((r) => r.dimension === 'anyTypes');

      expect(anyReport!.issueCount).toBe(4);
      expect(anyReport!.metrics?.explicitAnyCount).toBe(4);
    });

    it('should pass when no any types found', async () => {
      const code = `
        function test(param: string): number {
          return param.length;
        }
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const anyReport = reports.find((r) => r.dimension === 'anyTypes');

      expect(anyReport!.status).toBe('pass');
      expect(anyReport!.issueCount).toBe(0);
    });
  });

  describe('Type assertion detection (as syntax)', () => {
    it('should detect "as" type assertion', async () => {
      const code = `
        const value = input as string;
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const assertionReport = reports.find((r) => r.dimension === 'typeAssertions');

      expect(assertionReport!.issueCount).toBe(1);
      expect(assertionReport!.issues[0].message).toContain('as');
      expect(assertionReport!.issues[0].message).toContain('string');
      expect(assertionReport!.issues[0].suggestion).toContain('type guard');
    });

    it('should detect multiple "as" assertions', async () => {
      const code = `
        const a = input as string;
        const b = data as number;
        const c = obj as MyInterface;
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const assertionReport = reports.find((r) => r.dimension === 'typeAssertions');

      expect(assertionReport!.issueCount).toBe(3);
      expect(assertionReport!.metrics?.asAssertions).toBe(3);
    });

    it('should suggest type guard for interface casts', async () => {
      const code = `
        const user = data as User;
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const assertionReport = reports.find((r) => r.dimension === 'typeAssertions');

      expect(assertionReport!.issues[0].suggestion).toContain('isUser');
      expect(assertionReport!.issues[0].suggestion).toContain('value is User');
    });

    it('should suggest typeof for primitive casts', async () => {
      const code = `
        const str = value as string;
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const assertionReport = reports.find((r) => r.dimension === 'typeAssertions');

      expect(assertionReport!.issues[0].suggestion).toContain('typeof');
    });
  });

  describe('Type assertion detection (angle bracket syntax)', () => {
    it('should detect <Type> angle bracket assertion', async () => {
      const code = `
        const value = <string>input;
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const assertionReport = reports.find((r) => r.dimension === 'typeAssertions');

      expect(assertionReport!.issueCount).toBe(1);
      expect(assertionReport!.issues[0].suggestion).toContain('Prefer "as" syntax');
      expect(assertionReport!.metrics?.angleBracketAssertions).toBe(1);
    });

    it('should count both as and angle bracket assertions', async () => {
      const code = `
        const a = input as string;
        const b = <number>data;
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const assertionReport = reports.find((r) => r.dimension === 'typeAssertions');

      expect(assertionReport!.issueCount).toBe(2);
      expect(assertionReport!.metrics?.asAssertions).toBe(1);
      expect(assertionReport!.metrics?.angleBracketAssertions).toBe(1);
    });
  });

  describe('Non-null assertion detection', () => {
    it('should detect non-null assertion on property access', async () => {
      const code = `
        const value = obj!.property;
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const nonNullReport = reports.find((r) => r.dimension === 'nonNullAssertions');

      expect(nonNullReport!.issueCount).toBe(1);
      expect(nonNullReport!.issues[0].message).toContain('Non-null assertion');
      expect(nonNullReport!.issues[0].suggestion).toContain('optional chaining');
      expect(nonNullReport!.issues[0].suggestion).toContain('?.');
    });

    it('should detect non-null assertion on array access', async () => {
      const code = `
        const item = array![0];
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const nonNullReport = reports.find((r) => r.dimension === 'nonNullAssertions');

      expect(nonNullReport!.issueCount).toBe(1);
      expect(nonNullReport!.issues[0].suggestion).toContain('null check');
    });

    it('should detect multiple non-null assertions', async () => {
      const code = `
        const a = obj!.prop;
        const b = array![0];
        const c = func()!;
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const nonNullReport = reports.find((r) => r.dimension === 'nonNullAssertions');

      expect(nonNullReport!.issueCount).toBe(3);
      expect(nonNullReport!.metrics?.nonNullAssertionCount).toBe(3);
    });

    it('should suggest appropriate alternatives', async () => {
      const code = `
        const value = getValue()!;
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const nonNullReport = reports.find((r) => r.dimension === 'nonNullAssertions');

      expect(nonNullReport!.issues[0].suggestion).toContain('Ensure return type');
    });

    it('should warn status when few assertions, fail when many', async () => {
      const code = `
        const a = obj!.prop;
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const nonNullReport = reports.find((r) => r.dimension === 'nonNullAssertions');

      expect(nonNullReport!.status).toBe('warning');

      // Test many assertions
      const manyCode = Array(25)
        .fill(0)
        .map((_, i) => `const x${i} = obj!.prop;`)
        .join('\n');
      const manySourceFile = createSourceFile(manyCode);
      const manyReports = await agent.analyze('test.ts', manySourceFile, context);
      const manyNonNullReport = manyReports.find((r) => r.dimension === 'nonNullAssertions');

      expect(manyNonNullReport!.status).toBe('fail');
    });
  });

  describe('@ts-ignore comment detection', () => {
    it('should detect @ts-ignore without reason', async () => {
      const code = `
        // @ts-ignore
        const value = unsafeOperation();
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const tsIgnoreReport = reports.find((r) => r.dimension === 'tsIgnoreComments');

      expect(tsIgnoreReport!.issueCount).toBe(1);
      expect(tsIgnoreReport!.issues[0].message).toContain('without explanation');
      expect(tsIgnoreReport!.issues[0].severity).toBe('high');
      expect(tsIgnoreReport!.issues[0].suggestion).toContain('@ts-expect-error');
    });

    it('should detect @ts-ignore with reason', async () => {
      const code = `
        // @ts-ignore Legacy API compatibility
        const value = unsafeOperation();
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const tsIgnoreReport = reports.find((r) => r.dimension === 'tsIgnoreComments');

      expect(tsIgnoreReport!.issueCount).toBe(1);
      expect(tsIgnoreReport!.issues[0].message).toContain('Legacy API compatibility');
      expect(tsIgnoreReport!.issues[0].severity).toBe('medium');
      expect(tsIgnoreReport!.issues[0].suggestion).toContain('Fix underlying type issue');
    });

    it('should detect multiple @ts-ignore comments', async () => {
      const code = `
        // @ts-ignore
        const a = 1;

        // @ts-ignore Reason here
        const b = 2;

        // @ts-ignore
        const c = 3;
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const tsIgnoreReport = reports.find((r) => r.dimension === 'tsIgnoreComments');

      expect(tsIgnoreReport!.issueCount).toBe(3);
      expect(tsIgnoreReport!.metrics?.tsIgnoreCount).toBe(3);
      expect(tsIgnoreReport!.metrics?.withReason).toBe(1);
      expect(tsIgnoreReport!.metrics?.withoutReason).toBe(2);
    });

    it('should pass when no @ts-ignore comments', async () => {
      const code = `
        const value: string = 'test';
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const tsIgnoreReport = reports.find((r) => r.dimension === 'tsIgnoreComments');

      expect(tsIgnoreReport!.status).toBe('pass');
      expect(tsIgnoreReport!.issueCount).toBe(0);
    });

    it('should fail status when many @ts-ignore comments', async () => {
      const code = Array(10)
        .fill(0)
        .map((_, i) => `// @ts-ignore\nconst x${i} = 1;`)
        .join('\n');
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);
      const tsIgnoreReport = reports.find((r) => r.dimension === 'tsIgnoreComments');

      expect(tsIgnoreReport!.status).toBe('fail');
    });
  });

  describe('Integration - multiple unsafe patterns', () => {
    it('should detect all unsafe type patterns in one file', async () => {
      const code = `
        // @ts-ignore
        function process(data: any): any {
          const user = data as User;
          const result = user.name!;
          return result;
        }

        const value = <string>input;
        const items: any[] = [];
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);

      // Should have reports for all 4 dimensions
      expect(reports).toHaveLength(4);

      const anyReport = reports.find((r) => r.dimension === 'anyTypes');
      expect(anyReport!.issueCount).toBeGreaterThan(0);

      const assertionReport = reports.find((r) => r.dimension === 'typeAssertions');
      expect(assertionReport!.issueCount).toBe(2); // as and <>

      const nonNullReport = reports.find((r) => r.dimension === 'nonNullAssertions');
      expect(nonNullReport!.issueCount).toBe(1);

      const tsIgnoreReport = reports.find((r) => r.dimension === 'tsIgnoreComments');
      expect(tsIgnoreReport!.issueCount).toBe(1);
    });

    it('should pass all dimensions for type-safe code', async () => {
      const code = `
        interface User {
          name: string;
          age: number;
        }

        function isUser(value: unknown): value is User {
          return (
            typeof value === 'object' &&
            value !== null &&
            'name' in value &&
            typeof (value as User).name === 'string'
          );
        }

        function process(data: unknown): string | null {
          if (isUser(data)) {
            return data.name;
          }
          return null;
        }
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);

      const anyReport = reports.find((r) => r.dimension === 'anyTypes');
      expect(anyReport!.status).toBe('pass');

      const tsIgnoreReport = reports.find((r) => r.dimension === 'tsIgnoreComments');
      expect(tsIgnoreReport!.status).toBe('pass');

      const nonNullReport = reports.find((r) => r.dimension === 'nonNullAssertions');
      expect(nonNullReport!.status).toBe('pass');
    });
  });

  describe('Suggestion quality', () => {
    it('should provide actionable suggestions for each pattern', async () => {
      const code = `
        function test(param: any) {
          const user = param as User;
          return user.name!;
        }
        // @ts-ignore
        const value = x;
      `;
      const sourceFile = createSourceFile(code);
      const context = createContext();

      const reports = await agent.analyze('test.ts', sourceFile, context);

      for (const report of reports) {
        for (const issue of report.issues) {
          expect(issue.suggestion).toBeDefined();
          expect(issue.suggestion!.length).toBeGreaterThan(10);
          expect(issue.estimatedEffort).toBeDefined();
          expect(issue.references).toBeDefined();
          expect(issue.references!.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Performance', () => {
    it('should analyze file in reasonable time', async () => {
      const code = Array(100)
        .fill(0)
        .map(
          (_, i) => `
        function test${i}(param: any): any {
          const value = param as string;
          return value!;
        }
      `
        )
        .join('\n');

      const sourceFile = createSourceFile(code);
      const context = createContext();

      const startTime = Date.now();
      const reports = await agent.analyze('test.ts', sourceFile, context);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100); // Should complete in < 100ms

      // Verify all patterns detected
      const anyReport = reports.find((r) => r.dimension === 'anyTypes');
      expect(anyReport!.issueCount).toBe(200); // 2 any per function
    });
  });
});
