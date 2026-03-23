#!/usr/bin/env tsx
/**
 * ServalSheets Improvement Synthesizer — Agent 3
 *
 * Reads probe-results.json + knowledge-enrichment.json, maps failures to source
 * files with line numbers, groups by severity, and outputs a prioritized
 * improvement plan to ~/.servalsheets/improvement-report.json.
 *
 * Usage:
 *   npx tsx scripts/improvement-synthesizer.ts [--verbose] [--json-only]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(homedir(), '.servalsheets');
const PROBE_FILE = join(OUT_DIR, 'probe-results.json');
const ENRICH_FILE = join(OUT_DIR, 'knowledge-enrichment.json');
const OUT_FILE = join(OUT_DIR, 'improvement-report.json');
const SRC = join(ROOT, 'src');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const JSON_ONLY = args.includes('--json-only');

// ── Colors ───────────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};
function log(msg: string) {
  if (!JSON_ONLY) process.stdout.write(msg + '\n');
}

// ── Source File Locator ───────────────────────────────────────────────────────
function grepSource(pattern: string): Array<{ file: string; line: number; text: string }> {
  try {
    const result = execSync(
      `grep -rn --include="*.ts" -E "${pattern.replace(/"/g, '\\"')}" "${SRC}" 2>/dev/null | head -20`,
      { encoding: 'utf8', timeout: 5000 }
    );
    return result
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(.+?):(\d+):(.*)$/);
        if (!m) return null;
        return {
          file: m[1]!.replace(ROOT + '/', ''),
          line: parseInt(m[2]!, 10),
          text: m[3]!.trim().slice(0, 120),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  } catch {
    return [];
  }
}

function _findHandlerFile(tool: string): string {
  const name = tool.replace('sheets_', '');
  const candidates = [
    `src/handlers/${name}.ts`,
    `src/handlers/${name}-actions/`,
    `src/handlers/analyze-actions/`,
  ];
  for (const c of candidates) {
    if (existsSync(join(ROOT, c))) return c;
  }
  return `src/handlers/${name}.ts`;
}

function findActionInSource(
  tool: string,
  action: string
): Array<{ file: string; line: number; text: string }> {
  // Search for the action case in handler switch
  const patterns = [
    `case '${action}'`,
    `action === '${action}'`,
    `'${action}':`,
    `handleAction.*${action}`,
  ];
  const results: Array<{ file: string; line: number; text: string }> = [];
  for (const p of patterns) {
    const hits = grepSource(p);
    results.push(...hits);
    if (hits.length > 0) break;
  }
  return results.slice(0, 3);
}

// ── Improvement Categorizer ───────────────────────────────────────────────────
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface Improvement {
  id: string;
  severity: Severity;
  tool: string;
  action: string;
  category:
    | 'auth'
    | 'fixture'
    | 'implementation'
    | 'performance'
    | 'best-practice'
    | 'schema'
    | 'flow';
  title: string;
  description: string;
  error?: string;
  sourceLocations: Array<{ file: string; line: number; text: string }>;
  docFindings: string[];
  suggestedFix: string;
  effort: 'trivial' | 'small' | 'medium' | 'large';
}

function classifyError(error: string | undefined): {
  category: Improvement['category'];
  severity: Severity;
} {
  if (!error) return { category: 'implementation', severity: 'low' };
  const e = error.toLowerCase();

  if (e.includes('unauthenticated') || e.includes('token'))
    return { category: 'auth', severity: 'critical' };
  if (e.includes('permission_denied')) return { category: 'auth', severity: 'high' };
  if (e.includes('invalid_argument') || e.includes('zod') || e.includes('validation'))
    return { category: 'schema', severity: 'high' };
  if (e.includes('not_found') || e.includes('not found'))
    return { category: 'fixture', severity: 'medium' };
  if (e.includes('timeout')) return { category: 'performance', severity: 'medium' };
  if (e.includes('not_implemented') || e.includes('not implemented'))
    return { category: 'implementation', severity: 'high' };
  if (e.includes('quota') || e.includes('rate'))
    return { category: 'performance', severity: 'medium' };

  return { category: 'implementation', severity: 'medium' };
}

function estimateEffort(category: Improvement['category'], error?: string): Improvement['effort'] {
  if (category === 'auth') return 'trivial';
  if (category === 'fixture') return 'trivial';
  if (category === 'schema') return 'small';
  if (category === 'performance') return 'medium';
  if (category === 'implementation') {
    if (error?.includes('not_implemented')) return 'large';
    return 'medium';
  }
  if (category === 'best-practice') return 'small';
  return 'medium';
}

// ── Simulation Mode ───────────────────────────────────────────────────────────
// When no live probe data exists, generate a synthetic baseline from known audit findings
function generateBaselineImprovements(): Improvement[] {
  // Based on session-notes.md known issues and audit findings
  const known: Array<Omit<Improvement, 'id'>> = [
    {
      severity: 'high',
      tool: 'sheets_data',
      action: 'find_replace',
      category: 'performance',
      title: 'find_replace uses A1:Z10000 range (overfetch)',
      description: 'Default range A1:Z10000 fetches 260K cells. Should use actual sheet bounds.',
      sourceLocations: grepSource('A1:Z10000'),
      docFindings: ['Sheets API recommends bounding ranges to actual data dimensions'],
      suggestedFix:
        'Use sheets_analyze.scout first to get actual rowCount/columnCount, then bound the range.',
      effort: 'small',
    },
    {
      severity: 'high',
      tool: 'sheets_connectors',
      action: 'query',
      category: 'implementation',
      title: 'api_key_query auth leaks credentials in URLs',
      description: 'API key is appended to query params and appears in server/access logs.',
      sourceLocations: grepSource('api_key_query'),
      docFindings: ['Google recommends api_key_header over query param for security'],
      suggestedFix: 'Remove api_key_query support. Force api_key_header or bearer_token.',
      effort: 'small',
    },
    {
      severity: 'high',
      tool: 'sheets_composite',
      action: 'data_pipeline',
      category: 'implementation',
      title: 'data_pipeline missing confirmDestructiveAction()',
      description:
        'Writes to destination without user confirmation. Snapshot exists but no confirm call.',
      sourceLocations: grepSource('data_pipeline'),
      docFindings: [
        'All destructive write operations should require user confirmation per safety rail pattern',
      ],
      suggestedFix:
        'Add confirmDestructiveAction() call after createSnapshotIfNeeded() in handleDataPipeline.',
      effort: 'trivial',
    },
    {
      severity: 'high',
      tool: 'sheets_composite',
      action: 'migrate_spreadsheet',
      category: 'implementation',
      title: 'migrate_spreadsheet missing confirmDestructiveAction()',
      description: 'Migrates data without user confirmation. Safety rail incomplete.',
      sourceLocations: grepSource('migrate_spreadsheet'),
      docFindings: ['Destructive operations must follow snapshot → confirm → execute pattern'],
      suggestedFix:
        'Add confirmDestructiveAction() with impact description in handleMigrateSpreadsheet.',
      effort: 'trivial',
    },
    {
      severity: 'medium',
      tool: 'sheets_analyze',
      action: 'analyze_performance',
      category: 'performance',
      title: 'analyze_performance bypasses ETag cache',
      description:
        'Uses raw sheetsApi instead of cachedSheetsApi — every call hits the API directly.',
      sourceLocations: grepSource('analyze_performance|analyzePerformance'),
      docFindings: ['Use cached API to reduce quota consumption and improve response times'],
      suggestedFix:
        'Replace raw sheetsApi calls in performance.ts with cachedSheetsApi equivalent.',
      effort: 'small',
    },
    {
      severity: 'medium',
      tool: 'sheets_bigquery',
      action: 'export_to_bigquery',
      category: 'performance',
      title: 'BigQuery WRITE_TRUNCATE polling uses fixed 2s intervals',
      description: 'Should use exponential backoff to reduce jobs.get quota consumption.',
      sourceLocations: grepSource('WRITE_TRUNCATE|pollJobUntilDone'),
      docFindings: [
        'BigQuery jobs.get has a quota limit. Use exponential backoff with 1s→30s range.',
      ],
      suggestedFix: 'pollJobUntilDone() already implemented — ensure WRITE_TRUNCATE path uses it.',
      effort: 'small',
    },
    {
      severity: 'medium',
      tool: 'sheets_session',
      action: 'schedule_create',
      category: 'implementation',
      title: '5 session scheduler actions have zero test coverage',
      description:
        'schedule_create/list/cancel/run_now + execute_pipeline have no handler-level tests.',
      sourceLocations: grepSource('schedule_create|handleScheduleCreate'),
      docFindings: [],
      suggestedFix: 'Add tests/handlers/session.test.ts cases for all 5 scheduler actions.',
      effort: 'medium',
    },
    {
      severity: 'medium',
      tool: 'sheets_webhook',
      action: 'register',
      category: 'implementation',
      title: 'HMAC signing failure sends unsigned payload silently',
      description:
        'On HMAC signing error, subscriber receives payload with signature "none" without notification.',
      sourceLocations: grepSource('signature.*none|hmac.*fail'),
      docFindings: ['Failed HMAC signing should cause delivery failure, not silent downgrade'],
      suggestedFix: 'Throw error on signing failure instead of sending signature: "none".',
      effort: 'trivial',
    },
    {
      severity: 'low',
      tool: 'sheets_core',
      action: 'get',
      category: 'performance',
      title: 'Prefetch calls missing field masks',
      description:
        'Two spreadsheets.get() prefetch calls fetch full 200-500KB response without field masks.',
      sourceLocations: grepSource('prefetch|fire-and-forget'),
      docFindings: ['Always use fields parameter to limit response payload size'],
      suggestedFix:
        'Add fields: "spreadsheetId,properties(title),sheets(properties)" to prefetch calls.',
      effort: 'trivial',
    },
    {
      severity: 'low',
      tool: 'sheets_worker',
      action: 'pool',
      category: 'performance',
      title: 'Worker pool timer handle leak on task timeout',
      description: 'clearTimeout not called in handleTaskTimeout() before task.reject().',
      sourceLocations: grepSource('handleTaskTimeout|task\\.timeout'),
      docFindings: [],
      suggestedFix: 'Add clearTimeout(task.timeout) at top of handleTaskTimeout() before reject().',
      effort: 'trivial',
    },
  ];

  return known.map((imp, i) => ({ ...imp, id: `BL-${String(i + 1).padStart(3, '0')}` }));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log(
    `\n${C.bold}${C.cyan}ServalSheets Improvement Synthesizer${C.reset}  ${C.dim}Agent 3 of 3${C.reset}`
  );
  log(`${C.dim}${'─'.repeat(60)}${C.reset}\n`);

  const improvements: Improvement[] = [];
  let probeLoaded = false;
  let enrichLoaded = false;

  // Load probe results
  if (existsSync(PROBE_FILE)) {
    probeLoaded = true;
    const probe = JSON.parse(readFileSync(PROBE_FILE, 'utf8')) as {
      summary: { total: number; pass: number; fail: number; skip: number };
      actions: Array<{
        tool: string;
        action: string;
        status: string;
        error?: string;
        errorCode?: string;
        durationMs: number;
      }>;
      flows: Array<{
        name: string;
        status: string;
        steps: Array<{ step: string; status: string; error?: string; durationMs: number }>;
      }>;
    };

    log(
      `${C.green}✓ Loaded probe results: ${probe.summary.total} actions (${probe.summary.fail} failures)${C.reset}`
    );

    // Process failed actions
    const failures = probe.actions.filter((a) => a.status === 'fail' || a.status === 'timeout');
    for (const failure of failures) {
      const { category, severity } = classifyError(failure.error);
      const sourceLocations = findActionInSource(failure.tool, failure.action);
      const effort = estimateEffort(category, failure.error);

      let title = `${failure.tool}.${failure.action} fails: ${failure.error?.split('\n')[0]?.slice(0, 60) ?? 'unknown error'}`;
      let suggestedFix = 'Investigate error and update fixture or implementation.';

      if (category === 'auth') {
        title = `Auth failure: ${failure.tool}.${failure.action}`;
        suggestedFix = 'Re-authenticate via sheets_auth.login or check required OAuth scopes.';
      } else if (category === 'fixture') {
        title = `Fixture issue: ${failure.tool}.${failure.action}`;
        suggestedFix = `Update fixture in auto-probe.ts for ${failure.action} — resource not found in test spreadsheet.`;
      } else if (category === 'schema') {
        title = `Schema validation error: ${failure.tool}.${failure.action}`;
        suggestedFix =
          'Check Zod schema matches fixture params. Review inputSchema discriminated union.';
      }

      improvements.push({
        id: `A-${improvements.length + 1}`.padStart(5, '0'),
        severity,
        tool: failure.tool,
        action: failure.action,
        category,
        title,
        description: `Action ${failure.status}ed in live probe. Error: ${failure.error ?? 'timeout'}. Duration: ${failure.durationMs}ms.`,
        error: failure.error,
        sourceLocations,
        docFindings: [],
        suggestedFix,
        effort,
      });
    }

    // Process slow actions (>5s)
    const slow = probe.actions.filter((a) => a.status === 'pass' && a.durationMs > 5000);
    for (const s of slow) {
      improvements.push({
        id: `P-${improvements.length + 1}`.padStart(5, '0'),
        severity: 'low',
        tool: s.tool,
        action: s.action,
        category: 'performance',
        title: `Slow: ${s.tool}.${s.action} took ${(s.durationMs / 1000).toFixed(1)}s`,
        description: `Action completed successfully but took ${s.durationMs}ms (>5s threshold).`,
        sourceLocations: findActionInSource(s.tool, s.action),
        docFindings: [],
        suggestedFix:
          'Profile API calls in this action. Consider caching, field masks, or parallel fetches.',
        effort: 'medium',
      });
    }

    // Process failed flows
    for (const flow of probe.flows.filter((f) => f.status !== 'pass')) {
      const failedSteps = flow.steps.filter((s) => s.status === 'fail');
      for (const step of failedSteps) {
        improvements.push({
          id: `F-${improvements.length + 1}`.padStart(5, '0'),
          severity: 'medium',
          tool: `flow:${flow.name}`,
          action: step.step,
          category: 'flow',
          title: `Flow failure: ${flow.name} → ${step.step}`,
          description: `Advanced flow step failed. Error: ${step.error ?? 'unknown'}.`,
          error: step.error,
          sourceLocations: [],
          docFindings: [],
          suggestedFix: 'Check flow step params and ensure prerequisite steps succeed first.',
          effort: 'small',
        });
      }
    }
  }

  // Load enrichment results
  if (existsSync(ENRICH_FILE)) {
    enrichLoaded = true;
    const enrich = JSON.parse(readFileSync(ENRICH_FILE, 'utf8')) as {
      enrichments: Array<{
        tool: string;
        action: string;
        status: string;
        findings: string[];
        priority: string;
        suggestedFix: string;
        insights: { bestPractices: string[]; deprecatedPatterns: string[] };
      }>;
    };

    log(`${C.green}✓ Loaded enrichment: ${enrich.enrichments.length} entries${C.reset}`);

    // Merge enrichment findings into existing improvements
    for (const entry of enrich.enrichments) {
      if (entry.findings.length === 0) continue;

      const existing = improvements.find(
        (imp) => imp.tool === entry.tool && imp.action === entry.action
      );
      if (existing) {
        existing.docFindings = entry.findings;
        if (entry.insights.bestPractices.length > 0) {
          existing.suggestedFix = entry.insights.bestPractices[0] ?? existing.suggestedFix;
        }
      } else if (entry.status === 'info' && entry.findings.length > 0) {
        // Add best-practice improvements from general tool queries
        improvements.push({
          id: `K-${improvements.length + 1}`.padStart(5, '0'),
          severity: 'low',
          tool: entry.tool,
          action: entry.action,
          category: 'best-practice',
          title: `Best practice: ${entry.tool} — ${entry.findings[0]?.slice(0, 60) ?? ''}`,
          description: entry.findings.join('. '),
          sourceLocations: [],
          docFindings: entry.findings,
          suggestedFix: entry.suggestedFix,
          effort: 'small',
        });
      }
    }
  }

  // Always include baseline audit findings
  log(`\n${C.blue}Adding baseline audit findings...${C.reset}`);
  const baseline = generateBaselineImprovements();
  // Only add baseline items not already covered by probe
  for (const b of baseline) {
    const alreadyCovered = improvements.some(
      (imp) => imp.tool === b.tool && imp.action === b.action && imp.title === b.title
    );
    if (!alreadyCovered) improvements.push(b);
  }

  // Sort: critical first, then by tool name
  const severityOrder: Record<Severity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  improvements.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.tool.localeCompare(b.tool)
  );

  // Re-assign sequential IDs after sort
  improvements.forEach((imp, i) => {
    imp.id = `IMP-${String(i + 1).padStart(3, '0')}`;
  });

  // ── Print Report ─────────────────────────────────────────────────────────────
  log(`\n${C.cyan}${'═'.repeat(60)}${C.reset}`);
  log(`${C.bold}IMPROVEMENT REPORT${C.reset}  ${new Date().toISOString()}`);
  log(`${C.cyan}${'═'.repeat(60)}${C.reset}`);

  const bySeverity = (s: Severity) => improvements.filter((i) => i.severity === s);
  log(`\n${C.bold}Summary${C.reset}`);
  log(`  ${C.red}Critical${C.reset} : ${bySeverity('critical').length}`);
  log(`  ${C.yellow}High${C.reset}     : ${bySeverity('high').length}`);
  log(`  Medium   : ${bySeverity('medium').length}`);
  log(`  Low      : ${bySeverity('low').length}`);
  log(`  Total    : ${improvements.length}`);
  if (!probeLoaded)
    log(
      `\n  ${C.yellow}Note: No live probe data. Run npm run auto:probe first for full coverage.${C.reset}`
    );
  if (!enrichLoaded)
    log(
      `  ${C.yellow}Note: No enrichment data. Run npm run auto:enrich for doc cross-reference.${C.reset}`
    );

  const printSection = (severity: Severity, label: string, color: string) => {
    const items = bySeverity(severity);
    if (items.length === 0) return;
    log(`\n${color}${C.bold}${label} (${items.length})${C.reset}`);
    for (const imp of items) {
      log(`\n  ${C.bold}[${imp.id}]${C.reset} ${imp.title}`);
      log(
        `  ${C.dim}Tool: ${imp.tool}.${imp.action}  Category: ${imp.category}  Effort: ${imp.effort}${C.reset}`
      );
      if (imp.description && VERBOSE) log(`  ${C.dim}${imp.description}${C.reset}`);
      if (imp.sourceLocations.length > 0) {
        log(
          `  ${C.cyan}Location: ${imp.sourceLocations[0]!.file}:${imp.sourceLocations[0]!.line}${C.reset}`
        );
      }
      log(`  ${C.green}Fix: ${imp.suggestedFix}${C.reset}`);
      if (imp.docFindings.length > 0 && VERBOSE) {
        log(`  ${C.dim}Docs: ${imp.docFindings[0]}${C.reset}`);
      }
    }
  };

  printSection('critical', 'CRITICAL', C.red);
  printSection('high', 'HIGH', C.yellow);
  printSection('medium', 'MEDIUM', C.cyan);
  printSection('low', 'LOW', C.dim);

  // Effort breakdown
  log(`\n${C.bold}Effort Breakdown${C.reset}`);
  const effortGroups = ['trivial', 'small', 'medium', 'large'] as const;
  for (const e of effortGroups) {
    const count = improvements.filter((i) => i.effort === e).length;
    if (count > 0) log(`  ${e.padEnd(8)} : ${count}`);
  }

  // Top 10 quick wins (trivial effort)
  const quickWins = improvements.filter(
    (i) =>
      i.effort === 'trivial' &&
      (i.severity === 'critical' || i.severity === 'high' || i.severity === 'medium')
  );
  if (quickWins.length > 0) {
    log(`\n${C.bold}Quick Wins (trivial effort, medium+ severity):${C.reset}`);
    for (const qw of quickWins.slice(0, 10)) {
      log(`  [${qw.id}] ${qw.title.slice(0, 80)}`);
      if (qw.sourceLocations[0]) {
        log(`    ${C.dim}${qw.sourceLocations[0].file}:${qw.sourceLocations[0].line}${C.reset}`);
      }
    }
  }

  // Write output
  mkdirSync(OUT_DIR, { recursive: true });
  const output = {
    timestamp: new Date().toISOString(),
    dataSource: { probeLoaded, enrichLoaded },
    summary: {
      total: improvements.length,
      critical: bySeverity('critical').length,
      high: bySeverity('high').length,
      medium: bySeverity('medium').length,
      low: bySeverity('low').length,
    },
    quickWins: quickWins.slice(0, 10).map((qw) => ({
      id: qw.id,
      title: qw.title,
      fix: qw.suggestedFix,
      location: qw.sourceLocations[0] ?? null,
    })),
    improvements,
  };
  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  log(`\n${C.green}Report written: ${OUT_FILE}${C.reset}`);

  if (JSON_ONLY) {
    process.stdout.write(JSON.stringify(output, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
