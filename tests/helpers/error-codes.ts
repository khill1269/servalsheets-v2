/**
 * ServalSheets - Test Error Code Constants
 *
 * Centralized error codes for type-safe test assertions.
 * These match the error codes used in src/core/errors.ts
 */

/**
 * Standard error codes used across ServalSheets handlers
 *
 * Usage in tests:
 * ```typescript
 * import { ErrorCode } from '../helpers/error-codes.js';
 *
 * expect(result.response.error?.code).toBe(ErrorCode.INVALID_PARAMS);
 * ```
 */
export enum ErrorCode {
  // Validation errors
  INVALID_PARAMS = 'INVALID_PARAMS',
  PARSE_ERROR = 'PARSE_ERROR',

  // Resource errors
  SHEET_NOT_FOUND = 'SHEET_NOT_FOUND',
  RANGE_NOT_FOUND = 'RANGE_NOT_FOUND',
  NO_DATA = 'NO_DATA',

  // Authentication/Authorization errors
  CONFIG_ERROR = 'CONFIG_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',

  // Feature availability errors
  FEATURE_UNAVAILABLE = 'FEATURE_UNAVAILABLE',
  SAMPLING_UNAVAILABLE = 'SAMPLING_UNAVAILABLE',

  // Internal errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  API_ERROR = 'API_ERROR',
}

/**
 * Helper to assert error response structure
 *
 * Usage:
 * ```typescript
 * expectErrorResponse(result, ErrorCode.INVALID_PARAMS);
 * ```
 */
export function expectErrorResponse(
  result: any,
  expectedCode: ErrorCode,
  messageContains?: string
): void {
  expect(result.response.success).toBe(false);

  if (result.response.success) {
    throw new Error('Expected error response but got success');
  }

  expect(result.response.error).toBeDefined();
  expect(result.response.error.code).toBe(expectedCode);

  if (messageContains) {
    expect(result.response.error.message).toContain(messageContains);
  }
}

/**
 * Helper to assert success response structure
 *
 * Usage:
 * ```typescript
 * expectSuccessResponse(result);
 * ```
 */
export function expectSuccessResponse(result: any): void {
  expect(result.response.success).toBe(true);

  if (!result.response.success) {
    throw new Error(
      `Expected success but got error: ${result.response.error?.code} - ${result.response.error?.message}`
    );
  }
}
