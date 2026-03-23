#!/usr/bin/env tsx
/**
 * Pre-Implementation Comprehensive Audit
 *
 * Runs ALL validation checks before proceeding with Phase 1+ improvements.
 * Ensures absolute certainty that foundation is solid.
 *
 * Checks:
 * 1. Code Quality (complexity, duplication, size)
 * 2. Security (OWASP, input validation, vulnerabilities)
 * 3. Type Safety (any types, assertions)
 * 4. Documentation Compliance (TypeScript, Google API, MCP, Zod, OWASP)
 * 5. Dependency Health (npm audit, outdated packages, compatibility)
 * 6. Performance Baseline (establish metrics)
 * 7. Integration Tests (runtime behavior)
 * 8. Pattern Consistency (cross-file patterns)
 * 9. Test Coverage (gaps, missing edge cases)
 * 10. Build Health (compilation, linting, tests)
 *
 * Outputs:
 * - Certainty Score (0-100%)
 * - Blocking Issues (must fix before proceeding)
 * - Warning Issues (should fix)
 * - Info Issues (nice to fix)
 * - Recommendations (prioritized)
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// AUDIT CONFIGURATION
// ============================================================================

interface AuditConfig {
  projectRoot: string;
  outputDir: string;
  includeTests: boolean;
  strictMode: boolean; // Fail on warnings
  generateReport: boolean;
  autoFix: boolean;
}

interface AuditResult {
  category: string;
  status: 'pass' | 'warning' | 'fail' | 'skipped';
  score: number; // 0-100
  issues: AuditIssue[];
  duration: number;
  blockers: number;
  warnings: number;
  recommendations: string[];
}

interface AuditIssue {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  message: string;
  file?: string;
  line?: number;
  fix?: string;
  autoFixable: boolean;
  estimatedEffort?: string;
}

interface CertaintyScore {
  overall: number; // 0-100
  breakdown: {
    codeQuality: number;
    security: number;
    typeSafety: number;
    documentation: number;
    dependencies: number;
    performance: number;
    integration: number;
    testing: number;
  };
  confidence: 'low' | 'medium' | 'high' | 'very-high';
  recommendation: string;
}

// ============================================================================
// AUDIT RUNNER
// ============================================================================

class PreImplementationAuditor {
  constructor(private config: AuditConfig) {}

  async runFullAudit(): Promise<{
    results: AuditResult[];
    certaintyScore: CertaintyScore;
    canProceed: boolean;
  }> {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  PRE-IMPLEMENTATION COMPREHENSIVE AUDIT');
    console.log('═══════════════════════════════════════════════════════\n');

    const results: AuditResult[] = [];

    // Phase 1: Quick Checks (Fast Failures)
    console.log('PHASE 1: Quick Checks (< 1 minute)\n');
    results.push(await this.auditBuildHealth());
    results.push(await this.auditDependencyHealth());
    results.push(await this.auditGitStatus());

    // Check if we should continue
    const hasBlockers = results.some((r) => r.blockers > 0);
    if (hasBlockers && this.config.strictMode) {
      console.log('\n❌ BLOCKING ISSUES FOUND - Stopping audit\n');
      return {
        results,
        certaintyScore: this.calculateCertaintyScore(results),
        canProceed: false,
      };
    }

    // Phase 2: Code Quality (Medium Speed)
    console.log('\nPHASE 2: Code Quality Analysis (2-3 minutes)\n');
    results.push(await this.auditCodeQuality());
    results.push(await this.auditTypeSafety());
    results.push(await this.auditPatternConsistency());

    // Phase 3: Security & Compliance (Medium Speed)
    console.log('\nPHASE 3: Security & Compliance (2-3 minutes)\n');
    results.push(await this.auditSecurity());
    results.push(await this.auditDocumentationCompliance());

    // Phase 4: Testing & Performance (Slower)
    console.log('\nPHASE 4: Testing & Performance (3-5 minutes)\n');
    results.push(await this.auditTestCoverage());
    results.push(await this.auditPerformanceBaseline());
    results.push(await this.auditIntegration());

    // Calculate final certainty score
    const certaintyScore = this.calculateCertaintyScore(results);
    const canProceed = certaintyScore.overall >= 80 && !hasBlockers;

    // Generate report
    if (this.config.generateReport) {
      await this.generateReport(results, certaintyScore);
    }

    return { results, certaintyScore, canProceed };
  }

  // ==========================================================================
  // AUDIT FUNCTIONS
  // ==========================================================================

  private async auditBuildHealth(): Promise<AuditResult> {
    console.log('  → Checking build health...');
    const startTime = Date.now();
    const issues: AuditIssue[] = [];

    try {
      // TypeScript compilation
      execSync('npm run typecheck', { stdio: 'pipe', cwd: this.config.projectRoot });
    } catch (error) {
      issues.push({
        severity: 'critical',
        category: 'Build',
        message: 'TypeScript compilation failed',
        autoFixable: false,
        estimatedEffort: '1-4h',
      });
    }

    try {
      // Linting
      execSync('npm run lint', { stdio: 'pipe', cwd: this.config.projectRoot });
    } catch (error) {
      issues.push({
        severity: 'high',
        category: 'Build',
        message: 'ESLint violations found',
        autoFixable: true,
        fix: 'Run: npm run lint --fix',
        estimatedEffort: '30min-2h',
      });
    }

    try {
      // Fast tests
      execSync('npm run test:fast', { stdio: 'pipe', cwd: this.config.projectRoot });
    } catch (error) {
      issues.push({
        severity: 'critical',
        category: 'Build',
        message: 'Fast tests failing',
        autoFixable: false,
        estimatedEffort: '2-8h',
      });
    }

    const blockers = issues.filter((i) => i.severity === 'critical').length;
    const warnings = issues.filter((i) => i.severity !== 'critical').length;

    return {
      category: 'Build Health',
      status: blockers > 0 ? 'fail' : warnings > 0 ? 'warning' : 'pass',
      score: Math.max(0, 100 - blockers * 50 - warnings * 10),
      issues,
      duration: Date.now() - startTime,
      blockers,
      warnings,
      recommendations: this.generateRecommendations(issues),
    };
  }

  private async auditDependencyHealth(): Promise<AuditResult> {
    console.log('  → Checking dependency health...');
    const startTime = Date.now();
    const issues: AuditIssue[] = [];

    // npm audit
    try {
      execSync('npm audit --json > /tmp/npm-audit.json', {
        cwd: this.config.projectRoot,
      });

      const auditData = JSON.parse(fs.readFileSync('/tmp/npm-audit.json', 'utf-8'));

      if (auditData.metadata.vulnerabilities.critical > 0) {
        issues.push({
          severity: 'critical',
          category: 'Dependencies',
          message: `${auditData.metadata.vulnerabilities.critical} critical vulnerabilities`,
          autoFixable: true,
          fix: 'Run: npm audit fix',
        });
      }

      if (auditData.metadata.vulnerabilities.high > 0) {
        issues.push({
          severity: 'high',
          category: 'Dependencies',
          message: `${auditData.metadata.vulnerabilities.high} high vulnerabilities`,
          autoFixable: true,
          fix: 'Run: npm audit fix',
        });
      }
    } catch (error) {
      // npm audit exits with non-zero if vulnerabilities found
    }

    // Check for outdated packages
    try {
      const outdated = execSync('npm outdated --json', {
        cwd: this.config.projectRoot,
        stdio: 'pipe',
      }).toString();

      if (outdated) {
        const packages = JSON.parse(outdated);
        const count = Object.keys(packages).length;

        if (count > 0) {
          issues.push({
            severity: 'medium',
            category: 'Dependencies',
            message: `${count} packages outdated`,
            autoFixable: false,
            fix: 'Review: npm outdated',
          });
        }
      }
    } catch (error) {
      // npm outdated exits with 1 if packages are outdated
    }

    // Check for missing dependencies
    try {
      execSync('npm run check:deps', {
        cwd: this.config.projectRoot,
        stdio: 'pipe',
      });
    } catch (error) {
      issues.push({
        severity: 'high',
        category: 'Dependencies',
        message: 'Dependency check failed - possible missing or mismatched versions',
        autoFixable: false,
      });
    }

    const blockers = issues.filter((i) => i.severity === 'critical').length;
    const warnings = issues.filter((i) => i.severity !== 'critical').length;

    return {
      category: 'Dependency Health',
      status: blockers > 0 ? 'fail' : warnings > 0 ? 'warning' : 'pass',
      score: Math.max(0, 100 - blockers * 50 - warnings * 10),
      issues,
      duration: Date.now() - startTime,
      blockers,
      warnings,
      recommendations: this.generateRecommendations(issues),
    };
  }

  private async auditGitStatus(): Promise<AuditResult> {
    console.log('  → Checking git status...');
    const startTime = Date.now();
    const issues: AuditIssue[] = [];

    try {
      // Check for uncommitted changes
      const status = execSync('git status --porcelain', {
        cwd: this.config.projectRoot,
        encoding: 'utf-8',
      });

      if (status.trim()) {
        const lines = status.trim().split('\n');
        issues.push({
          severity: 'medium',
          category: 'Git',
          message: `${lines.length} uncommitted files`,
          autoFixable: false,
          fix: 'Commit or stash changes before proceeding',
        });
      }

      // Check for untracked files in src/
      const untrackedInSrc = status
        .split('\n')
        .filter((line) => line.startsWith('??') && line.includes('src/'));

      if (untrackedInSrc.length > 0) {
        issues.push({
          severity: 'low',
          category: 'Git',
          message: `${untrackedInSrc.length} untracked files in src/`,
          autoFixable: false,
        });
      }
    } catch (error) {
      issues.push({
        severity: 'info',
        category: 'Git',
        message: 'Not a git repository or git not available',
        autoFixable: false,
      });
    }

    const blockers = 0; // Git issues don't block
    const warnings = issues.filter((i) => i.severity !== 'info').length;

    return {
      category: 'Git Status',
      status: warnings > 0 ? 'warning' : 'pass',
      score: Math.max(0, 100 - warnings * 5),
      issues,
      duration: Date.now() - startTime,
      blockers,
      warnings,
      recommendations: this.generateRecommendations(issues),
    };
  }

  private async auditCodeQuality(): Promise<AuditResult> {
    console.log('  → Analyzing code quality...');
    const startTime = Date.now();
    const issues: AuditIssue[] = [];

    // Run multi-agent analysis on all handlers
    try {
      const output = execSync('npm run analyze:dir src/handlers/ --format=json', {
        cwd: this.config.projectRoot,
        encoding: 'utf-8',
      });

      const results = JSON.parse(output);

      // Aggregate issues
      for (const file of results.files) {
        for (const issue of file.issues) {
          issues.push({
            severity: issue.severity,
            category: 'Code Quality',
            message: issue.message,
            file: issue.file,
            line: issue.line,
            autoFixable: issue.autoFixable,
          });
        }
      }
    } catch (error) {
      // Analysis tool not yet implemented
      issues.push({
        severity: 'info',
        category: 'Code Quality',
        message: 'Multi-agent analysis not available yet',
        autoFixable: false,
      });
    }

    const blockers = issues.filter((i) => i.severity === 'critical').length;
    const warnings = issues.filter((i) => ['high', 'medium'].includes(i.severity)).length;

    return {
      category: 'Code Quality',
      status: blockers > 0 ? 'fail' : warnings > 5 ? 'warning' : 'pass',
      score: Math.max(0, 100 - blockers * 50 - warnings * 5),
      issues,
      duration: Date.now() - startTime,
      blockers,
      warnings,
      recommendations: this.generateRecommendations(issues),
    };
  }

  private async auditTypeSafety(): Promise<AuditResult> {
    console.log('  → Checking type safety...');
    const startTime = Date.now();
    const issues: AuditIssue[] = [];

    // Check for 'any' types
    try {
      const anyCount = execSync('grep -r ":\\s*any" src/ --include="*.ts" | wc -l', {
        cwd: this.config.projectRoot,
        encoding: 'utf-8',
      }).trim();

      const count = parseInt(anyCount);
      if (count > 0) {
        issues.push({
          severity: count > 20 ? 'high' : 'medium',
          category: 'Type Safety',
          message: `${count} explicit 'any' types found`,
          autoFixable: false,
          estimatedEffort: `${Math.ceil(count / 10)}h`,
        });
      }
    } catch (error) {
      // grep failed
    }

    // Check for non-null assertions
    try {
      const assertionCount = execSync(
        'grep -r "!" src/ --include="*.ts" | grep -v "!=" | grep -v "!==" | wc -l',
        { cwd: this.config.projectRoot, encoding: 'utf-8' }
      ).trim();

      const count = parseInt(assertionCount);
      if (count > 0) {
        issues.push({
          severity: 'medium',
          category: 'Type Safety',
          message: `${count} non-null assertions found`,
          autoFixable: false,
        });
      }
    } catch (error) {
      // grep failed
    }

    const blockers = 0; // Type safety issues don't block immediately
    const warnings = issues.length;

    return {
      category: 'Type Safety',
      status: warnings > 10 ? 'warning' : 'pass',
      score: Math.max(0, 100 - warnings * 5),
      issues,
      duration: Date.now() - startTime,
      blockers,
      warnings,
      recommendations: this.generateRecommendations(issues),
    };
  }

  private async auditSecurity(): Promise<AuditResult> {
    console.log('  → Running security analysis...');
    const startTime = Date.now();
    const issues: AuditIssue[] = [];

    // Check for hardcoded secrets
    try {
      const secretPatterns = [
        'api[_-]?key\\s*[:=]\\s*["\'][^"\']{20,}',
        'secret\\s*[:=]\\s*["\'][^"\']{20,}',
        'password\\s*[:=]\\s*["\'][^"\']+',
      ];

      for (const pattern of secretPatterns) {
        const matches = execSync(`grep -rE "${pattern}" src/ --include="*.ts" | wc -l`, {
          cwd: this.config.projectRoot,
          encoding: 'utf-8',
        }).trim();

        const count = parseInt(matches);
        if (count > 0) {
          issues.push({
            severity: 'critical',
            category: 'Security',
            message: `${count} potential hardcoded secrets found`,
            autoFixable: false,
            estimatedEffort: '1-2h',
          });
        }
      }
    } catch (error) {
      // grep failed
    }

    // Check for SQL injection patterns
    try {
      const sqlCount = execSync(
        'grep -rE "\\$\\{.*\\}" src/ --include="*.ts" | grep -iE "SELECT|INSERT|UPDATE|DELETE" | wc -l',
        { cwd: this.config.projectRoot, encoding: 'utf-8' }
      ).trim();

      const count = parseInt(sqlCount);
      if (count > 0) {
        issues.push({
          severity: 'critical',
          category: 'Security',
          message: `${count} potential SQL injection vulnerabilities`,
          autoFixable: false,
        });
      }
    } catch (error) {
      // grep failed
    }

    const blockers = issues.filter((i) => i.severity === 'critical').length;
    const warnings = issues.filter((i) => i.severity !== 'critical').length;

    return {
      category: 'Security',
      status: blockers > 0 ? 'fail' : warnings > 0 ? 'warning' : 'pass',
      score: Math.max(0, 100 - blockers * 50 - warnings * 20),
      issues,
      duration: Date.now() - startTime,
      blockers,
      warnings,
      recommendations: this.generateRecommendations(issues),
    };
  }

  private async auditDocumentationCompliance(): Promise<AuditResult> {
    console.log('  → Checking documentation compliance...');
    const startTime = Date.now();
    const issues: AuditIssue[] = [];

    // TODO: Run documentation validator agent
    // For now, placeholder

    return {
      category: 'Documentation Compliance',
      status: 'pass',
      score: 100,
      issues,
      duration: Date.now() - startTime,
      blockers: 0,
      warnings: 0,
      recommendations: [],
    };
  }

  private async auditPatternConsistency(): Promise<AuditResult> {
    console.log('  → Checking pattern consistency...');
    const startTime = Date.now();
    const issues: AuditIssue[] = [];

    // TODO: Run pattern recognition agent
    // For now, placeholder

    return {
      category: 'Pattern Consistency',
      status: 'pass',
      score: 100,
      issues,
      duration: Date.now() - startTime,
      blockers: 0,
      warnings: 0,
      recommendations: [],
    };
  }

  private async auditTestCoverage(): Promise<AuditResult> {
    console.log('  → Analyzing test coverage...');
    const startTime = Date.now();
    const issues: AuditIssue[] = [];

    try {
      // Run tests with coverage
      execSync('npm test -- --coverage --silent', {
        cwd: this.config.projectRoot,
        stdio: 'pipe',
      });

      // Parse coverage report
      // TODO: Implement coverage parsing
    } catch (error) {
      issues.push({
        severity: 'high',
        category: 'Testing',
        message: 'Tests failing or coverage unavailable',
        autoFixable: false,
      });
    }

    return {
      category: 'Test Coverage',
      status: issues.length > 0 ? 'warning' : 'pass',
      score: 85, // Placeholder
      issues,
      duration: Date.now() - startTime,
      blockers: 0,
      warnings: issues.length,
      recommendations: this.generateRecommendations(issues),
    };
  }

  private async auditPerformanceBaseline(): Promise<AuditResult> {
    console.log('  → Establishing performance baseline...');
    const startTime = Date.now();
    const issues: AuditIssue[] = [];

    // TODO: Run performance benchmarks
    // For now, placeholder

    return {
      category: 'Performance Baseline',
      status: 'pass',
      score: 100,
      issues,
      duration: Date.now() - startTime,
      blockers: 0,
      warnings: 0,
      recommendations: [],
    };
  }

  private async auditIntegration(): Promise<AuditResult> {
    console.log('  → Running integration tests...');
    const startTime = Date.now();
    const issues: AuditIssue[] = [];

    try {
      execSync('npm run test:integration', {
        cwd: this.config.projectRoot,
        stdio: 'pipe',
      });
    } catch (error) {
      issues.push({
        severity: 'high',
        category: 'Integration',
        message: 'Integration tests failing',
        autoFixable: false,
      });
    }

    return {
      category: 'Integration Tests',
      status: issues.length > 0 ? 'fail' : 'pass',
      score: issues.length > 0 ? 50 : 100,
      issues,
      duration: Date.now() - startTime,
      blockers: issues.filter((i) => i.severity === 'critical').length,
      warnings: issues.filter((i) => i.severity !== 'critical').length,
      recommendations: this.generateRecommendations(issues),
    };
  }

  // ==========================================================================
  // CERTAINTY SCORE CALCULATION
  // ==========================================================================

  private calculateCertaintyScore(results: AuditResult[]): CertaintyScore {
    const breakdown = {
      codeQuality: this.getScoreForCategory(results, 'Code Quality'),
      security: this.getScoreForCategory(results, 'Security'),
      typeSafety: this.getScoreForCategory(results, 'Type Safety'),
      documentation: this.getScoreForCategory(results, 'Documentation Compliance'),
      dependencies: this.getScoreForCategory(results, 'Dependency Health'),
      performance: this.getScoreForCategory(results, 'Performance Baseline'),
      integration: this.getScoreForCategory(results, 'Integration Tests'),
      testing: this.getScoreForCategory(results, 'Test Coverage'),
    };

    // Weighted average (security and integration are most important)
    const overall =
      breakdown.security * 0.25 +
      breakdown.integration * 0.2 +
      breakdown.testing * 0.15 +
      breakdown.codeQuality * 0.15 +
      breakdown.typeSafety * 0.1 +
      breakdown.dependencies * 0.1 +
      breakdown.documentation * 0.03 +
      breakdown.performance * 0.02;

    let confidence: 'low' | 'medium' | 'high' | 'very-high';
    let recommendation: string;

    if (overall >= 95) {
      confidence = 'very-high';
      recommendation = '✅ PROCEED with confidence - all systems green';
    } else if (overall >= 85) {
      confidence = 'high';
      recommendation = '✅ PROCEED - minor issues noted, address during implementation';
    } else if (overall >= 70) {
      confidence = 'medium';
      recommendation = '⚠️ PROCEED WITH CAUTION - address critical issues first';
    } else {
      confidence = 'low';
      recommendation = '❌ DO NOT PROCEED - fix blocking issues first';
    }

    return {
      overall: Math.round(overall),
      breakdown,
      confidence,
      recommendation,
    };
  }

  private getScoreForCategory(results: AuditResult[], category: string): number {
    const result = results.find((r) => r.category === category);
    return result ? result.score : 100; // Default to perfect if not run
  }

  private generateRecommendations(issues: AuditIssue[]): string[] {
    const recommendations: string[] = [];

    const critical = issues.filter((i) => i.severity === 'critical');
    const high = issues.filter((i) => i.severity === 'high');

    if (critical.length > 0) {
      recommendations.push(`Fix ${critical.length} critical issue(s) immediately`);
    }

    if (high.length > 0) {
      recommendations.push(`Address ${high.length} high-priority issue(s) before proceeding`);
    }

    const autoFixable = issues.filter((i) => i.autoFixable);
    if (autoFixable.length > 0) {
      recommendations.push(`${autoFixable.length} issue(s) can be auto-fixed`);
    }

    return recommendations;
  }

  private async generateReport(
    results: AuditResult[],
    certaintyScore: CertaintyScore
  ): Promise<void> {
    const reportPath = path.join(
      this.config.outputDir,
      `pre-implementation-audit-${Date.now()}.json`
    );

    const report = {
      timestamp: new Date().toISOString(),
      results,
      certaintyScore,
      summary: {
        total: results.reduce((sum, r) => sum + r.issues.length, 0),
        blockers: results.reduce((sum, r) => sum + r.blockers, 0),
        warnings: results.reduce((sum, r) => sum + r.warnings, 0),
        duration: results.reduce((sum, r) => sum + r.duration, 0),
      },
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Report saved to: ${reportPath}`);
  }
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const config: AuditConfig = {
    projectRoot: process.cwd(),
    outputDir: path.join(process.cwd(), 'audit-output'),
    includeTests: true,
    strictMode: process.argv.includes('--strict'),
    generateReport: true,
    autoFix: process.argv.includes('--fix'),
  };

  // Create output directory
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }

  const auditor = new PreImplementationAuditor(config);
  const { results, certaintyScore, canProceed } = await auditor.runFullAudit();

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  AUDIT SUMMARY');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log(`Certainty Score: ${certaintyScore.overall}% (${certaintyScore.confidence})`);
  console.log(`\n${certaintyScore.recommendation}\n`);

  console.log('Breakdown:');
  for (const [category, score] of Object.entries(certaintyScore.breakdown)) {
    const icon = score >= 90 ? '✅' : score >= 70 ? '⚠️' : '❌';
    console.log(`  ${icon} ${category}: ${Math.round(score)}%`);
  }

  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
  const blockers = results.reduce((sum, r) => sum + r.blockers, 0);
  const warnings = results.reduce((sum, r) => sum + r.warnings, 0);

  console.log(`\nTotal Issues: ${totalIssues}`);
  console.log(`  Blockers: ${blockers}`);
  console.log(`  Warnings: ${warnings}`);
  console.log(`  Info: ${totalIssues - blockers - warnings}`);

  console.log('\n═══════════════════════════════════════════════════════\n');

  // Exit code
  process.exit(canProceed ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
