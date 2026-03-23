/**
 * Integration tests for worker pool with analysis worker
 *
 * Tests analysis worker operations directly since worker threads
 * require compiled .js files which are not available in the vitest environment.
 * This validates the same analysis logic that the worker pool would execute.
 */

import { describe, it, expect } from 'vitest';
import { execute, type AnalysisWorkerTask } from '../../src/workers/analysis-worker.js';

describe('WorkerPool - Analysis Worker Integration', () => {
  describe('analyzeTrends', () => {
    it('should analyze trends in worker thread', () => {
      const data = [
        [1, 10, 100],
        [2, 20, 95],
        [3, 30, 90],
        [4, 40, 85],
        [5, 50, 80],
      ];

      const result = execute({
        operation: 'analyzeTrends',
        data,
      } as AnalysisWorkerTask) as Array<{
        column: number;
        trend: 'increasing' | 'decreasing' | 'stable';
        changeRate: string;
        confidence: number;
      }>;

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        column: 0,
        trend: 'increasing',
      });
      expect(result[1]).toMatchObject({
        column: 1,
        trend: 'increasing',
      });
      expect(result[2]).toMatchObject({
        column: 2,
        trend: 'decreasing',
      });
    });

    it('should handle large dataset (10K+ rows)', () => {
      // Generate 10K rows with trend
      const data: number[][] = [];
      for (let i = 0; i < 10000; i++) {
        data.push([i, i * 2, Math.sin(i / 100) * 50 + 100]);
      }

      const startTime = Date.now();
      const result = execute({
        operation: 'analyzeTrends',
        data,
      } as AnalysisWorkerTask) as Array<{
        column: number;
        trend: 'increasing' | 'decreasing' | 'stable';
        changeRate: string;
        confidence: number;
      }>;
      const duration = Date.now() - startTime;

      expect(result).toHaveLength(3);
      expect(duration).toBeLessThan(1000); // Should be fast even for 10K rows
    });
  });

  describe('detectAnomalies', () => {
    it('should detect anomalies in worker thread', () => {
      // Need enough normal data points so outliers have z-score > 3
      const data = [
        [10, 20, 30],
        [12, 22, 32],
        [11, 21, 31],
        [10, 20, 30],
        [12, 22, 32],
        [11, 21, 31],
        [10, 20, 30],
        [12, 22, 32],
        [11, 21, 31],
        [10, 20, 30],
        [1000, 23, 33], // Anomaly in column 0
        [13, 2000, 34], // Anomaly in column 1
        [14, 24, 3000], // Anomaly in column 2
      ];

      const result = execute({
        operation: 'detectAnomalies',
        data,
      } as AnalysisWorkerTask) as Array<{
        cell: string;
        value: number;
        expected: string;
        deviation: string;
        zScore: string;
      }>;

      expect(result.length).toBeGreaterThan(0);
      expect(result.some((a) => a.cell.includes('Col 1'))).toBe(true);
      expect(result.some((a) => a.cell.includes('Col 2'))).toBe(true);
      expect(result.some((a) => a.cell.includes('Col 3'))).toBe(true);
    });
  });

  describe('analyzeCorrelations', () => {
    it('should analyze correlations in worker thread', () => {
      const data = [
        [1, 10, 100],
        [2, 20, 95],
        [3, 30, 90],
        [4, 40, 85],
        [5, 50, 80],
      ];

      const result = execute({
        operation: 'analyzeCorrelations',
        data,
      } as AnalysisWorkerTask) as Array<{
        columns: number[];
        correlation: string;
        strength: string;
      }>;

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('columns');
      expect(result[0]).toHaveProperty('correlation');
      expect(result[0]).toHaveProperty('strength');
    });
  });

  describe('fullAnalysis', () => {
    it('should run full analysis in worker thread', () => {
      const data = [
        [1, 10, 100],
        [2, 20, 95],
        [3, 30, 90],
        [4, 40, 85],
        [5, 50, 80],
      ];

      const result = execute({
        operation: 'fullAnalysis',
        data,
      } as AnalysisWorkerTask) as {
        trends: Array<{
          column: number;
          trend: 'increasing' | 'decreasing' | 'stable';
          changeRate: string;
          confidence: number;
        }>;
        anomalies: Array<{
          cell: string;
          value: number;
          expected: string;
          deviation: string;
          zScore: string;
        }>;
        correlations: Array<{
          columns: number[];
          correlation: string;
          strength: string;
        }>;
        rowCount: number;
        columnCount: number;
        duration: number;
      };

      expect(result).toHaveProperty('trends');
      expect(result).toHaveProperty('anomalies');
      expect(result).toHaveProperty('correlations');
      expect(result).toHaveProperty('rowCount', 5);
      expect(result).toHaveProperty('columnCount', 3);
      expect(result).toHaveProperty('duration');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle 100K row dataset efficiently', () => {
      // Generate 100K rows
      const data: number[][] = [];
      for (let i = 0; i < 100000; i++) {
        data.push([i, i * 2 + Math.random() * 10, 100 - i * 0.001 + Math.random() * 5]);
      }

      const startTime = Date.now();
      const result = execute({
        operation: 'fullAnalysis',
        data,
      } as AnalysisWorkerTask) as {
        trends: unknown[];
        anomalies: unknown[];
        correlations: unknown[];
        rowCount: number;
        columnCount: number;
        duration: number;
      };
      const totalDuration = Date.now() - startTime;

      expect(result.rowCount).toBe(100000);
      expect(result.columnCount).toBe(3);
      expect(totalDuration).toBeLessThan(15000); // Target: < 15s
      expect(result.trends.length).toBeGreaterThan(0);
      expect(result.correlations.length).toBeGreaterThan(0);
    });
  });

  describe('concurrent analysis', () => {
    it('should handle multiple analysis calls', () => {
      const data1 = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ];
      const data2 = [
        [10, 20, 30],
        [40, 50, 60],
        [70, 80, 90],
      ];

      const result1 = execute({
        operation: 'analyzeTrends',
        data: data1,
      } as AnalysisWorkerTask) as unknown[];

      const result2 = execute({
        operation: 'analyzeTrends',
        data: data2,
      } as AnalysisWorkerTask) as unknown[];

      expect(result1).toHaveLength(3);
      expect(result2).toHaveLength(3);
    });
  });

  describe('error handling', () => {
    it('should handle invalid operation', () => {
      expect(() =>
        execute({
          operation: 'invalidOperation' as AnalysisWorkerTask['operation'],
          data: [],
        })
      ).toThrow(/unknown analysis operation/i);
    });

    it('should handle empty data gracefully', () => {
      const result = execute({
        operation: 'analyzeTrends',
        data: [],
      } as AnalysisWorkerTask) as unknown[];

      expect(result).toHaveLength(0);
    });
  });
});
