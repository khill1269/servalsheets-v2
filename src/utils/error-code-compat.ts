import { ErrorCodeSchema } from '../schemas/shared.js';

export type KnownErrorCode = (typeof ErrorCodeSchema.options)[number];

export type ErrorCodeFamily =
  | 'protocol'
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'quota'
  | 'not_found'
  | 'conflict'
  | 'precondition'
  | 'transport'
  | 'service'
  | 'feature'
  | 'session'
  | 'data'
  | 'unknown';

interface ErrorCodeCompatibility {
  reportedCode: string;
  canonicalCode: KnownErrorCode;
  family: ErrorCodeFamily;
  isKnown: boolean;
  isAlias: boolean;
}

const LEGACY_TO_CANONICAL_ERROR_CODE: Partial<Record<KnownErrorCode, KnownErrorCode>> = {
  INVALID_PARAMS: 'INVALID_REQUEST',
  VALIDATION_ERROR: 'INVALID_REQUEST',
  AUTH_ERROR: 'AUTHENTICATION_REQUIRED',
  UNAUTHENTICATED: 'AUTHENTICATION_REQUIRED',
  NOT_AUTHENTICATED: 'AUTHENTICATION_REQUIRED',
  TOKEN_EXPIRED: 'AUTHENTICATION_REQUIRED',
  INVALID_CREDENTIALS: 'AUTHENTICATION_REQUIRED',
  NOT_CONFIGURED: 'CONFIG_ERROR',
  INSUFFICIENT_PERMISSIONS: 'PERMISSION_DENIED',
  FORBIDDEN: 'PERMISSION_DENIED',
  QUOTA_EXCEEDED: 'RESOURCE_EXHAUSTED',
  RATE_LIMITED: 'RESOURCE_EXHAUSTED',
  OPERATION_CANCELLED: 'CANCELLED',
  NOT_IMPLEMENTED: 'UNIMPLEMENTED',
  FAILED_PRECONDITION: 'PRECONDITION_FAILED',
  UNKNOWN: 'UNKNOWN_ERROR',
};

const CANONICAL_TO_LEGACY_ERROR_CODES = new Map<KnownErrorCode, KnownErrorCode[]>();
for (const [legacy, canonical] of Object.entries(LEGACY_TO_CANONICAL_ERROR_CODE)) {
  if (!canonical) continue;
  const existing = CANONICAL_TO_LEGACY_ERROR_CODES.get(canonical as KnownErrorCode) ?? [];
  existing.push(legacy as KnownErrorCode);
  CANONICAL_TO_LEGACY_ERROR_CODES.set(canonical as KnownErrorCode, existing);
}

const KNOWN_ERROR_CODES = new Set<string>(ErrorCodeSchema.options);

export function isKnownErrorCode(code: unknown): code is KnownErrorCode {
  return typeof code === 'string' && KNOWN_ERROR_CODES.has(code);
}

export function getCanonicalErrorCode(code: unknown): KnownErrorCode | undefined {
  if (!isKnownErrorCode(code)) {
    return undefined;
  }

  return LEGACY_TO_CANONICAL_ERROR_CODE[code] ?? code;
}

export function getLegacyErrorCodesForCanonical(canonicalCode: KnownErrorCode): KnownErrorCode[] {
  return [...(CANONICAL_TO_LEGACY_ERROR_CODES.get(canonicalCode) ?? [])];
}

export function getErrorCodeFamily(code: KnownErrorCode): ErrorCodeFamily {
  switch (code) {
    case 'PARSE_ERROR':
    case 'METHOD_NOT_FOUND':
    case 'INTERNAL_ERROR':
    case 'UNIMPLEMENTED':
      return 'protocol';

    case 'INVALID_REQUEST':
    case 'INVALID_PARAMS':
    case 'VALIDATION_ERROR':
      return 'validation';

    case 'AUTHENTICATION_REQUIRED':
    case 'AUTH_ERROR':
    case 'UNAUTHENTICATED':
    case 'NOT_AUTHENTICATED':
    case 'TOKEN_EXPIRED':
    case 'INVALID_CREDENTIALS':
    case 'INCREMENTAL_SCOPE_REQUIRED':
      return 'authentication';

    case 'CONFIG_ERROR':
    case 'NOT_CONFIGURED':
      return 'service';

    case 'PERMISSION_DENIED':
    case 'INSUFFICIENT_PERMISSIONS':
    case 'FORBIDDEN':
      return 'authorization';

    case 'RESOURCE_EXHAUSTED':
    case 'QUOTA_EXCEEDED':
    case 'RATE_LIMITED':
      return 'quota';

    case 'SPREADSHEET_NOT_FOUND':
    case 'SHEET_NOT_FOUND':
    case 'RANGE_NOT_FOUND':
    case 'NOT_FOUND':
    case 'CHECKPOINT_NOT_FOUND':
    case 'SESSION_NOT_FOUND':
      return 'not_found';

    case 'MERGE_CONFLICT':
    case 'TRANSACTION_CONFLICT':
    case 'ABORTED':
      return 'conflict';

    case 'PRECONDITION_FAILED':
    case 'FAILED_PRECONDITION':
    case 'OUT_OF_RANGE':
      return 'precondition';

    case 'UNAVAILABLE':
    case 'CONNECTION_ERROR':
    case 'DEADLINE_EXCEEDED':
    case 'PAYLOAD_TOO_LARGE':
      return 'transport';

    case 'SERVICE_NOT_INITIALIZED':
    case 'SERVICE_NOT_ENABLED':
    case 'HANDLER_LOAD_ERROR':
    case 'SNAPSHOT_CREATION_FAILED':
    case 'SNAPSHOT_RESTORE_FAILED':
      return 'service';

    case 'FEATURE_UNAVAILABLE':
    case 'FEATURE_DEGRADED':
    case 'ELICITATION_UNAVAILABLE':
    case 'SAMPLING_UNAVAILABLE':
      return 'feature';

    case 'TOO_MANY_SESSIONS':
    case 'TRANSACTION_EXPIRED':
    case 'CANCELLED':
    case 'OPERATION_CANCELLED':
      return 'session';

    case 'DATA_ERROR':
    case 'NO_DATA':
    case 'VERSION_MISMATCH':
    case 'DATA_LOSS':
      return 'data';

    default:
      return 'unknown';
  }
}

export function getErrorCodeCompatibility(code: unknown): ErrorCodeCompatibility | undefined {
  if (typeof code !== 'string' || code.length === 0) {
    return undefined;
  }

  const canonicalCode = getCanonicalErrorCode(code) ?? 'UNKNOWN_ERROR';
  const isKnown = isKnownErrorCode(code);

  return {
    reportedCode: code,
    canonicalCode,
    family: getErrorCodeFamily(canonicalCode),
    isKnown,
    isAlias: isKnown && canonicalCode !== code,
  };
}
