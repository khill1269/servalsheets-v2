#!/usr/bin/env tsx
/**
 * Test script to show tools/list JSON Schema output
 *
 * This helps verify that tool schemas expose proper fields to MCP clients.
 *
 * Before fix: Should show only "request*" parameter
 * After fix: Should show "action", "spreadsheetId", "range", etc. at top level
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  SheetsAuthInputSchema,
  SheetsCoreInputSchema,
  SheetsDataInputSchema,
  SheetsFormatInputSchema,
  SheetsDimensionsInputSchema,
  SheetsVisualizeInputSchema,
  SheetsCollaborateInputSchema,
  SheetsAdvancedInputSchema,
  SheetsTransactionInputSchema,
  SheetsQualityInputSchema,
  SheetsHistoryInputSchema,
  SheetsConfirmInputSchema,
  SheetsAnalyzeInputSchema,
  SheetsFixInputSchema,
  CompositeInputSchema,
  SheetsSessionInputSchema,
} from '../src/schemas/index.js';

console.log('='.repeat(80));
console.log('TOOLS/LIST JSON SCHEMA OUTPUT');
console.log('='.repeat(80));
console.log();

const tools = [
  { name: 'sheets_auth', schema: SheetsAuthInputSchema },
  { name: 'sheets_core', schema: SheetsCoreInputSchema },
  { name: 'sheets_data', schema: SheetsDataInputSchema },
  { name: 'sheets_format', schema: SheetsFormatInputSchema },
  { name: 'sheets_dimensions', schema: SheetsDimensionsInputSchema },
  { name: 'sheets_visualize', schema: SheetsVisualizeInputSchema },
  { name: 'sheets_collaborate', schema: SheetsCollaborateInputSchema },
  { name: 'sheets_advanced', schema: SheetsAdvancedInputSchema },
  { name: 'sheets_transaction', schema: SheetsTransactionInputSchema },
  { name: 'sheets_quality', schema: SheetsQualityInputSchema },
  { name: 'sheets_history', schema: SheetsHistoryInputSchema },
  { name: 'sheets_confirm', schema: SheetsConfirmInputSchema },
  { name: 'sheets_analyze', schema: SheetsAnalyzeInputSchema },
  { name: 'sheets_fix', schema: SheetsFixInputSchema },
  { name: 'sheets_composite', schema: CompositeInputSchema },
  { name: 'sheets_session', schema: SheetsSessionInputSchema },
];

for (const tool of tools) {
  console.log(`\n📋 Tool: ${tool.name}`);
  console.log('-'.repeat(80));

  const jsonSchema = zodToJsonSchema(tool.schema, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  });

  // Remove $schema property
  const { $schema: _, ...schemaWithoutDollar } = jsonSchema as Record<string, unknown>;

  console.log(JSON.stringify(schemaWithoutDollar, null, 2));

  // Show what MCP clients see
  const properties = (schemaWithoutDollar as any).properties || {};
  const required = (schemaWithoutDollar as any).required || [];
  const anyOf = (schemaWithoutDollar as any).anyOf;
  const oneOf = (schemaWithoutDollar as any).oneOf;

  console.log('\n🔍 MCP Client View:');

  // Check if this is a discriminated union (anyOf/oneOf at root)
  if (anyOf || oneOf) {
    const branches = anyOf || oneOf;
    const firstBranch = branches[0];
    const branchProperties = firstBranch?.properties || {};
    const hasActionInBranches = 'action' in branchProperties;

    console.log(`   Schema Type: Discriminated Union (${anyOf ? 'anyOf' : 'oneOf'})`);
    console.log(`   Branches: ${branches.length}`);
    console.log(`   Fields in branches: ${Object.keys(branchProperties).join(', ')}`);
    console.log(`   ✅ 'action' field visible: ${hasActionInBranches}`);

    if (hasActionInBranches) {
      console.log('   ✅ CORRECT: Discriminated union exposes all fields properly');
    }
  } else {
    // Object with properties at top level
    console.log(`   Parameters: ${Object.keys(properties).join(', ') || '(none)'}`);
    console.log(`   Required: ${required.join(', ') || '(none)'}`);

    // Check if action field is visible at top level
    const hasActionAtTopLevel = 'action' in properties;
    console.log(`   ⚠️  'action' visible at top level: ${hasActionAtTopLevel}`);

    if (!hasActionAtTopLevel && 'request' in properties) {
      console.log("   ❌ PROBLEM: Only 'request' is visible, actual fields are hidden");
    }
  }

  console.log();
}

console.log('='.repeat(80));
console.log('\n✅ Schema conversion uses z.toJSONSchema via utils/schema-compat.');
console.log('   tools/list should expose action fields even with request wrappers.\n');
