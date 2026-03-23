/**
 * Schema Reader - Parse Zod schemas to generate valid test data
 * Reads actual schemas from src/schemas/ to ensure test arguments match
 */

import { z } from 'zod';

export interface SchemaInfo {
  tool: string;
  action: string;
  schema: z.ZodType;
  requiredFields: string[];
  optionalFields: string[];
  fieldTypes: Record<string, string>;
  description?: string;
}

/**
 * Extract schema information from a Zod schema
 */
export function analyzeSchema(schema: z.ZodType): {
  requiredFields: string[];
  optionalFields: string[];
  fieldTypes: Record<string, string>;
} {
  const requiredFields: string[] = [];
  const optionalFields: string[] = [];
  const fieldTypes: Record<string, string> = {};

  // Handle ZodObject
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    for (const [key, value] of Object.entries(shape)) {
      const fieldSchema = value as z.ZodType;

      // Determine if optional
      const isOptional =
        fieldSchema instanceof z.ZodOptional || fieldSchema instanceof z.ZodDefault;

      if (isOptional) {
        optionalFields.push(key);
      } else {
        requiredFields.push(key);
      }

      // Get field type
      fieldTypes[key] = getSchemaType(fieldSchema);
    }
  }

  // Handle ZodUnion (discriminated unions for actions)
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) {
    // For unions, we need to handle each option separately
    // This is complex, so we'll mark it as 'union'
    fieldTypes['_type'] = 'union';
  }

  return { requiredFields, optionalFields, fieldTypes };
}

/**
 * Get the type name of a Zod schema
 */
function getSchemaType(schema: z.ZodType): string {
  if (schema instanceof z.ZodString) return 'string';
  if (schema instanceof z.ZodNumber) return 'number';
  if (schema instanceof z.ZodBoolean) return 'boolean';
  if (schema instanceof z.ZodArray) return 'array';
  if (schema instanceof z.ZodObject) return 'object';
  if (schema instanceof z.ZodUnion) return 'union';
  if (schema instanceof z.ZodDiscriminatedUnion) return 'discriminatedUnion';
  if (schema instanceof z.ZodEnum) return 'enum';
  if (schema instanceof z.ZodLiteral) return 'literal';
  if (schema instanceof z.ZodOptional) {
    const unwrapped = schema.unwrap();
    return getSchemaType(unwrapped) + '?';
  }
  if (schema instanceof z.ZodDefault) {
    const unwrapped = schema._def.innerType;
    return getSchemaType(unwrapped) + ' (default)';
  }
  return 'unknown';
}

/**
 * Get all action schemas for a tool
 */
export async function getToolSchemas(tool: string): Promise<SchemaInfo[]> {
  try {
    // Import the schema module
    const schemaModule = await import(`../../src/schemas/${tool.replace('sheets_', '')}.js`);

    // Get the main schema (usually named like SheetsValuesSchema)
    const schemas: SchemaInfo[] = [];

    // Look for exported schemas
    for (const [key, value] of Object.entries(schemaModule)) {
      if (value && typeof value === 'object' && '_def' in value) {
        const schema = value as z.ZodType;
        const info = analyzeSchema(schema);

        schemas.push({
          tool,
          action: '', // Will be determined from discriminated union
          schema,
          ...info,
        });
      }
    }

    return schemas;
  } catch (error) {
    console.warn(`Could not load schema for ${tool}:`, error);
    return [];
  }
}

/**
 * Parse discriminated union to get individual action schemas
 */
export function parseDiscriminatedUnion(schema: z.ZodType): Map<string, z.ZodType> {
  const actionSchemas = new Map<string, z.ZodType>();

  if (schema instanceof z.ZodDiscriminatedUnion) {
    const options = schema.options;
    for (const option of options) {
      if (option instanceof z.ZodObject) {
        const shape = option.shape;
        const actionField = shape['action'] || shape['type'];

        if (actionField instanceof z.ZodLiteral) {
          const actionName = actionField.value as string;
          actionSchemas.set(actionName, option);
        }
      }
    }
  }

  return actionSchemas;
}

/**
 * Validate test data against schema
 */
export function validateAgainstSchema(
  schema: z.ZodType,
  data: any
): {
  valid: boolean;
  errors?: z.ZodError;
} {
  try {
    schema.parse(data);
    return { valid: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { valid: false, errors: error };
    }
    throw error;
  }
}
