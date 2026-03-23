/**
 * Serval Core
 *
 * Platform-agnostic infrastructure for spreadsheet operations.
 * Provides safety patterns, error handling, history tracking,
 * observability, and shared utilities.
 */

// Safety patterns
export {
  CircuitBreaker,
  CircuitBreakerError,
  FallbackStrategies,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitState,
  type FallbackStrategy,
} from './safety/index.js';

export {
  executeWithRetry,
  isRetryableError,
  DEFAULT_RETRY_CONFIG,
  type RetryOptions,
  type RetryConfig,
} from './safety/index.js';

export {
  requiresConfirmation,
  generateSafetyWarnings,
  createSnapshotIfNeeded,
  calculateAffectedCells,
  calculateAffectedRows,
  formatSafetyWarnings,
  shouldReturnPreview,
  buildSnapshotInfo,
  type SafetyOptions,
  type SafetyContext,
  type SafetyWarning,
  type SnapshotResult,
  type SnapshotProvider,
} from './safety/index.js';

// Error system
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
  type CoreErrorCode,
  type ErrorCode,
  type ErrorDetail,
} from './errors/index.js';

// History service
export {
  HistoryService,
  getHistoryService,
  setHistoryService,
  resetHistoryService,
  type HistoryServiceOptions,
} from './history/index.js';

// Types
export type {
  OperationHistory,
  OperationHistoryStats,
  OperationHistoryFilter,
} from './types/index.js';

// Observability
export {
  updateCircuitBreakerMetric,
  recordCircuitBreakerTransition,
  recordRetryAttempt,
  recordRateLimitHit,
  recordHttp2Error,
} from './observability/index.js';

// Utilities
export {
  redactString,
  redactObject,
  redact,
  isSensitiveField,
  SENSITIVE_FIELD_NAMES,
  SENSITIVE_STRING_PATTERNS,
} from './utils/index.js';

export {
  BoundedCache,
  type BoundedCacheOptions,
} from './utils/index.js';

export {
  createLogger,
  createChildLogger,
  defaultLogger,
  type ServalLogger,
  type LoggerConfig,
} from './utils/index.js';

// Multi-LLM Exporters
export {
  // OpenAI
  toOpenAIFunction,
  toOpenAITool,
  toOpenAITools,
  type OpenAIFunctionDef,
  type OpenAIToolDef,
  // LangChain
  toLangChainTool,
  toLangChainTools,
  generateLangChainCode,
  type LangChainToolDef,
  // REST / OpenAPI
  toRESTEndpoint,
  toRESTApiSpec,
  toOpenAPI,
  type RESTEndpointDef,
  type RESTApiSpec,
} from './exporters/index.js';

// Backend interfaces
export type {
  // Core types
  SpreadsheetPlatform,
  RangeRef,
  ValueInputOption,
  ValueRenderOption,
  MajorDimension,
  CellValue,
  ValueRange,
  // Value operation types
  ReadRangeParams,
  ReadRangeResult,
  WriteRangeParams,
  WriteRangeResult,
  AppendParams,
  AppendResult,
  ClearRangeParams,
  ClearRangeResult,
  BatchReadParams,
  BatchReadResult,
  BatchWriteParams,
  BatchWriteResult,
  BatchClearParams,
  BatchClearResult,
  // Document/metadata types
  SpreadsheetMetadata,
  SheetMetadata,
  CreateDocumentParams,
  GetDocumentParams,
  AddSheetParams,
  DeleteSheetParams,
  CopySheetParams,
  CopySheetResult,
  // Batch mutation types
  BatchMutationRequest,
  BatchMutationResult,
  // File/Drive types
  FileMetadata,
  ListFilesParams,
  ListFilesResult,
  CopyDocumentParams,
  RevisionMetadata,
  ListRevisionsParams,
  ListRevisionsResult,
  // The main interface
  SpreadsheetBackend,
  // Factory types
  MutationFactory,
  BackendConfig,
  BackendFactory,
} from './interfaces/index.js';
