/**
 * ServalSheets - Live API Test Infrastructure
 *
 * Barrel export for all test infrastructure components.
 * Import from this file for consistent access to test utilities.
 *
 * @example
 * ```typescript
 * import {
 *   getLiveApiClient,
 *   getQuotaManager,
 *   applyQuotaDelay,
 *   TEMPLATES,
 * } from '../setup/index.js';
 * ```
 */

// Configuration
export {
  TEST_CONFIG,
  getTestConfig,
  resetTestConfig,
  overrideTestConfig,
  type TestConfig,
  type TestRetryConfig,
  type TestQuotaConfig,
  type TestPoolConfig,
  type TestPolicyConfig,
  type TestTimeoutConfig,
  type TestMetricsConfig,
} from './config.js';

// Live API Client
export {
  LiveApiClient,
  getLiveApiClient,
  resetLiveApiClient,
  isLiveApiEnabled,
  type LiveApiClientOptions,
  type RequestMetrics,
  type ApiStats,
} from './live-api-client.js';

// Retry Manager
export {
  executeWithTestRetry,
  isTestRetryableError,
  getRetryMetricsHistory,
  getRetryStats,
  clearRetryMetrics,
  TestRetryManager,
  getTestRetryManager,
  resetTestRetryManager,
  type TestRetryOptions,
  type RetryAttemptMetric,
  type RetryMetrics,
} from './test-retry-manager.js';

// Quota Manager
export {
  QuotaManager,
  getQuotaManager,
  resetQuotaManager,
  applyQuotaDelay,
  recordQuotaUsage,
  checkQuotaAvailable,
  waitForQuota,
  type QuotaState,
  type QuotaVerification,
  type OperationEstimate,
} from './quota-manager.js';

// Rate Limiter
export {
  TestRateLimiter,
  getTestRateLimiter,
  resetTestRateLimiter,
  acquireReadTokens,
  acquireWriteTokens,
  checkTestQuota,
  type TestRateLimits,
  type TokenReservation,
} from './test-rate-limiter.js';

// Metrics Collector
export {
  MetricsCollector,
  getMetricsCollector,
  resetMetricsCollector,
  startTestMetrics,
  endTestMetrics,
  recordApiCallMetric,
  getTestReport,
  type ApiCallMetric,
  type TestMetric,
  type SuiteMetric,
  type RunMetric,
} from './metrics-collector.js';

// Spreadsheet Pool
export {
  spreadsheetPool,
  getTestSpreadsheetPool,
  type PooledSpreadsheet,
  type SpreadsheetPoolOptions,
  type PoolStats,
} from './spreadsheet-pool.js';

// Test Spreadsheet Manager
export {
  TestSpreadsheetManager,
  getTestSpreadsheetManager,
  resetTestSpreadsheetManager,
} from './test-spreadsheet-manager.js';

// Sheet Templates
export {
  TEMPLATES,
  TEMPLATE_BASIC,
  TEMPLATE_FORMULAS,
  TEMPLATE_UNICODE,
  TEMPLATE_EDGE_CASES,
  TEMPLATE_DATES,
  generateLargeTemplate,
  getTemplate,
  getTemplateData,
  getTemplateDataOnly,
  getTemplateRange,
  getTemplateSubset,
  generateCustomTemplate,
  type SheetTemplate,
  type TemplateName,
} from './sheet-templates.js';

// Test Helpers
export {
  sleep,
  delay,
  generateTestId,
  columnLetter,
  a1Range,
  generateTestData,
  generateHeaders,
  waitForQuota as waitForQuotaHelper,
  shouldSkipForQuota,
  withTestTracking,
  retryWithBackoff,
  assertApproxEqual,
  assertThrows,
  assertEventually,
  getTestStats,
  resetTestInfrastructure,
  standardAfterEach,
  createBeforeAllHook,
  formatDuration,
  formatBytes,
  deepEqual,
  sanitizeSheetName,
  parseA1Notation,
  type TestContext,
  type CreateTestSheetOptions,
} from './test-helpers.js';

/**
 * Re-export credential loader utilities
 */
export {
  loadTestCredentials,
  shouldRunIntegrationTests,
  type TestCredentials,
} from '../../helpers/credential-loader.js';
