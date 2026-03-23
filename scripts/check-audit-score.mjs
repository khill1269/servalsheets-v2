#!/usr/bin/env node

import fs from 'node:fs';

const reportPath = 'audit-output/quick-results.json';
const thresholdRaw = process.env['AUDIT_QUICK_THRESHOLD'];
const threshold = Number.isFinite(Number(thresholdRaw)) ? Number(thresholdRaw) : 85;

if (!fs.existsSync(reportPath)) {
  console.warn('⚠️  Quick audit results not found, skipping score check');
  process.exit(0);
}

let score;
try {
  const data = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  score = Number(data.total_percentage);
} catch (error) {
  console.error('❌ Failed to parse quick audit report:', error);
  process.exit(1);
}

if (!Number.isFinite(score)) {
  console.error('❌ Invalid audit score in quick audit report');
  process.exit(1);
}

console.log(`Quick audit score: ${score}%`);

if (score < threshold) {
  console.error(`❌ Audit score below threshold: ${score}% < ${threshold}%`);
  process.exit(1);
}

console.log(`✓ Audit score meets threshold: ${score}% ≥ ${threshold}%`);
