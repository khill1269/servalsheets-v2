/**
 * Standalone Handler Error Mapping Helper
 *
 * Provides a single function to map any thrown value to a structured ErrorDetail
 * with a valid ErrorCode enum value. Used in catch blocks of the 9 standalone
 * handlers that manage their own error handling outside BaseHandler.
 *
 * Design constraints:
 * - No new dependencies beyond existing error classes
 * - Every returned code must be a member of ErrorCodeSchema
 * - Preserves specific codes from typed errors (ValidationError, NotFoundError, etc.)
 */

import { ErrorCodes } from '../error-codes.js';
import type { ErrorDetail } from '../../schemas/shared.js';
import {
  ValidationError,
  NotFoundError,
  AuthenticationError,
  ServiceError,
  ConfigError,
} from '../../core/errors.js';
import { ServalError, CircuitBreakerError } from '@serval/core';
import { z } from 'zod';
import { createZodValidationError, parseGoogleApiError } from '../../utils/error-factory.js';
import { isKnownErrorCode } from '../../utils/error-code-compat.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorDetails(error: unknown): Record<string, unknown> | undefined {
  if (!isRecord(error) || !('details' in error) || !isRecord(error['details'])) {
    return undefined;
  }

  return error['details'] as Record<string, unknown>;
}

function getErrorRetryAfterMs(error: unknown): number | undefined {
  if (!isRecord(error) || typeof error['retryAfterMs'] !== 'number') {
    return undefined;
  }

  return error['retryAfterMs'];
}

function getErrorRetryable(error: unknown, fallback: boolean = false): boolean {
  return isRecord(error) && typeof error['retryable'] === 'boolean' ? error['retryable'] : fallback;
}

function getExplicitKnownErrorCode(error: unknown): ErrorDetail['code'] | undefined {
  if (!isRecord(error) || typeof error['code'] !== 'string') {
    return undefined;
  }

  return isKnownErrorCode(error['code']) ? (error['code'] as ErrorDetail['code']) : undefined;
}

function extractGoogleApiError(error: unknown): {
  code?: number;
  message?: string;
  status?: string;
  errors?: Array<{ domain?: string; reason?: string; message?: string }>;
} | null {
  if (!isRecord(error)) {
    return null;
  }

  const response = isRecord(error['response']) ? error['response'] : undefined;
  const responseData = isRecord(response?.['data']) ? response['data'] : undefined;
  const nestedError = isRecord(responseData?.['error']) ? responseData['error'] : undefined;

  const code =
    typeof error['code'] === 'number'
      ? error['code']
      : typeof error['status'] === 'number'
        ? error['status']
        : typeof response?.['status'] === 'number'
          ? response['status']
          : typeof nestedError?.['code'] === 'number'
            ? nestedError['code']
            : undefined;

  const status =
    typeof error['status'] === 'string'
      ? error['status']
      : typeof nestedError?.['status'] === 'string'
        ? nestedError['status']
        : undefined;

  const message =
    typeof nestedError?.['message'] === 'string'
      ? nestedError['message']
      : typeof error['message'] === 'string'
        ? error['message']
        : undefined;

  const rawErrors = Array.isArray(nestedError?.['errors'])
    ? nestedError['errors']
    : Array.isArray(error['errors'])
      ? error['errors']
      : undefined;

  const errors = rawErrors?.filter(isRecord).map((item) => ({
    domain: typeof item['domain'] === 'string' ? item['domain'] : undefined,
    reason: typeof item['reason'] === 'string' ? item['reason'] : undefined,
    message: typeof item['message'] === 'string' ? item['message'] : undefined,
  }));

  if (code === undefined && message === undefined && !errors?.length) {
    return null;
  }

  return { code, message, status, errors };
}

function isConfigMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    (normalized.includes('missing') || normalized.includes('not configured')) &&
    (normalized.includes('api key') ||
      normalized.includes('environment variable') ||
      normalized.includes('credentials') ||
      normalized.includes('oauth'))
  );
}

function normalizeZodIssues(issues: z.ZodError['issues']): Array<{
  code: string;
  path: Array<string | number>;
  message: string;
  expected?: string;
  received?: string;
  options?: unknown[];
}> {
  return issues.map((issue) => ({
    code: issue.code,
    path: issue.path.filter(
      (segment): segment is string | number =>
        typeof segment === 'string' || typeof segment === 'number'
    ),
    message: issue.message,
    ...('expected' in issue && typeof issue.expected === 'string'
      ? { expected: issue.expected }
      : {}),
    ...('received' in issue && typeof issue.received === 'string'
      ? { received: issue.received }
      : {}),
    ...('options' in issue && Array.isArray(issue.options) ? { options: issue.options } : {}),
  }));
}

/**
 * Maps an unknown caught value to a structured ErrorDetail with a valid ErrorCode.
 *
 * Priority:
 * 1. Typed ServalSheets errors → use their specific code
 * 2. CircuitBreakerError → UNAVAILABLE with retryAfterMs (ISSUE-149)
 * 3. Queue-full errors → RESOURCE_EXHAUSTED with retryAfterMs (ISSUE-149)
 * 4. Generic Error → INTERNAL_ERROR, retryable=true
 * 5. Non-Error throw → INTERNAL_ERROR, String()-ified message
 */
export function mapStandaloneError(error: unknown): {
  code: ErrorDetail['code'];
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
  retryAfterMs?: number;
} & Partial<ErrorDetail> {
  // CircuitBreakerError → UNAVAILABLE with retryAfterMs (ISSUE-149)
  if (error instanceof CircuitBreakerError) {
    return {
      code: ErrorCodes.UNAVAILABLE,
      message: error.message,
      retryable: true,
      retryAfterMs: Math.max(0, error.nextAttemptTime - Date.now()),
    };
  }

  // Queue-full errors from ConcurrencyCoordinator → RESOURCE_EXHAUSTED with retryAfterMs (ISSUE-149)
  if (
    error instanceof Error &&
    error.message.includes('Concurrency queue full') &&
    typeof (error as Error & { retryAfterMs?: number }).retryAfterMs === 'number'
  ) {
    return {
      code: ErrorCodes.RESOURCE_EXHAUSTED,
      message: error.message,
      retryable: true,
      retryAfterMs: (error as Error & { retryAfterMs: number }).retryAfterMs,
    };
  }

  if (error instanceof z.ZodError) {
    const detail = createZodValidationError(normalizeZodIssues(error.issues));
    return {
      ...detail,
      code: ErrorCodes.INVALID_PARAMS,
      retryable: false,
    };
  }

  // ValidationError → VALIDATION_ERROR
  if (error instanceof ValidationError) {
    return {
      code: ErrorCodes.VALIDATION_ERROR,
      message: error.message,
      details: getErrorDetails(error),
      retryable: false,
    };
  }

  // NotFoundError → NOT_FOUND
  if (error instanceof NotFoundError) {
    return {
      code: ErrorCodes.NOT_FOUND,
      message: error.message,
      details: getErrorDetails(error),
      retryable: false,
    };
  }

  // AuthenticationError → use its own code (AUTH_ERROR or more specific)
  if (error instanceof AuthenticationError) {
    return {
      code: error.code,
      message: error.message,
      details: getErrorDetails(error),
      retryable: error.retryable ?? false,
    };
  }

  // ServiceError → use its own code (SERVICE_NOT_INITIALIZED, UNAVAILABLE, etc.)
  if (error instanceof ServiceError) {
    return {
      code: error.code,
      message: error.message,
      details: getErrorDetails(error),
      retryable: error.retryable ?? false,
      ...(getErrorRetryAfterMs(error) !== undefined
        ? { retryAfterMs: getErrorRetryAfterMs(error) }
        : {}),
    };
  }

  // ConfigError → CONFIG_ERROR
  if (error instanceof ConfigError) {
    return {
      code: ErrorCodes.CONFIG_ERROR,
      message: error.message,
      details: getErrorDetails(error),
      retryable: false,
    };
  }

  const googleApiError = extractGoogleApiError(error);
  if (googleApiError?.code !== undefined || googleApiError?.errors?.length) {
    const parsed = parseGoogleApiError(googleApiError);
    if (parsed.code) {
      return {
        ...parsed,
        code: parsed.code,
        message:
          parsed.message ??
          (error instanceof Error ? error.message : (googleApiError.message ?? 'Google API error')),
        retryable: parsed.retryable ?? false,
      };
    }
  }

  const explicitCode = getExplicitKnownErrorCode(error);
  if (explicitCode && error instanceof Error) {
    return {
      code: explicitCode,
      message: error.message,
      details: getErrorDetails(error),
      retryable: getErrorRetryable(error),
      ...(getErrorRetryAfterMs(error) !== undefined
        ? { retryAfterMs: getErrorRetryAfterMs(error) }
        : {}),
    };
  }

  // Any other ServalError base → preserve explicit code when available
  if (error instanceof ServalError) {
    return {
      code: explicitCode ?? ErrorCodes.INTERNAL_ERROR,
      message: error.message,
      details: getErrorDetails(error),
      retryable: getErrorRetryable(error, true),
      ...(getErrorRetryAfterMs(error) !== undefined
        ? { retryAfterMs: getErrorRetryAfterMs(error) }
        : {}),
    };
  }

  // Generic Error → INTERNAL_ERROR (not retryable — unknown if safe to retry)
  if (error instanceof Error) {
    if (isConfigMessage(error.message)) {
      return {
        code: ErrorCodes.CONFIG_ERROR,
        message: error.message,
        retryable: false,
      };
    }

    return {
      code: ErrorCodes.INTERNAL_ERROR,
      message: error.message,
      retryable: false,
    };
  }

  // Non-Error throw (string, number, null, undefined, etc.)
  return {
    code: ErrorCodes.INTERNAL_ERROR,
    message: error != null ? String(error) : 'An unknown error occurred',
    retryable: false,
  };
}
