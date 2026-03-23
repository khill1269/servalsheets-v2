#!/usr/bin/env node
/**
 * verify-annotations.mjs
 * Verifies that every action in ACTION_ANNOTATIONS has a valid errorRecovery block.
 * Target: 391/391 (100%)
 */

import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

const projectRoot = process.cwd();

// Use tsx to load TypeScript directly
const { execSync } = await import('child_process');

const result = execSync(
  `node --import tsx --input-type=module`,
  {
    input: `
import { ACTION_ANNOTATIONS } from './src/schemas/annotations.ts';
import { ACTION_COUNT } from './src/schemas/index.ts';

const total = ACTION_COUNT;
const entries = Object.entries(ACTION_ANNOTATIONS);

const missing = [];
const invalid = [];

for (const [key, annotation] of entries) {
  if (!annotation.errorRecovery) {
    missing.push(key);
    continue;
  }
  const er = annotation.errorRecovery;
  const problems = [];
  if (!Array.isArray(er.alternativeActions) || er.alternativeActions.length === 0)
    problems.push('alternativeActions must be non-empty array');
  if (!Array.isArray(er.diagnosticSteps) || er.diagnosticSteps.length === 0)
    problems.push('diagnosticSteps must be non-empty array');
  if (typeof er.userGuidance !== 'string' || !er.userGuidance.trim())
    problems.push('userGuidance must be non-empty string');
  if (problems.length > 0) invalid.push({ key, problems });
}

const covered = entries.length - missing.length;
console.log('\\n══════════════════════════════════════════════════');
console.log('  Error Recovery Coverage Verification');
console.log('══════════════════════════════════════════════════');
console.log(\`  Total actions (ACTION_COUNT):  \${total}\`);
console.log(\`  Annotation entries found:      \${entries.length}\`);
console.log(\`  With errorRecovery:            \${covered}\`);
console.log(\`  Missing errorRecovery:         \${missing.length}\`);
console.log(\`  Invalid errorRecovery:         \${invalid.length}\`);

if (invalid.length > 0) {
  console.log('\\n❌ INVALID errorRecovery blocks:');
  for (const { key, problems } of invalid) {
    console.log(\`  \${key}: \${problems.join('; ')}\`);
  }
}

if (missing.length > 0) {
  console.log(\`\\n❌ Missing errorRecovery (\${missing.length} actions):\`);
  // Group by tool
  const byTool = {};
  for (const key of missing) {
    const tool = key.split('.')[0];
    byTool[tool] = byTool[tool] || [];
    byTool[tool].push(key.split('.')[1]);
  }
  for (const [tool, actions] of Object.entries(byTool)) {
    console.log(\`  \${tool} (\${actions.length}): \${actions.slice(0,5).join(', ')}\${actions.length > 5 ? ' ...' : ''}\`);
  }
  console.log('\\n❌ FAIL: ' + covered + '/' + total + ' actions have errorRecovery');
  process.exit(1);
}

if (entries.length !== total) {
  console.log(\`\\n❌ FAIL: ACTION_ANNOTATIONS has \${entries.length} entries but ACTION_COUNT is \${total}\`);
  process.exit(1);
}

console.log('\\n✅ PASS: ' + covered + '/' + total + ' actions have valid errorRecovery');
`,
    cwd: projectRoot,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }
);

process.stdout.write(result);
