#!/usr/bin/env tsx
/**
 * Auto-Fixer for Multi-Agent Analysis Issues
 *
 * Automatically fixes common issues detected by analysis agents:
 * - Import ordering
 * - Naming conventions
 * - Type assertions
 * - Unused imports
 * - Duplicate imports
 *
 * @module analysis/auto-fixer
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisIssue } from './multi-agent-analysis.js';

// ============================================================================
// FIX RESULT TYPES
// ============================================================================

export interface FixResult {
  success: boolean;
  issue: AnalysisIssue;
  message?: string;
  reason?: string;
  changes?: string[];
}

export interface FixSummary {
  total: number;
  fixed: number;
  failed: number;
  skipped: number;
  results: FixResult[];
  duration: number;
}

// ============================================================================
// AUTO-FIXER CLASS
// ============================================================================

export class AutoFixer {
  private fixes: Map<string, (issue: AnalysisIssue) => Promise<FixResult>> = new Map();

  constructor() {
    // Register fix handlers
    this.fixes.set('importOrdering', this.fixImportOrdering.bind(this));
    this.fixes.set('namingConvention', this.fixNamingConvention.bind(this));
    this.fixes.set('typeAssertion', this.fixTypeAssertion.bind(this));
    this.fixes.set('unusedImport', this.fixUnusedImport.bind(this));
    this.fixes.set('duplicateImports', this.fixDuplicateImports.bind(this));
  }

  /**
   * Apply fixes to all auto-fixable issues
   */
  async applyFixes(issues: AnalysisIssue[]): Promise<FixSummary> {
    const startTime = Date.now();
    const results: FixResult[] = [];

    // Group issues by file for batch processing
    const issuesByFile = this.groupIssuesByFile(issues);

    for (const [file, fileIssues] of issuesByFile) {
      // Filter auto-fixable issues
      const fixableIssues = fileIssues.filter((i) => i.autoFixable);

      for (const issue of fixableIssues) {
        const result = await this.fixIssue(issue);
        results.push(result);
      }

      // Also handle non-auto-fixable but worth attempting
      const attemptableIssues = fileIssues.filter(
        (i) => !i.autoFixable && this.shouldAttemptFix(i)
      );

      for (const issue of attemptableIssues) {
        const result = await this.fixIssue(issue);
        results.push(result);
      }
    }

    const summary: FixSummary = {
      total: results.length,
      fixed: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success && r.reason).length,
      skipped: issues.length - results.length,
      results,
      duration: Date.now() - startTime,
    };

    return summary;
  }

  /**
   * Fix a single issue
   */
  private async fixIssue(issue: AnalysisIssue): Promise<FixResult> {
    const category = this.getCategoryFromDimension(issue.dimension);
    const fixer = this.fixes.get(category);

    if (!fixer) {
      return {
        success: false,
        issue,
        reason: `No auto-fix available for category: ${category}`,
      };
    }

    try {
      return await fixer(issue);
    } catch (error) {
      return {
        success: false,
        issue,
        reason: `Fix failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ============================================================================
  // FIX IMPLEMENTATIONS
  // ============================================================================

  /**
   * Fix import ordering - External → Internal → Types
   */
  private async fixImportOrdering(issue: AnalysisIssue): Promise<FixResult> {
    const content = fs.readFileSync(issue.file, 'utf-8');
    const sourceFile = ts.createSourceFile(issue.file, content, ts.ScriptTarget.Latest, true);

    // Extract all imports
    const imports = this.extractImports(sourceFile);

    if (imports.length === 0) {
      return {
        success: false,
        issue,
        reason: 'No imports found',
      };
    }

    // Sort: External → Internal → Types
    const sorted = this.sortImports(imports);

    // Check if already sorted
    if (this.importsAreSorted(imports, sorted)) {
      return {
        success: true,
        issue,
        message: 'Imports already sorted correctly',
      };
    }

    // Replace in file
    const fixed = this.replaceImports(content, imports, sorted);
    fs.writeFileSync(issue.file, fixed);

    return {
      success: true,
      issue,
      message: 'Imports reordered',
      changes: [`Sorted ${imports.length} imports`],
    };
  }

  /**
   * Fix type assertion - Replace with type guard when possible
   */
  private async fixTypeAssertion(issue: AnalysisIssue): Promise<FixResult> {
    if (!issue.line) {
      return {
        success: false,
        issue,
        reason: 'No line number specified',
      };
    }

    const content = fs.readFileSync(issue.file, 'utf-8');
    const lines = content.split('\n');

    // Find the assertion line
    const line = lines[issue.line - 1];

    // Try to replace with safer alternative
    const fixed = this.replaceTypeAssertion(line, issue);

    if (!fixed || fixed === line) {
      return {
        success: false,
        issue,
        reason: 'Complex assertion, manual review needed',
      };
    }

    lines[issue.line - 1] = fixed;
    fs.writeFileSync(issue.file, lines.join('\n'));

    return {
      success: true,
      issue,
      message: 'Type assertion replaced with guard',
      changes: [`Line ${issue.line}: ${line.trim()} → ${fixed.trim()}`],
    };
  }

  /**
   * Fix naming convention violations
   */
  private async fixNamingConvention(issue: AnalysisIssue): Promise<FixResult> {
    // This is complex - would require AST transformation
    // For now, return manual review needed
    return {
      success: false,
      issue,
      reason: 'Naming convention fixes require manual review to ensure correctness',
    };
  }

  /**
   * Remove unused imports
   */
  private async fixUnusedImport(issue: AnalysisIssue): Promise<FixResult> {
    const content = fs.readFileSync(issue.file, 'utf-8');
    const sourceFile = ts.createSourceFile(issue.file, content, ts.ScriptTarget.Latest, true);

    // Find unused imports
    const unusedImports = this.findUnusedImports(sourceFile);

    if (unusedImports.length === 0) {
      return {
        success: true,
        issue,
        message: 'No unused imports found',
      };
    }

    // Remove unused imports
    const fixed = this.removeUnusedImports(content, unusedImports);
    fs.writeFileSync(issue.file, fixed);

    return {
      success: true,
      issue,
      message: 'Unused imports removed',
      changes: unusedImports.map((u) => `Removed: ${u.name}`),
    };
  }

  /**
   * Fix duplicate imports
   */
  private async fixDuplicateImports(issue: AnalysisIssue): Promise<FixResult> {
    const content = fs.readFileSync(issue.file, 'utf-8');
    const sourceFile = ts.createSourceFile(issue.file, content, ts.ScriptTarget.Latest, true);

    // Find duplicate imports
    const duplicates = this.findDuplicateImports(sourceFile);

    if (duplicates.length === 0) {
      return {
        success: true,
        issue,
        message: 'No duplicate imports found',
      };
    }

    // Merge duplicate imports
    const fixed = this.mergeDuplicateImports(content, duplicates);
    fs.writeFileSync(issue.file, fixed);

    return {
      success: true,
      issue,
      message: 'Duplicate imports merged',
      changes: duplicates.map((d) => `Merged: ${d.module}`),
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private groupIssuesByFile(issues: AnalysisIssue[]): Map<string, AnalysisIssue[]> {
    const map = new Map<string, AnalysisIssue[]>();

    for (const issue of issues) {
      const fileIssues = map.get(issue.file) || [];
      fileIssues.push(issue);
      map.set(issue.file, fileIssues);
    }

    return map;
  }

  private shouldAttemptFix(issue: AnalysisIssue): boolean {
    // Try to fix low-severity issues even if not marked auto-fixable
    return (
      issue.severity === 'low' &&
      ['unusedImport', 'duplicateImports'].includes(this.getCategoryFromDimension(issue.dimension))
    );
  }

  private getCategoryFromDimension(dimension: string): string {
    // Map dimension names to fix categories
    const mapping: Record<string, string> = {
      importOrdering: 'importOrdering',
      namingConventions: 'namingConvention',
      typeAssertions: 'typeAssertion',
      unusedImports: 'unusedImport',
      duplicateImports: 'duplicateImports',
    };

    return mapping[dimension] || dimension;
  }

  private extractImports(sourceFile: ts.SourceFile): ImportInfo[] {
    const imports: ImportInfo[] = [];

    sourceFile.forEachChild((node) => {
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier;
        if (ts.isStringLiteral(moduleSpecifier)) {
          const module = moduleSpecifier.text;
          const start = node.getStart();
          const end = node.getEnd();
          const text = node.getText();

          imports.push({
            module,
            text,
            start,
            end,
            isExternal: !module.startsWith('.') && !module.startsWith('/'),
            isType: node.importClause?.isTypeOnly || false,
          });
        }
      }
    });

    return imports;
  }

  private sortImports(imports: ImportInfo[]): ImportInfo[] {
    return imports.sort((a, b) => {
      // External imports first
      if (a.isExternal && !b.isExternal) return -1;
      if (!a.isExternal && b.isExternal) return 1;

      // Type imports last
      if (!a.isType && b.isType) return -1;
      if (a.isType && !b.isType) return 1;

      // Alphabetical
      return a.module.localeCompare(b.module);
    });
  }

  private importsAreSorted(original: ImportInfo[], sorted: ImportInfo[]): boolean {
    for (let i = 0; i < original.length; i++) {
      if (original[i].module !== sorted[i].module) {
        return false;
      }
    }
    return true;
  }

  private replaceImports(content: string, original: ImportInfo[], sorted: ImportInfo[]): string {
    if (original.length === 0) return content;

    // Find the import block range
    const firstImport = original[0];
    const lastImport = original[original.length - 1];

    const before = content.substring(0, firstImport.start);
    const after = content.substring(lastImport.end);

    const sortedText = sorted.map((imp) => imp.text).join('\n');

    return before + sortedText + after;
  }

  private replaceTypeAssertion(line: string, issue: AnalysisIssue): string | null {
    // Simple patterns we can safely replace
    const patterns = [
      // (value as string) → typeof value === 'string' ? value : ''
      {
        regex: /\((\w+) as string\)/g,
        replacement: "typeof $1 === 'string' ? $1 : ''",
      },
      // (value as number) → typeof value === 'number' ? value : 0
      {
        regex: /\((\w+) as number\)/g,
        replacement: "typeof $1 === 'number' ? $1 : 0",
      },
      // (value as boolean) → typeof value === 'boolean' ? value : false
      {
        regex: /\((\w+) as boolean\)/g,
        replacement: "typeof $1 === 'boolean' ? $1 : false",
      },
    ];

    for (const pattern of patterns) {
      if (pattern.regex.test(line)) {
        return line.replace(pattern.regex, pattern.replacement);
      }
    }

    return null;
  }

  private findUnusedImports(sourceFile: ts.SourceFile): UnusedImport[] {
    const unused: UnusedImport[] = [];
    const imports: Map<string, ts.ImportDeclaration> = new Map();
    const usedNames = new Set<string>();

    // Collect all imports
    sourceFile.forEachChild((node) => {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        if (clause) {
          // Default import
          if (clause.name) {
            imports.set(clause.name.text, node);
          }
          // Named imports
          if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
            for (const element of clause.namedBindings.elements) {
              imports.set(element.name.text, node);
            }
          }
        }
      }
    });

    // Find all identifier usages
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node)) {
        usedNames.add(node.text);
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    // Find unused
    for (const [name, importNode] of imports) {
      if (!usedNames.has(name)) {
        unused.push({
          name,
          node: importNode,
          start: importNode.getStart(),
          end: importNode.getEnd(),
        });
      }
    }

    return unused;
  }

  private removeUnusedImports(content: string, unused: UnusedImport[]): string {
    // Sort by position (descending) to remove from end first
    const sorted = unused.sort((a, b) => b.start - a.start);

    let result = content;
    for (const imp of sorted) {
      // Remove the entire import line including newline
      const lines = result.split('\n');
      const lineStart = result.substring(0, imp.start).lastIndexOf('\n');
      const lineEnd = result.substring(imp.end).indexOf('\n') + imp.end;

      result = result.substring(0, lineStart + 1) + result.substring(lineEnd + 1);
    }

    return result;
  }

  private findDuplicateImports(sourceFile: ts.SourceFile): DuplicateImport[] {
    const importsByModule = new Map<string, ts.ImportDeclaration[]>();

    sourceFile.forEachChild((node) => {
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier;
        if (ts.isStringLiteral(moduleSpecifier)) {
          const module = moduleSpecifier.text;
          const imports = importsByModule.get(module) || [];
          imports.push(node);
          importsByModule.set(module, imports);
        }
      }
    });

    const duplicates: DuplicateImport[] = [];

    for (const [module, imports] of importsByModule) {
      if (imports.length > 1) {
        duplicates.push({
          module,
          imports,
        });
      }
    }

    return duplicates;
  }

  private mergeDuplicateImports(content: string, duplicates: DuplicateImport[]): string {
    let result = content;

    for (const dup of duplicates) {
      // Merge named imports
      const namedImports: string[] = [];

      for (const imp of dup.imports) {
        const clause = imp.importClause;
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            namedImports.push(element.name.text);
          }
        }
      }

      // Create merged import
      const unique = [...new Set(namedImports)];
      const merged = `import { ${unique.join(', ')} } from '${dup.module}';`;

      // Remove all duplicate imports and add merged one
      const sorted = dup.imports.sort((a, b) => b.getStart() - a.getStart());

      // Remove all but first
      for (let i = 1; i < sorted.length; i++) {
        const imp = sorted[i];
        const start = imp.getStart();
        const end = imp.getEnd();
        const lineStart = result.substring(0, start).lastIndexOf('\n');
        const lineEnd = result.substring(end).indexOf('\n') + end;

        result = result.substring(0, lineStart + 1) + result.substring(lineEnd + 1);
      }

      // Replace first with merged
      const first = sorted[0];
      const start = first.getStart();
      const end = first.getEnd();

      result = result.substring(0, start) + merged + result.substring(end);
    }

    return result;
  }
}

// ============================================================================
// HELPER TYPES
// ============================================================================

interface ImportInfo {
  module: string;
  text: string;
  start: number;
  end: number;
  isExternal: boolean;
  isType: boolean;
}

interface UnusedImport {
  name: string;
  node: ts.ImportDeclaration;
  start: number;
  end: number;
}

interface DuplicateImport {
  module: string;
  imports: ts.ImportDeclaration[];
}

// ============================================================================
// CLI INTERFACE
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npx tsx auto-fixer.ts <issues-json-file>');
    process.exit(1);
  }

  const issuesFile = args[0];

  // Read issues from JSON file
  const issuesData = JSON.parse(fs.readFileSync(issuesFile, 'utf-8'));
  const issues: AnalysisIssue[] = issuesData.issues || issuesData;

  // Apply fixes
  const fixer = new AutoFixer();
  const summary = await fixer.applyFixes(issues);

  // Output summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Auto-Fix Summary');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log(`Total Issues: ${summary.total}`);
  console.log(`Fixed: ${summary.fixed}`);
  console.log(`Failed: ${summary.failed}`);
  console.log(`Skipped: ${summary.skipped}`);
  console.log(`Duration: ${summary.duration}ms\n`);

  // Show details
  const successful = summary.results.filter((r) => r.success);
  const failed = summary.results.filter((r) => !r.success);

  if (successful.length > 0) {
    console.log('✅ Successfully Fixed:');
    for (const result of successful) {
      console.log(`  ${result.issue.dimension} in ${result.issue.file}`);
      if (result.changes) {
        for (const change of result.changes) {
          console.log(`    - ${change}`);
        }
      }
    }
    console.log('');
  }

  if (failed.length > 0) {
    console.log('❌ Failed:');
    for (const result of failed) {
      console.log(`  ${result.issue.dimension} in ${result.issue.file}`);
      console.log(`    Reason: ${result.reason}`);
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════\n');

  process.exit(summary.failed > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
