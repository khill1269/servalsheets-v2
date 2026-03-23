/**
 * ServalSheets - Schema Helpers
 *
 * Schema preparation and validation utilities.
 *
 * @module mcp/registration/schema-helpers
 */

import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { z } from 'zod';
import {
  verifyJsonSchema,
  USE_SCHEMA_REFS,
  zodSchemaToJsonSchema,
} from '../../utils/schema-compat.js';
import { DEFER_SCHEMAS, STRIP_SCHEMA_DESCRIPTIONS } from '../../config/constants.js';
import { logger } from '../../utils/logger.js';

// Use z.ZodType instead of deprecated ZodTypeAny
type ZodSchema = z.ZodType;

// ============================================================================
// SCHEMA CACHE (P0-2 Optimization)
// ============================================================================

/**
 * Module-level cache for prepared schemas.
 *
 * Schema transformations via zodSchemaToJsonSchema() are CPU-intensive (~1-2ms each).
 * With 25 tools × 2 schemas = 42 transformations at startup, caching saves 8-40ms.
 *
 * Cache is keyed by: toolName + schemaType (input/output)
 * Cache is populated on first access and never invalidated (schemas are immutable).
 */
const PREPARED_SCHEMA_CACHE = new Map<string, AnySchema>();

/**
 * Get or compute a cached prepared schema.
 *
 * @param cacheKey - Unique key for this schema (e.g., "sheets_data:input")
 * @param computeFn - Function to compute the schema if not cached
 * @returns Cached or freshly computed schema
 */
export function getCachedPreparedSchema(cacheKey: string, computeFn: () => AnySchema): AnySchema {
  const cached = PREPARED_SCHEMA_CACHE.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const computed = computeFn();
  PREPARED_SCHEMA_CACHE.set(cacheKey, computed);
  return computed;
}

/**
 * Get the current cache size (for diagnostics)
 */
export function getPreparedSchemaCacheSize(): number {
  return PREPARED_SCHEMA_CACHE.size;
}

/**
 * Recursively strips "description" fields from JSON Schema
 *
 * When STRIP_SCHEMA_DESCRIPTIONS is enabled, this removes inline descriptions
 * from converted schemas to save ~14,000 tokens. Validation still works since
 * descriptions are purely documentation.
 *
 * @param schema - JSON Schema object to strip descriptions from
 * @returns Schema with description fields removed
 */
function stripSchemaDescriptions(schema: unknown): unknown {
  if (schema === null || typeof schema !== 'object') {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(stripSchemaDescriptions);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    // Skip description fields (but keep them at the top level for tool routing)
    if (key === 'description') {
      continue;
    }
    result[key] = stripSchemaDescriptions(value);
  }
  return result;
}

// ============================================================================
// SCHEMA PREPARATION
// ============================================================================

/**
 * Minimal passthrough schema for deferred loading mode
 *
 * This schema exposes a flattened, typed JSON Schema view when DEFER_SCHEMAS is
 * enabled. It keeps payload size low while still surfacing primitive types,
 * enums, arrays, objects, and simple unions directly in tools/list.
 *
 * The actual validation happens in handlers using the original Zod schemas.
 *
 * IMPORTANT: Must match the actual schema structure: { request: { action, ... } }
 * All tool schemas use this wrapper pattern for the discriminated union.
 */
/**
 * Compact JSON Schema helpers for deferred input schemas.
 */
type JsonSchemaRecord = Record<string, unknown>;
type JsonLiteral = string | number | boolean | null;

const DEFERRED_SCHEMA_MAX_DEPTH = 1;
const DEFERRED_SCHEMA_MAX_ENUM_VALUES = 24;
const DEFERRED_SCHEMA_MAX_UNION_VARIANTS = 3;

function asRecord(value: unknown): JsonSchemaRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonSchemaRecord)
    : null;
}

function isJsonLiteral(value: unknown): value is JsonLiteral {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function inferTypeFromEnum(values: JsonLiteral[]): string | undefined {
  if (values.length === 0) {
    return undefined; // OK: Explicit empty — empty enum array
  }

  const distinctTypes = new Set(values.map((value) => (value === null ? 'null' : typeof value)));
  if (distinctTypes.size !== 1) {
    return undefined; // OK: Explicit empty — mixed types, cannot infer
  }

  return [...distinctTypes][0];
}

function readSchemaType(schema: JsonSchemaRecord): string | string[] | undefined {
  const typeValue = schema['type'];
  if (typeof typeValue === 'string') {
    return typeValue;
  }

  if (Array.isArray(typeValue)) {
    const types = typeValue.filter((entry): entry is string => typeof entry === 'string');
    if (types.length > 0) {
      return [...new Set(types)];
    }
  }

  if (asRecord(schema['properties']) || schema['additionalProperties'] !== undefined) {
    return 'object';
  }

  if (schema['items'] !== undefined) {
    return 'array';
  }

  return undefined; // OK: Explicit empty — unrecognized JSON Schema type node
}

function dedupeSchemaVariants(variants: JsonSchemaRecord[]): JsonSchemaRecord[] {
  const seen = new Set<string>();
  const deduped: JsonSchemaRecord[] = [];

  for (const variant of variants) {
    const key = JSON.stringify(variant);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(variant);
  }

  return deduped;
}

function collapseSimpleUnionVariants(variants: JsonSchemaRecord[]): string | string[] | undefined {
  const types: string[] = [];

  for (const variant of variants) {
    const keys = Object.keys(variant);
    if (keys.length !== 1 || keys[0] !== 'type') {
      return undefined; // OK: Explicit empty — variant has non-type keys, skip deduplication
    }

    const typeValue = variant['type'];
    if (typeof typeValue === 'string') {
      types.push(typeValue);
      continue;
    }

    if (Array.isArray(typeValue)) {
      const nestedTypes = typeValue.filter((entry): entry is string => typeof entry === 'string');
      if (nestedTypes.length === 0) {
        return undefined; // OK: Explicit empty — array type had no string entries
      }
      types.push(...nestedTypes);
      continue;
    }

    return undefined; // OK: Explicit empty — unrecognized typeValue kind
  }

  const uniqueTypes = [...new Set(types)];
  if (uniqueTypes.length === 0) {
    return undefined; // OK: Explicit empty — no valid types collected
  }

  return uniqueTypes.length === 1 ? uniqueTypes[0]! : uniqueTypes;
}

function simplifyJsonSchemaNode(schemaNode: unknown, depth = 0): JsonSchemaRecord | null {
  const schema = asRecord(schemaNode);
  if (!schema) {
    return null;
  }

  const simplified: JsonSchemaRecord = {};
  const enumValues = Array.isArray(schema['enum'])
    ? schema['enum'].filter(isJsonLiteral).slice(0, DEFERRED_SCHEMA_MAX_ENUM_VALUES)
    : [];

  if (enumValues.length > 0) {
    simplified['enum'] = enumValues;
  }

  if (isJsonLiteral(schema['const'])) {
    simplified['const'] = schema['const'];
  }

  const inferredType =
    readSchemaType(schema) ??
    inferTypeFromEnum(enumValues) ??
    (isJsonLiteral(schema['const'])
      ? inferTypeFromEnum([schema['const'] as JsonLiteral])
      : undefined);
  if (inferredType !== undefined) {
    simplified['type'] = inferredType;
  }

  if (depth < DEFERRED_SCHEMA_MAX_DEPTH) {
    for (const unionKey of ['oneOf', 'anyOf', 'allOf'] as const) {
      const unionEntries = schema[unionKey];
      if (!Array.isArray(unionEntries)) {
        continue;
      }

      const variants = dedupeSchemaVariants(
        unionEntries
          .slice(0, DEFERRED_SCHEMA_MAX_UNION_VARIANTS)
          .map((entry) => simplifyJsonSchemaNode(entry, depth + 1))
          .filter((entry): entry is JsonSchemaRecord => entry !== null)
      );

      if (variants.length > 0) {
        const collapsedUnionType = collapseSimpleUnionVariants(variants);
        if (collapsedUnionType !== undefined) {
          simplified['type'] = collapsedUnionType;
        } else {
          simplified[unionKey] = variants;
        }
      }
    }

    if (schema['items'] !== undefined) {
      const simplifiedItems = simplifyJsonSchemaNode(schema['items'], depth + 1);
      if (simplifiedItems) {
        simplified['items'] = simplifiedItems;
      }
    }

    const additionalProperties = schema['additionalProperties'];
    if (typeof additionalProperties === 'boolean') {
      simplified['additionalProperties'] = additionalProperties;
    } else {
      const simplifiedAdditional = simplifyJsonSchemaNode(additionalProperties, depth + 1);
      if (simplifiedAdditional) {
        simplified['additionalProperties'] = simplifiedAdditional;
      }
    }
  }

  return Object.keys(simplified).length > 0 ? simplified : null;
}

function collectPropertySchemas(
  schemaNode: unknown,
  propertySchemas: Map<string, unknown[]>
): void {
  const schema = asRecord(schemaNode);
  if (!schema) {
    return;
  }

  const properties = asRecord(schema['properties']);
  if (properties) {
    for (const [key, value] of Object.entries(properties)) {
      const existing = propertySchemas.get(key) ?? [];
      existing.push(value);
      propertySchemas.set(key, existing);
    }
  }

  for (const unionKey of ['oneOf', 'anyOf', 'allOf'] as const) {
    const unionEntries = schema[unionKey];
    if (!Array.isArray(unionEntries)) {
      continue;
    }

    for (const entry of unionEntries) {
      collectPropertySchemas(entry, propertySchemas);
    }
  }
}

function buildDeferredPropertySchemas(innerSchema: JsonSchemaRecord): JsonSchemaRecord {
  const propertySchemas = new Map<string, unknown[]>();
  collectPropertySchemas(innerSchema, propertySchemas);

  const deferredProperties: JsonSchemaRecord = {};
  for (const [propertyName, schemas] of propertySchemas.entries()) {
    if (propertyName === 'action') {
      continue;
    }

    const variants = dedupeSchemaVariants(
      schemas
        .map((schema) => simplifyJsonSchemaNode(schema))
        .filter((schema): schema is JsonSchemaRecord => schema !== null)
    );

    const collapsedVariantType = collapseSimpleUnionVariants(variants);
    const propertySchema =
      variants.length === 0
        ? {}
        : variants.length === 1
          ? variants[0]!
          : collapsedVariantType !== undefined
            ? { type: collapsedVariantType }
            : { anyOf: variants };
    deferredProperties[propertyName] = propertySchema;
  }

  return deferredProperties;
}

/**
 * Extracts action enum values from a tool's JSON Schema.
 * Handles two patterns:
 * 1. Discriminated union: oneOf with { properties: { action: { const: "value" } } }
 * 2. Direct enum: { properties: { action: { enum: ["a", "b", ...] } } }
 */
function extractActionEnum(innerSchema: Record<string, unknown>): string[] {
  const actions: string[] = [];

  // Pattern 1: Discriminated union with oneOf
  const variants = innerSchema['oneOf'] as unknown[] | undefined;
  if (Array.isArray(variants)) {
    for (const variant of variants) {
      if (!variant || typeof variant !== 'object') continue;
      const v = variant as Record<string, unknown>;
      const props = v['properties'] as Record<string, unknown> | undefined;
      const actionProp = props?.['action'] as Record<string, unknown> | undefined;
      if (actionProp?.['const'] && typeof actionProp['const'] === 'string') {
        actions.push(actionProp['const'] as string);
      }
    }
  }

  // Pattern 2: Direct enum on action property
  if (actions.length === 0) {
    const props = innerSchema['properties'] as Record<string, unknown> | undefined;
    const actionProp = props?.['action'] as Record<string, unknown> | undefined;
    if (actionProp && Array.isArray(actionProp['enum'])) {
      for (const val of actionProp['enum'] as unknown[]) {
        if (typeof val === 'string') actions.push(val);
      }
    }
  }

  return actions.sort();
}

/**
 * Builds a flat deferred schema for a tool from its full schema.
 *
 * Instead of using z.looseObject() (which the MCP client ignores for property discovery),
 * this extracts ALL property names from ALL action variants in the full schema
 * and creates a flat z.object() with z.any().optional() for each property.
 *
 * Result: ~300-800 bytes per tool (vs 2-90KB for full schemas) while still
 * listing every possible parameter so the MCP client sends them correctly.
 *
 * Total across 25 tools: ~12KB / ~3K tokens (vs 385KB / ~99K tokens for full).
 */
function buildFlatDeferredSchema(
  fullSchema: ZodSchema,
  schemaType: SchemaType
): Record<string, unknown> {
  try {
    const jsonSchema = z.toJSONSchema(fullSchema, { io: 'input' }) as Record<string, unknown>;
    const wrapperKey = schemaType === 'output' ? 'response' : 'request';

    // Extract request/response sub-schema
    const properties = jsonSchema['properties'] as Record<string, unknown> | undefined;
    const innerSchema = properties?.[wrapperKey] as Record<string, unknown> | undefined;

    if (!innerSchema) {
      // Fallback to generic passthrough
      return schemaType === 'output'
        ? {
            type: 'object',
            properties: {
              response: { type: 'object', properties: { success: { type: 'boolean' } } },
            },
          }
        : {
            type: 'object',
            properties: {
              request: {
                type: 'object',
                properties: { action: { type: 'string' } },
                additionalProperties: true,
              },
            },
          };
    }

    if (schemaType === 'output') {
      return {
        type: 'object',
        properties: {
          response: {
            type: 'object',
            properties: {
              success: {
                type: 'boolean',
              },
            },
            required: ['success'],
            additionalProperties: true,
          },
        },
      };
    }

    const actionValues = extractActionEnum(innerSchema);
    const requestProperties: JsonSchemaRecord = {
      action:
        actionValues.length > 0
          ? {
              type: 'string',
              enum: actionValues,
            }
          : {
              type: 'string',
            },
      ...buildDeferredPropertySchemas(innerSchema),
    };

    return {
      type: 'object',
      properties: {
        request: {
          type: 'object',
          properties: requestProperties,
          required: ['action'],
          additionalProperties: true,
        },
      },
    };
  } catch {
    // Fallback to generic passthrough on any error
    return schemaType === 'output'
      ? {
          type: 'object',
          properties: {
            response: { type: 'object', properties: { success: { type: 'boolean' } } },
          },
        }
      : {
          type: 'object',
          properties: {
            request: {
              type: 'object',
              properties: { action: { type: 'string' } },
              additionalProperties: true,
            },
          },
        };
  }
}

/**
 * Minimal passthrough schema for OUTPUT schemas in deferred loading mode
 * (used as fallback when full schema is not available)
 */
const MinimalOutputPassthroughSchema = z
  .object({
    response: z
      .looseObject({
        success: z.boolean().describe('Whether the operation succeeded'),
      })
      .describe(
        'Response object. Action-specific success and error fields are returned at runtime even when output schemas are deferred.'
      ),
  })
  .describe(
    'Schema deferred for token efficiency. Use the tool description and inline action parameter hints for the canonical request shape.'
  );

/**
 * Schema type for registration preparation
 */
export type SchemaType = 'input' | 'output';

/**
 * Prepares a schema for MCP SDK registration
 *
 * When SERVAL_DEFER_SCHEMAS=true (recommended for Claude Desktop):
 * - Returns a minimal passthrough schema (~200 bytes per tool)
 * - Full schemas available via schema://tools/{toolName} resources
 * - Reduces initial payload from ~231KB to ~5KB
 * - All 25 tools available with dynamic schema loading
 *
 * When SERVAL_SCHEMA_REFS=true:
 * - Pre-converts Zod schemas to JSON Schema with `reused: 'ref'` option
 * - Creates `$defs` for shared types, reducing payload by ~60%
 * - Useful for full mode to avoid overwhelming MCP clients
 *
 * When both are false (default):
 * - Returns Zod schema as-is for SDK to handle
 * - SDK converts using its own JSON Schema converter
 *
 * Note: Runtime validation in handlers uses original Zod schemas directly,
 * not the registration schema. This ensures validation works regardless of
 * whether we pre-convert or defer.
 *
 * @param schema - Zod schema to prepare
 * @param schemaType - Type of schema ('input' or 'output'), defaults to 'input'
 * @returns Minimal schema (deferred), optimized JSON Schema, or original Zod schema
 */
export function prepareSchemaForRegistration(
  schema: ZodSchema,
  schemaType: SchemaType = 'input'
): AnySchema {
  // Deferred schema mode - return flat property-list schema
  // Full schemas accessible via schema://tools/{toolName} resources
  if (DEFER_SCHEMAS) {
    if (schemaType === 'output') {
      return MinimalOutputPassthroughSchema as unknown as AnySchema;
    }
    // Build flat schema listing ALL property names from the full schema
    // This ensures the MCP client sends all parameters (not just 'action')
    // Size: ~300-800 bytes per tool vs 2-90KB for full schemas
    return buildFlatDeferredSchema(schema, schemaType) as unknown as AnySchema;
  }

  if (USE_SCHEMA_REFS || STRIP_SCHEMA_DESCRIPTIONS) {
    // Pre-convert to JSON Schema with safe error handling
    // USE_SCHEMA_REFS: Uses $ref optimization reducing payload by ~60%
    // STRIP_SCHEMA_DESCRIPTIONS: Removes inline descriptions saving ~14K tokens
    try {
      let processed = zodSchemaToJsonSchema(schema);

      // Strip descriptions if enabled (saves ~14K tokens)
      if (STRIP_SCHEMA_DESCRIPTIONS) {
        processed = stripSchemaDescriptions(processed) as Record<string, unknown>;
      }

      // IMPORTANT: SDK expects Zod schemas, not JSON Schema objects
      // We need to wrap the JSON Schema in a minimal Zod schema for SDK compatibility
      // The SDK will use the JSON Schema for tools/list but validate with Zod
      return processed as unknown as AnySchema;
    } catch (error) {
      logger.warn('Schema conversion failed, returning original Zod schema', {
        component: 'schema-helpers',
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to return original schema
    }
  }

  // Default: return Zod schema for SDK to handle
  // The SDK will convert to JSON Schema internally
  return schema as unknown as AnySchema;
}

/**
 * Prepares a schema for MCP SDK registration with caching (P0-2 optimization).
 *
 * This is the preferred function for tool registration loops where the tool name
 * is available. It caches the result of prepareSchemaForRegistration to avoid
 * redundant CPU-intensive schema transformations.
 *
 * @param toolName - Name of the tool (used as cache key)
 * @param schema - Zod schema to prepare
 * @param schemaType - Type of schema ('input' or 'output')
 * @returns Cached or freshly prepared schema
 */
export function prepareSchemaForRegistrationCached(
  toolName: string,
  schema: ZodSchema,
  schemaType: SchemaType
): AnySchema {
  const cacheKey = `${toolName}:${schemaType}`;
  return getCachedPreparedSchema(cacheKey, () => prepareSchemaForRegistration(schema, schemaType));
}

/**
 * Wrap input schema to accept older compatibility envelopes.
 *
 * Supports:
 * - the canonical schema shape
 * - { request: <canonical-schema> } (double-wrapped legacy envelope)
 * - { request: { action, params } } (legacy params wrapper)
 */
export function wrapInputSchemaForLegacyRequest(schema: ZodSchema): ZodSchema {
  const legacyParamsSchema = z
    .object({
      action: z.string(),
      params: z.record(z.string(), z.unknown()),
    })
    .strict();

  const legacyRequestSchema = z.object({
    request: z.union([schema, legacyParamsSchema]),
  });

  return z.union([schema, legacyRequestSchema]);
}

/**
 * Verifies a JSON Schema object is valid (development only)
 *
 * @param schema - Schema to verify
 */
export function verifySchemaIfNeeded(schema: unknown): void {
  if (process.env['NODE_ENV'] !== 'production') {
    const isZodSchema = (s: unknown): boolean =>
      Boolean(s && typeof s === 'object' && '_def' in (s as Record<string, unknown>));

    if (!isZodSchema(schema)) {
      verifyJsonSchema(schema);
    }
  }
}

/**
 * Public wrapper for buildFlatDeferredSchema.
 *
 * Used by tools-list-compat.ts as a fallback when full JSON Schema conversion
 * fails. Instead of returning empty `{ type: 'object', properties: {} }`,
 * this extracts action enum values and common property names from the Zod
 * schema to produce a useful ~300-800 byte schema.
 *
 * @param schema - Zod schema to build deferred schema from
 * @param schemaType - 'input' or 'output'
 * @returns Flat JSON Schema with action enum + property names
 */
export function buildDeferredFallbackSchema(
  schema: ZodSchema,
  schemaType: SchemaType
): Record<string, unknown> {
  return buildFlatDeferredSchema(schema, schemaType);
}
