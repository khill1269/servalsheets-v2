/**
 * Zod v4 JSON Schema compatibility contract tests (L-8)
 *
 * Verifies that zodToJsonSchemaCompat() (alias for zodSchemaToJsonSchema)
 * correctly converts Zod schemas to plain JSON Schema objects with no
 * Zod internals leaking through.
 */

import { describe, it, expect } from 'vitest';
import { zodToJsonSchemaCompat } from '../../src/utils/schema-compat.js';
import { SheetsDataInputSchema } from '../../src/schemas/data.js';
import { SheetsCoreInputSchema } from '../../src/schemas/core.js';

describe('Zod v4 JSON Schema compat (zodToJsonSchemaCompat)', () => {
  it('converts a Zod schema to a plain JSON Schema object', () => {
    const json = zodToJsonSchemaCompat(SheetsDataInputSchema);
    expect(typeof json).toBe('object');
    expect(json).not.toHaveProperty('parse');
    expect(json).not.toHaveProperty('safeParse');
    expect(json).not.toHaveProperty('_def');
    expect(json).not.toHaveProperty('_type');
  });

  it('output is JSON-serializable (no circular refs, no Zod internals)', () => {
    const json = zodToJsonSchemaCompat(SheetsDataInputSchema);
    expect(() => JSON.stringify(json)).not.toThrow();
  });

  it('output has a recognizable JSON Schema root shape', () => {
    const json = zodToJsonSchemaCompat(SheetsDataInputSchema) as Record<string, unknown>;
    const hasRoot =
      json['type'] !== undefined || json['anyOf'] !== undefined || json['$ref'] !== undefined;
    expect(hasRoot).toBe(true);
  });

  it('works for a second schema (core) — not specific to one tool', () => {
    const json = zodToJsonSchemaCompat(SheetsCoreInputSchema) as Record<string, unknown>;
    expect(typeof json).toBe('object');
    expect(() => JSON.stringify(json)).not.toThrow();
    const hasRoot =
      json['type'] !== undefined || json['anyOf'] !== undefined || json['$ref'] !== undefined;
    expect(hasRoot).toBe(true);
  });
});
