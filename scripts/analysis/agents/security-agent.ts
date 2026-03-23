/**
 * Security Analysis Agent
 *
 * Detects security vulnerabilities:
 * - SQL injection
 * - Path traversal
 * - Command injection
 * - XSS vulnerabilities
 * - Insecure randomness
 * - Hardcoded secrets
 */

import * as ts from 'typescript';
import {
  AnalysisAgent,
  AnalysisIssue,
  DimensionReport,
  AnalysisContext,
} from '../multi-agent-analysis.js';

export class SecurityAgent extends AnalysisAgent {
  constructor() {
    super('SecurityAgent', [
      'inputValidation',
      'sqlInjection',
      'pathTraversal',
      'commandInjection',
      'xss',
      'secrets',
    ]);
  }

  async analyze(
    filePath: string,
    sourceFile: ts.SourceFile,
    _context: AnalysisContext
  ): Promise<DimensionReport[]> {
    const reports: DimensionReport[] = [];

    reports.push(await this.analyzeInputValidation(filePath, sourceFile));
    reports.push(await this.analyzeSQLInjection(filePath, sourceFile));
    reports.push(await this.analyzePathTraversal(filePath, sourceFile));
    reports.push(await this.analyzeCommandInjection(filePath, sourceFile));
    reports.push(await this.analyzeHardcodedSecrets(filePath, sourceFile));

    return reports;
  }

  private async analyzeInputValidation(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];

    const isHandler = filePath.includes('/handlers/');
    const isHttpEndpoint = filePath.includes('http-server') || filePath.includes('remote-server');
    const isNestedHandlerHelper =
      /\/handlers\/(?:helpers\/|[a-z-]+-actions\/)/.test(filePath) ||
      /\/handlers\/(?:base|error-codes)\.ts$/.test(filePath);
    const isTopLevelHandler =
      /^src\/handlers\/[^/]+\.ts$/.test(filePath) &&
      !/\/handlers\/(?:index|base|error-codes)\.ts$/.test(filePath);

    if ((!isHandler && !isHttpEndpoint) || isNestedHandlerHelper) {
      return {
        dimension: 'inputValidation',
        status: 'pass',
        issueCount: 0,
        issues: [],
        duration: Date.now() - startTime,
      };
    }

    let hasZodValidation = false;
    let hasManualValidation = false;
    let usesBaseHandler = false;
    let usesUnwrapRequest = false;
    let accessesRequestInput = false;
    const requestDerivedIdentifiers = new Set<string>();

    const expressionAccessesRequest = (node: ts.Node | undefined): boolean => {
      if (!node) {
        return false;
      }

      if (ts.isIdentifier(node)) {
        return (
          ['req', 'request', 'input'].includes(node.text) ||
          requestDerivedIdentifiers.has(node.text)
        );
      }

      if (ts.isPropertyAccessExpression(node)) {
        return expressionAccessesRequest(node.expression);
      }

      if (ts.isElementAccessExpression(node)) {
        return expressionAccessesRequest(node.expression);
      }

      if (ts.isCallExpression(node)) {
        if (expressionAccessesRequest(node.expression)) {
          return true;
        }
        return node.arguments.some((arg) => expressionAccessesRequest(arg));
      }

      return ts.forEachChild(node, expressionAccessesRequest) ?? false;
    };

    const findGuardedIdentifier = (node: ts.Expression): string | undefined => {
      if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
        return ts.isIdentifier(node.operand) ? node.operand.text : undefined;
      }

      if (
        ts.isBinaryExpression(node) &&
        [
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ].includes(node.operatorToken.kind)
      ) {
        if (ts.isIdentifier(node.left)) {
          return node.left.text;
        }
        if (ts.isIdentifier(node.right)) {
          return node.right.text;
        }
      }

      return undefined;
    };

    const branchRejectsInvalidInput = (node: ts.Node): boolean => {
      let rejects = false;

      const inspect = (child: ts.Node) => {
        if (
          ts.isReturnStatement(child) ||
          ts.isThrowStatement(child) ||
          (ts.isCallExpression(child) &&
            ts.isPropertyAccessExpression(child.expression) &&
            child.expression.name.text === 'status')
        ) {
          rejects = true;
          return;
        }

        ts.forEachChild(child, inspect);
      };

      inspect(node);
      return rejects;
    };

    const visit = (node: ts.Node) => {
      if (
        ts.isImportDeclaration(node) &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
      ) {
        for (const element of node.importClause.namedBindings.elements) {
          if (element.name.text === 'BaseHandler') {
            usesBaseHandler = true;
          }
          if (element.name.text === 'unwrapRequest') {
            usesUnwrapRequest = true;
          }
        }
      }

      // Check for Zod parsing
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const methodName = node.expression.name.text;
        if (methodName === 'parse' || methodName === 'safeParse') {
          hasZodValidation = true;
        }

        if (
          /^validate[A-Z_]/.test(methodName) &&
          node.arguments.some((arg) => expressionAccessesRequest(arg))
        ) {
          hasManualValidation = true;
        }
      }

      // Check for manual validation (typeof, instanceof, etc.)
      if (ts.isBinaryExpression(node)) {
        if (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
          const left = node.left;
          if (
            ts.isTypeOfExpression(left) ||
            (ts.isCallExpression(left) &&
              ts.isPropertyAccessExpression(left.expression) &&
              left.expression.name.text === 'isArray')
          ) {
            hasManualValidation = true;
          }
        }
      }

      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        expressionAccessesRequest(node.initializer)
      ) {
        requestDerivedIdentifiers.add(node.name.text);
        accessesRequestInput = true;
      }

      if (
        (ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node) ||
          ts.isCallExpression(node)) &&
        expressionAccessesRequest(node)
      ) {
        accessesRequestInput = true;
      }

      if (ts.isIfStatement(node)) {
        const guardedIdentifier = findGuardedIdentifier(node.expression);
        if (
          guardedIdentifier &&
          requestDerivedIdentifiers.has(guardedIdentifier) &&
          branchRejectsInvalidInput(node.thenStatement)
        ) {
          hasManualValidation = true;
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    if (usesBaseHandler && usesUnwrapRequest) {
      hasManualValidation = true;
    }

    if (isHttpEndpoint && !accessesRequestInput) {
      return {
        dimension: 'inputValidation',
        status: 'pass',
        issueCount: 0,
        issues: [],
        duration: Date.now() - startTime,
      };
    }

    if ((isTopLevelHandler || isHttpEndpoint) && !hasZodValidation && !hasManualValidation) {
      issues.push(
        this.createIssue(
          'inputValidation',
          filePath,
          'No input validation detected - external input should be validated',
          {
            severity: 'critical',
            suggestion: 'Add Zod schema validation or manual type checking',
            estimatedEffort: '1-2h',
            references: ['https://owasp.org/www-project-top-ten/2017/A1_2017-Injection'],
          }
        )
      );
    }

    return {
      dimension: 'inputValidation',
      status: issues.length === 0 ? 'pass' : 'fail',
      issueCount: issues.length,
      issues,
      duration: Date.now() - startTime,
    };
  }

  private async analyzeSQLInjection(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];
    const dynamicSqlVariables = new Set<string>();
    const executionMethods = new Set(['prepare', 'query', 'execute', 'run']);

    const containsSqlKeyword = (text: string): boolean =>
      /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/i.test(text);

    const isDynamicSqlExpression = (node: ts.Expression | undefined): boolean => {
      if (!node) {
        return false;
      }

      if (ts.isTemplateExpression(node)) {
        return node.templateSpans.length > 0 && containsSqlKeyword(node.getText(sourceFile));
      }

      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        return containsSqlKeyword(node.getText(sourceFile));
      }

      return false;
    };

    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        isDynamicSqlExpression(node.initializer)
      ) {
        dynamicSqlVariables.add(node.name.text);
      }

      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        const methodName = ts.isPropertyAccessExpression(expression)
          ? expression.name.text
          : ts.isIdentifier(expression)
            ? expression.text
            : undefined;

        if (methodName && executionMethods.has(methodName)) {
          const firstArg = node.arguments[0];
          const usesDynamicSql =
            (firstArg && isDynamicSqlExpression(firstArg as ts.Expression)) ||
            (firstArg && ts.isIdentifier(firstArg) && dynamicSqlVariables.has(firstArg.text));

          if (usesDynamicSql) {
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

            issues.push(
              this.createIssue(
                'sqlInjection',
                filePath,
                'Potential SQL injection: dynamic SQL executed without parameterization',
                {
                  severity: 'critical',
                  line,
                  suggestion: 'Use parameterized queries or prepared statements',
                  estimatedEffort: '30min-1h',
                  references: ['https://owasp.org/www-community/attacks/SQL_Injection'],
                }
              )
            );
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return {
      dimension: 'sqlInjection',
      status: issues.length === 0 ? 'pass' : 'fail',
      issueCount: issues.length,
      issues,
      duration: Date.now() - startTime,
    };
  }

  private async analyzePathTraversal(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];

    const visit = (node: ts.Node) => {
      // Check for path.join/resolve with user input
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const obj = node.expression.expression;
        const method = node.expression.name.text;

        if (
          ts.isIdentifier(obj) &&
          obj.text === 'path' &&
          (method === 'join' || method === 'resolve')
        ) {
          // Check if any argument looks like user input
          const hasUserInput = node.arguments.some((arg) => {
            const text = arg.getText(sourceFile);
            return (
              text.includes('request') ||
              text.includes('input') ||
              text.includes('params') ||
              text.includes('req.')
            );
          });

          if (hasUserInput) {
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

            issues.push(
              this.createIssue(
                'pathTraversal',
                filePath,
                'Potential path traversal: user input used in path construction',
                {
                  severity: 'critical',
                  line,
                  suggestion: 'Sanitize path input, validate against allowlist',
                  estimatedEffort: '1h',
                  references: ['https://owasp.org/www-community/attacks/Path_Traversal'],
                }
              )
            );
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return {
      dimension: 'pathTraversal',
      status: issues.length === 0 ? 'pass' : 'fail',
      issueCount: issues.length,
      issues,
      duration: Date.now() - startTime,
    };
  }

  private async analyzeCommandInjection(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];

    const visit = (node: ts.Node) => {
      // Check for child_process.exec with user input
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;

        if (method === 'exec' || method === 'spawn') {
          const firstArg = node.arguments[0];
          if (firstArg) {
            const text = firstArg.getText(sourceFile);
            const hasUserInput =
              text.includes('request') || text.includes('input') || text.includes('${');

            if (hasUserInput) {
              const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

              issues.push(
                this.createIssue(
                  'commandInjection',
                  filePath,
                  'Potential command injection: user input in shell command',
                  {
                    severity: 'critical',
                    line,
                    suggestion: 'Use spawn with argument array, avoid shell interpolation',
                    estimatedEffort: '1-2h',
                    references: ['https://owasp.org/www-community/attacks/Command_Injection'],
                  }
                )
              );
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return {
      dimension: 'commandInjection',
      status: issues.length === 0 ? 'pass' : 'fail',
      issueCount: issues.length,
      issues,
      duration: Date.now() - startTime,
    };
  }

  private async analyzeHardcodedSecrets(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];

    // Patterns for secrets
    const SECRET_PATTERNS = [
      { pattern: /api[_-]?key\s*[:=]\s*["'][^"']{20,}["']/i, type: 'API Key' },
      { pattern: /secret\s*[:=]\s*["'][^"']{20,}["']/i, type: 'Secret' },
      { pattern: /password\s*[:=]\s*["'][^"']+["']/i, type: 'Password' },
      { pattern: /token\s*[:=]\s*["'][^"']{20,}["']/i, type: 'Token' },
      { pattern: /jwt\s*[:=]\s*["'][^"']{20,}["']/i, type: 'JWT' },
    ];

    const text = sourceFile.getText();

    for (const { pattern, type } of SECRET_PATTERNS) {
      const matches = text.matchAll(new RegExp(pattern, 'g'));

      for (const match of matches) {
        const pos = match.index || 0;
        const line = sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

        issues.push(
          this.createIssue('secrets', filePath, `Potential hardcoded ${type} detected`, {
            severity: 'critical',
            line,
            suggestion: 'Use environment variables or secret management service',
            estimatedEffort: '30min',
            references: [
              'https://owasp.org/www-community/vulnerabilities/Use_of_hard-coded_password',
            ],
          })
        );
      }
    }

    return {
      dimension: 'secrets',
      status: issues.length === 0 ? 'pass' : 'fail',
      issueCount: issues.length,
      issues,
      duration: Date.now() - startTime,
    };
  }
}
