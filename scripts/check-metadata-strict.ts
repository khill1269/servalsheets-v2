#!/usr/bin/env tsx
/**
 * Strict Metadata Validation (Non-Mutating)
 *
 * Validates metadata consistency WITHOUT running the generator.
 * This is much faster than check:drift and suitable for CI pre-checks.
 *
 * Validates:
 * 1. TOOL_COUNT matches TOOL_DEFINITIONS.length
 * 2. ACTION_COUNT matches sum of TOOL_ACTIONS
 * 3. Tool names are consistent across all maps (including ACTION_METADATA)
 * 4. ACTION_COUNTS matches actual action array lengths
 * 5. ACTION_METADATA includes all tool entries
 * 6. No zero-action tools
 *
 * Exit codes:
 * - 0: All validations passed
 * - 1: Validation errors detected
 */

import { TOOL_DEFINITIONS } from '../src/mcp/registration/tool-definitions.js';
import { TOOL_COUNT, ACTION_COUNT } from '../src/schemas/index.js';
import { TOOL_ACTIONS } from '../src/mcp/completions.js';
import { ACTION_COUNTS, TOOL_ANNOTATIONS } from '../src/schemas/annotations.js';
import { ACTION_METADATA } from '../src/schemas/action-metadata.js';

interface ValidationError {
  file: string;
  issue: string;
  expected: number | string;
  actual: number | string;
}

const errors: ValidationError[] = [];
const warnings: string[] = [];

console.log('🔍 Running strict metadata validation...\n');

// ============================================================================
// VALIDATION 1: TOOL_COUNT Consistency
// ============================================================================

const actualToolCount = TOOL_DEFINITIONS.length;
if (TOOL_COUNT !== actualToolCount) {
  errors.push({
    file: 'src/schemas/index.ts',
    issue: 'TOOL_COUNT constant',
    expected: actualToolCount,
    actual: TOOL_COUNT,
  });
}

console.log(
  TOOL_COUNT === actualToolCount ? '✅' : '❌',
  `TOOL_COUNT: ${TOOL_COUNT} (TOOL_DEFINITIONS: ${actualToolCount})`
);

// ============================================================================
// VALIDATION 2: ACTION_COUNT Consistency
// ============================================================================

const actualActionCount = Object.values(TOOL_ACTIONS).reduce(
  (sum, actions) => sum + actions.length,
  0
);

if (ACTION_COUNT !== actualActionCount) {
  errors.push({
    file: 'src/schemas/index.ts',
    issue: 'ACTION_COUNT constant',
    expected: actualActionCount,
    actual: ACTION_COUNT,
  });
}

console.log(
  ACTION_COUNT === actualActionCount ? '✅' : '❌',
  `ACTION_COUNT: ${ACTION_COUNT} (calculated from TOOL_ACTIONS: ${actualActionCount})`
);

// ============================================================================
// VALIDATION 3: ACTION_COUNTS Sum Consistency
// ============================================================================

const actionCountsSum = Object.values(ACTION_COUNTS).reduce((a, b) => a + b, 0);
if (actionCountsSum !== ACTION_COUNT) {
  errors.push({
    file: 'src/generated/action-counts.ts',
    issue: 'ACTION_COUNTS sum',
    expected: ACTION_COUNT,
    actual: actionCountsSum,
  });
}

console.log(
  actionCountsSum === ACTION_COUNT ? '✅' : '❌',
  `ACTION_COUNTS sum: ${actionCountsSum} (ACTION_COUNT: ${ACTION_COUNT})`
);

// ============================================================================
// VALIDATION 4: Cross-Map Tool Name Consistency
// ============================================================================

const defTools = TOOL_DEFINITIONS.map((t) => t.name).sort();
const actTools = Object.keys(TOOL_ACTIONS).sort();
const countTools = Object.keys(ACTION_COUNTS).sort();
const annTools = Object.keys(TOOL_ANNOTATIONS).sort();
const metaTools = Object.keys(ACTION_METADATA).sort();

const defToolsStr = JSON.stringify(defTools);
const actToolsStr = JSON.stringify(actTools);
const countToolsStr = JSON.stringify(countTools);
const annToolsStr = JSON.stringify(annTools);
const metaToolsStr = JSON.stringify(metaTools);

let crossMapConsistent = true;

if (defToolsStr !== actToolsStr) {
  errors.push({
    file: 'Cross-map consistency',
    issue: 'TOOL_DEFINITIONS vs TOOL_ACTIONS',
    expected: defTools.join(', '),
    actual: actTools.join(', '),
  });
  crossMapConsistent = false;
}

if (defToolsStr !== countToolsStr) {
  errors.push({
    file: 'Cross-map consistency',
    issue: 'TOOL_DEFINITIONS vs ACTION_COUNTS',
    expected: defTools.join(', '),
    actual: countTools.join(', '),
  });
  crossMapConsistent = false;
}

if (defToolsStr !== annToolsStr) {
  errors.push({
    file: 'Cross-map consistency',
    issue: 'TOOL_DEFINITIONS vs TOOL_ANNOTATIONS',
    expected: defTools.join(', '),
    actual: annTools.join(', '),
  });
  crossMapConsistent = false;
}

if (defToolsStr !== metaToolsStr) {
  errors.push({
    file: 'Cross-map consistency',
    issue: 'TOOL_DEFINITIONS vs ACTION_METADATA',
    expected: defTools.join(', '),
    actual: metaTools.join(', '),
  });
  crossMapConsistent = false;
}

console.log(
  crossMapConsistent ? '✅' : '❌',
  `Cross-map tool names (${defTools.length} tools across 5 maps)`
);

// ============================================================================
// VALIDATION 5: Per-Tool Action Count Accuracy
// ============================================================================

let perToolAccurate = true;
const mismatchedTools: string[] = [];

for (const [toolName, expectedCount] of Object.entries(ACTION_COUNTS)) {
  const actualActions = TOOL_ACTIONS[toolName];

  if (!actualActions) {
    errors.push({
      file: 'src/generated/completions.ts',
      issue: `Missing tool in TOOL_ACTIONS`,
      expected: toolName,
      actual: 'undefined',
    });
    perToolAccurate = false;
    continue;
  }

  const metadataActions = ACTION_METADATA[toolName];
  if (!metadataActions) {
    errors.push({
      file: 'src/schemas/action-metadata.ts',
      issue: `Missing tool in ACTION_METADATA`,
      expected: toolName,
      actual: 'undefined',
    });
    perToolAccurate = false;
    continue;
  }

  if (actualActions.length !== expectedCount) {
    errors.push({
      file: `ACTION_COUNTS vs TOOL_ACTIONS`,
      issue: `${toolName} action count mismatch`,
      expected: expectedCount,
      actual: actualActions.length,
    });
    mismatchedTools.push(`${toolName}: expected ${expectedCount}, got ${actualActions.length}`);
    perToolAccurate = false;
  }
}

console.log(
  perToolAccurate ? '✅' : '❌',
  `Per-tool action counts ${perToolAccurate ? 'accurate' : `(${mismatchedTools.length} mismatches)`}`
);

if (!perToolAccurate && mismatchedTools.length > 0) {
  console.log('   Mismatches:');
  mismatchedTools.forEach((m) => console.log(`   - ${m}`));
}

// ============================================================================
// VALIDATION 6: No Zero-Action Tools
// ============================================================================

const zeroActionTools: string[] = [];

for (const [toolName, count] of Object.entries(ACTION_COUNTS)) {
  if (count === 0) {
    errors.push({
      file: 'src/generated/action-counts.ts',
      issue: `${toolName} has zero actions`,
      expected: '> 0',
      actual: 0,
    });
    zeroActionTools.push(toolName);
  }
}

console.log(
  zeroActionTools.length === 0 ? '✅' : '❌',
  `No zero-action tools ${zeroActionTools.length > 0 ? `(found ${zeroActionTools.length})` : ''}`
);

// ============================================================================
// VALIDATION 7: No Duplicate Actions Within Tools
// ============================================================================

const toolsWithDuplicates: string[] = [];

for (const [toolName, actions] of Object.entries(TOOL_ACTIONS)) {
  const uniqueActions = new Set(actions);
  if (uniqueActions.size !== actions.length) {
    errors.push({
      file: 'src/generated/completions.ts',
      issue: `${toolName} has duplicate actions`,
      expected: `${actions.length} unique actions`,
      actual: `${uniqueActions.size} unique, ${actions.length - uniqueActions.size} duplicates`,
    });
    toolsWithDuplicates.push(toolName);
  }
}

console.log(
  toolsWithDuplicates.length === 0 ? '✅' : '❌',
  `No duplicate actions ${toolsWithDuplicates.length > 0 ? `(found in ${toolsWithDuplicates.length} tools)` : ''}`
);

// ============================================================================
// VALIDATION 8: Tool Naming Convention
// ============================================================================

const invalidToolNames: string[] = [];
const toolNamePattern = /^sheets_[a-z][a-z0-9_]*$/;

for (const toolName of Object.keys(TOOL_ACTIONS)) {
  if (!toolNamePattern.test(toolName)) {
    errors.push({
      file: 'Tool naming',
      issue: `Invalid tool name: ${toolName}`,
      expected: 'sheets_[a-z][a-z0-9_]*',
      actual: toolName,
    });
    invalidToolNames.push(toolName);
  }
}

console.log(
  invalidToolNames.length === 0 ? '✅' : '❌',
  `Tool naming convention (sheets_*) ${invalidToolNames.length > 0 ? `(${invalidToolNames.length} invalid)` : ''}`
);

// ============================================================================
// VALIDATION 9: Sanity Checks
// ============================================================================

let sanityPassed = true;

// Tool count should be reasonable (20-30)
if (TOOL_COUNT < 20 || TOOL_COUNT > 30) {
  warnings.push(
    `TOOL_COUNT (${TOOL_COUNT}) outside expected range (20-30). This may indicate a data issue.`
  );
  sanityPassed = false;
}

// Action count should be reasonable (350-500)
if (ACTION_COUNT < 350 || ACTION_COUNT > 500) {
  warnings.push(
    `ACTION_COUNT (${ACTION_COUNT}) outside expected range (350-500). This may indicate a data issue.`
  );
  sanityPassed = false;
}

console.log(
  sanityPassed ? '✅' : '⚠️',
  `Sanity checks (tool/action counts within expected ranges)`
);

// ============================================================================
// SUMMARY AND EXIT
// ============================================================================

console.log('\n' + '='.repeat(70));

if (warnings.length > 0) {
  console.log('\n⚠️  WARNINGS:\n');
  warnings.forEach((w) => console.log(`  ${w}`));
}

if (errors.length === 0) {
  console.log('\n✅ METADATA VALIDATION PASSED');
  console.log(`\n   ${TOOL_COUNT} tools, ${ACTION_COUNT} actions`);
  console.log('   All metadata maps are synchronized.\n');
  process.exit(0);
} else {
  console.log('\n❌ METADATA VALIDATION FAILED\n');
  console.log(`   Found ${errors.length} error(s):\n`);

  errors.forEach((e) => {
    console.error(`   ${e.file}:`);
    console.error(`     Issue: ${e.issue}`);
    console.error(`     Expected: ${e.expected}`);
    console.error(`     Actual: ${e.actual}\n`);
  });

  console.log('   Run "npm run gen:metadata" to regenerate metadata.\n');
  process.exit(1);
}
