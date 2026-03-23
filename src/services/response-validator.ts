/**
 * ServalSheets - Response Validator
 *
 * Phase 2.2: Validate Google Sheets API Responses
 * Uses Google Discovery API schemas to validate batchUpdate responses,
 * detecting breaking changes and ensuring type safety.
 *
 * Key Benefits:
 * - Catch breaking changes in Google API responses early
 * - Provide detailed validation errors for debugging
 * - Enable runtime type checking of API responses
 * - Support graceful degradation when schemas are unavailable
 *
 * Design Principles:
 * 1. Fail-safe: Validation failures warn but don't crash
 * 2. Performance: Lazy-load schemas only when validation is enabled
 * 3. Developer-friendly: Detailed error messages with paths
 * 4. Production-ready: Disable in production to avoid overhead
 */

import type { sheets_v4 } from 'googleapis';
import { logger } from '../utils/logger.js';
import {
  getDiscoveryApiClient,
  type DiscoverySchema,
  type SchemaDefinition,
} from './discovery-client.js';

/**
 * Validation result for a single field
 */
export interface ValidationError {
  /** Path to the field (e.g., "replies[0].addSheet.properties.sheetId") */
  path: string;
  /** Expected type from schema */
  expected: string;
  /** Actual type/value found */
  actual: string;
  /** Validation error message */
  message: string;
  /** Severity: 'error' for breaking changes, 'warning' for deprecations */
  severity: 'error' | 'warning';
}

/**
 * Validation result for an API response
 */
export interface ValidationResult {
  /** Whether the response is valid */
  valid: boolean;
  /** Array of validation errors */
  errors: ValidationError[];
  /** Array of validation warnings */
  warnings: ValidationError[];
  /** Whether schema validation was actually performed */
  validated: boolean;
  /** Reason for skipping validation (if not validated) */
  skipReason?: string;
}

/**
 * Response Validator Configuration
 */
export interface ResponseValidatorConfig {
  /** Enable schema validation (default: from env SCHEMA_VALIDATION_ENABLED) */
  enabled?: boolean;
  /** Fail on validation errors (default: false, just warn) */
  strict?: boolean;
  /** Validate deprecated fields (default: true) */
  checkDeprecations?: boolean;
  /** Maximum depth for recursive validation (default: 10) */
  maxDepth?: number;
}

/**
 * Response Validator
 *
 * Validates Google Sheets API responses against Discovery API schemas.
 * Helps detect breaking changes and ensures type safety at runtime.
 */
export class ResponseValidator {
  private discoveryClient = getDiscoveryApiClient();
  private schemasCache: Map<string, DiscoverySchema> = new Map();
  private readonly enabled: boolean;
  private readonly strict: boolean;
  private readonly checkDeprecations: boolean;
  private readonly maxDepth: number;

  constructor(config: ResponseValidatorConfig = {}) {
    this.enabled = config.enabled ?? process.env['SCHEMA_VALIDATION_ENABLED'] === 'true';
    this.strict = config.strict ?? false;
    this.checkDeprecations = config.checkDeprecations ?? true;
    this.maxDepth = config.maxDepth ?? 10;

    if (!this.enabled) {
      logger.debug('Response validation is disabled', {
        hint: 'Set SCHEMA_VALIDATION_ENABLED=true to enable',
      });
    }
  }

  /**
   * Check if validation is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Validate a batchUpdate response
   */
  async validateBatchUpdateResponse(
    response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse
  ): Promise<ValidationResult> {
    if (!this.enabled) {
      return {
        valid: true,
        errors: [],
        warnings: [],
        validated: false,
        skipReason: 'Response validation is disabled',
      };
    }

    // Check if Discovery API is available
    if (!this.discoveryClient.isEnabled()) {
      return {
        valid: true,
        errors: [],
        warnings: [],
        validated: false,
        skipReason: 'Discovery API is not enabled (required for response validation)',
      };
    }

    try {
      // Get Sheets API schema
      const schema = await this.getSchema('sheets', 'v4');

      // Find BatchUpdateSpreadsheetResponse schema definition
      const responseSchema = schema.schemas['BatchUpdateSpreadsheetResponse'];
      if (!responseSchema) {
        logger.warn('BatchUpdateSpreadsheetResponse schema not found in Discovery API');
        return {
          valid: true,
          errors: [],
          warnings: [],
          validated: false,
          skipReason: 'Response schema not found in Discovery API',
        };
      }

      // Validate the response
      const errors: ValidationError[] = [];
      const warnings: ValidationError[] = [];

      this.validateObject(
        response,
        responseSchema,
        schema.schemas,
        'response',
        errors,
        warnings,
        0
      );

      // Check if validation passed
      const valid = errors.length === 0;

      if (!valid) {
        logger.warn('Response validation failed', {
          errorCount: errors.length,
          warningCount: warnings.length,
          errors: errors.slice(0, 5), // Log first 5 errors
        });

        if (this.strict) {
          throw new ResponseValidationError(
            `Response validation failed with ${errors.length} error(s)`,
            errors,
            warnings
          );
        }
      } else if (warnings.length > 0) {
        logger.info('Response validation passed with warnings', {
          warningCount: warnings.length,
          warnings: warnings.slice(0, 5), // Log first 5 warnings
        });
      }

      return {
        valid,
        errors,
        warnings,
        validated: true,
      };
    } catch (error) {
      logger.error('Response validation failed with exception', { error });

      // Don't fail the entire operation if validation fails
      return {
        valid: true,
        errors: [],
        warnings: [],
        validated: false,
        skipReason: `Validation exception: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Validate an arbitrary response against a schema type
   */
  async validateResponse(
    response: unknown,
    schemaType: string,
    api: 'sheets' | 'drive' = 'sheets',
    version = 'v4'
  ): Promise<ValidationResult> {
    if (!this.enabled) {
      return {
        valid: true,
        errors: [],
        warnings: [],
        validated: false,
        skipReason: 'Response validation is disabled',
      };
    }

    try {
      const schema = await this.getSchema(api, version);
      const typeSchema = schema.schemas[schemaType];

      if (!typeSchema) {
        return {
          valid: true,
          errors: [],
          warnings: [],
          validated: false,
          skipReason: `Schema type '${schemaType}' not found in ${api} ${version}`,
        };
      }

      const errors: ValidationError[] = [];
      const warnings: ValidationError[] = [];

      this.validateObject(response, typeSchema, schema.schemas, 'response', errors, warnings, 0);

      const valid = errors.length === 0;

      return {
        valid,
        errors,
        warnings,
        validated: true,
      };
    } catch (error) {
      return {
        valid: true,
        errors: [],
        warnings: [],
        validated: false,
        skipReason: `Validation exception: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get schema from cache or Discovery API
   */
  private async getSchema(api: 'sheets' | 'drive', version: string): Promise<DiscoverySchema> {
    const cacheKey = `${api}-${version}`;
    const cached = this.schemasCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const schema = await this.discoveryClient.getApiSchema(api, version);
    this.schemasCache.set(cacheKey, schema);

    return schema;
  }

  /**
   * Validate an object against a schema definition
   */
  private validateObject(
    value: unknown,
    schema: SchemaDefinition,
    allSchemas: Record<string, SchemaDefinition>,
    path: string,
    errors: ValidationError[],
    warnings: ValidationError[],
    depth: number
  ): void {
    // Prevent infinite recursion
    if (depth > this.maxDepth) {
      warnings.push({
        path,
        expected: schema.type,
        actual: typeof value,
        message: `Maximum validation depth (${this.maxDepth}) exceeded`,
        severity: 'warning',
      });
      return;
    }

    // Handle null/undefined
    if (value === null || value === undefined) {
      // Check if field is required
      if (schema.required && schema.required.length > 0) {
        errors.push({
          path,
          expected: schema.type,
          actual: String(value),
          message: `Field is required but got ${value}`,
          severity: 'error',
        });
      }
      return;
    }

    // Check for deprecation
    if (this.checkDeprecations && schema.deprecated) {
      warnings.push({
        path,
        expected: schema.type,
        actual: typeof value,
        message: schema.description || 'This field is deprecated',
        severity: 'warning',
      });
    }

    // Validate based on schema type
    switch (schema.type) {
      case 'object':
        this.validateObjectType(value, schema, allSchemas, path, errors, warnings, depth);
        break;
      case 'array':
        this.validateArrayType(value, schema, allSchemas, path, errors, warnings, depth);
        break;
      case 'string':
        this.validateStringType(value, schema, path, errors);
        break;
      case 'integer':
      case 'number':
        this.validateNumberType(value, schema, path, errors);
        break;
      case 'boolean':
        this.validateBooleanType(value, schema, path, errors);
        break;
      default:
        // Unknown type - just warn
        warnings.push({
          path,
          expected: schema.type,
          actual: typeof value,
          message: `Unknown schema type: ${schema.type}`,
          severity: 'warning',
        });
    }
  }

  /**
   * Validate object type
   */
  private validateObjectType(
    value: unknown,
    schema: SchemaDefinition,
    allSchemas: Record<string, SchemaDefinition>,
    path: string,
    errors: ValidationError[],
    warnings: ValidationError[],
    depth: number
  ): void {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push({
        path,
        expected: 'object',
        actual: Array.isArray(value) ? 'array' : typeof value,
        message: `Expected object but got ${Array.isArray(value) ? 'array' : typeof value}`,
        severity: 'error',
      });
      return;
    }

    const obj = value as Record<string, unknown>;

    // Validate properties
    if (schema.properties) {
      for (const [propName, propDef] of Object.entries(schema.properties)) {
        const propPath = `${path}.${propName}`;
        const propValue = obj[propName];

        // Resolve $ref if present
        if (propDef.$ref) {
          const refName = propDef.$ref;
          const refSchema = allSchemas[refName];
          if (refSchema) {
            this.validateObject(
              propValue,
              refSchema,
              allSchemas,
              propPath,
              errors,
              warnings,
              depth + 1
            );
          } else {
            warnings.push({
              path: propPath,
              expected: refName,
              actual: typeof propValue,
              message: `Referenced schema '${refName}' not found`,
              severity: 'warning',
            });
          }
        } else {
          // Validate property inline
          const propSchema: SchemaDefinition = {
            type: propDef.type || 'any',
            properties: propDef.properties,
            items: propDef.items,
            deprecated: propDef.deprecated,
            enum: propDef.enum,
          };
          this.validateObject(
            propValue,
            propSchema,
            allSchemas,
            propPath,
            errors,
            warnings,
            depth + 1
          );
        }
      }
    }

    // Check for required fields
    if (schema.required) {
      for (const requiredField of schema.required) {
        if (!(requiredField in obj)) {
          errors.push({
            path: `${path}.${requiredField}`,
            expected: 'required field',
            actual: 'missing',
            message: `Required field '${requiredField}' is missing`,
            severity: 'error',
          });
        }
      }
    }
  }

  /**
   * Validate array type
   */
  private validateArrayType(
    value: unknown,
    schema: SchemaDefinition,
    allSchemas: Record<string, SchemaDefinition>,
    path: string,
    errors: ValidationError[],
    warnings: ValidationError[],
    depth: number
  ): void {
    if (!Array.isArray(value)) {
      errors.push({
        path,
        expected: 'array',
        actual: typeof value,
        message: `Expected array but got ${typeof value}`,
        severity: 'error',
      });
      return;
    }

    // Validate array items
    if (schema.items) {
      const itemsSchema = schema.items;

      for (let i = 0; i < value.length; i++) {
        const itemPath = `${path}[${i}]`;
        const itemValue = value[i];

        // Resolve $ref if present
        if (itemsSchema.$ref) {
          const refName = itemsSchema.$ref;
          const refSchema = allSchemas[refName];
          if (refSchema) {
            this.validateObject(
              itemValue,
              refSchema,
              allSchemas,
              itemPath,
              errors,
              warnings,
              depth + 1
            );
          }
        } else {
          // Validate item inline
          const itemSchemaObj: SchemaDefinition = {
            type: itemsSchema.type || 'any',
            properties: itemsSchema.properties,
            items: itemsSchema.items,
          };
          this.validateObject(
            itemValue,
            itemSchemaObj,
            allSchemas,
            itemPath,
            errors,
            warnings,
            depth + 1
          );
        }
      }
    }
  }

  /**
   * Validate string type
   */
  private validateStringType(
    value: unknown,
    schema: SchemaDefinition,
    path: string,
    errors: ValidationError[]
  ): void {
    if (typeof value !== 'string') {
      errors.push({
        path,
        expected: 'string',
        actual: typeof value,
        message: `Expected string but got ${typeof value}`,
        severity: 'error',
      });
      return;
    }

    // Validate enum values
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push({
        path,
        expected: `one of [${schema.enum.join(', ')}]`,
        actual: value,
        message: `Value '${value}' is not in enum [${schema.enum.join(', ')}]`,
        severity: 'error',
      });
    }

    // Validate pattern
    if (schema.pattern) {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(value)) {
        errors.push({
          path,
          expected: `pattern: ${schema.pattern}`,
          actual: value,
          message: `Value '${value}' does not match pattern ${schema.pattern}`,
          severity: 'error',
        });
      }
    }
  }

  /**
   * Validate number type
   */
  private validateNumberType(
    value: unknown,
    schema: SchemaDefinition,
    path: string,
    errors: ValidationError[]
  ): void {
    if (typeof value !== 'number') {
      errors.push({
        path,
        expected: schema.type,
        actual: typeof value,
        message: `Expected ${schema.type} but got ${typeof value}`,
        severity: 'error',
      });
      return;
    }

    // Validate integer type
    if (schema.type === 'integer' && !Number.isInteger(value)) {
      errors.push({
        path,
        expected: 'integer',
        actual: String(value),
        message: `Expected integer but got ${value}`,
        severity: 'error',
      });
    }

    // Validate minimum
    if (schema.minimum !== undefined) {
      const min = parseFloat(schema.minimum);
      if (value < min) {
        errors.push({
          path,
          expected: `>= ${min}`,
          actual: String(value),
          message: `Value ${value} is less than minimum ${min}`,
          severity: 'error',
        });
      }
    }

    // Validate maximum
    if (schema.maximum !== undefined) {
      const max = parseFloat(schema.maximum);
      if (value > max) {
        errors.push({
          path,
          expected: `<= ${max}`,
          actual: String(value),
          message: `Value ${value} is greater than maximum ${max}`,
          severity: 'error',
        });
      }
    }
  }

  /**
   * Validate boolean type
   */
  private validateBooleanType(
    value: unknown,
    schema: SchemaDefinition,
    path: string,
    errors: ValidationError[]
  ): void {
    if (typeof value !== 'boolean') {
      errors.push({
        path,
        expected: 'boolean',
        actual: typeof value,
        message: `Expected boolean but got ${typeof value}`,
        severity: 'error',
      });
    }
  }

  /**
   * Clear schema cache
   */
  clearCache(): void {
    this.schemasCache.clear();
    logger.info('Cleared response validator cache');
  }
}

/**
 * Response Validation Error
 *
 * Thrown when response validation fails in strict mode
 */
export class ResponseValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: ValidationError[],
    public readonly warnings: ValidationError[]
  ) {
    super(message);
    this.name = 'ResponseValidationError';
  }
}

/**
 * Global response validator instance
 */
let globalValidator: ResponseValidator | null = null;

/**
 * Get or create global response validator
 */
export function getResponseValidator(): ResponseValidator {
  if (!globalValidator) {
    globalValidator = new ResponseValidator({
      enabled: process.env['SCHEMA_VALIDATION_ENABLED'] === 'true',
      strict: process.env['SCHEMA_VALIDATION_STRICT'] === 'true',
      checkDeprecations: process.env['SCHEMA_CHECK_DEPRECATIONS'] !== 'false',
    });
  }
  return globalValidator;
}

/**
 * Reset global response validator
 */
export function resetResponseValidator(): void {
  if (globalValidator) {
    globalValidator.clearCache();
  }
  globalValidator = null;
}
