/**
 * Code Quality Analysis Agent
 *
 * Analyzes code quality across multiple dimensions:
 * - Cyclomatic complexity (branching complexity)
 * - Code duplication (similar AST structures)
 * - File size (LOC thresholds)
 * - Function length (>50 lines)
 * - Nesting depth (max indentation)
 *
 * ServalSheets Thresholds:
 * - Complexity: >10 warn, >20 fail
 * - File size: >500 warn, >1000 fail
 * - Function length: >50 lines warn
 * - Nesting depth: >5 warn
 */

import * as ts from 'typescript';
import {
  AnalysisAgent,
  AnalysisIssue,
  DimensionReport,
  AnalysisContext,
} from '../multi-agent-analysis.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface QualityThresholds {
  complexity: {
    warning: number;
    critical: number;
  };
  fileSize: {
    warning: number;
    critical: number;
  };
  functionLength: {
    warning: number;
  };
  nestingDepth: {
    warning: number;
  };
  duplicationMinLines: number;
  duplicationSimilarityThreshold: number;
}

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  complexity: {
    warning: 10,
    critical: 20,
  },
  fileSize: {
    warning: 500,
    critical: 1000,
  },
  functionLength: {
    warning: 50,
  },
  nestingDepth: {
    warning: 5,
  },
  duplicationMinLines: 10,
  duplicationSimilarityThreshold: 0.8, // 80% similarity
};

// ============================================================================
// CODE BLOCK REPRESENTATION
// ============================================================================

interface CodeBlock {
  file: string;
  line: number;
  endLine: number;
  functionName: string;
  tokens: string[];
  astHash: string;
}

// ============================================================================
// AGENT IMPLEMENTATION
// ============================================================================

export class CodeQualityAgent extends AnalysisAgent {
  private thresholds: QualityThresholds;
  private codeBlocks: Map<string, CodeBlock[]> = new Map();

  constructor(thresholds: Partial<QualityThresholds> = {}) {
    super('CodeQualityAgent', [
      'cyclomaticComplexity',
      'codeDuplication',
      'fileSize',
      'functionLength',
      'nestingDepth',
    ]);

    this.thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...thresholds,
    };
  }

  async analyze(
    filePath: string,
    sourceFile: ts.SourceFile,
    context: AnalysisContext
  ): Promise<DimensionReport[]> {
    const reports: DimensionReport[] = [];

    // Run all quality checks
    reports.push(await this.analyzeComplexity(filePath, sourceFile));
    reports.push(await this.analyzeFileSize(filePath, sourceFile));
    reports.push(await this.analyzeFunctionLength(filePath, sourceFile));
    reports.push(await this.analyzeNestingDepth(filePath, sourceFile));
    reports.push(await this.analyzeDuplication(filePath, sourceFile, context));

    return reports;
  }

  // ============================================================================
  // CYCLOMATIC COMPLEXITY ANALYSIS
  // ============================================================================

  private async analyzeComplexity(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];
    let maxComplexity = 0;
    let totalComplexity = 0;
    let functionCount = 0;

    const visit = (node: ts.Node) => {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)
      ) {
        const complexity = this.calculateCyclomaticComplexity(node);
        maxComplexity = Math.max(maxComplexity, complexity);
        totalComplexity += complexity;
        functionCount++;

        if (complexity > this.thresholds.complexity.warning) {
          const name = this.getFunctionName(node);
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const severity = complexity > this.thresholds.complexity.critical ? 'high' : 'medium';

          issues.push(
            this.createIssue(
              'cyclomaticComplexity',
              filePath,
              `Function "${name}" has cyclomatic complexity of ${complexity} (threshold: ${this.thresholds.complexity.warning})`,
              {
                severity,
                line,
                suggestion:
                  complexity > this.thresholds.complexity.critical
                    ? 'CRITICAL: Break into smaller functions immediately'
                    : 'Consider extracting logic into smaller, testable functions',
                estimatedEffort: complexity > this.thresholds.complexity.critical ? '2-4h' : '1-2h',
                autoFixable: false,
              }
            )
          );
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    const avgComplexity = functionCount > 0 ? totalComplexity / functionCount : 0;

    return {
      dimension: 'cyclomaticComplexity',
      status:
        maxComplexity > this.thresholds.complexity.critical
          ? 'fail'
          : issues.length > 0
            ? 'warning'
            : 'pass',
      issueCount: issues.length,
      issues,
      metrics: {
        maxComplexity,
        avgComplexity: Math.round(avgComplexity * 10) / 10,
        functionCount,
        totalComplexity,
      },
      duration: Date.now() - startTime,
    };
  }

  /**
   * Calculate cyclomatic complexity using standard formula:
   * CC = E - N + 2P
   * Where E = edges, N = nodes, P = connected components
   *
   * Simplified: Start at 1, add 1 for each decision point
   */
  private calculateCyclomaticComplexity(node: ts.Node): number {
    let complexity = 1; // Base complexity

    const visit = (n: ts.Node) => {
      // Decision points (+1 each)
      if (
        ts.isIfStatement(n) ||
        ts.isConditionalExpression(n) || // ? :
        ts.isForStatement(n) ||
        ts.isForInStatement(n) ||
        ts.isForOfStatement(n) ||
        ts.isWhileStatement(n) ||
        ts.isDoStatement(n) ||
        ts.isCaseClause(n) ||
        ts.isCatchClause(n)
      ) {
        complexity++;
      }

      // Logical operators (+1 each)
      if (ts.isBinaryExpression(n)) {
        const op = n.operatorToken.kind;
        if (
          op === ts.SyntaxKind.AmpersandAmpersandToken || // &&
          op === ts.SyntaxKind.BarBarToken || // ||
          op === ts.SyntaxKind.QuestionQuestionToken // ??
        ) {
          complexity++;
        }
      }

      ts.forEachChild(n, visit);
    };

    visit(node);
    return complexity;
  }

  private getFunctionName(node: ts.Node): string {
    if (ts.isFunctionDeclaration(node) && node.name) {
      return node.name.text;
    }
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      return node.name.text;
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const parent = node.parent;
      if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        return parent.name.text;
      }
      if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
        return parent.name.text;
      }
      return '<anonymous>';
    }
    return '<unknown>';
  }

  // ============================================================================
  // FILE SIZE ANALYSIS
  // ============================================================================

  private async analyzeFileSize(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];

    const lineCount = sourceFile.getLineAndCharacterOfPosition(sourceFile.getEnd()).line + 1;

    if (lineCount > this.thresholds.fileSize.warning) {
      const severity = lineCount > this.thresholds.fileSize.critical ? 'high' : 'medium';

      issues.push(
        this.createIssue(
          'fileSize',
          filePath,
          `File has ${lineCount} lines (threshold: ${this.thresholds.fileSize.warning})`,
          {
            severity,
            suggestion:
              lineCount > this.thresholds.fileSize.critical
                ? 'CRITICAL: Split into multiple modules immediately - maintainability risk'
                : 'Monitor file growth - consider splitting if continues to grow',
            estimatedEffort: lineCount > this.thresholds.fileSize.critical ? '1-2 days' : '4-8h',
            autoFixable: false,
          }
        )
      );
    }

    return {
      dimension: 'fileSize',
      status:
        lineCount > this.thresholds.fileSize.critical
          ? 'fail'
          : issues.length > 0
            ? 'warning'
            : 'pass',
      issueCount: issues.length,
      issues,
      metrics: { lineCount },
      duration: Date.now() - startTime,
    };
  }

  // ============================================================================
  // FUNCTION LENGTH ANALYSIS
  // ============================================================================

  private async analyzeFunctionLength(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];
    let maxLength = 0;
    let totalLength = 0;
    let functionCount = 0;

    const visit = (node: ts.Node) => {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)
      ) {
        const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
        const length = endLine - startLine + 1;

        maxLength = Math.max(maxLength, length);
        totalLength += length;
        functionCount++;

        if (length > this.thresholds.functionLength.warning) {
          const name = this.getFunctionName(node);

          issues.push(
            this.createIssue(
              'functionLength',
              filePath,
              `Function "${name}" is ${length} lines long (threshold: ${this.thresholds.functionLength.warning})`,
              {
                severity: 'medium',
                line: startLine,
                suggestion: 'Extract logical sections into smaller, named helper functions',
                estimatedEffort: '1-3h',
                autoFixable: false,
              }
            )
          );
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    const avgLength = functionCount > 0 ? totalLength / functionCount : 0;

    return {
      dimension: 'functionLength',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: issues.length,
      issues,
      metrics: {
        maxLength,
        avgLength: Math.round(avgLength * 10) / 10,
        functionCount,
      },
      duration: Date.now() - startTime,
    };
  }

  // ============================================================================
  // NESTING DEPTH ANALYSIS
  // ============================================================================

  private async analyzeNestingDepth(
    filePath: string,
    sourceFile: ts.SourceFile
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];
    let maxDepth = 0;

    const visit = (node: ts.Node) => {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)
      ) {
        const depth = this.calculateNestingDepth(node);
        maxDepth = Math.max(maxDepth, depth);

        if (depth > this.thresholds.nestingDepth.warning) {
          const name = this.getFunctionName(node);
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

          issues.push(
            this.createIssue(
              'nestingDepth',
              filePath,
              `Function "${name}" has nesting depth of ${depth} (threshold: ${this.thresholds.nestingDepth.warning})`,
              {
                severity: 'medium',
                line,
                suggestion:
                  'Reduce nesting with early returns, guard clauses, or extracted functions',
                estimatedEffort: '1-2h',
                autoFixable: false,
              }
            )
          );
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return {
      dimension: 'nestingDepth',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: issues.length,
      issues,
      metrics: { maxDepth },
      duration: Date.now() - startTime,
    };
  }

  private calculateNestingDepth(node: ts.Node, currentDepth = 0): number {
    let maxDepth = currentDepth;

    const visit = (n: ts.Node, depth: number) => {
      let newDepth = depth;

      // Increment depth for control structures
      if (
        ts.isIfStatement(n) ||
        ts.isForStatement(n) ||
        ts.isForInStatement(n) ||
        ts.isForOfStatement(n) ||
        ts.isWhileStatement(n) ||
        ts.isDoStatement(n) ||
        ts.isSwitchStatement(n) ||
        ts.isTryStatement(n) ||
        ts.isBlock(n)
      ) {
        newDepth++;
        maxDepth = Math.max(maxDepth, newDepth);
      }

      ts.forEachChild(n, (child) => visit(child, newDepth));
    };

    ts.forEachChild(node, (child) => visit(child, currentDepth));
    return maxDepth;
  }

  // ============================================================================
  // CODE DUPLICATION ANALYSIS
  // ============================================================================

  private async analyzeDuplication(
    filePath: string,
    sourceFile: ts.SourceFile,
    context: AnalysisContext
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];

    // Extract code blocks from current file
    const currentBlocks = this.extractCodeBlocks(filePath, sourceFile);
    this.codeBlocks.set(filePath, currentBlocks);

    // Compare with previously analyzed files
    for (const [otherFile, otherBlocks] of this.codeBlocks.entries()) {
      if (otherFile === filePath) continue;

      for (const block1 of currentBlocks) {
        for (const block2 of otherBlocks) {
          const similarity = this.calculateSimilarity(block1, block2);

          if (similarity >= this.thresholds.duplicationSimilarityThreshold) {
            const blockSize = block1.endLine - block1.line + 1;

            if (blockSize >= this.thresholds.duplicationMinLines) {
              issues.push(
                this.createIssue(
                  'codeDuplication',
                  filePath,
                  `Code block in "${block1.functionName}" is ${Math.round(similarity * 100)}% similar to "${block2.functionName}" in ${otherFile}`,
                  {
                    severity: 'medium',
                    line: block1.line,
                    suggestion: 'Extract to shared utility function',
                    estimatedEffort: '1-2h',
                    relatedFiles: [otherFile],
                    autoFixable: false,
                  }
                )
              );
            }
          }
        }
      }
    }

    return {
      dimension: 'codeDuplication',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: issues.length,
      issues,
      metrics: {
        blocksAnalyzed: currentBlocks.length,
        duplicatesFound: issues.length,
      },
      duration: Date.now() - startTime,
    };
  }

  private extractCodeBlocks(filePath: string, sourceFile: ts.SourceFile): CodeBlock[] {
    const blocks: CodeBlock[] = [];

    const visit = (node: ts.Node) => {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)
      ) {
        const name = this.getFunctionName(node);
        const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

        // Extract tokens for comparison
        const tokens = this.extractTokens(node);
        const astHash = this.hashAST(node);

        blocks.push({
          file: filePath,
          line: startLine,
          endLine,
          functionName: name,
          tokens,
          astHash,
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return blocks;
  }

  private extractTokens(node: ts.Node): string[] {
    const tokens: string[] = [];

    const visit = (n: ts.Node) => {
      // Extract meaningful tokens (skip literals, identifiers for better comparison)
      const kind = ts.SyntaxKind[n.kind];
      if (kind) {
        tokens.push(kind);
      }

      ts.forEachChild(n, visit);
    };

    visit(node);
    return tokens;
  }

  private hashAST(node: ts.Node): string {
    const tokens = this.extractTokens(node);
    // Simple hash: join tokens
    return tokens.join(',');
  }

  /**
   * Calculate similarity between two code blocks using token-based comparison
   * Returns value between 0.0 (completely different) and 1.0 (identical)
   */
  private calculateSimilarity(block1: CodeBlock, block2: CodeBlock): number {
    // Quick check: AST hash comparison
    if (block1.astHash === block2.astHash) {
      return 1.0;
    }

    // Token-based Jaccard similarity
    const set1 = new Set(block1.tokens);
    const set2 = new Set(block2.tokens);

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }
}
