/**
 * Agent-Actionable Error Factory
 *
 * Creates structured, actionable errors that Claude can understand and act upon.
 * Provides clear resolution steps and tool suggestions for common error scenarios.
 */

import { type ErrorDetail } from '../schemas/shared.js';
import { redactObject } from './redact.js';
import { getErrorPatternLearner } from '../services/error-pattern-learner.js';

/**
 * Enriched error with additional debugging context
 */
export interface EnrichedError extends ErrorDetail {
  correlationId?: string;
  requestPath?: string;
  userAction?: string;
  stackTrace?: string;
  errorHistory?: Array<{ timestamp: number; error: ErrorDetail }>;
  suggestedPattern?: ErrorPattern;
  enrichedAt: number;
}

/**
 * Detected error pattern
 */
export interface ErrorPattern {
  pattern: 'rate_limit' | 'auth_expiry' | 'network' | 'quota' | 'permission';
  frequency: number;
  suggestedAction: string;
  affectedOperations: string[];
  firstSeen: number;
  lastSeen: number;
}

/**
 * Create a permission denied error with actionable resolution
 */
export function createPermissionError(params: {
  operation: string;
  resourceType?: 'spreadsheet' | 'sheet' | 'range' | 'file';
  resourceId?: string;
  currentPermission?: 'view' | 'comment' | 'none';
  requiredPermission?: 'edit' | 'full';
}): ErrorDetail {
  const {
    operation,
    resourceType = 'spreadsheet',
    resourceId,
    currentPermission = 'view',
    requiredPermission = 'edit',
  } = params;

  const resolutionSteps = [
    `1. Check current permission level: Use 'sheets_collaborate' tool with action 'share_list' to verify access`,
    `2. Request ${requiredPermission} access from the ${resourceType} owner`,
    `3. Alternative: Use read-only operations (sheets_data with action 'read')`,
    `4. If you're the owner: Use 'sheets_collaborate' tool with action 'share_add' to give yourself ${requiredPermission} access`,
  ];

  return {
    code: 'PERMISSION_DENIED',
    message: `[PERMISSION_DENIED] Cannot ${operation}: Current access is ${currentPermission}, but ${requiredPermission} is required\nSuggestion: Request ${requiredPermission} access from the ${resourceType} owner or use read-only operations`,
    category: 'auth',
    severity: 'high',
    retryable: false,
    retryStrategy: 'manual',
    resolution: `Request ${requiredPermission} access from the ${resourceType} owner or use read-only operations`,
    resolutionSteps,
    suggestedTools: ['sheets_collaborate', 'sheets_data', 'sheets_core'],
    details: {
      operation,
      resourceType,
      resourceId,
      currentPermission,
      requiredPermission,
    },
  };
}

/**
 * Create a rate limit error with retry guidance
 */
export function createRateLimitError(params: {
  quotaType?: 'read' | 'write' | 'requests';
  retryAfterMs?: number;
  endpoint?: string;
  circuitBreakerState?: 'closed' | 'open' | 'half_open';
}): ErrorDetail {
  const { quotaType = 'requests', retryAfterMs = 60000, endpoint, circuitBreakerState } = params;

  const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

  const resolutionSteps = [
    `1. Wait ${retryAfterSeconds} seconds before retrying`,
    `2. Use batch operations to reduce API call count (sheets_data with action 'batch_read' or 'batch_write')`,
    `3. Enable caching to avoid redundant requests`,
    `4. Consider using exponential backoff for retries`,
    `5. Check quota usage in Google Cloud Console`,
  ];

  return {
    code: 'RATE_LIMITED',
    message: `[RATE_LIMITED] ${quotaType} quota exceeded: Google API rate limit reached\nSuggestion: Wait ${retryAfterSeconds} seconds before retrying, or use batch operations to reduce API call count`,
    category: 'quota',
    severity: 'medium',
    retryable: true,
    retryAfterMs,
    retryStrategy: 'wait_for_reset',
    resolution: `Wait ${retryAfterSeconds} seconds, then retry. Use batch operations to reduce API calls.`,
    resolutionSteps,
    suggestedTools: ['sheets_data'],
    // Fix: Provide context check action so LLM can review session state before retry
    fixableVia: { tool: 'sheets_session', action: 'get_context', params: {} },
    details: {
      quotaType,
      retryAfterMs,
      endpoint,
      resetTime: new Date(Date.now() + retryAfterMs).toISOString(),
      ...(circuitBreakerState && { circuitBreakerState }),
    },
  };
}

/**
 * Create a not found error with search suggestions
 */
export function createNotFoundError(params: {
  resourceType:
    | 'spreadsheet'
    | 'sheet'
    | 'range'
    | 'file'
    | 'permission'
    | 'operation'
    | 'snapshot';
  resourceId: string;
  searchSuggestion?: string;
  parentResourceId?: string;
}): ErrorDetail {
  const { resourceType, resourceId, searchSuggestion, parentResourceId } = params;

  const resolutionSteps: string[] = [`1. Verify the ${resourceType} ID is correct: ${resourceId}`];

  if (resourceType === 'sheet') {
    resolutionSteps.push(
      `2. List all sheets in the spreadsheet: Use 'sheets_core' tool with action 'list_sheets'`,
      `3. Check if the sheet name has changed`,
      `4. Verify the sheet hasn't been deleted`
    );
  } else if (resourceType === 'spreadsheet') {
    resolutionSteps.push(
      `2. Verify you have access to the spreadsheet`,
      `3. Check if the spreadsheet was deleted or moved to trash`,
      `4. Confirm the URL is correct: https://docs.google.com/spreadsheets/d/${resourceId}`
    );
  } else if (resourceType === 'range') {
    resolutionSteps.push(
      `2. Verify the A1 notation is valid (e.g., "Sheet1!A1:B10")`,
      `3. Check if the sheet name exists`,
      `4. Ensure the range coordinates are within sheet bounds`
    );
  } else if (resourceType === 'operation') {
    resolutionSteps.push(
      `2. List available operations using sheets_history tool with action 'list'`,
      `3. Check the operation ID is correct`,
      `4. Operations may have been cleared or expired from history`
    );
  } else if (resourceType === 'snapshot') {
    resolutionSteps.push(
      `2. Verify the operation was created with snapshot enabled`,
      `3. Check snapshot storage configuration`,
      `4. Some operations may not support snapshots`
    );
  }

  if (searchSuggestion) {
    resolutionSteps.push(`5. Suggestion: ${searchSuggestion}`);
  }

  const suggestedTools: string[] = [];
  if (resourceType === 'sheet' || resourceType === 'range') {
    suggestedTools.push('sheets_core');
  } else if (resourceType === 'spreadsheet') {
    // Note: There is no file search tool - users need to know their spreadsheet IDs
    suggestedTools.push('sheets_core');
  } else if (resourceType === 'operation' || resourceType === 'snapshot') {
    suggestedTools.push('sheets_history');
  }

  // Map resource type to error code
  // External resources (Google API) get specific codes, internal resources get generic NOT_FOUND
  const errorCodeMap: Record<typeof resourceType, string> = {
    spreadsheet: 'SPREADSHEET_NOT_FOUND',
    sheet: 'SHEET_NOT_FOUND',
    range: 'RANGE_NOT_FOUND',
    file: 'FILE_NOT_FOUND',
    permission: 'PERMISSION_NOT_FOUND',
    operation: 'NOT_FOUND', // Internal resource
    snapshot: 'NOT_FOUND', // Internal resource
  };

  const resourceName = resourceType.charAt(0).toUpperCase() + resourceType.slice(1);
  return {
    code: errorCodeMap[resourceType] as ErrorDetail['code'],
    message: `[${errorCodeMap[resourceType]}] ${resourceName} "${resourceId}" not found: Resource does not exist or is inaccessible\nSuggestion: ${searchSuggestion || `Verify the ${resourceType} ID is correct and you have access to it`}`,
    category: 'client',
    severity: 'medium',
    retryable: false,
    retryStrategy: 'none',
    resolution: `Verify the ${resourceType} ID is correct and you have access to it`,
    resolutionSteps,
    suggestedTools,
    // Fix: Provide ready-to-execute recovery action for LLM autonomous error handling
    fixableVia:
      resourceType === 'sheet' && parentResourceId
        ? {
            tool: 'sheets_core',
            action: 'list_sheets',
            params: { spreadsheetId: parentResourceId },
          }
        : resourceType === 'range' && parentResourceId
          ? {
              tool: 'sheets_core',
              action: 'get_sheet',
              params: { spreadsheetId: parentResourceId },
            }
          : undefined,
    details: {
      resourceType,
      resourceId,
      searchSuggestion,
      parentResourceId,
    },
  };
}

/**
 * Create an authentication error with setup guidance
 */
export function createAuthenticationError(params: {
  reason: 'missing_token' | 'invalid_token' | 'expired_token' | 'insufficient_scopes';
  missingScopes?: string[];
}): ErrorDetail {
  const { reason, missingScopes } = params;

  let message = 'Authentication failed';
  let resolution = 'Authenticate using the OAuth flow';
  const resolutionSteps: string[] = [];

  switch (reason) {
    case 'missing_token':
      message =
        '[PERMISSION_DENIED] Authentication required: No access token provided\nSuggestion: Run authentication flow with "npm run auth" and grant required permissions';
      resolution = 'Run authentication flow to obtain access token';
      resolutionSteps.push(
        '1. Run authentication: npm run auth',
        '2. Follow the OAuth flow in your browser',
        '3. Grant required permissions when prompted',
        '4. Retry the operation after authentication completes'
      );
      break;

    case 'invalid_token':
      message =
        '[PERMISSION_DENIED] Invalid access token: Token is malformed or revoked\nSuggestion: Clear token storage and re-authenticate with "npm run auth"';
      resolution = 'Re-authenticate to obtain a new valid token';
      resolutionSteps.push(
        '1. Clear existing token storage',
        '2. Run authentication: npm run auth',
        '3. Complete the OAuth flow',
        '4. Retry the operation'
      );
      break;

    case 'expired_token':
      message =
        '[PERMISSION_DENIED] Access token expired: Token needs refresh\nSuggestion: Token should auto-refresh, but if it fails, re-authenticate with "npm run auth"';
      resolution = 'Refresh the access token or re-authenticate';
      resolutionSteps.push(
        '1. Token refresh should happen automatically',
        '2. If refresh fails, re-authenticate: npm run auth',
        '3. Retry the operation'
      );
      break;

    case 'insufficient_scopes':
      message = `[PERMISSION_DENIED] Insufficient permissions: Missing required OAuth scopes (${missingScopes?.join(', ')})\nSuggestion: Re-authenticate with "npm run auth" and grant all requested permissions including Google Sheets scope`;
      resolution = 'Re-authenticate with additional required scopes';
      resolutionSteps.push(
        '1. Run authentication with force consent: npm run auth',
        '2. Grant all requested permissions (especially Google Sheets scope)',
        '3. Ensure you select all checkboxes in the OAuth consent screen',
        '4. Retry the operation'
      );
      break;
  }

  return {
    code: 'PERMISSION_DENIED',
    message,
    category: 'auth',
    severity: 'critical',
    retryable: reason === 'expired_token',
    retryStrategy: reason === 'expired_token' ? 'exponential_backoff' : 'manual',
    resolution,
    resolutionSteps,
    suggestedTools: [],
    // Fix: Provide ready-to-execute auth recovery action
    fixableVia: { tool: 'sheets_auth', action: 'login', params: {} },
    details: {
      reason,
      missingScopes,
    },
  };
}

/**
 * Create a validation error with format guidance
 */
export function createValidationError(params: {
  field: string;
  value: unknown;
  expectedFormat?: string;
  allowedValues?: string[];
  reason?: string;
}): ErrorDetail {
  const { field, value, expectedFormat, allowedValues, reason } = params;

  const resolutionSteps: string[] = [`1. Check the '${field}' parameter value`];

  if (expectedFormat) {
    resolutionSteps.push(`2. Expected format: ${expectedFormat}`);
  }

  if (allowedValues && allowedValues.length > 0) {
    resolutionSteps.push(`3. Allowed values: ${allowedValues.join(', ')}`);
  }

  if (reason) {
    resolutionSteps.push(`4. Reason: ${reason}`);
  }

  resolutionSteps.push(
    `5. Review the tool schema for '${field}' parameter requirements`,
    `6. Correct the value and retry`
  );

  let message = `[INVALID_REQUEST] Invalid value for '${field}': `;
  if (reason) {
    message += reason;
  } else if (expectedFormat) {
    message += `Expected format: ${expectedFormat}`;
  } else {
    message += 'Value does not match expected format';
  }

  let suggestion = `Correct the '${field}' parameter`;
  if (expectedFormat) {
    suggestion += ` to match format: ${expectedFormat}`;
  } else if (allowedValues && allowedValues.length > 0) {
    suggestion += `. Allowed values: ${allowedValues.join(', ')}`;
  }

  message += `\nSuggestion: ${suggestion}`;

  return {
    code: 'INVALID_REQUEST',
    message,
    category: 'client',
    severity: 'medium',
    retryable: false,
    retryStrategy: 'none',
    resolution: `Correct the '${field}' parameter to match the expected format`,
    resolutionSteps,
    suggestedTools: [],
    details: {
      field,
      value,
      expectedFormat,
      allowedValues,
      reason,
    },
  };
}

/**
 * Parse Google API error and create agent-actionable error
 *
 * Security: Redacts sensitive data (tokens, API keys) from error messages
 */
export function parseGoogleApiError(error: {
  code?: number;
  message?: string;
  status?: string;
  errors?: Array<{ domain?: string; reason?: string; message?: string }>;
}): Partial<ErrorDetail> {
  // Redact sensitive data from the entire error object
  const redactedError = redactObject(error);
  const { code, message = 'Unknown error', errors } = redactedError;

  // Extract domain and reason from Google error
  const firstError = errors?.[0];
  const domain = firstError?.domain;
  const reason = firstError?.reason;

  // Map Google error codes to agent-actionable errors
  // Comprehensive coverage of 40+ Google Sheets API error scenarios
  switch (code) {
    // Authentication Errors (401)
    case 401:
      return createAuthenticationError({ reason: 'invalid_token' });

    // Authorization & Permission Errors (403)
    case 403:
      // Match all Google API quota/rate-limit reason variants
      // See: https://cloud.google.com/apis/design/errors#error_payloads
      if (
        reason === 'rateLimitExceeded' ||
        reason === 'quotaExceeded' ||
        reason === 'userRateLimitExceeded' ||
        reason === 'dailyLimitExceeded' ||
        reason === 'storageQuotaExceeded' ||
        reason === 'usageQuotaExceeded' ||
        reason?.endsWith('QuotaExceeded') ||
        reason?.endsWith('LimitExceeded')
      ) {
        return createRateLimitError({});
      }
      if (reason === 'insufficientPermissions' || domain === 'global') {
        return createPermissionError({ operation: 'access resource' });
      }
      if (reason === 'protectedRange') {
        return {
          code: 'PROTECTED_RANGE',
          message: 'Cannot modify protected range',
          category: 'auth',
          severity: 'medium',
          retryable: false,
          resolution: 'Remove protection or request edit access from range owner',
          resolutionSteps: [
            '1. Check if range is protected',
            '2. Request edit permissions from owner',
            '3. Or use a different range',
          ],
        };
      }
      return {
        code: 'PERMISSION_DENIED',
        message,
        category: 'auth',
        severity: 'high',
        retryable: false,
        retryStrategy: 'manual',
      };

    // Not Found Errors (404)
    case 404:
      if (message.toLowerCase().includes('sheet')) {
        return {
          code: 'SHEET_NOT_FOUND',
          message: 'Sheet not found in spreadsheet',
          category: 'client',
          severity: 'medium',
          retryable: false,
          resolution: 'Verify sheet name/ID and that sheet exists',
          resolutionSteps: [
            '1. List all sheets with sheets_core action="list_sheets"',
            '2. Check sheet name spelling',
            '3. Verify sheet was not deleted',
          ],
        };
      }
      return createNotFoundError({
        resourceType: 'spreadsheet',
        resourceId: 'unknown',
      });

    // Rate Limiting (429)
    case 429:
      return createRateLimitError({});

    // Validation Errors (400)
    case 400:
      if (reason === 'invalidRange' || message.toLowerCase().includes('range')) {
        return {
          code: 'INVALID_RANGE',
          message: 'Invalid A1 notation or range reference',
          category: 'client',
          severity: 'medium',
          retryable: false,
          resolution: 'Fix A1 notation format (e.g., "Sheet1!A1:B10")',
          resolutionSteps: [
            '1. Check A1 notation syntax',
            '2. Ensure sheet name is quoted if it contains spaces',
            '3. Verify row/column references are valid',
          ],
        };
      }
      if (reason === 'circularReference' || message.toLowerCase().includes('circular')) {
        return {
          code: 'CIRCULAR_REFERENCE',
          message: 'Formula creates circular reference',
          category: 'client',
          severity: 'high',
          retryable: false,
          resolution: 'Remove circular dependency in formula',
          resolutionSteps: [
            '1. Identify cells involved in circular reference',
            '2. Restructure formulas to remove dependency loop',
            '3. Use helper columns if needed',
          ],
        };
      }
      if (reason === 'formulaError' || message.toLowerCase().includes('formula')) {
        return {
          code: 'FORMULA_ERROR',
          message: 'Invalid formula syntax',
          category: 'client',
          severity: 'medium',
          retryable: false,
          resolution: 'Fix formula syntax',
          resolutionSteps: [
            '1. Check formula syntax for typos',
            '2. Verify function names are correct',
            '3. Ensure arguments match function signature',
          ],
        };
      }
      if (reason === 'duplicateSheetName' || message.toLowerCase().includes('duplicate')) {
        return {
          code: 'DUPLICATE_SHEET_NAME',
          message: 'Sheet name already exists',
          category: 'client',
          severity: 'low',
          retryable: false,
          resolution: 'Use a different sheet name',
          resolutionSteps: [
            '1. List existing sheets to check names',
            '2. Choose a unique name',
            '3. Retry with new name',
          ],
        };
      }
      return createValidationError({
        field: 'request',
        value: message,
        reason: message,
      });

    // Conflict Errors (409)
    case 409:
      return {
        code: 'MERGE_CONFLICT',
        message: 'Concurrent modification detected',
        category: 'client',
        severity: 'medium',
        retryable: true,
        retryStrategy: 'exponential_backoff',
        resolution: 'Retry operation or use transaction for atomicity',
        resolutionSteps: [
          '1. Fetch latest spreadsheet state',
          '2. Reapply changes',
          '3. Consider using sheets_transaction for atomic updates',
        ],
      };

    // Payload Too Large (413)
    case 413:
      return {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request payload exceeds size limit',
        category: 'client',
        severity: 'medium',
        retryable: false,
        resolution: 'Split request into smaller batches',
        resolutionSteps: [
          '1. Reduce batch size',
          '2. Use pagination for large datasets',
          '3. Split into multiple requests',
        ],
      };

    // Service Unavailable (503)
    case 503:
      return {
        code: 'UNAVAILABLE',
        message: 'Google Sheets API temporarily unavailable',
        category: 'server',
        severity: 'high',
        retryable: true,
        retryStrategy: 'exponential_backoff',
        resolution: 'Retry with exponential backoff',
        resolutionSteps: [
          '1. Wait 1-5 seconds',
          '2. Retry operation',
          '3. If persists, check Google API status',
        ],
      };

    // Internal Server Error (500)
    case 500:
      return {
        code: 'INTERNAL_ERROR',
        message: 'Internal Google API error',
        category: 'server',
        severity: 'high',
        retryable: true,
        retryStrategy: 'exponential_backoff',
        resolution: 'Retry operation',
      };

    // Bad Gateway (502)
    case 502:
      return {
        code: 'UNAVAILABLE',
        message: 'Bad gateway - Google API temporarily unreachable',
        category: 'network',
        severity: 'high',
        retryable: true,
        retryStrategy: 'exponential_backoff',
        resolution: 'Retry with exponential backoff',
      };

    // Gateway Timeout (504)
    case 504:
      return {
        code: 'DEADLINE_EXCEEDED',
        message: 'Request timeout - operation took too long',
        category: 'network',
        severity: 'high',
        retryable: true,
        retryStrategy: 'exponential_backoff',
        resolution: 'Retry with longer timeout or smaller request',
        resolutionSteps: [
          '1. Reduce request size if applicable',
          '2. Increase timeout setting',
          '3. Retry operation',
        ],
      };

    default:
      return {
        code: 'UNKNOWN',
        message: message || 'Unknown Google API error',
        category: 'unknown',
        severity: 'medium',
        retryable: Boolean(code && code >= 500),
        retryStrategy: code && code >= 500 ? 'exponential_backoff' : 'none',
      };
  }
}

/**
 * Enrich an error with additional debugging context
 *
 * Adds correlation IDs, stack traces, request paths, and error history
 * to aid in debugging and error pattern detection.
 */
export function enrichErrorWithContext(
  error: Error | ErrorDetail,
  context: {
    correlationId?: string;
    requestPath?: string;
    userAction?: string;
    previousErrors?: ErrorDetail[];
  }
): EnrichedError {
  const { correlationId, requestPath, userAction, previousErrors = [] } = context;

  // Convert Error to ErrorDetail if needed
  let baseError: ErrorDetail;
  if (error instanceof Error) {
    baseError = {
      code: 'INTERNAL_ERROR',
      message: error.message,
      category: 'server',
      severity: 'high',
      retryable: false,
    };
  } else {
    baseError = error;
  }

  // Record error pattern for learning (Phase 4: Optional Enhancement)
  const learner = getErrorPatternLearner();
  learner.recordError(baseError.code, baseError.message, {
    tool: baseError.details?.['tool'] as string | undefined,
    action: baseError.details?.['action'] as string | undefined,
    spreadsheetId: baseError.details?.['spreadsheetId'] as string | undefined,
  });

  // Capture stack trace (omit in production to avoid leaking internals)
  const stackTrace =
    process.env['NODE_ENV'] !== 'production'
      ? error instanceof Error
        ? error.stack
        : new Error('Stack trace capture').stack
      : undefined;

  // Build error history (last 10 errors)
  const errorHistory = previousErrors.slice(-10).map((err) => ({
    timestamp: Date.now(),
    error: err,
  }));

  // Detect error pattern if we have history
  const detectedPattern = previousErrors.length > 0 ? detectErrorPattern(previousErrors) : null;
  const suggestedPattern = detectedPattern ?? undefined;

  return {
    ...baseError,
    correlationId,
    requestPath,
    userAction,
    stackTrace,
    errorHistory,
    suggestedPattern,
    enrichedAt: Date.now(),
  };
}

/**
 * Detect error patterns from historical errors
 *
 * Analyzes a sequence of errors to identify common patterns like:
 * - Rate limiting
 * - Authentication expiry
 * - Network issues
 * - Quota exhaustion
 * - Permission problems
 */
export function detectErrorPattern(errors: ErrorDetail[]): ErrorPattern | null {
  if (errors.length === 0) {
    return null;
  }

  // Count error categories
  const categoryCounts = new Map<string, number>();
  const operationSet = new Set<string>();
  let firstSeen = Date.now();
  let lastSeen = 0;

  for (const error of errors) {
    const category = error.category || 'unknown';
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);

    // Track operations from error details
    if (error.details?.['operation']) {
      const operation = error.details['operation'];
      if (typeof operation === 'string') {
        operationSet.add(operation);
      }
    }

    // Update timestamps (errors are assumed to have timestamp in details)
    const timestamp = (error.details?.['timestamp'] as number) || Date.now();
    if (timestamp < firstSeen) firstSeen = timestamp;
    if (timestamp > lastSeen) lastSeen = timestamp;
  }

  // Detect patterns based on error frequency and category
  const quotaErrors = categoryCounts.get('quota') || 0;
  const networkErrors = categoryCounts.get('network') || 0;

  // Count specific error types by code (more specific than category)
  const permissionErrors = errors.filter(
    (e) => e.code === 'PERMISSION_DENIED' || e.code === 'FORBIDDEN'
  ).length;

  const authTokenErrors = errors.filter(
    (e) =>
      e.category === 'auth' &&
      e.code !== 'PERMISSION_DENIED' &&
      e.code !== 'FORBIDDEN' &&
      (e.message?.includes('token') || e.message?.includes('auth'))
  ).length;

  // Rate limit pattern: Multiple quota errors in short time
  if (quotaErrors >= 3) {
    return {
      pattern: 'rate_limit',
      frequency: quotaErrors,
      suggestedAction:
        'Implement exponential backoff and reduce request frequency. Consider batch operations.',
      affectedOperations: Array.from(operationSet),
      firstSeen,
      lastSeen,
    };
  }

  // Permission pattern: Check for permission-related error codes (before auth expiry)
  if (permissionErrors >= 2) {
    return {
      pattern: 'permission',
      frequency: permissionErrors,
      suggestedAction:
        'Verify user has required permissions. Use sheets_collaborate tool to check access levels.',
      affectedOperations: Array.from(operationSet),
      firstSeen,
      lastSeen,
    };
  }

  // Auth expiry pattern: Multiple auth token errors (excluding permission errors)
  if (authTokenErrors >= 2) {
    return {
      pattern: 'auth_expiry',
      frequency: authTokenErrors,
      suggestedAction:
        'Check token refresh logic. Ensure OAuth tokens are being refreshed before expiry.',
      affectedOperations: Array.from(operationSet),
      firstSeen,
      lastSeen,
    };
  }

  // Network pattern: Multiple network errors
  if (networkErrors >= 3) {
    return {
      pattern: 'network',
      frequency: networkErrors,
      suggestedAction: 'Check network connectivity. Consider implementing circuit breaker pattern.',
      affectedOperations: Array.from(operationSet),
      firstSeen,
      lastSeen,
    };
  }

  // No clear pattern detected
  return null;
}

/**
 * Format Zod validation errors with helpful information about valid values
 *
 * This function transforms cryptic Zod error messages into actionable guidance
 * that helps users understand what values are acceptable.
 *
 * @param errors - Array of Zod error issues
 * @returns Formatted error message with valid options
 */
export function formatZodErrors(
  errors: Array<{
    code: string;
    path: (string | number)[];
    message: string;
    expected?: string;
    received?: string;
    options?: unknown[];
  }>
): string {
  return errors
    .map((err) => {
      const pathStr = err.path.join('.');

      // For enum/union errors, include valid options
      if (err.code === 'invalid_enum_value' && err.options) {
        const options = err.options as string[];
        const preview = options.slice(0, 10);
        const optionsList = preview.join(', ');
        const more = options.length > 10 ? ` (${options.length - 10} more...)` : '';
        return `Invalid value at '${pathStr}'. Valid options: ${optionsList}${more}`;
      }

      // For discriminated union errors, explain the action/type mismatch
      if (err.code === 'invalid_union' || err.code === 'invalid_union_discriminator') {
        const actionPath = pathStr || 'action';
        let message = '';

        // Fix QA: Provide field-specific guidance instead of raw Zod dump
        if (actionPath.includes('rule') && actionPath.includes('type')) {
          message = `Missing or invalid "type" in rule object. The rule MUST include type: "boolean" or type: "gradient". Example: { "type": "boolean", "condition": { "type": "TEXT_CONTAINS", "values": ["error"] }, "format": { "backgroundColor": { "red": 1 } } }`;
        } else if (actionPath === 'action' || actionPath === 'request.action') {
          message = `Invalid action at '${actionPath}'.`;
          if (err.options && Array.isArray(err.options) && err.options.length > 0) {
            const actionList = (err.options as string[]).slice(0, 20).join(', ');
            const more = err.options.length > 20 ? ` (and ${err.options.length - 20} more)` : '';
            message += ` Valid actions: ${actionList}${more}`;
          } else {
            message += ` Check that '${actionPath}' matches one of the valid action values for this tool.`;
          }
        } else {
          message = `Invalid value at '${actionPath}'.`;
          if (err.options && Array.isArray(err.options) && err.options.length > 0) {
            const optionList = (err.options as string[]).slice(0, 10).join(', ');
            message += ` Valid options: ${optionList}`;
          } else {
            message += ` ${err.message}. Check that the value matches one of the expected types.`;
          }
        }

        return message;
      }

      // For type mismatch errors, be specific
      if (err.code === 'invalid_type') {
        return `Expected ${err.expected || 'correct type'} at '${pathStr}', received ${err.received || 'incorrect type'}`;
      }

      // For missing required fields
      if (err.code === 'invalid_type' && err.received === 'undefined') {
        return `Missing required field '${pathStr}'`;
      }

      // Fix QA: Provide field-specific human-readable guidance for common dimension/format errors
      if (err.code === 'too_small' || err.code === 'too_big') {
        return `Value out of range at '${pathStr}': ${err.message}`;
      }

      // Default: include path for context
      return `${err.message} (at '${pathStr}')`;
    })
    .join('; ');
}

/**
 * Create an error detail from Zod validation errors
 *
 * @param errors - Zod error issues array
 * @param toolName - Optional tool name for context
 * @returns Structured ErrorDetail with resolution steps
 */
export function createZodValidationError(
  errors: Array<{
    code: string;
    path: (string | number)[];
    message: string;
    expected?: string;
    received?: string;
    options?: unknown[];
  }>,
  toolName?: string
): ErrorDetail {
  const formattedMessage = formatZodErrors(errors);

  const resolutionSteps = [
    '1. Check the error message for the specific field that failed validation',
    '2. Verify the field value matches the expected type and format',
  ];

  // Add specific guidance for common error types
  const hasEnumError = errors.some(
    (e) =>
      e.code === 'invalid_enum_value' ||
      e.code === 'invalid_union' ||
      e.code === 'invalid_union_discriminator'
  );
  const hasTypeError = errors.some((e) => e.code === 'invalid_type');

  // Check for range-specific errors (Fix 1.2: Range format guidance)
  const hasRangeError = errors.some(
    (e) =>
      e.path.some(
        (segment) => typeof segment === 'string' && segment.toLowerCase().includes('range')
      ) || e.message.toLowerCase().includes('range')
  );

  if (hasEnumError) {
    resolutionSteps.push(
      '3. For action/enum fields, use one of the valid options listed in the error'
    );
    resolutionSteps.push(
      '4. If making parallel tool calls, ensure all actions are valid to avoid cascading failures'
    );
  }
  if (hasTypeError) {
    resolutionSteps.push(
      '3. For type errors, ensure the value is the correct data type (string, number, object, etc.)'
    );
  }
  if (hasRangeError) {
    resolutionSteps.push(
      '',
      '⚠️ RANGE FORMAT REQUIREMENTS:',
      '   ✅ CORRECT: {"range": "Sheet1!A1:D10"}  ← String value',
      '   ✅ CORRECT: {"range": "\'My Sheet\'!A1"}  ← Quoted sheet name for spaces',
      '   ❌ WRONG: {"range": {"a1": "Sheet1!A1"}}  ← Object (only works in batch operations)',
      '   ❌ WRONG: {"range": "A1:D10"}  ← Missing sheet name',
      '',
      '   Always include the sheet name: "SheetName!CellRange"',
      '   Quote sheet names with spaces: "\'Sheet Name\'!A1"'
    );
  }

  return {
    code: 'VALIDATION_ERROR',
    message: formattedMessage,
    retryable: false,
    resolution: toolName
      ? `Fix the validation error and retry the ${toolName} tool call`
      : 'Fix the validation error and retry',
    resolutionSteps,
    category: 'client',
    severity: 'medium',
  };
}

/**
 * Create an incremental scope consent error with authorization URL
 * Used when an operation requires additional OAuth scopes that haven't been granted yet
 */
export function createIncrementalScopeError(params: {
  operation: string;
  missingScopes: string[];
  currentScopes: string[];
  authorizationUrl: string;
  category: string;
}): ErrorDetail {
  const { operation, missingScopes, currentScopes, authorizationUrl, category } = params;

  // Human-readable scope descriptions
  const scopeDescriptions = missingScopes.map((scope) => {
    if (scope.includes('drive.appdata')) {
      return 'Access app data folder (for templates)';
    }
    if (scope.includes('drive.file')) {
      return 'Create and access your own files';
    }
    if (scope === 'https://www.googleapis.com/auth/drive') {
      return 'Full drive access (for sharing and permissions)';
    }
    if (scope.includes('drive.readonly')) {
      return 'Read-only drive access';
    }
    if (scope.includes('bigquery')) {
      return 'Access BigQuery for data import/export';
    }
    if (scope.includes('script.projects')) {
      return 'Manage Apps Script projects';
    }
    if (scope.includes('spreadsheets.readonly')) {
      return 'Read-only spreadsheet access';
    }
    if (scope.includes('spreadsheets')) {
      return 'Read and write spreadsheets';
    }
    return scope; // Fallback to full scope URL
  });

  const resolutionSteps = [
    `1. Click the authorization link: ${authorizationUrl}`,
    `2. Grant the following permissions:`,
    ...scopeDescriptions.map((desc) => `   - ${desc}`),
    `3. Complete the authorization flow`,
    `4. Retry the operation`,
  ];

  return {
    code: 'INCREMENTAL_SCOPE_REQUIRED',
    message: `Operation "${operation}" requires additional permissions. Missing: ${missingScopes.join(', ')}`,
    category: 'auth',
    severity: 'medium',
    retryable: true,
    retryStrategy: 'reauthorize',
    resolution: `Grant additional permissions by visiting: ${authorizationUrl}`,
    resolutionSteps,
    suggestedTools: ['sheets_auth'],
    details: {
      operation,
      category,
      missingScopes,
      currentScopes,
      authorizationUrl,
      include_granted_scopes: true, // Indicate this is incremental consent
    },
  };
}
