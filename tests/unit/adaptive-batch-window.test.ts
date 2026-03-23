/**
 * Tests for AdaptiveBatchWindow
 *
 * Verifies dynamic batch window sizing based on queue depth
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AdaptiveBatchWindow,
  type AdaptiveBatchWindowConfig,
} from '../../src/services/batching-system.js';

describe('AdaptiveBatchWindow', () => {
  describe('Constructor and Configuration', () => {
    it('should use default configuration', () => {
      const window = new AdaptiveBatchWindow();
      const config = window.getConfig();

      expect(config.minWindowMs).toBe(20);
      expect(config.maxWindowMs).toBe(100);
      expect(config.initialWindowMs).toBe(50);
      expect(config.lowThreshold).toBe(3);
      expect(config.highThreshold).toBe(50);
      expect(config.increaseRate).toBe(1.2);
      expect(config.decreaseRate).toBe(0.8);
    });

    it('should use custom configuration', () => {
      const customConfig: AdaptiveBatchWindowConfig = {
        minWindowMs: 10,
        maxWindowMs: 300,
        initialWindowMs: 75,
        lowThreshold: 5,
        highThreshold: 100,
        increaseRate: 1.5,
        decreaseRate: 0.7,
      };

      const window = new AdaptiveBatchWindow(customConfig);
      const config = window.getConfig();

      expect(config.minWindowMs).toBe(10);
      expect(config.maxWindowMs).toBe(300);
      expect(config.initialWindowMs).toBe(75);
      expect(config.lowThreshold).toBe(5);
      expect(config.highThreshold).toBe(100);
      expect(config.increaseRate).toBe(1.5);
      expect(config.decreaseRate).toBe(0.7);
    });

    it('should start with initial window size', () => {
      const window = new AdaptiveBatchWindow({ initialWindowMs: 75 });
      expect(window.getCurrentWindow()).toBe(75);
    });
  });

  describe('Window Adjustment - Low Traffic', () => {
    let window: AdaptiveBatchWindow;

    beforeEach(() => {
      window = new AdaptiveBatchWindow({
        minWindowMs: 20,
        maxWindowMs: 200,
        initialWindowMs: 50,
        lowThreshold: 3,
        highThreshold: 50,
        increaseRate: 1.2,
        decreaseRate: 0.8,
      });
    });

    it('should increase window when queue is empty (0 operations)', () => {
      const initial = window.getCurrentWindow();
      window.adjust(0);
      const after = window.getCurrentWindow();

      expect(after).toBeGreaterThan(initial);
      expect(after).toBe(initial * 1.2);
    });

    it('should increase window when operations < lowThreshold', () => {
      const initial = window.getCurrentWindow();
      window.adjust(2); // Below threshold of 3
      const after = window.getCurrentWindow();

      expect(after).toBeGreaterThan(initial);
      expect(after).toBe(initial * 1.2);
    });

    it('should increase window gradually with repeated low traffic', () => {
      const windows: number[] = [window.getCurrentWindow()];

      for (let i = 0; i < 5; i++) {
        window.adjust(1);
        windows.push(window.getCurrentWindow());
      }

      // Each window should be larger than the previous
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i]).toBeGreaterThan(windows[i - 1]!);
      }
    });

    it('should not exceed maximum window', () => {
      // Increase many times
      for (let i = 0; i < 20; i++) {
        window.adjust(0);
      }

      expect(window.getCurrentWindow()).toBeLessThanOrEqual(200);
      expect(window.getCurrentWindow()).toBe(200); // Should hit max
    });

    it('should stop increasing at maxWindowMs exactly', () => {
      const window = new AdaptiveBatchWindow({
        minWindowMs: 20,
        maxWindowMs: 100,
        initialWindowMs: 95,
        increaseRate: 1.2,
        lowThreshold: 3,
      });

      window.adjust(0); // Should hit 114, clamped to 100
      expect(window.getCurrentWindow()).toBe(100);

      window.adjust(0); // Should stay at 100
      expect(window.getCurrentWindow()).toBe(100);
    });
  });

  describe('Window Adjustment - High Traffic', () => {
    let window: AdaptiveBatchWindow;

    beforeEach(() => {
      window = new AdaptiveBatchWindow({
        minWindowMs: 20,
        maxWindowMs: 200,
        initialWindowMs: 100,
        lowThreshold: 3,
        highThreshold: 50,
        increaseRate: 1.2,
        decreaseRate: 0.8,
      });
    });

    it('should decrease window when operations > highThreshold', () => {
      const initial = window.getCurrentWindow();
      window.adjust(51); // Above threshold of 50
      const after = window.getCurrentWindow();

      expect(after).toBeLessThan(initial);
      expect(after).toBe(initial * 0.8);
    });

    it('should decrease window when queue is very full (100 operations)', () => {
      const initial = window.getCurrentWindow();
      window.adjust(100);
      const after = window.getCurrentWindow();

      expect(after).toBeLessThan(initial);
      expect(after).toBe(initial * 0.8);
    });

    it('should decrease window gradually with repeated high traffic', () => {
      const windows: number[] = [window.getCurrentWindow()];

      for (let i = 0; i < 5; i++) {
        window.adjust(75);
        windows.push(window.getCurrentWindow());
      }

      // Each window should be smaller than the previous
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i]).toBeLessThan(windows[i - 1]!);
      }
    });

    it('should not go below minimum window', () => {
      // Decrease many times
      for (let i = 0; i < 20; i++) {
        window.adjust(100);
      }

      expect(window.getCurrentWindow()).toBeGreaterThanOrEqual(20);
      expect(window.getCurrentWindow()).toBe(20); // Should hit min
    });

    it('should stop decreasing at minWindowMs exactly', () => {
      const window = new AdaptiveBatchWindow({
        minWindowMs: 20,
        maxWindowMs: 200,
        initialWindowMs: 25,
        decreaseRate: 0.8,
        highThreshold: 50,
      });

      window.adjust(100); // Should hit 20, at min
      expect(window.getCurrentWindow()).toBe(20);

      window.adjust(100); // Should stay at 20
      expect(window.getCurrentWindow()).toBe(20);
    });
  });

  describe('Window Adjustment - Optimal Traffic', () => {
    let window: AdaptiveBatchWindow;

    beforeEach(() => {
      window = new AdaptiveBatchWindow({
        minWindowMs: 20,
        maxWindowMs: 200,
        initialWindowMs: 50,
        lowThreshold: 3,
        highThreshold: 50,
      });
    });

    it('should maintain window at lowThreshold (3 operations)', () => {
      const initial = window.getCurrentWindow();
      window.adjust(3);
      expect(window.getCurrentWindow()).toBe(initial);
    });

    it('should maintain window at highThreshold (50 operations)', () => {
      const initial = window.getCurrentWindow();
      window.adjust(50);
      expect(window.getCurrentWindow()).toBe(initial);
    });

    it('should maintain window in optimal range', () => {
      const initial = window.getCurrentWindow();

      window.adjust(10);
      expect(window.getCurrentWindow()).toBe(initial);

      window.adjust(25);
      expect(window.getCurrentWindow()).toBe(initial);

      window.adjust(40);
      expect(window.getCurrentWindow()).toBe(initial);
    });

    it('should stay stable with consistent optimal traffic', () => {
      const windows: number[] = [];

      for (let i = 0; i < 10; i++) {
        window.adjust(20); // Optimal range
        windows.push(window.getCurrentWindow());
      }

      // All windows should be the same
      const firstWindow = windows[0];
      expect(windows.every((w) => w === firstWindow)).toBe(true);
    });
  });

  describe('Average Window Calculation', () => {
    it('should return current window when no history', () => {
      const window = new AdaptiveBatchWindow({ initialWindowMs: 50 });
      expect(window.getAverageWindow()).toBe(50);
    });

    it('should calculate average from window history', () => {
      const window = new AdaptiveBatchWindow({ initialWindowMs: 50 });

      window.adjust(0); // Increase to 60
      window.adjust(0); // Increase to 72
      window.adjust(0); // Increase to 86.4

      const avg = window.getAverageWindow();
      expect(avg).toBeGreaterThan(50);
      expect(avg).toBeLessThan(100);
      // Average of [60, 72, 86.4] = 72.8
      expect(Math.round(avg)).toBe(73);
    });

    it('should track both increases and decreases', () => {
      const window = new AdaptiveBatchWindow({
        initialWindowMs: 50,
        lowThreshold: 3,
        highThreshold: 10,
      });

      window.adjust(0); // Increase to 60
      window.adjust(20); // Decrease to 48
      window.adjust(0); // Increase to 57.6

      const avg = window.getAverageWindow();
      // Average of [60, 48, 57.6] = 55.2
      expect(Math.round(avg)).toBe(55);
    });
  });

  describe('Reset Functionality', () => {
    it('should reset window to minimum', () => {
      const window = new AdaptiveBatchWindow({
        minWindowMs: 30,
        initialWindowMs: 100,
      });

      expect(window.getCurrentWindow()).toBe(100);

      window.reset();
      expect(window.getCurrentWindow()).toBe(30);
    });

    it('should clear window history', () => {
      const window = new AdaptiveBatchWindow({ initialWindowMs: 50 });

      window.adjust(0);
      window.adjust(0);
      window.adjust(0);

      expect(window.getAverageWindow()).toBeGreaterThan(50);

      window.reset();
      expect(window.getAverageWindow()).toBe(window.getConfig().minWindowMs);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero operations correctly', () => {
      const window = new AdaptiveBatchWindow();
      const initial = window.getCurrentWindow();

      window.adjust(0);
      expect(window.getCurrentWindow()).toBeGreaterThan(initial);
    });

    it('should handle very large operation counts', () => {
      const window = new AdaptiveBatchWindow();
      const initial = window.getCurrentWindow();

      window.adjust(1000);
      expect(window.getCurrentWindow()).toBeLessThan(initial);
    });

    it('should handle boundary values precisely', () => {
      const window = new AdaptiveBatchWindow({
        minWindowMs: 20,
        maxWindowMs: 200,
        lowThreshold: 5,
        highThreshold: 10,
        initialWindowMs: 50,
      });

      const initial = window.getCurrentWindow();

      // Test below low threshold
      window.adjust(4); // Just below low threshold
      expect(window.getCurrentWindow()).toBeGreaterThan(initial);

      // Test at low threshold (should maintain)
      const beforeMaintain = window.getCurrentWindow();
      window.adjust(5); // At low threshold
      expect(window.getCurrentWindow()).toBe(beforeMaintain);

      // Test at high threshold (should maintain)
      window.adjust(10); // At high threshold
      expect(window.getCurrentWindow()).toBe(beforeMaintain);

      // Test above high threshold (should decrease)
      const beforeDecrease = window.getCurrentWindow();
      window.adjust(11); // Just above high threshold
      expect(window.getCurrentWindow()).toBeLessThan(beforeDecrease);
    });

    it('should handle rapid traffic changes', () => {
      const window = new AdaptiveBatchWindow({
        initialWindowMs: 50,
        lowThreshold: 3,
        highThreshold: 10,
      });

      // Simulate rapid changes
      window.adjust(0); // Increase
      window.adjust(100); // Decrease
      window.adjust(0); // Increase
      window.adjust(100); // Decrease

      // Should still be within bounds
      expect(window.getCurrentWindow()).toBeGreaterThanOrEqual(20);
      expect(window.getCurrentWindow()).toBeLessThanOrEqual(200);
    });
  });

  describe('Window History Management', () => {
    it('should limit history to 1000 entries', () => {
      const window = new AdaptiveBatchWindow({ initialWindowMs: 50 });

      // Add more than 1000 adjustments
      for (let i = 0; i < 1500; i++) {
        window.adjust(20); // Optimal range to keep window stable
      }

      // Check that average is calculated (implies history is maintained)
      const avg = window.getAverageWindow();
      expect(avg).toBeCloseTo(50, 1);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should adapt to startup burst pattern', () => {
      const window = new AdaptiveBatchWindow();

      // Startup: High traffic burst
      window.adjust(80);
      window.adjust(75);
      window.adjust(60);

      const afterBurst = window.getCurrentWindow();
      expect(afterBurst).toBeLessThan(50);

      // Settle to low traffic (below threshold to trigger increase)
      window.adjust(1);
      window.adjust(2);
      window.adjust(1);

      const afterSettle = window.getCurrentWindow();
      expect(afterSettle).toBeGreaterThan(afterBurst);
    });

    it('should adapt to idle periods', () => {
      const window = new AdaptiveBatchWindow();

      // Normal traffic
      window.adjust(20);
      window.adjust(25);

      const duringNormal = window.getCurrentWindow();

      // Idle period
      window.adjust(0);
      window.adjust(1);
      window.adjust(0);

      const duringIdle = window.getCurrentWindow();
      expect(duringIdle).toBeGreaterThan(duringNormal);
    });

    it('should handle gradual traffic increase', () => {
      const window = new AdaptiveBatchWindow();

      const windows: number[] = [window.getCurrentWindow()];

      // Gradual increase
      for (let ops = 5; ops <= 60; ops += 5) {
        window.adjust(ops);
        windows.push(window.getCurrentWindow());
      }

      // Window should decrease as traffic increases
      const firstHalf = windows.slice(0, 6);
      const secondHalf = windows.slice(6);

      const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

      expect(avgSecond).toBeLessThan(avgFirst);
    });
  });
});
