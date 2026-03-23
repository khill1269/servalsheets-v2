/**
 * Schema Snapshot Tests
 *
 * These tests capture the JSON Schema representation of all Zod schemas
 * to prevent accidental breaking changes to the API contract.
 *
 * If a schema change is intentional, update snapshots with:
 *   npm run test:snapshots:update
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import * as schemas from '../../src/schemas/index.js';

// Helper to check if something is a Zod schema
function isZodSchema(value: unknown): value is z.ZodSchema {
  return (
    value !== null &&
    typeof value === 'object' &&
    '_def' in value &&
    typeof (value as { _def: unknown })._def === 'object'
  );
}

// Extract all Zod schema exports (ending with "Schema")
const schemaExports = Object.entries(schemas).filter(
  ([name, value]) =>
    (name.endsWith('Schema') || name.endsWith('Input') || name.endsWith('Output')) &&
    isZodSchema(value)
);

describe('Schema Snapshots', () => {
  describe('Input Schemas', () => {
    schemaExports
      .filter(([name]) => name.endsWith('InputSchema'))
      .forEach(([name, schema]) => {
        it(`${name} should match snapshot`, () => {
          const jsonSchema = z.toJSONSchema(schema, { reused: 'inline', unrepresentable: 'any' });
          expect(jsonSchema).toMatchSnapshot();
        });
      });
  });

  describe('Output Schemas', () => {
    schemaExports
      .filter(([name]) => name.endsWith('OutputSchema'))
      .forEach(([name, schema]) => {
        it(`${name} should match snapshot`, () => {
          const jsonSchema = z.toJSONSchema(schema, { reused: 'inline', unrepresentable: 'any' });
          expect(jsonSchema).toMatchSnapshot();
        });
      });
  });

  describe('Shared Schemas', () => {
    const sharedSchemas = [
      'RangeInputSchema',
      'CellReferenceSchema',
      'GridRangeSchema',
      'ColorSchema',
      'TextFormatSchema',
      'NumberFormatSchema',
    ];

    sharedSchemas.forEach((schemaName) => {
      const schema = (schemas as Record<string, unknown>)[schemaName];
      if (schema) {
        it(`${schemaName} should match snapshot`, () => {
          const jsonSchema = z.toJSONSchema(schema, { reused: 'inline', unrepresentable: 'any' });
          expect(jsonSchema).toMatchSnapshot();
        });
      }
    });
  });
});

describe('Schema Contract Guarantees', () => {
  it('all tool input schemas should have action field', () => {
    const toolInputSchemas = schemaExports.filter(
      ([name]) =>
        name.startsWith('Sheets') && name.endsWith('InputSchema') && !name.includes('Composite') // Composite schemas have different structure
    );

    toolInputSchemas.forEach(([name, schema]) => {
      const jsonSchema = z.toJSONSchema(schema, { reused: 'inline', unrepresentable: 'any' });
      const properties = (jsonSchema as { properties?: Record<string, unknown> }).properties;

      // Tool input schemas should have action or request fields
      if (properties) {
        const hasAction = 'action' in properties;
        const hasRequest = 'request' in properties;
        expect(hasAction || hasRequest, `${name} missing action/request`).toBe(true);
      }
    });
  });

  it('all tool output schemas should have response field', () => {
    const toolOutputSchemas = schemaExports.filter(
      ([name]) =>
        name.startsWith('Sheets') && name.endsWith('OutputSchema') && !name.includes('Composite') // Composite schemas have different structure
    );

    toolOutputSchemas.forEach(([name, schema]) => {
      const jsonSchema = z.toJSONSchema(schema, { reused: 'inline', unrepresentable: 'any' });
      const properties = (jsonSchema as { properties?: Record<string, unknown> }).properties;

      // Output schemas should have response field
      if (properties) {
        expect(properties).toHaveProperty('response');
      }
    });
  });

  it('all schemas should serialize to valid JSON', () => {
    schemaExports.forEach(([name, schema]) => {
      const jsonSchema = z.toJSONSchema(schema, { reused: 'inline', unrepresentable: 'any' });

      // Ensure schema can be serialized and is well-formed
      expect(jsonSchema).toBeDefined();
      expect(() => JSON.stringify(jsonSchema)).not.toThrow();

      // Should have $schema property from z.toJSONSchema (draft/2020-12)
      expect(jsonSchema).toHaveProperty('$schema');
    });
  });
});
