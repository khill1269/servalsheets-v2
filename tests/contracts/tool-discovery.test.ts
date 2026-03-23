/**
 * Tool Discovery Contract Tests
 *
 * Validates that the tools/list response includes all expected tools and actions.
 * Ensures no tool is silently dropped, no action is missing from a schema,
 * and that tool metadata (titles, descriptions, annotations) is complete.
 *
 * This is a critical contract: if a tool is missing from tools/list,
 * no LLM client can discover or invoke it.
 */

import { describe, it, expect } from 'vitest';
import { TOOL_DEFINITIONS } from '../../src/mcp/registration/index.js';
import { TOOL_ANNOTATIONS } from '../../src/schemas/annotations.js';
import { TOOL_DESCRIPTIONS } from '../../src/schemas/descriptions.js';
import { ACTION_COUNTS, TOOL_COUNT, ACTION_COUNT } from '../../src/schemas/action-counts.js';
import { zodToJsonSchemaCompat } from '../../src/utils/schema-compat.js';

/** All 25 expected tool names */
const EXPECTED_TOOLS = [
  'sheets_advanced',
  'sheets_agent',
  'sheets_analyze',
  'sheets_appsscript',
  'sheets_auth',
  'sheets_bigquery',
  'sheets_collaborate',
  'sheets_composite',
  'sheets_compute',
  'sheets_confirm',
  'sheets_connectors',
  'sheets_core',
  'sheets_data',
  'sheets_dependencies',
  'sheets_dimensions',
  'sheets_federation',
  'sheets_fix',
  'sheets_format',
  'sheets_history',
  'sheets_quality',
  'sheets_session',
  'sheets_templates',
  'sheets_transaction',
  'sheets_visualize',
  'sheets_webhook',
];

describe('Tool Discovery Contract', () => {
  const definedToolNames = TOOL_DEFINITIONS.map((d) => d.name).sort();

  describe('Complete tool inventory', () => {
    it('should register exactly TOOL_COUNT tools', () => {
      expect(TOOL_DEFINITIONS.length).toBe(TOOL_COUNT);
    });

    it('should register exactly 25 tools', () => {
      expect(TOOL_DEFINITIONS.length).toBe(25);
    });

    it('should include every expected tool', () => {
      for (const expected of EXPECTED_TOOLS) {
        expect(
          definedToolNames,
          `Missing tool: ${expected}`
        ).toContain(expected);
      }
    });

    it('should not include unexpected tools', () => {
      for (const actual of definedToolNames) {
        expect(
          EXPECTED_TOOLS,
          `Unexpected tool registered: ${actual} — add to EXPECTED_TOOLS or remove`
        ).toContain(actual);
      }
    });

    it('should have no duplicate tool names', () => {
      const unique = new Set(definedToolNames);
      expect(unique.size).toBe(definedToolNames.length);
    });
  });

  describe('Action count consistency', () => {
    it('should have ACTION_COUNT equal to sum of per-tool counts', () => {
      const sum = Object.values(ACTION_COUNTS).reduce((a, b) => a + b, 0);
      expect(ACTION_COUNT).toBe(sum);
    });

    it('should have action counts for all 25 tools', () => {
      expect(Object.keys(ACTION_COUNTS).length).toBe(25);
    });

    it('every tool should have at least 1 action', () => {
      for (const [tool, count] of Object.entries(ACTION_COUNTS)) {
        expect(count, `${tool} has 0 actions`).toBeGreaterThan(0);
      }
    });

    // Verify schema discriminated union options match ACTION_COUNTS
    for (const def of TOOL_DEFINITIONS) {
      it(`${def.name} schema should have ${ACTION_COUNTS[def.name]} action variants`, () => {
        const expectedCount = ACTION_COUNTS[def.name];
        if (!expectedCount) return; // skip if no count entry

        const jsonSchema = zodToJsonSchemaCompat(def.inputSchema) as Record<string, unknown>;

        // The input schema wraps in { request: discriminatedUnion }
        // Navigate to the union: properties.request.oneOf or properties.request.anyOf
        const properties = jsonSchema['properties'] as Record<string, unknown> | undefined;
        if (!properties) return;

        const requestSchema = properties['request'] as Record<string, unknown> | undefined;
        if (!requestSchema) return;

        const unionOptions =
          (requestSchema['oneOf'] as unknown[]) || (requestSchema['anyOf'] as unknown[]);

        if (unionOptions) {
          expect(
            unionOptions.length,
            `${def.name}: schema has ${unionOptions.length} action variants but ACTION_COUNTS says ${expectedCount}`
          ).toBe(expectedCount);
        }
      });
    }
  });

  describe('Tool metadata completeness', () => {
    for (const def of TOOL_DEFINITIONS) {
      describe(`${def.name}`, () => {
        it('should have a non-empty title in annotations', () => {
          const annotation = TOOL_ANNOTATIONS[def.name];
          expect(annotation, `No annotation for ${def.name}`).toBeDefined();
          expect(annotation.title.length).toBeGreaterThan(0);
        });

        it('should have a description', () => {
          const desc = TOOL_DESCRIPTIONS[def.name];
          expect(desc, `No description for ${def.name}`).toBeDefined();
          expect(desc.length).toBeGreaterThan(10);
        });

        it('should have a valid inputSchema', () => {
          expect(def.inputSchema).toBeDefined();
          const jsonSchema = zodToJsonSchemaCompat(def.inputSchema);
          expect(jsonSchema).toBeDefined();
          expect(typeof jsonSchema).toBe('object');
        });

        it('should have a valid outputSchema', () => {
          expect(def.outputSchema).toBeDefined();
          const jsonSchema = zodToJsonSchemaCompat(def.outputSchema);
          expect(jsonSchema).toBeDefined();
          expect(typeof jsonSchema).toBe('object');
        });
      });
    }
  });

  describe('Tool naming conventions', () => {
    it('all tools should use sheets_ prefix', () => {
      for (const name of definedToolNames) {
        expect(name.startsWith('sheets_'), `${name} does not start with sheets_`).toBe(true);
      }
    });

    it('all tool names should be lowercase snake_case', () => {
      for (const name of definedToolNames) {
        expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });
  });

  describe('Annotation-definition alignment', () => {
    it('TOOL_ANNOTATIONS keys should exactly match TOOL_DEFINITIONS names', () => {
      const annotationKeys = Object.keys(TOOL_ANNOTATIONS).sort();
      expect(annotationKeys).toEqual(definedToolNames);
    });

    it('ACTION_COUNTS keys should exactly match TOOL_DEFINITIONS names', () => {
      const countKeys = Object.keys(ACTION_COUNTS).sort();
      expect(countKeys).toEqual(definedToolNames);
    });

    it('TOOL_DESCRIPTIONS keys should exactly match TOOL_DEFINITIONS names', () => {
      const descKeys = Object.keys(TOOL_DESCRIPTIONS).sort();
      expect(descKeys).toEqual(definedToolNames);
    });
  });
});
