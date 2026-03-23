/**
 * Serval Core - Error Types
 *
 * Platform-agnostic error detail types.
 * These mirror the Zod schemas but are defined as plain TypeScript
 * to avoid coupling serval-core to any specific schema library.
 */

/**
 * Core error codes shared across all Serval platforms.
 * Platform-specific codes (e.g., SHEET_NOT_FOUND) are added by each backend.
 */
export type CoreErrorCode =
  // Standard errors
  | 'PARSE_ERROR'
  | 'INVALID_REQUEST'
  | 'METHOD_NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'INTERNAL_ERROR'
  // Authentication & Authorization
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'INVALID_CREDENTIALS'
  | 'INSUFFICIENT_PERMISSIONS'
  | 'AUTH_ERROR'
  | 'AUTHENTICATION_REQUIRED'
  // Quota & Rate Limiting
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'RESOURCE_EXHAUSTED'
  // Data & Validation
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'DATA_ERROR'
  | 'CONFIG_ERROR'
  | 'VERSION_MISMATCH'
  | 'NO_DATA'
  // Operations
  | 'BATCH_UPDATE_ERROR'
  | 'TRANSACTION_ERROR'
  | 'TRANSACTION_CONFLICT'
  | 'TRANSACTION_EXPIRED'
  | 'ABORTED'
  | 'DEADLINE_EXCEEDED'
  | 'CANCELLED'
  | 'OPERATION_CANCELLED'
  | 'DATA_LOSS'
  // Network & Service
  | 'UNAVAILABLE'
  | 'CONNECTION_ERROR'
  | 'UNIMPLEMENTED'
  | 'UNKNOWN'
  | 'OUT_OF_RANGE'
  | 'FAILED_PRECONDITION'
  // Safety
  | 'PRECONDITION_FAILED'
  | 'EFFECT_SCOPE_EXCEEDED'
  | 'EXPLICIT_RANGE_REQUIRED'
  // Features
  | 'FEATURE_UNAVAILABLE'
  | 'FEATURE_DEGRADED'
  // Service lifecycle
  | 'SERVICE_NOT_INITIALIZED'
  | 'SERVICE_NOT_ENABLED'
  | 'SNAPSHOT_CREATION_FAILED'
  | 'SNAPSHOT_RESTORE_FAILED'
  // Handler lifecycle
  | 'NOT_IMPLEMENTED'
  | 'HANDLER_LOAD_ERROR';

/**
 * Extensible error code type — platforms can add their own codes
 * by using `CoreErrorCode | 'MY_CUSTOM_CODE'`
 */
export type ErrorCode = CoreErrorCode | (string & {});

/**
 * Structured error detail for consistent error reporting
 */
export interface ErrorDetail {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
  retryAfterMs?: number;
  suggestedFix?: string;
  alternatives?: Array<{
    tool: string;
    action: string;
    description: string;
  }>;
  resolution?: string;
  resolutionSteps?: string[];
  category?: 'client' | 'server' | 'network' | 'auth' | 'quota' | 'transient' | 'unknown';
  severity?: 'low' | 'medium' | 'high' | 'critical';
  retryStrategy?: 'exponential_backoff' | 'wait_for_reset' | 'manual' | 'reauthorize' | 'none';
  suggestedTools?: string[];
}
