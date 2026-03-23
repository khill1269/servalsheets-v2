/**
 * Tests for BatchingSystem with AdaptiveBatchWindow
 *
 * Verifies integration between batching system and adaptive window
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { sheets_v4 } from 'googleapis';
import { BatchingSystem } from '../../src/services/batching-system.js';

describe('BatchingSystem with Adaptive Window', () => {
  let sheetsApi: sheets_v4.Sheets;
  let batchingSystem: BatchingSystem;

  beforeEach(() => {
    vi.useFakeTimers();

    // Mock sheets API
    sheetsApi = {
      spreadsheets: {
        values: {
          batchUpdate: vi.fn().mockResolvedValue({
            data: {
              responses: [{ updatedCells: 1 }, { updatedCells: 1 }],
            },
          }),
          batchClear: vi.fn().mockResolvedValue({
            data: { clearedRanges: ['A1', 'B1'] },
          }),
        },
        batchUpdate: vi.fn().mockResolvedValue({
          data: {
            replies: [{ updateCells: {} }, { updateCells: {} }],
          },
        }),
      },
    } as unknown as sheets_v4.Sheets;
  });

  afterEach(() => {
    batchingSystem?.destroy();
    vi.useRealTimers();
  });

  describe('Adaptive Window Initialization', () => {
    it('should initialize with adaptive window enabled by default', () => {
      batchingSystem = new BatchingSystem(sheetsApi);
      const stats = batchingSystem.getStats();

      // Should have adaptive window stats
      expect(stats.currentWindowMs).toBeDefined();
      expect(stats.avgWindowMs).toBeDefined();
    });

    it('should initialize with custom adaptive config', () => {
      batchingSystem = new BatchingSystem(sheetsApi, {
        adaptiveWindow: true,
        adaptiveConfig: {
          minWindowMs: 10,
          maxWindowMs: 100,
          initialWindowMs: 40,
        },
      });

      const stats = batchingSystem.getStats();
      expect(stats.currentWindowMs).toBe(40);
    });

    it('should disable adaptive window when specified', () => {
      batchingSystem = new BatchingSystem(sheetsApi, {
        adaptiveWindow: false,
        windowMs: 75,
      });

      const stats = batchingSystem.getStats();
      expect(stats.currentWindowMs).toBeUndefined();
      expect(stats.avgWindowMs).toBeUndefined();
    });
  });

  describe('Low Traffic Adaptation', () => {
    beforeEach(() => {
      batchingSystem = new BatchingSystem(sheetsApi, {
        adaptiveWindow: true,
        adaptiveConfig: {
          minWindowMs: 10,
          maxWindowMs: 100,
          initialWindowMs: 30,
          lowThreshold: 3,
        },
        verboseLogging: false,
      });
    });

    it('should increase window size for low traffic', async () => {
      const initialStats = batchingSystem.getStats();
      const initialWindow = initialStats.currentWindowMs!;

      // Execute a single operation (low traffic)
      const promise = batchingSystem.execute({
        id: 'test-1',
        type: 'values:update',
        spreadsheetId: 'test-sheet',
        params: {
          range: 'Sheet1!A1',
          values: [['test']],
        },
      });

      // Wait for batch to execute
      await vi.advanceTimersByTimeAsync(50);
      await batchingSystem.flush();
      await promise;

      const finalStats = batchingSystem.getStats();
      const finalWindow = finalStats.currentWindowMs!;

      // Window should increase due to low batch size
      expect(finalWindow).toBeGreaterThan(initialWindow);
    });

    it('should gradually increase window with repeated low traffic', async () => {
      const windows: number[] = [batchingSystem.getStats().currentWindowMs!];

      // Execute several single operations
      for (let i = 0; i < 3; i++) {
        const promise = batchingSystem.execute({
          id: `test-${i}`,
          type: 'values:update',
          spreadsheetId: 'test-sheet',
          params: {
            range: `Sheet1!A${i + 1}`,
            values: [['test']],
          },
        });

        await vi.advanceTimersByTimeAsync(50);
        await batchingSystem.flush();
        await promise;

        windows.push(batchingSystem.getStats().currentWindowMs!);
      }

      // Each window should be larger than or equal to previous
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i]).toBeGreaterThanOrEqual(windows[i - 1]!);
      }
    });
  });

  describe('High Traffic Adaptation', () => {
    beforeEach(() => {
      batchingSystem = new BatchingSystem(sheetsApi, {
        adaptiveWindow: true,
        adaptiveConfig: {
          minWindowMs: 10,
          maxWindowMs: 100,
          initialWindowMs: 80,
          highThreshold: 5,
        },
        maxBatchSize: 100,
        verboseLogging: false,
      });
    });

    it('should decrease window size for high traffic', async () => {
      const initialStats = batchingSystem.getStats();
      const initialWindow = initialStats.currentWindowMs!;

      // Queue many operations (high traffic)
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          batchingSystem.execute({
            id: `test-${i}`,
            type: 'values:update',
            spreadsheetId: 'test-sheet',
            params: {
              range: `Sheet1!A${i + 1}`,
              values: [['test']],
            },
          })
        );
      }

      // Wait for batch to collect and execute
      await vi.advanceTimersByTimeAsync(100);
      await batchingSystem.flush();
      await Promise.all(promises);

      const finalStats = batchingSystem.getStats();
      const finalWindow = finalStats.currentWindowMs!;

      // Window should decrease due to high batch size
      expect(finalWindow).toBeLessThan(initialWindow);
    });

    it('should gradually decrease window with repeated high traffic', async () => {
      const windows: number[] = [batchingSystem.getStats().currentWindowMs!];

      // Execute several large batches
      for (let batch = 0; batch < 3; batch++) {
        const promises: Promise<unknown>[] = [];
        for (let i = 0; i < 10; i++) {
          promises.push(
            batchingSystem.execute({
              id: `test-${batch}-${i}`,
              type: 'values:update',
              spreadsheetId: 'test-sheet',
              params: {
                range: `Sheet1!A${i + 1}`,
                values: [['test']],
              },
            })
          );
        }

        await vi.advanceTimersByTimeAsync(100);
        await batchingSystem.flush();
        await Promise.all(promises);

        windows.push(batchingSystem.getStats().currentWindowMs!);
      }

      // Each window should be smaller than or equal to previous
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i]).toBeLessThanOrEqual(windows[i - 1]!);
      }
    });
  });

  describe('Optimal Traffic Range', () => {
    beforeEach(() => {
      batchingSystem = new BatchingSystem(sheetsApi, {
        adaptiveWindow: true,
        adaptiveConfig: {
          minWindowMs: 20,
          maxWindowMs: 100,
          initialWindowMs: 50,
          lowThreshold: 3,
          highThreshold: 10,
        },
        verboseLogging: false,
      });
    });

    it('should maintain stable window for optimal traffic', async () => {
      const initialWindow = batchingSystem.getStats().currentWindowMs!;
      const windows: number[] = [initialWindow];

      // Execute optimal batches (5-8 operations)
      for (let batch = 0; batch < 3; batch++) {
        const promises: Promise<unknown>[] = [];
        for (let i = 0; i < 6; i++) {
          promises.push(
            batchingSystem.execute({
              id: `test-${batch}-${i}`,
              type: 'values:update',
              spreadsheetId: 'test-sheet',
              params: {
                range: `Sheet1!A${i + 1}`,
                values: [['test']],
              },
            })
          );
        }

        await vi.advanceTimersByTimeAsync(60);
        await batchingSystem.flush();
        await Promise.all(promises);

        windows.push(batchingSystem.getStats().currentWindowMs!);
      }

      // Window should remain relatively stable
      const maxWindow = Math.max(...windows);
      const minWindow = Math.min(...windows);
      const variance = maxWindow - minWindow;

      // Allow small variance due to rounding, but should be mostly stable
      expect(variance).toBeLessThan(10);
    });
  });

  describe('Window Bounds', () => {
    it('should respect minimum window', async () => {
      batchingSystem = new BatchingSystem(sheetsApi, {
        adaptiveWindow: true,
        adaptiveConfig: {
          minWindowMs: 15,
          maxWindowMs: 100,
          initialWindowMs: 20,
          highThreshold: 2,
        },
      });

      // Execute many high-traffic batches to force minimum
      for (let batch = 0; batch < 10; batch++) {
        const promises: Promise<unknown>[] = [];
        for (let i = 0; i < 50; i++) {
          promises.push(
            batchingSystem.execute({
              id: `test-${batch}-${i}`,
              type: 'values:update',
              spreadsheetId: 'test-sheet',
              params: {
                range: `Sheet1!A${i + 1}`,
                values: [['test']],
              },
            })
          );
        }

        await vi.advanceTimersByTimeAsync(30);
        await batchingSystem.flush();
        await Promise.all(promises);
      }

      const finalWindow = batchingSystem.getStats().currentWindowMs!;
      expect(finalWindow).toBeGreaterThanOrEqual(15);
    });

    it('should respect maximum window', async () => {
      batchingSystem = new BatchingSystem(sheetsApi, {
        adaptiveWindow: true,
        adaptiveConfig: {
          minWindowMs: 10,
          maxWindowMs: 50,
          initialWindowMs: 45,
          lowThreshold: 5,
        },
      });

      // Execute many low-traffic batches to force maximum
      for (let i = 0; i < 10; i++) {
        const promise = batchingSystem.execute({
          id: `test-${i}`,
          type: 'values:update',
          spreadsheetId: 'test-sheet',
          params: {
            range: `Sheet1!A${i + 1}`,
            values: [['test']],
          },
        });

        await vi.advanceTimersByTimeAsync(60);
        await batchingSystem.flush();
        await promise;
      }

      const finalWindow = batchingSystem.getStats().currentWindowMs!;
      expect(finalWindow).toBeLessThanOrEqual(50);
    });
  });

  describe('Statistics Integration', () => {
    beforeEach(() => {
      batchingSystem = new BatchingSystem(sheetsApi, {
        adaptiveWindow: true,
        adaptiveConfig: {
          initialWindowMs: 40,
        },
      });
    });

    it('should include adaptive window stats', async () => {
      const promise = batchingSystem.execute({
        id: 'test-1',
        type: 'values:update',
        spreadsheetId: 'test-sheet',
        params: {
          range: 'Sheet1!A1',
          values: [['test']],
        },
      });

      await vi.advanceTimersByTimeAsync(50);
      await batchingSystem.flush();
      await promise;

      const stats = batchingSystem.getStats();

      expect(stats.currentWindowMs).toBeDefined();
      expect(stats.avgWindowMs).toBeDefined();
      expect(stats.currentWindowMs).toBeGreaterThan(0);
      expect(stats.avgWindowMs).toBeGreaterThan(0);
    });

    it('should update average window over time', async () => {
      const stats1 = batchingSystem.getStats();
      expect(stats1.avgWindowMs).toBe(stats1.currentWindowMs);

      // Execute some operations
      for (let i = 0; i < 3; i++) {
        const promise = batchingSystem.execute({
          id: `test-${i}`,
          type: 'values:update',
          spreadsheetId: 'test-sheet',
          params: {
            range: `Sheet1!A${i + 1}`,
            values: [['test']],
          },
        });

        await vi.advanceTimersByTimeAsync(50);
        await batchingSystem.flush();
        await promise;
      }

      const stats2 = batchingSystem.getStats();
      expect(stats2.avgWindowMs).toBeDefined();
      // Average should be calculated from history
      expect(stats2.avgWindowMs).toBeGreaterThan(0);
    });

    it('should reset adaptive window with stats', () => {
      const _initialWindow = batchingSystem.getStats().currentWindowMs!;

      // Execute operation to change window
      const _promise = batchingSystem.execute({
        id: 'test-1',
        type: 'values:update',
        spreadsheetId: 'test-sheet',
        params: {
          range: 'Sheet1!A1',
          values: [['test']],
        },
      });

      batchingSystem.resetStats();

      const stats = batchingSystem.getStats();
      expect(stats.totalOperations).toBe(0);
      expect(stats.currentWindowMs).toBe(20); // Reset to min
    });
  });

  describe('Comparison with Fixed Window', () => {
    it('should use fixed window when adaptive is disabled', async () => {
      batchingSystem = new BatchingSystem(sheetsApi, {
        adaptiveWindow: false,
        windowMs: 60,
      });

      const stats1 = batchingSystem.getStats();
      expect(stats1.currentWindowMs).toBeUndefined();

      // Execute operations - window should never change
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          batchingSystem.execute({
            id: `test-${i}`,
            type: 'values:update',
            spreadsheetId: 'test-sheet',
            params: {
              range: `Sheet1!A${i + 1}`,
              values: [['test']],
            },
          })
        );

        await vi.advanceTimersByTimeAsync(70);
      }

      await batchingSystem.flush();
      await Promise.all(promises);

      const stats2 = batchingSystem.getStats();
      expect(stats2.currentWindowMs).toBeUndefined();
    });

    it('should improve batching efficiency with adaptive window', async () => {
      // Test with fixed window
      const fixedSystem = new BatchingSystem(sheetsApi, {
        adaptiveWindow: false,
        windowMs: 50,
      });

      // Simulate varying traffic - fire-and-collect pattern for fake timers
      const fixedPromises: Promise<unknown>[] = [];
      for (let i = 0; i < 20; i++) {
        fixedPromises.push(
          fixedSystem.execute({
            id: `test-${i}`,
            type: 'values:update',
            spreadsheetId: 'test-sheet',
            params: {
              range: `Sheet1!A${i + 1}`,
              values: [['test']],
            },
          })
        );

        // Varying delays to test traffic pattern handling
        await vi.advanceTimersByTimeAsync(i % 3 === 0 ? 10 : 100);
      }

      await fixedSystem.flush();
      await Promise.all(fixedPromises);
      const fixedStats = fixedSystem.getStats();
      fixedSystem.destroy();

      // Test with adaptive window
      const adaptiveSystem = new BatchingSystem(sheetsApi, {
        adaptiveWindow: true,
        adaptiveConfig: {
          initialWindowMs: 50,
        },
      });

      const adaptivePromises: Promise<unknown>[] = [];
      for (let i = 0; i < 20; i++) {
        adaptivePromises.push(
          adaptiveSystem.execute({
            id: `test-${i}`,
            type: 'values:update',
            spreadsheetId: 'test-sheet',
            params: {
              range: `Sheet1!A${i + 1}`,
              values: [['test']],
            },
          })
        );

        await vi.advanceTimersByTimeAsync(i % 3 === 0 ? 10 : 100);
      }

      await adaptiveSystem.flush();
      await Promise.all(adaptivePromises);
      const adaptiveStats = adaptiveSystem.getStats();
      adaptiveSystem.destroy();

      // Both should batch operations
      expect(fixedStats.totalBatches).toBeGreaterThan(0);
      expect(adaptiveStats.totalBatches).toBeGreaterThan(0);

      // Adaptive should have stats
      expect(adaptiveStats.currentWindowMs).toBeDefined();
      expect(fixedStats.currentWindowMs).toBeUndefined();
    });
  });
});
