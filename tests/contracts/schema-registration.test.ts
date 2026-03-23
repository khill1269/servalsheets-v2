/**
 * Schema Registration Contract Tests
 *
 * Ensures all tools advertise valid JSON Schemas in tools/list
 * and that no tool has empty/missing schema properties.
 *
 * This prevents the SDK's normalizeObjectSchema() from emitting
 * empty fallback schemas for discriminated unions.
 */

import { describe, it, expect } from 'vitest';
import { TOOL_DEFINITIONS } from '../../src/mcp/registration/index.js';
import { zodToJsonSchemaCompat } from '../../src/utils/schema-compat.js';

describe('Schema Registration Contract', () => {
  describe('All tools have valid JSON Schemas', () => {
    TOOL_DEFINITIONS.forEach((tool) => {
      describe(`${tool.name}`, () => {
        it('should have non-empty inputSchema', () => {
          const schema = zodToJsonSchemaCompat(tool.inputSchema);

          // Must have type or oneOf/anyOf
          expect(schema).toBeDefined();

          // Check for empty object schema (the failure case)
          if (typeof schema === 'object' && schema !== null) {
            const jsonSchema = schema as Record<string, unknown>;

            // Must not be just {type:"object",properties:{}}
            if (jsonSchema['type'] === 'object') {
              const properties = jsonSchema['properties'];
              expect(properties).toBeDefined();
              expect(properties).not.toEqual({});
            }

            // If it's a union, must have oneOf or anyOf
            if (jsonSchema['oneOf'] || jsonSchema['anyOf']) {
              const unionOptions = jsonSchema['oneOf'] || jsonSchema['anyOf'];
              expect(Array.isArray(unionOptions)).toBe(true);
              expect((unionOptions as unknown[]).length).toBeGreaterThan(0);
            }
          }
        });

        it('should have non-empty outputSchema', () => {
          const schema = zodToJsonSchemaCompat(tool.outputSchema);

          expect(schema).toBeDefined();

          if (typeof schema === 'object' && schema !== null) {
            const jsonSchema = schema as Record<string, unknown>;

            if (jsonSchema['type'] === 'object') {
              const properties = jsonSchema['properties'];
              expect(properties).toBeDefined();
              expect(properties).not.toEqual({});
            }

            if (jsonSchema['oneOf'] || jsonSchema['anyOf']) {
              const unionOptions = jsonSchema['oneOf'] || jsonSchema['anyOf'];
              expect(Array.isArray(unionOptions)).toBe(true);
              expect((unionOptions as unknown[]).length).toBeGreaterThan(0);
            }
          }
        });

        it('should have action discriminator in JSON Schema', () => {
          const inputSchema = zodToJsonSchemaCompat(tool.inputSchema);

          if (inputSchema && typeof inputSchema === 'object') {
            const jsonSchema = inputSchema as Record<string, unknown>;
            const properties = jsonSchema['properties'] as Record<string, unknown> | undefined;
            const requestSchema = properties?.['request'] as Record<string, unknown> | undefined;

            if (requestSchema) {
              const options = (requestSchema['oneOf'] || requestSchema['anyOf']) as
                | Array<Record<string, unknown>>
                | undefined;

              if (options) {
                const hasActionDiscriminator = options.some((option) => {
                  const props = option['properties'] as Record<string, unknown> | undefined;
                  const required = option['required'] as string[] | undefined;
                  return (props && 'action' in props) || (required && required.includes('action'));
                });

                expect(hasActionDiscriminator).toBe(true);
              }
            }
          }
        });
      });
    });
  });

  describe('Schema conversion correctness', () => {
    it('should convert all input schemas without errors', () => {
      TOOL_DEFINITIONS.forEach((tool) => {
        expect(() => {
          zodToJsonSchemaCompat(tool.inputSchema);
        }).not.toThrow();
      });
    });

    it('should convert all output schemas without errors', () => {
      TOOL_DEFINITIONS.forEach((tool) => {
        expect(() => {
          zodToJsonSchemaCompat(tool.outputSchema);
        }).not.toThrow();
      });
    });
  });

  describe('Claude Desktop compatibility', () => {
    it('should not emit empty object schemas', () => {
      const problematicTools: string[] = [];

      TOOL_DEFINITIONS.forEach((tool) => {
        const inputSchema = zodToJsonSchemaCompat(tool.inputSchema);

        if (typeof inputSchema === 'object' && inputSchema !== null) {
          const jsonSchema = inputSchema as Record<string, unknown>;

          // Check for the empty object antipattern
          if (
            jsonSchema['type'] === 'object' &&
            (!jsonSchema['properties'] ||
              (typeof jsonSchema['properties'] === 'object' &&
                Object.keys(jsonSchema['properties'] as object).length === 0)) &&
            !jsonSchema['oneOf'] &&
            !jsonSchema['anyOf']
          ) {
            problematicTools.push(tool.name);
          }
        }
      });

      expect(problematicTools).toEqual([]);
    });
  });
});
