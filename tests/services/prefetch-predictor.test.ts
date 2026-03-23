/**
 * Prefetch Predictor Service Tests (Phase 3.2)
 *
 * Tests for PrefetchPredictor service
 * Covers pattern learning, prediction generation, and prefetching
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrefetchPredictor } from '../../src/services/prefetch-predictor.js';
import type { PrefetchPrediction } from '../../src/services/prefetch-predictor.js';

// Mock dependencies at module level
vi.mock('../../src/services/history-service.js', () => ({
  getHistoryService: () => ({
    getRecent: () => [],
  }),
}));

vi.mock('../../src/services/parallel-executor.js', () => ({
  getParallelExecutor: () => ({
    executeAll: async (tasks: Array<{ fn: () => Promise<unknown> }>) =>
      tasks.map(() => ({
        success: true,
        result: { success: true, prediction: {}, duration: 10 },
      })),
  }),
}));

describe('PrefetchPredictor', () => {
  let predictor: PrefetchPredictor;

  beforeEach(() => {
    predictor = new PrefetchPredictor({
      verboseLogging: false,
      minConfidence: 0.5,
      maxPredictions: 5,
      enablePrefetch: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const defaultPredictor = new PrefetchPredictor();

      expect(defaultPredictor).toBeDefined();
      const stats = defaultPredictor.getStats() as {
        totalPredictions: number;
        correctPredictions: number;
      };
      expect(stats.totalPredictions).toBe(0);
      expect(stats.correctPredictions).toBe(0);
    });

    it('should initialize with custom options', () => {
      const customPredictor = new PrefetchPredictor({
        verboseLogging: true,
        minConfidence: 0.7,
        maxPredictions: 3,
        enablePrefetch: false,
      });

      expect(customPredictor).toBeDefined();
    });
  });

  describe('learnFromHistory', () => {
    it('should complete without errors', () => {
      // With mocked empty history, learning should succeed
      expect(() => predictor.learnFromHistory()).not.toThrow();
    });
  });

  describe('predict', () => {
    it('should return empty array when no history', () => {
      const predictions = predictor.predict();

      expect(predictions).toEqual([]);
    });

    it('should return array', () => {
      predictor.learnFromHistory();
      const predictions = predictor.predict();

      expect(Array.isArray(predictions)).toBe(true);
    });
  });

  describe('prefetchInBackground', () => {
    it('should execute predictions in background', async () => {
      const mockPredictions: PrefetchPrediction[] = [
        {
          tool: 'sheets_data',
          action: 'read',
          params: { range: 'Sheet1!A1:A10' },
          confidence: 0.8,
          reason: 'Sequential pattern',
          priority: 5,
        },
      ];

      const mockExecutor = vi.fn().mockResolvedValue(undefined);

      const results = await predictor.prefetchInBackground(mockPredictions, mockExecutor);

      expect(Array.isArray(results)).toBe(true);
      expect(mockExecutor).toHaveBeenCalledWith(mockPredictions[0]);
    });

    it('should return empty array when prefetch disabled', async () => {
      const disabledPredictor = new PrefetchPredictor({
        enablePrefetch: false,
      });

      const mockPredictions: PrefetchPrediction[] = [
        {
          tool: 'sheets_data',
          action: 'read',
          params: { range: 'Sheet1!A1:A10' },
          confidence: 0.8,
          reason: 'Sequential pattern',
          priority: 5,
        },
      ];

      const mockExecutor = vi.fn();

      const results = await disabledPredictor.prefetchInBackground(mockPredictions, mockExecutor);

      expect(results).toEqual([]);
      expect(mockExecutor).not.toHaveBeenCalled();
    });

    it('should return empty array when no predictions', async () => {
      const mockExecutor = vi.fn();

      const results = await predictor.prefetchInBackground([], mockExecutor);

      expect(results).toEqual([]);
      expect(mockExecutor).not.toHaveBeenCalled();
    });

    it('should track prefetch statistics', async () => {
      const mockPredictions: PrefetchPrediction[] = [
        {
          tool: 'sheets_data',
          action: 'read',
          params: { range: 'Sheet1!A1:A10' },
          confidence: 0.8,
          reason: 'Sequential pattern',
          priority: 5,
        },
      ];

      const mockExecutor = vi.fn().mockResolvedValue(undefined);

      await predictor.prefetchInBackground(mockPredictions, mockExecutor);

      const stats = predictor.getStats() as {
        totalPrefetches: number;
        successfulPrefetches: number;
      };
      expect(stats.totalPrefetches).toBeGreaterThan(0);
    });
  });

  describe('recordPredictionAccuracy', () => {
    it('should record correct predictions', () => {
      predictor.recordPredictionAccuracy(true);

      const stats = predictor.getStats() as {
        correctPredictions: number;
      };
      expect(stats.correctPredictions).toBe(1);
    });

    it('should handle incorrect predictions', () => {
      predictor.recordPredictionAccuracy(false);

      const stats = predictor.getStats() as {
        correctPredictions: number;
      };
      expect(stats.correctPredictions).toBe(0);
    });

    it('should accumulate accuracy over multiple predictions', () => {
      predictor.recordPredictionAccuracy(true);
      predictor.recordPredictionAccuracy(true);
      predictor.recordPredictionAccuracy(false);
      predictor.recordPredictionAccuracy(true);

      const stats = predictor.getStats() as {
        correctPredictions: number;
      };
      expect(stats.correctPredictions).toBe(3);
    });
  });

  describe('getStats', () => {
    it('should return statistics object', () => {
      const stats = predictor.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats).toBe('object');
    });

    it('should include prediction statistics', () => {
      const stats = predictor.getStats() as {
        totalPredictions: number;
        correctPredictions: number;
      };

      expect('totalPredictions' in stats).toBe(true);
      expect('correctPredictions' in stats).toBe(true);
      expect(typeof stats.totalPredictions).toBe('number');
      expect(typeof stats.correctPredictions).toBe('number');
    });

    it('should include prefetch statistics', () => {
      const stats = predictor.getStats() as {
        totalPrefetches: number;
        successfulPrefetches: number;
      };

      expect('totalPrefetches' in stats).toBe(true);
      expect('successfulPrefetches' in stats).toBe(true);
      expect(typeof stats.totalPrefetches).toBe('number');
      expect(typeof stats.successfulPrefetches).toBe('number');
    });

    it('should show updated stats after operations', () => {
      const initialStats = predictor.getStats() as {
        correctPredictions: number;
      };
      const initialCorrect = initialStats.correctPredictions;

      predictor.recordPredictionAccuracy(true);

      const updatedStats = predictor.getStats() as {
        correctPredictions: number;
      };
      expect(updatedStats.correctPredictions).toBe(initialCorrect + 1);
    });
  });

  describe('integration', () => {
    it('should work end-to-end: learn, predict, prefetch', async () => {
      // Step 1: Learn from history (mocked as empty)
      predictor.learnFromHistory();

      // Step 2: Generate predictions
      const predictions = predictor.predict();

      // Step 3: Execute prefetch
      const mockExecutor = vi.fn().mockResolvedValue(undefined);
      const results = await predictor.prefetchInBackground(predictions, mockExecutor);

      // Step 4: Check statistics
      const stats = predictor.getStats();

      expect(stats).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle complete workflow with empty history', async () => {
      // Complete workflow should work even with no learned patterns
      predictor.learnFromHistory();
      const predictions = predictor.predict();
      const mockExecutor = vi.fn().mockResolvedValue(undefined);
      await predictor.prefetchInBackground(predictions, mockExecutor);

      // Record some accuracy
      predictor.recordPredictionAccuracy(true);
      predictor.recordPredictionAccuracy(false);

      const stats = predictor.getStats() as {
        correctPredictions: number;
        totalPredictions: number;
      };

      expect(stats.correctPredictions).toBe(1);
      expect(typeof stats.totalPredictions).toBe('number');
    });
  });

  describe('edge cases', () => {
    it('should handle high minimum confidence threshold', () => {
      const strictPredictor = new PrefetchPredictor({
        minConfidence: 0.99,
      });

      strictPredictor.learnFromHistory();
      const predictions = strictPredictor.predict();

      // With very high confidence, likely no predictions
      expect(Array.isArray(predictions)).toBe(true);
      predictions.forEach((pred) => {
        expect(pred.confidence).toBeGreaterThanOrEqual(0.99);
      });
    });

    it('should handle zero maxPredictions', () => {
      const noPredictionsPredictor = new PrefetchPredictor({
        maxPredictions: 0,
      });

      noPredictionsPredictor.learnFromHistory();
      const predictions = noPredictionsPredictor.predict();

      expect(predictions).toHaveLength(0);
    });

    it('should handle verbose logging without errors', () => {
      const verbosePredictor = new PrefetchPredictor({
        verboseLogging: true,
      });

      expect(() => verbosePredictor.learnFromHistory()).not.toThrow();
      expect(() => verbosePredictor.predict()).not.toThrow();
    });
  });
});
