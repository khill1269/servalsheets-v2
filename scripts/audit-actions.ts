/**
 * Audit script to extract all actual actions from handler implementations
 * and compare them against schema definitions.
 *
 * Run: npx tsx scripts/audit-actions.ts
 *
 * This script:
 * 1. Scans all handler files for case statement actions
 * 2. Compares against schema enum definitions
 * 3. Reports discrepancies and missing actions
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const HANDLERS_DIR = './src/handlers';
const SCHEMAS_DIR = './src/schemas';

interface ActionInfo {
  tool: string;
  action: string;
  line: number;
}

/**
 * Extract actions from a handler file by finding case statements
 */
function extractHandlerActions(filename: string, content: string): ActionInfo[] {
  const actions: ActionInfo[] = [];
  const toolName = `sheets_${filename.replace('.ts', '')}`;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: case 'action_name': or case "action_name":
    const match = line.match(/case\s+['"]([a-z_]+)['"]\s*:/);
    if (match) {
      actions.push({
        tool: toolName,
        action: match[1],
        line: i + 1,
      });
    }
  }

  return actions;
}

/**
 * Extract actions from a schema file by finding z.enum definitions
 */
function extractSchemaActions(_filename: string, content: string): string[] {
  // Match z.enum([...]) patterns
  // This regex finds the action enum array
  const enumMatch = content.match(/action:\s*z\.enum\(\[\s*([^\]]+)\]/s);
  if (!enumMatch) {
    return [];
  }

  // Extract individual actions from the enum array
  const actionsText = enumMatch[1];
  const actions = actionsText.match(/['"]([a-z_]+)['"]/g)?.map((m) => m.replace(/['"]/g, '')) || [];

  return actions;
}

/**
 * Main audit execution
 */
function runAudit(): void {
  console.log('='.repeat(70));
  console.log('ACTION AUDIT RESULTS');
  console.log('='.repeat(70));
  console.log();

  // Get all handler files
  const handlerFiles = readdirSync(HANDLERS_DIR).filter(
    (f) =>
      f.endsWith('.ts') && !['index.ts', 'base.ts', 'logging.ts', 'optimization.ts'].includes(f)
  );

  // Get all schema files
  const schemaFiles = readdirSync(SCHEMAS_DIR).filter(
    (f) => f.endsWith('.ts') && !['index.ts', 'shared.ts'].includes(f)
  );

  const handlerActionsByTool: Record<string, ActionInfo[]> = {};
  const schemaActionsByTool: Record<string, string[]> = {};

  // Extract actions from handlers
  for (const file of handlerFiles) {
    const content = readFileSync(join(HANDLERS_DIR, file), 'utf-8');
    const actions = extractHandlerActions(file, content);
    const toolName = `sheets_${file.replace('.ts', '')}`;
    handlerActionsByTool[toolName] = actions;
  }

  // Extract actions from schemas
  for (const file of schemaFiles) {
    const content = readFileSync(join(SCHEMAS_DIR, file), 'utf-8');
    const actions = extractSchemaActions(file, content);
    const toolName = file.replace('.ts', '');
    if (actions.length > 0) {
      schemaActionsByTool[`sheets_${toolName}`] = actions;
    }
  }

  // Compare and report
  let totalHandlerActions = 0;
  let totalSchemaActions = 0;
  let mismatchCount = 0;

  const allTools = new Set([
    ...Object.keys(handlerActionsByTool),
    ...Object.keys(schemaActionsByTool),
  ]);

  for (const tool of Array.from(allTools).sort()) {
    const handlerActions = handlerActionsByTool[tool] || [];
    const schemaActions = schemaActionsByTool[tool] || [];

    const handlerActionNames = handlerActions.map((a) => a.action);
    const uniqueHandlerActions = Array.from(new Set(handlerActionNames));
    const uniqueSchemaActions = Array.from(new Set(schemaActions));

    totalHandlerActions += uniqueHandlerActions.length;
    totalSchemaActions += uniqueSchemaActions.length;

    const inHandlerNotSchema = uniqueHandlerActions.filter((a) => !uniqueSchemaActions.includes(a));
    const inSchemaNotHandler = uniqueSchemaActions.filter((a) => !uniqueHandlerActions.includes(a));

    const hasMismatch = inHandlerNotSchema.length > 0 || inSchemaNotHandler.length > 0;
    if (hasMismatch) mismatchCount++;

    console.log(`\n${tool}:`);
    console.log(`  Handler: ${uniqueHandlerActions.length} actions`);
    console.log(`  Schema:  ${uniqueSchemaActions.length} actions`);

    if (hasMismatch) {
      console.log(`  ⚠️  MISMATCH DETECTED`);

      if (inHandlerNotSchema.length > 0) {
        console.log(`  Missing from schema: ${inHandlerNotSchema.join(', ')}`);
      }

      if (inSchemaNotHandler.length > 0) {
        console.log(`  Missing from handler: ${inSchemaNotHandler.join(', ')}`);
      }
    } else {
      console.log(`  ✓ Actions match`);
    }
  }

  console.log();
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total tools: ${allTools.size}`);
  console.log(`Total handler actions: ${totalHandlerActions}`);
  console.log(`Total schema actions: ${totalSchemaActions}`);
  console.log(`Tools with mismatches: ${mismatchCount}`);

  if (mismatchCount > 0) {
    console.log();
    console.log('⚠️  ACTION MISMATCHES DETECTED');
    console.log('   Review the discrepancies above and update schemas or handlers');
    process.exit(1);
  } else {
    console.log();
    console.log('✅ ALL ACTIONS MATCH');
    process.exit(0);
  }
}

// Run the audit
runAudit();
