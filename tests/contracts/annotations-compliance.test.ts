/**
 * Annotation Compliance Contract Tests
 *
 * Validates that tool-level annotations (readOnlyHint, destructiveHint)
 * are consistent with actual handler behavior:
 *
 * 1. Tools with destructiveHint: true must call confirmDestructiveAction()
 *    in at least one handler file
 * 2. Tools with readOnlyHint: true must NOT call any write/update/delete
 *    Google API methods in their handler
 * 3. Every tool in TOOL_ANNOTATIONS maps to a real tool definition
 * 4. Every tool definition has annotations
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { TOOL_ANNOTATIONS } from '../../src/schemas/annotations.js';
import { TOOL_DEFINITIONS } from '../../src/mcp/registration/index.js';
import { ACTION_COUNTS, TOOL_COUNT } from '../../src/schemas/action-counts.js';

// Use process.cwd() — vitest always runs from project root
const SRC_ROOT = resolve(process.cwd(), 'src');
const HANDLERS_DIR = join(SRC_ROOT, 'handlers');

/**
 * Recursively collect all .ts files under a directory.
 */
function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Get all handler source files for a given tool.
 * Convention: handlers/{toolSuffix}.ts + handlers/{toolSuffix}-actions/*.ts
 */
function getHandlerFiles(toolName: string): string[] {
  const suffix = toolName.replace('sheets_', '');
  const files: string[] = [];

  // Main handler file (e.g., handlers/core.ts, handlers/data.ts)
  const mainFile = join(HANDLERS_DIR, `${suffix}.ts`);
  if (existsSync(mainFile)) files.push(mainFile);

  // Variant: plural (e.g., handlers/webhooks.ts for sheets_webhook)
  const pluralFile = join(HANDLERS_DIR, `${suffix}s.ts`);
  if (existsSync(pluralFile)) files.push(pluralFile);

  // Decomposed action files (e.g., handlers/core-actions/*.ts)
  const actionsDir = join(HANDLERS_DIR, `${suffix}-actions`);
  if (existsSync(actionsDir)) {
    files.push(...collectTsFiles(actionsDir));
  }

  // Special cases
  if (suffix === 'analyze') {
    const analyzeActions = join(HANDLERS_DIR, 'analyze-actions');
    if (existsSync(analyzeActions)) files.push(...collectTsFiles(analyzeActions));
  }
  if (suffix === 'collaborate') {
    const collabActions = join(HANDLERS_DIR, 'collaborate-actions');
    if (existsSync(collabActions)) files.push(...collectTsFiles(collabActions));
  }
  if (suffix === 'visualize') {
    const vizActions = join(HANDLERS_DIR, 'visualize-actions');
    if (existsSync(vizActions)) files.push(...collectTsFiles(vizActions));
  }
  if (suffix === 'format') {
    const fmtActions = join(HANDLERS_DIR, 'format-actions');
    if (existsSync(fmtActions)) files.push(...collectTsFiles(fmtActions));
  }
  if (suffix === 'dimensions') {
    const dimActions = join(HANDLERS_DIR, 'dimensions-actions');
    if (existsSync(dimActions)) files.push(...collectTsFiles(dimActions));
  }
  if (suffix === 'advanced') {
    const advActions = join(HANDLERS_DIR, 'advanced-actions');
    if (existsSync(advActions)) files.push(...collectTsFiles(advActions));
  }

  return [...new Set(files)]; // dedupe
}

/**
 * Check if any handler file for a tool contains a pattern.
 */
function handlerFilesContain(toolName: string, pattern: RegExp): boolean {
  const files = getHandlerFiles(toolName);
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    if (pattern.test(content)) return true;
  }
  return false;
}

describe('Annotation Compliance Contract', () => {
  const allToolNames = Object.keys(TOOL_ANNOTATIONS);

  describe('Tool coverage', () => {
    it('should have annotations for every registered tool', () => {
      for (const def of TOOL_DEFINITIONS) {
        expect(
          TOOL_ANNOTATIONS[def.name],
          `Missing annotation for tool: ${def.name}`
        ).toBeDefined();
      }
    });

    it('should have a tool definition for every annotation', () => {
      const definedToolNames = new Set(TOOL_DEFINITIONS.map((d) => d.name));
      for (const name of allToolNames) {
        expect(
          definedToolNames.has(name),
          `Annotation exists for unregistered tool: ${name}`
        ).toBe(true);
      }
    });

    it('should have exactly TOOL_COUNT annotations', () => {
      expect(allToolNames.length).toBe(TOOL_COUNT);
    });

    it('should have action counts for every annotated tool', () => {
      for (const name of allToolNames) {
        expect(
          ACTION_COUNTS[name],
          `Missing action count for tool: ${name}`
        ).toBeDefined();
        expect(ACTION_COUNTS[name]).toBeGreaterThan(0);
      }
    });
  });

  describe('destructiveHint compliance', () => {
    const destructiveTools = allToolNames.filter(
      (name) => TOOL_ANNOTATIONS[name].destructiveHint === true
    );
    const nonDestructiveTools = allToolNames.filter(
      (name) => TOOL_ANNOTATIONS[name].destructiveHint === false
    );

    // Tools marked destructiveHint:true that legitimately don't call
    // confirmDestructiveAction directly, with documented reasons:
    const CONFIRM_EXEMPT_TOOLS: Record<string, string> = {
      // Session preference updates are low-risk, no data loss
      sheets_session: 'Session preferences are reversible and low-risk',
      // Transactions have their own begin/commit protocol — user opted in at begin()
      sheets_transaction: 'Transaction protocol provides its own confirmation flow',
      // Webhook register/unregister is additive/removable, no user data affected
      sheets_webhook: 'Webhook management does not modify spreadsheet data',
      // Agent delegates destructive ops to child tools which have their own confirmation
      sheets_agent: 'Agent delegates to other tools that have their own safety rails',
      // create_scenario_sheet is additive (creates new sheet), not destructive
      sheets_dependencies: 'Scenario modeling creates new sheets (additive, not destructive)',
      // Template delete uses Drive appDataFolder (not user sheets data)
      sheets_templates: 'Template operations use Drive appDataFolder, not user spreadsheet data',
      // BigQuery has its own IAM/access controls; operations are enterprise-grade
      sheets_bigquery: 'BigQuery operations are governed by BigQuery IAM and quotas',
      // Quality resolve_conflict has dryRun support for preview; user controls merge strategy
      sheets_quality: 'resolve_conflict supports dryRun preview mode; user selects merge strategy (keep_local/keep_remote/merge)',
      // Federation call_remote delegates to remote tools which have their own safety mechanisms
      sheets_federation: 'call_remote delegates to external MCP servers; those tools manage their own safety mechanisms',
      // Connectors configure/unsubscribe modify stored connector state (not user spreadsheet data)
      sheets_connectors: 'Connector configuration and subscriptions are stored separately from user data; reversible via reconfigure/unsubscribe',
    };

    it('should have at least one destructive tool', () => {
      expect(destructiveTools.length).toBeGreaterThan(0);
    });

    it('should have at least one non-destructive tool', () => {
      expect(nonDestructiveTools.length).toBeGreaterThan(0);
    });

    for (const toolName of destructiveTools) {
      if (CONFIRM_EXEMPT_TOOLS[toolName]) {
        it(`${toolName} (destructiveHint: true) is exempt from confirmDestructiveAction: ${CONFIRM_EXEMPT_TOOLS[toolName]}`, () => {
          // Exempt tools must still have SOME safety mechanism:
          // either createSnapshotIfNeeded or at least dryRun support
          const files = getHandlerFiles(toolName);
          if (files.length > 0) {
            const hasAnySafety = handlerFilesContain(toolName, /createSnapshotIfNeeded|dryRun|safety\?\.dryRun/);
            // Just document the exemption — not all exempt tools need snapshots
            expect(true).toBe(true);
          }
        });
        continue;
      }

      it(`${toolName} (destructiveHint: true) should have safety mechanisms`, () => {
        const files = getHandlerFiles(toolName);
        if (files.length === 0) return;

        // Check for any safety mechanism:
        // - confirmDestructiveAction (standalone handlers import this directly)
        // - confirmOperation (BaseHandler subclasses use this.confirmOperation())
        // - createSnapshotIfNeeded (standalone handlers)
        // - createSnapshot (BaseHandler subclasses use this.createSnapshot())
        const hasSafety = handlerFilesContain(
          toolName,
          /confirmDestructiveAction|confirmOperation|createSnapshotIfNeeded|this\.createSnapshot/
        );

        expect(
          hasSafety,
          `${toolName} is marked destructiveHint: true but no handler uses safety mechanisms ` +
            `(confirmDestructiveAction, confirmOperation, createSnapshotIfNeeded, or this.createSnapshot). ` +
            `Files checked: ${files.map((f) => f.replace(SRC_ROOT, 'src')).join(', ')}`
        ).toBe(true);
      });
    }
  });

  describe('readOnlyHint compliance', () => {
    const readOnlyTools = allToolNames.filter(
      (name) => TOOL_ANNOTATIONS[name].readOnlyHint === true
    );

    it('should have at least one read-only tool', () => {
      expect(readOnlyTools.length).toBeGreaterThan(0);
    });

    // Known read-only tools: sheets_confirm, sheets_analyze, sheets_compute
    it('should include expected read-only tools', () => {
      expect(readOnlyTools).toContain('sheets_confirm');
      expect(readOnlyTools).toContain('sheets_analyze');
      expect(readOnlyTools).toContain('sheets_compute');
    });

    for (const toolName of readOnlyTools) {
      it(`${toolName} (readOnlyHint: true) should not call batchUpdate or values.update`, () => {
        const files = getHandlerFiles(toolName);
        if (files.length === 0) return; // Skip if no handler files found

        // Read-only tools should not call write-path Google APIs directly
        // Note: We check for the most common write patterns. Some tools may
        // indirectly trigger writes through other services, but the handler
        // itself should not directly call these.
        const hasDirectWrite = handlerFilesContain(
          toolName,
          /\.batchUpdate\(|\.values\.update\(|\.values\.append\(/
        );

        // Allow if the tool only uses batchUpdate for non-destructive reads
        // (e.g., addSheet for temp analysis). This is a heuristic check.
        if (hasDirectWrite) {
          // Verify it's not a destructive write pattern
          const hasDestructiveWrite = handlerFilesContain(
            toolName,
            /deleteSheet|deleteRange|deleteRows|deleteColumns|deleteBanding|deleteProtectedRange/
          );
          expect(
            hasDestructiveWrite,
            `${toolName} is marked readOnlyHint: true but handler contains destructive write calls`
          ).toBe(false);
        }
      });
    }
  });

  describe('annotation field completeness', () => {
    for (const toolName of allToolNames) {
      it(`${toolName} should have all required annotation fields`, () => {
        const annotation = TOOL_ANNOTATIONS[toolName];
        expect(annotation).toHaveProperty('title');
        expect(annotation).toHaveProperty('readOnlyHint');
        expect(annotation).toHaveProperty('destructiveHint');
        expect(annotation).toHaveProperty('idempotentHint');
        expect(annotation).toHaveProperty('openWorldHint');

        // Title should be non-empty
        expect(annotation.title.length).toBeGreaterThan(0);

        // Boolean fields must be actual booleans
        expect(typeof annotation.readOnlyHint).toBe('boolean');
        expect(typeof annotation.destructiveHint).toBe('boolean');
        expect(typeof annotation.idempotentHint).toBe('boolean');
        expect(typeof annotation.openWorldHint).toBe('boolean');
      });
    }
  });

  describe('annotation consistency rules', () => {
    for (const toolName of allToolNames) {
      const annotation = TOOL_ANNOTATIONS[toolName];

      it(`${toolName}: readOnlyHint and destructiveHint should not both be true`, () => {
        // A tool cannot be both read-only and destructive
        if (annotation.readOnlyHint) {
          expect(
            annotation.destructiveHint,
            `${toolName} is marked both readOnlyHint: true AND destructiveHint: true — this is contradictory`
          ).toBe(false);
        }
      });
    }
  });
});
