#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const baseDir = process.env['GATE_RESULTS_DIR'] ?? path.join('audit-output', 'gates');
const outFile = path.join(baseDir, 'trends.json');

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round(n) {
  return Math.round(n * 100) / 100;
}

if (!fs.existsSync(baseDir)) {
  console.log(`No gate results directory found at ${baseDir}`);
  process.exit(0);
}

const runDirs = fs
  .readdirSync(baseDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{8}-\d{6}$/.test(entry.name))
  .map((entry) => path.join(baseDir, entry.name));

const summaries = runDirs
  .map((dir) => path.join(dir, 'summary.json'))
  .filter((file) => fs.existsSync(file))
  .map((file) => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  })
  .filter((summary) => summary && Array.isArray(summary.gates));

if (summaries.length === 0) {
  console.log('No gate summary files found.');
  process.exit(0);
}

summaries.sort((a, b) => {
  const aTs = Date.parse(a.startedAt ?? '') || 0;
  const bTs = Date.parse(b.startedAt ?? '') || 0;
  return aTs - bTs;
});

const pipelineDurations = summaries.map((s) => Number(s.durationSeconds) || 0);
const pipelinePasses = summaries.filter((s) => s.status === 'passed').length;
const pipelineFailures = summaries.length - pipelinePasses;

const gateIds = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5'];
const gateStats = {};

for (const gateId of gateIds) {
  const records = summaries
    .map((summary) => summary.gates.find((g) => g.id === gateId))
    .filter(Boolean);

  const durations = records.map((record) => Number(record.durationSeconds) || 0);
  const passes = records.filter((record) => record.status === 'passed').length;
  const failures = records.length - passes;

  gateStats[gateId] = {
    runs: records.length,
    passed: passes,
    failed: failures,
    passRatePct: records.length > 0 ? round((passes / records.length) * 100) : 0,
    avgDurationSeconds:
      durations.length > 0 ? round(durations.reduce((acc, v) => acc + v, 0) / durations.length) : 0,
    medianDurationSeconds: round(median(durations)),
    p95DurationSeconds: round(
      durations.length > 0
        ? [...durations].sort((a, b) => a - b)[Math.max(0, Math.ceil(durations.length * 0.95) - 1)]
        : 0
    ),
  };
}

const latest = summaries[summaries.length - 1];
const recent = summaries.slice(-20).map((summary) => ({
  runId: summary.runId,
  startedAt: summary.startedAt,
  status: summary.status,
  durationSeconds: summary.durationSeconds,
  failedGate: summary.failedGate,
}));

const report = {
  generatedAt: new Date().toISOString(),
  sourceDir: baseDir,
  runsAnalyzed: summaries.length,
  latestRunId: latest.runId,
  pipeline: {
    passed: pipelinePasses,
    failed: pipelineFailures,
    passRatePct: round((pipelinePasses / summaries.length) * 100),
    avgDurationSeconds: round(pipelineDurations.reduce((acc, v) => acc + v, 0) / pipelineDurations.length),
    medianDurationSeconds: round(median(pipelineDurations)),
  },
  gates: gateStats,
  recentRuns: recent,
};

fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

console.log(`Gate trend report updated: ${outFile}`);
console.log(
  `Runs: ${report.runsAnalyzed}, pass rate: ${report.pipeline.passRatePct}%, median duration: ${report.pipeline.medianDurationSeconds}s`
);
