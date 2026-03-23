#!/usr/bin/env tsx
/**
 * ServalSheets Auto-Improve — Orchestrator
 *
 * Runs all 3 agents in sequence:
 *   Agent 1: auto-probe    — tests the full current action surface against the live API
 *   Agent 2: knowledge-enrich — cross-references failures with Google Dev docs
 *   Agent 3: synthesize    — produces prioritized improvement plan
 *
 * Usage:
 *   npx tsx scripts/auto-improve.ts [options]
 *
 * Options:
 *   --skip-probe     Skip Agent 1 (use existing probe-results.json)
 *   --skip-enrich    Skip Agent 2 (use existing knowledge-enrichment.json)
 *   --tool <name>    Only probe specific tool(s), comma-separated
 *   --keep-sheet     Don't delete test spreadsheet after probe
 *   --verbose        Verbose output in all agents
 *   --json           Output final report as JSON to stdout (for CI)
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(homedir(), '.servalsheets');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const SKIP_PROBE = args.includes('--skip-probe');
const SKIP_ENRICH = args.includes('--skip-enrich');
const VERBOSE = args.includes('--verbose');
const JSON_OUT = args.includes('--json');
const KEEP_SHEET = args.includes('--keep-sheet');
const toolIdx = args.indexOf('--tool');
const TOOL_FILTER = toolIdx !== -1 ? args[toolIdx + 1] : null;

// ── Colors ───────────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(msg: string) {
  process.stdout.write(msg + '\n');
}

function runAgent(name: string, script: string, extraArgs: string[] = []): boolean {
  const label = `${C.bold}${C.cyan}[${name}]${C.reset}`;
  log(`\n${C.cyan}${'─'.repeat(60)}${C.reset}`);
  log(`${label} Starting...`);
  log(`${C.cyan}${'─'.repeat(60)}${C.reset}`);

  const agentArgs = [...extraArgs];
  if (VERBOSE) agentArgs.push('--verbose');

  const start = Date.now();
  const result = spawnSync('npx', ['tsx', script, ...agentArgs], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env },
    timeout: 10 * 60 * 1000, // 10 minute timeout per agent
  });

  const duration = ((Date.now() - start) / 1000).toFixed(1);

  if (result.status === 0) {
    log(`\n${label} ${C.green}Complete${C.reset}  ${C.dim}${duration}s${C.reset}`);
    return true;
  } else {
    log(
      `\n${label} ${C.red}Failed${C.reset}  ${C.dim}${duration}s  exit=${result.status}${C.reset}`
    );
    if (result.error) log(`  ${C.red}${result.error.message}${C.reset}`);
    return false;
  }
}

function checkPrerequisites(): boolean {
  let ok = true;

  // Check dist is built
  const cliPath = join(ROOT, 'dist/cli.js');
  if (!existsSync(cliPath)) {
    log(`${C.red}dist/cli.js not found. Run: npm run build${C.reset}`);
    ok = false;
  }

  // Check .mcp.json has servalsheets config
  const mcpPath = join(ROOT, '.mcp.json');
  if (!existsSync(mcpPath)) {
    log(`${C.red}.mcp.json not found${C.reset}`);
    ok = false;
  }

  // Check token store exists (auth is set up)
  const tokenPath =
    process.env['GOOGLE_TOKEN_STORE_PATH'] ?? join(homedir(), '.servalsheets/tokens.encrypted');
  if (!existsSync(tokenPath)) {
    log(`${C.yellow}Warning: Token store not found at ${tokenPath}`);
    log(`  Run: npx tsx dist/cli.js --stdio then sheets_auth.login in Claude Code${C.reset}`);
  }

  return ok;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log(
    `\n${C.bold}ServalSheets Auto-Improve${C.reset}  ${C.dim}3-Agent Automated Pipeline${C.reset}`
  );
  log(`${C.cyan}${'═'.repeat(60)}${C.reset}`);
  log(`  Agent 1: Live API probe   (all ${C.cyan}395${C.reset} actions)`);
  log(`  Agent 2: Knowledge enrich (Google Dev docs cross-ref)`);
  log(`  Agent 3: Synthesize       (prioritized improvement plan)`);
  log(`${C.cyan}${'═'.repeat(60)}${C.reset}`);
  log(`\n  Output: ${OUT_DIR}/`);
  log(`    probe-results.json`);
  log(`    knowledge-enrichment.json`);
  log(`    improvement-report.json\n`);

  // Prerequisites
  if (!checkPrerequisites()) {
    log(`\n${C.red}Prerequisites not met. Aborting.${C.reset}`);
    process.exit(1);
  }

  const startTime = Date.now();
  const results: Record<string, boolean> = {};

  // ── Agent 1: Auto-Probe ───────────────────────────────────────────────────
  if (SKIP_PROBE) {
    const probeFile = join(OUT_DIR, 'probe-results.json');
    if (existsSync(probeFile)) {
      log(`${C.yellow}[Agent 1] Skipped — using existing probe-results.json${C.reset}`);
      results['probe'] = true;
    } else {
      log(`${C.red}[Agent 1] Skip requested but no probe-results.json found${C.reset}`);
      results['probe'] = false;
    }
  } else {
    const probeArgs: string[] = [];
    if (KEEP_SHEET) probeArgs.push('--keep-sheet');
    if (TOOL_FILTER) {
      probeArgs.push('--tool');
      probeArgs.push(TOOL_FILTER);
    }
    results['probe'] = runAgent('Agent 1: Auto-Probe', 'scripts/auto-probe.ts', probeArgs);
  }

  // ── Agent 2: Knowledge Enrichment ────────────────────────────────────────
  if (SKIP_ENRICH) {
    const enrichFile = join(OUT_DIR, 'knowledge-enrichment.json');
    if (existsSync(enrichFile)) {
      log(`\n${C.yellow}[Agent 2] Skipped — using existing knowledge-enrichment.json${C.reset}`);
      results['enrich'] = true;
    } else {
      log(
        `\n${C.yellow}[Agent 2] Skip requested but no knowledge-enrichment.json — running anyway${C.reset}`
      );
      results['enrich'] = runAgent('Agent 2: Knowledge Enrich', 'scripts/knowledge-enrichment.ts');
    }
  } else {
    // Only run if probe succeeded (or if skipping probe with existing data)
    if (results['probe']) {
      results['enrich'] = runAgent('Agent 2: Knowledge Enrich', 'scripts/knowledge-enrichment.ts');
    } else {
      log(
        `\n${C.yellow}[Agent 2] Running without probe data (enriching known issues only)${C.reset}`
      );
      results['enrich'] = runAgent('Agent 2: Knowledge Enrich', 'scripts/knowledge-enrichment.ts');
    }
  }

  // ── Agent 3: Improvement Synthesizer ────────────────────────────────────
  const synthArgs = JSON_OUT ? ['--json-only'] : [];
  results['synth'] = runAgent(
    'Agent 3: Synthesize',
    'scripts/improvement-synthesizer.ts',
    synthArgs
  );

  // ── Final Summary ────────────────────────────────────────────────────────
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`\n${C.cyan}${'═'.repeat(60)}${C.reset}`);
  log(`${C.bold}Pipeline Complete${C.reset}  ${C.dim}${totalTime}s total${C.reset}`);
  log(`${C.cyan}${'═'.repeat(60)}${C.reset}`);
  log(`  Agent 1 (probe)  : ${results['probe'] ? `${C.green}✓` : `${C.red}✗`}${C.reset}`);
  log(`  Agent 2 (enrich) : ${results['enrich'] ? `${C.green}✓` : `${C.red}✗`}${C.reset}`);
  log(`  Agent 3 (synth)  : ${results['synth'] ? `${C.green}✓` : `${C.red}✗`}${C.reset}`);

  const reportFile = join(OUT_DIR, 'improvement-report.json');
  if (existsSync(reportFile)) {
    log(`\n${C.green}Report: ${reportFile}${C.reset}`);
    // Print top quick wins from report
    try {
      const report = JSON.parse(require('fs').readFileSync(reportFile, 'utf8')) as {
        summary: { critical: number; high: number; medium: number; total: number };
        quickWins: Array<{ id: string; title: string; fix: string }>;
      };
      log(
        `\n${C.bold}Summary: ${report.summary.critical} critical, ${report.summary.high} high, ${report.summary.medium} medium (${report.summary.total} total)${C.reset}`
      );
      if (report.quickWins.length > 0) {
        log(`\n${C.bold}Top Quick Wins:${C.reset}`);
        for (const qw of report.quickWins.slice(0, 5)) {
          log(`  [${qw.id}] ${qw.title.slice(0, 70)}`);
        }
      }
    } catch {
      /* ok */
    }
  }

  const allPassed = Object.values(results).every(Boolean);
  process.exit(allPassed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
