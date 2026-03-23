/**
 * Type Safety Analysis Agent
 *
 * Detects unsafe type operations:
 * - Explicit any types
 * - Type assertions (as, <Type>)
 * - Non-null assertions (!)
 * - @ts-ignore comments
 * - Unsafe type casts
 */

import * as ts from 'typescript';
import {
  AnalysisAgent,
  AnalysisIssue,
  DimensionReport,
  AnalysisContext,
} from '../multi-agent-analysis.js';

interface AnyTypeLocation {
  line: number;
  column: number;
  context: string;
  suggestion: string;
}

interface TypeAssertionLocation {
  line: number;
  column: number;
  fromType: string;
  toType: string;
  assertionType: 'as' | 'angle-bracket';
  suggestion: string;
}

interface NonNullAssertionLocation {
  line: number;
  column: number;
  expression: string;
  suggestion: string;
}

interface TsIgnoreLocation {
  line: number;
  reason?: string;
  suggestion: string;
}

export class TypeSafetyAgent extends AnalysisAgent {
  constructor() {
    super('TypeSafetyAgent', [
      'anyTypes',
      'typeAssertions',
      'nonNullAssertions',
      'tsIgnoreComments',
    ]);
  }

  async analyze(
    filePath: string,
    sourceFile: ts.SourceFile,
    context: AnalysisContext
  ): Promise<DimensionReport[]> {
    const reports: DimensionReport[] = [];

    reports.push(await this.analyzeExplicitAny(filePath, sourceFile));
    reports.push(await this.analyzeTypeAssertions(filePath, sourceFile));
    reports.push(await this.analyzeNonNullAssertions(filePath, sourceFile));
    reports.push(await this.analyzeTsIgnoreComments(filePath, sourceFile));

    return reports;
  }

  /**
   * Find explicit ": any" type annotations
   */
  private async analyzeExplicitAny(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const locations = this.findExplicitAny(sourceFile);
    const issues: AnalysisIssue[] = [];

    for (const location of locations) {
      issues.push(
        this.createIssue('anyTypes', filePath, `Explicit "any" type found: ${location.context}`, {
          severity: 'high',
          line: location.line,
          column: location.column,
          suggestion: location.suggestion,
          estimatedEffort: '15-30min',
          autoFixable: false,
          references: ['https://www.typescriptlang.org/docs/handbook/2/narrowing.html'],
        })
      );
    }

    return {
      dimension: 'anyTypes',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: issues.length,
      issues,
      metrics: { explicitAnyCount: locations.length },
      duration: Date.now() - startTime,
    };
  }

  /**
   * Find type assertions (as Type and <Type>)
   */
  private async analyzeTypeAssertions(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const locations = this.findTypeAssertions(sourceFile);
    const issues: AnalysisIssue[] = [];

    for (const location of locations) {
      issues.push(
        this.createIssue(
          'typeAssertions',
          filePath,
          `Type assertion bypasses type checking: ${location.fromType} ${location.assertionType === 'as' ? 'as' : '<>'} ${location.toType}`,
          {
            severity: 'medium',
            line: location.line,
            column: location.column,
            suggestion: location.suggestion,
            estimatedEffort: '30min-1h',
            autoFixable: false,
            references: [
              'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions',
            ],
          }
        )
      );
    }

    return {
      dimension: 'typeAssertions',
      status: issues.length === 0 ? 'pass' : issues.length > 10 ? 'fail' : 'warning',
      issueCount: issues.length,
      issues,
      metrics: {
        typeAssertionCount: locations.length,
        asAssertions: locations.filter((l) => l.assertionType === 'as').length,
        angleBracketAssertions: locations.filter((l) => l.assertionType === 'angle-bracket').length,
      },
      duration: Date.now() - startTime,
    };
  }

  /**
   * Find non-null assertions (!)
   */
  private async analyzeNonNullAssertions(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const locations = this.findNonNullAssertions(sourceFile);
    const issues: AnalysisIssue[] = [];

    for (const location of locations) {
      issues.push(
        this.createIssue(
          'nonNullAssertions',
          filePath,
          `Non-null assertion bypasses null checking: ${location.expression}!`,
          {
            severity: 'medium',
            line: location.line,
            column: location.column,
            suggestion: location.suggestion,
            estimatedEffort: '15-30min',
            autoFixable: false,
            references: [
              'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-0.html#non-null-assertion-operator',
            ],
          }
        )
      );
    }

    return {
      dimension: 'nonNullAssertions',
      status: issues.length === 0 ? 'pass' : issues.length > 20 ? 'fail' : 'warning',
      issueCount: issues.length,
      issues,
      metrics: { nonNullAssertionCount: locations.length },
      duration: Date.now() - startTime,
    };
  }

  /**
   * Find @ts-ignore comments
   */
  private async analyzeTsIgnoreComments(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const locations = this.findTsIgnoreComments(sourceFile);
    const issues: AnalysisIssue[] = [];

    for (const location of locations) {
      issues.push(
        this.createIssue(
          'tsIgnoreComments',
          filePath,
          location.reason
            ? `@ts-ignore suppresses type errors: ${location.reason}`
            : '@ts-ignore suppresses type errors without explanation',
          {
            severity: location.reason ? 'medium' : 'high',
            line: location.line,
            suggestion: location.suggestion,
            estimatedEffort: '1-2h',
            autoFixable: false,
            references: [
              'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-6.html#suppress-errors-in-ts-files-using--ts-ignore-comments',
            ],
          }
        )
      );
    }

    return {
      dimension: 'tsIgnoreComments',
      status: issues.length === 0 ? 'pass' : issues.length > 5 ? 'fail' : 'warning',
      issueCount: issues.length,
      issues,
      metrics: {
        tsIgnoreCount: locations.length,
        withReason: locations.filter((l) => l.reason).length,
        withoutReason: locations.filter((l) => !l.reason).length,
      },
      duration: Date.now() - startTime,
    };
  }

  // ============================================================================
  // DETECTION METHODS
  // ============================================================================

  private findExplicitAny(sourceFile: ts.SourceFile): AnyTypeLocation[] {
    const locations: AnyTypeLocation[] = [];

    const visit = (node: ts.Node) => {
      // Check for "any" keyword type (ts.KeywordTypeNode)
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const context = this.getNodeContext(node, sourceFile);

        locations.push({
          line: pos.line + 1,
          column: pos.character,
          context,
          suggestion: this.suggestAnyReplacement(context),
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return locations;
  }

  private findTypeAssertions(sourceFile: ts.SourceFile): TypeAssertionLocation[] {
    const locations: TypeAssertionLocation[] = [];

    const visit = (node: ts.Node) => {
      // "as" assertions
      if (ts.isAsExpression(node)) {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const fromType = node.expression.getText(sourceFile);
        const toType = node.type.getText(sourceFile);

        locations.push({
          line: pos.line + 1,
          column: pos.character,
          fromType: this.truncate(fromType, 50),
          toType,
          assertionType: 'as',
          suggestion: this.suggestTypeGuard(fromType, toType),
        });
      }

      // <Type> assertions (angle bracket)
      if (ts.isTypeAssertionExpression(node)) {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const fromType = node.expression.getText(sourceFile);
        const toType = node.type.getText(sourceFile);

        locations.push({
          line: pos.line + 1,
          column: pos.character,
          fromType: this.truncate(fromType, 50),
          toType,
          assertionType: 'angle-bracket',
          suggestion: `Prefer "as" syntax over <Type> assertions, or better: use type guard function`,
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return locations;
  }

  private findNonNullAssertions(sourceFile: ts.SourceFile): NonNullAssertionLocation[] {
    const locations: NonNullAssertionLocation[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isNonNullExpression(node)) {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const expression = node.expression.getText(sourceFile);

        // Check if parent is array access (ElementAccessExpression)
        const isArrayAccess = node.parent && ts.isElementAccessExpression(node.parent);

        locations.push({
          line: pos.line + 1,
          column: pos.character,
          expression: this.truncate(expression, 50),
          suggestion: this.suggestNonNullAlternative(expression, isArrayAccess),
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return locations;
  }

  private findTsIgnoreComments(sourceFile: ts.SourceFile): TsIgnoreLocation[] {
    const locations: TsIgnoreLocation[] = [];
    const text = sourceFile.getFullText(); // Use getFullText to include comments
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match @ts-ignore with optional reason (after //)
      const match = line.match(/\/\/\s*@ts-ignore(?:\s+([^\r\n]+))?/);
      if (match) {
        const reason = match[1]?.trim();

        locations.push({
          line: i + 1,
          reason: reason || undefined,
          suggestion: reason
            ? 'Fix underlying type issue instead of suppressing with @ts-ignore'
            : 'Add explanation or preferably use @ts-expect-error with reason',
        });
      }
    }

    return locations;
  }

  // ============================================================================
  // SUGGESTION HELPERS
  // ============================================================================

  private suggestAnyReplacement(context: string): string {
    // Parameter
    if (context.includes('parameter')) {
      return 'Replace with "unknown" and add type guards, or define specific parameter type';
    }

    // Return type
    if (context.includes('return')) {
      return 'Define specific return type or use "unknown" if truly dynamic';
    }

    // Variable (but check for array first)
    if (context.includes('const/let')) {
      return 'Replace any[] with specific type array (e.g., string[], unknown[]), or let TypeScript infer type';
    }

    // Property
    if (context.includes('property')) {
      return 'Define specific property type or use discriminated union';
    }

    // Generic
    return 'Replace "any" with "unknown" and add type guards, or define specific type';
  }

  private suggestTypeGuard(fromType: string, toType: string): string {
    // Check if casting to primitive
    const primitives = ['string', 'number', 'boolean', 'object'];
    if (primitives.includes(toType)) {
      return `Use typeof check with type guard: if (typeof ${fromType} === '${toType}') { ... }`;
    }

    // Check if casting to interface/type
    if (toType[0] === toType[0]?.toUpperCase()) {
      return `Create type guard function: function is${toType}(value: unknown): value is ${toType} { ... }`;
    }

    return 'Replace type assertion with proper type guard or refactor to avoid cast';
  }

  private suggestNonNullAlternative(expression: string, isArrayAccess?: boolean): string {
    // Array access (array![0])
    if (isArrayAccess) {
      return `Add null check: if (${expression}) { ... } instead of using ${expression}!`;
    }

    // Function call (func()!)
    if (expression.includes('(')) {
      return `Ensure return type excludes null/undefined, or add explicit check`;
    }

    // Property access (obj!.prop) or generic identifier
    return `Use optional chaining: ${expression}?.property instead of ${expression}!.property`;
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  private getNodeContext(node: ts.Node, sourceFile: ts.SourceFile): string {
    let parent = node.parent;

    // Find meaningful parent
    while (parent) {
      if (ts.isParameter(parent)) {
        return 'parameter';
      }
      if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) {
        return 'return type';
      }
      if (ts.isVariableDeclaration(parent)) {
        return `const/let variable`;
      }
      if (ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent)) {
        return 'property';
      }
      parent = parent.parent;
    }

    return 'unknown context';
  }

  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  }
}
