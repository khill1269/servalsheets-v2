import { describe, expect, it, vi } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import {
  computeForecast,
  computePivot,
  computeRegression,
  computeStatistics,
  fetchRangeData,
} from '../../src/services/compute-engine.js';

describe('compute-engine', () => {
  describe('fetchRangeData', () => {
    it('returns an empty matrix for non-array Sheets responses', async () => {
      const api = {
        spreadsheets: {
          values: {
            get: vi.fn().mockResolvedValue({ data: { values: null } }),
          },
        },
      } as unknown as sheets_v4.Sheets;

      await expect(fetchRangeData(api, 'sheet-123', 'Sheet1!A1:B2')).resolves.toEqual([]);
    });
  });

  describe('computeStatistics', () => {
    it('computes bounds for a single-value numeric column without crashing', () => {
      const result = computeStatistics([['Revenue'], [42]], {
        percentiles: [50],
        includeCorrelations: false,
      });

      expect(result.statistics['Revenue']).toMatchObject({
        count: 1,
        min: 42,
        max: 42,
        range: 0,
      });
    });
  });

  describe('computeRegression', () => {
    it('builds exponential regression equations without tuple assertions', () => {
      const result = computeRegression(
        [
          ['Input', 'Output'],
          [1, 2],
          [2, 4],
          [3, 8],
        ],
        {
          xColumn: 'Input',
          yColumn: 'Output',
          type: 'exponential',
          degree: 2,
        }
      );

      expect(result.equation).toContain('e^');
      expect(result.coefficients).toHaveLength(2);
    });
  });

  describe('computeForecast', () => {
    it('produces repeated moving-average forecasts for the requested horizon', () => {
      const result = computeForecast(
        [
          ['Month', 'Revenue'],
          ['Jan', 10],
          ['Feb', 12],
          ['Mar', 14],
          ['Apr', 16],
          ['May', 18],
          ['Jun', 20],
        ],
        {
          dateColumn: 'Month',
          valueColumn: 'Revenue',
          periods: 3,
          method: 'moving_average',
        }
      );

      expect(result.methodUsed).toBe('moving_average');
      expect(result.forecast).toHaveLength(3);
      expect(result.forecast.map((point) => point.value)).toEqual([19, 19, 19]);
    });
  });

  describe('computePivot', () => {
    it('builds sparse multi-column pivots without map lookup assertions', () => {
      const result = computePivot(
        [
          ['Region', 'Quarter', 'Sales'],
          ['East', 'Q1', 10],
          ['East', 'Q2', 20],
          ['West', 'Q1', 15],
        ],
        {
          rows: ['Region'],
          columns: ['Quarter'],
          values: [{ column: 'Sales', function: 'sum' }],
        }
      );

      expect(result.headers).toEqual(['Region', 'Q1 | sum(Sales)', 'Q2 | sum(Sales)']);
      expect(result.rows).toEqual([
        ['East', 10, 20],
        ['West', 15, null],
      ]);
    });
  });
});
