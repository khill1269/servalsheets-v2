/**
 * ServalSheets - Test Infrastructure Integration Tests
 *
 * Tests the test infrastructure components themselves.
 * These tests verify the testing utilities work correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TEST_CONFIG, getTestConfig, resetTestConfig, overrideTestConfig } from './setup/config.js';
import {
  executeWithTestRetry,
  isTestRetryableError,
  getRetryStats,
  clearRetryMetrics,
  TestRetryManager,
} from './setup/test-retry-manager.js';
import { QuotaManager, getQuotaManager, resetQuotaManager } from './setup/quota-manager.js';
import {
  TestRateLimiter,
  getTestRateLimiter,
  resetTestRateLimiter,
} from './setup/test-rate-limiter.js';
import {
  MetricsCollector,
  getMetricsCollector,
  resetMetricsCollector,
} from './setup/metrics-collector.js';
import {
  TEMPLATES,
  getTemplate,
  getTemplateData,
  generateLargeTemplate,
  generateCustomTemplate,
} from './setup/sheet-templates.js';
import {
  sleep,
  generateTestId,
  columnLetter,
  a1Range,
  generateTestData,
  parseA1Notation,
  deepEqual,
  assertApproxEqual,
  assertThrows,
} from './setup/test-helpers.js';
import {
  PreTestValidator,
  getPreTestValidator,
  resetPreTestValidator,
} from './guards/pre-test-validator.js';
import {
  BreakingChangeDetector,
  getBreakingChangeDetector,
  resetBreakingChangeDetector,
} from './guards/breaking-change-detector.js';
import {
  TestIsolationGuard,
  getTestIsolationGuard,
  resetTestIsolationGuard,
} from './guards/test-isolation-guard.js';

describe('Test Infrastructure', () => {
  describe('Config', () => {
    beforeEach(() => {
      resetTestConfig();
    });

    it('should provide default configuration', () => {
      const config = getTestConfig();

      expect(config.retry.maxRetries).toBe(5);
      expect(config.quota.maxReadsPerMinute).toBe(200);
      expect(config.pool.maxSize).toBe(5);
      expect(config.timeout.liveApi).toBe(60000);
    });

    it('should allow configuration override', () => {
      overrideTestConfig({
        retry: { maxRetries: 10 } as any,
      });

      const config = getTestConfig();
      expect(config.retry.maxRetries).toBe(10);
    });

    it('should provide convenient accessors', () => {
      expect(TEST_CONFIG.retry.maxRetries).toBe(5);
      expect(TEST_CONFIG.quota.delayBetweenTestsMs).toBe(200);
    });
  });

  describe('Retry Manager', () => {
    beforeEach(() => {
      clearRetryMetrics();
    });

    it('should execute operation successfully', async () => {
      let called = false;
      const result = await executeWithTestRetry(async () => {
        called = true;
        return 'success';
      });

      expect(called).toBe(true);
      expect(result).toBe('success');
    });

    it('should retry on retryable errors', async () => {
      let attempts = 0;
      const result = await executeWithTestRetry(
        async () => {
          attempts++;
          if (attempts < 3) {
            const error = new Error('rate limit');
            throw error;
          }
          return 'success';
        },
        { maxRetries: 5, baseDelayMs: 10 }
      );

      expect(attempts).toBe(3);
      expect(result).toBe('success');
    });

    it('should throw after max retries', async () => {
      let attempts = 0;
      // Use a retryable error (rate limit) to ensure retries happen
      await expect(
        executeWithTestRetry(
          async () => {
            attempts++;
            const error = new Error('rate limit exceeded');
            throw error;
          },
          { maxRetries: 2, baseDelayMs: 10 }
        )
      ).rejects.toThrow('rate limit exceeded');

      expect(attempts).toBe(3); // Initial + 2 retries
    });

    it('should track retry metrics', async () => {
      await executeWithTestRetry(async () => 'success', { operationName: 'test_operation' });

      const stats = getRetryStats();
      expect(stats.totalOperations).toBeGreaterThanOrEqual(1);
      expect(stats.successfulOperations).toBeGreaterThanOrEqual(1);
    });

    it('should identify retryable errors', () => {
      expect(isTestRetryableError(new Error('rate limit exceeded'))).toBe(true);
      expect(isTestRetryableError(new Error('quota exceeded'))).toBe(true);
      expect(isTestRetryableError(new Error('timeout'))).toBe(true);
      expect(isTestRetryableError({ code: 429 })).toBe(true);
      expect(isTestRetryableError({ code: 503 })).toBe(true);
      expect(isTestRetryableError(new Error('some random error'))).toBe(false);
    });
  });

  describe('Quota Manager', () => {
    let quota: QuotaManager;

    beforeEach(() => {
      resetQuotaManager();
      quota = getQuotaManager();
    });

    it('should track operations', () => {
      quota.recordOperations(10, 5);

      const state = quota.getState();
      expect(state.estimatedReadsCurrent).toBe(10);
      expect(state.estimatedWritesCurrent).toBe(5);
    });

    it('should verify quota availability', () => {
      const verification = quota.verifyQuota({ reads: 5, writes: 2 });

      expect(verification.hasQuota).toBe(true);
      expect(verification.availableReads).toBeGreaterThan(0);
      expect(verification.availableWrites).toBeGreaterThan(0);
    });

    it('should calculate required delay', () => {
      // Record heavy usage
      quota.recordOperations(150, 30);

      const delay = quota.calculateRequiredDelay();
      expect(delay).toBeGreaterThanOrEqual(TEST_CONFIG.quota.delayBetweenTestsMs);
    });

    it('should enter and exit throttle mode', () => {
      quota.enterThrottle(1000);
      expect(quota.getState().isThrottled).toBe(true);

      quota.exitThrottle();
      expect(quota.getState().isThrottled).toBe(false);
    });
  });

  describe('Rate Limiter', () => {
    let limiter: TestRateLimiter;

    beforeEach(() => {
      resetTestRateLimiter();
      limiter = getTestRateLimiter();
    });

    it('should acquire tokens', async () => {
      await limiter.acquire('read', 1);
      await limiter.acquire('write', 1);

      const stats = limiter.getStats();
      expect(stats.totalReadsAcquired).toBe(1);
      expect(stats.totalWritesAcquired).toBe(1);
    });

    it('should check token availability', () => {
      expect(limiter.hasTokens('read', 1)).toBe(true);
      expect(limiter.hasTokens('write', 1)).toBe(true);
    });

    it('should reserve and release tokens', () => {
      // Use smaller numbers that fit within initial token budget
      // Initial tokens: ~4 reads/sec, ~1 writes/sec
      const reservation = limiter.reserveTokens(2, 1);
      expect(reservation).not.toBeNull();

      const status = limiter.getStatus();
      expect(status.readReserved).toBe(2);
      expect(status.writeReserved).toBe(1);

      limiter.releaseReservation(reservation!, 1, 1);
      expect(limiter.getStats().totalReadsAcquired).toBe(1);
    });

    it('should verify pre-test quota', () => {
      // Use smaller numbers that fit within initial token budget
      const result = limiter.verifyPreTestQuota(2, 1);
      expect(result.canProceed).toBe(true);
    });

    it('should throttle after rate limit error', () => {
      limiter.throttle(1000);
      expect(limiter.isThrottled()).toBe(true);
    });
  });

  describe('Metrics Collector', () => {
    let collector: MetricsCollector;

    beforeEach(() => {
      resetMetricsCollector();
      collector = getMetricsCollector();
    });

    it('should track test metrics', () => {
      collector.setSuite('TestSuite');
      collector.startTest('testCase1');
      collector.recordApiCall('read', 'GET', 100, true);
      collector.endTest('passed');

      const metrics = collector.getTestMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].testName).toBe('testCase1');
      expect(metrics[0].status).toBe('passed');
    });

    it('should calculate suite metrics', () => {
      collector.setSuite('TestSuite');

      collector.startTest('test1');
      collector.endTest('passed');

      collector.startTest('test2');
      collector.endTest('passed');

      collector.startTest('test3');
      collector.endTest('failed', new Error('test error'));

      const suiteMetrics = collector.getSuiteMetrics('TestSuite');
      expect(suiteMetrics.testCount).toBe(3);
      expect(suiteMetrics.passedCount).toBe(2);
      expect(suiteMetrics.failedCount).toBe(1);
    });

    it('should generate reports', () => {
      collector.setSuite('TestSuite');
      collector.startTest('test1');
      collector.endTest('passed');

      const jsonReport = collector.getReport('json');
      expect(JSON.parse(jsonReport)).toHaveProperty('runId');

      const markdownReport = collector.getReport('markdown');
      expect(markdownReport).toContain('# ServalSheets Test Report');

      const htmlReport = collector.getReport('html');
      expect(htmlReport).toContain('<!DOCTYPE html>');
    });
  });

  describe('Sheet Templates', () => {
    it('should provide basic template', () => {
      const template = getTemplate('BASIC');

      expect(template.name).toBe('BASIC');
      expect(template.headers).toHaveLength(5);
      expect(template.data).toHaveLength(10);
      expect(template.rowCount).toBe(11);
    });

    it('should provide unicode template', () => {
      const template = TEMPLATES.UNICODE;

      expect(template.hasUnicode).toBe(true);
      expect(template.data.length).toBeGreaterThan(20);
    });

    it('should generate template data with headers', () => {
      const data = getTemplateData(TEMPLATES.BASIC);

      expect(data[0]).toEqual(TEMPLATES.BASIC.headers);
      expect(data.length).toBe(TEMPLATES.BASIC.rowCount);
    });

    it('should generate large templates', () => {
      const template = generateLargeTemplate(100, 10);

      expect(template.data).toHaveLength(100);
      expect(template.headers).toHaveLength(10);
    });

    it('should generate custom templates', () => {
      const template = generateCustomTemplate(
        'CUSTOM',
        ['A', 'B', 'C'],
        (row) => [row, row * 2, row * 3],
        5
      );

      expect(template.name).toBe('CUSTOM');
      expect(template.data).toHaveLength(5);
      expect(template.data[2]).toEqual([2, 4, 6]);
    });
  });

  describe('Test Helpers', () => {
    it('should generate unique test IDs', () => {
      const id1 = generateTestId('test');
      const id2 = generateTestId('test');

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^test_[a-z0-9]+_[a-z0-9]+$/);
    });

    it('should convert column index to letter', () => {
      expect(columnLetter(0)).toBe('A');
      expect(columnLetter(25)).toBe('Z');
      expect(columnLetter(26)).toBe('AA');
      expect(columnLetter(27)).toBe('AB');
    });

    it('should generate A1 range notation', () => {
      expect(a1Range(1, 0, 10, 2)).toBe('A1:C10');
      expect(a1Range(1, 0, 10, 2, 'Sheet1')).toBe("'Sheet1'!A1:C10");
    });

    it('should generate test data', () => {
      const data = generateTestData(5, 3);

      expect(data).toHaveLength(5);
      expect(data[0]).toHaveLength(3);
    });

    it('should parse A1 notation', () => {
      const result = parseA1Notation("'Sheet1'!A1:B10");

      expect(result.sheetName).toBe('Sheet1');
      expect(result.startCol).toBe(0);
      expect(result.startRow).toBe(1);
      expect(result.endCol).toBe(1);
      expect(result.endRow).toBe(10);
    });

    it('should deep compare values', () => {
      expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
      expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
      expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    });

    it('should assert approximate equality', () => {
      expect(() => assertApproxEqual(1.001, 1.0, 0.01)).not.toThrow();
      expect(() => assertApproxEqual(1.1, 1.0, 0.01)).toThrow();
    });

    it('should assert throws', async () => {
      await expect(
        assertThrows(async () => {
          throw new Error('test error');
        }, 'test')
      ).resolves.toBeDefined();

      await expect(assertThrows(async () => 'no throw')).rejects.toThrow(
        'Expected function to throw'
      );
    });
  });

  describe('Pre-Test Validator', () => {
    beforeEach(() => {
      resetPreTestValidator();
    });

    it('should validate environment', async () => {
      const validator = new PreTestValidator({
        requiredEnvVars: [],
        checkCredentials: false,
        checkQuota: false,
        checkRateLimiter: false,
      });

      const result = await validator.validate();
      // May have errors depending on env, but should complete
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
    });
  });

  describe('Breaking Change Detector', () => {
    let detector: BreakingChangeDetector;

    beforeEach(() => {
      resetBreakingChangeDetector();
      detector = getBreakingChangeDetector();
    });

    it('should register and check contracts', () => {
      detector.registerContract({
        name: 'test_contract',
        version: '1.0.0',
        requiredFields: ['id', 'name'],
        responseSchema: [
          { name: 'id', type: 'number', required: true },
          { name: 'name', type: 'string', required: true },
        ],
      });

      const result = detector.checkContract('test_contract', {
        id: 1,
        name: 'test',
      });

      expect(result.compatible).toBe(true);
      expect(result.hasBreakingChanges).toBe(false);
    });

    it('should detect missing required fields', () => {
      detector.registerContract({
        name: 'test_contract',
        version: '1.0.0',
        requiredFields: ['id', 'name'],
        responseSchema: [],
      });

      const result = detector.checkContract('test_contract', { id: 1 });

      expect(result.hasBreakingChanges).toBe(true);
      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: 'MISSING_FIELD',
          path: 'name',
        })
      );
    });

    it('should store and compare snapshots', () => {
      const data1 = { id: 1, name: 'test' };
      const data2 = { id: 1, name: 'test', extra: 'field' };

      detector.storeSnapshot('test', data1);
      const result = detector.checkAgainstSnapshots('test', data2);

      expect(result.changes.some((c) => c.type === 'STRUCTURE_CHANGE')).toBe(true);
    });
  });

  describe('Test Isolation Guard', () => {
    let guard: TestIsolationGuard;

    beforeEach(() => {
      resetTestIsolationGuard();
      guard = getTestIsolationGuard();
    });

    it('should track resources', () => {
      guard.enterTest('test1');
      guard.trackResource('spreadsheet', 'sheet-123');

      const resources = guard.getTrackedResources();
      expect(resources).toHaveLength(1);
      expect(resources[0].id).toBe('sheet-123');
      expect(resources[0].createdBy).toBe('test1');
    });

    it('should untrack resources', () => {
      guard.trackResource('spreadsheet', 'sheet-123');
      expect(guard.getTrackedResources()).toHaveLength(1);

      guard.untrackResource('spreadsheet', 'sheet-123');
      expect(guard.getTrackedResources()).toHaveLength(0);
    });

    it('should check test isolation', () => {
      guard.enterTest('test1');
      guard.trackResource('spreadsheet', 'sheet-123');

      const result = guard.checkTestIsolation('test1');
      expect(result.isolated).toBe(false);
      expect(result.leakedResources).toHaveLength(1);
    });

    it('should track test hierarchy', () => {
      guard.enterTest('test1');
      expect(guard.getCurrentTest()).toBe('test1');

      guard.enterTest('nested');
      expect(guard.getCurrentTest()).toBe('nested');

      guard.exitTest();
      expect(guard.getCurrentTest()).toBe('test1');
    });

    it('should provide statistics', () => {
      guard.enterTest('test1');
      guard.trackResource('spreadsheet', 'sheet-1');
      guard.trackResource('sheet', 'tab-1', { parentId: 'sheet-1' });

      const stats = guard.getStats();
      expect(stats.totalTracked).toBe(2);
      expect(stats.byType.spreadsheet).toBe(1);
      expect(stats.byType.sheet).toBe(1);
    });
  });
});
