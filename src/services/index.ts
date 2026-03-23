/**
 * ServalSheets - Services Index
 *
 * Services follow the correct MCP architectural pattern:
 * - Claude (LLM) does planning and orchestration
 * - Services provide infrastructure and utilities
 * - Elicitation (SEP-1036) for user confirmation
 * - Sampling (SEP-1577) for AI-powered analysis
 *
 * Note: Types are exported from schemas (not duplicated here) to avoid conflicts.
 */

// Core Services
export * from './snapshot.js';
export * from './google-api.js';
export * from './token-store.js';
export * from './keychain-store.js';

// Phase 1: Quick Wins
export * from './token-manager.js';
export * from './history-service.js';
export * from './context-manager.js';

// Phase 2: Performance
export * from './parallel-executor.js';
export * from './prefetch-predictor.js';
export * from './prefetching-system.js';
export * from './batching-system.js';
export * from './access-pattern-tracker.js';
export * from './request-merger.js';
export * from './etag-cache.js';
export * from './cached-sheets-api.js';
export * from './session-context.js';
export * from './performance-integration.js';
export * from './metadata-cache.js';

// Phase 3: MCP-Native Intelligence
// Export only functions, not types (types come from schemas)
export { getConfirmationService, resetConfirmationService } from './confirm-service.js';

export {
  buildAnalysisSamplingRequest,
  buildFormulaSamplingRequest,
  buildChartSamplingRequest,
  parseAnalysisResponse,
  getSamplingAnalysisService,
  resetSamplingAnalysisService,
} from './sampling-analysis.js';

// LLM Fallback (for when MCP sampling is not supported)
export {
  createLLMMessage,
  createMessageWithFallback,
  isLLMFallbackAvailable,
  getLLMFallbackConfig,
  type LLMProvider,
  type LLMMessage,
  type LLMRequestOptions,
  type LLMResponse,
  type LLMFallbackConfig,
} from './llm-fallback.js';

// Removed: workflow-engine.js (Claude orchestrates natively via MCP)

// Phase 4: Safety & Reliability
export * from './transaction-manager.js';
export * from './conflict-detector.js';
export * from './impact-analyzer.js';
export * from './validation-engine.js';
export * from './user-rate-limiter.js';

// Webhook Services
export * from './webhook-manager.js';
export * from './webhook-queue.js';
export * from './webhook-worker.js';

// Concurrency Coordination
export * from './concurrency-coordinator.js';

// Observability & Tracing
export * from './trace-aggregator.js';

// Task Management
export * from './task-manager.js';

// Phase 2.2: Google API Schema Discovery & Response Validation
export * from './discovery-client.js';
export {
  ResponseValidator,
  getResponseValidator,
  type ValidationError as ResponseValidationError,
  type ValidationResult as ResponseValidationResult,
} from './response-validator.js';
export {
  SchemaValidator,
  getSchemaValidator,
  type ValidationResult as SchemaValidationResult,
} from './schema-validator.js';

// Compliance & Audit
export {
  AuditLogger,
  getAuditLogger,
  type AuditEvent,
  type AuditResource,
  type MutationEvent,
  type PermissionEvent,
  type AuthenticationEvent,
  type ConfigurationEvent,
  type ExportEvent,
} from './audit-logger.js';
