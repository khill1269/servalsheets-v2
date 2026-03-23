#!/usr/bin/env tsx

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export interface AddedSpreadsheetGetCall {
  filePath: string;
  lineNumber: number;
}

export interface FieldsMaskViolation {
  filePath: string;
  lineNumber: number;
  snippet: string;
}

const ALLOWLIST_MARKER = 'fields-mask-allowlist';
const CALL_SNIPPET_MAX_LINES = 40;

export function parseAddedSpreadsheetGetCalls(diffText: string): AddedSpreadsheetGetCall[] {
  const calls: AddedSpreadsheetGetCall[] = [];
  let currentFile = '';
  let currentNewLine = 0;

  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice('+++ b/'.length);
      continue;
    }

    if (line.startsWith('@@')) {
      const match = line.match(/\+(\d+)(?:,\d+)?/);
      if (match) {
        currentNewLine = Number(match[1]);
      }
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (/\bspreadsheets\.get\s*\(\s*\{/.test(line)) {
        calls.push({
          filePath: currentFile,
          lineNumber: currentNewLine,
        });
      }
      currentNewLine += 1;
      continue;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      continue;
    }

    if (!line.startsWith('\\')) {
      currentNewLine += 1;
    }
  }

  return calls;
}

function extractCallSnippet(fileContent: string, lineNumber: number): string {
  const lines = fileContent.split('\n');
  const startIndex = Math.max(0, lineNumber - 1);
  const endIndex = Math.min(lines.length - 1, startIndex + CALL_SNIPPET_MAX_LINES);

  const snippetLines: string[] = [];
  let started = false;
  let parenDepth = 0;

  for (let index = startIndex; index <= endIndex; index += 1) {
    const line = lines[index] ?? '';
    snippetLines.push(line);

    if (!started) {
      const callStart = line.indexOf('spreadsheets.get(');
      if (callStart >= 0) {
        started = true;
        parenDepth = 1;
        for (const ch of line.slice(callStart + 'spreadsheets.get('.length)) {
          if (ch === '(') parenDepth += 1;
          if (ch === ')') parenDepth -= 1;
        }
        if (parenDepth <= 0) {
          break;
        }
      }
      continue;
    }

    for (const ch of line) {
      if (ch === '(') parenDepth += 1;
      if (ch === ')') parenDepth -= 1;
    }

    if (parenDepth <= 0) {
      break;
    }
  }

  return snippetLines.join('\n');
}

export function hasFieldsMaskOrAllowlist(snippet: string): boolean {
  return /\bfields\s*(?::|,|\n|\r)/.test(snippet) || snippet.includes(ALLOWLIST_MARKER);
}

export function findFieldsMaskViolations(
  addedCalls: AddedSpreadsheetGetCall[],
  fileReader: (path: string) => string
): FieldsMaskViolation[] {
  const violations: FieldsMaskViolation[] = [];

  for (const call of addedCalls) {
    if (!call.filePath.endsWith('.ts')) {
      continue;
    }

    const content = fileReader(call.filePath);
    const snippet = extractCallSnippet(content, call.lineNumber);
    if (hasFieldsMaskOrAllowlist(snippet)) {
      continue;
    }

    violations.push({
      filePath: call.filePath,
      lineNumber: call.lineNumber,
      snippet,
    });
  }

  return violations;
}

export function runFieldsMaskGuard(
  baseRef = process.env['FIELDS_MASK_BASE_REF'] ?? 'HEAD'
): number {
  const diffText = execSync(`git diff --unified=0 --diff-filter=AMRT ${baseRef} -- src`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const addedCalls = parseAddedSpreadsheetGetCalls(diffText);
  const violations = findFieldsMaskViolations(addedCalls, (path) => readFileSync(path, 'utf8'));

  if (violations.length === 0) {
    console.log(
      `Field-mask guard passed (${addedCalls.length} new spreadsheets.get() call(s) checked).`
    );
    return 0;
  }

  console.error(
    'Field-mask guard failed. New spreadsheets.get() call(s) missing explicit fields mask:'
  );
  for (const violation of violations) {
    console.error(`- ${violation.filePath}:${violation.lineNumber}`);
    console.error(
      '  Add `fields: ...` or annotate intentional exceptions with `fields-mask-allowlist`.'
    );
  }
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(runFieldsMaskGuard());
}
