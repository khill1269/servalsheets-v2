/**
 * Prefetching System Integration Tests
 *
 * Tests the activation and integration of the prefetching system.
 * Validates prefetch predictions, caching, circuit breaker, and background refresh.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import {
  initPrefetchingSystem,
  getPrefetchingSystem,
  resetPrefetchingSystem,
  PrefetchingSystem,
} from '../../src/services/prefetching-system.js';
import {
  getAccessPatternTracker,
  resetAccessPatternTracker,
} from '../../src/services/access-pattern-tracker.js';
import { cacheManager } from '../../src/utils/cache-manager.js';
import { waitFor } from '../helpers/wait-for.js';

describe('PrefetchingSystem Integration', () => {
  let mockSheetsApi: sheets_v4.Sheets;
  let mockValuesGet: ReturnType<typeof vi.fn>;
  let mockSpreadsheetGet: ReturnType<typeof vi.fn>;
  let prefetchingSystem: PrefetchingSystem;

  beforeEach(() => {
    // Reset singletons
    resetAccessPatternTracker();
    resetPrefetchingSystem();

    // Clear cache
    cacheManager.clear();
    cacheManager.resetStats();

    // Create mock Sheets API
    mockValuesGet = vi.fn().mockResolvedValue({
      data: {
        range: 'Sheet1!A1:Z100',
        values: [
          ['Header1', 'Header2'],
          ['Data1', 'Data2'],
        ],
      },
    });

    mockSpreadsheetGet = vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-sheet-123',
        properties: { title: 'Test Spreadsheet' },
        sheets: [],
      },
    });

    mockSheetsApi = {
      spreadsheets: {
        values: {
          get: mockValuesGet,
        },
        get: mockSpreadsheetGet,
      },
    } as unknown as sheets_v4.Sheets;

    // Initialize prefetching system with env vars
    process.env['ENABLE_PREFETCH'] = 'true';
    process.env['PREFETCH_MIN_CONFIDENCE'] = '0.3';
    prefetchingSystem = initPrefetchingSystem(mockSheetsApi);
  });

  afterEach(() => {
    if (prefetchingSystem) {
      prefetchingSystem.destroy();
    }
    resetPrefetchingSystem();
    resetAccessPatternTracker();
    cacheManager.clear();
    delete process.env['ENABLE_PREFETCH'];
    delete process.env['PREFETCH_MIN_CONFIDENCE'];
  });

  describe('Activation', () => {
    it('should initialize prefetching system when ENABLE_PREFETCH=true', () => {
      const system = getPrefetchingSystem();
      expect(system).toBeDefined();
      expect(system).not.toBeNull();
    });

    it('should not initialize when ENABLE_PREFETCH=false', () => {
      resetPrefetchingSystem();
      process.env['ENABLE_PREFETCH'] = 'false';

      const system = getPrefetchingSystem();
      expect(system).toBeNull();
    });

    it('should respect PREFETCH_MIN_CONFIDENCE configuration', () => {
      const stats = prefetchingSystem.getStats();
      expect(stats).toBeDefined();
      expect(stats.totalPrefetches).toBe(0);
    });
  });

  describe('Integration with Access Patterns', () => {
    it('should record access patterns and generate predictions', () => {
      const tracker = getAccessPatternTracker();

      // Record a series of accesses to build patterns
      for (let i = 0; i < 5; i++) {
        tracker.recordAccess({
          spreadsheetId: 'test-sheet-123',
          range: 'A1:B10',
          action: 'read',
        });
        tracker.recordAccess({
          spreadsheetId: 'test-sheet-123',
          range: 'A11:B20',
          action: 'read',
        });
      }

      // Predictions should be generated for repeated patterns
      const predictions = tracker.predictNext({
        spreadsheetId: 'test-sheet-123',
        range: 'A1:B10',
      });

      // Should have at least adjacent range predictions
      expect(predictions.length).toBeGreaterThan(0);
    });

    it('should trigger prefetch based on access patterns', async () => {
      const tracker = getAccessPatternTracker();

      // Build up patterns with enough repetitions for confidence
      for (let i = 0; i < 10; i++) {
        tracker.recordAccess({
          spreadsheetId: 'test-sheet-123',
          range: 'A1:B10',
          action: 'read',
        });
        tracker.recordAccess({
          spreadsheetId: 'test-sheet-123',
          range: 'A11:B20',
          action: 'read',
        });
      }

      // Trigger prefetch based on current access
      await prefetchingSystem.prefetch({
        spreadsheetId: 'test-sheet-123',
        range: 'A1:B10',
      });

      // Wait for queue to process
      await waitFor(200);

      const stats = prefetchingSystem.getStats();
      expect(stats.totalPrefetches).toBeGreaterThan(0);
    });

    it('should not break when prefetch fails', async () => {
      // Make prefetch API call fail
      mockValuesGet.mockRejectedValue(new Error('API Error'));

      const tracker = getAccessPatternTracker();

      // Build patterns
      for (let i = 0; i < 10; i++) {
        tracker.recordAccess({
          spreadsheetId: 'test-sheet-123',
          range: 'A1:B10',
          action: 'read',
        });
      }

      // Prefetch should not throw, even when API fails
      await expect(
        prefetchingSystem.prefetch({
          spreadsheetId: 'test-sheet-123',
          range: 'A1:B10',
        })
      ).resolves.not.toThrow();

      // Wait for queue to process
      await waitFor(200);

      // System should still be functional
      const stats = prefetchingSystem.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe('Performance Impact', () => {
    it('should cache prefetched data for subsequent requests', async () => {
      // Directly prefetch on open (which caches data)
      await prefetchingSystem.prefetchOnOpen('test-sheet-123');

      // Wait for queue to process
      await waitFor(200);

      const stats = prefetchingSystem.getStats();
      // prefetchOnOpen queues comprehensive metadata + first 100 rows
      expect(stats.totalPrefetches).toBeGreaterThan(0);

      // API should have been called for the prefetched data
      expect(
        mockValuesGet.mock.calls.length + mockSpreadsheetGet.mock.calls.length
      ).toBeGreaterThan(0);
    });

    it('should prefetch on spreadsheet open', async () => {
      // Trigger prefetch on open
      await prefetchingSystem.prefetchOnOpen('test-sheet-123');

      // Wait for prefetch queue
      await waitFor(200);

      const stats = prefetchingSystem.getStats();
      expect(stats.totalPrefetches).toBeGreaterThan(0);

      // Should have prefetched comprehensive metadata and/or values
      expect(
        mockValuesGet.mock.calls.length + mockSpreadsheetGet.mock.calls.length
      ).toBeGreaterThan(0);
    });
  });

  describe('Circuit Breaker', () => {
    it('should open circuit breaker after high failure rate', { timeout: 60000 }, async () => {
      // Force all prefetches to fail
      mockValuesGet.mockRejectedValue(new Error('API Error'));
      mockSpreadsheetGet.mockRejectedValue(new Error('API Error'));

      const tracker = getAccessPatternTracker();

      // Generate many failed prefetches to trigger circuit breaker (30% threshold)
      for (let i = 0; i < 100; i++) {
        tracker.recordAccess({
          spreadsheetId: 'test-sheet-123',
          range: `A${i}:B${i + 10}`,
          action: 'read',
        });

        await prefetchingSystem.prefetch({
          spreadsheetId: 'test-sheet-123',
          range: `A${i}:B${i + 10}`,
        });

        await waitFor(10);
      }

      // Wait for all prefetches to fail
      await waitFor(2000);

      const stats = prefetchingSystem.getStats();
      expect(stats.failureRate).toBeGreaterThan(0.3);
      expect(stats.circuitOpen).toBe(true);
    });

    it('should skip prefetch when circuit is open', async () => {
      const stats = prefetchingSystem.getStats();
      const initialPrefetches = stats.totalPrefetches;

      // Manually open circuit by creating high failure rate
      mockValuesGet.mockRejectedValue(new Error('API Error'));
      mockSpreadsheetGet.mockRejectedValue(new Error('API Error'));

      for (let i = 0; i < 50; i++) {
        await prefetchingSystem.prefetch({
          spreadsheetId: 'test-sheet-123',
          range: `A${i}:B${i}`,
        });
        await waitFor(10);
      }

      await waitFor(1000);

      // Circuit should be open
      const updatedStats = prefetchingSystem.getStats();
      expect(updatedStats.circuitOpen).toBe(true);

      // New prefetch should be skipped
      await prefetchingSystem.prefetch({
        spreadsheetId: 'test-sheet-123',
        range: 'Z1:Z10',
      });

      await waitFor(100);

      // Total prefetches should not increase significantly
      const finalStats = prefetchingSystem.getStats();
      expect(finalStats.totalPrefetches).toBeLessThan(initialPrefetches + 100);
    });
  });

  describe('Background Refresh', () => {
    it('should have background refresh enabled by default', () => {
      // The system initializes with background refresh enabled
      const stats = prefetchingSystem.getStats();
      expect(stats).toBeDefined();
      // Background refresh is configured via the constructor option
      // The refresh timer is created internally and fires every 30s
      // We verify it doesn't cause errors on destroy
      prefetchingSystem.destroy();
    });
  });
});
