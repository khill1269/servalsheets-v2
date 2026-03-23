/**
 * ServalSheets - Schema Inspection Utilities
 *
 * Production-grade utilities for unwrapping and inspecting Zod v4 schemas
 * using only stable APIs. These utilities work with wrapped schemas
 * (optional, default, effects, etc.) to extract the underlying type.
 *
 * ## Why This Module Exists
 *
 * Zod schemas can be wrapped in multiple layers:
 * - z.optional() - Makes a schema optional
 * - z.default() - Provides default value
 * - z.transform() / z.refine() - Adds runtime transformations/validation
 * - z.nullable() - Allows null values
 * - z.branded() - Adds type branding
 *
 * To inspect the actual base type, we need to unwrap these layers.
 *
 * ## Stable API Guarantee
 *
 * This module uses ONLY stable Zod v4 APIs:
 * - `instanceof` type checks (stable)
 * - `.unwrap()` method (stable)
 * - `.removeDefault()` method (stable)
 * - `.innerType()` method (stable)
 * - `.shape` property (stable)
 *
 * The only exception is minimal `_def` access for discriminator extraction,
 * which is unavoidable but centralized to a single function.
 *
 * @module utils/schema-inspection
 */

import { z, type ZodTypeAny } from 'zod';

type DefCarrier = ZodTypeAny & {
  _def?: Record<string, unknown>;
};

/**
 * Recursively unwraps wrapper schemas to get the base type
 *
 * Handles the following Zod wrappers in order:
 * 1. ZodOptional / ZodNullable → unwrap()
 * 2. ZodDefault → removeDefault()
 * 3. ZodEffects (transform/refine) → innerType()
 * 4. ZodBranded → inner type
 * 5. ZodReadonly → inner type
 * 6. ZodCatch → inner type
 *
 * @param schema - Any Zod schema (potentially wrapped)
 * @returns The unwrapped base schema
 *
 * @example
 * const wrapped = z.number().optional().default(10);
 * const base = unwrapSchema(wrapped);
 * // base is z.number()
 */
export function unwrapSchema(schema: ZodTypeAny): ZodTypeAny {
  let current: ZodTypeAny = schema;

  // Loop until no more wrappers found
  while (true) {
    // Unwrap optional/nullable
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap() as ZodTypeAny;
      continue;
    }

    // Unwrap default
    if (current instanceof z.ZodDefault) {
      current = current.removeDefault() as ZodTypeAny;
      continue;
    }

    // Unwrap pipes (preprocess/transform in Zod v4)
    // Two cases:
    // 1. z.preprocess(fn, schema) → pipe.in=ZodTransform, pipe.out=schema → use .out
    // 2. z.string().transform(fn) → pipe.in=ZodString, pipe.out=ZodTransform → use .in
    if (current instanceof z.ZodPipe) {
      const pipeIn = current.in as ZodTypeAny;
      const pipeOut = current.out as ZodTypeAny;

      // Check if .in is a transform (preprocess case)
      // ZodTransform has _def.type === 'transform'
      const inIsTransform = (pipeIn as unknown as DefCarrier)._def?.['type'] === 'transform';

      // For preprocess, use .out (the target schema); for transform, use .in (the input schema)
      current = inIsTransform ? pipeOut : pipeIn;
      continue;
    }

    // Unwrap readonly
    if (current instanceof z.ZodReadonly) {
      const innerType = (
        (current as unknown as DefCarrier)._def as { innerType?: ZodTypeAny } | undefined
      )?.innerType;
      if (!innerType) break;
      current = innerType;
      continue;
    }

    // Unwrap catch
    if (current instanceof z.ZodCatch) {
      const innerType = (
        (current as unknown as DefCarrier)._def as { innerType?: ZodTypeAny } | undefined
      )?.innerType;
      if (!innerType) break;
      current = innerType;
      continue;
    }

    // Unwrap effects (preprocess, transform)
    // Note: ZodEffects is not exported in Zod v4, so we check _def.typeName and _def.schema
    const def = (current as unknown as DefCarrier)._def as
      | {
          typeName?: unknown;
          schema?: unknown;
        }
      | undefined;
    if (
      def &&
      typeof def === 'object' &&
      def.typeName === 'ZodEffects' &&
      'schema' in def &&
      def.schema
    ) {
      current = def.schema as ZodTypeAny;
      continue;
    }

    // No more wrappers found
    break;
  }

  return current;
}

/**
 * Check if a schema is an enum-like type (ZodEnum)
 *
 * Note: In Zod v4, both z.enum() and z.nativeEnum() use the same ZodEnum class.
 *
 * @param schema - Any Zod schema
 * @returns true if the unwrapped schema is a ZodEnum
 *
 * @example
 * const schema = z.enum(["read", "write"]).optional();
 * isEnumLike(schema); // true
 */
export function isEnumLike(schema: ZodTypeAny): boolean {
  const unwrapped = unwrapSchema(schema);
  return unwrapped instanceof z.ZodEnum;
}

/**
 * Extract object shape from ZodObject
 *
 * Returns the shape (field definitions) from a ZodObject schema.
 * Returns null if the schema is not a ZodObject.
 *
 * @param schema - Any Zod schema
 * @returns Object shape or null
 *
 * @example
 * const schema = z.object({ name: z.string(), age: z.number() });
 * const shape = getObjectShape(schema);
 * // shape = { name: ZodString, age: ZodNumber }
 */
export function getObjectShape(schema: ZodTypeAny): Record<string, ZodTypeAny> | null {
  const unwrapped = unwrapSchema(schema);

  if (!(unwrapped instanceof z.ZodObject)) {
    return null;
  }

  // In Zod v4, .shape is a stable property
  return unwrapped.shape;
}

/**
 * Check if schema is action-based (discriminated union or flat object with action enum)
 *
 * ServalSheets uses two patterns for tool input schemas:
 * 1. Discriminated union with "action" discriminator (most tools)
 * 2. Flat object with "action" enum field (MCP SDK workaround for auth/spreadsheet)
 *
 * @param schema - Any Zod schema
 * @returns true if schema follows action-based pattern
 *
 * @example
 * // Pattern 1: Discriminated union
 * const schema1 = z.discriminatedUnion("action", [
 *   z.object({ action: z.literal("read"), ... }),
 *   z.object({ action: z.literal("write"), ... }),
 * ]);
 * isActionBasedSchema(schema1); // true
 *
 * // Pattern 2: Flat object with action enum
 * const schema2 = z.object({
 *   action: z.enum(["read", "write"]),
 *   // ... other fields
 * });
 * isActionBasedSchema(schema2); // true
 */
export function isActionBasedSchema(schema: ZodTypeAny): boolean {
  const unwrapped = unwrapSchema(schema);

  // Pattern 1: Discriminated union
  if (unwrapped instanceof z.ZodDiscriminatedUnion) {
    return true;
  }

  // Pattern 2: Flat object with action enum field
  if (unwrapped instanceof z.ZodObject) {
    const shape = unwrapped.shape;
    const actionField = shape?.['action'];
    return actionField ? isEnumLike(actionField) : false;
  }

  return false;
}

/**
 * Extract discriminator key from discriminated union
 *
 * Returns the discriminator field name (e.g., "action", "type", "kind").
 * Returns null if the schema is not a discriminated union.
 *
 * Note: This is one of the few places where _def access is necessary,
 * as Zod v4 doesn't provide a public API for extracting the discriminator.
 *
 * @param schema - Any Zod schema
 * @returns Discriminator key or null
 *
 * @example
 * const schema = z.discriminatedUnion("action", [...]);
 * getDiscriminator(schema); // "action"
 */
export function getDiscriminator(schema: ZodTypeAny): string | null {
  const unwrapped = unwrapSchema(schema);

  if (unwrapped instanceof z.ZodDiscriminatedUnion) {
    // Minimal _def access (unavoidable - no public API)
    // This is safe because the discriminator is a core stable property
    const discriminator = (
      (unwrapped as unknown as DefCarrier)._def as { discriminator?: unknown } | undefined
    )?.discriminator;
    return typeof discriminator === 'string' ? discriminator : null;
  }

  return null;
}

/**
 * Get all options/variants from a discriminated union
 *
 * Returns the array of schemas that make up the union variants.
 * Returns null if the schema is not a discriminated union.
 *
 * @param schema - Any Zod schema
 * @returns Array of variant schemas or null
 *
 * @example
 * const schema = z.discriminatedUnion("action", [
 *   z.object({ action: z.literal("read"), ... }),
 *   z.object({ action: z.literal("write"), ... }),
 * ]);
 * const options = getDiscriminatedUnionOptions(schema);
 * // options = [ZodObject, ZodObject]
 */
export function getDiscriminatedUnionOptions(schema: ZodTypeAny): ZodTypeAny[] | null {
  const unwrapped = unwrapSchema(schema);

  if (unwrapped instanceof z.ZodDiscriminatedUnion) {
    // Minimal _def access (unavoidable - no public API)
    const options = ((unwrapped as unknown as DefCarrier)._def as { options?: unknown } | undefined)
      ?.options;
    return Array.isArray(options) ? (options as ZodTypeAny[]) : null;
  }

  return null;
}

/**
 * Check if a schema is a union type (z.union())
 *
 * Note: In Zod v4, ZodDiscriminatedUnion extends ZodUnion, so we explicitly
 * exclude discriminated unions to return true only for regular unions.
 *
 * @param schema - Any Zod schema
 * @returns true if the unwrapped schema is a ZodUnion (but NOT ZodDiscriminatedUnion)
 */
export function isUnion(schema: ZodTypeAny): boolean {
  const unwrapped = unwrapSchema(schema);

  // Exclude discriminated unions (which also inherit from ZodUnion in v4)
  if (unwrapped instanceof z.ZodDiscriminatedUnion) {
    return false;
  }

  return unwrapped instanceof z.ZodUnion;
}

/**
 * Check if a schema is a discriminated union (z.discriminatedUnion())
 *
 * @param schema - Any Zod schema
 * @returns true if the unwrapped schema is a ZodDiscriminatedUnion
 */
export function isDiscriminatedUnion(schema: ZodTypeAny): boolean {
  const unwrapped = unwrapSchema(schema);
  return unwrapped instanceof z.ZodDiscriminatedUnion;
}

/**
 * Check if a schema is an object type (z.object())
 *
 * @param schema - Any Zod schema
 * @returns true if the unwrapped schema is a ZodObject
 */
export function isObject(schema: ZodTypeAny): boolean {
  const unwrapped = unwrapSchema(schema);
  return unwrapped instanceof z.ZodObject;
}

/**
 * Check if a schema is an array type (z.array())
 *
 * @param schema - Any Zod schema
 * @returns true if the unwrapped schema is a ZodArray
 */
export function isArray(schema: ZodTypeAny): boolean {
  const unwrapped = unwrapSchema(schema);
  return unwrapped instanceof z.ZodArray;
}

/**
 * Get element type from array schema
 *
 * @param schema - Any Zod schema
 * @returns Element schema or null if not an array
 *
 * @example
 * const schema = z.array(z.string()).optional();
 * const element = getArrayElement(schema);
 * // element = z.string()
 */
export function getArrayElement(schema: ZodTypeAny): ZodTypeAny | null {
  const unwrapped = unwrapSchema(schema);

  if (unwrapped instanceof z.ZodArray) {
    return unwrapped.element as ZodTypeAny;
  }

  return null;
}

/**
 * Check if a schema has a specific field
 *
 * @param schema - Any Zod schema
 * @param fieldName - Field name to check
 * @returns true if the schema is an object with the specified field
 *
 * @example
 * const schema = z.object({ name: z.string(), age: z.number() });
 * hasField(schema, "name"); // true
 * hasField(schema, "email"); // false
 */
export function hasField(schema: ZodTypeAny, fieldName: string): boolean {
  const shape = getObjectShape(schema);
  return shape !== null && fieldName in shape;
}

/**
 * Get a specific field schema from an object
 *
 * @param schema - Any Zod schema
 * @param fieldName - Field name to extract
 * @returns Field schema or null if not found
 *
 * @example
 * const schema = z.object({ name: z.string(), age: z.number() });
 * const nameSchema = getField(schema, "name");
 * // nameSchema = z.string()
 */
export function getField(schema: ZodTypeAny, fieldName: string): ZodTypeAny | null {
  const shape = getObjectShape(schema);
  if (!shape || !(fieldName in shape)) {
    return null;
  }
  return shape[fieldName] as ZodTypeAny;
}

/**
 * Get all field names from an object schema
 *
 * @param schema - Any Zod schema
 * @returns Array of field names or empty array
 *
 * @example
 * const schema = z.object({ name: z.string(), age: z.number() });
 * getFieldNames(schema); // ["name", "age"]
 */
export function getFieldNames(schema: ZodTypeAny): string[] {
  const shape = getObjectShape(schema);
  return shape ? Object.keys(shape) : [];
}
