/**
 * ServalSheets - Test Infrastructure Configuration
 *
 * Centralized configuration for live API tests with environment overrides.
 * Provides consistent defaults across all test infrastructure components.
 */

/**
 * Environment variable helper with type coercion
 */
function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function getEnvFloat(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Retry configuration for test environment
 * Extended delays and higher tolerance compared to production
 */
export interface TestRetryConfig {
  /** Maximum retry attempts (default: 5, higher than prod's 3) */
  maxRetries: number;
  /** Base delay between retries in ms (default: 2000, higher than prod's 500) */
  baseDelayMs: number;
  /** Maximum delay cap in ms (default: 120000, higher than prod's 60000) */
  maxDelayMs: number;
  /** Jitter ratio for randomization (default: 0.3, higher than prod's 0.2) */
  jitterRatio: number;
  /** Request timeout in ms (default: 60000) */
  timeoutMs: number;
  /** Enable metrics recording for retries */
  recordMetrics: boolean;
}

/**
 * Quota management configuration
 * Conservative limits to prevent test quota exhaustion
 */
export interface TestQuotaConfig {
  /** Minimum delay between tests in ms (default: 200) */
  delayBetweenTestsMs: number;
  /** Maximum reads per minute (default: 200, lower than prod's 300) */
  maxReadsPerMinute: number;
  /** Maximum writes per minute (default: 40, lower than prod's 60) */
  maxWritesPerMinute: number;
  /** Buffer percentage to leave as safety margin (default: 0.1 = 10%) */
  quotaBufferRatio: number;
  /** Minimum quota threshold before rejecting tests */
  minQuotaThreshold: number;
  /** Maximum delay for quota recovery in ms */
  maxQuotaDelayMs: number;
}

/**
 * Spreadsheet pool configuration
 */
export interface TestPoolConfig {
  /** Maximum pooled spreadsheets (default: 5) */
  maxSize: number;
  /** Health check interval in ms (default: 60000) */
  healthCheckIntervalMs: number;
  /** Maximum time to wait for available spreadsheet in ms */
  maxBorrowWaitMs: number;
  /** Maximum age before spreadsheet is recycled in ms (default: 24 hours) */
  maxSpreadsheetAgeMs: number;
  /** Prefix for test spreadsheet names */
  spreadsheetPrefix: string;
}

/**
 * Policy enforcement configuration for tests
 */
export interface TestPolicyConfig {
  /** Maximum cells per test operation (default: 100000) */
  maxCellsPerTest: number;
  /** Maximum operations per test (default: 50) */
  maxOperationsPerTest: number;
  /** Maximum concurrent tests (default: 4) */
  maxConcurrentTests: number;
  /** Maximum rows to delete per operation (default: 1000) */
  maxRowsPerDelete: number;
  /** Maximum columns to delete per operation (default: 50) */
  maxColumnsPerDelete: number;
}

/**
 * Timeout configuration for various test scenarios
 */
export interface TestTimeoutConfig {
  /** Default test timeout in ms (default: 30000) */
  default: number;
  /** Live API test timeout in ms (default: 60000) */
  liveApi: number;
  /** Hook (beforeAll/afterAll) timeout in ms (default: 60000) */
  hook: number;
  /** Cleanup timeout in ms (default: 30000) */
  cleanup: number;
  /** Health check timeout in ms (default: 10000) */
  healthCheck: number;
}

/**
 * Metrics collection configuration
 */
export interface TestMetricsConfig {
  /** Enable metrics collection (default: true) */
  enabled: boolean;
  /** Maximum history entries to retain */
  maxHistoryEntries: number;
  /** Flush interval for aggregated metrics in ms */
  flushIntervalMs: number;
}

/**
 * Complete test configuration
 */
export interface TestConfig {
  retry: TestRetryConfig;
  quota: TestQuotaConfig;
  pool: TestPoolConfig;
  policy: TestPolicyConfig;
  timeout: TestTimeoutConfig;
  metrics: TestMetricsConfig;
}

/**
 * Get retry configuration with environment overrides
 */
function getRetryConfig(): TestRetryConfig {
  return {
    maxRetries: getEnvNumber('TEST_MAX_RETRIES', 5),
    baseDelayMs: getEnvNumber('TEST_RETRY_BASE_DELAY_MS', 2000),
    maxDelayMs: getEnvNumber('TEST_RETRY_MAX_DELAY_MS', 120000),
    jitterRatio: getEnvFloat('TEST_RETRY_JITTER', 0.3),
    timeoutMs: getEnvNumber('TEST_TIMEOUT_MS', 60000),
    recordMetrics: getEnvBoolean('TEST_RECORD_RETRY_METRICS', true),
  };
}

/**
 * Get quota configuration with environment overrides
 */
function getQuotaConfig(): TestQuotaConfig {
  return {
    delayBetweenTestsMs: getEnvNumber('TEST_QUOTA_DELAY_MS', 200),
    maxReadsPerMinute: getEnvNumber('TEST_MAX_READS_PER_MINUTE', 200),
    maxWritesPerMinute: getEnvNumber('TEST_MAX_WRITES_PER_MINUTE', 40),
    quotaBufferRatio: getEnvFloat('TEST_QUOTA_BUFFER_RATIO', 0.1),
    minQuotaThreshold: getEnvNumber('TEST_MIN_QUOTA_THRESHOLD', 10),
    maxQuotaDelayMs: getEnvNumber('TEST_MAX_QUOTA_DELAY_MS', 30000),
  };
}

/**
 * Get pool configuration with environment overrides
 */
function getPoolConfig(): TestPoolConfig {
  return {
    maxSize: getEnvNumber('TEST_POOL_MAX_SIZE', 5),
    healthCheckIntervalMs: getEnvNumber('TEST_POOL_HEALTH_CHECK_MS', 60000),
    maxBorrowWaitMs: getEnvNumber('TEST_POOL_MAX_BORROW_WAIT_MS', 30000),
    maxSpreadsheetAgeMs: getEnvNumber('TEST_POOL_MAX_AGE_MS', 24 * 60 * 60 * 1000),
    spreadsheetPrefix: process.env['TEST_SPREADSHEET_PREFIX'] ?? 'ServalSheets_Test_',
  };
}

/**
 * Get policy configuration with environment overrides
 */
function getPolicyConfig(): TestPolicyConfig {
  return {
    maxCellsPerTest: getEnvNumber('TEST_MAX_CELLS', 100000),
    maxOperationsPerTest: getEnvNumber('TEST_MAX_OPERATIONS', 50),
    maxConcurrentTests: getEnvNumber('TEST_MAX_CONCURRENT', 4),
    maxRowsPerDelete: getEnvNumber('TEST_MAX_ROWS_DELETE', 1000),
    maxColumnsPerDelete: getEnvNumber('TEST_MAX_COLS_DELETE', 50),
  };
}

/**
 * Get timeout configuration with environment overrides
 */
function getTimeoutConfig(): TestTimeoutConfig {
  return {
    default: getEnvNumber('TEST_DEFAULT_TIMEOUT_MS', 30000),
    liveApi: getEnvNumber('TEST_LIVE_API_TIMEOUT_MS', 60000),
    hook: getEnvNumber('TEST_HOOK_TIMEOUT_MS', 60000),
    cleanup: getEnvNumber('TEST_CLEANUP_TIMEOUT_MS', 30000),
    healthCheck: getEnvNumber('TEST_HEALTH_CHECK_TIMEOUT_MS', 10000),
  };
}

/**
 * Get metrics configuration with environment overrides
 */
function getMetricsConfig(): TestMetricsConfig {
  return {
    enabled: getEnvBoolean('TEST_METRICS_ENABLED', true),
    maxHistoryEntries: getEnvNumber('TEST_METRICS_MAX_HISTORY', 1000),
    flushIntervalMs: getEnvNumber('TEST_METRICS_FLUSH_MS', 30000),
  };
}

/**
 * Build complete test configuration
 */
function buildTestConfig(): TestConfig {
  return {
    retry: getRetryConfig(),
    quota: getQuotaConfig(),
    pool: getPoolConfig(),
    policy: getPolicyConfig(),
    timeout: getTimeoutConfig(),
    metrics: getMetricsConfig(),
  };
}

/**
 * Singleton test configuration instance
 * Initialized once and cached for consistent access
 */
let _testConfig: TestConfig | null = null;

/**
 * Get the test configuration (singleton)
 */
export function getTestConfig(): TestConfig {
  if (!_testConfig) {
    _testConfig = buildTestConfig();
  }
  return _testConfig;
}

/**
 * Reset configuration (useful for testing the config itself)
 */
export function resetTestConfig(): void {
  _testConfig = null;
}

/**
 * Override specific configuration values (for testing)
 */
export function overrideTestConfig(overrides: Partial<TestConfig>): void {
  const current = getTestConfig();
  _testConfig = {
    retry: { ...current.retry, ...overrides.retry },
    quota: { ...current.quota, ...overrides.quota },
    pool: { ...current.pool, ...overrides.pool },
    policy: { ...current.policy, ...overrides.policy },
    timeout: { ...current.timeout, ...overrides.timeout },
    metrics: { ...current.metrics, ...overrides.metrics },
  };
}

/**
 * Export convenience accessors for specific config sections
 */
export const TEST_CONFIG = {
  get retry() {
    return getTestConfig().retry;
  },
  get quota() {
    return getTestConfig().quota;
  },
  get pool() {
    return getTestConfig().pool;
  },
  get policy() {
    return getTestConfig().policy;
  },
  get timeout() {
    return getTestConfig().timeout;
  },
  get metrics() {
    return getTestConfig().metrics;
  },
};

export default TEST_CONFIG;
