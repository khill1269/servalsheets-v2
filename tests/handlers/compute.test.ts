/**
 * ServalSheets - Compute Handler Tests
 *
 * Covers all 16 actions for sheets_compute:
 * evaluate, aggregate, statistical, regression, forecast, matrix_op,
 * pivot_compute, custom_function, batch_compute, explain_formula,
 * sql_query, sql_join, python_eval, pandas_profile, sklearn_model,
 * matplotlib_chart
 *
 * Security tests: sql_query injection blocking, python_eval sandbox.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComputeHandler } from '../../src/handlers/compute.js';
import type { DuckDBEngine } from '../../src/services/duckdb-engine.js';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPREADSHEET_ID = 'test-spreadsheet-id-001';

function makeHandler(
  duckdbEngine?: DuckDBEngine,
  server?: { elicitInput: (params: unknown) => Promise<{ action: string; content: unknown }> }
): ComputeHandler {
  const fakeSheets = {} as any;
  return new ComputeHandler(fakeSheets, { duckdbEngine, server });
}

function makeDuckDBEngine(overrides?: Partial<DuckDBEngine>): DuckDBEngine {
  return {
    query: vi.fn(),
    ...overrides,
  } as unknown as DuckDBEngine;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ComputeHandler', () => {
  let fetchRangeData: ReturnType<typeof vi.fn>;
  let aggregate: ReturnType<typeof vi.fn>;
  let computeStatistics: ReturnType<typeof vi.fn>;
  let computeRegression: ReturnType<typeof vi.fn>;
  let computeForecast: ReturnType<typeof vi.fn>;
  let matrixOp: ReturnType<typeof vi.fn>;
  let computePivot: ReturnType<typeof vi.fn>;
  let explainFormula: ReturnType<typeof vi.fn>;
  let runPythonSafe: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const computeEngine = await import('../../src/services/compute-engine.js');
    fetchRangeData = vi.mocked(computeEngine.fetchRangeData);
    aggregate = vi.mocked(computeEngine.aggregate);
    computeStatistics = vi.mocked(computeEngine.computeStatistics);
    computeRegression = vi.mocked(computeEngine.computeRegression);
    computeForecast = vi.mocked(computeEngine.computeForecast);
    matrixOp = vi.mocked(computeEngine.matrixOp);
    computePivot = vi.mocked(computeEngine.computePivot);
    explainFormula = vi.mocked(computeEngine.explainFormula);

    const pythonEngine = await import('../../src/services/python-engine.js');
    runPythonSafe = vi.mocked(pythonEngine.runPythonSafe);

    // Default fetchRangeData returns a simple 2-row dataset
    fetchRangeData.mockResolvedValue([
      ['Name', 'Revenue', 'Cost'],
      ['Alpha', 100, 60],
      ['Beta', 200, 120],
    ]);
  });

  // -------------------------------------------------------------------------
  // evaluate
  // -------------------------------------------------------------------------

  describe('evaluate', () => {
    it('should evaluate a formula without range context', async () => {
      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'evaluate',
          spreadsheetId: SPREADSHEET_ID,
          formula: '=SUM(1,2,3)',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('evaluate');
      }
    });

    it('should resolve cell references when range is provided', async () => {
      fetchRangeData.mockResolvedValue([
        ['A', 'B'],
        [10, 20],
      ]);

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'evaluate',
          spreadsheetId: SPREADSHEET_ID,
          formula: '=A2+B2',
          range: { a1: 'Sheet1!A1:B2' },
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(typeof result.response.resolvedCells).toBe('object');
        expect(result.response.resolvedCells).not.toBeNull();
      }
    });

    it('S1-B: should return success:false when expression cannot be evaluated', async () => {
      const handler = makeHandler();
      // Use unmatched paren — survives sanitizer and causes SyntaxError in Function constructor
      const result = await handler.handle({
        request: {
          action: 'evaluate',
          spreadsheetId: SPREADSHEET_ID,
          formula: '=1 + )',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('OPERATION_FAILED');
        expect(result.response.error.message).toContain('Cannot evaluate');
      }
    });

    it('should return error when fetchRangeData throws', async () => {
      fetchRangeData.mockRejectedValue(new Error('Sheets API quota exceeded'));

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'evaluate',
          spreadsheetId: SPREADSHEET_ID,
          formula: '=A1',
          range: { a1: 'Sheet1!A1' },
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
        expect(result.response.error.message).toContain('quota');
      }
    });
  });

  // -------------------------------------------------------------------------
  // aggregate
  // -------------------------------------------------------------------------

  describe('aggregate', () => {
    it('should compute aggregations on a range', async () => {
      aggregate.mockReturnValue({
        aggregations: { sum: 300, average: 150 },
        rowCount: 2,
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'aggregate',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!B1:B3' },
          functions: ['sum', 'average'],
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('aggregate');
        expect(result.response.aggregations).toMatchObject({ sum: 300, average: 150 });
      }
    });

    it('should return error when aggregate throws', async () => {
      aggregate.mockImplementation(() => {
        throw new Error('Column not found: X');
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'aggregate',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!X1:X10' },
          functions: ['sum'],
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.message).toContain('Column not found');
      }
    });
  });

  // -------------------------------------------------------------------------
  // statistical
  // -------------------------------------------------------------------------

  describe('statistical', () => {
    it('should return descriptive statistics', async () => {
      computeStatistics.mockReturnValue({
        statistics: {
          Revenue: {
            count: 2,
            mean: 150,
            median: 150,
            stddev: 50,
            min: 100,
            max: 200,
            variance: 2500,
            range: 100,
            nullCount: 0,
          },
        },
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'statistical',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:C3' },
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.statistics).toHaveProperty('Revenue');
      }
    });

    it('should return error when statistical throws', async () => {
      computeStatistics.mockImplementation(() => {
        throw new Error('No numeric columns found');
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'statistical',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:A1' },
        },
      });

      expect(result.response.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // regression
  // -------------------------------------------------------------------------

  describe('regression', () => {
    it('should compute linear regression', async () => {
      computeRegression.mockReturnValue({
        coefficients: [0.5, 10],
        rSquared: 0.98,
        equation: 'y = 0.5x + 10',
        residuals: { mean: 0, stddev: 1.2, max: 2.1 },
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'regression',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:B3' },
          xColumn: 'A',
          yColumn: 'B',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.rSquared).toBe(0.98);
        expect(result.response.equation).toBe('y = 0.5x + 10');
      }
    });

    it('should return error when regression fails', async () => {
      computeRegression.mockImplementation(() => {
        throw new Error('Insufficient data points for regression');
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'regression',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:B2' },
          xColumn: 'A',
          yColumn: 'B',
        },
      });

      expect(result.response.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // forecast
  // -------------------------------------------------------------------------

  describe('forecast', () => {
    it('should generate time series forecast', async () => {
      fetchRangeData.mockResolvedValue([
        ['Month', 'Revenue'],
        ['2024-01-01', 100],
        ['2024-02-01', 150],
        ['2024-03-01', 200],
      ]);
      computeForecast.mockReturnValue({
        forecast: [
          { period: '2024-04', value: 220, lowerBound: 200, upperBound: 240 },
          { period: '2024-05', value: 240, lowerBound: 218, upperBound: 262 },
        ],
        trend: { direction: 'increasing', strength: 0.85, seasonalityDetected: false },
        methodUsed: 'linear_trend',
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'forecast',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:B4' },
          dateColumn: 'A',
          valueColumn: 'B',
          periods: 2,
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.forecast).toHaveLength(2);
        expect(result.response.trend?.direction).toBe('increasing');
      }
    });

    it('should return error when forecast fails', async () => {
      fetchRangeData.mockResolvedValue([
        ['Month', 'Revenue'],
        ['2024-01-01', 100],
        ['2024-02-01', 150],
        ['2024-03-01', 200],
      ]);
      computeForecast.mockImplementation(() => {
        throw new Error('Cannot parse date column');
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'forecast',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:B3' },
          dateColumn: 'A',
          valueColumn: 'B',
          periods: 3,
        },
      });

      expect(result.response.success).toBe(false);
    });

    it('elicits periods when forecast input omits them', async () => {
      const elicitInput = vi.fn().mockResolvedValue({
        action: 'accept',
        content: { periods: '4' },
      });
      fetchRangeData.mockResolvedValue([
        ['Month', 'Revenue'],
        ['2024-01-01', 100],
        ['2024-02-01', 150],
        ['2024-03-01', 200],
      ]);
      computeForecast.mockReturnValue({
        forecast: [{ period: '2024-04', value: 220 }],
        trend: { direction: 'increasing', strength: 0.7, seasonalityDetected: false },
        methodUsed: 'linear_trend',
      });

      const handler = makeHandler(undefined, { elicitInput });
      const result = await handler.handle({
        request: {
          action: 'forecast',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:B4' },
          dateColumn: 'A',
          valueColumn: 'B',
        },
      });

      expect(elicitInput).toHaveBeenCalledOnce();
      expect(computeForecast).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ periods: 4 })
      );
      expect(result.response.success).toBe(true);
    });

    it('rejects forecast input with repeated periods and skips computeForecast', async () => {
      fetchRangeData.mockResolvedValue([
        ['Month', 'Revenue'],
        ['2024-01-01', 100],
        ['2024-01-01', 120],
        ['2024-02-01', 180],
        ['2024-03-01', 240],
      ]);

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'forecast',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:B5' },
          dateColumn: 'Month',
          valueColumn: 'Revenue',
          periods: 2,
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INVALID_PARAMS');
        expect(result.response.error.message).toContain('multiple rows');
        expect(result.response.error.suggestedFix).toContain('Aggregate');
      }
      expect(computeForecast).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // matrix_op
  // -------------------------------------------------------------------------

  describe('matrix_op', () => {
    it('should transpose a matrix', async () => {
      fetchRangeData.mockResolvedValue([
        [1, 2, 3],
        [4, 5, 6],
      ]);
      matrixOp.mockReturnValue({
        matrix: [
          [1, 4],
          [2, 5],
          [3, 6],
        ],
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'matrix_op',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:C2' },
          operation: 'transpose',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(Array.isArray(result.response.matrix)).toBe(true);
        expect(result.response.matrix!.length).toBe(3); // transposed 2x3 → 3x2
      }
    });

    it('should return error for invalid matrix operation', async () => {
      matrixOp.mockImplementation(() => {
        throw new Error('Matrix is not square');
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'matrix_op',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:C2' },
          operation: 'inverse',
        },
      });

      expect(result.response.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // pivot_compute
  // -------------------------------------------------------------------------

  describe('pivot_compute', () => {
    it('should compute pivot table', async () => {
      computePivot.mockReturnValue({
        headers: ['Name', 'sum_Revenue'],
        rows: [
          ['Alpha', 100],
          ['Beta', 200],
        ],
        totals: { sum_Revenue: 300 },
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'pivot_compute',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:C3' },
          rows: ['Name'],
          values: [{ column: 'Revenue', function: 'sum' }],
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.pivotTable?.rows).toHaveLength(2);
      }
    });

    it('should return error when pivot fails', async () => {
      computePivot.mockImplementation(() => {
        throw new Error('Row column not found');
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'pivot_compute',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:C3' },
          rows: ['NonExistent'],
          values: [{ column: 'Revenue', function: 'sum' }],
        },
      });

      expect(result.response.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // custom_function
  // -------------------------------------------------------------------------

  describe('custom_function', () => {
    it('should evaluate custom expression per row', async () => {
      fetchRangeData.mockResolvedValue([
        ['Revenue', 'Cost'],
        [100, 60],
        [200, 120],
      ]);

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'custom_function',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:B3' },
          expression: '$Revenue - $Cost',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(Array.isArray(result.response.values)).toBe(true);
        expect(result.response.values!.length).toBe(2); // 2 data rows
      }
    });

    it('should return error when expression evaluation fails', async () => {
      fetchRangeData.mockRejectedValue(new Error('Range not found'));

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'custom_function',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!Z1:Z10' },
          expression: '$Z',
        },
      });

      expect(result.response.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // batch_compute
  // -------------------------------------------------------------------------

  describe('batch_compute', () => {
    it('should run multiple computations', async () => {
      aggregate.mockReturnValue({ aggregations: { sum: 300 }, rowCount: 2 });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'batch_compute',
          spreadsheetId: SPREADSHEET_ID,
          computations: [
            {
              id: 'comp-1',
              type: 'aggregate',
              params: { range: { a1: 'Sheet1!B1:B3' }, functions: ['sum'] },
            },
          ],
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(Array.isArray(result.response.results)).toBe(true);
        expect(result.response.results!.length).toBe(1);
        expect(result.response.results![0]).toHaveProperty('id', 'comp-1');
      }
    });

    it('should continue after individual computation error when stopOnError=false', async () => {
      aggregate.mockImplementation(() => {
        throw new Error('Column missing');
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'batch_compute',
          spreadsheetId: SPREADSHEET_ID,
          stopOnError: false,
          computations: [
            {
              id: 'comp-err',
              type: 'aggregate',
              params: { range: { a1: 'Sheet1!A1:A2' }, functions: ['sum'] },
            },
          ],
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        const results = result.response.results ?? [];
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]?.success).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // explain_formula
  // -------------------------------------------------------------------------

  describe('explain_formula', () => {
    it('should explain a formula', async () => {
      explainFormula.mockReturnValue({
        summary: 'Sums values in A1 to A10',
        functions: [{ name: 'SUM', description: 'Adds numbers', arguments: ['A1:A10'] }],
        references: [{ ref: 'A1:A10' }],
        complexity: 'simple',
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'explain_formula',
          spreadsheetId: SPREADSHEET_ID,
          formula: '=SUM(A1:A10)',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.explanation?.complexity).toBe('simple');
      }
    });

    it('should return error when explainFormula throws', async () => {
      explainFormula.mockImplementation(() => {
        throw new Error('Cannot parse formula');
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'explain_formula',
          spreadsheetId: SPREADSHEET_ID,
          formula: '=INVALID(((',
        },
      });

      expect(result.response.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // sql_query — SECURITY TESTS
  // -------------------------------------------------------------------------

  describe('sql_query', () => {
    it('should execute a valid SELECT query successfully', async () => {
      const duckdb = makeDuckDBEngine();
      (duckdb.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        columns: ['Name', 'Revenue'],
        rows: [
          ['Alpha', 100],
          ['Beta', 200],
        ],
        executionMs: 12,
      });

      const handler = makeHandler(duckdb);
      const result = await handler.handle({
        request: {
          action: 'sql_query',
          spreadsheetId: SPREADSHEET_ID,
          tables: [{ name: 'sales', range: { a1: 'Sheet1!A1:C3' }, hasHeaders: true }],
          sql: 'SELECT Name, Revenue FROM sales WHERE Revenue > 50',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.sqlColumns).toEqual(['Name', 'Revenue']);
        expect(result.response.sqlRows).toHaveLength(2);
        expect(result.response.rowsReturned).toBe(2);
      }
    });

    it('should return error for DROP TABLE — rejected by DuckDB engine validation', async () => {
      const duckdb = makeDuckDBEngine();
      (duckdb.query as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Dangerous SQL statement rejected: DROP TABLE users')
      );

      const handler = makeHandler(duckdb);
      const result = await handler.handle({
        request: {
          action: 'sql_query',
          spreadsheetId: SPREADSHEET_ID,
          tables: [{ name: 'users', range: { a1: 'Sheet1!A1:B3' }, hasHeaders: true }],
          sql: 'DROP TABLE users',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.message).toContain('DROP TABLE');
      }
    });

    it('should return NOT_FOUND when no DuckDB engine is configured', async () => {
      const handler = makeHandler(); // no duckdbEngine
      const result = await handler.handle({
        request: {
          action: 'sql_query',
          spreadsheetId: SPREADSHEET_ID,
          tables: [{ name: 'sales', range: { a1: 'Sheet1!A1:B2' }, hasHeaders: true }],
          sql: 'SELECT * FROM sales',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('NOT_FOUND');
        expect(result.response.error.message).toContain('DuckDB engine not available');
      }
    });
  });

  // -------------------------------------------------------------------------
  // sql_join
  // -------------------------------------------------------------------------

  describe('sql_join', () => {
    it('should join two ranges via DuckDB', async () => {
      const duckdb = makeDuckDBEngine();
      (duckdb.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        columns: ['id', 'name', 'value'],
        rows: [['1', 'Alpha', 100]],
        executionMs: 8,
      });

      const handler = makeHandler(duckdb);
      const result = await handler.handle({
        request: {
          action: 'sql_join',
          spreadsheetId: SPREADSHEET_ID,
          left: { range: { a1: 'Sheet1!A1:B3' }, alias: 'left' },
          right: { range: { a1: 'Sheet2!A1:B3' }, alias: 'right' },
          on: 'left.id = right.id',
          joinType: 'inner',
        },
      });

      expect(result.response.success).toBe(true);
    });

    it('should return NOT_FOUND when DuckDB engine is absent for sql_join', async () => {
      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'sql_join',
          spreadsheetId: SPREADSHEET_ID,
          left: { range: { a1: 'Sheet1!A1:B3' }, alias: 'left' },
          right: { range: { a1: 'Sheet2!A1:B3' }, alias: 'right' },
          on: 'left.id = right.id',
          joinType: 'left',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // -------------------------------------------------------------------------
  // python_eval — SECURITY TESTS
  // -------------------------------------------------------------------------

  describe('python_eval', () => {
    it('should execute safe Python code and return result', async () => {
      runPythonSafe.mockResolvedValue({
        result: 4,
        stdout: '',
        executionMs: 30,
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'python_eval',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:B3' },
          code: 'result = 2 + 2',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.pythonResult).toBe(4);
      }
    });

    it('should return error when sandbox blocks "import os"', async () => {
      runPythonSafe.mockRejectedValue(
        new Error('Import blocked by sandbox: os is not in the allowlist')
      );

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'python_eval',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:B3' },
          code: 'import os\nresult = os.listdir("/")',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.message).toMatch(/blocked|allowlist|sandbox/i);
      }
    });

    it('should return error when sandbox blocks open() built-in', async () => {
      runPythonSafe.mockRejectedValue(new Error('open is not allowed in sandbox mode'));

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'python_eval',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:B3' },
          code: 'result = open("file.txt").read()',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.message).toMatch(/open|sandbox|allowed/i);
      }
    });

    it('should return error when python execution times out', async () => {
      runPythonSafe.mockRejectedValue(new Error('Python execution timed out after 60000ms'));

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'python_eval',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:B3' },
          code: 'while True: pass',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.message).toContain('timed out');
      }
    });
  });

  // -------------------------------------------------------------------------
  // pandas_profile
  // -------------------------------------------------------------------------

  describe('pandas_profile', () => {
    it('should return pandas profile statistics', async () => {
      runPythonSafe.mockResolvedValue({
        result: {
          stats: {
            Revenue: { count: 2, mean: 150, std: 50, min: 100, max: 200 },
          },
          correlations: {},
        },
        stdout: '',
        executionMs: 50,
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'pandas_profile',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:C3' },
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.profileStats).toHaveProperty('Revenue');
      }
    });

    it('should return error when pandas_profile fails', async () => {
      runPythonSafe.mockRejectedValue(new Error('Pyodide unavailable'));

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'pandas_profile',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:B3' },
        },
      });

      expect(result.response.success).toBe(false);
    });

    it('filters invalid correlation values from python results', async () => {
      runPythonSafe.mockResolvedValue({
        result: {
          stats: {
            Revenue: { count: 2, mean: 150 },
          },
          correlations: {
            Revenue: { Cost: 0.82, Margin: null, Notes: 'bad' },
          },
        },
        stdout: '',
        executionMs: 50,
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'pandas_profile',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:C3' },
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.correlations).toEqual({
          Revenue: { Cost: 0.82 },
        });
      }
    });
  });

  // -------------------------------------------------------------------------
  // sklearn_model
  // -------------------------------------------------------------------------

  describe('sklearn_model', () => {
    it('should train a model and return metrics', async () => {
      runPythonSafe.mockResolvedValue({
        result: {
          metrics: { r2: 0.92, mse: 0.05, mae: 0.18 },
          feature_importances: null,
        },
        stdout: '',
        executionMs: 120,
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'sklearn_model',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:C3' },
          targetColumn: 'Cost',
          modelType: 'linear_regression',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.modelMetrics).toHaveProperty('r2', 0.92);
        expect(result.response.modelMetrics).toHaveProperty('mse', 0.05);
      }
    });

    it('should return error when sklearn execution fails', async () => {
      runPythonSafe.mockRejectedValue(new Error('Not enough samples for train/test split'));

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'sklearn_model',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:B2' },
          targetColumn: 'B',
          modelType: 'random_forest',
        },
      });

      expect(result.response.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // matplotlib_chart
  // -------------------------------------------------------------------------

  describe('matplotlib_chart', () => {
    it('should generate a base64 chart image', async () => {
      runPythonSafe.mockResolvedValue({
        result: { image: 'data:image/png;base64,iVBORw0KGgoAAAANS' },
        stdout: '',
        executionMs: 200,
      });

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'matplotlib_chart',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:B3' },
          chartType: 'bar',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.chartImage).toContain('data:image/png');
      }
    });

    it('should return error when chart generation fails', async () => {
      runPythonSafe.mockRejectedValue(new Error('matplotlib not installed'));

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'matplotlib_chart',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:B3' },
          chartType: 'line',
        },
      });

      expect(result.response.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases (S63-M2)
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('S63-C1: evaluate handles modulo by zero without throwing', async () => {
      const handler = makeHandler();
      const result = await handler.handle({
        request: { action: 'evaluate', formula: '10 % 0', spreadsheetId: SPREADSHEET_ID },
      });
      // Should succeed — the evaluator converts NaN/Infinity to 0 at its final return
      expect(result.response.success).toBe(true);
    });

    it('S63-C2: aggregate returns INVALID_PARAMS when range has no data for moving_average', async () => {
      // Empty dataset — no rows at all
      fetchRangeData.mockResolvedValue([]);

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'aggregate',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:A1' },
          functions: ['sum'],
          type: 'moving_average',
          valueColumn: 'Revenue',
          windowSize: 3,
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INVALID_PARAMS');
        expect(result.response.error.message).toMatch(/no data/i);
      }
    });

    it('S63-C2: aggregate returns INVALID_PARAMS when header row is empty for moving_sum', async () => {
      // Row exists but has no columns
      fetchRangeData.mockResolvedValue([[]]);

      const handler = makeHandler();
      const result = await handler.handle({
        request: {
          action: 'aggregate',
          spreadsheetId: SPREADSHEET_ID,
          range: { a1: 'Sheet1!A1:A1' },
          functions: ['sum'],
          type: 'moving_sum',
          valueColumn: 'Amount',
          windowSize: 3,
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INVALID_PARAMS');
      }
    });

    it('S63-C1: evaluate handles division and modulo by zero consistently (both succeed)', async () => {
      const handler = makeHandler();
      const divResult = await handler.handle({
        request: { action: 'evaluate', formula: '5 / 0', spreadsheetId: SPREADSHEET_ID },
      });
      const modResult = await handler.handle({
        request: { action: 'evaluate', formula: '5 % 0', spreadsheetId: SPREADSHEET_ID },
      });
      // Both should succeed without throwing — evaluator converts NaN/Infinity to 0
      expect(divResult.response.success).toBe(true);
      expect(modResult.response.success).toBe(true);
    });

    it('concurrent evaluate calls return independent results', async () => {
      const handler = makeHandler();
      const formulas = Array.from({ length: 10 }, (_, i) => `${i + 1} * 2`);
      const results = await Promise.all(
        formulas.map((formula) =>
          handler.handle({
            request: { action: 'evaluate', formula, spreadsheetId: SPREADSHEET_ID },
          })
        )
      );
      results.forEach((result, i) => {
        expect(result.response.success).toBe(true);
        if (result.response.success) {
          expect(result.response.result).toBe((i + 1) * 2);
        }
      });
    });
  });
});
