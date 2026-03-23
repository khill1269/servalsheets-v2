/**
 * Testing Analysis Agent
 *
 * Identifies coverage gaps and missing test cases:
 * - Functions without tests
 * - Missing edge cases
 * - Untested functions
 * - Test quality
 * - Assertion coverage
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import {
  AnalysisAgent,
  AnalysisIssue,
  DimensionReport,
  AnalysisContext,
} from '../multi-agent-analysis.js';

interface UntestedFunction {
  name: string;
  reason: string;
  suggestedTests: string[];
  estimatedEffort: string;
  line?: number;
}

interface EdgeCase {
  category: string;
  description: string;
  example: string;
}

interface FunctionInfo {
  name: string;
  line: number;
  parameters: ParameterInfo[];
  returnsPromise: boolean;
  throwsErrors: boolean;
}

interface ParameterInfo {
  name: string;
  type: string;
  optional: boolean;
}

export class TestingAgent extends AnalysisAgent {
  constructor() {
    super('TestingAgent', [
      'coverageGaps',
      'missingEdgeCases',
      'untestedFunctions',
      'testQuality',
      'assertionCoverage',
    ]);
  }

  async analyze(
    filePath: string,
    sourceFile: ts.SourceFile,
    context: AnalysisContext
  ): Promise<DimensionReport[]> {
    const reports: DimensionReport[] = [];

    reports.push(await this.analyzeCoverageGaps(filePath, sourceFile, context));
    reports.push(await this.analyzeMissingEdgeCases(filePath, sourceFile, context));
    reports.push(await this.analyzeTestQuality(filePath, sourceFile, context));

    return reports;
  }

  private async analyzeCoverageGaps(
    filePath: string,
    sourceFile: ts.SourceFile,
    context: AnalysisContext
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];

    // Skip test files themselves
    if (filePath.includes('/tests/') || filePath.includes('.test.ts')) {
      return {
        dimension: 'coverageGaps',
        status: 'pass',
        issueCount: 0,
        issues: [],
        duration: Date.now() - startTime,
      };
    }

    // Find untested functions
    const untestedFunctions = await this.findUntestedFunctions(filePath, sourceFile, context);

    for (const fn of untestedFunctions) {
      issues.push(
        this.createIssue('coverageGaps', filePath, fn.reason, {
          severity: 'medium',
          line: fn.line,
          suggestion: `Add test cases:\n${fn.suggestedTests.map((t) => `  - ${t}`).join('\n')}`,
          estimatedEffort: fn.estimatedEffort,
          autoFixable: false,
        })
      );
    }

    return {
      dimension: 'coverageGaps',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: issues.length,
      issues,
      metrics: {
        untestedFunctionCount: untestedFunctions.length,
      },
      duration: Date.now() - startTime,
    };
  }

  private async analyzeMissingEdgeCases(
    filePath: string,
    sourceFile: ts.SourceFile,
    context: AnalysisContext
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];

    // Skip test files themselves
    if (filePath.includes('/tests/') || filePath.includes('.test.ts')) {
      return {
        dimension: 'missingEdgeCases',
        status: 'pass',
        issueCount: 0,
        issues: [],
        duration: Date.now() - startTime,
      };
    }

    // Find functions with missing edge cases
    const functions = this.getExportedFunctions(sourceFile);
    const testFilePath = this.getTestFilePath(filePath, context);

    if (!testFilePath) {
      return {
        dimension: 'missingEdgeCases',
        status: 'warning',
        issueCount: 0,
        issues: [],
        duration: Date.now() - startTime,
      };
    }

    // Analyze test file for edge case coverage
    const testContent = fs.readFileSync(testFilePath, 'utf-8');
    const testSourceFile = ts.createSourceFile(
      testFilePath,
      testContent,
      ts.ScriptTarget.Latest,
      true
    );

    const edgeCases = this.findMissingEdgeCases(sourceFile, testSourceFile, functions);

    for (const { fn, missingCases } of edgeCases) {
      if (missingCases.length > 0) {
        issues.push(
          this.createIssue(
            'missingEdgeCases',
            filePath,
            `Function "${fn.name}" missing edge case tests: ${missingCases.map((c) => c.category).join(', ')}`,
            {
              severity: 'medium',
              line: fn.line,
              suggestion: `Add edge case tests:\n${missingCases.map((c) => `  - ${c.description}: ${c.example}`).join('\n')}`,
              estimatedEffort: '30min-1h',
              autoFixable: false,
            }
          )
        );
      }
    }

    return {
      dimension: 'missingEdgeCases',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: issues.length,
      issues,
      duration: Date.now() - startTime,
    };
  }

  private async analyzeTestQuality(
    filePath: string,
    sourceFile: ts.SourceFile,
    context: AnalysisContext
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];

    // Only analyze test files
    if (!filePath.includes('/tests/') && !filePath.includes('.test.ts')) {
      return {
        dimension: 'testQuality',
        status: 'pass',
        issueCount: 0,
        issues: [],
        duration: Date.now() - startTime,
      };
    }

    // Check for test quality issues
    let testCount = 0;
    let emptyTestCount = 0;
    let weakAssertionCount = 0;

    const visit = (node: ts.Node) => {
      // Find it() or test() calls
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === 'it' || node.expression.text === 'test')
      ) {
        testCount++;

        // Check if test has assertions
        const testBody = node.arguments[1];
        if (testBody) {
          const bodyText = testBody.getText(sourceFile);

          // Empty test (check for empty body or TODO comments)
          // Don't count as empty if it has expect() calls
          const hasExpect = bodyText.includes('expect(');
          const hasTODO = bodyText.includes('//') && bodyText.includes('TODO');
          const isEmptyBody = bodyText.trim() === '{}' || bodyText.replace(/\s+/g, '') === '()=>{}';

          const isEmpty = (isEmptyBody || hasTODO) && !hasExpect;

          if (isEmpty) {
            emptyTestCount++;
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            issues.push(
              this.createIssue('testQuality', filePath, 'Empty test case found', {
                severity: 'medium',
                line,
                suggestion: 'Implement test assertions or remove test',
                estimatedEffort: '15-30min',
                autoFixable: false,
              })
            );
          }

          // Weak assertions (only toBeDefined, toBeTruthy)
          const hasWeakAssertion =
            bodyText.includes('toBeDefined') || bodyText.includes('toBeTruthy');

          const hasStrongAssertion =
            bodyText.includes('toEqual') ||
            bodyText.includes('toBe(') || // Use toBe( to avoid matching toBeDefined
            bodyText.includes('toContain') ||
            bodyText.includes('toThrow') ||
            bodyText.includes('toHaveLength');

          if (hasWeakAssertion && !hasStrongAssertion) {
            weakAssertionCount++;
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    // Weak assertion pattern warning
    if (weakAssertionCount > testCount / 2) {
      issues.push(
        this.createIssue(
          'testQuality',
          filePath,
          `${weakAssertionCount}/${testCount} tests use weak assertions (toBeDefined/toBeTruthy only)`,
          {
            severity: 'low',
            suggestion:
              'Use specific assertions (toEqual, toBe, toContain) for stronger test coverage',
            estimatedEffort: '1-2h',
            autoFixable: false,
          }
        )
      );
    }

    return {
      dimension: 'testQuality',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: issues.length,
      issues,
      metrics: {
        testCount,
        emptyTestCount,
        weakAssertionCount,
      },
      duration: Date.now() - startTime,
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private async findUntestedFunctions(
    filePath: string,
    sourceFile: ts.SourceFile,
    context: AnalysisContext
  ): Promise<UntestedFunction[]> {
    const untestedFunctions: UntestedFunction[] = [];

    // Get all exported functions
    const exportedFunctions = this.getExportedFunctions(sourceFile);

    if (exportedFunctions.length === 0) {
      return [];
    }

    // Find corresponding test file
    const testFilePath = this.getTestFilePath(filePath, context);

    if (!testFilePath) {
      return exportedFunctions.map((fn) => ({
        name: fn.name,
        reason: `No test file found for "${fn.name}"`,
        suggestedTests: this.suggestTestCases(fn),
        estimatedEffort: '1-2 hours',
        line: fn.line,
      }));
    }

    // Parse test file
    const testContent = fs.readFileSync(testFilePath, 'utf-8');
    const testSourceFile = ts.createSourceFile(
      testFilePath,
      testContent,
      ts.ScriptTarget.Latest,
      true
    );

    // Find which functions are tested
    const testedFunctions = this.getTestedFunctions(testSourceFile);

    // Find gap
    for (const fn of exportedFunctions) {
      if (!testedFunctions.includes(fn.name)) {
        untestedFunctions.push({
          name: fn.name,
          reason: `Function "${fn.name}" has no test cases`,
          suggestedTests: this.suggestTestCases(fn),
          estimatedEffort: '30min-1h',
          line: fn.line,
        });
      }
    }

    return untestedFunctions;
  }

  private getExportedFunctions(sourceFile: ts.SourceFile): FunctionInfo[] {
    const functions: FunctionInfo[] = [];

    const visit = (node: ts.Node) => {
      // Exported function declarations
      if (ts.isFunctionDeclaration(node) && node.name) {
        const hasExport = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

        if (hasExport) {
          functions.push(this.extractFunctionInfo(node, node.name.text, sourceFile));
        }
      }

      // Exported class methods
      if (ts.isClassDeclaration(node)) {
        const hasExport = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

        if (hasExport) {
          node.members.forEach((member) => {
            if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
              const isPublic = !member.modifiers?.some(
                (m) => m.kind === ts.SyntaxKind.PrivateKeyword
              );

              if (isPublic) {
                functions.push(this.extractFunctionInfo(member, member.name.text, sourceFile));
              }
            }
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return functions;
  }

  private extractFunctionInfo(
    node: ts.FunctionDeclaration | ts.MethodDeclaration,
    name: string,
    sourceFile: ts.SourceFile
  ): FunctionInfo {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

    const parameters: ParameterInfo[] = node.parameters.map((param) => ({
      name: ts.isIdentifier(param.name) ? param.name.text : 'unknown',
      type: param.type ? param.type.getText(sourceFile) : 'any',
      optional: !!param.questionToken,
    }));

    const returnsPromise = node.type?.getText(sourceFile).includes('Promise') || false;

    // Check if function throws errors
    let throwsErrors = false;
    const visit = (n: ts.Node) => {
      if (ts.isThrowStatement(n)) {
        throwsErrors = true;
      }
      ts.forEachChild(n, visit);
    };
    if (node.body) {
      visit(node.body);
    }

    return {
      name,
      line,
      parameters,
      returnsPromise,
      throwsErrors,
    };
  }

  private getTestFilePath(filePath: string, context: AnalysisContext): string | null {
    // Map source file to test file
    // src/handlers/core.ts → tests/handlers/core.test.ts
    // src/utils/retry.ts → tests/utils/retry.test.ts

    const relativePath = path.relative(context.projectRoot, filePath);

    // Try multiple test file patterns
    const patterns = [
      // Standard pattern: src/handlers/core.ts → tests/handlers/core.test.ts
      relativePath.replace(/^src\//, 'tests/').replace(/\.ts$/, '.test.ts'),
      // Same directory pattern: src/handlers/core.ts → src/handlers/core.test.ts
      relativePath.replace(/\.ts$/, '.test.ts'),
      // Spec pattern: src/handlers/core.ts → tests/handlers/core.spec.ts
      relativePath.replace(/^src\//, 'tests/').replace(/\.ts$/, '.spec.ts'),
    ];

    for (const pattern of patterns) {
      const testPath = path.join(context.projectRoot, pattern);
      if (fs.existsSync(testPath)) {
        return testPath;
      }
    }

    return null;
  }

  private getTestedFunctions(testSourceFile: ts.SourceFile): string[] {
    const testedFunctions: string[] = [];

    const visit = (node: ts.Node) => {
      // Find describe() or it() blocks
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === 'describe' ||
          node.expression.text === 'it' ||
          node.expression.text === 'test')
      ) {
        const firstArg = node.arguments[0];
        if (firstArg && ts.isStringLiteral(firstArg)) {
          const text = firstArg.text;

          // Extract function names from test descriptions
          // "should call handleReadRange" → handleReadRange
          // "executeAction with read_range" → executeAction
          const functionMatch = text.match(/\b([a-z][a-zA-Z0-9_]+)\b/g);
          if (functionMatch) {
            testedFunctions.push(...functionMatch);
          }
        }
      }

      // Also check for direct function calls in test bodies
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        testedFunctions.push(node.expression.text);
      }

      ts.forEachChild(node, visit);
    };

    visit(testSourceFile);

    // Deduplicate
    return [...new Set(testedFunctions)];
  }

  private suggestTestCases(fn: FunctionInfo): string[] {
    const suggestions: string[] = [];

    // Happy path
    suggestions.push('Happy path: valid input returns expected output');

    // Parameter-based edge cases
    for (const param of fn.parameters) {
      if (param.type.includes('string')) {
        suggestions.push(`Edge case: empty string for "${param.name}"`);
      }
      if (param.type.includes('number')) {
        suggestions.push(`Edge case: zero/negative for "${param.name}"`);
      }
      if (param.type.includes('[]') || param.type.includes('Array')) {
        suggestions.push(`Edge case: empty array for "${param.name}"`);
      }
      if (param.optional) {
        suggestions.push(`Edge case: undefined for optional "${param.name}"`);
      }
      if (!param.type.includes('undefined') && !param.optional) {
        suggestions.push(`Edge case: null/undefined for required "${param.name}"`);
      }
    }

    // Error cases
    if (fn.throwsErrors) {
      suggestions.push('Error case: verify error throwing behavior');
    }

    // Async cases
    if (fn.returnsPromise) {
      suggestions.push('Async case: verify promise resolution/rejection');
    }

    return suggestions.slice(0, 5); // Limit to 5 suggestions
  }

  private findMissingEdgeCases(
    sourceFile: ts.SourceFile,
    testSourceFile: ts.SourceFile,
    functions: FunctionInfo[]
  ): Array<{ fn: FunctionInfo; missingCases: EdgeCase[] }> {
    const results: Array<{ fn: FunctionInfo; missingCases: EdgeCase[] }> = [];
    const testContent = testSourceFile.getText();

    for (const fn of functions) {
      const missingCases: EdgeCase[] = [];

      // Check for common edge cases in test file
      const edgeCases = this.getExpectedEdgeCases(fn);

      for (const edgeCase of edgeCases) {
        // Check if test file mentions this edge case
        const hasCoverage =
          testContent.includes(edgeCase.example) ||
          testContent.includes(edgeCase.description) ||
          testContent.toLowerCase().includes(edgeCase.category.toLowerCase());

        if (!hasCoverage) {
          missingCases.push(edgeCase);
        }
      }

      if (missingCases.length > 0) {
        results.push({ fn, missingCases });
      }
    }

    return results;
  }

  private getExpectedEdgeCases(fn: FunctionInfo): EdgeCase[] {
    const cases: EdgeCase[] = [];

    // Check parameters for edge cases
    for (const param of fn.parameters) {
      if (param.type.includes('string')) {
        cases.push({
          category: 'Empty String',
          description: `Empty string for "${param.name}"`,
          example: `${param.name}: ''`,
        });
      }

      if (param.type.includes('number')) {
        cases.push({
          category: 'Boundary Values',
          description: `Zero/negative values for "${param.name}"`,
          example: `${param.name}: 0`,
        });
      }

      if (param.type.includes('[]') || param.type.includes('Array')) {
        cases.push({
          category: 'Empty Array',
          description: `Empty array for "${param.name}"`,
          example: `${param.name}: []`,
        });
      }

      if (param.optional || param.type.includes('undefined')) {
        cases.push({
          category: 'Null/Undefined',
          description: `Undefined for "${param.name}"`,
          example: `${param.name}: undefined`,
        });
      }
    }

    // Error handling
    if (fn.throwsErrors) {
      cases.push({
        category: 'Error Handling',
        description: 'Verify error throwing behavior',
        example: 'expect(() => fn()).toThrow()',
      });
    }

    return cases;
  }
}
