/**
 * ServalSheets - MCP SDK Compatibility Layer
 *
 * PRODUCTION-GRADE | MCP 2025-11-25 COMPLIANT | ZOD v4.3.5 COMPATIBLE
 *
 * This module provides compatibility between Zod schemas and JSON Schema
 * for the MCP SDK's tools/list response.
 *
 * ## Background
 *
 * The MCP SDK v1.25.x has a limitation in how it handles Zod schemas
 * for the `tools/list` response:
 *
 * 1. `normalizeObjectSchema()` only recognizes z.object() schemas
 * 2. z.discriminatedUnion() schemas return `undefined` from normalization
 * 3. tools/list returns empty `{ type: "object", properties: {} }` for such tools
 *
 * This prevents LLMs from understanding the tool's input structure, causing
 * them to guess at parameters or fail to use the tools correctly.
 *
 * ## Solution
 *
 * We use Zod v4's native JSON Schema conversion (z.toJSONSchema()) to convert
 * Zod schemas to JSON Schema format. Zod v4.0+ has first-party JSON Schema
 * support that handles discriminated unions, objects, unions, and other types correctly.
 *
 * ## Request/Response Envelopes
 *
 * ServalSheets wraps tool inputs/outputs in `{ request: ... }` and `{ response: ... }`
 * for strict MCP compliance. The compatibility layer provides JSON Schema conversion
 * for tools/list while preserving Zod schemas for runtime validation.
 *
 * @module utils/schema-compat
 */

import { z, type ZodTypeAny } from 'zod';
import { logger } from './logger.js';
import { ValidationError } from '../core/errors.js';

/**
 * Detects if a Zod schema is a discriminated union
 *
 * Uses stable instanceof check instead of internal _def property.
 * This is future-proof and works with minification/bundling.
 *
 * @param schema - Any Zod schema
 * @returns true if the schema is a discriminated union
 */
export function isZodDiscriminatedUnion(
  schema: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic Zod type parameter required by library
): schema is z.ZodDiscriminatedUnion<any, any> {
  // ✅ STABLE API: instanceof check instead of _def property access
  const unwrapped = unwrapZodSchema(schema);
  return unwrapped instanceof z.ZodDiscriminatedUnion;
}

/**
 * Detects if a Zod schema is a regular union (z.union())
 *
 * Uses stable instanceof check instead of internal _def property.
 *
 * @param schema - Any Zod schema
 * @returns true if the schema is a z.union()
 */
export function isZodUnion(
  schema: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic Zod type parameter required by library
): schema is z.ZodUnion<any> {
  // ✅ STABLE API: instanceof check instead of _def property access
  const unwrapped = unwrapZodSchema(schema);
  return unwrapped instanceof z.ZodUnion;
}

/**
 * Detects if a Zod schema is an object type (z.object())
 *
 * Uses stable instanceof check instead of internal _def property.
 *
 * @param schema - Any Zod schema
 * @returns true if the schema is a z.object()
 */
export function isZodObject(schema: unknown): schema is z.ZodObject<z.ZodRawShape> {
  // ✅ STABLE API: instanceof check instead of _def property access
  const unwrapped = unwrapZodSchema(schema);
  return unwrapped instanceof z.ZodObject;
}

/**
 * Unwraps Zod wrappers like preprocess/pipe/effects to their output schema.
 *
 * This helps schema detection work with z.preprocess and z.pipe wrappers.
 *
 * @param schema - Any Zod schema
 * @returns Unwrapped schema if applicable
 */
export function unwrapZodSchema(schema: unknown): unknown {
  let current = schema;
  let guard = 0;

  const ZodPipeCtor = (z as { ZodPipe?: unknown }).ZodPipe;
  const ZodEffectsCtor = (z as { ZodEffects?: unknown }).ZodEffects;

  while (current && guard < 5) {
    guard += 1;

    if (typeof ZodPipeCtor === 'function' && current instanceof ZodPipeCtor) {
      const next =
        (current as { out?: unknown }).out ?? (current as { def?: { out?: unknown } }).def?.out;
      if (!next || next === current) break;
      current = next;
      continue;
    }

    if (typeof ZodEffectsCtor === 'function' && current instanceof ZodEffectsCtor) {
      const next =
        (current as { _def?: { schema?: unknown; innerType?: unknown } })._def?.schema ??
        (current as { _def?: { innerType?: unknown } })._def?.innerType;
      if (!next || next === current) break;
      current = next;
      continue;
    }

    break;
  }

  return current;
}

/**
 * Options for JSON Schema conversion
 */
export interface JsonSchemaOptions {
  /** Strategy for handling $refs (default: 'none') */
  refStrategy?: 'none' | 'root' | 'relative';
  /** Target JSON Schema version (default: 'jsonSchema7') */
  target?: 'jsonSchema7' | 'jsonSchema2019-09' | 'openApi3';
  /** Enable strict union handling (default: true) */
  strictUnions?: boolean;
}

/**
 * Whether to use $ref optimization in JSON Schema output
 *
 * When enabled, Zod schemas are converted with `reused: 'ref'` option,
 * which creates `$defs` for shared types and references them with `$ref`.
 * This reduces payload size by ~60% (527KB → 209KB for full mode).
 *
 * WARNING: Not all MCP clients handle `$refs` correctly. Test thoroughly.
 *
 * Set via SERVAL_SCHEMA_REFS=true environment variable, or auto-enabled for HTTP
 * transport to reduce the ~231KB full-schema payload by ~60% while preserving
 * complete fidelity (all enums, descriptions, required arrays retained via $defs).
 */
function resolveSchemaRefs(): boolean {
  const envVal = process.env['SERVAL_SCHEMA_REFS'];
  if (envVal !== undefined) return envVal === 'true';
  // Auto-enable for HTTP: full schemas are large (~231KB); $defs compression
  // reduces to ~100KB with no information loss.
  const isHttp = process.argv.includes('--http') || (process.argv[1] ?? '').includes('http-server');
  return isHttp;
}
export const USE_SCHEMA_REFS = resolveSchemaRefs();

/**
 * Converts a Zod schema to JSON Schema format
 *
 * Uses Zod v4's native toJSONSchema() method for conversion.
 * Zod v4.0+ has first-party JSON Schema support via z.toJSONSchema().
 *
 * Handles:
 * - z.discriminatedUnion() → JSON Schema with oneOf
 * - z.object() → JSON Schema object
 * - z.union() → JSON Schema with oneOf
 * - Other Zod types → Appropriate JSON Schema
 *
 * @param schema - Any Zod schema
 * @param options - Conversion options (currently unused, kept for API compatibility)
 * @returns JSON Schema object with $schema dialect identifier
 */
export function zodSchemaToJsonSchema(
  schema: ZodTypeAny,
  _options: JsonSchemaOptions = {}
): Record<string, unknown> {
  try {
    // ✅ Use Zod v4's native JSON Schema conversion
    // This works correctly with discriminated unions, objects, unions, etc.
    //
    // When USE_SCHEMA_REFS is enabled, use `reused: 'ref'` to create $defs
    // for shared types. This reduces payload by ~60% (527KB → 209KB).
    //
    // For schemas with transforms, we use io: 'input' to get the input schema
    // since transforms cannot be represented in JSON Schema.
    const jsonSchemaOptions = {
      ...(USE_SCHEMA_REFS ? { reused: 'ref' as const } : {}),
      io: 'input' as const, // Use input schema to avoid transform errors
    };
    const jsonSchema = z.toJSONSchema(schema, jsonSchemaOptions);

    // Keep $schema property for MCP 2025-11-25 compliance (JSON Schema 2020-12)
    if (typeof jsonSchema === 'object' && jsonSchema !== null) {
      return jsonSchema as Record<string, unknown>;
    }

    // Unexpected format from Zod
    logger.warn('Unexpected JSON Schema format from z.toJSONSchema', {
      component: 'schema-compat',
      schemaType: typeof jsonSchema,
    });
    return { type: 'object', properties: {} };
  } catch (error) {
    logger.error('JSON Schema conversion failed', {
      component: 'schema-compat',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Fallback for conversion failures
    return { type: 'object', properties: {} };
  }
}

/**
 * Validates that a schema is properly formatted for MCP
 *
 * Checks that the schema is either:
 * 1. A z.object() Zod schema
 * 2. A JSON Schema object with type: 'object'
 *
 * @param schema - Schema to validate
 * @param name - Schema name for error messages
 * @throws Error if schema is invalid
 */
export function validateMcpSchema(schema: unknown, name: string): void {
  if (!schema || typeof schema !== 'object') {
    throw new ValidationError(`[${name}] Schema must be an object`, 'schema', 'object');
  }

  const obj = schema as Record<string, unknown>;

  // Check if it's a Zod schema (has _def)
  if ('_def' in obj) {
    // Zod schema - acceptable for MCP SDK registration
    // The SDK handles both runtime validation and JSON Schema conversion
    return;
  }

  // Check if it's a JSON Schema (has type: 'object')
  if (obj['type'] !== 'object' && !obj['oneOf'] && !obj['anyOf']) {
    throw new ValidationError(
      `[${name}] JSON Schema must have type: 'object' or oneOf/anyOf at root`,
      'schema',
      "{ type: 'object' } or oneOf/anyOf"
    );
  }
}

// ============================================================================
// LEGACY ALIASES (from earlier schema compatibility helpers)
// ============================================================================

/**
 * @deprecated Use isZodDiscriminatedUnion instead
 */
export const isDiscriminatedUnion = isZodDiscriminatedUnion;

/**
 * @deprecated Use zodSchemaToJsonSchema instead
 */
export const zodToJsonSchemaCompat = zodSchemaToJsonSchema;

/**
 * Verifies that a schema has been properly converted to JSON Schema
 *
 * Checks for Zod-specific properties that shouldn't exist in JSON Schema.
 * This catches cases where schema transformation failed.
 *
 * @param schema - Schema to verify
 * @throws Error if the schema contains Zod-specific properties
 */
export function verifyJsonSchema(schema: unknown): void {
  if (!schema || typeof schema !== 'object') {
    return;
  }

  const obj = schema as Record<string, unknown>;

  // Check for Zod-specific properties that shouldn't be in JSON Schema
  const zodProperties = ['_def', '_type', 'parse', 'safeParse', 'parseAsync', 'safeParseAsync'];
  const foundZodProps = zodProperties.filter((prop) => prop in obj);

  if (foundZodProps.length > 0) {
    throw new ValidationError(
      `Schema transformation failed: JSON Schema contains Zod properties: ${foundZodProps.join(', ')}\n` +
        `This means a Zod schema was not properly converted before registration.`,
      'schema',
      'plain JSON Schema object'
    );
  }
}
