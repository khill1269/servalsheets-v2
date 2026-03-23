#!/usr/bin/env node
/**
 * sync-doc-counts.mjs — Sync tool/action counts from action-counts.ts into docs + src/
 *
 * Reads TOOL_COUNT and ACTION_COUNT from src/schemas/action-counts.ts (source of truth),
 * then reports any docs/*.md or src/**\/*.ts files that still reference outdated counts.
 *
 * Usage:
 *   node scripts/sync-doc-counts.mjs          # Dry-run (report only)
 *   node scripts/sync-doc-counts.mjs --fix    # Apply fixes (skip historical/release docs)
 *
 * Note: Historical docs (docs/releases/*, docs/historical/*) are intentionally excluded
 * from --fix mode since their counts reflect the state at the time of writing.
 *
 * Also handles per-tool action table regeneration in files with markers:
 *   <!-- BEGIN_GENERATED:tool-table -->
 *   <!-- END_GENERATED:tool-table -->
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');
const COUNTS_FILE = join(ROOT, 'src/schemas/action-counts.ts');

// --- Parse action-counts.ts ---
const countsSource = readFileSync(COUNTS_FILE, 'utf8');

const actionCountsBlock = countsSource.match(/export const ACTION_COUNTS[^{]*\{([^}]+)\}/s);

if (!actionCountsBlock) {
  console.error('ERROR: Could not parse ACTION_COUNTS from', COUNTS_FILE);
  process.exit(1);
}

// Count entries in the ACTION_COUNTS object
const entries = actionCountsBlock[1].match(/\w+:\s*\d+/g);
const toolCount = entries ? entries.length : 0;
const actionCount = entries
  ? entries.reduce((sum, e) => sum + parseInt(e.split(':')[1].trim(), 10), 0)
  : 0;

// Build per-tool map for table regeneration
const perToolCounts = {};
if (entries) {
  for (const e of entries) {
    const [tool, count] = e.split(':').map(s => s.trim());
    perToolCounts[tool] = parseInt(count, 10);
  }
}

console.log(`Source of truth: ${toolCount} tools, ${actionCount} actions`);
console.log(`Source: ${relative(ROOT, COUNTS_FILE)}\n`);

// --- Known stale patterns (all historical counts that should be updated) ---
const STALE_TOOL_COUNTS = [22, 23, 24]; // versions before 25
const STALE_ACTION_COUNTS = [
  291, 300, 305, 315, 335, 340, 342, 377, // early historical
  391, 397, 399, 401,                      // recent stale (added 2026-03-15)
].filter(n => n !== actionCount);          // never flag the current count as stale

// --- Scan targets: docs/*.md + src/**/*.ts ---
const FIX_MODE = process.argv.includes('--fix');
const SKIP_DIRS = ['releases', 'historical', 'archive']; // historical docs preserved as-is
const SKIP_DIRS_SRC = ['node_modules', 'dist', '.git'];

function walkDir(dir, ext) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      const skip = SKIP_DIRS_SRC.some(d => entry === d);
      if (!skip) files.push(...walkDir(full, ext));
    } else if (ext.some(e => entry.endsWith(e))) {
      files.push(full);
    }
  }
  return files;
}

const docsDir = join(ROOT, 'docs');
const srcDir = join(ROOT, 'src');
const rootMds = ['README.md', 'CONTRIBUTING.md', 'CLAUDE.md'].map(f => join(ROOT, f));

const mdFiles = [...walkDir(docsDir, ['.md']), ...rootMds.filter(f => { try { statSync(f); return true; } catch { return false; } })];
const tsFiles = walkDir(srcDir, ['.ts']).filter(f => !f.includes('/dist/') && !f.includes('.d.ts'));

let totalStale = 0;
let totalFixed = 0;

/**
 * Scan a file for stale count references and optionally fix them.
 * @param {string} filePath
 * @param {boolean} isHistorical - skip writing if true
 * @param {string} label - display label for output
 */
function processFile(filePath, isHistorical, label) {
  let content;
  try { content = readFileSync(filePath, 'utf8'); } catch { return; }

  const issues = [];

  // Helper: check if a match is part of a "X → Y" progression pattern (historical, don't fix)
  function isProgressionPattern(text, matchIndex) {
    const surrounding = text.substring(Math.max(0, matchIndex - 40), matchIndex + 40);
    return /→|->|before P\d|through P\d|was \d|from \d/i.test(surrounding);
  }

  // Check for stale tool counts: "\b22 tools\b" etc.
  for (const oldCount of STALE_TOOL_COUNTS) {
    const regex = new RegExp(`\\b${oldCount} tools\\b`, 'g');
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (isProgressionPattern(content, match.index)) continue;
      const lineNum = content.substring(0, match.index).split('\n').length;
      issues.push({ line: lineNum, old: `${oldCount} tools`, new: `${toolCount} tools`, index: match.index, length: match[0].length });
    }
  }

  // Check for stale action counts: "\b391 actions\b" etc.
  for (const oldCount of STALE_ACTION_COUNTS) {
    const regex = new RegExp(`\\b${oldCount} actions\\b`, 'g');
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (isProgressionPattern(content, match.index)) continue;
      const lineNum = content.substring(0, match.index).split('\n').length;
      issues.push({ line: lineNum, old: `${oldCount} actions`, new: `${actionCount} actions`, index: match.index, length: match[0].length });
    }
  }

  // Also catch "all NNN ServalSheets actions" pattern in src/ JSDoc
  {
    const regex = /\ball (\d+) ServalSheets actions\b/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const found = parseInt(match[1], 10);
      if (found !== actionCount) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        issues.push({ line: lineNum, old: match[0], new: `all ${actionCount} ServalSheets actions`, index: match.index, length: match[0].length });
      }
    }
  }

  if (issues.length === 0) return;

  totalStale += issues.length;

  console.log(`${label} (${issues.length} stale reference${issues.length > 1 ? 's' : ''})${isHistorical ? ' [HISTORICAL - skipped]' : ''}`);
  for (const issue of issues) {
    console.log(`  line ${issue.line}: "${issue.old}" → "${issue.new}"`);
  }

  if (FIX_MODE && !isHistorical) {
    let fixed = content;
    const sorted = [...issues].sort((a, b) => b.index - a.index);
    for (const issue of sorted) {
      fixed = fixed.substring(0, issue.index) + issue.new + fixed.substring(issue.index + issue.length);
    }
    writeFileSync(filePath, fixed, 'utf8');
    totalFixed += issues.length;
    console.log(`  ✅ Fixed ${issues.length} reference${issues.length > 1 ? 's' : ''}`);
  }
  console.log();
}

// --- Process all markdown files ---
console.log('=== Markdown files ===');
for (const filePath of mdFiles) {
  const relPath = relative(ROOT, filePath);
  const isHistorical = SKIP_DIRS.some(d => relPath.includes(`/${d}/`));
  processFile(filePath, isHistorical, relPath);
}

// --- Process src/ TypeScript files (JSDoc comments only) ---
console.log('=== Source files (JSDoc) ===');
for (const filePath of tsFiles) {
  const relPath = relative(ROOT, filePath);
  processFile(filePath, false, relPath);
}

// --- Handle per-tool table markers in markdown files ---
const TOOL_TABLE_START = '<!-- BEGIN_GENERATED:tool-table -->';
const TOOL_TABLE_END = '<!-- END_GENERATED:tool-table -->';

if (FIX_MODE) {
  for (const filePath of mdFiles) {
    const relPath = relative(ROOT, filePath);
    const isHistorical = SKIP_DIRS.some(d => relPath.includes(`/${d}/`));
    if (isHistorical) continue;

    let content;
    try { content = readFileSync(filePath, 'utf8'); } catch { continue; }

    if (!content.includes(TOOL_TABLE_START)) continue;

    const startIdx = content.indexOf(TOOL_TABLE_START) + TOOL_TABLE_START.length;
    const endIdx = content.indexOf(TOOL_TABLE_END);
    if (endIdx === -1) continue;

    const generated = '\n' + generateToolTable() + '\n';
    const before = content.substring(0, startIdx);
    const after = content.substring(endIdx);
    const newContent = before + generated + after;

    if (newContent !== content) {
      writeFileSync(filePath, newContent, 'utf8');
      console.log(`  ✅ Regenerated tool table in ${relPath}`);
    }
  }
}

function generateToolTable() {
  const rows = Object.entries(perToolCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tool, count]) => `| ${tool} | ${count} |`)
    .join('\n');
  return `| Tool | Actions |\n|------|---------||\n${rows}\n| **Total** | **${actionCount}** |`;
}

console.log('---');
console.log(`Total stale references: ${totalStale}`);
if (FIX_MODE) {
  console.log(`Fixed: ${totalFixed}, Skipped (historical): ${totalStale - totalFixed}`);
} else {
  console.log('Run with --fix to apply changes (historical docs will be skipped)');
}
