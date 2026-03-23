/**
 * ServalSheets - Live API Test Setup
 *
 * Vitest setup file specifically for live API tests.
 * Initializes test infrastructure, validates environment, and provides
 * global hooks for quota management and metrics collection.
 */

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  TEST_CONFIG,
  getQuotaManager,
  getTestRateLimiter,
  getMetricsCollector,
  applyQuotaDelay,
  resetTestInfrastructure,
  getLiveApiClient,
  spreadsheetPool,
} from './setup/index.js';
import { validatePreTestConditions, getTestIsolationGuard } from './guards/index.js';
import { shouldRunIntegrationTests, loadTestCredentials } from '../helpers/credential-loader.js';

/**
 * Global state for test run
 */
let isInitialized = false;
let currentSuiteName = '';
let testRunStartTime = 0;

/**
 * Initialize test infrastructure once before all tests
 */
beforeAll(async () => {
  if (isInitialized) return;

  testRunStartTime = Date.now();
  console.log('\n========================================');
  console.log('ServalSheets Live API Test Infrastructure');
  console.log('========================================\n');

  // Check if live API tests should run
  if (!shouldRunIntegrationTests()) {
    console.log('⚠️  Integration tests disabled (TEST_REAL_API not set)');
    console.log('   Set TEST_REAL_API=true to enable live API tests\n');
    return;
  }

  // Validate pre-test conditions
  console.log('🔍 Validating pre-test conditions...');
  const validation = await validatePreTestConditions({
    checkCredentials: true,
    checkQuota: true,
    checkRateLimiter: true,
  });

  if (!validation.valid) {
    console.error('\n❌ Pre-test validation failed:');
    console.error(validation.summary);
    console.log('\n⚠️  Tests may fail due to configuration issues\n');
  } else {
    console.log('✅ Pre-test validation passed\n');
  }

  // Display warnings
  if (validation.warnings.length > 0) {
    console.log('⚠️  Warnings:');
    for (const warning of validation.warnings) {
      console.log(`   - [${warning.code}] ${warning.message}`);
      if (warning.suggestion) {
        console.log(`     Suggestion: ${warning.suggestion}`);
      }
    }
    console.log('');
  }

  // Initialize metrics collector
  const metrics = getMetricsCollector();
  metrics.startRun('live-api-tests');

  // Pre-warm the spreadsheet pool so test files can borrow instead of create+delete
  // Pool of 2 gives enough buffer for sequential test execution (maxWorkers: 1)
  try {
    const sharedClient = await getLiveApiClient({ trackMetrics: true });
    await spreadsheetPool.initialize(sharedClient, { maxSize: 2, populateData: false });
    console.log(`🏊 Spreadsheet pool ready (${spreadsheetPool.getStats().total} spreadsheets)\n`);
  } catch (err) {
    // Non-fatal — tests will fall back to creating their own spreadsheets
    console.warn(
      '⚠️  Spreadsheet pool init failed, tests will create individual spreadsheets:',
      err instanceof Error ? err.message : err
    );
  }

  // Display configuration
  console.log('📋 Test Configuration:');
  console.log(
    `   Retry: ${TEST_CONFIG.retry.maxRetries} retries, ${TEST_CONFIG.retry.baseDelayMs}ms base delay`
  );
  console.log(`   Quota: ${TEST_CONFIG.quota.delayBetweenTestsMs}ms between tests`);
  console.log(
    `   Rate Limits: ${TEST_CONFIG.quota.maxReadsPerMinute} reads/min, ${TEST_CONFIG.quota.maxWritesPerMinute} writes/min`
  );
  console.log(`   Timeout: ${TEST_CONFIG.timeout.live}ms for live tests`);
  console.log('');

  isInitialized = true;
});

/**
 * Clean up after all tests
 */
afterAll(async () => {
  if (!isInitialized) return;

  const testRunDuration = Date.now() - testRunStartTime;

  console.log('\n========================================');
  console.log('Test Run Complete');
  console.log('========================================\n');

  // Get final metrics
  const metrics = getMetricsCollector();
  const quota = getQuotaManager();
  const rateLimiter = getTestRateLimiter();
  const isolation = getTestIsolationGuard();

  // Display metrics summary
  const runMetrics = metrics.getRunMetrics();
  console.log('📊 Run Metrics:');
  console.log(`   Duration: ${(testRunDuration / 1000).toFixed(2)}s`);
  console.log(`   Total Tests: ${runMetrics?.totalTests ?? 0}`);
  console.log(`   Passed: ${runMetrics?.passedTests ?? 0}`);
  console.log(`   Failed: ${runMetrics?.failedTests ?? 0}`);
  console.log(`   Skipped: ${runMetrics?.skippedTests ?? 0}`);
  console.log('');

  // Display quota usage
  const quotaStats = quota.getStats();
  console.log('📈 Quota Usage:');
  console.log(`   Total Reads: ${quotaStats.totalReadsConsumed}`);
  console.log(`   Total Writes: ${quotaStats.totalWritesConsumed}`);
  console.log(`   Throttle Events: ${quotaStats.throttleEvents}`);
  console.log(`   Delays Applied: ${quotaStats.delaysApplied}`);
  console.log('');

  // Display rate limiter stats
  const rateLimiterStats = rateLimiter.getStats();
  console.log('🚦 Rate Limiter:');
  console.log(`   Tokens Consumed: ${rateLimiterStats.tokensConsumed}`);
  console.log(`   Tokens Rejected: ${rateLimiterStats.tokensRejected}`);
  console.log(`   Max Wait Time: ${rateLimiterStats.maxWaitMs}ms`);
  console.log('');

  // Check for resource leaks
  const activeResources = isolation.getTrackedResources();
  if (activeResources.length > 0) {
    console.log('⚠️  Resource Leak Warning:');
    console.log(`   ${activeResources.length} resources not cleaned up:`);
    for (const resource of activeResources.slice(0, 5)) {
      console.log(`   - [${resource.type}] ${resource.id}`);
    }
    if (activeResources.length > 5) {
      console.log(`   ... and ${activeResources.length - 5} more`);
    }
    console.log('');
  }

  // End metrics run
  metrics.endRun();

  // Clean up pool spreadsheets
  if (spreadsheetPool.isInitialized()) {
    try {
      const poolStats = spreadsheetPool.getStats();
      const result = await spreadsheetPool.cleanup();
      console.log(
        `🏊 Pool cleanup: ${result.deleted}/${poolStats.total} spreadsheets deleted\n`
      );
    } catch {
      // Ignore pool cleanup errors
    }
  }

  // Reset infrastructure for next run
  resetTestInfrastructure();
  isInitialized = false;
});

/**
 * Before each test suite
 */
beforeEach(async (context) => {
  // Extract test name from context
  const testName = (context as unknown as { task?: { name?: string } })?.task?.name ?? 'unknown';

  // Start metrics for this test
  getMetricsCollector().startTest(testName);

  // Track test in isolation guard
  getTestIsolationGuard().enterTest(testName);
});

/**
 * After each test
 */
afterEach(async (context) => {
  // Extract test result from context
  const task = (context as unknown as { task?: { result?: { state?: string; error?: Error } } })
    ?.task;
  const state = task?.result?.state ?? 'unknown';
  const error = task?.result?.error;

  // End metrics for this test
  const status = state === 'pass' ? 'passed' : state === 'fail' ? 'failed' : 'skipped';
  getMetricsCollector().endTest(status, error);

  // End test in isolation guard
  getTestIsolationGuard().exitTest();

  // Apply quota delay between tests
  await applyQuotaDelay();
});

/**
 * Export test infrastructure state for debugging
 */
export function getTestInfrastructureState() {
  return {
    isInitialized,
    currentSuiteName,
    testRunStartTime,
    config: TEST_CONFIG,
    quota: getQuotaManager().getState(),
    rateLimiter: getTestRateLimiter().getStatus(),
    metrics: getMetricsCollector().getRunMetrics(),
  };
}
