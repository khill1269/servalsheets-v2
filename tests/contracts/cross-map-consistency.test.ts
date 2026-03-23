/**
 * Cross-Map Consistency Tests
 *
 * Validates that all metadata maps remain synchronized:
 * - TOOL_DEFINITIONS (registration)
 * - TOOL_ACTIONS (completions)
 * - ACTION_COUNTS (annotations)
 * - TOOL_ANNOTATIONS (feature metadata)
 * - ACTION_METADATA (action-level metadata)
 * - TOOL_COUNT / ACTION_COUNT (constants)
 *
 * These tests prevent drift between different representations of the same data.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { TOOL_COUNT, ACTION_COUNT } from '../../src/schemas/index.js';
import { TOOL_ACTIONS } from '../../src/mcp/completions.js';
import { ACTION_COUNTS, TOOL_ANNOTATIONS } from '../../src/schemas/annotations.js';
import { ACTION_METADATA } from '../../src/schemas/action-metadata.js';
import { TOOL_DEFINITIONS } from '../../src/mcp/registration/tool-definitions.js';
import { extractSchemaActions } from '../../src/utils/ast-schema-parser.js';
import { calculateTotalActions, getToolNames } from '../helpers/count-actions.js';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

describe('Cross-Map Consistency', () => {
  // =========================================================================
  // TOOL NAME CONSISTENCY
  // =========================================================================
  describe('Tool Name Consistency', () => {
    it('TOOL_DEFINITIONS and TOOL_ACTIONS have identical tool names', () => {
      const defTools = TOOL_DEFINITIONS.map((t) => t.name).sort();
      const actTools = getToolNames(TOOL_ACTIONS);

      expect(defTools).toEqual(actTools);
    });

    it('ACTION_COUNTS and TOOL_ACTIONS have identical tool names', () => {
      const countTools = Object.keys(ACTION_COUNTS).sort();
      const actTools = getToolNames(TOOL_ACTIONS);

      expect(countTools).toEqual(actTools);
    });

    it('TOOL_ANNOTATIONS and TOOL_ACTIONS have identical tool names', () => {
      const annTools = Object.keys(TOOL_ANNOTATIONS).sort();
      const actTools = getToolNames(TOOL_ACTIONS);

      expect(annTools).toEqual(actTools);
    });

    it('ACTION_METADATA and TOOL_ACTIONS have identical tool names', () => {
      const metadataTools = Object.keys(ACTION_METADATA).sort();
      const actTools = getToolNames(TOOL_ACTIONS);

      expect(metadataTools).toEqual(actTools);
    });

    it('all maps reference the same set of tools (complete consistency)', () => {
      const defTools = new Set(TOOL_DEFINITIONS.map((t) => t.name));
      const actTools = new Set(Object.keys(TOOL_ACTIONS));
      const countTools = new Set(Object.keys(ACTION_COUNTS));
      const annTools = new Set(Object.keys(TOOL_ANNOTATIONS));
      const metadataTools = new Set(Object.keys(ACTION_METADATA));

      // All sets should be equal
      expect([...defTools].sort()).toEqual([...actTools].sort());
      expect([...defTools].sort()).toEqual([...countTools].sort());
      expect([...defTools].sort()).toEqual([...annTools].sort());
      expect([...defTools].sort()).toEqual([...metadataTools].sort());
    });
  });

  // =========================================================================
  // TOOL COUNT CONSISTENCY
  // =========================================================================
  describe('Tool Count Consistency', () => {
    it('TOOL_COUNT matches TOOL_DEFINITIONS length', () => {
      expect(TOOL_COUNT).toBe(TOOL_DEFINITIONS.length);
    });

    it('TOOL_COUNT matches number of tools in TOOL_ACTIONS', () => {
      expect(TOOL_COUNT).toBe(Object.keys(TOOL_ACTIONS).length);
    });

    it('TOOL_COUNT matches number of tools in ACTION_COUNTS', () => {
      expect(TOOL_COUNT).toBe(Object.keys(ACTION_COUNTS).length);
    });

    it('TOOL_COUNT matches number of tools in TOOL_ANNOTATIONS', () => {
      expect(TOOL_COUNT).toBe(Object.keys(TOOL_ANNOTATIONS).length);
    });

    it('TOOL_COUNT matches number of tools in ACTION_METADATA', () => {
      expect(TOOL_COUNT).toBe(Object.keys(ACTION_METADATA).length);
    });

    it('TOOL_COUNT is greater than 20 (sanity check)', () => {
      expect(TOOL_COUNT).toBeGreaterThan(20);
      expect(TOOL_COUNT).toBeLessThan(30);
    });
  });

  // =========================================================================
  // ACTION COUNT CONSISTENCY
  // =========================================================================
  describe('Action Count Consistency', () => {
    it('ACTION_COUNT matches sum of ACTION_COUNTS', () => {
      const sum = Object.values(ACTION_COUNTS).reduce((a, b) => a + b, 0);
      expect(ACTION_COUNT).toBe(sum);
    });

    it('ACTION_COUNT matches calculated total from TOOL_ACTIONS', () => {
      const calculatedTotal = calculateTotalActions(TOOL_ACTIONS);
      expect(ACTION_COUNT).toBe(calculatedTotal);
    });

    it('ACTION_COUNT is greater than 290 (sanity check)', () => {
      expect(ACTION_COUNT).toBeGreaterThan(290);
      expect(ACTION_COUNT).toBeLessThan(450);
    });
  });

  // =========================================================================
  // PER-TOOL ACTION COUNT CONSISTENCY
  // =========================================================================
  describe('Per-Tool Action Count Consistency', () => {
    it('ACTION_COUNTS matches actual lengths in TOOL_ACTIONS', () => {
      for (const [toolName, expectedCount] of Object.entries(ACTION_COUNTS)) {
        const actualActions = TOOL_ACTIONS[toolName];
        expect(actualActions).toBeDefined();
        expect(actualActions.length).toBe(expectedCount);
      }
    });

    it('ACTION_METADATA entries are non-empty for every tool', () => {
      for (const [toolName, toolMetadata] of Object.entries(ACTION_METADATA)) {
        expect(toolMetadata, `${toolName} missing metadata object`).toBeDefined();
        expect(
          Object.keys(toolMetadata).length,
          `${toolName} has zero action metadata entries`
        ).toBeGreaterThan(0);
      }
    });

    it('ACTION_METADATA action keys exactly match TOOL_ACTIONS per tool', () => {
      for (const [toolName, actions] of Object.entries(TOOL_ACTIONS)) {
        const metadataActions = Object.keys(ACTION_METADATA[toolName] ?? {}).sort();
        const expectedActions = [...actions].sort();
        expect(metadataActions).toEqual(expectedActions);
      }
    });

    it('schema action literals exactly match TOOL_ACTIONS per tool', () => {
      for (const [toolName, actions] of Object.entries(TOOL_ACTIONS)) {
        const schemaName = toolName.replace(/^sheets_/, '');
        const schemaPath = path.join(PROJECT_ROOT, `src/schemas/${schemaName}.ts`);
        const schemaActions = extractSchemaActions(schemaPath).sort();
        const expectedActions = [...actions].sort();

        expect(schemaActions, `${toolName} schema actions must match TOOL_ACTIONS`).toEqual(
          expectedActions
        );
      }
    });
  });

  // =========================================================================
  // COMPLETENESS VALIDATION
  // =========================================================================
  describe('Map Completeness', () => {
    it('every tool in TOOL_DEFINITIONS has entry in TOOL_ACTIONS', () => {
      for (const toolDef of TOOL_DEFINITIONS) {
        expect(TOOL_ACTIONS[toolDef.name]).toBeDefined();
        expect(TOOL_ACTIONS[toolDef.name].length).toBeGreaterThan(0);
      }
    });

    it('every tool in TOOL_DEFINITIONS has entry in ACTION_COUNTS', () => {
      for (const toolDef of TOOL_DEFINITIONS) {
        expect(ACTION_COUNTS[toolDef.name]).toBeDefined();
        expect(ACTION_COUNTS[toolDef.name]).toBeGreaterThan(0);
      }
    });

    it('every tool in TOOL_DEFINITIONS has entry in TOOL_ANNOTATIONS', () => {
      for (const toolDef of TOOL_DEFINITIONS) {
        expect(TOOL_ANNOTATIONS[toolDef.name]).toBeDefined();
        // Check that at least one hint field exists (they're at top level, not nested)
        const annotation = TOOL_ANNOTATIONS[toolDef.name];
        expect(annotation.readOnlyHint !== undefined).toBe(true);
      }
    });

    it('every tool in TOOL_DEFINITIONS has entry in ACTION_METADATA', () => {
      for (const toolDef of TOOL_DEFINITIONS) {
        expect(ACTION_METADATA[toolDef.name]).toBeDefined();
      }
    });

    it('no tool exists in TOOL_ACTIONS that is not in TOOL_DEFINITIONS', () => {
      const defToolNames = new Set(TOOL_DEFINITIONS.map((t) => t.name));

      for (const toolName of Object.keys(TOOL_ACTIONS)) {
        expect(defToolNames.has(toolName)).toBe(true);
      }
    });

    it('no tool exists in ACTION_COUNTS that is not in TOOL_DEFINITIONS', () => {
      const defToolNames = new Set(TOOL_DEFINITIONS.map((t) => t.name));

      for (const toolName of Object.keys(ACTION_COUNTS)) {
        expect(defToolNames.has(toolName)).toBe(true);
      }
    });

    it('no tool exists in TOOL_ANNOTATIONS that is not in TOOL_DEFINITIONS', () => {
      const defToolNames = new Set(TOOL_DEFINITIONS.map((t) => t.name));

      for (const toolName of Object.keys(TOOL_ANNOTATIONS)) {
        expect(defToolNames.has(toolName)).toBe(true);
      }
    });

    it('no tool exists in ACTION_METADATA that is not in TOOL_DEFINITIONS', () => {
      const defToolNames = new Set(TOOL_DEFINITIONS.map((t) => t.name));

      for (const toolName of Object.keys(ACTION_METADATA)) {
        expect(defToolNames.has(toolName)).toBe(true);
      }
    });
  });

  // =========================================================================
  // ACTION ARRAY CONSISTENCY
  // =========================================================================
  describe('Action Array Consistency', () => {
    it('no duplicate actions within any tool in TOOL_ACTIONS', () => {
      for (const [toolName, actions] of Object.entries(TOOL_ACTIONS)) {
        const uniqueActions = new Set(actions);
        expect(uniqueActions.size, `Tool ${toolName} has duplicate actions`).toBe(actions.length);
      }
    });

    it('all actions use snake_case naming', () => {
      for (const [toolName, actions] of Object.entries(TOOL_ACTIONS)) {
        for (const action of actions) {
          expect(action, `Action "${action}" in tool "${toolName}" is not snake_case`).toMatch(
            /^[a-z][a-z0-9_]*$/
          );
        }
      }
    });

    it('all ACTION_METADATA action keys use snake_case naming', () => {
      for (const [toolName, actionMetadata] of Object.entries(ACTION_METADATA)) {
        for (const actionName of Object.keys(actionMetadata)) {
          expect(
            actionName,
            `Action metadata key "${actionName}" in tool "${toolName}" is not snake_case`
          ).toMatch(/^[a-z][a-z0-9_]*$/);
        }
      }
    });
  });

  // =========================================================================
  // TOOL NAMING CONSISTENCY
  // =========================================================================
  describe('Tool Naming Consistency', () => {
    it('all tools use sheets_ prefix', () => {
      for (const toolName of Object.keys(TOOL_ACTIONS)) {
        expect(toolName, `Tool "${toolName}" does not use sheets_ prefix`).toMatch(
          /^sheets_[a-z][a-z0-9_]*$/
        );
      }
    });

    it('all tools in TOOL_DEFINITIONS use sheets_ prefix', () => {
      for (const toolDef of TOOL_DEFINITIONS) {
        expect(
          toolDef.name,
          `Tool "${toolDef.name}" in TOOL_DEFINITIONS does not use sheets_ prefix`
        ).toMatch(/^sheets_[a-z][a-z0-9_]*$/);
      }
    });

    it('no duplicate tool names in TOOL_DEFINITIONS', () => {
      const names = TOOL_DEFINITIONS.map((t) => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  // =========================================================================
  // ZERO-ACTION TOOLS VALIDATION
  // =========================================================================
  describe('Zero-Action Tools Prevention', () => {
    it('no tool has zero actions in TOOL_ACTIONS', () => {
      for (const [toolName, actions] of Object.entries(TOOL_ACTIONS)) {
        expect(actions.length, `Tool "${toolName}" has zero actions`).toBeGreaterThan(0);
      }
    });

    it('no tool has zero actions in ACTION_COUNTS', () => {
      for (const [toolName, count] of Object.entries(ACTION_COUNTS)) {
        expect(count, `Tool "${toolName}" has zero actions in ACTION_COUNTS`).toBeGreaterThan(0);
      }
    });

    it('no tool has zero metadata entries in ACTION_METADATA', () => {
      for (const [toolName, toolMeta] of Object.entries(ACTION_METADATA)) {
        expect(
          Object.keys(toolMeta).length,
          `Tool "${toolName}" has zero entries in ACTION_METADATA`
        ).toBeGreaterThan(0);
      }
    });
  });

  // =========================================================================
  // METADATA STRUCTURE VALIDATION
  // =========================================================================
  describe('Metadata Structure Validation', () => {
    it('every tool in TOOL_ANNOTATIONS has all required hint fields', () => {
      const requiredHints = ['readOnlyHint', 'destructiveHint', 'openWorldHint', 'idempotentHint'];

      for (const [toolName, annotation] of Object.entries(TOOL_ANNOTATIONS)) {
        for (const hint of requiredHints) {
          expect(
            annotation[hint as keyof typeof annotation],
            `${toolName} missing hint: ${hint}`
          ).toBeDefined();
        }
      }
    });

    it('every tool in TOOL_DEFINITIONS has required fields', () => {
      for (const toolDef of TOOL_DEFINITIONS) {
        expect(toolDef.name, 'Tool missing name').toBeDefined();
        expect(toolDef.description, 'Tool missing description').toBeDefined();
        expect(toolDef.inputSchema, 'Tool missing inputSchema').toBeDefined();
        expect(toolDef.annotations, 'Tool missing annotations').toBeDefined();
      }
    });

    it('every ACTION_METADATA entry has required fields', () => {
      const requiredFields = [
        'readOnly',
        'apiCalls',
        'quotaCost',
        'requiresConfirmation',
        'destructive',
        'idempotent',
        'typicalLatency',
      ];

      for (const [toolName, actionMetadata] of Object.entries(ACTION_METADATA)) {
        for (const [actionName, metadata] of Object.entries(actionMetadata)) {
          for (const field of requiredFields) {
            expect(
              metadata[field as keyof typeof metadata],
              `${toolName}.${actionName} missing metadata field: ${field}`
            ).toBeDefined();
          }
        }
      }
    });
  });

  // =========================================================================
  // REGRESSION PREVENTION
  // =========================================================================
  describe('Regression Prevention', () => {
    it('adding a new tool will fail these tests if not added to all maps', () => {
      // This test documents the expected behavior:
      // If a developer adds a tool to TOOL_DEFINITIONS but forgets to run
      // the metadata generator, the cross-map consistency tests will fail

      const toolCount = TOOL_DEFINITIONS.length;
      const actionsCount = Object.keys(TOOL_ACTIONS).length;
      const annotationsCount = Object.keys(ACTION_COUNTS).length;
      const hintsCount = Object.keys(TOOL_ANNOTATIONS).length;
      const metadataCount = Object.keys(ACTION_METADATA).length;

      // All should be equal
      expect(toolCount).toBe(actionsCount);
      expect(toolCount).toBe(annotationsCount);
      expect(toolCount).toBe(hintsCount);
      expect(toolCount).toBe(metadataCount);
    });

    it('removing an action will fail if ACTION_COUNT is not updated', () => {
      // This test documents that ACTION_COUNT must match actual action count
      const calculatedTotal = calculateTotalActions(TOOL_ACTIONS);
      expect(ACTION_COUNT).toBe(calculatedTotal);
    });

    it('constants match the actual data structures', () => {
      // If constants drift from reality, these will fail
      expect(TOOL_COUNT).toBe(TOOL_DEFINITIONS.length);
      expect(ACTION_COUNT).toBe(calculateTotalActions(TOOL_ACTIONS));
    });
  });
});
