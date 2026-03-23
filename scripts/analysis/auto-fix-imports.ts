#!/usr/bin/env tsx
/**
 * Auto-fix Import Ordering
 *
 * Automatically reorders imports to match ServalSheets conventions:
 * External → Internal → Types
 *
 * Usage:
 *   npx tsx scripts/analysis/auto-fix-imports.ts <file>
 *   npx tsx scripts/analysis/auto-fix-imports.ts src/**\/*.ts (with glob)
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

interface ImportStatement {
  node: ts.ImportDeclaration;
  text: string;
  type: 'external' | 'internal' | 'type';
  startPos: number;
  endPos: number;
}

function classifyImport(
  node: ts.ImportDeclaration,
  sourceFile: ts.SourceFile
): 'external' | 'internal' | 'type' {
  const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
  const isTypeOnly = node.importClause?.isTypeOnly || false;

  if (isTypeOnly) {
    return 'type';
  } else if (moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/')) {
    return 'internal';
  } else {
    return 'external';
  }
}

function extractImports(sourceFile: ts.SourceFile): ImportStatement[] {
  const imports: ImportStatement[] = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const type = classifyImport(node, sourceFile);
      imports.push({
        node,
        text: node.getText(sourceFile),
        type,
        startPos: node.getStart(sourceFile),
        endPos: node.getEnd(),
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function needsReordering(imports: ImportStatement[]): boolean {
  const order = ['external', 'internal', 'type'];
  let lastIndex = -1;

  for (const imp of imports) {
    const currentIndex = order.indexOf(imp.type);
    if (currentIndex < lastIndex) {
      return true;
    }
    lastIndex = currentIndex;
  }

  return false;
}

function reorderImports(imports: ImportStatement[]): string {
  // Group by type
  const external = imports.filter((i) => i.type === 'external');
  const internal = imports.filter((i) => i.type === 'internal');
  const types = imports.filter((i) => i.type === 'type');

  // Sort within groups (alphabetically by module specifier)
  const sortByModule = (a: ImportStatement, b: ImportStatement) => {
    const aModule = (a.node.moduleSpecifier as ts.StringLiteral).text;
    const bModule = (b.node.moduleSpecifier as ts.StringLiteral).text;
    return aModule.localeCompare(bModule);
  };

  external.sort(sortByModule);
  internal.sort(sortByModule);
  types.sort(sortByModule);

  // Combine with blank lines between groups
  const sections: string[] = [];

  if (external.length > 0) {
    sections.push(external.map((i) => i.text).join('\n'));
  }

  if (internal.length > 0) {
    sections.push(internal.map((i) => i.text).join('\n'));
  }

  if (types.length > 0) {
    sections.push(types.map((i) => i.text).join('\n'));
  }

  return sections.join('\n\n');
}

function fixImportOrdering(filePath: string, dryRun = false): boolean {
  const content = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

  const imports = extractImports(sourceFile);

  if (imports.length === 0) {
    return false;
  }

  if (!needsReordering(imports)) {
    return false;
  }

  // Find the range to replace
  const firstImport = imports[0];
  const lastImport = imports[imports.length - 1];
  const startPos = firstImport.startPos;
  const endPos = lastImport.endPos;

  // Get the reordered imports
  const reordered = reorderImports(imports);

  // Build new content
  const before = content.substring(0, startPos);
  const after = content.substring(endPos);
  const newContent = before + reordered + after;

  if (dryRun) {
    console.log(`Would fix: ${filePath}`);
    console.log('Before:');
    console.log(content.substring(startPos, endPos));
    console.log('\nAfter:');
    console.log(reordered);
    return true;
  }

  // Write the fixed content
  fs.writeFileSync(filePath, newContent, 'utf-8');
  console.log(`✓ Fixed: ${filePath}`);
  return true;
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npx tsx auto-fix-imports.ts <file> [--dry-run]');
    console.error('');
    console.error('Example:');
    console.error('  npx tsx auto-fix-imports.ts src/handlers/data.ts');
    console.error('  npx tsx auto-fix-imports.ts src/handlers/data.ts --dry-run');
    process.exit(1);
  }

  const filePath = args[0];
  const dryRun = args.includes('--dry-run');

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`Checking: ${filePath}\n`);

  const fixed = fixImportOrdering(filePath, dryRun);

  if (!fixed) {
    console.log('✓ No import ordering issues found');
  }

  process.exit(0);
}

// Run if executed directly
main();
