/**
 * Diagnostic script to test MCP SDK schema conversion
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Simulate SDK's normalizeObjectSchema behavior
function hasShapeProperty(schema) {
  if (!schema || typeof schema !== 'object') return false;
  return schema.shape !== undefined || schema._def?.shape !== undefined;
}

// Simulate SDK's isDiscriminatedUnion check
function isDiscriminatedUnion(schema) {
  if (!schema || typeof schema !== 'object') return false;
  const def = schema._def;
  if (!def) return false;
  if (def.typeName === 'ZodDiscriminatedUnion') return true;
  if (def.discriminator && def.options && Array.isArray(def.options)) return true;
  return false;
}

// Test schema (mimics ServalSheets pattern)
const ActionUnion = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read'), spreadsheetId: z.string() }),
  z.object({
    action: z.literal('write'),
    spreadsheetId: z.string(),
    values: z.array(z.array(z.any())),
  }),
  z.object({ action: z.literal('clear'), spreadsheetId: z.string(), range: z.string() }),
]);

// Wrapper pattern (what ServalSheets uses)
const WrappedSchema = z.object({
  request: ActionUnion,
});

// Raw discriminated union (what wouldn't work)
const RawSchema = ActionUnion;

console.log('=== MCP SDK Schema Conversion Test ===\\n');

console.log('1. Wrapped Schema (z.object with discriminated union inside)');
console.log('   Has .shape property:', hasShapeProperty(WrappedSchema));
console.log('   Is discriminated union:', isDiscriminatedUnion(WrappedSchema));
console.log('   → SDK should: Call normalizeObjectSchema() ✓, then toJsonSchemaCompat() ✓\\n');

console.log('2. Raw Discriminated Union (no wrapper)');
console.log('   Has .shape property:', hasShapeProperty(RawSchema));
console.log('   Is discriminated union:', isDiscriminatedUnion(RawSchema));
console.log('   → SDK would: Return EMPTY_OBJECT_JSON_SCHEMA ✗\\n');

console.log('3. JSON Schema Conversion Test');
console.log('   Converting wrapped schema with zod-to-json-schema...\\n');

try {
  const jsonSchema = zodToJsonSchema(WrappedSchema, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  });

  console.log('   SUCCESS! Generated JSON Schema:');
  console.log(JSON.stringify(jsonSchema, null, 2));

  const properties = jsonSchema.properties;
  const request = properties?.request;

  if (request?.oneOf || request?.anyOf) {
    console.log('\\n   ✓ Discriminated union properly converted to oneOf/anyOf');
  } else if (request) {
    console.log('\\n   ⚠ Request property exists but union structure:');
    console.log('   Has discriminator:', !!request.discriminator);
  } else {
    console.log('\\n   ✗ Request property missing!');
  }
} catch (error) {
  console.log('   FAILED:', error);
}

console.log('\\n=== Conclusion ===');
console.log('If wrapped schema converts properly, the SDK workaround may be unnecessary.');
