#!/usr/bin/env tsx
/**
 * ServalSheets - Integration Verification
 *
 * Verifies all core integration wiring:
 * - Tools -> handlers -> schemas -> descriptions -> annotations
 * - Action counts -> completions parity
 * - MCP feature files and registration paths
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { TOOL_DEFINITIONS } from '../src/mcp/registration/tool-definitions.js';
import { TOOL_ACTIONS } from '../src/mcp/completions.js';
import { ACTION_COUNTS } from '../src/schemas/annotations.js';
import { TOOL_DESCRIPTIONS } from '../src/schemas/descriptions.js';
import { TOOL_ANNOTATIONS } from '../src/schemas/annotations.js';
import { ACTION_COUNT, TOOL_COUNT } from '../src/schemas/action-counts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Issue {
  severity: 'error' | 'warning';
  component: string;
  message: string;
}

const issues: Issue[] = [];

function addIssue(severity: 'error' | 'warning', component: string, message: string): void {
  issues.push({ severity, component, message });
}

function shortToolName(toolName: string): string {
  return toolName.replace(/^sheets_/, '');
}

function getHandlerFileName(toolName: string): string {
  const short = shortToolName(toolName);
  return short === 'webhook' ? 'webhooks.ts' : `${short}.ts`;
}

console.log('🔍 ServalSheets Integration Verification\n');
console.log(`Checking ${TOOL_COUNT} tools with ${ACTION_COUNT} actions across all components...\n`);

const expectedTools = TOOL_DEFINITIONS.map((tool) => tool.name).sort();

// ============================================================================
// 1. TOOL DEFINITIONS
// ============================================================================

console.log('📋 Verifying Tool Definitions...');
for (const tool of expectedTools) {
  console.log(`  ✅ ${tool} defined`);
}

// ============================================================================
// 2. HANDLERS + REGISTRATION
// ============================================================================

console.log('\n🛠️  Verifying Handlers...');
const handlerDir = path.join(__dirname, '../src/handlers');

for (const tool of expectedTools) {
  const handlerFile = getHandlerFileName(tool);
  const handlerPath = path.join(handlerDir, handlerFile);
  if (fs.existsSync(handlerPath)) {
    console.log(`  ✅ ${tool} -> ${handlerFile}`);
  } else {
    addIssue('error', 'handlers', `Missing handler file: ${handlerFile} for ${tool}`);
  }
}

console.log('\n📝 Verifying Handler Registration...');
const toolHandlersPath = path.join(__dirname, '../src/mcp/registration/tool-handlers.ts');
const toolHandlersContent = fs.readFileSync(toolHandlersPath, 'utf-8');
for (const tool of expectedTools) {
  if (toolHandlersContent.includes(`${tool}:`)) {
    console.log(`  ✅ ${tool} registered in handler map`);
  } else {
    addIssue('error', 'handler-registration', `${tool} not registered in createToolHandlerMap`);
  }
}

// ============================================================================
// 3. SCHEMAS
// ============================================================================

console.log('\n📐 Verifying Schemas...');
const schemaDir = path.join(__dirname, '../src/schemas');
for (const tool of expectedTools) {
  const schemaFile = `${shortToolName(tool)}.ts`;
  const schemaPath = path.join(schemaDir, schemaFile);
  if (fs.existsSync(schemaPath)) {
    console.log(`  ✅ ${tool} -> ${schemaFile}`);
  } else {
    addIssue('error', 'schemas', `Missing schema file: ${schemaFile} for ${tool}`);
  }
}

// ============================================================================
// 4. DESCRIPTIONS + ANNOTATIONS
// ============================================================================

console.log('\n📖 Verifying Descriptions...');
for (const tool of expectedTools) {
  if (TOOL_DESCRIPTIONS[tool]) {
    console.log(`  ✅ ${tool} has description (${TOOL_DESCRIPTIONS[tool].length} chars)`);
  } else {
    addIssue('error', 'descriptions', `Missing description for ${tool}`);
  }
}

console.log('\n🏷️  Verifying Annotations...');
for (const tool of expectedTools) {
  if (TOOL_ANNOTATIONS[tool]) {
    console.log(`  ✅ ${tool} has annotations`);
  } else {
    addIssue('error', 'annotations', `Missing annotations for ${tool}`);
  }
}

// ============================================================================
// 5. ACTION COUNTS + COMPLETIONS
// ============================================================================

console.log('\n🔢 Verifying Action Counts...');
let totalActions = 0;
for (const tool of expectedTools) {
  const count = ACTION_COUNTS[tool];
  if (count !== undefined) {
    totalActions += count;
    console.log(`  ✅ ${tool}: ${count} actions`);
  } else {
    addIssue('error', 'action-counts', `Missing action count for ${tool}`);
  }
}

if (totalActions !== ACTION_COUNT) {
  addIssue('error', 'action-counts', `Total actions: ${totalActions}, expected: ${ACTION_COUNT}`);
} else {
  console.log(`\n  ✅ Total: ${totalActions} actions (matches action-counts.ts)`);
}

console.log('\n⌨️  Verifying Completion Actions...');
for (const tool of expectedTools) {
  if (!TOOL_ACTIONS[tool]) {
    addIssue('error', 'completions', `Missing completion actions for ${tool}`);
    continue;
  }

  const completionCount = TOOL_ACTIONS[tool].length;
  const expectedCount = ACTION_COUNTS[tool];
  if (completionCount === expectedCount) {
    console.log(`  ✅ ${tool}: ${completionCount} completion actions`);
  } else {
    addIssue(
      'error',
      'completions',
      `${tool}: completion count ${completionCount} does not match expected ${expectedCount}`
    );
  }
}

// ============================================================================
// 6. RESOURCES + PROMPTS + FEATURES
// ============================================================================

console.log('\n📦 Verifying Resources...');
const resourceRegPath = path.join(__dirname, '../src/mcp/registration/resource-registration.ts');
const resourceRegContent = fs.readFileSync(resourceRegPath, 'utf-8');
const resourceMarkers = [
  'registerServalSheetsResources',
  'registerChartResources',
  'registerPivotResources',
  'registerQualityResources',
];
for (const marker of resourceMarkers) {
  if (resourceRegContent.includes(marker)) {
    console.log(`  ✅ Resource marker: ${marker}`);
  } else {
    addIssue('warning', 'resources', `Resource marker missing: ${marker}`);
  }
}

console.log('\n💬 Verifying Prompts...');
const promptRegPath = path.join(__dirname, '../src/mcp/registration/prompt-registration.ts');
const promptRegContent = fs.readFileSync(promptRegPath, 'utf-8');
const promptMarkers = ['registerPrompt', 'analyze', 'fix', 'visualize'];
for (const marker of promptMarkers) {
  if (promptRegContent.includes(marker)) {
    console.log(`  ✅ Prompt marker: ${marker}`);
  } else {
    addIssue('warning', 'prompts', `Prompt marker missing: ${marker}`);
  }
}

console.log('\n🎯 Verifying MCP 2025-11-25 Features...');
const featuresPath = path.join(__dirname, '../src/mcp/features-2025-11-25.ts');
const featuresContent = fs.readFileSync(featuresPath, 'utf-8');
const requiredFeatures = [
  'TOOL_EXECUTION_CONFIG',
  'TOOL_ICONS',
  'createServerCapabilities',
  'getServerInstructions',
  'taskSupport',
];
for (const feature of requiredFeatures) {
  if (featuresContent.includes(feature)) {
    console.log(`  ✅ Feature: ${feature}`);
  } else {
    addIssue('error', 'mcp-features', `Missing MCP feature: ${feature}`);
  }
}

// ============================================================================
// REPORT
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log('📊 VERIFICATION REPORT');
console.log('='.repeat(80));

const errors = issues.filter((i) => i.severity === 'error');
const warnings = issues.filter((i) => i.severity === 'warning');

console.log(`\nTotal Issues: ${issues.length}`);
console.log(`  🔴 Errors: ${errors.length}`);
console.log(`  🟡 Warnings: ${warnings.length}`);

if (issues.length === 0) {
  console.log('\n✅ All components are properly wired and integrated.\n');
  console.log('Summary:');
  console.log(`  • ${TOOL_COUNT} tools defined and registered`);
  console.log(`  • ${ACTION_COUNT} actions implemented`);
  console.log('  • All handlers present');
  console.log('  • All schemas defined');
  console.log('  • All descriptions present');
  console.log('  • MCP 2025-11-25 features implemented');
  process.exit(0);
}

console.log('\n❌ Issues found:\n');
for (const issue of issues) {
  const icon = issue.severity === 'error' ? '🔴' : '🟡';
  console.log(`${icon} [${issue.component}] ${issue.message}`);
}
process.exit(errors.length > 0 ? 1 : 0);
