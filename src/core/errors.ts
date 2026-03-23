/**
 * ServalSheets - Structured Error Classes
 *
 * Google Sheets-specific error classes extending @serval/core's base errors.
 * Adds: RangeResolutionError, Sheets-specific resolution steps with tool references.
 *
 * Security: All error messages and details are automatically redacted to
 * prevent sensitive data (tokens, API keys) from leaking into logs.
 */

import { ServalError } from '@serval/core';
import type { ErrorDetail } from '../schemas/shared.js';

type ErrorCode = ErrorDetail['code'];

// Re-export the base class for any callers that need it
export { ServalError };

/**
 * @deprecated Use ServalError from @serval/core directly
 */
export type ServalSheetsError = ServalError;

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
 * Use when: Spreadsheet not found, snapshot not found, resource lookup failures
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
      resolutionSteps: this.retryable
        ? [
            '1. Refresh your access token',
            '2. Re-authenticate if refresh fails',
            '3. Retry the operation',
          ]
        : [
            '1. Verify OAuth client credentials',
            '2. Check OAuth flow configuration',
            '3. Ensure redirect URIs are correct',
          ],
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
 * RangeResolutionError - For range resolution and parsing failures
 * Use when: Invalid range format, sheet not found, range coordinates out of bounds
 */
export class RangeResolutionError extends ServalError {
  code: ErrorCode;
  retryable: boolean;
  rangeInput?: string;
  sheetName?: string;

  constructor(
    message: string,
    code: string = 'INVALID_RANGE',
    details: Record<string, unknown> = {},
    retryable: boolean = false
  ) {
    super(message, details);
    this.code = code as ErrorCode;
    this.retryable = retryable;
    this.rangeInput = details?.['range'] as string | undefined;
    this.sheetName = details?.['sheetName'] as string | undefined;
  }

  toErrorDetail(): ErrorDetail {
    const resolutionSteps: string[] = [];

    if (this.code === 'INVALID_RANGE') {
      resolutionSteps.push(
        '1. Check A1 notation format: Use "Sheet1!A1:D10" or "A1:D10"',
        '2. Valid examples: "Sheet1!A1", "Sheet1!A:A" (column), "Sheet1!1:1" (row)',
        '3. Escape sheet names with spaces: "\'My Sheet\'!A1:B10"',
        '4. Verify cell coordinates are valid (column A-ZZZ, rows 1-10000000)',
        `5. Your input: "${this.rangeInput}"`,
        '6. Try semantic range syntax: {"semantic":{"sheet":"Sales","column":"Revenue"}}'
      );
    } else if (this.code === 'SHEET_NOT_FOUND') {
      resolutionSteps.push(
        `1. List all sheets: Use sheets_core action:"list_sheets"`,
        this.sheetName
          ? `2. Sheet requested: "${this.sheetName}" (case-sensitive)`
          : '2. Check sheet name (case-sensitive)',
        '3. Verify sheet name spelling exactly as shown in Google Sheets',
        '4. Confirm the sheet was not deleted or renamed',
        '5. Try using sheet ID (numeric gid) instead of name'
      );
    } else if (this.code === 'RANGE_NOT_FOUND') {
      resolutionSteps.push(
        '1. Verify the sheet name exists',
        '2. Check column headers match your query exactly',
        '3. Use sheets_core to get sheet structure and column names',
        '4. Try semantic range: {"semantic":{"column":"ColumnName"}}',
        '5. Verify range coordinates are within sheet bounds'
      );
    } else if (this.code === 'AMBIGUOUS_RANGE') {
      resolutionSteps.push(
        '1. Multiple columns match your query',
        '2. Specify exact column name or use A1 notation instead',
        '3. Use sheets_core to see all available columns',
        '4. Try: {"semantic":{"sheet":"Sheet1","column":"ExactName"}}',
        '5. Or use explicit A1 notation: "Sheet1!C1:C100"'
      );
    } else if (this.code === 'AUTHENTICATION_REQUIRED') {
      resolutionSteps.push(
        '1. Check auth status: sheets_auth action="status"',
        '2. Start OAuth flow: sheets_auth action="login"',
        '3. Complete OAuth consent in browser window',
        '4. Grant Google Sheets access permissions',
        '5. Retry range resolution after authentication'
      );
    }

    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
      resolution: `Fix the range format and retry. ${this.code === 'AUTHENTICATION_REQUIRED' ? 'Authentication required first.' : ''}`,
      resolutionSteps,
      suggestedTools:
        this.code === 'AUTHENTICATION_REQUIRED' ? ['sheets_auth'] : ['sheets_core', 'sheets_data'],
    };
  }
}

/**
 * BatchCompilationError - For batch operation compilation and validation failures
 * Use when: Multiple operations fail validation, dependency errors in batch, schema mismatches
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

    const resolutionSteps = [
      `1. Batch had ${this.failedOperations.length} failed operations out of ${this.totalOperations} (${failureRate}%)`,
      '2. Common issues:',
      '   - Invalid range format in operation (use "Sheet1!A1:B10")',
      '   - Sheet name mismatch (case-sensitive)',
      '   - Circular reference in formulas',
      '   - Protected ranges or sheets',
      '3. Check each failed operation:',
      ...this.failedOperations.slice(0, 5).map((op) => `   - Operation ${op.index}: ${op.error}`),
      this.failedOperations.length > 5
        ? `   - ... and ${this.failedOperations.length - 5} more failures`
        : '',
      '4. Fix issues and split into smaller batches if needed',
      '5. Retry with corrected operations',
      '6. Use sheets_transaction with smaller batch size (max 50 operations recommended)',
    ].filter(Boolean);

    return {
      code: this.code,
      message: this.message,
      details: {
        ...this.details,
        failedOperations: this.failedOperations.slice(0, 10),
      },
      retryable: false,
      resolution: `Fix validation errors in ${this.failedOperations.length} operation(s) and retry with corrected batch`,
      resolutionSteps,
      suggestedTools: ['sheets_transaction', 'sheets_core', 'sheets_quality'],
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
    super(message, {
      ...details,
      quotaType,
      retryAfterSeconds,
    });
    this.quotaType = quotaType;
    this.retryAfterSeconds = retryAfterSeconds;
    this.resetTime = details?.['resetTime'] as Date | undefined;
  }

  toErrorDetail(): ErrorDetail {
    const resetTimeStr = this.resetTime
      ? this.resetTime.toISOString()
      : new Date(Date.now() + this.retryAfterSeconds * 1000).toISOString();

    const resolutionSteps = [
      `1. Wait ${this.retryAfterSeconds} seconds before retrying (quota resets at ${resetTimeStr})`,
      '2. Quota exceeded type: ' + this.quotaType,
      '3. Optimize future requests:',
      '   - Use batch operations: sheets_data action="batch_read" (saves ~80% quota)',
      '   - Use transactions: sheets_transaction (batches 10+ ops into 1 API call)',
      '   - Enable caching for repeated reads',
      '   - Avoid polling - use event-driven updates instead',
      '4. Monitor quota usage:',
      '   - Check: sheets_auth action="status"',
      '   - Review Google Cloud Console quota metrics',
      '   - Set up quota alerts',
      '5. Alternative approaches:',
      '   - Break large operations into smaller batches',
      '   - Process data offline if possible',
      '   - Request higher quota limits from Google Cloud Console',
      `6. Retry after waiting: ${this.retryAfterSeconds}s have passed`,
    ];

    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: true,
      retryAfterMs: this.retryAfterSeconds * 1000,
      retryStrategy: 'exponential_backoff',
      resolution: `Wait ${this.retryAfterSeconds} seconds, then retry with optimized batch operations`,
      resolutionSteps,
      suggestedTools: ['sheets_data', 'sheets_transaction', 'sheets_auth'],
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
    super(message, {
      ...details,
      timeoutMs,
      operation,
    });
    this.timeoutMs = timeoutMs;
    this.operation = operation;
  }

  toErrorDetail(): ErrorDetail {
    const timeoutSeconds = Math.ceil(this.timeoutMs / 1000);

    const resolutionSteps = [
      `1. Request timed out after ${timeoutSeconds} seconds`,
      this.operation ? `2. Operation: ${this.operation}` : '',
      '2. Common causes:',
      '   - Large request size (too many cells or rows)',
      '   - Slow network connection',
      '   - Google Sheets API latency spike',
      '   - Complex formulas being recalculated',
      '3. Optimization strategies:',
      '   - Reduce request size by limiting rows/columns',
      '   - Split into smaller batches',
      '   - Use batch operations instead of individual requests',
      '   - Disable formula recalculation if possible',
      '4. Increase timeout if appropriate:',
      `   - Current timeout: ${timeoutSeconds}s`,
      '   - Retry with increased timeout setting',
      '5. Check network:',
      '   - Verify internet connection is stable',
      '   - Try from a different network if possible',
      '6. Verify operation is necessary:',
      '   - Can you paginate results?',
      '   - Can you cache intermediate results?',
      '   - Can you reduce data scope?',
      '7. Retry with exponential backoff (start with 2x timeout)',
    ].filter(Boolean);

    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: true,
      retryAfterMs: Math.min(this.timeoutMs * 2, 60000),
      retryStrategy: 'exponential_backoff',
      resolution: `Reduce request size or increase timeout, then retry. Consider using batch operations for large requests.`,
      resolutionSteps,
      suggestedTools: ['sheets_data', 'sheets_transaction', 'sheets_analyze'],
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
  lastKnownVersion?: number;
  currentVersion?: number;

  constructor(
    message: string,
    conflictType:
      | 'concurrent_modification'
      | 'stale_data'
      | 'version_mismatch'
      | 'merge_conflict' = 'concurrent_modification',
    details?: Record<string, unknown>
  ) {
    super(message, {
      ...details,
      conflictType,
    });
    this.conflictType = conflictType;
    this.lastKnownVersion = details?.['lastKnownVersion'] as number | undefined;
    this.currentVersion = details?.['currentVersion'] as number | undefined;
  }

  toErrorDetail(): ErrorDetail {
    let resolutionSteps: string[] = [];

    if (this.conflictType === 'concurrent_modification') {
      resolutionSteps = [
        '1. Concurrent modification detected - spreadsheet was edited by another user',
        '2. Resolution options:',
        '   a) Fetch latest state and reapply changes:',
        '      - sheets_core action="get" to get current state',
        '      - Apply your changes to the latest version',
        '   b) Use transactions for atomic updates:',
        '      - sheets_transaction to batch operations',
        '      - Transactions prevent partial updates',
        '3. Prevention strategies:',
        '   - Use version history: sheets_collaborate action="version_create_snapshot"',
        '   - Check before update: sheets_quality action="detect_conflicts"',
        '   - Lock ranges during edit: sheets_advanced action="add_protected_range"',
        '4. Conflict resolution:',
        '   - Compare current vs your version',
        '   - Manually merge changes if needed',
        '   - Use sheets_collaborate for multi-user coordination',
        '5. Retry with updated data',
      ];
    } else if (this.conflictType === 'stale_data') {
      resolutionSteps = [
        '1. Your cached data is stale - spreadsheet has been updated',
        `2. Version info: Last known ${this.lastKnownVersion}, Current ${this.currentVersion}`,
        '3. Resolution:',
        '   - Fetch fresh data: sheets_core action="get"',
        '   - Re-read range: sheets_data action="read"',
        '   - Invalidate cache: Clear any cached spreadsheet data',
        '4. Prevention strategies:',
        '   - Use change notifications: sheets_webhook',
        '   - Poll less frequently (e.g., every 30s not 1s)',
        '   - Use event-driven architecture instead of polling',
        '   - Set shorter cache TTL',
        '5. Implement smart caching:',
        '   - Watch for version changes',
        '   - Cache with expiration timestamps',
        '   - Validate cache before use',
        '6. Retry with fresh data',
      ];
    } else if (this.conflictType === 'version_mismatch') {
      resolutionSteps = [
        `1. Version mismatch: Expected ${this.lastKnownVersion}, got ${this.currentVersion}`,
        '2. This typically means:',
        '   - Multiple operations on different versions',
        '   - Undo/redo operations changed version',
        '   - Spreadsheet was reverted or restored',
        '3. Resolution:',
        '   - Get current version: sheets_core action="get"',
        '   - Check version history: sheets_collaborate action="version_list"',
        '   - Verify your changes are still needed',
        '   - Reapply changes if needed',
        '4. Use collaborative features:',
        '   - sheets_collaborate for team coordination',
        '   - version_create_snapshot before major changes',
        '   - Comments to notify other users',
        '5. Transaction best practices:',
        '   - Use sheets_transaction for multi-step updates',
        '   - Validate data before transaction',
        '   - Handle rollback gracefully',
        '6. Retry with current version info',
      ];
    } else if (this.conflictType === 'merge_conflict') {
      resolutionSteps = [
        '1. Merge conflict detected - changes cannot be automatically combined',
        '2. Conflicting changes:',
        '   - Your changes',
        '   - Changes from concurrent edit',
        '3. Manual resolution required:',
        '   a) View current state: sheets_core action="get"',
        '   b) View your changes (from app/client state)',
        '   c) Decide which version to keep or merge',
        '   d) Apply final state: sheets_data action="write"',
        '4. Prevention strategies:',
        '   - Use sheets_transaction for atomic updates',
        '   - Implement last-write-wins strategy',
        '   - Use spreadsheet protections for critical ranges',
        '   - Coordinate changes with team',
        '5. Conflict resolution patterns:',
        '   - Last-write-wins: Use current version (latest timestamp)',
        '   - First-write-wins: Keep original version',
        '   - Three-way merge: Compare base, yours, theirs',
        '   - Custom merge: Use app logic to combine changes',
        '6. Coordinate with team and retry',
      ];
    }

    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: true,
      retryStrategy: 'exponential_backoff',
      resolution: `Resolve ${this.conflictType} by fetching latest state and retrying. Use transactions for atomic updates.`,
      resolutionSteps,
      suggestedTools: [
        'sheets_core',
        'sheets_data',
        'sheets_transaction',
        'sheets_collaborate',
        'sheets_quality',
      ],
    };
  }
}
