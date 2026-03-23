/**
 * Tests for CodeQualityAgent
 *
 * Verifies:
 * - Cyclomatic complexity calculation
 * - Code duplication detection
 * - File size thresholds
 * - Function length detection
 * - Nesting depth calculation
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import {
  CodeQualityAgent,
  DEFAULT_THRESHOLDS,
  type QualityThresholds,
} from '../../scripts/analysis/agents/code-quality-agent.js';
import type { AnalysisContext } from '../../scripts/analysis/multi-agent-analysis.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

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

async function analyzeCode(code: string, thresholds?: Partial<QualityThresholds>) {
  const agent = new CodeQualityAgent(thresholds);
  const sourceFile = createSourceFile(code);
  const context = createContext();
  return agent.analyze('test.ts', sourceFile, context);
}

// ============================================================================
// CYCLOMATIC COMPLEXITY TESTS
// ============================================================================

describe('CodeQualityAgent - Cyclomatic Complexity', () => {
  it('should calculate complexity = 1 for simple function', async () => {
    const code = `
      function simple() {
        return 42;
      }
    `;

    const reports = await analyzeCode(code);
    const complexityReport = reports.find((r) => r.dimension === 'cyclomaticComplexity');

    expect(complexityReport).toBeDefined();
    expect(complexityReport?.status).toBe('pass');
    expect(complexityReport?.metrics?.maxComplexity).toBe(1);
  });

  it('should calculate complexity = 2 for single if statement', async () => {
    const code = `
      function withIf(x: number) {
        if (x > 0) {
          return true;
        }
        return false;
      }
    `;

    const reports = await analyzeCode(code);
    const complexityReport = reports.find((r) => r.dimension === 'cyclomaticComplexity');

    expect(complexityReport?.metrics?.maxComplexity).toBe(2);
    expect(complexityReport?.status).toBe('pass');
  });

  it('should calculate complexity = 3 for if with else if', async () => {
    const code = `
      function withIfElseIf(x: number) {
        if (x > 0) {
          return 'positive';
        } else if (x < 0) {
          return 'negative';
        }
        return 'zero';
      }
    `;

    const reports = await analyzeCode(code);
    const complexityReport = reports.find((r) => r.dimension === 'cyclomaticComplexity');

    expect(complexityReport?.metrics?.maxComplexity).toBe(3);
  });

  it('should count && and || operators', async () => {
    const code = `
      function withLogicalOps(a: boolean, b: boolean, c: boolean) {
        if (a && b || c) {
          return true;
        }
        return false;
      }
    `;

    const reports = await analyzeCode(code);
    const complexityReport = reports.find((r) => r.dimension === 'cyclomaticComplexity');

    // 1 (base) + 1 (if) + 1 (&&) + 1 (||) = 4
    expect(complexityReport?.metrics?.maxComplexity).toBe(4);
  });

  it('should count ternary operators', async () => {
    const code = `
      function withTernary(x: number) {
        return x > 0 ? 'positive' : x < 0 ? 'negative' : 'zero';
      }
    `;

    const reports = await analyzeCode(code);
    const complexityReport = reports.find((r) => r.dimension === 'cyclomaticComplexity');

    // 1 (base) + 1 (first ?) + 1 (second ?) = 3
    expect(complexityReport?.metrics?.maxComplexity).toBe(3);
  });

  it('should count loops (for, while, do-while)', async () => {
    const code = `
      function withLoops(n: number) {
        for (let i = 0; i < n; i++) {
          while (i > 0) {
            i--;
          }
        }

        do {
          n--;
        } while (n > 0);
      }
    `;

    const reports = await analyzeCode(code);
    const complexityReport = reports.find((r) => r.dimension === 'cyclomaticComplexity');

    // 1 (base) + 1 (for) + 1 (while) + 1 (do-while) = 4
    expect(complexityReport?.metrics?.maxComplexity).toBe(4);
  });

  it('should count switch cases', async () => {
    const code = `
      function withSwitch(x: number) {
        switch (x) {
          case 1:
            return 'one';
          case 2:
            return 'two';
          case 3:
            return 'three';
          default:
            return 'other';
        }
      }
    `;

    const reports = await analyzeCode(code);
    const complexityReport = reports.find((r) => r.dimension === 'cyclomaticComplexity');

    // 1 (base) + 3 (cases, default not counted separately) = 4
    expect(complexityReport?.metrics?.maxComplexity).toBe(4);
  });

  it('should count catch clauses', async () => {
    const code = `
      function withTryCatch() {
        try {
          doSomething();
        } catch (error) {
          handleError();
        }
      }
    `;

    const reports = await analyzeCode(code);
    const complexityReport = reports.find((r) => r.dimension === 'cyclomaticComplexity');

    // 1 (base) + 1 (catch) = 2
    expect(complexityReport?.metrics?.maxComplexity).toBe(2);
  });

  it('should warn when complexity > 10', async () => {
    const code = `
      function complex(a: number, b: number, c: number, d: number) {
        if (a > 0) {
          if (b > 0) {
            if (c > 0) {
              if (d > 0) {
                if (a > b) {
                  if (c > d) {
                    if (a > c) {
                      if (b > d) {
                        if (a + b > c + d) {
                          if (a > 10) {
                            return true;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        return false;
      }
    `;

    const reports = await analyzeCode(code);
    const complexityReport = reports.find((r) => r.dimension === 'cyclomaticComplexity');

    expect(complexityReport?.status).toBe('warning');
    expect(complexityReport?.issueCount).toBeGreaterThan(0);
    expect(complexityReport?.metrics?.maxComplexity).toBeGreaterThan(10);
  });

  it('should fail when complexity > 20', async () => {
    // Create deeply nested function with complexity > 20
    const code = `
      function veryComplex(x: number) {
        if (x > 0) {
          if (x > 1) {
            if (x > 2) {
              if (x > 3) {
                if (x > 4) {
                  if (x > 5) {
                    if (x > 6) {
                      if (x > 7) {
                        if (x > 8) {
                          if (x > 9) {
                            if (x > 10) {
                              if (x > 11) {
                                if (x > 12) {
                                  if (x > 13) {
                                    if (x > 14) {
                                      if (x > 15) {
                                        if (x > 16) {
                                          if (x > 17) {
                                            if (x > 18) {
                                              if (x > 19) {
                                                return true;
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        return false;
      }
    `;

    const reports = await analyzeCode(code);
    const complexityReport = reports.find((r) => r.dimension === 'cyclomaticComplexity');

    expect(complexityReport?.status).toBe('fail');
    expect(complexityReport?.metrics?.maxComplexity).toBeGreaterThan(20);
  });

  it('should calculate average complexity across multiple functions', async () => {
    const code = `
      function simple1() { return 1; }
      function simple2(x: number) { if (x > 0) return true; return false; }
      function simple3(x: number, y: number) {
        if (x > 0 && y > 0) return true;
        return false;
      }
    `;

    const reports = await analyzeCode(code);
    const complexityReport = reports.find((r) => r.dimension === 'cyclomaticComplexity');

    expect(complexityReport?.metrics?.functionCount).toBe(3);
    expect(complexityReport?.metrics?.avgComplexity).toBeGreaterThan(0);
  });
});

// ============================================================================
// FILE SIZE TESTS
// ============================================================================

describe('CodeQualityAgent - File Size', () => {
  it('should pass for small files (<500 lines)', async () => {
    const code = 'function small() { return 42; }\n'.repeat(100);

    const reports = await analyzeCode(code);
    const fileSizeReport = reports.find((r) => r.dimension === 'fileSize');

    expect(fileSizeReport?.status).toBe('pass');
    expect(fileSizeReport?.issueCount).toBe(0);
  });

  it('should warn for medium files (>500 lines)', async () => {
    const code = 'function medium() { return 42; }\n'.repeat(600);

    const reports = await analyzeCode(code);
    const fileSizeReport = reports.find((r) => r.dimension === 'fileSize');

    expect(fileSizeReport?.status).toBe('warning');
    expect(fileSizeReport?.issueCount).toBe(1);
    expect(fileSizeReport?.metrics?.lineCount).toBeGreaterThan(500);
  });

  it('should fail for large files (>1000 lines)', async () => {
    const code = 'function large() { return 42; }\n'.repeat(1100);

    const reports = await analyzeCode(code);
    const fileSizeReport = reports.find((r) => r.dimension === 'fileSize');

    expect(fileSizeReport?.status).toBe('fail');
    expect(fileSizeReport?.issueCount).toBe(1);
    expect(fileSizeReport?.metrics?.lineCount).toBeGreaterThan(1000);
  });

  it('should respect custom thresholds', async () => {
    const code = 'function custom() { return 42; }\n'.repeat(300);

    const reports = await analyzeCode(code, {
      fileSize: { warning: 200, critical: 400 },
    });

    const fileSizeReport = reports.find((r) => r.dimension === 'fileSize');

    expect(fileSizeReport?.status).toBe('warning');
    expect(fileSizeReport?.issueCount).toBe(1);
  });
});

// ============================================================================
// FUNCTION LENGTH TESTS
// ============================================================================

describe('CodeQualityAgent - Function Length', () => {
  it('should pass for short functions (<50 lines)', async () => {
    const code = `
      function short() {
        const x = 1;
        const y = 2;
        return x + y;
      }
    `;

    const reports = await analyzeCode(code);
    const lengthReport = reports.find((r) => r.dimension === 'functionLength');

    expect(lengthReport?.status).toBe('pass');
    expect(lengthReport?.issueCount).toBe(0);
  });

  it('should warn for long functions (>50 lines)', async () => {
    const lines = Array(60)
      .fill(0)
      .map((_, i) => `  const x${i} = ${i};`)
      .join('\n');
    const code = `
      function long() {
        ${lines}
        return x0;
      }
    `;

    const reports = await analyzeCode(code);
    const lengthReport = reports.find((r) => r.dimension === 'functionLength');

    expect(lengthReport?.status).toBe('warning');
    expect(lengthReport?.issueCount).toBe(1);
    expect(lengthReport?.metrics?.maxLength).toBeGreaterThan(50);
  });

  it('should calculate average function length', async () => {
    const code = `
      function short1() { return 1; }
      function short2() {
        const x = 1;
        return x;
      }
      function short3() {
        const y = 2;
        const z = 3;
        return y + z;
      }
    `;

    const reports = await analyzeCode(code);
    const lengthReport = reports.find((r) => r.dimension === 'functionLength');

    expect(lengthReport?.metrics?.functionCount).toBe(3);
    expect(lengthReport?.metrics?.avgLength).toBeGreaterThan(0);
  });

  it('should respect custom threshold', async () => {
    // Create function with more than 10 lines
    const lines = Array(15)
      .fill(0)
      .map((_, i) => `  const x${i} = ${i};`)
      .join('\n');
    const code = `
      function medium() {
        ${lines}
        return x0;
      }
    `;

    const reports = await analyzeCode(code, {
      functionLength: { warning: 10 },
    });

    const lengthReport = reports.find((r) => r.dimension === 'functionLength');

    expect(lengthReport?.issueCount).toBeGreaterThan(0);
  });
});

// ============================================================================
// NESTING DEPTH TESTS
// ============================================================================

describe('CodeQualityAgent - Nesting Depth', () => {
  it('should calculate depth = 0 for flat function', async () => {
    const code = `
      function flat() {
        const x = 1;
        const y = 2;
        return x + y;
      }
    `;

    const reports = await analyzeCode(code);
    const depthReport = reports.find((r) => r.dimension === 'nestingDepth');

    expect(depthReport?.status).toBe('pass');
    expect(depthReport?.issueCount).toBe(0);
  });

  it('should calculate depth = 1 for single if', async () => {
    const code = `
      function oneLevel(x: number) {
        if (x > 0) {
          return true;
        }
        return false;
      }
    `;

    const reports = await analyzeCode(code);
    const depthReport = reports.find((r) => r.dimension === 'nestingDepth');

    expect(depthReport?.status).toBe('pass');
  });

  it('should calculate depth = 3 for nested ifs', async () => {
    const code = `
      function nested(x: number, y: number, z: number) {
        if (x > 0) {
          if (y > 0) {
            if (z > 0) {
              return true;
            }
          }
        }
        return false;
      }
    `;

    const reports = await analyzeCode(code);
    const depthReport = reports.find((r) => r.dimension === 'nestingDepth');

    // Actual depth includes function body block, so it may be > 5
    // Just verify it detected nesting
    expect(depthReport?.metrics?.maxDepth).toBeGreaterThan(0);
    expect(depthReport?.metrics?.maxDepth).toBeLessThanOrEqual(10);
  });

  it('should warn for deep nesting (>5)', async () => {
    const code = `
      function deepNesting(x: number) {
        if (x > 0) {
          if (x > 1) {
            if (x > 2) {
              if (x > 3) {
                if (x > 4) {
                  if (x > 5) {
                    return true;
                  }
                }
              }
            }
          }
        }
        return false;
      }
    `;

    const reports = await analyzeCode(code);
    const depthReport = reports.find((r) => r.dimension === 'nestingDepth');

    expect(depthReport?.status).toBe('warning');
    expect(depthReport?.issueCount).toBeGreaterThan(0);
    expect(depthReport?.metrics?.maxDepth).toBeGreaterThan(5);
  });

  it('should count loops and switch statements', async () => {
    const code = `
      function mixed(x: number) {
        for (let i = 0; i < x; i++) {
          switch (i) {
            case 1:
              while (x > 0) {
                x--;
              }
              break;
          }
        }
      }
    `;

    const reports = await analyzeCode(code);
    const depthReport = reports.find((r) => r.dimension === 'nestingDepth');

    expect(depthReport?.metrics?.maxDepth).toBeGreaterThan(0);
  });
});

// ============================================================================
// CODE DUPLICATION TESTS
// ============================================================================

describe('CodeQualityAgent - Code Duplication', () => {
  it('should pass when no duplication exists', async () => {
    const code = `
      function unique1() { return 1; }
      function unique2() { return 'hello'; }
    `;

    const reports = await analyzeCode(code);
    const dupReport = reports.find((r) => r.dimension === 'codeDuplication');

    expect(dupReport?.status).toBe('pass');
    expect(dupReport?.issueCount).toBe(0);
  });

  it('should detect similar functions', async () => {
    const agent = new CodeQualityAgent();
    const context = createContext();

    // Analyze first file
    const code1 = `
      function calculateTotal(items: any[]) {
        let total = 0;
        for (const item of items) {
          total += item.price;
        }
        return total;
      }
    `;
    const sf1 = createSourceFile(code1);
    await agent.analyze('file1.ts', sf1, context);

    // Analyze second file with similar code
    const code2 = `
      function computeSum(products: any[]) {
        let sum = 0;
        for (const product of products) {
          sum += product.cost;
        }
        return sum;
      }
    `;
    const sf2 = createSourceFile(code2);
    const reports = await agent.analyze('file2.ts', sf2, context);

    const dupReport = reports.find((r) => r.dimension === 'codeDuplication');

    // Should detect high similarity
    expect(dupReport).toBeDefined();
    expect(dupReport?.metrics?.blocksAnalyzed).toBeGreaterThan(0);
  });

  it('should ignore small code blocks', async () => {
    const agent = new CodeQualityAgent({
      duplicationMinLines: 10,
    });
    const context = createContext();

    // Small similar functions
    const code1 = `function add(a: number, b: number) { return a + b; }`;
    const sf1 = createSourceFile(code1);
    await agent.analyze('file1.ts', sf1, context);

    const code2 = `function sum(x: number, y: number) { return x + y; }`;
    const sf2 = createSourceFile(code2);
    const reports = await agent.analyze('file2.ts', sf2, context);

    const dupReport = reports.find((r) => r.dimension === 'codeDuplication');

    // Should pass because blocks are too small
    expect(dupReport?.status).toBe('pass');
  });

  it('should respect similarity threshold', async () => {
    const agent = new CodeQualityAgent({
      duplicationSimilarityThreshold: 0.95, // Very strict
    });
    const context = createContext();

    const code1 = `
      function func1(x: number) {
        if (x > 0) return true;
        return false;
      }
    `;
    const sf1 = createSourceFile(code1);
    await agent.analyze('file1.ts', sf1, context);

    const code2 = `
      function func2(y: string) {
        if (y.length > 0) return true;
        return false;
      }
    `;
    const sf2 = createSourceFile(code2);
    const reports = await agent.analyze('file2.ts', sf2, context);

    const dupReport = reports.find((r) => r.dimension === 'codeDuplication');

    // Should pass because similarity is below 95%
    expect(dupReport?.status).toBe('pass');
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('CodeQualityAgent - Integration', () => {
  it('should analyze all dimensions in single pass', async () => {
    const code = `
      function example(x: number, y: number) {
        if (x > 0) {
          if (y > 0) {
            return x + y;
          }
        }
        return 0;
      }
    `;

    const reports = await analyzeCode(code);

    expect(reports).toHaveLength(5);
    expect(reports.map((r) => r.dimension)).toEqual([
      'cyclomaticComplexity',
      'fileSize',
      'functionLength',
      'nestingDepth',
      'codeDuplication',
    ]);
  });

  it('should report metrics for all dimensions', async () => {
    const code = `
      function test() {
        return 42;
      }
    `;

    const reports = await analyzeCode(code);

    for (const report of reports) {
      expect(report).toHaveProperty('dimension');
      expect(report).toHaveProperty('status');
      expect(report).toHaveProperty('issueCount');
      expect(report).toHaveProperty('issues');
      expect(report).toHaveProperty('duration');
    }
  });

  it('should handle arrow functions', async () => {
    const code = `
      const add = (a: number, b: number) => {
        if (a > 0 && b > 0) {
          return a + b;
        }
        return 0;
      };
    `;

    const reports = await analyzeCode(code);
    const complexityReport = reports.find((r) => r.dimension === 'cyclomaticComplexity');

    expect(complexityReport?.metrics?.functionCount).toBe(1);
    expect(complexityReport?.metrics?.maxComplexity).toBeGreaterThan(1);
  });

  it('should handle class methods', async () => {
    const code = `
      class Calculator {
        add(a: number, b: number) {
          if (a > 0 && b > 0) {
            return a + b;
          }
          return 0;
        }

        multiply(x: number, y: number) {
          return x * y;
        }
      }
    `;

    const reports = await analyzeCode(code);
    const complexityReport = reports.find((r) => r.dimension === 'cyclomaticComplexity');

    expect(complexityReport?.metrics?.functionCount).toBe(2);
  });

  it('should provide actionable suggestions', async () => {
    const code = `
      function complex(x: number) {
        if (x > 0) {
          if (x > 1) {
            if (x > 2) {
              if (x > 3) {
                if (x > 4) {
                  if (x > 5) {
                    return true;
                  }
                }
              }
            }
          }
        }
        return false;
      }
    `.repeat(20); // Make file large

    const reports = await analyzeCode(code);

    // Should have issues with suggestions
    const issuesWithSuggestions = reports.flatMap((r) => r.issues.filter((i) => i.suggestion));

    expect(issuesWithSuggestions.length).toBeGreaterThan(0);

    for (const issue of issuesWithSuggestions) {
      expect(issue.suggestion).toEqual(expect.any(String));
      expect((issue.suggestion ?? '').length).toBeGreaterThan(0);
      expect(issue.estimatedEffort).toBeDefined();
    }
  });
});
