#!/usr/bin/env node
/**
 * ServalSheets - Health Snapshot Generator
 *
 * Single command → full project state report.
 *
 * Usage:
 *   npm run audit:snapshot              # stdout (JSON)
 *   npm run audit:snapshot -- --save    # also writes to docs/snapshots/
 *   npm run audit:snapshot -- --diff    # compares to last saved snapshot
 *
 * Checks:
 *   1. TypeScript compilation (tsc --noEmit)
 *   2. Lint status (eslint)
 *   3. Action coverage test results
 *   4. Memory leak test results
 *   5. Tool/action inventory from source of truth
 *   6. Monorepo/adapter status
 *   7. Test file inventory
 *
 * Runtime: ~30-60 seconds (runs tsc, eslint, vitest)
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Types ──────────────────────────────────────────────────

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  duration_ms: number;
  details?: string;
  metrics?: Record<string, number | string>;
}

interface HealthSnapshot {
  timestamp: string;
  version: string;
  node_version: string;
  checks: CheckResult[];
  inventory: {
    tools: number;
    actions: number;
    action_breakdown: Record<string, number>;
  };
  test_summary: {
    total_test_files: number;
    audit_files: number;
  };
  monorepo: {
    serval_core_version: string | null;
    adapters: string[];
  };
  overall: 'healthy' | 'degraded' | 'failing';
}

// ─── Helpers ────────────────────────────────────────────────

function runCommand(cmd: string, cwd: string = ROOT): { success: boolean; output: string; duration_ms: number } {
  const start = performance.now();
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    return { success: true, output: output.trim(), duration_ms: Math.round(performance.now() - start) };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string };
    const output = [error.stdout ?? '', error.stderr ?? ''].filter(Boolean).join('\n').trim();
    return { success: false, output, duration_ms: Math.round(performance.now() - start) };
  }
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

// ─── Check Runners ──────────────────────────────────────────

function checkTypeScript(): CheckResult {
  const { success, output, duration_ms } = runCommand('npx tsc --noEmit 2>&1');
  const errorCount = success ? 0 : (output.match(/error TS\d+/g) ?? []).length;
  return {
    name: 'typescript',
    status: success ? 'pass' : 'fail',
    duration_ms,
    details: success ? '0 errors' : `${errorCount} TypeScript errors`,
    metrics: { errors: errorCount },
  };
}

function checkLint(): CheckResult {
  const { success, output, duration_ms } = runCommand('npx eslint src/ --format compact 2>&1');
  const errorMatch = output.match(/(\d+) error/);
  const warnMatch = output.match(/(\d+) warning/);
  const errors = errorMatch ? parseInt(errorMatch[1]!, 10) : 0;
  const warnings = warnMatch ? parseInt(warnMatch[1]!, 10) : 0;

  return {
    name: 'lint',
    status: success ? (warnings > 0 ? 'warn' : 'pass') : 'fail',
    duration_ms,
    details: `${errors} errors, ${warnings} warnings`,
    metrics: { errors, warnings },
  };
}

function checkAuditCoverage(): CheckResult {
  const { success, output, duration_ms } = runCommand(
    'npx vitest run tests/audit/action-coverage.test.ts 2>&1'
  );
  const passMatch = output.match(/(\d+) passed/);
  const failMatch = output.match(/(\d+) failed/);
  const passed = passMatch ? parseInt(passMatch[1]!, 10) : 0;
  const failed = failMatch ? parseInt(failMatch[1]!, 10) : 0;

  return {
    name: 'action_coverage',
    status: success ? 'pass' : 'fail',
    duration_ms,
    details: `${passed} passed, ${failed} failed`,
    metrics: { passed, failed },
  };
}

function checkMemoryLeaks(): CheckResult {
  const { success, output, duration_ms } = runCommand(
    'npx vitest run tests/audit/memory-leaks.test.ts 2>&1'
  );
  const passMatch = output.match(/(\d+) passed/);
  const failMatch = output.match(/(\d+) failed/);
  const passed = passMatch ? parseInt(passMatch[1]!, 10) : 0;
  const failed = failMatch ? parseInt(failMatch[1]!, 10) : 0;

  return {
    name: 'memory_leaks',
    status: success ? 'pass' : 'fail',
    duration_ms,
    details: `${passed} passed, ${failed} failed`,
    metrics: { passed, failed },
  };
}

function checkMetadataDrift(): CheckResult {
  const { success, output, duration_ms } = runCommand('npm run check:drift 2>&1');
  return {
    name: 'metadata_drift',
    status: success ? 'pass' : 'fail',
    duration_ms,
    details: success ? 'No drift detected' : output.slice(0, 200),
  };
}

// ─── Inventory ──────────────────────────────────────────────

function getInventory(): HealthSnapshot['inventory'] {
  try {
    const actionCountsPath = join(ROOT, 'src/schemas/action-counts.ts');
    const content = readFileSync(actionCountsPath, 'utf-8');

    // Parse ACTION_COUNTS from the file
    const breakdown: Record<string, number> = {};
    const regex = /(\w+):\s*(\d+)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      breakdown[match[1]!] = parseInt(match[2]!, 10);
    }

    const tools = Object.keys(breakdown).length;
    const actions = Object.values(breakdown).reduce((s, n) => s + n, 0);

    return { tools, actions, action_breakdown: breakdown };
  } catch {
    return { tools: 0, actions: 0, action_breakdown: {} };
  }
}

function getTestSummary(): HealthSnapshot['test_summary'] {
  try {
    const { output } = runCommand('find tests -name "*.test.ts" | wc -l');
    const totalFiles = parseInt(output.trim(), 10) || 0;

    const { output: auditOutput } = runCommand('find tests/audit -name "*.test.ts" 2>/dev/null | wc -l');
    const auditFiles = parseInt(auditOutput.trim(), 10) || 0;

    return { total_test_files: totalFiles, audit_files: auditFiles };
  } catch {
    return { total_test_files: 0, audit_files: 0 };
  }
}

function getMonorepoStatus(): HealthSnapshot['monorepo'] {
  let coreVersion: string | null = null;
  try {
    const corePkg = readJsonFile(join(ROOT, 'packages/serval-core/package.json')) as { version?: string } | null;
    coreVersion = corePkg?.version ?? null;
  } catch {
    // serval-core may not exist yet
  }

  const adapters: string[] = [];
  try {
    const adapterDir = join(ROOT, 'src/adapters');
    if (existsSync(adapterDir)) {
      const files = readdirSync(adapterDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      adapters.push(...files.map((f) => f.replace('.ts', '')));
    }
  } catch {
    // adapters dir may not exist
  }

  return { serval_core_version: coreVersion, adapters };
}

// ─── Main ───────────────────────────────────────────────────

function generateSnapshot(): HealthSnapshot {
  const pkg = readJsonFile(join(ROOT, 'package.json')) as { version?: string } | null;

  // Run checks
  const checks: CheckResult[] = [
    checkTypeScript(),
    checkLint(),
    checkMetadataDrift(),
    checkAuditCoverage(),
    checkMemoryLeaks(),
  ];

  const failCount = checks.filter((c) => c.status === 'fail').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;

  const overall: HealthSnapshot['overall'] =
    failCount > 0 ? 'failing' : warnCount > 0 ? 'degraded' : 'healthy';

  return {
    timestamp: new Date().toISOString(),
    version: pkg?.version ?? 'unknown',
    node_version: process.version,
    checks,
    inventory: getInventory(),
    test_summary: getTestSummary(),
    monorepo: getMonorepoStatus(),
    overall,
  };
}

// ─── CLI ────────────────────────────────────────────────────

const args = process.argv.slice(2);
const shouldSave = args.includes('--save');
const shouldDiff = args.includes('--diff');

const snapshot = generateSnapshot();

// Always output to stdout
const json = JSON.stringify(snapshot, null, 2);
console.log(json);

// Save if requested
if (shouldSave) {
  const snapshotDir = join(ROOT, 'docs/snapshots');
  mkdirSync(snapshotDir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const filename = `health-${date}.json`;
  const filepath = join(snapshotDir, filename);

  writeFileSync(filepath, json + '\n');
  console.error(`\nSnapshot saved to: ${filepath}`);
}

// Diff if requested
if (shouldDiff) {
  const snapshotDir = join(ROOT, 'docs/snapshots');
  if (existsSync(snapshotDir)) {
    const files = readdirSync(snapshotDir)
      .filter((f) => f.startsWith('health-') && f.endsWith('.json'))
      .sort();

    if (files.length > 0) {
      const lastFile = files[files.length - 1]!;
      const lastSnapshot = readJsonFile(join(snapshotDir, lastFile)) as HealthSnapshot | null;

      if (lastSnapshot) {
        console.error(`\n─── Diff vs ${lastFile} ───`);

        // Compare overall status
        if (lastSnapshot.overall !== snapshot.overall) {
          console.error(`  Overall: ${lastSnapshot.overall} → ${snapshot.overall}`);
        } else {
          console.error(`  Overall: ${snapshot.overall} (unchanged)`);
        }

        // Compare inventory
        if (lastSnapshot.inventory.tools !== snapshot.inventory.tools) {
          console.error(`  Tools: ${lastSnapshot.inventory.tools} → ${snapshot.inventory.tools}`);
        }
        if (lastSnapshot.inventory.actions !== snapshot.inventory.actions) {
          console.error(`  Actions: ${lastSnapshot.inventory.actions} → ${snapshot.inventory.actions}`);
        }

        // Compare check statuses
        for (const check of snapshot.checks) {
          const prev = lastSnapshot.checks.find((c) => c.name === check.name);
          if (prev && prev.status !== check.status) {
            console.error(`  ${check.name}: ${prev.status} → ${check.status}`);
          }
        }
      }
    } else {
      console.error('\nNo previous snapshots found for comparison.');
    }
  } else {
    console.error('\nNo snapshots directory found. Run with --save first.');
  }
}

// Exit with status
process.exit(snapshot.overall === 'failing' ? 1 : 0);
