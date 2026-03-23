/**
 * Serval Core - Structured Error Classes
 *
 * Platform-agnostic base error classes for consistent error handling.
 * All errors implement toErrorDetail() for conversion to ErrorDetail.
 *
 * Security: All error messages and details are automatically redacted to
 * prevent sensitive data (tokens, API keys) from leaking into logs.
 */

import type { ErrorCode, ErrorDetail } from './types.js';
import { redactString, redactObject } from '../utils/redact.js';

/**
 * Base class for all Serval errors
 *
 * Security: Automatically redacts sensitive data from message and details
 */
export abstract class ServalError extends Error {
  abstract code: ErrorCode;
  abstract retryable: boolean;
  details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(redactString(message));
    this.name = this.constructor.name;
    this.details = details ? redactObject(details) : undefined;
    Error.captureStackTrace(this, this.constructor);
  }

  abstract toErrorDetail(): ErrorDetail;
}

/**
 * ServiceError - For service initialization and operation failures
 * Use when: Service not initialized, API clients unavailable, external service errors
 */
export class ServiceError extends ServalError {
  code: ErrorCode;
  retryable: boolean;
  serviceName: string;

  constructor(
    message: string,
    code: ErrorCode,
    serviceName: string,
    retryable: boolean = false,
    details?: Record<string, unknown>
  ) {
    super(message, { ...details, serviceName });
    this.code = code;
    this.serviceName = serviceName;
    this.retryable = retryable;
  }

  toErrorDetail(): ErrorDetail {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
      resolution: this.retryable
        ? `Retry the operation. If error persists, check ${this.serviceName} service status.`
        : `Check ${this.serviceName} service configuration and initialization.`,
    };
  }
}

/**
 * ConfigError - For configuration and validation failures
 * Use when: Invalid environment variables, missing config, validation failures
 */
export class ConfigError extends ServalError {
  code: ErrorCode = 'CONFIG_ERROR';
  retryable = false;
  configKey: string;

  constructor(message: string, configKey: string, details?: Record<string, unknown>) {
    super(message, { ...details, configKey });
    this.configKey = configKey;
  }

  toErrorDetail(): ErrorDetail {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: false,
      resolution: `Fix the configuration for ${this.configKey} and restart the server.`,
      resolutionSteps: [
        `1. Check environment variable or config file for ${this.configKey}`,
        '2. Validate the value matches expected format',
        '3. Restart the server after fixing configuration',
      ],
    };
  }
}

/**
 * ValidationError - For input validation failures
 * Use when: Invalid user input, malformed data, type mismatches
 */
export class ValidationError extends ServalError {
  code: ErrorCode = 'VALIDATION_ERROR';
  retryable = false;
  field: string;
  expectedFormat?: string;

  constructor(
    message: string,
    field: string,
    expectedFormat?: string,
    details?: Record<string, unknown>
  ) {
    super(message, { ...details, field, expectedFormat });
    this.field = field;
    this.expectedFormat = expectedFormat;
  }

  toErrorDetail(): ErrorDetail {
    const steps = [
      `1. Check the value of '${this.field}'`,
      '2. Ensure it matches the required format',
    ];

    if (this.expectedFormat) {
      steps.push(`3. Expected format: ${this.expectedFormat}`);
    }

    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: false,
      resolution: `Fix the value of '${this.field}' and retry the operation.`,
      resolutionSteps: steps,
    };
  }
}

/**
 * NotFoundError - For resource not found scenarios
 * Use when: Document not found, snapshot not found, resource lookup failures
 */
export class NotFoundError extends ServalError {
  code: ErrorCode = 'NOT_FOUND';
  retryable = false;
  resourceType: string;
  resourceId: string;

  constructor(resourceType: string, resourceId: string, details?: Record<string, unknown>) {
    super(`${resourceType} not found: ${resourceId}`, {
      ...details,
      resourceType,
      resourceId,
    });
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }

  toErrorDetail(): ErrorDetail {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: false,
      resolution: `Verify that the ${this.resourceType} '${this.resourceId}' exists and is accessible.`,
      resolutionSteps: [
        `1. Check if ${this.resourceType} '${this.resourceId}' exists`,
        '2. Verify you have permission to access it',
        '3. If using a reference, ensure it is up to date',
      ],
    };
  }
}

/**
 * AuthenticationError - For OAuth and token issues
 * Use when: Token expired, invalid credentials, auth flow failures
 */
export class AuthenticationError extends ServalError {
  code: ErrorCode;
  retryable: boolean;

  constructor(
    message: string,
    code: ErrorCode = 'AUTH_ERROR',
    retryable: boolean = false,
    details?: Record<string, unknown>
  ) {
    super(message, details);
    this.code = code;
    this.retryable = retryable;
  }

  toErrorDetail(): ErrorDetail {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
      resolution: this.retryable
        ? 'Re-authenticate and retry the operation.'
        : 'Check your authentication credentials and OAuth configuration.',
    };
  }
}

/**
 * DataError - For data parsing and integrity issues
 * Use when: JSON parse failures, data corruption, version mismatches
 */
export class DataError extends ServalError {
  code: ErrorCode;
  retryable: boolean;

  constructor(
    message: string,
    code: ErrorCode = 'DATA_ERROR',
    retryable: boolean = false,
    details?: Record<string, unknown>
  ) {
    super(message, details);
    this.code = code;
    this.retryable = retryable;
  }

  toErrorDetail(): ErrorDetail {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
      resolution: 'Check data integrity and format. May require manual intervention.',
    };
  }
}

/**
 * HandlerLoadError - For handler factory and dynamic loading failures
 * Use when: Unknown handler, method not found, lazy loading failures
 */
export class HandlerLoadError extends ServalError {
  code: ErrorCode = 'HANDLER_LOAD_ERROR';
  retryable = false;
  handlerName: string;

  constructor(message: string, handlerName: string, details?: Record<string, unknown>) {
    super(message, { ...details, handlerName });
    this.handlerName = handlerName;
  }

  toErrorDetail(): ErrorDetail {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: false,
      resolution: `Check that the handler '${this.handlerName}' is registered correctly.`,
    };
  }
}

/**
 * QuotaExceededError - For API quota and rate limit exceeded scenarios
 * Use when: API quota exhausted, rate limited, quota reset time known
 */
export class QuotaExceededError extends ServalError {
  code: ErrorCode = 'QUOTA_EXCEEDED';
  retryable = true;
  quotaType: 'read' | 'write' | 'requests' | 'unknown';
  retryAfterSeconds: number;
  resetTime?: Date;

  constructor(
    message: string,
    quotaType: 'read' | 'write' | 'requests' | 'unknown' = 'unknown',
    retryAfterSeconds: number = 60,
    details?: Record<string, unknown>
  ) {
    super(message, { ...details, quotaType, retryAfterSeconds });
    this.quotaType = quotaType;
    this.retryAfterSeconds = retryAfterSeconds;
    this.resetTime = details?.['resetTime'] as Date | undefined;
  }

  toErrorDetail(): ErrorDetail {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: true,
      retryAfterMs: this.retryAfterSeconds * 1000,
      retryStrategy: 'exponential_backoff',
      resolution: `Wait ${this.retryAfterSeconds} seconds, then retry with optimized batch operations`,
      resolutionSteps: [
        `1. Wait ${this.retryAfterSeconds} seconds before retrying`,
        `2. Quota exceeded type: ${this.quotaType}`,
        '3. Optimize: use batch operations and transactions to reduce API calls',
        '4. Consider requesting higher quota limits from your API provider',
      ],
    };
  }
}

/**
 * ApiTimeoutError - For API request timeout and deadline exceeded scenarios
 * Use when: Request takes too long, deadline exceeded, slow network
 */
export class ApiTimeoutError extends ServalError {
  code: ErrorCode = 'DEADLINE_EXCEEDED';
  retryable = true;
  timeoutMs: number;
  operation?: string;

  constructor(
    message: string,
    timeoutMs: number = 30000,
    operation?: string,
    details?: Record<string, unknown>
  ) {
    super(message, { ...details, timeoutMs, operation });
    this.timeoutMs = timeoutMs;
    this.operation = operation;
  }

  toErrorDetail(): ErrorDetail {
    const timeoutSeconds = Math.ceil(this.timeoutMs / 1000);

    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: true,
      retryAfterMs: Math.min(this.timeoutMs * 2, 60000),
      retryStrategy: 'exponential_backoff',
      resolution: `Reduce request size or increase timeout, then retry.`,
      resolutionSteps: [
        `1. Request timed out after ${timeoutSeconds} seconds`,
        this.operation ? `2. Operation: ${this.operation}` : '',
        '3. Reduce request size by limiting rows/columns',
        '4. Split into smaller batches',
        '5. Retry with exponential backoff',
      ].filter(Boolean),
    };
  }
}

/**
 * SyncError - For synchronization and concurrent modification failures
 * Use when: Merge conflicts, concurrent updates, stale data, version mismatches
 */
export class SyncError extends ServalError {
  code: ErrorCode = 'TRANSACTION_CONFLICT';
  retryable = true;
  conflictType: 'concurrent_modification' | 'stale_data' | 'version_mismatch' | 'merge_conflict';

  constructor(
    message: string,
    conflictType:
      | 'concurrent_modification'
      | 'stale_data'
      | 'version_mismatch'
      | 'merge_conflict' = 'concurrent_modification',
    details?: Record<string, unknown>
  ) {
    super(message, { ...details, conflictType });
    this.conflictType = conflictType;
  }

  toErrorDetail(): ErrorDetail {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: true,
      retryStrategy: 'exponential_backoff',
      resolution: `Resolve ${this.conflictType} by fetching latest state and retrying. Use transactions for atomic updates.`,
      resolutionSteps: [
        `1. Conflict type: ${this.conflictType}`,
        '2. Fetch latest document state',
        '3. Reapply your changes to the current version',
        '4. Use transactions for atomic multi-step updates',
        '5. Retry with updated data',
      ],
    };
  }
}

/**
 * BatchCompilationError - For batch operation compilation and validation failures
 * Use when: Multiple operations fail validation, dependency errors in batch
 */
export class BatchCompilationError extends ServalError {
  code: ErrorCode = 'BATCH_UPDATE_ERROR';
  retryable = false;
  failedOperations: Array<{ index: number; error: string }>;
  totalOperations: number;

  constructor(
    message: string,
    failedOperations: Array<{ index: number; error: string }>,
    totalOperations: number,
    details?: Record<string, unknown>
  ) {
    super(message, {
      ...details,
      failedOperationCount: failedOperations.length,
      totalOperations,
    });
    this.failedOperations = failedOperations;
    this.totalOperations = totalOperations;
  }

  toErrorDetail(): ErrorDetail {
    const failureRate = ((this.failedOperations.length / this.totalOperations) * 100).toFixed(1);

    return {
      code: this.code,
      message: this.message,
      details: {
        ...this.details,
        failedOperations: this.failedOperations.slice(0, 10),
      },
      retryable: false,
      resolution: `Fix validation errors in ${this.failedOperations.length} operation(s) and retry`,
      resolutionSteps: [
        `1. Batch had ${this.failedOperations.length}/${this.totalOperations} failures (${failureRate}%)`,
        '2. Fix each failed operation:',
        ...this.failedOperations.slice(0, 5).map((op) => `   - Operation ${op.index}: ${op.error}`),
        this.failedOperations.length > 5
          ? `   - ... and ${this.failedOperations.length - 5} more failures`
          : '',
        '3. Split into smaller batches if needed',
        '4. Retry with corrected operations',
      ].filter(Boolean),
    };
  }
}
