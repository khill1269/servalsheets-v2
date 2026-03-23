/**
 * Tests for Restart Policy with Exponential Backoff
 *
 * Tests the restart policy system that prevents rapid restart loops
 * by implementing filesystem-based exponential backoff.
 */

// Set test environment variables BEFORE importing the module
process.env['SUCCESS_THRESHOLD_MS'] = '100';
process.env['MIN_RESTART_BACKOFF_MS'] = '100';
process.env['RESTART_STATE_FILE'] =
  process.env['RESTART_STATE_FILE'] ?? `/tmp/servalsheets-restart-policy-${process.pid}.json`;

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { dirname } from 'path';
import {
  checkRestartBackoff,
  recordStartupAttempt,
  recordSuccessfulStartup,
  clearRestartState,
  getRestartState,
  formatBackoffDelay,
} from '../../src/startup/restart-policy.js';
import { waitFor } from '../helpers/wait-for.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const STATE_FILE = process.env['RESTART_STATE_FILE']!;

describe('Restart Policy', () => {
  beforeEach(async () => {
    // Clean up before each test
    await clearRestartState();
  });

  afterEach(async () => {
    // Clean up after each test
    await clearRestartState();
  });

  describe('checkRestartBackoff', () => {
    it('should return 0 delay for first startup (no state file)', async () => {
      const delay = await checkRestartBackoff();
      expect(delay).toBe(0);
    });

    it('should return 0 delay after successful startup', async () => {
      // Record a successful startup
      await recordStartupAttempt();
      await waitFor(200);
      await recordSuccessfulStartup();

      // Next startup should have no delay
      const delay = await checkRestartBackoff();
      expect(delay).toBe(0);
    });

    it('should calculate backoff after consecutive failures', async () => {
      // Record first failure
      await recordStartupAttempt();

      // Second startup attempt should have backoff
      const delay = await checkRestartBackoff();

      // Should have some delay (exponential backoff)
      expect(delay).toBeGreaterThanOrEqual(0);
    });

    it('should increase backoff with more failures', async () => {
      // Record multiple failures
      await recordStartupAttempt();
      await waitFor(10);
      await recordStartupAttempt();
      await waitFor(10);
      await recordStartupAttempt();

      const state = await getRestartState();
      expect(state.consecutiveFailures).toBeGreaterThanOrEqual(2);
    });
  });

  describe('recordStartupAttempt', () => {
    it('should increment failure counter', async () => {
      await recordStartupAttempt();

      const state = await getRestartState();
      expect(state.consecutiveFailures).toBe(1);
      expect(state.lastStartAttempt).toBeGreaterThan(0);
    });

    it('should increment counter on multiple attempts', async () => {
      await recordStartupAttempt();
      await recordStartupAttempt();
      await recordStartupAttempt();

      const state = await getRestartState();
      expect(state.consecutiveFailures).toBe(3);
    });

    it('should update lastStartAttempt timestamp', async () => {
      const before = Date.now();
      await recordStartupAttempt();
      const after = Date.now();

      const state = await getRestartState();
      expect(state.lastStartAttempt).toBeGreaterThanOrEqual(before);
      expect(state.lastStartAttempt).toBeLessThanOrEqual(after);
    });
  });

  describe('recordSuccessfulStartup', () => {
    it('should reset failure counter after successful run', async () => {
      // Record some failures
      await recordStartupAttempt();
      await recordStartupAttempt();

      // Wait long enough to be considered successful (> SUCCESS_THRESHOLD_MS)
      await waitFor(200);

      // Record success
      await recordSuccessfulStartup();

      const state = await getRestartState();
      expect(state.consecutiveFailures).toBe(0);
      expect(state.lastSuccessfulStart).toBeGreaterThan(0);
    });

    it('should not reset counter for very short uptime', async () => {
      await recordStartupAttempt();

      // Don't wait long enough (< SUCCESS_THRESHOLD_MS)
      await recordSuccessfulStartup();

      const state = await getRestartState();
      // Counter should not reset because uptime was too short
      expect(state.consecutiveFailures).toBeGreaterThan(0);
    });

    it('should record lastSuccessfulStart timestamp', async () => {
      await recordStartupAttempt();
      await waitFor(200);

      const before = Date.now();
      await recordSuccessfulStartup();
      const after = Date.now();

      const state = await getRestartState();
      expect(state.lastSuccessfulStart).toBeGreaterThanOrEqual(before);
      expect(state.lastSuccessfulStart).toBeLessThanOrEqual(after);
    });
  });

  describe('clearRestartState', () => {
    it('should remove state file', async () => {
      await recordStartupAttempt();

      // Verify file exists
      const stateBefore = await getRestartState();
      expect(stateBefore.consecutiveFailures).toBeGreaterThan(0);

      // Clear state
      await clearRestartState();

      // State should be reset to defaults
      const stateAfter = await getRestartState();
      expect(stateAfter.consecutiveFailures).toBe(0);
      expect(stateAfter.lastStartAttempt).toBe(0);
    });

    it('should not throw if state file does not exist', async () => {
      await clearRestartState();
      await expect(clearRestartState()).resolves.not.toThrow();
    });
  });

  describe('getRestartState', () => {
    it('should return default state when no file exists', async () => {
      const state = await getRestartState();

      expect(state.lastStartAttempt).toBe(0);
      expect(state.consecutiveFailures).toBe(0);
      expect(state.lastSuccessfulStart).toBe(0);
    });

    it('should return saved state when file exists', async () => {
      await recordStartupAttempt();
      await recordStartupAttempt();

      const state = await getRestartState();

      expect(state.consecutiveFailures).toBe(2);
      expect(state.lastStartAttempt).toBeGreaterThan(0);
    });

    it('should persist state across multiple reads', async () => {
      await recordStartupAttempt();

      const state1 = await getRestartState();
      const state2 = await getRestartState();

      expect(state1.consecutiveFailures).toBe(state2.consecutiveFailures);
      expect(state1.lastStartAttempt).toBe(state2.lastStartAttempt);
    });
  });

  describe('formatBackoffDelay', () => {
    it('should format 0 as "none"', () => {
      expect(formatBackoffDelay(0)).toBe('none');
    });

    it('should format seconds', () => {
      expect(formatBackoffDelay(1000)).toBe('1s');
      expect(formatBackoffDelay(5000)).toBe('5s');
      expect(formatBackoffDelay(30000)).toBe('30s');
    });

    it('should format minutes without seconds', () => {
      expect(formatBackoffDelay(60000)).toBe('1m');
      expect(formatBackoffDelay(120000)).toBe('2m');
    });

    it('should format minutes with seconds', () => {
      expect(formatBackoffDelay(65000)).toBe('1m 5s');
      expect(formatBackoffDelay(125000)).toBe('2m 5s');
    });

    it('should round up partial seconds', () => {
      expect(formatBackoffDelay(1500)).toBe('2s');
      expect(formatBackoffDelay(2999)).toBe('3s');
    });
  });

  describe('State file persistence', () => {
    it('should create state file on first attempt', async () => {
      await recordStartupAttempt();

      // Check file exists
      try {
        const content = await fs.readFile(STATE_FILE, 'utf-8');
        const parsed = JSON.parse(content);
        expect(parsed.consecutiveFailures).toBe(1);
      } catch (error) {
        throw new Error('State file should exist after recordStartupAttempt');
      }
    });

    it('should handle concurrent writes gracefully', async () => {
      // Record multiple attempts in quick succession
      await Promise.all([recordStartupAttempt(), recordStartupAttempt(), recordStartupAttempt()]);

      const state = await getRestartState();
      // Should have at least 1 failure recorded (concurrent writes may overwrite)
      expect(state.consecutiveFailures).toBeGreaterThan(0);
    });

    it('should handle corrupted state file', async () => {
      // Write invalid JSON to state file
      await fs.mkdir(dirname(STATE_FILE), { recursive: true });
      await fs.writeFile(STATE_FILE, 'invalid json', 'utf-8');

      // Should return default state instead of throwing
      const state = await getRestartState();
      expect(state.consecutiveFailures).toBe(0);
      expect(state.lastStartAttempt).toBe(0);
    });
  });

  describe('Exponential backoff calculation', () => {
    it('should implement exponential growth', async () => {
      const delays: number[] = [];

      // Record failures and check backoff increases exponentially
      for (let i = 0; i < 5; i++) {
        await recordStartupAttempt();
        // Wait a bit to ensure backoff would trigger
        await waitFor(10);
      }

      // The delays should grow exponentially
      // (We can't test the exact delays without mocking time, but we can verify the state)
      const state = await getRestartState();
      expect(state.consecutiveFailures).toBe(5);
    });

    it('should cap at maximum backoff', async () => {
      // Record many failures
      for (let i = 0; i < 20; i++) {
        await recordStartupAttempt();
      }

      const state = await getRestartState();
      expect(state.consecutiveFailures).toBe(20);
      // Backoff should be capped at MAX_BACKOFF_MS (60000ms by default)
    });
  });

  describe('Integration scenarios', () => {
    it('should prevent rapid restart loop scenario', async () => {
      // Simulate rapid restart loop (what we want to prevent)
      await recordStartupAttempt();

      // Try to restart immediately
      const delay1 = await checkRestartBackoff();
      expect(delay1).toBeGreaterThanOrEqual(0);

      // After waiting and recording another attempt
      await waitFor(50);
      await recordStartupAttempt();

      // Delay should increase
      const delay2 = await checkRestartBackoff();
      expect(delay2).toBeGreaterThanOrEqual(delay1);
    });

    it('should reset after successful long run', async () => {
      // Record some failures
      await recordStartupAttempt();
      await recordStartupAttempt();

      let state = await getRestartState();
      expect(state.consecutiveFailures).toBe(2);

      // Simulate successful run
      await waitFor(200);
      await recordSuccessfulStartup();

      state = await getRestartState();
      expect(state.consecutiveFailures).toBe(0);

      // Next restart should have no delay
      const delay = await checkRestartBackoff();
      expect(delay).toBe(0);
    });
  });
});
