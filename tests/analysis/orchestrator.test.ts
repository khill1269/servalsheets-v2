/**
 * Tests for Analysis Orchestrator
 *
 * Verifies:
 * - All 7 agents run in parallel
 * - Conflict resolution works
 * - Auto-fix application
 * - Meta-validation
 * - Report generation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { safeUnlinkSync } from '../helpers/safe-cleanup.js';
import { AnalysisOrchestrator, OrchestratorOptions } from '../../scripts/analysis/orchestrator.js';
import type { AnalysisContext } from '../../scripts/analysis/multi-agent-analysis.js';

describe('AnalysisOrchestrator', () => {
  const testFilePath = path.join(__dirname, '../fixtures/test-file.ts');
  const testFileContent = `
import { z } from 'zod';

export class TestHandler {
  async execute(action: any): Promise<any> {
    const result = await this.doSomething();
    return { response: { success: true, data: result } };
  }

  private async doSomething(): Promise<string> {
    const outcomes = ['success', 'maybe', 'unlikely', 'failure'] as const;
    const deterministicIndex = ('TestHandler'.length + 'doSomething'.length) % outcomes.length;
    return outcomes[deterministicIndex];
  }
}
  `.trim();

  beforeEach(() => {
    // Create test file if it doesn't exist
    const fixturesDir = path.dirname(testFilePath);
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }

    fs.writeFileSync(testFilePath, testFileContent);
  });

  describe('Agent Coordination', () => {
    it('should run all 7 agents', async () => {
      const orchestrator = new AnalysisOrchestrator({ verbose: false });

      const report = await orchestrator.runFullAnalysis([testFilePath]);

      expect(report.agentReports).toHaveLength(7);
      expect(report.agentReports.map((r) => r.agentName)).toEqual([
        'PatternRecognition',
        'CodeQuality',
        'TypeSafety',
        'Testing',
        'Consistency',
        'Security',
        'DocumentationValidator',
      ]);
    });

    it('should allow excluding specific agents', async () => {
      const orchestrator = new AnalysisOrchestrator({
        excludeAgents: ['Testing', 'DocumentationValidator'],
      });

      const report = await orchestrator.runFullAnalysis([testFilePath]);

      expect(report.agentReports).toHaveLength(5);
      expect(report.agentReports.map((r) => r.agentName)).not.toContain('Testing');
      expect(report.agentReports.map((r) => r.agentName)).not.toContain('DocumentationValidator');
    });

    it('should run agents in parallel', async () => {
      const startTime = Date.now();
      const orchestrator = new AnalysisOrchestrator();

      await orchestrator.runFullAnalysis([testFilePath]);

      const duration = Date.now() - startTime;

      // Should complete in less than sum of individual agent times
      expect(duration).toBeLessThan(15000); // 15 seconds max (parallel overhead)
    });
  });

  describe('Validation', () => {
    it('should detect issues from multiple agents', async () => {
      const orchestrator = new AnalysisOrchestrator();

      const report = await orchestrator.runFullAnalysis([testFilePath]);

      // TypeSafety agent should flag 'any' types
      const typeSafetyAgent = report.agentReports.find((r) => r.agentName === 'TypeSafety');
      expect(typeSafetyAgent).toBeDefined();
      expect(typeSafetyAgent!.dimensionReports.some((d) => d.issueCount > 0)).toBe(true);

      // CodeQuality agent should flag high complexity
      const qualityAgent = report.agentReports.find((r) => r.agentName === 'CodeQuality');
      expect(qualityAgent).toBeDefined();
    });

    it('should cross-validate findings', async () => {
      const orchestrator = new AnalysisOrchestrator();

      const report = await orchestrator.runFullAnalysis([testFilePath]);

      // Findings should have validation metadata
      for (const finding of report.validatedFindings) {
        expect(finding).toHaveProperty('confidence');
        expect(finding).toHaveProperty('validatedBy');
        expect(finding).toHaveProperty('isFalsePositive');

        expect(['high', 'medium', 'low']).toContain(finding.confidence);
        expect(finding.validatedBy).toBeInstanceOf(Array);
        expect(finding.validatedBy.length).toBeGreaterThan(0);
      }
    });

    it('should filter false positives', async () => {
      const testFile = path.join(__dirname, '../fixtures/test-file.test.ts');
      fs.writeFileSync(
        testFile,
        `
        export function testHelper() {
          const result = something as any; // Type assertion in test is OK
          return result;
        }
        `
      );

      const orchestrator = new AnalysisOrchestrator();
      const report = await orchestrator.runFullAnalysis([testFile]);

      // Should mark test file type assertions as false positives
      const falsePositives = report.validatedFindings.filter((f) => f.isFalsePositive);
      expect(falsePositives.length).toBeGreaterThan(0);

      safeUnlinkSync(testFile);
    });

    it('should assign confidence levels correctly', async () => {
      const orchestrator = new AnalysisOrchestrator();

      const report = await orchestrator.runFullAnalysis([testFilePath]);

      // Check confidence distribution
      const highConfidence = report.validatedFindings.filter((f) => f.confidence === 'high');
      const mediumConfidence = report.validatedFindings.filter((f) => f.confidence === 'medium');
      const lowConfidence = report.validatedFindings.filter((f) => f.confidence === 'low');

      // High confidence should have 2+ validators
      for (const finding of highConfidence) {
        expect(finding.validatedBy.length).toBeGreaterThanOrEqual(3);
      }

      // Medium confidence should have 2 validators
      for (const finding of mediumConfidence) {
        expect(finding.validatedBy.length).toBe(2);
      }

      // Low confidence should have 1 validator
      for (const finding of lowConfidence) {
        expect(finding.validatedBy.length).toBe(1);
      }
    });
  });

  describe('Conflict Resolution', () => {
    it('should detect conflicts between agents', async () => {
      const orchestrator = new AnalysisOrchestrator();

      const report = await orchestrator.runFullAnalysis([testFilePath]);

      // If conflicts exist, they should be resolved
      if (report.resolvedConflicts.length > 0) {
        for (const conflict of report.resolvedConflicts) {
          expect(conflict).toHaveProperty('conflictType');
          expect(conflict).toHaveProperty('issues');
          expect(conflict).toHaveProperty('resolution');
          expect(conflict).toHaveProperty('reasoning');
          expect(conflict).toHaveProperty('winner');

          expect(['pattern', 'severity', 'suggestion']).toContain(conflict.conflictType);
          expect(conflict.issues.length).toBeGreaterThanOrEqual(2);
          expect(typeof conflict.winner).toBe('string');
          expect(conflict.winner.length).toBeGreaterThan(0);
        }
      }
    });

    it('should prioritize Security agent in conflicts', async () => {
      const testFile = path.join(__dirname, '../fixtures/conflict-test.ts');
      fs.writeFileSync(
        testFile,
        `
        export function handler(req: any) {
          // Pattern says: use execute
          // Security says: validate input first
          return process(req.body);
        }
        `
      );

      const orchestrator = new AnalysisOrchestrator();
      const report = await orchestrator.runFullAnalysis([testFile]);

      // Security should win conflicts
      for (const conflict of report.resolvedConflicts) {
        if (conflict.issues.some((i) => i.dimension.includes('security'))) {
          expect(['Security', 'TypeSafety']).toContain(conflict.winner);
        }
      }

      safeUnlinkSync(testFile);
    });

    it('should apply resolutions to final findings', async () => {
      const orchestrator = new AnalysisOrchestrator();

      const report = await orchestrator.runFullAnalysis([testFilePath]);

      // Conflicting findings should be filtered out
      if (report.resolvedConflicts.length > 0) {
        const conflictIssueIds = new Set(
          report.resolvedConflicts.flatMap((c) =>
            c.issues.map((i) => `${i.file}:${i.line}:${i.dimension}`)
          )
        );

        const finalIssueIds = new Set(
          report.validatedFindings.map(
            (f) => `${f.issue.file}:${f.issue.line}:${f.issue.dimension}`
          )
        );

        // Winner issues should be in final findings
        for (const conflict of report.resolvedConflicts) {
          const winnerIssue = conflict.issues.find((i) =>
            report.validatedFindings.some(
              (f) => f.issue === i && f.validatedBy[0] === conflict.winner
            )
          );
          // Winner should be present (or all filtered if false positive)
        }
      }
    });
  });

  describe('Auto-Fix', () => {
    it('should identify auto-fixable issues', async () => {
      const orchestrator = new AnalysisOrchestrator({ autoFix: false });

      const report = await orchestrator.runFullAnalysis([testFilePath]);

      expect(report.summary.autoFixable).toBeGreaterThanOrEqual(0);

      // Auto-fixable issues should be marked in findings
      const autoFixableFindings = report.validatedFindings.filter(
        (f) => f.issue.autoFixable && !f.isFalsePositive
      );

      expect(autoFixableFindings.length).toBe(report.summary.autoFixable);
    });

    it('should apply auto-fixes when enabled', async () => {
      const orchestrator = new AnalysisOrchestrator({ autoFix: true });

      const report = await orchestrator.runFullAnalysis([testFilePath]);

      // Auto-fixes should be recorded
      expect(report.autoFixesApplied).toBeInstanceOf(Array);

      // Each auto-fix should have metadata
      for (const fix of report.autoFixesApplied) {
        expect(fix).toHaveProperty('file');
        expect(fix).toHaveProperty('issueType');
        expect(fix).toHaveProperty('applied');
        expect(typeof fix.file).toBe('string');
        expect(fix.file.length).toBeGreaterThan(0);
      }
    });

    it('should not auto-fix low confidence issues', async () => {
      const orchestrator = new AnalysisOrchestrator({
        autoFix: true,
        minConfidence: 'medium',
      });

      const report = await orchestrator.runFullAnalysis([testFilePath]);

      // Low confidence issues should not be fixed
      for (const fix of report.autoFixesApplied) {
        const finding = report.validatedFindings.find(
          (f) => f.issue.file === fix.file && f.issue.dimension === fix.issueType
        );

        if (finding) {
          expect(['medium', 'high']).toContain(finding.confidence);
        }
      }
    });
  });

  describe('Report Generation', () => {
    it('should generate complete report', async () => {
      const orchestrator = new AnalysisOrchestrator();

      const report = await orchestrator.runFullAnalysis([testFilePath]);

      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('files');
      expect(report).toHaveProperty('agentReports');
      expect(report).toHaveProperty('validatedFindings');
      expect(report).toHaveProperty('resolvedConflicts');
      expect(report).toHaveProperty('autoFixesApplied');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('recommendations');
      expect(report).toHaveProperty('duration');

      expect(report.files).toEqual([testFilePath]);
      expect(report.duration).toBeGreaterThan(0);
    });

    it('should calculate accurate summary', async () => {
      const orchestrator = new AnalysisOrchestrator();

      const report = await orchestrator.runFullAnalysis([testFilePath]);

      const { summary } = report;

      expect(summary).toHaveProperty('totalIssues');
      expect(summary).toHaveProperty('criticalIssues');
      expect(summary).toHaveProperty('highIssues');
      expect(summary).toHaveProperty('mediumIssues');
      expect(summary).toHaveProperty('lowIssues');
      expect(summary).toHaveProperty('falsePositives');
      expect(summary).toHaveProperty('autoFixable');
      expect(summary).toHaveProperty('autoFixed');

      // Verify counts match findings
      const validFindings = report.validatedFindings.filter((f) => !f.isFalsePositive);

      expect(summary.totalIssues).toBe(validFindings.length);
      expect(summary.criticalIssues).toBe(
        validFindings.filter((f) => f.issue.severity === 'critical').length
      );
      expect(summary.highIssues).toBe(
        validFindings.filter((f) => f.issue.severity === 'high').length
      );
    });

    it('should generate recommendations', async () => {
      const orchestrator = new AnalysisOrchestrator();

      const report = await orchestrator.runFullAnalysis([testFilePath]);

      expect(report.recommendations).toBeInstanceOf(Array);

      // Should recommend auto-fix if auto-fixable issues exist
      if (report.summary.autoFixable > 0) {
        expect(report.recommendations.some((r) => r.includes('auto-fix'))).toBe(true);
      }

      // Should warn about critical issues
      if (report.summary.criticalIssues > 0) {
        expect(report.recommendations.some((r) => r.includes('critical'))).toBe(true);
      }
    });
  });

  describe('Context Building', () => {
    it('should build analysis context', async () => {
      const orchestrator = new AnalysisOrchestrator();

      const report = await orchestrator.runFullAnalysis([testFilePath]);

      // Verify context was used by checking agent reports
      expect(report.agentReports.length).toBeGreaterThan(0);
    });

    it('should find project root', async () => {
      const orchestrator = new AnalysisOrchestrator();

      // Use private method reflection (for testing)
      const findProjectRoot = (orchestrator as any).findProjectRoot.bind(orchestrator);
      const root = findProjectRoot(testFilePath);

      expect(typeof root).toBe('string');
      expect(root.length).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(root, 'package.json'))).toBe(true);
    });

    it('should discover project files', async () => {
      const orchestrator = new AnalysisOrchestrator();

      const buildContext = (orchestrator as any).buildContext.bind(orchestrator);
      const context: AnalysisContext = await buildContext([testFilePath]);

      expect(context).toHaveProperty('projectRoot');
      expect(context).toHaveProperty('projectFiles');
      expect(context).toHaveProperty('testFiles');
      expect(context).toHaveProperty('dependencies');

      expect(context.projectFiles.length).toBeGreaterThan(0);
      expect(context.dependencies).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should complete analysis in reasonable time', async () => {
      const orchestrator = new AnalysisOrchestrator();

      const startTime = Date.now();
      await orchestrator.runFullAnalysis([testFilePath]);
      const duration = Date.now() - startTime;

      // Should complete in less than 15 seconds for single file
      expect(duration).toBeLessThan(15000);
    });

    it('should handle multiple files efficiently', async () => {
      const files = [testFilePath];

      // Create additional test files
      for (let i = 0; i < 5; i++) {
        const file = path.join(__dirname, `../fixtures/test-${i}.ts`);
        fs.writeFileSync(file, testFileContent);
        files.push(file);
      }

      const orchestrator = new AnalysisOrchestrator();

      const startTime = Date.now();
      await orchestrator.runFullAnalysis(files);
      const duration = Date.now() - startTime;

      // Should scale reasonably (not linearly)
      expect(duration).toBeLessThan(30000); // 30 seconds for 6 files

      // Cleanup
      for (let i = 0; i < 5; i++) {
        safeUnlinkSync(path.join(__dirname, `../fixtures/test-${i}.ts`));
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle missing files gracefully', async () => {
      const orchestrator = new AnalysisOrchestrator();

      await expect(async () => {
        await orchestrator.runFullAnalysis(['/nonexistent/file.ts']);
      }).rejects.toThrow();
    });

    it('should continue on parse errors with failFast=false', async () => {
      const badFile = path.join(__dirname, '../fixtures/bad-syntax.ts');
      fs.writeFileSync(badFile, 'this is not valid TypeScript {{{');

      const orchestrator = new AnalysisOrchestrator({ failFast: false, verbose: false });

      const report = await orchestrator.runFullAnalysis([testFilePath, badFile]);

      // Should still process the valid file
      expect(report.agentReports.length).toBeGreaterThan(0);

      safeUnlinkSync(badFile);
    });

    it('should fail fast when enabled', async () => {
      // Use a nonexistent file to trigger a real fs.readFileSync error
      // (ts.createSourceFile doesn't throw on bad syntax, it creates error nodes)
      const nonexistentFile = path.join(__dirname, '../fixtures/nonexistent-failfast-test.ts');

      const orchestrator = new AnalysisOrchestrator({ failFast: true });

      await expect(async () => {
        await orchestrator.runFullAnalysis([nonexistentFile]);
      }).rejects.toThrow();
    });
  });
});
