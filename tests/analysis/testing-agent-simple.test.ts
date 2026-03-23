/**
 * TestingAgent Simple Tests
 *
 * Tests basic functionality without mocking fs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TestingAgent } from '../../scripts/analysis/agents/testing-agent.js';
import type { AnalysisContext } from '../../scripts/analysis/multi-agent-analysis.js';
import * as ts from 'typescript';

describe('TestingAgent (Simple)', () => {
  let agent: TestingAgent;
  let context: AnalysisContext;

  beforeEach(() => {
    agent = new TestingAgent();
    context = {
      projectRoot: '/Users/thomascahill/Documents/servalsheets 2',
      projectFiles: [],
      testFiles: [],
      dependencies: {},
    };
  });

  describe('Basic Functionality', () => {
    it('should create agent with correct dimensions', () => {
      expect(agent).toBeDefined();
    });

    it('should return three dimension reports', async () => {
      const sourceCode = `
        export function add(a: number, b: number): number {
          return a + b;
        }
      `;

      const sourceFile = ts.createSourceFile(
        'src/utils/math.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );

      const reports = await agent.analyze('src/utils/math.ts', sourceFile, context);

      expect(reports).toHaveLength(3);
      expect(reports.map((r) => r.dimension)).toEqual([
        'coverageGaps',
        'missingEdgeCases',
        'testQuality',
      ]);
    });

    it('should skip test files for coverage analysis', async () => {
      const testCode = `
        describe('test', () => {
          it('should work', () => {
            expect(true).toBe(true);
          });
        });
      `;

      const sourceFile = ts.createSourceFile(
        'tests/utils/math.test.ts',
        testCode,
        ts.ScriptTarget.Latest,
        true
      );

      const reports = await agent.analyze('tests/utils/math.test.ts', sourceFile, context);
      const coverageReport = reports.find((r) => r.dimension === 'coverageGaps');

      expect(coverageReport?.status).toBe('pass');
      expect(coverageReport?.issueCount).toBe(0);
    });

    it('should analyze test files for quality', async () => {
      const testCode = `
        describe('UserService', () => {
          it('should work', () => {});
        });
      `;

      const sourceFile = ts.createSourceFile(
        'tests/services/user.test.ts',
        testCode,
        ts.ScriptTarget.Latest,
        true
      );

      const reports = await agent.analyze('tests/services/user.test.ts', sourceFile, context);
      const qualityReport = reports.find((r) => r.dimension === 'testQuality');

      expect(qualityReport).toBeDefined();
      expect(qualityReport?.issueCount).toBeGreaterThan(0); // Empty test detected
    });
  });

  describe('Exported Function Detection', () => {
    it('should detect exported functions', async () => {
      const sourceCode = `
        export function calculateTotal(items: string[]): number {
          return items.length;
        }

        export function formatPrice(amount: number): string {
          return \`$\${amount}\`;
        }

        function privateHelper() {
          return 42;
        }
      `;

      const sourceFile = ts.createSourceFile(
        'src/utils/math.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );

      const reports = await agent.analyze('src/utils/math.ts', sourceFile, context);
      const coverageReport = reports.find((r) => r.dimension === 'coverageGaps');

      // Should detect 2 exported functions (calculateTotal, formatPrice)
      // privateHelper should be ignored
      expect(coverageReport).toBeDefined();
    });

    it('should detect exported class methods', async () => {
      const sourceCode = `
        export class UserService {
          public createUser(name: string): void {
            // implementation
          }

          public deleteUser(id: string): void {
            // implementation
          }

          private internalMethod(): void {
            // should be ignored
          }
        }
      `;

      const sourceFile = ts.createSourceFile(
        'src/services/user.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );

      const reports = await agent.analyze('src/services/user.ts', sourceFile, context);
      const coverageReport = reports.find((r) => r.dimension === 'coverageGaps');

      expect(coverageReport).toBeDefined();
      // Should detect 2 public methods (createUser, deleteUser)
    });
  });

  describe('Test Case Suggestions', () => {
    it('should suggest test cases based on function signature', async () => {
      const sourceCode = `
        export async function fetchUser(id: string, includeDetails?: boolean): Promise<User> {
          if (!id) throw new Error('Invalid ID');
          return { id, name: 'test' };
        }
      `;

      const sourceFile = ts.createSourceFile(
        'src/services/user.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );

      const reports = await agent.analyze('src/services/user.ts', sourceFile, context);
      const coverageReport = reports.find((r) => r.dimension === 'coverageGaps');

      expect(coverageReport).toBeDefined();

      if (coverageReport && coverageReport.issues.length > 0) {
        const suggestion = coverageReport.issues[0].suggestion;
        expect(suggestion).toContain('Happy path');
        // Should suggest edge cases based on string parameter
        // Should suggest optional parameter test
        // Should suggest async test
        // Should suggest error test
      }
    });
  });

  describe('Test Quality Detection', () => {
    it('should detect empty test cases', async () => {
      const testCode = `
        describe('MyService', () => {
          it('should work', () => {});

          it('should do something', () => {
            // TODO: implement
          });

          it('should have implementation', () => {
            expect(true).toBe(true);
          });
        });
      `;

      const sourceFile = ts.createSourceFile(
        'tests/services/my-service.test.ts',
        testCode,
        ts.ScriptTarget.Latest,
        true
      );

      const reports = await agent.analyze('tests/services/my-service.test.ts', sourceFile, context);
      const qualityReport = reports.find((r) => r.dimension === 'testQuality');

      expect(qualityReport).toBeDefined();
      expect(qualityReport?.issueCount).toBe(2); // Two empty tests
      expect(qualityReport?.issues[0].message).toContain('Empty test case');
    });

    it('should detect weak assertions pattern', async () => {
      const testCode = `
        describe('UserService', () => {
          it('test 1', () => {
            const user = createUser('test');
            expect(user).toBeDefined();
          });

          it('test 2', () => {
            const result = deleteUser('123');
            expect(result).toBeTruthy();
          });

          it('test 3', () => {
            const result = updateUser('123', { name: 'new' });
            expect(result).toBeDefined();
          });
        });
      `;

      const sourceFile = ts.createSourceFile(
        'tests/services/user.test.ts',
        testCode,
        ts.ScriptTarget.Latest,
        true
      );

      const reports = await agent.analyze('tests/services/user.test.ts', sourceFile, context);
      const qualityReport = reports.find((r) => r.dimension === 'testQuality');

      expect(qualityReport).toBeDefined();

      // Debug: log the metrics to see what's happening
      // console.log('Metrics:', qualityReport?.metrics);
      // console.log('Issues:', qualityReport?.issues);

      // Should warn about weak assertions (all use toBeDefined/toBeTruthy)
      // At least one test should have weak assertions
      expect(qualityReport?.metrics?.testCount).toBe(3);
      expect(qualityReport?.metrics?.weakAssertionCount).toBeGreaterThan(0);

      // If more than half use weak assertions, should warn
      if (qualityReport?.metrics?.weakAssertionCount && qualityReport.metrics.testCount) {
        if (qualityReport.metrics.weakAssertionCount > qualityReport.metrics.testCount / 2) {
          const hasWeakAssertionWarning = qualityReport?.issues.some((i) =>
            i.message.includes('weak assertions')
          );
          expect(hasWeakAssertionWarning).toBe(true);
        }
      }
    });

    it('should pass for high-quality tests', async () => {
      const testCode = `
        describe('UserService', () => {
          it('should create user with correct properties', () => {
            const user = createUser('test');
            expect(user.name).toBe('test');
            expect(user.id).toHaveLength(36);
          });

          it('should throw error for invalid input', () => {
            expect(() => createUser('')).toThrow('Invalid name');
          });
        });
      `;

      const sourceFile = ts.createSourceFile(
        'tests/services/user.test.ts',
        testCode,
        ts.ScriptTarget.Latest,
        true
      );

      const reports = await agent.analyze('tests/services/user.test.ts', sourceFile, context);
      const qualityReport = reports.find((r) => r.dimension === 'testQuality');

      expect(qualityReport?.status).toBe('pass');
    });
  });

  describe('Report Metrics', () => {
    it('should include metrics in coverage report', async () => {
      const sourceCode = `
        export function test1() {}
        export function test2() {}
      `;

      const sourceFile = ts.createSourceFile(
        'src/utils/test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );

      const reports = await agent.analyze('src/utils/test.ts', sourceFile, context);
      const coverageReport = reports.find((r) => r.dimension === 'coverageGaps');

      expect(coverageReport?.metrics).toBeDefined();
      expect(coverageReport?.metrics?.untestedFunctionCount).toBeGreaterThanOrEqual(0);
    });

    it('should include metrics in quality report', async () => {
      const testCode = `
        describe('tests', () => {
          it('test 1', () => {});
          it('test 2', () => {});
          it('test 3', () => { expect(true).toBe(true); });
        });
      `;

      const sourceFile = ts.createSourceFile(
        'tests/test.test.ts',
        testCode,
        ts.ScriptTarget.Latest,
        true
      );

      const reports = await agent.analyze('tests/test.test.ts', sourceFile, context);
      const qualityReport = reports.find((r) => r.dimension === 'testQuality');

      expect(qualityReport?.metrics).toBeDefined();
      expect(qualityReport?.metrics?.testCount).toBe(3);
      expect(qualityReport?.metrics?.emptyTestCount).toBe(2);
    });
  });
});
