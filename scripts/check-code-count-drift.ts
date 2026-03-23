#!/usr/bin/env tsx
/**
 * Validate code-level tool/action total references against source of truth.
 *
 * Source of truth:
 *   src/schemas/action-counts.ts
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const SCAN_DIRECTORIES = ['src', 'scripts', 'tests', 'deployment'];
const SCAN_FILES = ['package.json', 'server.json'];
const SCANNABLE_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs', '.sh', '.json', '.html']);
const EXCLUDED_PREFIXES = ['docs/', 'dist/', 'node_modules/', '.git/', '.claude/', '.serval/'];
const EXCLUDED_FILES = new Set(['scripts/check-code-count-drift.ts']);

interface DriftIssue {
  file: string;
  line: number;
  before: string;
  after: string;
}

function getCountsFromSource(): { toolCount: number; actionCount: number } {
  const actionCountsPath = join(ROOT, 'src/schemas/action-counts.ts');
  const content = readFileSync(actionCountsPath, 'utf-8');

  const matches = content.matchAll(/^\s+sheets_[a-z_]+:\s*(\d+),$/gm);
  let toolCount = 0;
  let actionCount = 0;

  for (const match of matches) {
    toolCount += 1;
    actionCount += parseInt(match[1], 10);
  }

  if (toolCount === 0 || actionCount === 0) {
    throw new Error('Failed to parse src/schemas/action-counts.ts');
  }

  return { toolCount, actionCount };
}

const { toolCount: TOOL_COUNT, actionCount: ACTION_COUNT } = getCountsFromSource();

function walkFilesInDirectory(dir: string): string[] {
  const absDir = join(ROOT, dir);
  if (!existsSync(absDir)) {
    return [];
  }

  const files: string[] = [];
  const entries = readdirSync(absDir);

  for (const entry of entries) {
    const absPath = join(absDir, entry);
    const relPath = relative(ROOT, absPath);
    const stats = statSync(absPath);

    if (stats.isDirectory()) {
      files.push(...walkFilesInDirectory(relPath));
      continue;
    }

    if (!SCANNABLE_EXTENSIONS.has(extname(relPath))) {
      continue;
    }

    files.push(relPath);
  }

  return files;
}

function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

function getLineText(content: string, index: number): string {
  const lineStart = content.lastIndexOf('\n', index - 1) + 1;
  const lineEnd = content.indexOf('\n', index);
  return content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
}

function shouldSkipFile(path: string): boolean {
  if (EXCLUDED_FILES.has(path)) {
    return true;
  }

  return EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function shouldSkipLine(line: string): boolean {
  if (/(->|→)/.test(line)) {
    return true;
  }

  return /\b(historical|legacy|previous|was|were|phase|milestone|roadmap|benchmark|mock|fixture|example|baseline)\b/i.test(
    line
  );
}

function collectIssues(path: string): DriftIssue[] {
  const issues: DriftIssue[] = [];
  const content = readFileSync(join(ROOT, path), 'utf-8');

  const combinedPattern =
    /(\d+)\s+([Tt]ools)(\s*,\s*|\s*\/\s*|\s+with\s+|\s+and\s+)(\d+)\s+([Aa]ctions)/g;
  let match: RegExpExecArray | null;
  while ((match = combinedPattern.exec(content)) !== null) {
    const line = getLineText(content, match.index);
    if (shouldSkipLine(line)) {
      continue;
    }

    const tools = parseInt(match[1], 10);
    const actions = parseInt(match[4], 10);
    if (tools === TOOL_COUNT && actions === ACTION_COUNT) {
      continue;
    }

    issues.push({
      file: path,
      line: getLineNumber(content, match.index),
      before: match[0],
      after: `${TOOL_COUNT} ${match[2]}${match[3]}${ACTION_COUNT} ${match[5]}`,
    });
  }

  const acrossPattern = /(\d+)\s+([Aa]ctions)\s+across\s+(\d+)\s+([Tt]ools)/g;
  while ((match = acrossPattern.exec(content)) !== null) {
    const line = getLineText(content, match.index);
    if (shouldSkipLine(line)) {
      continue;
    }

    const actions = parseInt(match[1], 10);
    const tools = parseInt(match[3], 10);
    if (tools === TOOL_COUNT && actions === ACTION_COUNT) {
      continue;
    }

    issues.push({
      file: path,
      line: getLineNumber(content, match.index),
      before: match[0],
      after: `${ACTION_COUNT} ${match[2]} across ${TOOL_COUNT} ${match[4]}`,
    });
  }

  const actionRatioPattern = /(\d+)\s*\/\s*(\d+)\s+([Aa]ctions)\b/g;
  while ((match = actionRatioPattern.exec(content)) !== null) {
    const line = getLineText(content, match.index);
    if (shouldSkipLine(line)) {
      continue;
    }

    const denominator = parseInt(match[2], 10);
    if (denominator === ACTION_COUNT) {
      continue;
    }

    issues.push({
      file: path,
      line: getLineNumber(content, match.index),
      before: match[0],
      after: `${match[1]}/${ACTION_COUNT} ${match[3]}`,
    });
  }

  return issues;
}

function getTargetFiles(): string[] {
  const files = new Set<string>();

  for (const dir of SCAN_DIRECTORIES) {
    for (const file of walkFilesInDirectory(dir)) {
      files.add(file);
    }
  }

  for (const file of SCAN_FILES) {
    if (existsSync(join(ROOT, file))) {
      files.add(file);
    }
  }

  return [...files].filter((path) => !shouldSkipFile(path)).sort();
}

console.log(`📊 Source of truth: ${TOOL_COUNT} tools, ${ACTION_COUNT} actions`);
console.log('🔍 Checking non-doc code count references...\n');

const issues = getTargetFiles().flatMap((file) => collectIssues(file));

if (issues.length === 0) {
  console.log('✅ No non-doc count drift found');
  process.exit(0);
}

console.error(`❌ Found ${issues.length} non-doc count drift issue(s):`);
for (const issue of issues.slice(0, 100)) {
  console.error(`  - ${issue.file}:${issue.line} "${issue.before}" -> "${issue.after}"`);
}
if (issues.length > 100) {
  console.error(`  ... and ${issues.length - 100} more`);
}
process.exit(1);
