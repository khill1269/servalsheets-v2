#!/usr/bin/env node

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const baselinePath = '.markdownlint-baseline.json';
const updateMode = process.argv.includes('--update');

const args = [
  'markdownlint-cli2',
  'docs/**/*.md',
  '#docs/archive/**',
  '#docs/generated/**',
  '#docs/.vitepress/**',
];

const run = spawnSync('npx', args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
const summaryMatch = output.match(/Summary:\s+(\d+)\s+error\(s\)/);
const errorCount = summaryMatch ? Number(summaryMatch[1]) : 0;

if (updateMode) {
  const payload = {
    baselineErrors: errorCount,
    updatedAt: new Date().toISOString(),
    command: `npx ${args.join(' ')}`,
  };
  fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`✅ Updated markdownlint baseline: ${errorCount} error(s)`);
  process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
  console.error(`❌ Missing ${baselinePath}`);
  console.error('Run: npm run docs:lint:baseline:update');
  process.exit(1);
}

let baseline;
try {
  baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
} catch (error) {
  console.error(`❌ Failed to parse ${baselinePath}:`, error);
  process.exit(1);
}

const baselineErrors = Number(baseline.baselineErrors);
if (!Number.isFinite(baselineErrors) || baselineErrors < 0) {
  console.error(`❌ Invalid baselineErrors in ${baselinePath}`);
  process.exit(1);
}

if (errorCount > baselineErrors) {
  console.error(
    `❌ markdownlint regressions detected: ${errorCount} > baseline ${baselineErrors}`
  );
  if (output.trim().length > 0) {
    console.error(output.trim());
  }
  process.exit(1);
}

if (run.status !== 0 && errorCount === 0) {
  console.error('❌ markdownlint execution failed unexpectedly');
  if (output.trim().length > 0) {
    console.error(output.trim());
  }
  process.exit(1);
}

const delta = baselineErrors - errorCount;
if (delta > 0) {
  console.log(
    `✅ markdownlint improved: ${errorCount} error(s) (baseline ${baselineErrors}, -${delta})`
  );
} else {
  console.log(`✅ markdownlint at baseline: ${errorCount} error(s)`);
}
