#!/usr/bin/env node
/**
 * AQUI-VR Gate G15 — Doc Action Count Consistency
 *
 * Extracts action counts from documentation files and verifies
 * they match ACTION_COUNT from src/schemas/action-counts.ts.
 *
 * Usage:
 *   node scripts/aquivr-check-doc-counts.mjs CHANGELOG.md CLAUDE.md README.md
 *   node scripts/aquivr-check-doc-counts.mjs  # defaults to common doc files
 *
 * Exit 0 = all match; Exit 1 = mismatch found
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Read ACTION_COUNT from action-counts.ts (no import needed — just parse the TS)
const actionCountsPath = resolve(root, 'src/schemas/action-counts.ts');
const actionCountsSource = readFileSync(actionCountsPath, 'utf8');

// ACTION_COUNT is computed as Object.values(ACTION_COUNTS).reduce(...)
// Parse the individual counts and sum them
const countsMatch = actionCountsSource.match(/ACTION_COUNTS[^=]*=\s*\{([^}]+)\}/s);
if (!countsMatch) {
  console.error('FAIL: could not parse ACTION_COUNTS from src/schemas/action-counts.ts');
  process.exit(1);
}
const ACTION_COUNT = countsMatch[1]
  .match(/:\s*(\d+)/g)
  ?.map(m => parseInt(m.replace(/[^0-9]/g, ''), 10))
  .reduce((a, b) => a + b, 0) ?? null;

if (!ACTION_COUNT) {
  console.error('FAIL: could not compute ACTION_COUNT from src/schemas/action-counts.ts');
  process.exit(1);
}

console.log(`ACTION_COUNT (authoritative): ${ACTION_COUNT}`);
console.log('');

// Files to check — passed as args or use defaults
const DEFAULT_FILES = [
  'CHANGELOG.md',
  'CLAUDE.md',
  'README.md',
  'docs/development/PROJECT_STATUS.md',
  // AQUI-VR_v3.2_Framework.md intentionally references historical counts in finding descriptions
];

const filesToCheck = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : DEFAULT_FILES;

let failures = 0;
let skipped = 0;

for (const relPath of filesToCheck) {
  const fullPath = resolve(root, relPath);

  if (!existsSync(fullPath)) {
    console.log(`SKIP: ${relPath} (not found)`);
    skipped++;
    continue;
  }

  const content = readFileSync(fullPath, 'utf8');

  // Strip fenced code blocks — these intentionally reference old values in remediation commands
  const strippedContent = content.replace(/```[\s\S]*?```/g, '');

  // Match live action count claims (not inside code blocks):
  // - "403 actions" — direct claim
  // - "399 → 403 actions" — changelog transition: only the RHS matters
  // Ignore patterns where the number is the "from" side of an arrow
  const directMatches = [...strippedContent.matchAll(/(?<!→\s*\d{2,4}\s*)(\d{3,4})\s+actions?(?!\s*\))/gi)];
  const arrowRhsMatches = [...strippedContent.matchAll(/→\s*(\d{3,4})\s+actions?/gi)];
  const allCountMatches = [...directMatches, ...arrowRhsMatches];

  if (allCountMatches.length === 0) {
    console.log(`OK:   ${relPath} (no action count references found)`);
    continue;
  }

  const wrongCounts = allCountMatches
    .map(m => parseInt(m[1], 10))
    .filter(c => c !== ACTION_COUNT && c > 300); // ignore small numbers like line counts

  if (wrongCounts.length > 0) {
    console.error(`FAIL: ${relPath} — stale count(s) found: ${[...new Set(wrongCounts)].join(', ')} (expected ${ACTION_COUNT})`);
    // Show context for each stale count
    for (const count of [...new Set(wrongCounts)]) {
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        if (new RegExp(`\\b${count}\\b.*actions?|actions?.*\\b${count}\\b`, 'i').test(line)) {
          console.error(`  Line ${i + 1}: ${line.trim()}`);
        }
      });
    }
    failures++;
  } else {
    const validCounts = allCountMatches.map(m => parseInt(m[1], 10)).filter(c => c > 300);
    console.log(`PASS: ${relPath} (count(s): ${[...new Set(validCounts)].join(', ')})`);
  }
}

console.log('');
if (failures === 0) {
  console.log(`✓ All ${filesToCheck.length - skipped} checked files match ACTION_COUNT=${ACTION_COUNT}`);
  process.exit(0);
} else {
  console.error(`✗ ${failures} file(s) have stale action counts — update to ${ACTION_COUNT}`);
  process.exit(1);
}
