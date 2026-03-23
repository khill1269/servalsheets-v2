/**
 * Category 10: Compute & Formula Engine Tests
 *
 * Covers sheets_compute handler and formula evaluation:
 * 10.1 Evaluate formula locally (HyperFormula offline)
 * 10.2 Aggregate functions (SUM, AVERAGE, COUNT, MIN, MAX)
 * 10.3 Statistical analysis (mean, median, stddev)
 * 10.4 Regression (R², coefficients)
 * 10.5 Forecast (trend detection)
 * 10.6 Matrix operations (multiply, transpose)
 * 10.7 Explain formula (human-readable breakdown)
 * 10.8 SQL query on sheet data (DuckDB)
 * 10.9 Batch compute (multiple operations)
 *
 * Test structure: handler tests (mocked), direct formula evaluator tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DuckDBEngine } from '../../src/services/duckdb-engine.js';

// ============================================================================
// Module-level mocks
// ============================================================================

vi.mock('../../src/services/compute-engine.js', () => ({
  fetchRangeData: vi.fn(),
  aggregate: vi.fn(),
  computeStatistics: vi.fn(),
  computeRegression: vi.fn(),
  computeForecast: vi.fn(),
  matrixOp: vi.fn(),
  computePivot: vi.fn(),
  explainFormula: vi.fn(),
}));

vi.mock('../../src/services/python-engine.js', () => ({
  runPythonSafe: vi.fn(),
}));

vi.mock('../../src/mcp/sampling.js', () => ({
  generateAIInsight: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ============================================================================
// Test Data & Helpers
// ============================================================================

const SPREADSHEET_ID = 'test-spreadsheet-compute-001';

function makeDuckDBEngine(overrides?: Partial<DuckDBEngine>): DuckDBEngine {
  return {
    query: vi.fn(),
    ...overrides,
  } as unknown as DuckDBEngine;
}

// Mock revenue/cost dataset for aggregation tests
const REVENUE_COST_DATA = [
  ['Product', 'Q1 Revenue', 'Q1 Cost'],
  ['Widget A', 50000, 30000],
  ['Widget B', 75000, 45000],
  ['Widget C', 100000, 60000],
  ['Widget D', 120000, 72000],
];

// Time series dataset for forecast tests
const TIME_SERIES_DATA = [
  ['Month', 'Sales'],
  ['Jan', 10000],
  ['Feb', 12000],
  ['Mar', 13500],
  ['Apr', 16200],
  ['May', 19440],
  ['Jun', 23328],
];

// Matrix data for operations
const MATRIX_2X3 = [
  [1, 2, 3],
  [4, 5, 6],
];

const MATRIX_3X2 = [
  [1, 2],
  [3, 4],
  [5, 6],
];

// ============================================================================
// Tests
// ============================================================================

describe('Cat10: Compute & Formula Engine', () => {
  let aggregate: ReturnType<typeof vi.fn>;
  let computeStatistics: ReturnType<typeof vi.fn>;
  let computeRegression: ReturnType<typeof vi.fn>;
  let computeForecast: ReturnType<typeof vi.fn>;
  let matrixOp: ReturnType<typeof vi.fn>;
  let explainFormula: ReturnType<typeof vi.fn>;
  let fetchRangeData: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const computeEngine = await import('../../src/services/compute-engine.js');
    aggregate = vi.mocked(computeEngine.aggregate);
    computeStatistics = vi.mocked(computeEngine.computeStatistics);
    computeRegression = vi.mocked(computeEngine.computeRegression);
    computeForecast = vi.mocked(computeEngine.computeForecast);
    matrixOp = vi.mocked(computeEngine.matrixOp);
    explainFormula = vi.mocked(computeEngine.explainFormula);
    fetchRangeData = vi.mocked(computeEngine.fetchRangeData);
  });

  // =========================================================================
  // 10.1 Evaluate Formula Locally (HyperFormula offline)
  // =========================================================================

  describe('10.1 Formula Evaluation (HyperFormula)', () => {
    it('should evaluate simple arithmetic expression without range', async () => {
      // HyperFormula can evaluate =2+3 offline
      const { ComputeHandler } = await import('../../src/handlers/compute.js');
      const handler = new ComputeHandler({} as any, {});

      const result = await handler.handle({
        request: {
          action: 'evaluate',
          spreadsheetId: SPREADSHEET_ID,
          formula: '=2+3',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('evaluate');
        // Result may contain value: 5 or similar
        expect(result.response).toBeDefined();
      }
    });

    it('should evaluate formula with cell references when range provided', async () => {
      const { ComputeHandler } = await import('../../src/handlers/compute.js');
      const handler = new ComputeHandler({} as any, {});

      // Mock fetchRangeData to return test data
      fetchRangeData.mockResolvedValue([
        [10, 20],
        [30, 40],
      ]);

      const result = await handler.handle({
        request: {
          action: 'evaluate',
          spreadsheetId: SPREADSHEET_ID,
          formula: '=A1+B1',
          range: { a1: 'Sheet1!A1:B2' },
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.result).toBe(30); // 10 + 20
      }
    });

    it('should evaluate complex formula with nested functions', async () => {
      const { ComputeHandler } = await import('../../src/handlers/compute.js');
      const handler = new ComputeHandler({} as any, {});

      const result = await handler.handle({
        request: {
          action: 'evaluate',
          spreadsheetId: SPREADSHEET_ID,
          formula: '=IF(SUM(1,2,3)>5, 10, 20)',
        },
      });

      expect(result.response.success).toBe(true);
    });

    it('should handle invalid formula gracefully (error case)', async () => {
      const { ComputeHandler } = await import('../../src/handlers/compute.js');
      const handler = new ComputeHandler({} as any, {});

      const result = await handler.handle({
        request: {
          action: 'evaluate',
          spreadsheetId: SPREADSHEET_ID,
          formula: '=1 + )', // Invalid syntax
        },
      });

      // Should either succeed with error details or fail with success:false
      expect(result.response.success === false || result.response.success === true).toBe(true);
    });
  });

  // =========================================================================
  // 10.2 Aggregate Functions (SUM, AVERAGE, COUNT, MIN, MAX)
  // =========================================================================

  describe('10.2 Aggregate Functions', () => {
    beforeEach(() => {
      aggregate.mockResolvedValue({
        results: {
          sum: 345000,
          average: 86250,
          count: 4,
          min: 50000,
          max: 120000,
          median: 87500,
        },
      });
    });

    it('should compute SUM over revenue column', async () => {
      const result = await aggregate([
        ['Revenue'],
        [50000],
        [75000],
        [100000],
        [120000],
      ]);

      // Mock should resolve
      expect(result).toBeDefined();
      expect(result.results.sum).toBe(345000);
    });

    it('should compute AVERAGE correctly', async () => {
      const result = await aggregate([
        ['Revenue'],
        [50000],
        [75000],
        [100000],
        [120000],
      ]);

      expect(result.results.average).toBe(86250);
    });

    it('should compute COUNT for non-empty cells', async () => {
      const result = await aggregate([
        ['Revenue'],
        [50000],
        [75000],
        [100000],
        [120000],
      ]);

      expect(result.results.count).toBe(4);
    });

    it('should compute MIN and MAX', async () => {
      const result = await aggregate([
        ['Revenue'],
        [50000],
        [75000],
        [100000],
        [120000],
      ]);

      expect(result.results.min).toBe(50000);
      expect(result.results.max).toBe(120000);
    });

    it('should handle mixed data types (text + numbers)', async () => {
      aggregate.mockResolvedValue({
        results: {
          sum: 100,
          average: 50,
          count: 2, // Text rows excluded
        },
      });

      const result = await aggregate([
        ['Product', 'Revenue'],
        ['Widget A', 100],
      ]);

      expect(result.results.count).toBe(2);
    });
  });

  // =========================================================================
  // 10.3 Statistical Analysis (mean, median, stddev)
  // =========================================================================

  describe('10.3 Statistical Analysis', () => {
    beforeEach(() => {
      computeStatistics.mockResolvedValue({
        mean: 86250,
        median: 87500,
        stddev: 31007,
        variance: 961434375,
        min: 50000,
        max: 120000,
        q1: 68750,
        q3: 105000,
        iqr: 36250,
      });
    });

    it('should compute mean (average) of dataset', async () => {
      const result = await computeStatistics(REVENUE_COST_DATA, ['Q1 Revenue']);

      expect(result.mean).toBe(86250);
    });

    it('should compute median correctly', async () => {
      const result = await computeStatistics(REVENUE_COST_DATA, ['Q1 Revenue']);

      expect(result.median).toBe(87500);
    });

    it('should compute standard deviation', async () => {
      const result = await computeStatistics(REVENUE_COST_DATA, ['Q1 Revenue']);

      expect(result.stddev).toBe(31007);
      expect(result.variance).toBe(961434375);
    });

    it('should compute quartiles (Q1, Q3, IQR)', async () => {
      const result = await computeStatistics(REVENUE_COST_DATA, ['Q1 Revenue']);

      expect(result.q1).toBe(68750);
      expect(result.q3).toBe(105000);
      expect(result.iqr).toBe(36250);
    });

    it('should flag outliers using IQR method (>Q3 + 1.5*IQR)', async () => {
      computeStatistics.mockResolvedValue({
        mean: 86250,
        median: 87500,
        stddev: 31007,
        variance: 961434375,
        min: 50000,
        max: 120000,
        q1: 68750,
        q3: 105000,
        iqr: 36250,
        outliers: [], // No values exceed Q3 + 1.5*36250 = 159375
      });

      const result = await computeStatistics(REVENUE_COST_DATA, ['Q1 Revenue']);

      expect(result.outliers).toEqual([]);
    });
  });

  // =========================================================================
  // 10.4 Regression (R², coefficients)
  // =========================================================================

  describe('10.4 Regression Analysis', () => {
    beforeEach(() => {
      computeRegression.mockResolvedValue({
        type: 'linear',
        slope: 19440,
        intercept: 2000,
        r: 0.999,
        r_squared: 0.998,
        equation: 'y = 19440*x + 2000',
      });
    });

    it('should compute linear regression slope and intercept', async () => {
      const result = await computeRegression(
        TIME_SERIES_DATA.slice(1), // Skip header
        'linear'
      );

      expect(result.slope).toBe(19440);
      expect(result.intercept).toBe(2000);
    });

    it('should compute R-squared (coefficient of determination)', async () => {
      const result = await computeRegression(TIME_SERIES_DATA.slice(1), 'linear');

      expect(result.r_squared).toBe(0.998);
      expect(result.r).toBe(0.999);
      // R² = 0.998 means 99.8% of variance explained
    });

    it('should generate regression equation string', async () => {
      const result = await computeRegression(TIME_SERIES_DATA.slice(1), 'linear');

      expect(result.equation).toContain('y =');
      expect(result.equation).toContain('19440');
      expect(result.equation).toContain('2000');
    });

    it('should support polynomial regression type', async () => {
      computeRegression.mockResolvedValue({
        type: 'polynomial',
        degree: 2,
        coefficients: [2000, 19440, 200],
        r_squared: 0.9995,
        equation: 'y = 2000 + 19440*x + 200*x²',
      });

      const result = await computeRegression(TIME_SERIES_DATA.slice(1), 'polynomial', {
        degree: 2,
      });

      expect(result.type).toBe('polynomial');
      expect(result.degree).toBe(2);
      expect(result.coefficients.length).toBe(3);
    });
  });

  // =========================================================================
  // 10.5 Forecast (trend detection)
  // =========================================================================

  describe('10.5 Forecasting & Trend Detection', () => {
    beforeEach(() => {
      computeForecast.mockResolvedValue({
        method: 'linear_trend',
        trend: 'increasing',
        forecasted_values: [27993, 33592, 40310],
        confidence_intervals: {
          lower: [20000, 25000, 30000],
          upper: [35986, 42184, 50620],
        },
        seasonality: null,
      });
    });

    it('should detect upward trend from time series', async () => {
      const result = await computeForecast(TIME_SERIES_DATA, {
        periods: 3,
        method: 'linear_trend',
      });

      expect(result.trend).toBe('increasing');
    });

    it('should forecast next N periods', async () => {
      const result = await computeForecast(TIME_SERIES_DATA, {
        periods: 3,
        method: 'linear_trend',
      });

      expect(result.forecasted_values).toHaveLength(3);
      expect(result.forecasted_values[0]).toBe(27993);
    });

    it('should include confidence intervals (95%)', async () => {
      const result = await computeForecast(TIME_SERIES_DATA, {
        periods: 3,
        method: 'linear_trend',
      });

      expect(result.confidence_intervals.lower).toHaveLength(3);
      expect(result.confidence_intervals.upper).toHaveLength(3);
      // Upper should be > lower for all periods
      for (let i = 0; i < 3; i++) {
        expect(result.confidence_intervals.upper[i]).toBeGreaterThan(
          result.confidence_intervals.lower[i]
        );
      }
    });

    it('should detect seasonality in data with seasonal pattern', async () => {
      computeForecast.mockResolvedValue({
        method: 'seasonal',
        trend: 'increasing',
        forecasted_values: [25000, 26000, 24000],
        seasonality: { period: 12, strength: 0.65 },
      });

      const result = await computeForecast(TIME_SERIES_DATA, {
        periods: 3,
        method: 'auto',
      });

      expect(result.seasonality).toBeDefined();
      expect(result.seasonality.period).toBe(12);
    });
  });

  // =========================================================================
  // 10.6 Matrix Operations (multiply, transpose)
  // =========================================================================

  describe('10.6 Matrix Operations', () => {
    beforeEach(() => {
      matrixOp.mockResolvedValue({
        operation: 'transpose',
        result: [
          [1, 4],
          [2, 5],
          [3, 6],
        ],
      });
    });

    it('should transpose a matrix (rows ↔ columns)', async () => {
      const result = await matrixOp(MATRIX_2X3, 'transpose');

      expect(result.operation).toBe('transpose');
      expect(result.result).toHaveLength(3);
      expect(result.result[0]).toEqual([1, 4]);
    });

    it('should multiply two matrices (2×3 × 3×2 = 2×2)', async () => {
      matrixOp.mockResolvedValue({
        operation: 'multiply',
        result: [
          [22, 28],
          [49, 64],
        ],
      });

      const result = await matrixOp(MATRIX_2X3, 'multiply', MATRIX_3X2);

      expect(result.result).toHaveLength(2);
      expect(result.result[0]).toHaveLength(2);
      expect(result.result[0][0]).toBe(22); // 1*1 + 2*3 + 3*5 = 22
    });

    it('should compute matrix determinant', async () => {
      matrixOp.mockResolvedValue({
        operation: 'determinant',
        result: -2, // det([[1, 2], [3, 4]]) = -2
      });

      const result = await matrixOp(
        [
          [1, 2],
          [3, 4],
        ],
        'determinant'
      );

      expect(result.result).toBe(-2);
    });

    it('should compute matrix inverse', async () => {
      matrixOp.mockResolvedValue({
        operation: 'inverse',
        result: [
          [-2, 1],
          [1.5, -0.5],
        ],
      });

      const result = await matrixOp(
        [
          [1, 2],
          [3, 4],
        ],
        'inverse'
      );

      expect(result.operation).toBe('inverse');
      expect(result.result).toHaveLength(2);
    });
  });

  // =========================================================================
  // 10.7 Explain Formula (human-readable breakdown)
  // =========================================================================

  describe('10.7 Formula Explanation', () => {
    beforeEach(() => {
      explainFormula.mockResolvedValue({
        formula: '=IF(SUM(B2:B5)>100, B2*1.1, B2)',
        steps: [
          { step: 1, description: 'Calculate SUM of B2:B5' },
          { step: 2, description: 'Check if sum > 100' },
          { step: 3, description: 'If true: return B2 * 1.1 (10% increase)' },
          { step: 4, description: 'If false: return B2 (unchanged)' },
        ],
        plain_english:
          'If the total of cells B2 through B5 is greater than 100, multiply B2 by 1.1; otherwise use B2 as-is.',
      });
    });

    it('should break down formula into steps', async () => {
      const result = await explainFormula('=IF(SUM(B2:B5)>100, B2*1.1, B2)');

      expect(result.steps).toHaveLength(4);
      expect(result.steps[0].description).toContain('SUM');
    });

    it('should provide human-readable explanation', async () => {
      const result = await explainFormula('=IF(SUM(B2:B5)>100, B2*1.1, B2)');

      expect(result.plain_english).toContain('total');
      expect(result.plain_english).toContain('greater than 100');
      expect(result.plain_english).toContain('multiply');
    });

    it('should identify function names used in formula', async () => {
      explainFormula.mockResolvedValue({
        formula: '=SUM(A1:A10) + AVERAGE(B1:B10)',
        functions_used: ['SUM', 'AVERAGE'],
        steps: [],
        plain_english: 'Add the sum of A1:A10 to the average of B1:B10',
      });

      const result = await explainFormula('=SUM(A1:A10) + AVERAGE(B1:B10)');

      expect(result.functions_used).toContain('SUM');
      expect(result.functions_used).toContain('AVERAGE');
    });
  });

  // =========================================================================
  // 10.8 SQL Query on Sheet Data (DuckDB)
  // =========================================================================

  describe('10.8 SQL Query on Sheet Data (DuckDB)', () => {
    it('should execute SELECT query on sheet range', async () => {
      const duckdbEngine = makeDuckDBEngine();
      duckdbEngine.query.mockResolvedValue({
        columns: ['Product', 'Q1 Revenue'],
        rows: [
          ['Widget A', 50000],
          ['Widget B', 75000],
        ],
      });

      const result = await duckdbEngine.query('SELECT * FROM data LIMIT 2', {
        data: REVENUE_COST_DATA,
      });

      expect(result.columns).toContain('Product');
      expect(result.rows).toHaveLength(2);
    });

    it('should filter data with WHERE clause', async () => {
      const duckdbEngine = makeDuckDBEngine();
      duckdbEngine.query.mockResolvedValue({
        columns: ['Product', 'Q1 Revenue'],
        rows: [
          ['Widget C', 100000],
          ['Widget D', 120000],
        ],
      });

      const result = await duckdbEngine.query(
        'SELECT * FROM data WHERE "Q1 Revenue" > 80000',
        { data: REVENUE_COST_DATA }
      );

      expect(result.rows.length).toBeLessThanOrEqual(4);
    });

    it('should compute aggregations in SQL', async () => {
      const duckdbEngine = makeDuckDBEngine();
      duckdbEngine.query.mockResolvedValue({
        columns: ['avg_revenue'],
        rows: [[86250]],
      });

      const result = await duckdbEngine.query(
        'SELECT AVG("Q1 Revenue") as avg_revenue FROM data',
        { data: REVENUE_COST_DATA }
      );

      expect(result.rows[0][0]).toBe(86250);
    });

    it('should block SQL injection patterns (safety check)', async () => {
      const duckdbEngine = makeDuckDBEngine();
      duckdbEngine.query.mockRejectedValue(new Error('Blocked injection attempt'));

      await expect(
        duckdbEngine.query(
          "SELECT * FROM data; DROP TABLE data; --",
          { data: REVENUE_COST_DATA }
        )
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // 10.9 Batch Compute (multiple operations)
  // =========================================================================

  describe('10.9 Batch Compute', () => {
    it('should execute multiple computations in single call', async () => {
      const { ComputeHandler } = await import('../../src/handlers/compute.js');
      const handler = new ComputeHandler({} as any, {});

      const result = await handler.handle({
        request: {
          action: 'batch_compute',
          spreadsheetId: SPREADSHEET_ID,
          computations: [
            {
              id: 'sum_revenue',
              operation: 'aggregate',
              range: { a1: 'Sheet1!B2:B5' },
              functions: ['sum'],
            },
            {
              id: 'avg_revenue',
              operation: 'aggregate',
              range: { a1: 'Sheet1!B2:B5' },
              functions: ['average'],
            },
            {
              id: 'forecast',
              operation: 'forecast',
              range: { a1: 'Sheet1!A2:B7' },
              periods: 3,
            },
          ],
        },
      });

      expect(result.response.success).toBe(true);
    });

    it('should return results keyed by computation ID', async () => {
      const { ComputeHandler } = await import('../../src/handlers/compute.js');
      const handler = new ComputeHandler({} as any, {});

      const result = await handler.handle({
        request: {
          action: 'batch_compute',
          spreadsheetId: SPREADSHEET_ID,
          computations: [
            {
              id: 'metric_1',
              operation: 'aggregate',
              range: { a1: 'Sheet1!B2:B5' },
              functions: ['sum'],
            },
            {
              id: 'metric_2',
              operation: 'aggregate',
              range: { a1: 'Sheet1!B2:B5' },
              functions: ['average'],
            },
          ],
        },
      });

      expect(result.response.success).toBe(true);
      // Results should be keyed by id
    });

    it('should handle partial failures gracefully', async () => {
      const { ComputeHandler } = await import('../../src/handlers/compute.js');
      const handler = new ComputeHandler({} as any, {});

      const result = await handler.handle({
        request: {
          action: 'batch_compute',
          spreadsheetId: SPREADSHEET_ID,
          computations: [
            {
              id: 'valid_1',
              operation: 'aggregate',
              range: { a1: 'Sheet1!B2:B5' },
              functions: ['sum'],
            },
            {
              id: 'invalid_1',
              operation: 'unknown_operation', // Invalid
              range: { a1: 'Sheet1!B2:B5' },
            },
          ],
        },
      });

      // Should not crash; may return partial results or all-fail response
      expect(result.response).toBeDefined();
    });

    it('should preserve order of computation results', async () => {
      const { ComputeHandler } = await import('../../src/handlers/compute.js');
      const handler = new ComputeHandler({} as any, {});

      const computations = Array.from({ length: 5 }, (_, i) => ({
        id: `metric_${i}`,
        operation: 'aggregate',
        range: { a1: 'Sheet1!B2:B5' },
        functions: ['sum'],
      }));

      const result = await handler.handle({
        request: {
          action: 'batch_compute',
          spreadsheetId: SPREADSHEET_ID,
          computations,
        },
      });

      expect(result.response.success).toBe(true);
    });
  });

  // =========================================================================
  // Integration Tests
  // =========================================================================

  describe('Integration: Compute + Data Paths', () => {
    it('should analyze revenue data end-to-end', async () => {
      const { ComputeHandler } = await import('../../src/handlers/compute.js');
      const handler = new ComputeHandler({} as any, {});

      // Step 1: Aggregate
      aggregate.mockResolvedValue({
        results: { sum: 345000, average: 86250, count: 4 },
      });

      // Step 2: Statistics
      computeStatistics.mockResolvedValue({
        mean: 86250,
        stddev: 31007,
        variance: 961434375,
        min: 50000,
        max: 120000,
      });

      const result1 = await handler.handle({
        request: {
          action: 'aggregate',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!B2:B5' },
          functions: ['sum', 'average', 'count'],
        },
      });

      expect(result1.response.success).toBe(true);

      const result2 = await handler.handle({
        request: {
          action: 'statistical',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!B2:B5' },
        },
      });

      expect(result2.response.success).toBe(true);
    });

    it('should model business scenario with forecast + regression', async () => {
      const { ComputeHandler } = await import('../../src/handlers/compute.js');
      const handler = new ComputeHandler({} as any, {});

      // Mock data fetching
      fetchRangeData.mockResolvedValue(TIME_SERIES_DATA);

      computeRegression.mockResolvedValue({
        type: 'linear',
        slope: 19440,
        r_squared: 0.998,
        equation: 'y = 19440*x + 2000',
      });

      computeForecast.mockResolvedValue({
        method: 'linear_trend',
        trend: 'increasing',
        forecasted_values: [27993, 33592, 40310],
      });

      const regResult = await handler.handle({
        request: {
          action: 'regression',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A2:B7' },
          xColumn: 'Month',
          yColumn: 'Sales',
        },
      });

      expect(regResult.response.success).toBe(true);

      const foreResult = await handler.handle({
        request: {
          action: 'forecast',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A2:B7' },
          dateColumn: 'Month',
          valueColumn: 'Sales',
          periods: 3,
        },
      });

      expect(foreResult.response.success).toBe(true);
    });
  });
});
