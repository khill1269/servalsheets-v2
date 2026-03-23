#!/usr/bin/env tsx
/**
 * Token Budget Calculator for ServalSheets
 *
 * Estimates token footprint across different configuration combinations.
 * Helps users choose the optimal settings for their context window budget.
 *
 * Usage: npm run token:budget
 *        tsx scripts/token-budget.ts
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// Approximate tokens per character ratio (GPT/Claude tokenizer average)
const CHARS_PER_TOKEN = 4;

// Tool configurations
interface ToolConfig {
  mode: 'full' | 'standard' | 'lite';
  deferSchemas: boolean;
  deferDescriptions: boolean;
  label: string;
}

const CONFIGURATIONS: ToolConfig[] = [
  { mode: 'full', deferSchemas: false, deferDescriptions: false, label: 'full + no-defer' },
  { mode: 'full', deferSchemas: true, deferDescriptions: false, label: 'full + defer-schemas' },
  { mode: 'standard', deferSchemas: false, deferDescriptions: false, label: 'standard + no-defer' },
  {
    mode: 'standard',
    deferSchemas: true,
    deferDescriptions: false,
    label: 'standard + defer-schemas',
  },
  { mode: 'standard', deferSchemas: true, deferDescriptions: true, label: 'standard + defer-all' },
  { mode: 'lite', deferSchemas: true, deferDescriptions: true, label: 'lite + defer-all' },
];

// Tool categories by mode
const ENTERPRISE_TOOLS = ['bigquery', 'appsscript', 'templates', 'webhook', 'dependencies'];
const LITE_TOOLS = ['auth', 'core', 'data', 'format', 'dimensions'];

// Read schema files to estimate sizes
const schemasDir = join(ROOT, 'src/schemas');
const schemaFiles = readdirSync(schemasDir).filter(
  (f) =>
    f.endsWith('.ts') &&
    f !== 'index.ts' &&
    f !== 'shared.ts' &&
    f !== 'annotations.ts' &&
    f !== 'descriptions.ts' &&
    f !== 'descriptions-minimal.ts' &&
    f !== 'prompts.ts' &&
    f !== 'logging.ts' &&
    f !== 'fast-validators.ts' &&
    f !== 'action-metadata.ts' &&
    f !== 'formulas.ts' &&
    f !== 'analysis.ts'
);

interface ToolEstimate {
  name: string;
  schemaChars: number;
  isEnterprise: boolean;
  isLite: boolean;
}

const tools: ToolEstimate[] = schemaFiles.map((file) => {
  const name = file.replace('.ts', '').replace(/-/g, '_');
  const content = readFileSync(join(schemasDir, file), 'utf-8');
  return {
    name,
    schemaChars: content.length,
    isEnterprise: ENTERPRISE_TOOLS.includes(name),
    isLite: LITE_TOOLS.includes(name),
  };
});

// Read descriptions file for description size estimates
let fullDescriptionChars = 0;
let minimalDescriptionChars = 0;

try {
  const descFile = readFileSync(join(schemasDir, 'descriptions.ts'), 'utf-8');
  fullDescriptionChars = descFile.length;
} catch {
  fullDescriptionChars = 31000; // Fallback estimate
}

try {
  const minDescFile = readFileSync(join(schemasDir, 'descriptions-minimal.ts'), 'utf-8');
  minimalDescriptionChars = minDescFile.length;
} catch {
  minimalDescriptionChars = 3000; // Fallback estimate
}

const CONTEXT_WINDOW = 200_000;

console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
console.log('║               ServalSheets Token Budget Calculator                  ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

console.log(`Total schema files: ${tools.length}`);
console.log(
  `Enterprise tools: ${tools.filter((t) => t.isEnterprise).length} (${ENTERPRISE_TOOLS.join(', ')})`
);
console.log(
  `Core (lite) tools: ${tools.filter((t) => t.isLite).length} (${LITE_TOOLS.join(', ')})`
);
console.log(
  `Standard tools: ${tools.filter((t) => !t.isEnterprise).length} (all except enterprise)`
);
console.log('');

// Estimate for each configuration
const DEFERRED_SCHEMA_PER_TOOL = 200; // ~200 chars for passthrough schema
const DEFERRED_DESC_PER_TOOL = 100; // ~100 chars for minimal description
const FULL_DESC_PER_TOOL = Math.round(fullDescriptionChars / tools.length);
const MINIMAL_DESC_PER_TOOL = Math.round(minimalDescriptionChars / tools.length);

const header = 'Configuration'.padEnd(35) + '│ Tools │ Est. Tokens │ % of 200K │ Budget Left';
const separator = '─'.repeat(35) + '┼───────┼─────────────┼───────────┼────────────';

console.log(header);
console.log(separator);

for (const config of CONFIGURATIONS) {
  // Filter tools by mode
  let activeTools: ToolEstimate[];
  if (config.mode === 'lite') {
    activeTools = tools.filter((t) => t.isLite);
  } else if (config.mode === 'standard') {
    activeTools = tools.filter((t) => !t.isEnterprise);
  } else {
    activeTools = tools;
  }

  // Calculate schema size
  let schemaChars: number;
  if (config.deferSchemas) {
    schemaChars = activeTools.length * DEFERRED_SCHEMA_PER_TOOL;
  } else {
    schemaChars = activeTools.reduce((sum, t) => sum + t.schemaChars, 0);
  }

  // Calculate description size
  let descChars: number;
  if (config.deferDescriptions) {
    descChars = activeTools.length * DEFERRED_DESC_PER_TOOL;
  } else {
    descChars = activeTools.length * FULL_DESC_PER_TOOL;
  }

  const totalChars = schemaChars + descChars;
  const estTokens = Math.round(totalChars / CHARS_PER_TOKEN);
  const pctOfWindow = ((estTokens / CONTEXT_WINDOW) * 100).toFixed(1);
  const budgetLeft = CONTEXT_WINDOW - estTokens;

  const toolCount = String(activeTools.length).padStart(4);
  const tokenStr = estTokens.toLocaleString().padStart(10);
  const pctStr = `${pctOfWindow}%`.padStart(8);
  const budgetStr = budgetLeft.toLocaleString().padStart(9);

  console.log(
    `${config.label.padEnd(35)}│${toolCount}   │${tokenStr}   │${pctStr}   │${budgetStr}`
  );
}

console.log('');
console.log('┌──────────────────────────────────────────────────────────────────────┐');
console.log('│ Recommendations:                                                     │');
console.log('│                                                                      │');
console.log('│  Claude Desktop (STDIO): standard + defer-all (auto-detected)        │');
console.log('│  HTTP/Remote Server:     full + no-defer (auto-detected)              │');
console.log('│  Token-constrained:      lite + defer-all                             │');
console.log('│                                                                      │');
console.log('│ Override defaults via environment variables:                          │');
console.log('│  SERVAL_TOOL_MODE=full|standard|lite                                 │');
console.log('│  SERVAL_DEFER_SCHEMAS=true|false                                     │');
console.log('│  SERVAL_DEFER_DESCRIPTIONS=true|false                                │');
console.log('└──────────────────────────────────────────────────────────────────────┘');
console.log('');
