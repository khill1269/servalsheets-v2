/**
 * Serval Core - Error exports
 */
export type { CoreErrorCode, ErrorCode, ErrorDetail } from './types.js';

export {
  ServalError,
  ServiceError,
  ConfigError,
  ValidationError,
  NotFoundError,
  AuthenticationError,
  DataError,
  HandlerLoadError,
  QuotaExceededError,
  ApiTimeoutError,
  SyncError,
  BatchCompilationError,
} from './errors.js';
