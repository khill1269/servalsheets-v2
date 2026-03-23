/**
 * Report Generator Tests
 *
 * Tests report generation in multiple formats.
 */

import { describe, it, expect } from 'vitest';
import { ReportGenerator } from '../../scripts/analysis/report-generator.js';
import type { OrchestratorReport, AgentSummary } from '../../scripts/analysis/report-generator.js';
import type { AnalysisIssue } from '../../scripts/analysis/multi-agent-analysis.js';

describe('ReportGenerator', () => {
  const generator = new ReportGenerator();

  // Sample report data
  const sampleReport: OrchestratorReport = {
    timestamp: '2026-02-17T12:00:00Z',
    overallScore: 85,
    agents: [
      {
        name: 'CodeQualityAgent',
        status: 'pass',
        issues: [],
      },
      {
        name: 'SecurityAgent',
        status: 'warning',
        issues: [
          {
            dimension: 'inputValidation',
            severity: 'high',
            file: 'src/handlers/data.ts',
            line: 42,
            message: 'Missing input validation',
            autoFixable: false,
          },
        ],
      },
      {
        name: 'TypeSafetyAgent',
        status: 'fail',
        issues: [
          {
            dimension: 'anyTypes',
            severity: 'critical',
            file: 'src/services/google-api.ts',
            line: 100,
            message: 'Explicit any type usage',
            autoFixable: false,
          },
        ],
      },
    ] as AgentSummary[],
    issues: [
      {
        dimension: 'anyTypes',
        severity: 'critical',
        file: 'src/services/google-api.ts',
        line: 100,
        message: 'Explicit any type usage',
        autoFixable: false,
      },
      {
        dimension: 'inputValidation',
        severity: 'high',
        file: 'src/handlers/data.ts',
        line: 42,
        message: 'Missing input validation',
        autoFixable: false,
      },
      {
        dimension: 'importOrdering',
        severity: 'low',
        file: 'src/handlers/base.ts',
        line: 1,
        message: 'Imports not ordered',
        autoFixable: true,
      },
    ],
    autoFixesApplied: 5,
    duration: 1234,
  };

  describe('JSON Format', () => {
    it('should generate valid JSON', () => {
      const json = generator.generateReport(sampleReport, 'json');

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should include summary statistics', () => {
      const json = generator.generateReport(sampleReport, 'json');
      const parsed = JSON.parse(json);

      expect(parsed.summary).toBeDefined();
      expect(parsed.summary.score).toBe(85);
      expect(parsed.summary.critical).toBe(1);
      expect(parsed.summary.high).toBe(1);
      expect(parsed.summary.low).toBe(1);
      expect(parsed.summary.autoFixable).toBe(1);
    });

    it('should include agent summaries', () => {
      const json = generator.generateReport(sampleReport, 'json');
      const parsed = JSON.parse(json);

      expect(parsed.summary.agents).toHaveLength(3);
      expect(parsed.summary.agents[0].name).toBe('CodeQualityAgent');
      expect(parsed.summary.agents[1].status).toBe('warning');
      expect(parsed.summary.agents[2].issueCount).toBe(1);
    });

    it('should include all issues', () => {
      const json = generator.generateReport(sampleReport, 'json');
      const parsed = JSON.parse(json);

      expect(parsed.issues).toHaveLength(3);
      expect(parsed.issues[0].severity).toBe('critical');
      expect(parsed.issues[1].severity).toBe('high');
      expect(parsed.issues[2].severity).toBe('low');
    });

    it('should include metadata', () => {
      const json = generator.generateReport(sampleReport, 'json');
      const parsed = JSON.parse(json);

      expect(parsed.autoFixesApplied).toBe(5);
      expect(parsed.duration).toBe(1234);
    });
  });

  describe('HTML Format', () => {
    it('should generate valid HTML', () => {
      const html = generator.generateReport(sampleReport, 'html');

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html');
      expect(html).toContain('</html>');
    });

    it('should include title and header', () => {
      const html = generator.generateReport(sampleReport, 'html');

      expect(html).toContain('Multi-Agent Analysis Report');
      expect(html).toContain('Overall Code Quality Score');
    });

    it('should display overall score', () => {
      const html = generator.generateReport(sampleReport, 'html');

      expect(html).toContain('85/100');
    });

    it('should include metrics table', () => {
      const html = generator.generateReport(sampleReport, 'html');

      expect(html).toContain('Critical');
      expect(html).toContain('High');
      expect(html).toContain('Medium');
      expect(html).toContain('Low');
      expect(html).toContain('Auto-fixable');
    });

    it('should include agent status table', () => {
      const html = generator.generateReport(sampleReport, 'html');

      expect(html).toContain('CodeQualityAgent');
      expect(html).toContain('SecurityAgent');
      expect(html).toContain('TypeSafetyAgent');
      expect(html).toContain('badge-pass');
      expect(html).toContain('badge-warning');
      expect(html).toContain('badge-fail');
    });

    it('should include issues table', () => {
      const html = generator.generateReport(sampleReport, 'html');

      expect(html).toContain('anyTypes');
      expect(html).toContain('inputValidation');
      expect(html).toContain('importOrdering');
      expect(html).toContain('google-api.ts');
    });

    it('should apply correct status colors', () => {
      const criticalReport = {
        ...sampleReport,
        overallScore: 40,
      };

      const html = generator.generateReport(criticalReport, 'html');

      // Should have red background for critical issues
      expect(html).toContain('#dc3545');
    });

    it('should handle auto-fixes display', () => {
      const html = generator.generateReport(sampleReport, 'html');

      expect(html).toContain('5 auto-fixes applied');
    });
  });

  describe('Markdown Format', () => {
    it('should generate valid Markdown', () => {
      const md = generator.generateReport(sampleReport, 'markdown');

      expect(md).toContain('# ');
      expect(md).toContain('## ');
      expect(md).toContain('| ');
    });

    it('should include header with score', () => {
      const md = generator.generateReport(sampleReport, 'markdown');

      expect(md).toContain('Multi-Agent Analysis Report');
      expect(md).toContain('Overall Score: 85/100');
    });

    it('should include metrics table', () => {
      const md = generator.generateReport(sampleReport, 'markdown');

      expect(md).toContain('| Metric | Count |');
      expect(md).toContain('| **Critical** | 1 |');
      expect(md).toContain('| **High** | 1 |');
      expect(md).toContain('| **Low** | 1 |');
      expect(md).toContain('| **Auto-fixable** | 1 |');
    });

    it('should include agent status table', () => {
      const md = generator.generateReport(sampleReport, 'markdown');

      expect(md).toContain('| Agent | Status | Issues |');
      expect(md).toContain('| CodeQualityAgent |');
      expect(md).toContain('| SecurityAgent |');
      expect(md).toContain('| TypeSafetyAgent |');
    });

    it('should use emoji status indicators', () => {
      const md = generator.generateReport(sampleReport, 'markdown');

      expect(md).toMatch(/[✅⚠️❌]/);
    });

    it('should include critical issues section', () => {
      const md = generator.generateReport(sampleReport, 'markdown');

      expect(md).toContain('## ❌ Critical Issues');
      expect(md).toContain('anyTypes');
      expect(md).toContain('google-api.ts');
    });

    it('should include high priority issues section', () => {
      const md = generator.generateReport(sampleReport, 'markdown');

      expect(md).toContain('## ⚠️ High Priority Issues');
      expect(md).toContain('inputValidation');
    });

    it('should include auto-fix instructions', () => {
      const md = generator.generateReport(sampleReport, 'markdown');

      expect(md).toContain('## 🔧 Auto-fixable Issues');
      expect(md).toContain('npm run analyze:fix');
    });

    it('should include recommendations section', () => {
      const md = generator.generateReport(sampleReport, 'markdown');

      expect(md).toContain('## 💡 Recommendations');
      expect(md).toContain('Address');
      expect(md).toContain('critical issue');
    });

    it('should show auto-fixes applied', () => {
      const md = generator.generateReport(sampleReport, 'markdown');

      expect(md).toContain('## ✅ Auto-fixes Applied');
      expect(md).toContain('5');
    });

    it('should limit high priority issues display', () => {
      // Create report with 15 high priority issues
      const manyIssuesReport = {
        ...sampleReport,
        issues: [
          ...sampleReport.issues,
          ...Array.from({ length: 15 }, (_, i) => ({
            dimension: `issue${i}`,
            severity: 'high' as const,
            file: `file${i}.ts`,
            message: `High priority issue ${i}`,
            autoFixable: false,
          })),
        ],
      };

      const md = generator.generateReport(manyIssuesReport, 'markdown');

      // Should show "+ X more high priority issues"
      expect(md).toContain('more high priority issues');
    });
  });

  describe('Edge Cases', () => {
    it('should handle report with no issues', () => {
      const cleanReport: OrchestratorReport = {
        timestamp: '2026-02-17T12:00:00Z',
        overallScore: 100,
        agents: [
          {
            name: 'CodeQualityAgent',
            status: 'pass',
            issues: [],
          },
        ] as AgentSummary[],
        issues: [],
        autoFixesApplied: 0,
        duration: 100,
      };

      const json = generator.generateReport(cleanReport, 'json');
      const html = generator.generateReport(cleanReport, 'html');
      const md = generator.generateReport(cleanReport, 'markdown');

      expect(json).toBeDefined();
      expect(html).toContain('100/100');
      expect(md).toContain('✅');
    });

    it('should handle unknown format gracefully', () => {
      expect(() => {
        generator.generateReport(sampleReport, 'xml' as any);
      }).toThrow('Unknown format');
    });

    it('should handle very large reports', () => {
      const largeReport: OrchestratorReport = {
        ...sampleReport,
        issues: Array.from({ length: 1000 }, (_, i) => ({
          dimension: 'test',
          severity: 'low' as const,
          file: `file${i}.ts`,
          message: `Issue ${i}`,
          autoFixable: false,
        })),
      };

      const html = generator.generateReport(largeReport, 'html');

      // HTML should limit display to 50 issues
      expect(html).toContain('+ ');
      expect(html).toContain('more issues');
    });
  });

  describe('Format Consistency', () => {
    it('should show same statistics in all formats', () => {
      const json = generator.generateReport(sampleReport, 'json');
      const html = generator.generateReport(sampleReport, 'html');
      const md = generator.generateReport(sampleReport, 'markdown');

      const jsonData = JSON.parse(json);

      // All formats should show same counts
      expect(html).toContain('1'); // critical
      expect(md).toContain('| **Critical** | 1 |');
      expect(jsonData.summary.critical).toBe(1);

      expect(html).toContain('85/100');
      expect(md).toContain('85/100');
      expect(jsonData.summary.score).toBe(85);
    });
  });
});
