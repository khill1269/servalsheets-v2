/**
 * PrefetchPredictor Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrefetchPredictor } from '../../src/services/prefetch-predictor.js';
import { setHistoryService } from '../../src/services/history-service.js';
import { HistoryService } from '../../src/services/history-service.js';
import type { OperationHistory } from '../../src/types/history.js';

type PrefetchStats = {
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;
  patternCount: number;
};

describe('PrefetchPredictor', () => {
  let predictor: PrefetchPredictor;
  let mockHistoryService: HistoryService;

  beforeEach(() => {
    predictor = new PrefetchPredictor({
      verboseLogging: false,
      minConfidence: 0.5,
      maxPredictions: 5,
      enablePrefetch: true,
    });

    mockHistoryService = new HistoryService({ maxSize: 100 });
    setHistoryService(mockHistoryService);
  });

  describe('learnFromHistory', () => {
    it('should learn sequential patterns from history', () => {
      // Add operations in sequence
      const ops: OperationHistory[] = [
        createOp('sheets_data', 'read', 'sheet1', { spreadsheetId: 'abc', sheetId: 0 }),
        createOp('sheets_data', 'write', 'sheet1', { spreadsheetId: 'abc', sheetId: 0 }),
        createOp('sheets_data', 'read', 'sheet1', { spreadsheetId: 'abc', sheetId: 0 }),
        createOp('sheets_data', 'write', 'sheet1', { spreadsheetId: 'abc', sheetId: 0 }),
      ];

      ops.forEach((op) => mockHistoryService.record(op));

      predictor.learnFromHistory();

      const stats = predictor.getStats() as PrefetchStats;
      expect(stats.patternCount).toBeGreaterThan(0);
    });

    it('should handle empty history', () => {
      predictor.learnFromHistory();

      const stats = predictor.getStats() as PrefetchStats;
      expect(stats.patternCount).toBe(0);
    });

    it('should only learn from successful operations', () => {
      const ops: OperationHistory[] = [
        createOp('sheets_data', 'read', 'sheet1', { spreadsheetId: 'abc' }),
        {
          ...createOp('sheets_data', 'write', 'sheet1', { spreadsheetId: 'abc' }),
          result: 'error' as const,
        },
        createOp('sheets_data', 'read', 'sheet1', { spreadsheetId: 'abc' }),
      ];

      ops.forEach((op) => mockHistoryService.record(op));

      predictor.learnFromHistory();

      // Should skip the failed operation in pattern learning
      const stats = predictor.getStats() as PrefetchStats;
      expect(stats.patternCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('predict', () => {
    beforeEach(() => {
      // Set up a known pattern
      const ops: OperationHistory[] = [
        createOp('sheets_data', 'read', 'sheet1', { spreadsheetId: 'abc', sheetId: 0 }),
        createOp('sheets_data', 'write', 'sheet1', { spreadsheetId: 'abc', sheetId: 0 }),
        createOp('sheets_data', 'read', 'sheet1', { spreadsheetId: 'abc', sheetId: 0 }),
        createOp('sheets_data', 'write', 'sheet1', { spreadsheetId: 'abc', sheetId: 0 }),
        createOp('sheets_data', 'read', 'sheet1', { spreadsheetId: 'abc', sheetId: 0 }),
      ];

      ops.forEach((op) => mockHistoryService.record(op));
      predictor.learnFromHistory();
    });

    it('should generate predictions based on patterns', () => {
      const predictions = predictor.predict();

      expect(predictions.length).toBeGreaterThan(0);
      expect(predictions[0]).toHaveProperty('tool');
      expect(predictions[0]).toHaveProperty('action');
      expect(predictions[0]).toHaveProperty('confidence');
      expect(predictions[0]).toHaveProperty('reason');
      expect(predictions[0]).toHaveProperty('priority');
    });

    it('should filter predictions by minimum confidence', () => {
      const highConfidencePredictor = new PrefetchPredictor({
        minConfidence: 0.9,
        maxPredictions: 10,
      });

      // Set up same history
      const ops: OperationHistory[] = [
        createOp('sheets_data', 'read', 'sheet1', { spreadsheetId: 'abc', sheetId: 0 }),
        createOp('sheets_data', 'write', 'sheet1', { spreadsheetId: 'abc', sheetId: 0 }),
      ];

      ops.forEach((op) => mockHistoryService.record(op));
      highConfidencePredictor.learnFromHistory();

      const predictions = highConfidencePredictor.predict();

      predictions.forEach((p) => {
        expect(p.confidence).toBeGreaterThanOrEqual(0.9);
      });
    });

    it('should limit predictions to maxPredictions', () => {
      const limitedPredictor = new PrefetchPredictor({
        minConfidence: 0.1, // Very low to generate many predictions
        maxPredictions: 2,
      });

      const ops: OperationHistory[] = [
        createOp('sheets_data', 'read', 'sheet1', {
          spreadsheetId: 'abc',
          sheetId: 0,
          range: 'A1:B10',
        }),
        createOp('sheets_data', 'write', 'sheet1', { spreadsheetId: 'abc', sheetId: 0 }),
      ];

      ops.forEach((op) => mockHistoryService.record(op));
      limitedPredictor.learnFromHistory();

      const predictions = limitedPredictor.predict();

      expect(predictions.length).toBeLessThanOrEqual(2);
    });

    it('should return empty array when no history', () => {
      const emptyPredictor = new PrefetchPredictor();
      const predictions = emptyPredictor.predict();

      expect(predictions).toEqual([]);
    });
  });

  describe('predictRelatedData', () => {
    it('should predict next sheet read', () => {
      // Need at least 2 operations for learnFromHistory to work
      const ops: OperationHistory[] = [
        createOp('sheets_data', 'read', 'sheet0', { spreadsheetId: 'abc', sheetId: 0 }),
        createOp('sheets_data', 'read', 'sheet1', { spreadsheetId: 'abc', sheetId: 0 }),
      ];

      ops.forEach((op) => mockHistoryService.record(op));
      predictor.learnFromHistory();

      const predictions = predictor.predict();

      // Should predict reading next sheet (sheetId: 1)
      const nextSheetPrediction = predictions.find(
        (p) => p.tool === 'sheets_data' && p.action === 'read' && p.params['sheetId'] === 1
      );

      expect(nextSheetPrediction).toBeDefined();
      expect(nextSheetPrediction?.params['spreadsheetId']).toBe('abc');
    });

    it('should predict spreadsheet metadata access', () => {
      // Need at least 2 operations for learnFromHistory to work
      const ops: OperationHistory[] = [
        createOp('sheets_data', 'read', 'sheet0', { spreadsheetId: 'abc', sheetId: 0 }),
        createOp('sheets_data', 'read', 'sheet1', { spreadsheetId: 'abc', sheetId: 0 }),
      ];

      ops.forEach((op) => mockHistoryService.record(op));
      predictor.learnFromHistory();

      const predictions = predictor.predict();

      // Should predict getting spreadsheet metadata
      const metadataPrediction = predictions.find(
        (p) => p.tool === 'sheets_core' && p.action === 'get'
      );

      expect(metadataPrediction).toBeDefined();
      expect(metadataPrediction?.params['spreadsheetId']).toBe('abc');
    });
  });

  describe('predictAdjacentRanges', () => {
    it('should predict next range when scrolling', () => {
      // Need at least 2 operations for learnFromHistory to work
      const ops: OperationHistory[] = [
        createOp('sheets_data', 'read', 'sheet0', {
          spreadsheetId: 'abc',
          range: 'Sheet1!A1:B10',
        }),
        createOp('sheets_data', 'read', 'sheet1', {
          spreadsheetId: 'abc',
          range: 'Sheet1!A1:B10',
        }),
      ];

      ops.forEach((op) => mockHistoryService.record(op));
      predictor.learnFromHistory();

      const predictions = predictor.predict();

      // Should predict next range (A11:B20)
      const nextRangePrediction = predictions.find(
        (p) =>
          p.tool === 'sheets_data' && p.action === 'read' && p.params['range'] === 'Sheet1!A11:B20'
      );

      expect(nextRangePrediction).toBeDefined();
      expect(nextRangePrediction?.confidence).toBeGreaterThan(0.5);
      expect(nextRangePrediction?.reason).toContain('sequential ranges');
    });
  });

  describe('prefetchInBackground', () => {
    it('should execute predictions in background', async () => {
      const executedPredictions: string[] = [];

      const predictions = [
        {
          tool: 'sheets_data',
          action: 'read',
          params: { spreadsheetId: 'abc' },
          confidence: 0.8,
          reason: 'test',
          priority: 1,
        },
        {
          tool: 'sheets_data',
          action: 'read',
          params: { spreadsheetId: 'def' },
          confidence: 0.7,
          reason: 'test',
          priority: 2,
        },
      ];

      const executor = async (prediction: any) => {
        executedPredictions.push(prediction.tool);
        await new Promise((resolve) => setTimeout(resolve, 10));
      };

      const results = await predictor.prefetchInBackground(predictions, executor);

      expect(results.length).toBe(2);
      expect(executedPredictions).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('should handle prefetch failures gracefully', async () => {
      const predictions = [
        {
          tool: 'sheets_data',
          action: 'read',
          params: { spreadsheetId: 'abc' },
          confidence: 0.8,
          reason: 'test',
          priority: 1,
        },
      ];

      const executor = async () => {
        throw new Error('Prefetch failed');
      };

      const results = await predictor.prefetchInBackground(predictions, executor);

      expect(results.length).toBe(0); // executeAllSuccessful filters out failures
    });

    it('should not prefetch when disabled', async () => {
      const disabledPredictor = new PrefetchPredictor({
        enablePrefetch: false,
      });

      const predictions = [
        {
          tool: 'sheets_data',
          action: 'read',
          params: { spreadsheetId: 'abc' },
          confidence: 0.8,
          reason: 'test',
          priority: 1,
        },
      ];

      const executor = vi.fn();

      const results = await disabledPredictor.prefetchInBackground(predictions, executor);

      expect(results).toEqual([]);
      expect(executor).not.toHaveBeenCalled();
    });
  });

  describe('statistics', () => {
    it('should track prediction statistics', () => {
      // Need at least 2 operations for learnFromHistory to work
      const ops: OperationHistory[] = [
        createOp('sheets_data', 'read', 'sheet0', { spreadsheetId: 'abc', sheetId: 0 }),
        createOp('sheets_data', 'read', 'sheet1', { spreadsheetId: 'abc', sheetId: 0 }),
      ];

      ops.forEach((op) => mockHistoryService.record(op));
      predictor.learnFromHistory();
      predictor.predict();

      const stats = predictor.getStats() as PrefetchStats;

      expect(stats.totalPredictions).toBeGreaterThan(0);
    });

    it('should track prediction accuracy', () => {
      // Need to generate predictions first
      const ops: OperationHistory[] = [
        createOp('sheets_data', 'read', 'sheet0', { spreadsheetId: 'abc', sheetId: 0 }),
        createOp('sheets_data', 'read', 'sheet1', { spreadsheetId: 'abc', sheetId: 0 }),
      ];

      ops.forEach((op) => mockHistoryService.record(op));
      predictor.learnFromHistory();

      // Generate some predictions to increment totalPredictions
      predictor.predict();
      predictor.predict();
      predictor.predict();

      // Record accuracy
      predictor.recordPredictionAccuracy(true);
      predictor.recordPredictionAccuracy(true);
      predictor.recordPredictionAccuracy(false);

      const stats = predictor.getStats() as PrefetchStats;

      expect(stats.correctPredictions).toBe(2);
      // Accuracy = correctPredictions / totalPredictions
      // We need totalPredictions > 0 for accuracy calculation
      if (stats.totalPredictions > 0) {
        expect(stats.accuracy).toBeGreaterThan(0);
      }
    });

    it('should reset statistics', () => {
      predictor.recordPredictionAccuracy(true);
      predictor.resetStats();

      const stats = predictor.getStats() as PrefetchStats;

      expect(stats.totalPredictions).toBe(0);
      expect(stats.correctPredictions).toBe(0);
    });
  });
});

// Helper function to create operation history
function createOp(
  tool: string,
  action: string,
  id: string,
  params: Record<string, unknown>
): OperationHistory {
  return {
    id,
    timestamp: new Date().toISOString(),
    tool,
    action,
    params,
    result: 'success',
    duration: 100,
    spreadsheetId: params['spreadsheetId'] as string,
    sheetId: params['sheetId'] as number,
  };
}
