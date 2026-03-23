#!/usr/bin/env node
/**
 * verify-aliases.mjs
 * Verifies ACTION_ALIASES coverage across all 25 tools.
 * Parses completions.ts as text (ACTION_ALIASES is a private const, not exported).
 * Target: all 25 tools have ≥3 aliases, no alias points to nonexistent tool.action.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

const root = process.cwd();
const completionsFile = readFileSync(resolve(root, 'src/mcp/completions.ts'), 'utf-8');

// Extract the ACTION_ALIASES block from the file
const aliasBlockMatch = completionsFile.match(
  /const ACTION_ALIASES:\s*Record<string,\s*string>\s*=\s*\{([\s\S]*?)\n\};/
);
if (!aliasBlockMatch) {
  console.error('ERROR: Could not find ACTION_ALIASES block in completions.ts');
  process.exit(1);
}

const aliasBlock = aliasBlockMatch[1];

// Parse alias → action pairs (handles both 'quoted key': 'value' and bare: 'value' forms)
const aliasEntries = [];
const aliasLineRe = /^\s*'([^']+)':\s*'([^']+)'/gm;
const bareAliasLineRe = /^\s*(\w+):\s*'([^']+)'/gm;

let m;
while ((m = aliasLineRe.exec(aliasBlock)) !== null) {
  aliasEntries.push({ phrase: m[1], actionName: m[2] });
}
while ((m = bareAliasLineRe.exec(aliasBlock)) !== null) {
  aliasEntries.push({ phrase: m[1], actionName: m[2] });
}

// Load TOOL_ACTIONS via tsx (it IS exported)
const toolActionsJson = execSync(
  `node --import tsx --input-type=module`,
  {
    input: `
import { TOOL_ACTIONS } from './src/mcp/completions.ts';
process.stdout.write(JSON.stringify(TOOL_ACTIONS));
`,
    cwd: root,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }
);

const TOOL_ACTIONS = JSON.parse(toolActionsJson);
const tools = Object.keys(TOOL_ACTIONS);
const totalAliases = aliasEntries.length;

// Group aliases by resolved tool
const aliasByTool = {};
const deadAliases = [];

for (const { phrase, actionName } of aliasEntries) {
  let found = false;
  for (const [tool, actions] of Object.entries(TOOL_ACTIONS)) {
    if (actions.includes(actionName)) {
      aliasByTool[tool] = aliasByTool[tool] || [];
      aliasByTool[tool].push(phrase);
      found = true;
      break;
    }
  }
  if (!found) deadAliases.push({ phrase, actionName });
}

const zeroCoverage = tools.filter((t) => !aliasByTool[t]);
const lowCoverage = tools.filter((t) => aliasByTool[t] && aliasByTool[t].length < 3);

console.log('\n══════════════════════════════════════════════════');
console.log('  Action Alias Coverage Verification');
console.log('══════════════════════════════════════════════════');
console.log(`  Total aliases:        ${totalAliases}`);
console.log(`  Tools covered:        ${Object.keys(aliasByTool).length}/${tools.length}`);
console.log(`  Zero-coverage tools:  ${zeroCoverage.length}`);
console.log(`  Low-coverage (<3):    ${lowCoverage.length}`);
console.log(`  Dead aliases:         ${deadAliases.length}`);

console.log('\n  Per-tool alias count:');
for (const tool of tools) {
  const count = aliasByTool[tool]?.length ?? 0;
  const status = count === 0 ? '❌' : count < 3 ? '⚠️ ' : '✅';
  console.log(`  ${status} ${tool.padEnd(25)} ${count} aliases`);
}

let failed = false;

if (deadAliases.length > 0) {
  console.log('\n❌ Dead aliases (point to nonexistent actions):');
  deadAliases.forEach((d) => console.log(`  "${d.phrase}" → "${d.actionName}" (not found in any tool)`));
  failed = true;
}

if (zeroCoverage.length > 0) {
  console.log('\n❌ Zero-coverage tools:');
  zeroCoverage.forEach((t) => console.log(`  ${t}`));
  failed = true;
}

if (failed) {
  console.log('\n❌ FAIL');
  process.exit(1);
}

console.log(`\n✅ PASS: ${totalAliases} aliases across all ${tools.length} tools`);
