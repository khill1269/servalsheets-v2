#!/usr/bin/env tsx
/**
 * Analysis Orchestrator
 *
 * Coordinates all 7 analysis agents:
 * 1. PatternRecognitionAgent - Cross-file consistency
 * 2. CodeQualityAgent - Complexity, duplication, file size
 * 3. TypeSafetyAgent - Any types, assertions, type casts
 * 4. TestingAgent - Coverage gaps, edge cases
 * 5. ConsistencyAgent - Naming, import ordering
 * 6. SecurityAgent - Input validation, injections
 * 7. DocumentationValidatorAgent - Best practice compliance
 *
 * Performs meta-validation, conflict resolution, and auto-fix application.
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import {
  AnalysisContext,
  AnalysisIssue,
  DimensionReport,
  MultiAgentReport,
} from './multi-agent-analysis.js';
import { PatternRecognitionAgent } from './agents/pattern-recognition-agent.js';
import { CodeQualityAgent } from './agents/code-quality-agent.js';
import { TypeSafetyAgent } from './agents/type-safety-agent.js';
import { TestingAgent } from './agents/testing-agent.js';
import { ConsistencyAgent } from './agents/consistency-agent.js';
import { SecurityAgent } from './agents/security-agent.js';
import { DocumentationValidatorAgent } from './agents/documentation-validator-agent.js';

// ============================================================================
// ORCHESTRATOR REPORT TYPES
// ============================================================================

export interface OrchestratorReport {
  timestamp: string;
  files: string[];
  agentReports: AgentReport[];
  validatedFindings: ValidatedFinding[];
  resolvedConflicts: ConflictResolution[];
  autoFixesApplied: AutoFix[];
  summary: {
    totalIssues: number;
    criticalIssues: number;
    highIssues: number;
    mediumIssues: number;
    lowIssues: number;
    falsePositives: number;
    autoFixable: number;
    autoFixed: number;
  };
  recommendations: string[];
  duration: number;
}

export interface AgentReport {
  agentName: string;
  status: 'pass' | 'warning' | 'fail';
  dimensionReports: DimensionReport[];
  duration: number;
}

export interface ValidatedFinding {
  issue: AnalysisIssue;
  confidence: 'high' | 'medium' | 'low';
  validatedBy: string[];
  isFalsePositive: boolean;
  conflictsWith?: string[];
}

export interface ConflictResolution {
  conflictType: 'pattern' | 'severity' | 'suggestion';
  issues: AnalysisIssue[];
  resolution: string;
  reasoning: string;
  winner: string;
}

export interface AutoFix {
  file: string;
  line?: number;
  originalCode: string;
  fixedCode: string;
  issueType: string;
  applied: boolean;
  error?: string;
}

// ============================================================================
// ORCHESTRATOR OPTIONS
// ============================================================================

export interface OrchestratorOptions {
  autoFix?: boolean;
  verbose?: boolean;
  failFast?: boolean;
  excludeAgents?: string[];
  minConfidence?: 'high' | 'medium' | 'low';
}

// ============================================================================
// ANALYSIS ORCHESTRATOR
// ============================================================================

export class AnalysisOrchestrator {
  private agents: Map<string, any> = new Map();
  private options: OrchestratorOptions;

  constructor(options: OrchestratorOptions = {}) {
    this.options = {
      autoFix: false,
      verbose: false,
      failFast: false,
      minConfidence: 'medium',
      ...options,
    };

    // Initialize all 7 agents
    this.agents.set('PatternRecognition', new PatternRecognitionAgent());
    this.agents.set('CodeQuality', new CodeQualityAgent());
    this.agents.set('TypeSafety', new TypeSafetyAgent());
    this.agents.set('Testing', new TestingAgent());
    this.agents.set('Consistency', new ConsistencyAgent());
    this.agents.set('Security', new SecurityAgent());
    this.agents.set('DocumentationValidator', new DocumentationValidatorAgent());

    // Remove excluded agents
    if (this.options.excludeAgents) {
      for (const agentName of this.options.excludeAgents) {
        this.agents.delete(agentName);
      }
    }
  }

  /**
   * Run full analysis on multiple files
   */
  async runFullAnalysis(files: string[]): Promise<OrchestratorReport> {
    const startTime = Date.now();

    if (this.options.verbose) {
      console.log(`\n🔍 Starting analysis of ${files.length} file(s)...`);
      console.log(`   Agents: ${Array.from(this.agents.keys()).join(', ')}\n`);
    }

    // Build analysis context
    const context = await this.buildContext(files);

    // Phase 1: Run all agents in parallel
    const agentReports = await this.runAgents(files, context);

    // Phase 2: Meta-audit validates findings
    const validatedFindings = this.validateFindings(agentReports);

    // Phase 3: Cross-agent conflict resolution
    const resolvedConflicts = this.resolveConflicts(validatedFindings);

    // Phase 4: Apply conflicts resolutions to validated findings
    const finalFindings = this.applyResolutions(validatedFindings, resolvedConflicts);

    // Phase 5: Auto-fix where possible
    let autoFixesApplied: AutoFix[] = [];
    if (this.options.autoFix) {
      autoFixesApplied = await this.applyAutoFixes(finalFindings);
    }

    // Generate report
    const report = this.generateReport(
      files,
      agentReports,
      finalFindings,
      resolvedConflicts,
      autoFixesApplied,
      Date.now() - startTime
    );

    return report;
  }

  /**
   * Phase 1: Run all agents in parallel
   */
  private async runAgents(files: string[], context: AnalysisContext): Promise<AgentReport[]> {
    const agentReports: AgentReport[] = [];

    for (const [agentName, agent] of this.agents.entries()) {
      if (this.options.verbose) {
        console.log(`  Running ${agentName}...`);
      }

      const agentStartTime = Date.now();
      const dimensionReports: DimensionReport[] = [];

      for (const filePath of files) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

          const reports = await agent.analyze(filePath, sourceFile, context);
          dimensionReports.push(...reports);
        } catch (error) {
          if (this.options.verbose) {
            console.error(`    Error analyzing ${filePath}:`, error);
          }

          if (this.options.failFast) {
            throw error;
          }
        }
      }

      // Determine agent status
      let status: 'pass' | 'warning' | 'fail' = 'pass';
      for (const report of dimensionReports) {
        if (report.status === 'fail') {
          status = 'fail';
          break;
        } else if (report.status === 'warning' && status === 'pass') {
          status = 'warning';
        }
      }

      agentReports.push({
        agentName,
        status,
        dimensionReports,
        duration: Date.now() - agentStartTime,
      });

      if (this.options.verbose) {
        const issueCount = dimensionReports.reduce((sum, r) => sum + r.issueCount, 0);
        console.log(
          `    ${agentName}: ${status.toUpperCase()} (${issueCount} issues, ${Date.now() - agentStartTime}ms)`
        );
      }
    }

    return agentReports;
  }

  /**
   * Phase 2: Validate findings (meta-audit)
   */
  private validateFindings(agentReports: AgentReport[]): ValidatedFinding[] {
    const validatedFindings: ValidatedFinding[] = [];

    // Collect all issues
    const allIssues: Array<{ issue: AnalysisIssue; agentName: string }> = [];
    for (const agentReport of agentReports) {
      for (const dimReport of agentReport.dimensionReports) {
        for (const issue of dimReport.issues) {
          allIssues.push({ issue, agentName: agentReport.agentName });
        }
      }
    }

    // Validate each issue
    for (const { issue, agentName } of allIssues) {
      const validation = this.validateIssue(issue, agentName, allIssues);
      validatedFindings.push(validation);
    }

    return validatedFindings;
  }

  /**
   * Validate a single issue
   */
  private validateIssue(
    issue: AnalysisIssue,
    reportingAgent: string,
    allIssues: Array<{ issue: AnalysisIssue; agentName: string }>
  ): ValidatedFinding {
    const validatedBy: string[] = [reportingAgent];
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    let isFalsePositive = false;
    const conflictsWith: string[] = [];

    // Cross-validation: Check if other agents report similar issue
    for (const { issue: otherIssue, agentName } of allIssues) {
      if (agentName === reportingAgent) continue;

      // Same file and similar line number
      if (
        issue.file === otherIssue.file &&
        issue.line &&
        otherIssue.line &&
        Math.abs(issue.line - otherIssue.line) < 5
      ) {
        // Similar issue type
        if (this.areSimilarIssues(issue, otherIssue)) {
          validatedBy.push(agentName);
        }
      }
    }

    // Confidence based on validation count
    if (validatedBy.length >= 3) {
      confidence = 'high';
    } else if (validatedBy.length === 2) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    // Check for known false positive patterns
    if (this.isFalsePositive(issue, reportingAgent)) {
      isFalsePositive = true;
      confidence = 'low';
    }

    // Check for conflicts
    for (const { issue: otherIssue, agentName } of allIssues) {
      if (agentName === reportingAgent) continue;

      if (this.areConflicting(issue, otherIssue)) {
        conflictsWith.push(agentName);
      }
    }

    return {
      issue,
      confidence,
      validatedBy,
      isFalsePositive,
      conflictsWith: conflictsWith.length > 0 ? conflictsWith : undefined,
    };
  }

  /**
   * Check if two issues are similar
   */
  private areSimilarIssues(issue1: AnalysisIssue, issue2: AnalysisIssue): boolean {
    // Same dimension
    if (issue1.dimension === issue2.dimension) return true;

    // Related dimensions
    const relatedDimensions: Record<string, string[]> = {
      complexity: ['fileSize', 'duplication'],
      anyTypes: ['typeAssertions', 'nonNullAssertions'],
      inputValidation: ['sqlInjection', 'pathTraversal', 'commandInjection'],
    };

    for (const [key, related] of Object.entries(relatedDimensions)) {
      if (
        (issue1.dimension === key && related.includes(issue2.dimension)) ||
        (issue2.dimension === key && related.includes(issue1.dimension))
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if issue is a known false positive
   */
  private isFalsePositive(issue: AnalysisIssue, agent: string): boolean {
    // Pattern: Type assertion in test files
    if (agent === 'TypeSafety' && issue.file.includes('.test.')) {
      return true;
    }

    // Pattern: High complexity in generated files
    if (agent === 'CodeQuality' && issue.file.includes('generated')) {
      return true;
    }

    // Pattern: Any types in external type definitions
    if (agent === 'TypeSafety' && issue.dimension === 'anyTypes' && issue.file.includes('.d.ts')) {
      return true;
    }

    return false;
  }

  /**
   * Check if two issues conflict
   */
  private areConflicting(issue1: AnalysisIssue, issue2: AnalysisIssue): boolean {
    // Example: Pattern agent says "use execute" but file uses "handle"
    // and Consistency agent says "consistent with similar files"
    if (issue1.dimension === 'patternConsistency' && issue2.dimension === 'namingConventions') {
      // Check if suggestions conflict
      if (issue1.suggestion && issue2.suggestion) {
        const pattern1 = issue1.suggestion.match(/use "(\w+)"/);
        const pattern2 = issue2.suggestion.match(/use "(\w+)"/);
        if (pattern1 && pattern2 && pattern1[1] !== pattern2[1]) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Phase 3: Resolve conflicts
   */
  private resolveConflicts(findings: ValidatedFinding[]): ConflictResolution[] {
    const resolutions: ConflictResolution[] = [];

    // Group conflicts
    const conflictGroups = new Map<string, ValidatedFinding[]>();

    for (const finding of findings) {
      if (finding.conflictsWith && finding.conflictsWith.length > 0) {
        const key = `${finding.issue.file}:${finding.issue.line}`;
        if (!conflictGroups.has(key)) {
          conflictGroups.set(key, []);
        }
        conflictGroups.get(key)!.push(finding);
      }
    }

    // Resolve each conflict group
    for (const [key, conflictingFindings] of conflictGroups) {
      const resolution = this.resolveConflictGroup(conflictingFindings);
      if (resolution) {
        resolutions.push(resolution);
      }
    }

    return resolutions;
  }

  /**
   * Resolve a group of conflicting findings
   */
  private resolveConflictGroup(findings: ValidatedFinding[]): ConflictResolution | null {
    if (findings.length < 2) return null;

    // Priority order: Security > TypeSafety > PatternRecognition > Others
    const priorityOrder = [
      'Security',
      'TypeSafety',
      'PatternRecognition',
      'CodeQuality',
      'Testing',
      'Consistency',
      'DocumentationValidator',
    ];

    // Sort by priority and confidence
    const sorted = [...findings].sort((a, b) => {
      const aPriority = priorityOrder.indexOf(a.validatedBy[0]);
      const bPriority = priorityOrder.indexOf(b.validatedBy[0]);

      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      // Then by confidence
      const confidenceOrder = { high: 0, medium: 1, low: 2 };
      return confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
    });

    const winner = sorted[0];
    const issues = findings.map((f) => f.issue);

    return {
      conflictType: 'pattern',
      issues,
      resolution: winner.issue.suggestion || 'Use highest priority finding',
      reasoning: `${winner.validatedBy[0]} has higher priority (${winner.confidence} confidence)`,
      winner: winner.validatedBy[0],
    };
  }

  /**
   * Phase 4: Apply resolutions to findings
   */
  private applyResolutions(
    findings: ValidatedFinding[],
    resolutions: ConflictResolution[]
  ): ValidatedFinding[] {
    const resolutionMap = new Map<string, ConflictResolution>();

    for (const resolution of resolutions) {
      for (const issue of resolution.issues) {
        const key = `${issue.file}:${issue.line}:${issue.dimension}`;
        resolutionMap.set(key, resolution);
      }
    }

    // Filter findings based on resolutions
    return findings.filter((finding) => {
      const key = `${finding.issue.file}:${finding.issue.line}:${finding.issue.dimension}`;
      const resolution = resolutionMap.get(key);

      if (!resolution) return true; // No conflict, include

      // Only include if this finding is the winner
      return finding.validatedBy[0] === resolution.winner;
    });
  }

  /**
   * Phase 5: Apply auto-fixes
   */
  private async applyAutoFixes(findings: ValidatedFinding[]): Promise<AutoFix[]> {
    const fixes: AutoFix[] = [];

    for (const finding of findings) {
      if (!finding.issue.autoFixable) continue;
      if (finding.confidence === 'low') continue; // Only fix medium+ confidence
      if (finding.isFalsePositive) continue;

      const fix = await this.generateAutoFix(finding);
      if (fix) {
        fixes.push(fix);
      }
    }

    return fixes;
  }

  /**
   * Generate auto-fix for an issue
   */
  private async generateAutoFix(finding: ValidatedFinding): Promise<AutoFix | null> {
    const { issue } = finding;

    // For now, just log what would be fixed
    // TODO: Implement actual AST transformations

    return {
      file: issue.file,
      line: issue.line,
      originalCode: '<placeholder>',
      fixedCode: '<placeholder>',
      issueType: issue.dimension,
      applied: false,
      error: 'Auto-fix generation not yet implemented',
    };
  }

  /**
   * Generate orchestrator report
   */
  private generateReport(
    files: string[],
    agentReports: AgentReport[],
    validatedFindings: ValidatedFinding[],
    resolvedConflicts: ConflictResolution[],
    autoFixesApplied: AutoFix[],
    duration: number
  ): OrchestratorReport {
    // Calculate summary
    const allIssues = validatedFindings.filter((f) => !f.isFalsePositive);
    const summary = {
      totalIssues: allIssues.length,
      criticalIssues: allIssues.filter((f) => f.issue.severity === 'critical').length,
      highIssues: allIssues.filter((f) => f.issue.severity === 'high').length,
      mediumIssues: allIssues.filter((f) => f.issue.severity === 'medium').length,
      lowIssues: allIssues.filter((f) => f.issue.severity === 'low').length,
      falsePositives: validatedFindings.filter((f) => f.isFalsePositive).length,
      autoFixable: allIssues.filter((f) => f.issue.autoFixable).length,
      autoFixed: autoFixesApplied.filter((f) => f.applied).length,
    };

    // Generate recommendations
    const recommendations: string[] = [];

    if (summary.criticalIssues > 0) {
      recommendations.push(
        `⚠️ ${summary.criticalIssues} critical issue(s) found - address immediately`
      );
    }

    if (summary.autoFixable > 0 && !this.options.autoFix) {
      recommendations.push(
        `${summary.autoFixable} issue(s) can be auto-fixed - run with --fix flag`
      );
    }

    if (resolvedConflicts.length > 0) {
      recommendations.push(`${resolvedConflicts.length} conflict(s) resolved automatically`);
    }

    if (summary.falsePositives > 0) {
      recommendations.push(`${summary.falsePositives} false positive(s) filtered out`);
    }

    return {
      timestamp: new Date().toISOString(),
      files,
      agentReports,
      validatedFindings,
      resolvedConflicts,
      autoFixesApplied,
      summary,
      recommendations,
      duration,
    };
  }

  /**
   * Build analysis context
   */
  private async buildContext(files: string[]): Promise<AnalysisContext> {
    const projectRoot = this.findProjectRoot(files[0]);

    // Find all project files
    const projectFiles = this.findAllFiles(projectRoot, '**/*.ts', ['node_modules', 'dist']);
    const testFiles = this.findAllFiles(projectRoot, '**/*.test.ts', ['node_modules', 'dist']);

    // Load package.json dependencies
    let dependencies: Record<string, string> = {};
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };
    }

    return {
      projectRoot,
      projectFiles,
      testFiles,
      dependencies,
    };
  }

  /**
   * Find project root (directory with package.json)
   */
  private findProjectRoot(startPath: string): string {
    let current = path.dirname(startPath);

    while (current !== path.dirname(current)) {
      if (fs.existsSync(path.join(current, 'package.json'))) {
        return current;
      }
      current = path.dirname(current);
    }

    return path.dirname(startPath);
  }

  /**
   * Find all files matching pattern
   */
  private findAllFiles(root: string, pattern: string, exclude: string[]): string[] {
    const files: string[] = [];

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip excluded directories
        if (exclude.some((ex) => fullPath.includes(ex))) {
          continue;
        }

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          // Simple pattern matching
          if (pattern === '**/*.ts' && fullPath.endsWith('.ts')) {
            files.push(fullPath);
          } else if (pattern === '**/*.test.ts' && fullPath.includes('.test.')) {
            files.push(fullPath);
          }
        }
      }
    };

    walk(root);
    return files;
  }
}
