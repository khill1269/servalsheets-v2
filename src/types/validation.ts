/**
 * ServalSheets - Enhanced Validation Types
 *
 * Type definitions for comprehensive validation system
 *
 * Phase 4, Task 4.4
 */

import type { GoogleApiClient } from '../services/google-api.js';

/**
 * Validation rule type
 */
export type ValidationRuleType =
  | 'data_type'
  | 'range'
  | 'format'
  | 'uniqueness'
  | 'required'
  | 'pattern'
  | 'custom'
  | 'business_rule';

/**
 * Validation severity
 */
export type ValidationSeverity = 'error' | 'warning' | 'info';

/**
 * Data type for validation
 */
export type DataType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'time'
  | 'datetime'
  | 'email'
  | 'url'
  | 'phone'
  | 'currency'
  | 'percentage';

/**
 * Validation rule
 */
export interface ValidationRule {
  /** Rule ID */
  id: string;

  /** Rule name */
  name: string;

  /** Rule type */
  type: ValidationRuleType;

  /** Rule description */
  description: string;

  /** Validator function */
  validator: (value: unknown, context?: ValidationContext) => ValidationResult;

  /** Severity */
  severity: ValidationSeverity;

  /** Error message template */
  errorMessage: string;

  /** Enabled */
  enabled: boolean;

  /** Tags */
  tags?: string[];
}

/**
 * Validation context
 */
export interface ValidationContext {
  /** Spreadsheet ID */
  spreadsheetId?: string;

  /** Sheet name */
  sheetName?: string;

  /** Range */
  range?: string;

  /** Operation type */
  operationType?: string;

  /** Specific rule IDs to run (if omitted, all rules run) */
  rules?: string[];

  /** Additional data */
  metadata?: Record<string, unknown>;
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Valid */
  valid: boolean;

  /** Error message */
  message?: string;

  /** Severity */
  severity?: ValidationSeverity;

  /** Details */
  details?: Record<string, unknown>;
}

/**
 * Validation error
 */
export interface ValidationError {
  /** Error ID */
  id: string;

  /** Rule that failed */
  rule: ValidationRule;

  /** Value that failed */
  value: unknown;

  /** Error message */
  message: string;

  /** Severity */
  severity: ValidationSeverity;

  /** Cell reference (if applicable) */
  cell?: string;

  /** Context */
  context?: ValidationContext;

  /** Timestamp */
  timestamp: number;

  /** Suggestions */
  suggestions?: string[];
}

/**
 * Validation report
 */
export interface ValidationReport {
  /** Report ID */
  id: string;

  /** Overall valid */
  valid: boolean;

  /** Total checks */
  totalChecks: number;

  /** Passed checks */
  passedChecks: number;

  /** Failed checks */
  failedChecks: number;

  /** Errors */
  errors: ValidationError[];

  /** Warnings */
  warnings: ValidationError[];

  /** Info messages */
  infoMessages: ValidationError[];

  /** Duration (ms) */
  duration: number;

  /** Timestamp */
  timestamp: number;

  /** Context */
  context?: ValidationContext;
}

/**
 * Data type validation options
 */
export interface DataTypeValidation {
  /** Expected data type */
  dataType: DataType;

  /** Allow null */
  allowNull?: boolean;

  /** Coerce type */
  coerce?: boolean;

  /** Strict mode */
  strict?: boolean;
}

/**
 * Range validation options
 */
export interface RangeValidation {
  /** Minimum value */
  min?: number;

  /** Maximum value */
  max?: number;

  /** Exclusive minimum */
  exclusiveMin?: boolean;

  /** Exclusive maximum */
  exclusiveMax?: boolean;
}

/**
 * Format validation options
 */
export interface FormatValidation {
  /** Pattern (regex) */
  pattern?: string;

  /** Format type */
  format?: 'email' | 'url' | 'phone' | 'date' | 'time' | 'custom';

  /** Custom format validator */
  customValidator?: (value: string) => boolean;
}

/**
 * Uniqueness validation options
 */
export interface UniquenessValidation {
  /** Scope */
  scope: 'column' | 'sheet' | 'spreadsheet';

  /** Case sensitive */
  caseSensitive?: boolean;

  /** Ignore empty */
  ignoreEmpty?: boolean;
}

/**
 * Required field validation options
 */
export interface RequiredValidation {
  /** Allow empty string */
  allowEmpty?: boolean;

  /** Allow whitespace only */
  allowWhitespace?: boolean;
}

/**
 * Pattern validation options
 */
export interface PatternValidation {
  /** Regex pattern */
  pattern: string;

  /** Flags */
  flags?: string;

  /** Error message */
  message?: string;
}

/**
 * Custom validation options
 */
export interface CustomValidation {
  /** Validator function */
  validator: (value: unknown, context?: ValidationContext) => boolean | Promise<boolean>;

  /** Error message */
  message: string;

  /** Async */
  async?: boolean;
}

/**
 * Business rule validation options
 */
export interface BusinessRuleValidation {
  /** Rule name */
  ruleName: string;

  /** Rule function */
  rule: (data: unknown, context?: ValidationContext) => boolean | Promise<boolean>;

  /** Description */
  description: string;

  /** Error message */
  errorMessage: string;
}

/**
 * Validation engine configuration
 */
export interface ValidationEngineConfig {
  /** Enable validation */
  enabled?: boolean;

  /** Validate before operations */
  validateBeforeOperations?: boolean;

  /** Stop on first error */
  stopOnFirstError?: boolean;

  /** Maximum errors to collect */
  maxErrors?: number;

  /** Async validation timeout (ms) */
  asyncTimeout?: number;

  /** Enable caching */
  enableCaching?: boolean;

  /** Cache TTL (ms) */
  cacheTtl?: number;

  /** Verbose logging */
  verboseLogging?: boolean;

  /** Google API client for real-time validation */
  googleClient?: GoogleApiClient;
}

/**
 * Validation engine statistics
 */
export interface ValidationEngineStats {
  /** Total validations */
  totalValidations: number;

  /** Passed validations */
  passedValidations: number;

  /** Failed validations */
  failedValidations: number;

  /** Success rate */
  successRate: number;

  /** Average validation time (ms) */
  avgValidationTime: number;

  /** Errors by type */
  errorsByType: Record<ValidationRuleType, number>;

  /** Errors by severity */
  errorsBySeverity: Record<ValidationSeverity, number>;

  /** Cache hit rate */
  cacheHitRate?: number;
}

/**
 * Validator factory options
 */
export interface ValidatorFactoryOptions {
  /** Rule type */
  type: ValidationRuleType;

  /** Options specific to type */
  options: Record<string, unknown>;

  /** Severity */
  severity?: ValidationSeverity;

  /** Error message */
  errorMessage?: string;
}
