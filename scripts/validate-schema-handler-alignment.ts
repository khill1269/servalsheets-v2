#!/usr/bin/env tsx
/**
 * Schema-Handler Alignment Validator (Advanced AST Parser)
 *
 * Validates that handler switch statements align with schema action enums.
 * Uses shared AST parser from src/utils/ast-schema-parser.ts
 *
 * Exit codes:
 * 0 - All aligned
 * 1 - Misalignments found
 * 2 - Validation error
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  extractSchemaActions,
  extractHandlerCases,
  isSingleActionTool,
} from '../src/utils/ast-schema-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Import deviation tracking
const DEVIATIONS_PATH = path.join(PROJECT_ROOT, 'src/schemas/handler-deviations.ts');

interface HandlerDeviation {
  tool: string;
  reason: string;
  extraCases?: string[];
  missingCases?: string[];
  justification: string;
  addedDate: string;
  reviewedBy?: string;
  reference?: string;
}

// Load deviations dynamically
let ACCEPTABLE_DEVIATIONS: HandlerDeviation[] = [];
try {
  const deviationsContent = fs.readFileSync(DEVIATIONS_PATH, 'utf-8');
  const deviationsMatch = deviationsContent.match(
    /export const ACCEPTABLE_DEVIATIONS: HandlerDeviation\[\] = (\[[\s\S]*?\n\]);/
  );
  if (deviationsMatch) {
    // Use eval with sanitized input (safe since we control the source file)
    // eslint-disable-next-line no-eval
    ACCEPTABLE_DEVIATIONS = eval(deviationsMatch[1]);
  }
} catch (error) {
  console.warn('⚠️  Could not load handler deviations:', (error as Error).message);
  console.warn('   Continuing with empty deviations list...\n');
}

interface AlignmentResult {
  tool: string;
  schemaActions: string[];
  handlerTopLevelCases: string[];
  aligned: boolean;
  extra: string[];
  missing: string[];
  undocumentedExtra: string[];
  undocumentedMissing: string[];
  hasDocumentedDeviations: boolean;
  handlerFile: string;
  schemaFile: string;
}

// Tool name mappings (schema name → handler name)
const HANDLER_NAME_MAP: Record<string, string> = {
  webhook: 'webhooks', // Schema: webhook.ts, Handler: webhooks.ts
};

const TOOLS = [
  'advanced',
  'analyze',
  'appsscript',
  'auth',
  'bigquery',
  'collaborate',
  'composite',
  'compute',
  'confirm',
  'connectors',
  'core',
  'data',
  'dependencies',
  'dimensions',
  'federation',
  'fix',
  'format',
  'history',
  'quality',
  'session',
  'agent',
  'templates',
  'transaction',
  'visualize',
  'webhook',
];

/**
 * Validate alignment for a single tool
 */
function validateTool(tool: string): AlignmentResult {
  const schemaFile = path.join(PROJECT_ROOT, `src/schemas/${tool}.ts`);

  // Handle tool name variations (schema vs handler)
  const handlerName = HANDLER_NAME_MAP[tool] || tool;
  const handlerFile = path.join(PROJECT_ROOT, `src/handlers/${handlerName}.ts`);

  if (!fs.existsSync(schemaFile)) {
    throw new Error(`Schema file not found: ${schemaFile}`);
  }
  if (!fs.existsSync(handlerFile)) {
    throw new Error(`Handler file not found: ${handlerFile}`);
  }

  const schemaActions = extractSchemaActions(schemaFile);
  const handlerCases = extractHandlerCases(handlerFile);

  const extra = handlerCases.filter((c) => !schemaActions.includes(c));
  const missing = schemaActions.filter((a) => !handlerCases.includes(a));

  // Special case: Single-action tools don't need a switch statement
  const isSingleAction = isSingleActionTool(schemaActions, handlerCases);

  // Check for documented deviations
  const deviation = ACCEPTABLE_DEVIATIONS.find((d) => d.tool === tool);
  const documentedExtraCases = new Set(deviation?.extraCases || []);
  const documentedMissingCases = new Set(deviation?.missingCases || []);

  // Filter undocumented deviations
  const undocumentedExtra = extra.filter((c) => !documentedExtraCases.has(c));
  const undocumentedMissing = missing.filter((a) => !documentedMissingCases.has(a));

  // Tool is aligned if:
  // 1. It's a single-action tool with no switch, OR
  // 2. All deviations are documented
  const hasDocumentedDeviations =
    deviation !== undefined && (extra.length > 0 || missing.length > 0);
  const aligned =
    isSingleAction || (undocumentedExtra.length === 0 && undocumentedMissing.length === 0);

  return {
    tool: `sheets_${tool}`,
    schemaActions,
    handlerTopLevelCases: handlerCases,
    aligned,
    extra,
    missing,
    undocumentedExtra,
    undocumentedMissing,
    hasDocumentedDeviations,
    handlerFile,
    schemaFile,
  };
}

/**
 * Main validation function
 */
function main(): void {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Schema-Handler Alignment Validator');
  console.log('═══════════════════════════════════════════════════════\n');

  const results: AlignmentResult[] = [];
  const errors: { tool: string; error: Error }[] = [];

  for (const tool of TOOLS) {
    try {
      const result = validateTool(tool);
      results.push(result);
    } catch (error) {
      errors.push({ tool, error: error as Error });
      console.error(`❌ Error validating ${tool}: ${(error as Error).message}`);
    }
  }

  // Print results
  console.log('Results:\n');

  const aligned = results.filter((r) => r.aligned);
  const misaligned = results.filter((r) => !r.aligned);

  const alignedWithDeviations = aligned.filter((r) => r.hasDocumentedDeviations);
  const perfectlyAligned = aligned.filter((r) => !r.hasDocumentedDeviations);

  console.log(`✅ Aligned: ${aligned.length}/${results.length} tools\n`);

  if (perfectlyAligned.length > 0) {
    perfectlyAligned.forEach((r) => {
      console.log(`  ✓ ${r.tool}: ${r.schemaActions.length} actions perfectly aligned`);
    });
  }

  if (alignedWithDeviations.length > 0) {
    console.log('');
    alignedWithDeviations.forEach((r) => {
      console.log(
        `  ✓ ${r.tool}: ${r.schemaActions.length} actions + ${r.extra.length} documented aliases`
      );
      if (r.extra.length > 0) {
        console.log(`    📝 Documented aliases: ${r.extra.join(', ')}`);
      }
    });
  }

  if (misaligned.length > 0) {
    console.log(`\n❌ Misaligned: ${misaligned.length} tools (UNDOCUMENTED DEVIATIONS)\n`);

    misaligned.forEach((r) => {
      console.log(`  ✗ ${r.tool}:`);
      console.log(`    Schema: ${r.schemaActions.length} actions`);
      console.log(`    Handler: ${r.handlerTopLevelCases.length} cases`);

      if (r.undocumentedExtra.length > 0) {
        console.log(
          `    ⚠️  UNDOCUMENTED extra cases: ${r.undocumentedExtra.slice(0, 5).join(', ')}${r.undocumentedExtra.length > 5 ? `... (+${r.undocumentedExtra.length - 5} more)` : ''}`
        );
      }
      if (r.undocumentedMissing.length > 0) {
        console.log(
          `    ⚠️  UNDOCUMENTED missing cases: ${r.undocumentedMissing.slice(0, 5).join(', ')}${r.undocumentedMissing.length > 5 ? `... (+${r.undocumentedMissing.length - 5} more)` : ''}`
        );
      }
      if (
        r.extra.length > r.undocumentedExtra.length ||
        r.missing.length > r.undocumentedMissing.length
      ) {
        console.log(
          `    💡 Tip: Add to ACCEPTABLE_DEVIATIONS in src/schemas/handler-deviations.ts`
        );
      }
      console.log('');
    });
  }

  if (errors.length > 0) {
    console.log(`\n⚠️  Errors: ${errors.length} tools\n`);
    errors.forEach(({ tool, error }) => {
      console.log(`  ⚠️  ${tool}: ${error.message}`);
    });
  }

  console.log('\n═══════════════════════════════════════════════════════');

  if (misaligned.length === 0 && errors.length === 0) {
    console.log('  ✅ ALL TOOLS ALIGNED');
    console.log('═══════════════════════════════════════════════════════');
    process.exit(0);
  } else if (errors.length > 0) {
    console.log('  ⚠️  VALIDATION ERRORS FOUND');
    console.log('═══════════════════════════════════════════════════════');
    process.exit(2);
  } else {
    console.log('  ❌ MISALIGNMENTS FOUND');
    console.log('═══════════════════════════════════════════════════════');
    process.exit(1);
  }
}

main();
