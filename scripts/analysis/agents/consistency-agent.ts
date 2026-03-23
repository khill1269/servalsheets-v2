/**
 * Consistency Analysis Agent
 *
 * Enforces project-wide conventions:
 * - Naming conventions (camelCase, PascalCase)
 * - Import ordering (external → internal → types)
 * - Error handling (ErrorCode enum usage)
 * - Response format ({ response: { success, data } })
 * - Comment style (@param, @returns presence)
 */

import * as ts from 'typescript';
import {
  AnalysisAgent,
  AnalysisIssue,
  DimensionReport,
  AnalysisContext,
} from '../multi-agent-analysis.js';

interface NamingIssue {
  name: string;
  expected: string;
  actual: string;
  line: number;
}

interface ImportIssue {
  message: string;
  expected: string;
  suggestion: string;
  line?: number;
}

export class ConsistencyAgent extends AnalysisAgent {
  constructor() {
    super('ConsistencyAgent', [
      'namingConventions',
      'importOrdering',
      'errorHandling',
      'responseFormat',
      'commentStyle',
    ]);
  }

  async analyze(
    filePath: string,
    sourceFile: ts.SourceFile,
    context: AnalysisContext
  ): Promise<DimensionReport[]> {
    const reports: DimensionReport[] = [];

    // Check naming conventions
    reports.push(await this.analyzeNamingConventions(filePath, sourceFile));

    // Check import ordering
    reports.push(await this.analyzeImportOrdering(filePath, sourceFile));

    // Check error handling patterns
    reports.push(await this.analyzeErrorHandling(filePath, sourceFile));

    // Check response format
    reports.push(await this.analyzeResponseFormat(filePath, sourceFile));

    // Check comment style
    reports.push(await this.analyzeCommentStyle(filePath, sourceFile));

    return reports;
  }

  // ============================================================================
  // NAMING CONVENTIONS
  // ============================================================================

  private async analyzeNamingConventions(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];
    const namingIssues = this.checkNamingConventions(sourceFile);

    for (const issue of namingIssues) {
      issues.push(
        this.createIssue('namingConventions', filePath, issue.message, {
          line: issue.line,
          suggestion: issue.suggestion,
          autoFixable: false,
        })
      );
    }

    return {
      dimension: 'namingConventions',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: issues.length,
      issues,
      duration: Date.now() - startTime,
    };
  }

  private checkNamingConventions(sourceFile: ts.SourceFile): Array<{
    message: string;
    line: number;
    suggestion: string;
  }> {
    const issues: Array<{ message: string; line: number; suggestion: string }> = [];

    const visit = (node: ts.Node) => {
      // Functions/variables should be camelCase
      if (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) {
        const name = node.name?.getText();
        if (name && !this.isValidVariableName(name)) {
          const expected = this.isCamelCase(name) ? 'camelCase' : 'PascalCase';
          const actual = this.detectCase(name);
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

          issues.push({
            message: `Name "${name}" uses ${actual} but should use ${expected}`,
            line,
            suggestion: `Rename to ${this.convertToCamelCase(name)}`,
          });
        }
      }

      // Method declarations should be camelCase
      if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
        const name = node.name.text;
        if (!this.isCamelCase(name)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          issues.push({
            message: `Method "${name}" should use camelCase`,
            line,
            suggestion: `Rename to ${this.convertToCamelCase(name)}`,
          });
        }
      }

      // Classes/interfaces should be PascalCase
      if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
        const name = node.name?.getText();
        if (name && !this.isPascalCase(name)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          issues.push({
            message: `${ts.isClassDeclaration(node) ? 'Class' : 'Interface'} "${name}" should use PascalCase`,
            line,
            suggestion: `Rename to ${this.convertToPascalCase(name)}`,
          });
        }
      }

      // Type aliases should be PascalCase
      if (ts.isTypeAliasDeclaration(node)) {
        const name = node.name.text;
        if (!this.isPascalCase(name)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          issues.push({
            message: `Type alias "${name}" should use PascalCase`,
            line,
            suggestion: `Rename to ${this.convertToPascalCase(name)}`,
          });
        }
      }

      // Enum members should be UPPER_SNAKE_CASE or PascalCase (both common)
      if (ts.isEnumDeclaration(node)) {
        const enumName = node.name.text;
        if (!this.isPascalCase(enumName)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          issues.push({
            message: `Enum "${enumName}" should use PascalCase`,
            line,
            suggestion: `Rename to ${this.convertToPascalCase(enumName)}`,
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return issues;
  }

  private isValidVariableName(name: string): boolean {
    // Allow camelCase, PascalCase, UPPER_SNAKE_CASE (constants)
    return (
      this.isCamelCase(name) ||
      this.isPascalCase(name) ||
      this.isUpperSnakeCase(name) ||
      name.startsWith('_') // Private variables
    );
  }

  private isCamelCase(name: string): boolean {
    // First char lowercase, no underscores (except leading)
    return /^[a-z][a-zA-Z0-9]*$/.test(name);
  }

  private isPascalCase(name: string): boolean {
    // First char uppercase, no underscores
    return /^[A-Z][a-zA-Z0-9]*$/.test(name);
  }

  private isUpperSnakeCase(name: string): boolean {
    // All uppercase with underscores
    return /^[A-Z][A-Z0-9_]*$/.test(name);
  }

  private detectCase(name: string): string {
    if (this.isCamelCase(name)) return 'camelCase';
    if (this.isPascalCase(name)) return 'PascalCase';
    if (this.isUpperSnakeCase(name)) return 'UPPER_SNAKE_CASE';
    if (/^[a-z][a-z0-9_]*$/.test(name)) return 'snake_case';
    if (/^[a-z][a-z0-9-]*$/.test(name)) return 'kebab-case';
    return 'mixed/unknown';
  }

  private convertToCamelCase(name: string): string {
    // Convert any case to camelCase
    return name
      .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
      .replace(/^[A-Z]/, (char) => char.toLowerCase());
  }

  private convertToPascalCase(name: string): string {
    // Convert any case to PascalCase
    const camel = this.convertToCamelCase(name);
    return camel.charAt(0).toUpperCase() + camel.slice(1);
  }

  // ============================================================================
  // IMPORT ORDERING
  // ============================================================================

  private async analyzeImportOrdering(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];
    const importIssues = this.checkImportOrdering(sourceFile);

    for (const issue of importIssues) {
      issues.push(
        this.createIssue('importOrdering', filePath, issue.message, {
          line: issue.line,
          suggestion: issue.suggestion,
          autoFixable: true,
        })
      );
    }

    return {
      dimension: 'importOrdering',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: issues.length,
      issues,
      duration: Date.now() - startTime,
    };
  }

  private checkImportOrdering(sourceFile: ts.SourceFile): ImportIssue[] {
    const imports = this.getImports(sourceFile);
    if (imports.length === 0) return [];

    // Expected order: External → Internal → Types
    const currentOrder = this.determineOrder(imports);
    const expectedOrder = ['external', 'internal', 'type'];

    if (!this.isCorrectOrder(currentOrder, expectedOrder)) {
      return [
        {
          message: 'Imports not in correct order (expected: External → Internal → Types)',
          expected: 'External → Internal → Types',
          suggestion: 'Reorder imports or run: npm run lint --fix',
          line: imports[0].line,
        },
      ];
    }

    return [];
  }

  private getImports(sourceFile: ts.SourceFile): Array<{
    type: 'external' | 'internal' | 'type';
    line: number;
    text: string;
  }> {
    const imports: Array<{ type: 'external' | 'internal' | 'type'; line: number; text: string }> =
      [];

    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const isTypeOnly = node.importClause?.isTypeOnly || false;

        let type: 'external' | 'internal' | 'type';
        if (isTypeOnly) {
          type = 'type';
        } else if (moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/')) {
          type = 'internal';
        } else {
          type = 'external';
        }

        imports.push({
          type,
          line,
          text: node.getText(sourceFile),
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return imports;
  }

  private determineOrder(
    imports: Array<{ type: 'external' | 'internal' | 'type'; line: number; text: string }>
  ): string[] {
    const order: string[] = [];
    let lastType: string | null = null;

    for (const imp of imports) {
      if (imp.type !== lastType) {
        order.push(imp.type);
        lastType = imp.type;
      }
    }

    return order;
  }

  private isCorrectOrder(current: string[], expected: string[]): boolean {
    // Current order should be a subset of expected order in the same sequence
    let expectedIndex = 0;

    for (const item of current) {
      const index = expected.indexOf(item, expectedIndex);
      if (index === -1 || index < expectedIndex) {
        return false;
      }
      expectedIndex = index + 1;
    }

    return true;
  }

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  private async analyzeErrorHandling(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];

    // Check for structured error usage
    let hasStructuredErrors = false;
    let hasErrorCodeEnum = false;
    let hasRawThrows = false;
    const rawThrowLocations: number[] = [];

    const visit = (node: ts.Node) => {
      // Check for throw statements
      if (ts.isThrowStatement(node)) {
        const expr = node.expression;
        if (expr && ts.isNewExpression(expr) && ts.isIdentifier(expr.expression)) {
          const errorType = expr.expression.text;
          if (errorType.endsWith('Error') && errorType !== 'Error') {
            hasStructuredErrors = true;
          } else if (errorType === 'Error') {
            hasRawThrows = true;
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            rawThrowLocations.push(line);
          }
        }
      }

      // Check for ErrorCode enum usage
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'ErrorCode'
      ) {
        hasErrorCodeEnum = true;
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    // Only check handlers and services
    const shouldCheck =
      filePath.includes('/handlers/') ||
      filePath.includes('/services/') ||
      filePath.includes('/utils/');

    if (shouldCheck && hasRawThrows && !hasStructuredErrors) {
      for (const line of rawThrowLocations) {
        issues.push(
          this.createIssue(
            'errorHandling',
            filePath,
            'Using generic Error instead of structured error types',
            {
              line,
              suggestion: 'Use error factory functions (e.g., createValidationError)',
              severity: 'medium',
              autoFixable: false,
            }
          )
        );
      }
    }

    if (shouldCheck && hasStructuredErrors && !hasErrorCodeEnum) {
      issues.push(
        this.createIssue(
          'errorHandling',
          filePath,
          'Structured errors found but ErrorCode enum not used',
          {
            suggestion: 'Import and use ErrorCode enum for consistent error codes',
            severity: 'low',
            autoFixable: false,
          }
        )
      );
    }

    return {
      dimension: 'errorHandling',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: issues.length,
      issues,
      metrics: {
        hasStructuredErrors: hasStructuredErrors ? 1 : 0,
        hasErrorCodeEnum: hasErrorCodeEnum ? 1 : 0,
        rawThrowCount: rawThrowLocations.length,
      },
      duration: Date.now() - startTime,
    };
  }

  // ============================================================================
  // RESPONSE FORMAT
  // ============================================================================

  private async analyzeResponseFormat(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];

    // Only check handler files
    if (!filePath.includes('/handlers/')) {
      return {
        dimension: 'responseFormat',
        status: 'pass',
        issueCount: 0,
        issues: [],
        duration: Date.now() - startTime,
      };
    }

    let hasCorrectFormat = false;
    let hasIncorrectFormat = false;
    const incorrectLocations: number[] = [];

    const visit = (node: ts.Node) => {
      // Check return statements in handler methods
      if (ts.isReturnStatement(node) && node.expression) {
        const returnExpr = node.expression;

        // Check for { response: { success, data } } pattern
        if (ts.isObjectLiteralExpression(returnExpr)) {
          const hasResponseProp = returnExpr.properties.some(
            (prop) =>
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              prop.name.text === 'response'
          );

          const hasContentProp = returnExpr.properties.some(
            (prop) =>
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              prop.name.text === 'content'
          );

          if (hasResponseProp) {
            hasCorrectFormat = true;
          } else if (hasContentProp) {
            // Returning MCP format directly (incorrect)
            hasIncorrectFormat = true;
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            incorrectLocations.push(line);
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    if (hasIncorrectFormat) {
      for (const line of incorrectLocations) {
        issues.push(
          this.createIssue(
            'responseFormat',
            filePath,
            'Handler returning MCP format directly instead of { response: {...} }',
            {
              line,
              suggestion:
                'Return { response: { success: true, data } } and let tool layer convert to MCP format',
              severity: 'high',
              autoFixable: false,
              references: ['src/mcp/registration/tool-handlers.ts:500+ (buildToolResponse)'],
            }
          )
        );
      }
    }

    return {
      dimension: 'responseFormat',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: issues.length,
      issues,
      metrics: {
        hasCorrectFormat: hasCorrectFormat ? 1 : 0,
        hasIncorrectFormat: hasIncorrectFormat ? 1 : 0,
      },
      duration: Date.now() - startTime,
    };
  }

  // ============================================================================
  // COMMENT STYLE
  // ============================================================================

  private async analyzeCommentStyle(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];

    // Check public functions/methods for JSDoc
    const visit = (node: ts.Node) => {
      // Check exported functions
      if (ts.isFunctionDeclaration(node)) {
        const isExported = node.modifiers?.some(
          (mod) =>
            mod.kind === ts.SyntaxKind.ExportKeyword || mod.kind === ts.SyntaxKind.DefaultKeyword
        );

        if (isExported && !this.hasJSDoc(node)) {
          const name = node.name?.text || '<anonymous>';
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

          issues.push(
            this.createIssue(
              'commentStyle',
              filePath,
              `Exported function "${name}" missing JSDoc`,
              {
                line,
                suggestion: 'Add JSDoc with @param and @returns tags',
                severity: 'low',
                autoFixable: false,
              }
            )
          );
        }
      }

      // Check public methods in classes
      if (ts.isMethodDeclaration(node)) {
        const isPublic =
          !node.modifiers ||
          !node.modifiers.some(
            (mod) =>
              mod.kind === ts.SyntaxKind.PrivateKeyword ||
              mod.kind === ts.SyntaxKind.ProtectedKeyword
          );

        if (isPublic && ts.isIdentifier(node.name) && !this.hasJSDoc(node)) {
          const name = node.name.text;
          // Skip common lifecycle methods and simple accessors
          if (!['constructor', 'toString', 'valueOf'].includes(name)) {
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

            issues.push(
              this.createIssue('commentStyle', filePath, `Public method "${name}" missing JSDoc`, {
                line,
                suggestion: 'Add JSDoc with @param and @returns tags',
                severity: 'low',
                autoFixable: false,
              })
            );
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return {
      dimension: 'commentStyle',
      status: issues.length === 0 ? 'pass' : issues.length > 10 ? 'warning' : 'pass',
      issueCount: issues.length,
      issues,
      duration: Date.now() - startTime,
    };
  }

  private hasJSDoc(node: ts.Node): boolean {
    const jsDoc = (node as any).jsDoc;
    return jsDoc && jsDoc.length > 0;
  }
}
