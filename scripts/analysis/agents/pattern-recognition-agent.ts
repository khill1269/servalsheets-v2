/**
 * Pattern Recognition Agent
 *
 * Detects cross-file consistency patterns:
 * - Handler method naming (execute vs handle vs process)
 * - Schema structure patterns (discriminatedUnion vs directEnum)
 * - Error handling patterns (throw vs return)
 * - Response format patterns ({ response: { success, data } })
 * - Naming conventions (camelCase, PascalCase, snake_case)
 *
 * Performs cross-file analysis to identify dominant patterns and deviations.
 */

import * as ts from 'typescript';
import * as path from 'path';
import {
  AnalysisAgent,
  AnalysisIssue,
  DimensionReport,
  AnalysisContext,
} from '../multi-agent-analysis.js';

// ============================================================================
// PATTERN TYPES
// ============================================================================

interface PatternInstance {
  file: string;
  line: number;
  pattern: string;
  variant: string;
  context?: string;
}

interface PatternAnalysis {
  patternType: string;
  dominantVariant: string;
  dominantCount: number;
  totalInstances: number;
  variants: Map<string, PatternInstance[]>;
  deviations: PatternInstance[];
}

// ============================================================================
// PATTERN RECOGNITION AGENT
// ============================================================================

export class PatternRecognitionAgent extends AnalysisAgent {
  // Cross-file pattern storage
  private handlerPatterns: Map<string, PatternInstance[]> = new Map();
  private schemaPatterns: Map<string, PatternInstance[]> = new Map();
  private errorPatterns: Map<string, PatternInstance[]> = new Map();
  private responsePatterns: Map<string, PatternInstance[]> = new Map();
  private namingPatterns: Map<string, PatternInstance[]> = new Map();

  constructor() {
    super('PatternRecognitionAgent', [
      'handlerPattern',
      'schemaPattern',
      'errorPattern',
      'responsePattern',
      'namingPattern',
    ]);
  }

  async analyze(
    filePath: string,
    sourceFile: ts.SourceFile,
    context: AnalysisContext
  ): Promise<DimensionReport[]> {
    const reports: DimensionReport[] = [];

    // Store patterns for cross-file analysis
    this.collectPatterns(filePath, sourceFile);

    // Always generate reports (will return pass status if insufficient data)
    reports.push(await this.analyzeHandlerPattern(filePath, sourceFile, context));
    reports.push(await this.analyzeSchemaPattern(filePath, sourceFile, context));
    reports.push(await this.analyzeErrorPattern(filePath, sourceFile, context));
    reports.push(await this.analyzeResponsePattern(filePath, sourceFile, context));
    reports.push(await this.analyzeNamingPattern(filePath, sourceFile, context));

    return reports;
  }

  /**
   * Collect patterns from current file for cross-file analysis
   */
  private collectPatterns(filePath: string, sourceFile: ts.SourceFile): void {
    const visit = (node: ts.Node) => {
      // Collect handler method patterns
      if (ts.isMethodDeclaration(node) && node.name) {
        const methodName = node.name.getText();
        if (
          ['execute', 'handle', 'process', 'run'].some((prefix) => methodName.startsWith(prefix))
        ) {
          const variant = methodName.match(/^(execute|handle|process|run)/)?.[1] || 'unknown';
          this.addPattern(this.handlerPatterns, variant, {
            file: filePath,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            pattern: 'handlerMethod',
            variant,
            context: methodName,
          });
        }
      }

      // Collect schema patterns (discriminatedUnion, directEnum)
      if (ts.isCallExpression(node)) {
        const text = node.expression.getText();
        if (text.includes('discriminatedUnion')) {
          this.addPattern(this.schemaPatterns, 'discriminatedUnion', {
            file: filePath,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            pattern: 'schemaStructure',
            variant: 'discriminatedUnion',
          });
        } else if (text === 'z.enum') {
          this.addPattern(this.schemaPatterns, 'directEnum', {
            file: filePath,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            pattern: 'schemaStructure',
            variant: 'directEnum',
          });
        }
      }

      // Collect error handling patterns
      if (ts.isThrowStatement(node)) {
        this.addPattern(this.errorPatterns, 'throw', {
          file: filePath,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          pattern: 'errorHandling',
          variant: 'throw',
        });
      }

      // Collect response format patterns
      if (
        ts.isReturnStatement(node) &&
        node.expression &&
        ts.isObjectLiteralExpression(node.expression)
      ) {
        const responseProperty = node.expression.properties.find(
          (prop) => ts.isPropertyAssignment(prop) && prop.name.getText() === 'response'
        );
        if (responseProperty) {
          this.addPattern(this.responsePatterns, 'wrappedResponse', {
            file: filePath,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            pattern: 'responseFormat',
            variant: 'wrappedResponse',
            context: '{ response: {...} }',
          });
        }
      }

      // Collect naming convention patterns
      if (
        ts.isClassDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isVariableDeclaration(node)
      ) {
        const name = node.name?.getText();
        if (name) {
          const namingStyle = this.detectNamingStyle(name);
          this.addPattern(this.namingPatterns, namingStyle, {
            file: filePath,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            pattern: 'namingConvention',
            variant: namingStyle,
            context: name,
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  /**
   * Analyze handler method naming patterns
   */
  private async analyzeHandlerPattern(
    filePath: string,
    sourceFile: ts.SourceFile,
    context: AnalysisContext
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];

    // Only analyze handler files
    if (!filePath.includes('/handlers/') || filePath.endsWith('base.ts')) {
      return {
        dimension: 'handlerPattern',
        status: 'pass',
        issueCount: 0,
        issues: [],
        duration: Date.now() - startTime,
      };
    }

    const analysis = this.analyzePatternConsistency(this.handlerPatterns, 'handlerMethod');

    // Check if current file deviates from dominant pattern
    const currentFilePatterns = this.getFilePatterns(this.handlerPatterns, filePath);
    const dominantVariant = analysis.dominantVariant;

    for (const instance of currentFilePatterns) {
      if (instance.variant !== dominantVariant) {
        issues.push(
          this.createIssue(
            'handlerPattern',
            filePath,
            `Handler method uses "${instance.variant}" pattern, but ${analysis.dominantCount}/${analysis.totalInstances} handlers use "${dominantVariant}"`,
            {
              line: instance.line,
              severity: 'medium',
              suggestion: `Consider renaming to follow dominant pattern: "${instance.context?.replace(instance.variant, dominantVariant)}"`,
              autoFixable: false,
            }
          )
        );
      }
    }

    return {
      dimension: 'handlerPattern',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: issues.length,
      issues,
      metrics: {
        dominantPattern: analysis.dominantCount,
        totalInstances: analysis.totalInstances,
        consistencyScore: (analysis.dominantCount / analysis.totalInstances) * 100,
      },
      duration: Date.now() - startTime,
    };
  }

  /**
   * Analyze schema structure patterns
   */
  private async analyzeSchemaPattern(
    filePath: string,
    sourceFile: ts.SourceFile,
    context: AnalysisContext
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];

    // Only analyze schema files
    if (!filePath.includes('/schemas/') || filePath.endsWith('shared.ts')) {
      return {
        dimension: 'schemaPattern',
        status: 'pass',
        issueCount: 0,
        issues: [],
        duration: Date.now() - startTime,
      };
    }

    const analysis = this.analyzePatternConsistency(this.schemaPatterns, 'schemaStructure');

    // Check if current file deviates from dominant pattern
    const currentFilePatterns = this.getFilePatterns(this.schemaPatterns, filePath);
    const dominantVariant = analysis.dominantVariant;

    for (const instance of currentFilePatterns) {
      if (
        instance.variant !== dominantVariant &&
        analysis.dominantCount / analysis.totalInstances > 0.7
      ) {
        issues.push(
          this.createIssue(
            'schemaPattern',
            filePath,
            `Schema uses "${instance.variant}" pattern, but ${analysis.dominantCount}/${analysis.totalInstances} schemas use "${dominantVariant}"`,
            {
              line: instance.line,
              severity: 'low',
              suggestion: `Consider refactoring to use dominant pattern: "${dominantVariant}"`,
              autoFixable: false,
            }
          )
        );
      }
    }

    return {
      dimension: 'schemaPattern',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: issues.length,
      issues,
      metrics: {
        dominantPattern: analysis.dominantCount,
        totalInstances: analysis.totalInstances,
        consistencyScore: (analysis.dominantCount / analysis.totalInstances) * 100,
      },
      duration: Date.now() - startTime,
    };
  }

  /**
   * Analyze error handling patterns
   */
  private async analyzeErrorPattern(
    filePath: string,
    sourceFile: ts.SourceFile,
    context: AnalysisContext
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];

    const analysis = this.analyzePatternConsistency(this.errorPatterns, 'errorHandling');

    // Check if current file uses consistent error handling
    const currentFilePatterns = this.getFilePatterns(this.errorPatterns, filePath);
    const dominantVariant = analysis.dominantVariant;

    // Only flag if there's a clear dominant pattern (>80% consistency)
    if (analysis.dominantCount / analysis.totalInstances > 0.8) {
      for (const instance of currentFilePatterns) {
        if (instance.variant !== dominantVariant) {
          issues.push(
            this.createIssue(
              'errorPattern',
              filePath,
              `Error handling uses "${instance.variant}" pattern, but ${analysis.dominantCount}/${analysis.totalInstances} files use "${dominantVariant}"`,
              {
                line: instance.line,
                severity: 'low',
                suggestion: `Consider using dominant error pattern: "${dominantVariant}"`,
                autoFixable: false,
              }
            )
          );
        }
      }
    }

    return {
      dimension: 'errorPattern',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: issues.length,
      issues,
      metrics: {
        dominantPattern: analysis.dominantCount,
        totalInstances: analysis.totalInstances,
        consistencyScore: (analysis.dominantCount / analysis.totalInstances) * 100,
      },
      duration: Date.now() - startTime,
    };
  }

  /**
   * Analyze response format patterns
   */
  private async analyzeResponsePattern(
    filePath: string,
    sourceFile: ts.SourceFile,
    context: AnalysisContext
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];

    // Only analyze handler files
    if (!filePath.includes('/handlers/') || filePath.endsWith('base.ts')) {
      return {
        dimension: 'responsePattern',
        status: 'pass',
        issueCount: 0,
        issues: [],
        duration: Date.now() - startTime,
      };
    }

    const analysis = this.analyzePatternConsistency(this.responsePatterns, 'responseFormat');

    // Check if current file uses consistent response format
    const currentFilePatterns = this.getFilePatterns(this.responsePatterns, filePath);
    const dominantVariant = analysis.dominantVariant;

    // Response format should be highly consistent (>90%)
    if (analysis.dominantCount / analysis.totalInstances > 0.9) {
      for (const instance of currentFilePatterns) {
        if (instance.variant !== dominantVariant) {
          issues.push(
            this.createIssue(
              'responsePattern',
              filePath,
              `Response format deviates from project standard: ${analysis.dominantCount}/${analysis.totalInstances} files use "${dominantVariant}"`,
              {
                line: instance.line,
                severity: 'medium',
                suggestion: `Use standard response format: { response: { success: boolean, data?: any } }`,
                autoFixable: false,
              }
            )
          );
        }
      }
    }

    return {
      dimension: 'responsePattern',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: issues.length,
      issues,
      metrics: {
        dominantPattern: analysis.dominantCount,
        totalInstances: analysis.totalInstances,
        consistencyScore: (analysis.dominantCount / analysis.totalInstances) * 100,
      },
      duration: Date.now() - startTime,
    };
  }

  /**
   * Analyze naming convention patterns
   */
  private async analyzeNamingPattern(
    filePath: string,
    sourceFile: ts.SourceFile,
    context: AnalysisContext
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];

    const analysis = this.analyzePatternConsistency(this.namingPatterns, 'namingConvention');

    // Check if current file uses consistent naming
    const currentFilePatterns = this.getFilePatterns(this.namingPatterns, filePath);
    const dominantVariant = analysis.dominantVariant;

    // Only flag significant deviations (e.g., snake_case in a camelCase codebase)
    const fileVariantCounts = new Map<string, number>();
    for (const instance of currentFilePatterns) {
      fileVariantCounts.set(instance.variant, (fileVariantCounts.get(instance.variant) || 0) + 1);
    }

    // If file has multiple naming styles, flag it
    if (fileVariantCounts.size > 2) {
      const variants = Array.from(fileVariantCounts.keys()).join(', ');
      issues.push(
        this.createIssue(
          'namingPattern',
          filePath,
          `File uses ${fileVariantCounts.size} different naming conventions: ${variants}. Codebase standard is "${dominantVariant}"`,
          {
            severity: 'low',
            suggestion: `Standardize naming to "${dominantVariant}" for consistency`,
            autoFixable: false,
          }
        )
      );
    }

    return {
      dimension: 'namingPattern',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: issues.length,
      issues,
      metrics: {
        dominantPattern: analysis.dominantCount,
        totalInstances: analysis.totalInstances,
        consistencyScore: (analysis.dominantCount / analysis.totalInstances) * 100,
      },
      duration: Date.now() - startTime,
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Add pattern instance to collection
   */
  private addPattern(
    patternMap: Map<string, PatternInstance[]>,
    variant: string,
    instance: PatternInstance
  ): void {
    if (!patternMap.has(variant)) {
      patternMap.set(variant, []);
    }
    patternMap.get(variant)!.push(instance);
  }

  /**
   * Get all pattern instances for a specific file
   */
  private getFilePatterns(
    patternMap: Map<string, PatternInstance[]>,
    filePath: string
  ): PatternInstance[] {
    const patterns: PatternInstance[] = [];
    for (const instances of patternMap.values()) {
      patterns.push(...instances.filter((i) => i.file === filePath));
    }
    return patterns;
  }

  /**
   * Analyze pattern consistency across files
   */
  private analyzePatternConsistency(
    patternMap: Map<string, PatternInstance[]>,
    patternType: string
  ): PatternAnalysis {
    // Find dominant variant
    let dominantVariant = '';
    let dominantCount = 0;
    let totalInstances = 0;

    for (const [variant, instances] of patternMap.entries()) {
      totalInstances += instances.length;
      if (instances.length > dominantCount) {
        dominantCount = instances.length;
        dominantVariant = variant;
      }
    }

    // Find deviations
    const deviations: PatternInstance[] = [];
    for (const [variant, instances] of patternMap.entries()) {
      if (variant !== dominantVariant) {
        deviations.push(...instances);
      }
    }

    return {
      patternType,
      dominantVariant,
      dominantCount,
      totalInstances,
      variants: patternMap,
      deviations,
    };
  }

  /**
   * Detect naming style (camelCase, PascalCase, snake_case, etc.)
   */
  private detectNamingStyle(name: string): string {
    if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) return 'PascalCase';
    if (/^[a-z][a-zA-Z0-9]*$/.test(name)) return 'camelCase';
    if (/^[a-z][a-z0-9_]*$/.test(name)) return 'snake_case';
    if (/^[A-Z][A-Z0-9_]*$/.test(name)) return 'SCREAMING_SNAKE_CASE';
    if (/^[a-z][a-z0-9-]*$/.test(name)) return 'kebab-case';
    return 'mixed';
  }

  /**
   * Reset all collected patterns (useful for fresh analysis)
   */
  public reset(): void {
    this.handlerPatterns.clear();
    this.schemaPatterns.clear();
    this.errorPatterns.clear();
    this.responsePatterns.clear();
    this.namingPatterns.clear();
  }
}
