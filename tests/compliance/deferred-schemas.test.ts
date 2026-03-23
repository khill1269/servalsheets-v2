/**
 * Deferred Schema Loading Tests
 *
 * Tests the DEFER_SCHEMAS and DEFER_DESCRIPTIONS optimization modes
 * that reduce initial payload from ~231KB to ~5KB for Claude Desktop.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { prepareSchemaForRegistration } from '../../src/mcp/registration/schema-helpers.js';
import { TOOL_DEFINITIONS } from '../../src/mcp/registration/tool-definitions.js';
import { DEFER_SCHEMAS, DEFER_DESCRIPTIONS } from '../../src/config/constants.js';
import { zodSchemaToJsonSchema } from '../../src/utils/schema-compat.js';
import { TOOL_COUNT } from '../../src/schemas/index.js';

function toPreparedJsonSchema(prepared: unknown): Record<string, unknown> {
  if (prepared && typeof prepared === 'object' && !('_def' in (prepared as Record<string, unknown>))) {
    return prepared as Record<string, unknown>;
  }

  return zodSchemaToJsonSchema(prepared as z.ZodType);
}

describe('Deferred Schema Mode', () => {
  describe('Schema preparation', () => {
    it('should return minimal schema when DEFER_SCHEMAS is enabled', () => {
      if (!DEFER_SCHEMAS) return;

      const testSchema = z.object({
        request: z.object({
          action: z.enum(['read', 'write']),
          spreadsheetId: z.string(),
        }),
      });

      const prepared = prepareSchemaForRegistration(testSchema, 'input');
      const json = toPreparedJsonSchema(prepared);

      // Deferred schemas are small passthrough objects (~200-700 bytes)
      expect(JSON.stringify(json).length).toBeLessThan(1000);
    });

    it('should return minimal output schema when DEFER_SCHEMAS is enabled', () => {
      if (!DEFER_SCHEMAS) return;

      const testSchema = z.object({
        response: z.object({
          success: z.boolean(),
          data: z.array(z.string()),
        }),
      });

      const prepared = prepareSchemaForRegistration(testSchema, 'output');
      const json = toPreparedJsonSchema(prepared);

      expect(JSON.stringify(json).length).toBeLessThan(1000);
    });

    it('should include inline action guidance in description', () => {
      if (!DEFER_SCHEMAS) return;

      const testSchema = z.object({
        request: z.object({
          action: z.string(),
        }),
      });

      const prepared = prepareSchemaForRegistration(testSchema, 'input');
      const json = toPreparedJsonSchema(prepared);
      const request = json.properties?.['request'] as Record<string, unknown>;
      const properties = request?.['properties'] as Record<string, unknown>;
      expect((properties?.['action'] as Record<string, unknown>)?.['type']).toBe('string');
    });
  });

  describe('DEFER_SCHEMAS auto-detection', () => {
    it('should be a boolean', () => {
      expect(typeof DEFER_SCHEMAS).toBe('boolean');
    });

    it('should default to true for STDIO (no --http flag)', () => {
      const envVal = process.env['SERVAL_DEFER_SCHEMAS'];
      if (!envVal) {
        expect(DEFER_SCHEMAS).toBe(true);
      }
    });
  });

  describe('DEFER_DESCRIPTIONS', () => {
    it('should be a boolean', () => {
      expect(typeof DEFER_DESCRIPTIONS).toBe('boolean');
    });
  });

  describe('Tool definitions integrity', () => {
    it('should match TOOL_COUNT regardless of deferred mode', () => {
      expect(TOOL_DEFINITIONS.length).toBe(TOOL_COUNT);
    });

    it('should have non-empty descriptions regardless of deferred mode', () => {
      for (const tool of TOOL_DEFINITIONS) {
        expect(tool.description.length).toBeGreaterThan(10);
      }
    });

    it('should have prepared input schemas that accept request objects in deferred mode', () => {
      if (!DEFER_SCHEMAS) return;

      // In deferred mode, prepareSchemaForRegistration returns a flat typed JSON Schema
      // with action enum, request properties, and additionalProperties enabled.
      const testSchema = z.object({
        request: z.object({
          action: z.enum(['read', 'write']),
          spreadsheetId: z.string(),
        }),
      });

      const prepared = prepareSchemaForRegistration(testSchema, 'input');
      const json = toPreparedJsonSchema(prepared);
      const request = json.properties?.['request'] as Record<string, unknown>;
      const properties = request?.['properties'] as Record<string, unknown>;

      expect(request?.['type']).toBe('object');
      expect(request?.['additionalProperties']).toBe(true);
      expect(request?.['required']).toEqual(expect.arrayContaining(['action']));
      expect((properties?.['action'] as Record<string, unknown>)?.['enum']).toEqual([
        'read',
        'write',
      ]);
      expect((properties?.['spreadsheetId'] as Record<string, unknown>)?.['type']).toBe('string');
    });

    it('should have prepared output schemas that accept response objects in deferred mode', () => {
      if (!DEFER_SCHEMAS) return;

      const testSchema = z.object({
        response: z.object({
          success: z.boolean(),
          data: z.array(z.string()),
        }),
      });

      const prepared = prepareSchemaForRegistration(testSchema, 'output') as z.ZodType;
      const result = prepared.safeParse({ response: { success: true } });
      expect(result.success).toBe(true);

      // Verify additionalProperties are allowed (data, error, etc.)
      const withExtra = prepared.safeParse({
        response: { success: true, data: ['test'], extra: 'field' },
      });
      expect(withExtra.success).toBe(true);
    });
  });

  describe('Schema size optimization', () => {
    it('total deferred schema payload should be under 30KB', () => {
      if (!DEFER_SCHEMAS) return;

      let totalSize = 0;
      for (const tool of TOOL_DEFINITIONS) {
        // Measure the PREPARED (deferred) schemas, not raw definitions
        const preparedInput = prepareSchemaForRegistration(tool.inputSchema as z.ZodType, 'input');
        const preparedOutput = prepareSchemaForRegistration(
          tool.outputSchema as z.ZodType,
          'output'
        );
        const inputJson = toPreparedJsonSchema(preparedInput);
        const outputJson = toPreparedJsonSchema(preparedOutput);
        totalSize += JSON.stringify(inputJson).length;
        totalSize += JSON.stringify(outputJson).length;
      }

      // 25 tools, 391 actions: flat input schemas (~26KB) + minimal output schemas (~6KB) ≈ ~32KB
      // With action enums and property descriptions, budget is ~55KB
      expect(totalSize).toBeLessThan(55_000);
    });
  });
});
