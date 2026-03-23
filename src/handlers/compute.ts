/**
 * ServalSheets - Compute Handler
 *
 * Standalone handler for sheets_compute tool (10 actions).
 * Routes computation requests to the compute-engine service.
 *
 * Actions: evaluate, aggregate, statistical, regression, forecast,
 *          matrix_op, pivot_compute, custom_function, batch_compute, explain_formula
 */

import { ErrorCodes } from './error-codes.js';
import { ServiceError } from '../core/errors.js';
import { assertNever } from '../utils/type-utils.js';
import { extractRangeA1 } from '../utils/range-helpers.js';
import type { sheets_v4 } from 'googleapis';
import type { SheetsComputeInput, SheetsComputeOutput } from '../schemas/compute.js';
import {
  fetchRangeData,
  aggregate,
  computeStatistics,
  computeRegression,
  computeForecast,
  matrixOp,
  computePivot,
  explainFormula,
} from '../services/compute-engine.js';
import { logger } from '../utils/logger.js';
import { generateAIInsight } from '../mcp/sampling.js';
import type { SamplingServer } from '../mcp/sampling.js';
import { DuckDBEngine } from '../services/duckdb-engine.js';
import { runPythonSafe } from '../services/python-engine.js';

type ElicitFn = (opts: {
  message: string;
  requestedSchema: unknown;
}) => Promise<{ action: string; content: unknown }>;

function resolveForecastColumnIndex(headers: string[], columnRef: string): number {
  const trimmed = columnRef.trim();

  if (/^[A-Z]+$/i.test(trimmed)) {
    let index = 0;
    for (let i = 0; i < trimmed.length; i++) {
      index = index * 26 + (trimmed.toUpperCase().charCodeAt(i) - 64);
    }
    const zeroBased = index - 1;
    if (zeroBased >= 0 && zeroBased < headers.length) {
      return zeroBased;
    }
  }

  return headers.findIndex((header) => header.trim().toLowerCase() === trimmed.toLowerCase());
}

function coerceForecastValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) {
      return undefined; // OK: Explicit empty — empty string after normalization
    }
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined; // OK: Explicit empty — unrecognized value type
}

function normalizeForecastPeriod(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `serial:${value}`;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined; // OK: Explicit empty — empty string after trim
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }

    return trimmed;
  }

  return undefined; // OK: Explicit empty — unrecognized value type
}

function validateForecastDataShape(
  data: unknown[][],
  dateColumn: string,
  valueColumn: string
):
  | {
      ok: true;
      validPointCount: number;
      distinctPeriodCount: number;
    }
  | {
      ok: false;
      error: {
        code: typeof ErrorCodes.INVALID_PARAMS;
        message: string;
        retryable: false;
        suggestedFix?: string;
        details?: Record<string, unknown>;
      };
    } {
  const headers = (data[0] ?? []).map((cell) => String(cell ?? ''));
  const dateIdx = resolveForecastColumnIndex(headers, dateColumn);
  if (dateIdx < 0) {
    return {
      ok: false,
      error: {
        code: ErrorCodes.INVALID_PARAMS,
        message: `Date column "${dateColumn}" was not found in the forecast range.`,
        retryable: false,
        suggestedFix: 'Use a valid column letter or header name for dateColumn.',
      },
    };
  }

  const valueIdx = resolveForecastColumnIndex(headers, valueColumn);
  if (valueIdx < 0) {
    return {
      ok: false,
      error: {
        code: ErrorCodes.INVALID_PARAMS,
        message: `Value column "${valueColumn}" was not found in the forecast range.`,
        retryable: false,
        suggestedFix: 'Use a valid column letter or header name for valueColumn.',
      },
    };
  }

  const periodCounts = new Map<string, number>();
  let validPointCount = 0;
  let invalidDateRows = 0;
  let invalidValueRows = 0;

  for (const row of data.slice(1)) {
    const periodKey = normalizeForecastPeriod(row?.[dateIdx]);
    const numericValue = coerceForecastValue(row?.[valueIdx]);

    if (!periodKey) {
      invalidDateRows += 1;
      continue;
    }
    if (numericValue === undefined) {
      invalidValueRows += 1;
      continue;
    }

    validPointCount += 1;
    periodCounts.set(periodKey, (periodCounts.get(periodKey) ?? 0) + 1);
  }

  if (validPointCount < 3) {
    return {
      ok: false,
      error: {
        code: ErrorCodes.INVALID_PARAMS,
        message:
          'Forecasting requires at least 3 rows with both a valid date/timestamp and a numeric value.',
        retryable: false,
        suggestedFix:
          'Select a range with a real time column and numeric values, or clean the invalid rows before forecasting.',
        details: {
          validPointCount,
          invalidDateRows,
          invalidValueRows,
        },
      },
    };
  }

  const distinctPeriodCount = periodCounts.size;
  if (distinctPeriodCount < 3) {
    return {
      ok: false,
      error: {
        code: ErrorCodes.INVALID_PARAMS,
        message: `Forecasting requires at least 3 distinct time periods, but only ${distinctPeriodCount} were found.`,
        retryable: false,
        suggestedFix:
          'Aggregate the data to one row per period first, then rerun forecast on the summarized range.',
        details: {
          validPointCount,
          distinctPeriodCount,
        },
      },
    };
  }

  const duplicatePeriods = Array.from(periodCounts.entries()).filter(([, count]) => count > 1);
  if (duplicatePeriods.length > 0) {
    return {
      ok: false,
      error: {
        code: ErrorCodes.INVALID_PARAMS,
        message:
          `Forecast input contains multiple rows for ${duplicatePeriods.length} time period(s). ` +
          'Forecasting expects one numeric value per period.',
        retryable: false,
        suggestedFix:
          'Aggregate repeated dates or timestamps into one value per period before calling forecast.',
        details: {
          distinctPeriodCount,
          duplicatePeriods: duplicatePeriods.slice(0, 5).map(([period, count]) => ({
            period,
            count,
          })),
        },
      },
    };
  }

  return {
    ok: true,
    validPointCount,
    distinctPeriodCount,
  };
}

export class ComputeHandler {
  private samplingServer?: SamplingServer;
  private duckdbEngine?: DuckDBEngine;
  private server?: { elicitInput?: ElicitFn };
  private sessionContext?: import('../services/session-context.js').SessionContextManager;

  constructor(
    private sheetsApi: sheets_v4.Sheets,
    options?: {
      samplingServer?: SamplingServer;
      duckdbEngine?: DuckDBEngine;
      server?: { elicitInput?: ElicitFn };
      sessionContext?: import('../services/session-context.js').SessionContextManager;
    }
  ) {
    this.samplingServer = options?.samplingServer;
    this.duckdbEngine = options?.duckdbEngine;
    this.server = options?.server;
    this.sessionContext = options?.sessionContext;
  }

  async handle(input: SheetsComputeInput): Promise<SheetsComputeOutput> {
    const req = input.request;
    const startMs = Date.now();

    try {
      switch (req.action) {
        case 'evaluate':
          return await this.handleEvaluate(req);
        case 'aggregate':
          return await this.handleAggregate(req);
        case 'statistical':
          return await this.handleStatistical(req);
        case 'regression':
          return await this.handleRegression(req);
        case 'forecast':
          return await this.handleForecast(req);
        case 'matrix_op':
          return await this.handleMatrixOp(req);
        case 'pivot_compute':
          return await this.handlePivotCompute(req);
        case 'custom_function':
          return await this.handleCustomFunction(req);
        case 'batch_compute':
          return await this.handleBatchCompute(req);
        case 'explain_formula':
          return await this.handleExplainFormula(req);
        case 'sql_query':
          return await this.handleSqlQuery(req);
        case 'sql_join':
          return await this.handleSqlJoin(req);
        case 'python_eval':
          return await this.handlePythonEval(req);
        case 'pandas_profile':
          return await this.handlePandasProfile(req);
        case 'sklearn_model':
          return await this.handleSklearnModel(req);
        case 'matplotlib_chart':
          return await this.handleMatplotlibChart(req);
        default:
          assertNever(req);
      }
    } catch (error) {
      const elapsed = Date.now() - startMs;
      logger.error('Compute handler error', {
        action: req.action,
        durationMs: elapsed,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        response: {
          success: false as const,
          error: {
            code: ErrorCodes.INTERNAL_ERROR,
            message: error instanceof Error ? error.message : String(error),
            retryable: false,
          },
        },
      };
    }
  }

  // ========================================================================
  // Action Handlers
  // ========================================================================

  private async handleEvaluate(
    req: SheetsComputeInput['request'] & { action: 'evaluate' }
  ): Promise<SheetsComputeOutput> {
    const startMs = Date.now();

    // For now, resolve cell references if a range is provided
    let resolvedCells: Record<string, unknown> | undefined;
    if (req.range) {
      const data = await fetchRangeData(
        this.sheetsApi,
        req.spreadsheetId,
        extractRangeA1(req.range)
      );
      resolvedCells = {};
      for (let r = 0; r < data.length; r++) {
        for (let c = 0; c < (data[r]?.length || 0); c++) {
          const colLetter = String.fromCharCode(65 + c);
          resolvedCells[`${colLetter}${r + 1}`] = data[r]![c];
        }
      }
    }

    // Simple expression evaluation for basic arithmetic
    let result: unknown;
    try {
      const cleaned = req.formula.startsWith('=') ? req.formula.slice(1) : req.formula;
      // Replace cell refs with resolved values
      let expression = cleaned;
      if (resolvedCells) {
        for (const [ref, val] of Object.entries(resolvedCells)) {
          expression = expression.replace(new RegExp(`\\b${ref}\\b`, 'gi'), String(val ?? 0));
        }
      }
      // Evaluate basic SUM, AVERAGE, etc.
      result = evaluateExpression(expression);
    } catch (e) {
      const message = `Evaluation error: ${e instanceof Error ? e.message : String(e)}`;
      return {
        response: {
          success: false as const,
          error: {
            code: ErrorCodes.OPERATION_FAILED,
            message,
            retryable: false,
          },
        },
      };
    }

    // evaluateExpression returns a string on failure (e.g. "Cannot evaluate: ...")
    if (typeof result === 'string' && result.startsWith('Cannot evaluate:')) {
      return {
        response: {
          success: false as const,
          error: {
            code: ErrorCodes.OPERATION_FAILED,
            message: result,
            retryable: false,
          },
        },
      };
    }

    return {
      response: {
        success: true,
        action: 'evaluate',
        result,
        formula: req.formula,
        resolvedCells,
        computationTimeMs: Date.now() - startMs,
      },
    };
  }

  private async handleAggregate(
    req: SheetsComputeInput['request'] & { action: 'aggregate' }
  ): Promise<SheetsComputeOutput> {
    const startMs = Date.now();
    const data = await fetchRangeData(this.sheetsApi, req.spreadsheetId, extractRangeA1(req.range));

    // Check for moving window mode
    const mwMode = req.type;
    if (mwMode === 'moving_average' || mwMode === 'moving_median' || mwMode === 'moving_sum') {
      if (!data || data.length === 0) {
        return {
          response: {
            success: false,
            error: {
              code: ErrorCodes.INVALID_PARAMS,
              message: 'No data found in the specified range',
              retryable: false,
            },
          },
        };
      }

      const headers = (data[0] || []).map(String);
      const valueCol = req.valueColumn || headers[0];
      const colIdx = headers.findIndex(
        (h) => h?.toString().toLowerCase() === valueCol?.toLowerCase()
      );

      if (colIdx < 0) {
        return {
          response: {
            success: false,
            error: {
              code: ErrorCodes.INVALID_PARAMS,
              message: `Column "${valueCol}" not found`,
              retryable: false,
            },
          },
        };
      }

      // Extract numeric values from the column
      const values: number[] = [];
      for (let i = 1; i < data.length; i++) {
        const val = data[i]?.[colIdx];
        if (val !== null && val !== undefined && val !== '' && typeof val === 'number') {
          values.push(val);
        } else if (typeof val === 'string') {
          const parsed = parseFloat(val);
          if (!isNaN(parsed)) values.push(parsed);
        }
      }

      const windowSize = Math.max(1, req.windowSize ?? 3);
      const operation = mwMode.replace('moving_', '') as 'average' | 'median' | 'sum';

      // Compute moving window
      const movingResult = computeMovingWindowResult(values, windowSize, operation);

      return {
        response: {
          success: true,
          action: 'aggregate',
          movingWindow: {
            type: mwMode,
            windowSize,
            values: movingResult,
            originalCount: values.length,
            resultCount: movingResult.length,
          },
          computationTimeMs: Date.now() - startMs,
        },
      };
    }

    // Standard aggregation mode
    const result = aggregate(data, {
      functions: req.functions,
      groupBy: req.groupBy,
    });

    return {
      response: {
        success: true,
        action: 'aggregate',
        aggregations: result.aggregations,
        groups: result.groups,
        rowCount: result.rowCount,
        computationTimeMs: Date.now() - startMs,
      },
    };
  }

  private async handleStatistical(
    req: SheetsComputeInput['request'] & { action: 'statistical' }
  ): Promise<SheetsComputeOutput> {
    const startMs = Date.now();
    const data = await fetchRangeData(this.sheetsApi, req.spreadsheetId, extractRangeA1(req.range));

    // Build moving window config if provided in request
    let movingWindowConfig:
      | { windowSize: number; operation: 'average' | 'median' | 'sum'; column: string }
      | undefined;
    if (req.movingWindow) {
      const mwConfig = req.movingWindow;
      if (mwConfig && typeof mwConfig === 'object') {
        const windowSize = mwConfig.windowSize ?? 3;
        const operation = mwConfig.operation ?? 'average';
        movingWindowConfig = {
          windowSize: Number.isFinite(windowSize) ? Math.max(1, windowSize) : 3,
          operation,
          column: mwConfig.column,
        };
      }
    }

    const result = computeStatistics(data, {
      columns: req.columns,
      // BUG-12 fix: Default percentiles when missing (e.g., via batch_compute forwarding)
      percentiles: req.percentiles ?? [25, 50, 75],
      includeCorrelations: req.includeCorrelations,
      movingWindowConfig,
    });

    // Generate AI insight interpreting statistical results
    let aiInsight: string | undefined;
    if (this.samplingServer && result.statistics) {
      const statsStr = JSON.stringify(result.statistics).slice(0, 2000);
      aiInsight = await generateAIInsight(
        this.samplingServer,
        'dataAnalysis',
        'Interpret these statistical results — what do they tell us about the data?',
        statsStr,
        { maxTokens: 400 }
      );
    }

    // Record operation in session context for LLM follow-up references
    try {
      if (this.sessionContext) {
        this.sessionContext.recordOperation({
          tool: 'sheets_compute',
          action: 'statistical',
          spreadsheetId: req.spreadsheetId,
          range: extractRangeA1(req.range),
          description: `Computed statistics on range ${extractRangeA1(req.range)}`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return {
      response: {
        success: true,
        action: 'statistical',
        statistics: result.statistics,
        correlations: result.correlations,
        correlationMatrix: result.correlationMatrix,
        computationTimeMs: Date.now() - startMs,
        ...(aiInsight !== undefined ? { aiInsight } : {}),
      },
    };
  }

  private async handleRegression(
    req: SheetsComputeInput['request'] & { action: 'regression' }
  ): Promise<SheetsComputeOutput> {
    const startMs = Date.now();
    const data = await fetchRangeData(this.sheetsApi, req.spreadsheetId, extractRangeA1(req.range));

    const result = computeRegression(data, {
      xColumn: req.xColumn,
      yColumn: req.yColumn,
      type: req.type,
      degree: req.degree,
      predict: req.predict,
    });

    return {
      response: {
        success: true,
        action: 'regression',
        coefficients: result.coefficients,
        rSquared: result.rSquared,
        equation: result.equation,
        predictions: result.predictions,
        residuals: result.residuals,
        computationTimeMs: Date.now() - startMs,
      },
    };
  }

  private async handleForecast(
    req: SheetsComputeInput['request'] & { action: 'forecast' }
  ): Promise<SheetsComputeOutput> {
    let resolvedReq = req;

    // Wizard: If range is provided but periods is missing, elicit forecast length
    if (resolvedReq.range && !resolvedReq.periods) {
      const elicitFn = this.server?.elicitInput;

      if (elicitFn) {
        try {
          const wizard = await elicitFn({
            message: 'How many periods should I forecast ahead?',
            requestedSchema: {
              type: 'object',
              properties: {
                periods: {
                  type: 'number',
                  title: 'Forecast periods',
                  description: 'How many future periods to predict? (e.g., 3, 6, 12)',
                },
              },
            },
          });
          const wizardContent = wizard?.content as Record<string, unknown> | undefined;
          const periodsRaw = wizardContent?.['periods'];
          const periods =
            typeof periodsRaw === 'number'
              ? periodsRaw
              : typeof periodsRaw === 'string'
                ? Number.parseInt(periodsRaw, 10)
                : undefined;
          if (wizard?.action === 'accept' && periods && Number.isFinite(periods) && periods > 0) {
            resolvedReq = {
              ...resolvedReq,
              periods,
            };
          }
        } catch {
          // Elicitation not available — default to 3 periods
          if (!resolvedReq.periods) {
            resolvedReq = { ...resolvedReq, periods: 3 };
          }
        }
      }
    }

    const startMs = Date.now();
    const data = await fetchRangeData(
      this.sheetsApi,
      resolvedReq.spreadsheetId,
      extractRangeA1(resolvedReq.range)
    );
    const forecastPreflight = validateForecastDataShape(
      data,
      resolvedReq.dateColumn,
      resolvedReq.valueColumn
    );
    if (!forecastPreflight.ok) {
      return {
        response: {
          success: false,
          error: forecastPreflight.error,
        },
      };
    }

    const result = computeForecast(data, {
      dateColumn: resolvedReq.dateColumn,
      valueColumn: resolvedReq.valueColumn,
      periods: resolvedReq.periods ?? 3,
      method: resolvedReq.method,
      seasonality: resolvedReq.seasonality,
    });

    // Generate AI insight explaining forecast confidence and factors
    let aiInsight: string | undefined;
    if (this.samplingServer && result.forecast) {
      const forecastStr = `Method: ${result.methodUsed}, Trend: ${JSON.stringify(result.trend).slice(0, 500)}, Forecast: ${JSON.stringify(result.forecast).slice(0, 500)}`;
      aiInsight = await generateAIInsight(
        this.samplingServer,
        'dataAnalysis',
        'Explain this forecast — how reliable is it and what factors could affect accuracy?',
        forecastStr,
        { maxTokens: 400 }
      );
    }

    return {
      response: {
        success: true,
        action: 'forecast',
        forecast: result.forecast,
        trend: result.trend,
        methodUsed: result.methodUsed,
        computationTimeMs: Date.now() - startMs,
        ...(aiInsight !== undefined ? { aiInsight } : {}),
      },
    };
  }

  private async handleMatrixOp(
    req: SheetsComputeInput['request'] & { action: 'matrix_op' }
  ): Promise<SheetsComputeOutput> {
    const startMs = Date.now();
    const data = await fetchRangeData(this.sheetsApi, req.spreadsheetId, extractRangeA1(req.range));

    // Convert to numeric matrix
    const matrix = data.map((row) =>
      row.map((cell) => (typeof cell === 'number' ? cell : parseFloat(String(cell)) || 0))
    );

    let secondMatrix: number[][] | undefined;
    if (req.secondRange) {
      const secondData = await fetchRangeData(
        this.sheetsApi,
        req.spreadsheetId,
        extractRangeA1(req.secondRange)
      );
      secondMatrix = secondData.map((row) =>
        row.map((cell) => (typeof cell === 'number' ? cell : parseFloat(String(cell)) || 0))
      );
    }

    const result = matrixOp(matrix, req.operation, secondMatrix);

    // Optionally write result
    let written = false;
    if (req.outputRange && result.matrix) {
      const { executeWithRetry } = await import('../utils/retry.js');
      await executeWithRetry(async () =>
        this.sheetsApi.spreadsheets.values.update({
          spreadsheetId: req.spreadsheetId,
          range: extractRangeA1(req.outputRange!),
          valueInputOption: 'RAW',
          requestBody: { values: result.matrix },
        })
      );
      written = true;
    }

    return {
      response: {
        success: true,
        action: 'matrix_op',
        matrix: result.matrix,
        scalar: result.scalar,
        eigenvalues: result.eigenvalues,
        written,
        computationTimeMs: Date.now() - startMs,
      },
    };
  }

  private async handlePivotCompute(
    req: SheetsComputeInput['request'] & { action: 'pivot_compute' }
  ): Promise<SheetsComputeOutput> {
    const startMs = Date.now();
    const data = await fetchRangeData(this.sheetsApi, req.spreadsheetId, extractRangeA1(req.range));

    const result = computePivot(data, {
      rows: req.rows,
      columns: req.columns,
      values: req.values,
      filters: req.filters,
    });

    return {
      response: {
        success: true,
        action: 'pivot_compute',
        pivotTable: result,
        computationTimeMs: Date.now() - startMs,
      },
    };
  }

  private async handleCustomFunction(
    req: SheetsComputeInput['request'] & { action: 'custom_function' }
  ): Promise<SheetsComputeOutput> {
    const startMs = Date.now();
    const data = await fetchRangeData(this.sheetsApi, req.spreadsheetId, extractRangeA1(req.range));
    const headers = (data[0] || []).map(String);
    const rows = data.slice(1);

    // Evaluate expression for each row
    const values: unknown[] = [];

    // BUG-19 fix: Detect if expression uses bare 'x' variable (no $ prefix).
    // LLMs commonly send "x * 1.1" instead of "$ColumnName * 1.1".
    // When 'x' is used and the range has a single data column (or we can infer
    // the target column), substitute x with each row's value.
    const usesBareX = /\bx\b/.test(req.expression) && !/\$/.test(req.expression);

    for (const row of rows) {
      let expr = req.expression;

      if (usesBareX) {
        // Single-variable mode: substitute 'x' with the first (or only) numeric value
        // If range is a single column, use that value. Otherwise use first column.
        const numericIndices = headers
          .map((_, i) => i)
          .filter((i) => typeof row[i] === 'number' || !isNaN(Number(row[i])));
        const targetIdx = numericIndices.length === 1 ? numericIndices[0]! : 0;
        const cellVal = row[targetIdx] ?? 0;
        expr = expr.replace(/\bx\b/g, String(cellVal));
      }

      // Replace $ColumnName and $A, $B etc. with actual values
      for (let i = 0; i < headers.length; i++) {
        const headerName = headers[i]!;
        const colLetter = String.fromCharCode(65 + i);
        const cellVal = row[i] ?? 0;
        expr = expr.replace(new RegExp(`\\$${headerName}`, 'gi'), String(cellVal));
        expr = expr.replace(new RegExp(`\\$${colLetter}\\b`, 'g'), String(cellVal));
      }
      try {
        values.push(evaluateExpression(expr));
      } catch {
        values.push(null);
      }
    }

    // Write to output column if specified
    let writtenToColumn: string | undefined;
    if (req.outputColumn) {
      const colIdx = headers.indexOf(req.outputColumn);
      const targetCol =
        colIdx >= 0 ? String.fromCharCode(65 + colIdx) : String.fromCharCode(65 + headers.length);
      const writeRange = `${targetCol}1:${targetCol}${rows.length + 1}`;
      const writeValues = [[req.outputColumn], ...values.map((v) => [v])];

      const { executeWithRetry } = await import('../utils/retry.js');
      await executeWithRetry(async () =>
        this.sheetsApi.spreadsheets.values.update({
          spreadsheetId: req.spreadsheetId,
          range: writeRange,
          valueInputOption: 'RAW',
          requestBody: { values: writeValues },
        })
      );
      writtenToColumn = req.outputColumn;
    }

    return {
      response: {
        success: true,
        action: 'custom_function',
        values,
        writtenToColumn,
        rowCount: rows.length,
        computationTimeMs: Date.now() - startMs,
      },
    };
  }

  private async handleBatchCompute(
    req: SheetsComputeInput['request'] & { action: 'batch_compute' }
  ): Promise<SheetsComputeOutput> {
    const startMs = Date.now();
    const results: Array<{ id: string; success: boolean; result?: unknown; error?: string }> = [];

    for (const computation of req.computations) {
      try {
        const subInput: SheetsComputeInput = {
          request: {
            ...computation.params,
            action: computation.type,
            spreadsheetId: req.spreadsheetId,
            verbosity: req.verbosity,
          } as SheetsComputeInput['request'],
        };
        const subResult = await this.handle(subInput);
        if (subResult.response.success) {
          const {
            action: _action,
            success: _success,
            computationTimeMs: _computationTimeMs,
            ...rest
          } = subResult.response;
          results.push({ id: computation.id, success: true, result: rest });
        } else {
          results.push({
            id: computation.id,
            success: false,
            error: subResult.response.error.message,
          });
          if (req.stopOnError) break;
        }
      } catch (error) {
        results.push({
          id: computation.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
        if (req.stopOnError) break;
      }
    }

    return {
      response: {
        success: true,
        action: 'batch_compute',
        results,
        computationTimeMs: Date.now() - startMs,
      },
    };
  }

  private async handleExplainFormula(
    req: SheetsComputeInput['request'] & { action: 'explain_formula' }
  ): Promise<SheetsComputeOutput> {
    const startMs = Date.now();
    const explanation = explainFormula(req.formula);

    // Resolve cell references if range provided
    if (req.range) {
      const data = await fetchRangeData(
        this.sheetsApi,
        req.spreadsheetId,
        extractRangeA1(req.range)
      );
      for (const ref of explanation.references) {
        // Try to resolve each reference from the data
        const cellMatch = ref.ref.match(/^([A-Z]+)(\d+)$/i);
        if (cellMatch) {
          const colIdx = cellMatch[1]!.toUpperCase().charCodeAt(0) - 65;
          const rowIdx = parseInt(cellMatch[2]!) - 1;
          if (data[rowIdx] && data[rowIdx]![colIdx] !== undefined) {
            (ref as { ref: string; value?: unknown }).value = data[rowIdx]![colIdx];
          }
        }
      }
    }

    // Generate AI insight with enhanced formula explanation
    let aiInsight: string | undefined;
    if (this.samplingServer) {
      const explainStr = `Formula: ${req.formula}\nBreakdown: ${JSON.stringify(explanation).slice(0, 1500)}`;
      aiInsight = await generateAIInsight(
        this.samplingServer,
        'formulaExplanation',
        'Provide a detailed, plain-language explanation of this formula including edge cases',
        explainStr,
        { maxTokens: 500 }
      );
    }

    return {
      response: {
        success: true,
        action: 'explain_formula',
        explanation,
        computationTimeMs: Date.now() - startMs,
        ...(aiInsight !== undefined ? { aiInsight } : {}),
      },
    };
  }
  // ========================================================================
  // Phase 1: DuckDB SQL Analytics
  // ========================================================================

  private async handleSqlQuery(
    req: SheetsComputeInput['request'] & { action: 'sql_query' }
  ): Promise<SheetsComputeOutput> {
    if (!this.duckdbEngine) {
      return {
        response: {
          success: false as const,
          error: {
            code: ErrorCodes.NOT_FOUND,
            message: 'DuckDB engine not available — pass duckdbEngine in ComputeHandler options',
            retryable: false,
          },
        },
      };
    }

    const tableData: Array<{
      name: string;
      range: string;
      hasHeaders: boolean;
      rows: unknown[][];
    }> = [];

    for (const table of req.tables) {
      const rows = await fetchRangeData(
        this.sheetsApi,
        req.spreadsheetId,
        extractRangeA1(table.range)
      );
      tableData.push({
        name: table.name,
        range: extractRangeA1(table.range),
        hasHeaders: table.hasHeaders,
        rows,
      });
    }

    try {
      const result = await this.duckdbEngine.query({
        tables: tableData,
        sql: req.sql,
        timeoutMs: req.timeoutMs,
      });

      return {
        response: {
          success: true as const,
          action: 'sql_query',
          sqlColumns: result.columns,
          sqlRows: result.rows,
          sqlExecutionMs: result.executionMs,
          rowsReturned: result.rows.length,
        },
      };
    } catch (err) {
      const code =
        err instanceof ServiceError && err.code === ErrorCodes.QUERY_REJECTED
          ? ErrorCodes.QUERY_REJECTED
          : ErrorCodes.INTERNAL_ERROR;
      return {
        response: {
          success: false as const,
          error: {
            code,
            message: err instanceof Error ? err.message : 'DuckDB sql_query failed',
            retryable: false,
          },
        },
      };
    }
  }

  private async handleSqlJoin(
    req: SheetsComputeInput['request'] & { action: 'sql_join' }
  ): Promise<SheetsComputeOutput> {
    if (!this.duckdbEngine) {
      return {
        response: {
          success: false as const,
          error: {
            code: ErrorCodes.NOT_FOUND,
            message: 'DuckDB engine not available — pass duckdbEngine in ComputeHandler options',
            retryable: false,
          },
        },
      };
    }

    const leftRows = await fetchRangeData(
      this.sheetsApi,
      req.spreadsheetId,
      extractRangeA1(req.left.range)
    );
    const rightRows = await fetchRangeData(
      this.sheetsApi,
      req.spreadsheetId,
      extractRangeA1(req.right.range)
    );

    const select = req.select ?? '*';
    const sql = `SELECT ${select} FROM "${req.left.alias}" ${req.joinType.toUpperCase()} JOIN "${req.right.alias}" ON ${req.on}`;

    try {
      const result = await this.duckdbEngine.query({
        tables: [
          {
            name: req.left.alias,
            range: extractRangeA1(req.left.range),
            hasHeaders: true,
            rows: leftRows,
          },
          {
            name: req.right.alias,
            range: extractRangeA1(req.right.range),
            hasHeaders: true,
            rows: rightRows,
          },
        ],
        sql,
        timeoutMs: req.timeoutMs,
      });

      return {
        response: {
          success: true as const,
          action: 'sql_join',
          sqlColumns: result.columns,
          sqlRows: result.rows,
          sqlExecutionMs: result.executionMs,
          rowsReturned: result.rows.length,
        },
      };
    } catch (err) {
      const code =
        err instanceof ServiceError && err.code === ErrorCodes.QUERY_REJECTED
          ? ErrorCodes.QUERY_REJECTED
          : ErrorCodes.INTERNAL_ERROR;
      return {
        response: {
          success: false as const,
          error: {
            code,
            message: err instanceof Error ? err.message : 'DuckDB sql_join failed',
            retryable: false,
          },
        },
      };
    }
  }

  // ========================================================================
  // Phase 2: Pyodide Python Bridge
  // ========================================================================

  private async handlePythonEval(
    req: SheetsComputeInput['request'] & { action: 'python_eval' }
  ): Promise<SheetsComputeOutput> {
    try {
      const rows = await fetchRangeData(
        this.sheetsApi,
        req.spreadsheetId,
        extractRangeA1(req.range)
      );

      // Make data available as both `data` (raw list-of-lists) and `df` (DataFrame)
      const dfCode =
        req.hasHeaders !== false && rows.length > 1
          ? `
import pandas as pd
_headers = data[0] if data else []
_datarows = data[1:] if data else []
df = pd.DataFrame(_datarows, columns=_headers)
df = df.apply(pd.to_numeric, errors='ignore')
`
          : '';

      const fullCode = dfCode
        ? `${dfCode}
${req.code}`
        : req.code;

      const pyResult = await runPythonSafe(fullCode, { data: rows }, req.timeoutMs ?? 60000);

      return {
        response: {
          success: true as const,
          action: 'python_eval',
          pythonResult: pyResult.result,
          pythonOutput: pyResult.output,
          pythonExecutionMs: pyResult.executionMs,
        },
      };
    } catch (err) {
      logger.error('Python eval error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        response: {
          success: false as const,
          error: {
            code: ErrorCodes.INTERNAL_ERROR,
            message: err instanceof Error ? err.message : 'Python execution failed',
            retryable: false,
          },
        },
      };
    }
  }

  private async handlePandasProfile(
    req: SheetsComputeInput['request'] & { action: 'pandas_profile' }
  ): Promise<SheetsComputeOutput> {
    try {
      const rows = await fetchRangeData(
        this.sheetsApi,
        req.spreadsheetId,
        extractRangeA1(req.range)
      );
      const hasHeaders = req.hasHeaders !== false;
      const includeCorrelations = req.includeCorrelations !== false;

      // BUG-20 fix: Support optional columns filter
      const columnFilter = (req as Record<string, unknown>)['columns'] as string[] | undefined;
      const columnFilterPy = columnFilter ? JSON.stringify(columnFilter) : 'None';

      const code = `
import pandas as pd
import json

rows = data
if len(rows) < 2:
    result = {'stats': {}, 'correlations': {}}
else:
    headers = rows[0] if ${hasHeaders ? 'True' : 'False'} else [f'col{i}' for i in range(len(rows[0]))]
    data_rows = rows[1:] if ${hasHeaders ? 'True' : 'False'} else rows
    df = pd.DataFrame(data_rows, columns=headers)
    df = df.apply(pd.to_numeric, errors='ignore')

    # Filter to requested columns if specified
    _col_filter = ${columnFilterPy}
    if _col_filter is not None:
        _valid_cols = [c for c in _col_filter if c in df.columns]
        if _valid_cols:
            df = df[_valid_cols]

    stats = {}
    for col in df.columns:
        s = df[col]
        if pd.api.types.is_numeric_dtype(s):
            stats[col] = {
                'type': 'numeric',
                'count': int(s.count()),
                'mean': float(s.mean()) if not pd.isna(s.mean()) else None,
                'std': float(s.std()) if not pd.isna(s.std()) else None,
                'min': float(s.min()) if not pd.isna(s.min()) else None,
                'max': float(s.max()) if not pd.isna(s.max()) else None,
                'median': float(s.median()) if not pd.isna(s.median()) else None,
                'null_count': int(s.isna().sum()),
            }
        else:
            vc = s.value_counts()
            stats[col] = {
                'type': 'categorical',
                'count': int(s.count()),
                'unique': int(s.nunique()),
                'top': str(vc.index[0]) if len(vc) > 0 else None,
                'top_freq': int(vc.iloc[0]) if len(vc) > 0 else 0,
                'null_count': int(s.isna().sum()),
            }

    corr = {}
    numeric_cols = df.select_dtypes(include='number')
    if ${includeCorrelations ? 'True' : 'False'} and len(numeric_cols.columns) > 1:
        corr_df = numeric_cols.corr()
        corr = {col: {c: float(v) if not pd.isna(v) else None for c, v in row.items()} for col, row in corr_df.to_dict().items()}

    result = {'stats': stats, 'correlations': corr}

result
`;

      const pyResult = await runPythonSafe(code, { data: rows }, 120000);
      const res = pyResult.result as { stats?: unknown; correlations?: unknown } | null;

      // Filter out non-numeric correlation values (null, strings, etc.)
      const rawCorr = (res?.correlations ?? {}) as Record<string, Record<string, unknown>>;
      const correlations: Record<string, Record<string, number>> = {};
      for (const [row, cols] of Object.entries(rawCorr)) {
        const filteredCols: Record<string, number> = {};
        for (const [col, val] of Object.entries(cols)) {
          if (typeof val === 'number' && Number.isFinite(val)) {
            filteredCols[col] = val;
          }
        }
        if (Object.keys(filteredCols).length > 0) {
          correlations[row] = filteredCols;
        }
      }

      return {
        response: {
          success: true as const,
          action: 'pandas_profile',
          profileStats: (res?.stats ?? {}) as Record<string, unknown>,
          correlations,
          pythonExecutionMs: pyResult.executionMs,
        },
      };
    } catch (err) {
      logger.error('Pandas profile error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        response: {
          success: false as const,
          error: {
            code: ErrorCodes.INTERNAL_ERROR,
            message: err instanceof Error ? err.message : 'Pandas profiling failed',
            retryable: false,
          },
        },
      };
    }
  }

  private async handleSklearnModel(
    req: SheetsComputeInput['request'] & { action: 'sklearn_model' }
  ): Promise<SheetsComputeOutput> {
    try {
      const rows = await fetchRangeData(
        this.sheetsApi,
        req.spreadsheetId,
        extractRangeA1(req.range)
      );

      const targetColumn = req.targetColumn;
      const featureColumns = req.featureColumns ?? null;
      const modelType = req.modelType;
      const testSize = req.testSize ?? 0.2;

      const code = `
import pandas as pd
import numpy as np
import json

rows = data
if len(rows) < 3:
    result = {'error': 'Not enough data for modeling (need at least 3 rows)'}
else:
    headers = rows[0]
    data_rows = rows[1:]
    df = pd.DataFrame(data_rows, columns=headers)
    df = df.apply(pd.to_numeric, errors='ignore')

    target_col = "${targetColumn}"
    if target_col not in df.columns:
        result = {'error': f'Target column "{target_col}" not found. Available: {list(df.columns)}'}
    else:
        feature_cols = ${featureColumns ? JSON.stringify(featureColumns) : 'None'}
        if feature_cols is None:
            feature_cols = [c for c in df.columns if c != target_col]

        feature_cols = [c for c in feature_cols if c in df.columns]
        X = df[feature_cols].select_dtypes(include='number')
        y = df[target_col]

        # Drop rows with NaN
        mask = X.notna().all(axis=1) & y.notna()
        X = X[mask]
        y = y[mask]

        if len(X) < 4:
            result = {'error': 'Not enough complete rows after dropping NaN values'}
        else:
            from sklearn.model_selection import train_test_split

            test_size_val = ${testSize}
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=test_size_val, random_state=42)

            model_type = "${modelType}"
            metrics = {}
            importances = {}

            if model_type == 'linear_regression':
                from sklearn.linear_model import LinearRegression
                from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
                model = LinearRegression()
                model.fit(X_train, y_train)
                y_pred = model.predict(X_test)
                metrics['r2'] = float(r2_score(y_test, y_pred))
                metrics['mse'] = float(mean_squared_error(y_test, y_pred))
                metrics['mae'] = float(mean_absolute_error(y_test, y_pred))
                for col, coef in zip(X.columns, model.coef_):
                    importances[col] = float(abs(coef))

            elif model_type == 'ridge':
                from sklearn.linear_model import Ridge
                from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
                model = Ridge()
                model.fit(X_train, y_train)
                y_pred = model.predict(X_test)
                metrics['r2'] = float(r2_score(y_test, y_pred))
                metrics['mse'] = float(mean_squared_error(y_test, y_pred))
                metrics['mae'] = float(mean_absolute_error(y_test, y_pred))
                for col, coef in zip(X.columns, model.coef_):
                    importances[col] = float(abs(coef))

            elif model_type == 'logistic_regression':
                from sklearn.linear_model import LogisticRegression
                from sklearn.metrics import accuracy_score
                model = LogisticRegression(max_iter=1000)
                model.fit(X_train, y_train)
                y_pred = model.predict(X_test)
                metrics['accuracy'] = float(accuracy_score(y_test, y_pred))

            elif model_type == 'random_forest':
                from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
                from sklearn.metrics import accuracy_score, r2_score
                # Heuristic: use classifier for low-cardinality targets, regressor otherwise
                y_numeric = pd.to_numeric(y, errors='coerce')
                if y_numeric.isna().any() or y.nunique() <= 10:
                    model = RandomForestClassifier(n_estimators=100, random_state=42)
                    model.fit(X_train, y_train)
                    y_pred = model.predict(X_test)
                    metrics['accuracy'] = float(accuracy_score(y_test, y_pred))
                else:
                    model = RandomForestRegressor(n_estimators=100, random_state=42)
                    model.fit(X_train, y_train)
                    y_pred = model.predict(X_test)
                    metrics['r2'] = float(r2_score(y_test, y_pred))
                for col, imp in zip(X.columns, model.feature_importances_):
                    importances[col] = float(imp)

            elif model_type == 'kmeans':
                from sklearn.cluster import KMeans
                k = min(5, len(X) // 2)
                model = KMeans(n_clusters=k, random_state=42, n_init='auto')
                model.fit(X)
                metrics['inertia'] = float(model.inertia_)
                metrics['clusters'] = k

            result = {
                'metrics': metrics,
                'feature_importances': importances,
                'feature_columns': list(X.columns),
                'samples_train': len(X_train),
                'samples_test': len(X_test),
            }

result
`;

      const pyResult = await runPythonSafe(code, { data: rows }, 120000);
      const res = pyResult.result as {
        metrics?: Record<string, number>;
        feature_importances?: Record<string, number>;
        error?: string;
      } | null;

      if (res?.error) {
        return {
          response: {
            success: false as const,
            error: { code: ErrorCodes.INVALID_PARAMS, message: res.error, retryable: false },
          },
        };
      }

      return {
        response: {
          success: true as const,
          action: 'sklearn_model',
          modelMetrics: res?.metrics as {
            accuracy?: number;
            r2?: number;
            mse?: number;
            mae?: number;
          },
          featureImportances: res?.feature_importances,
          pythonExecutionMs: pyResult.executionMs,
        },
      };
    } catch (err) {
      logger.error('Sklearn model error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        response: {
          success: false as const,
          error: {
            code: ErrorCodes.INTERNAL_ERROR,
            message: err instanceof Error ? err.message : 'Model training failed',
            retryable: false,
          },
        },
      };
    }
  }

  private async handleMatplotlibChart(
    req: SheetsComputeInput['request'] & { action: 'matplotlib_chart' }
  ): Promise<SheetsComputeOutput> {
    try {
      const rows = await fetchRangeData(
        this.sheetsApi,
        req.spreadsheetId,
        extractRangeA1(req.range)
      );

      const chartType = req.chartType;
      const xColumn = req.xColumn ?? null;
      const yColumns = req.yColumns ?? null;
      const title = req.title ?? '';
      const width = req.width ?? 800;
      const height = req.height ?? 600;

      const code = `
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # non-interactive backend
import matplotlib.pyplot as plt
import io, base64

rows = data
if len(rows) < 2:
    result = {'error': 'Not enough data'}
else:
    headers = rows[0]
    data_rows = rows[1:]
    df = pd.DataFrame(data_rows, columns=headers)
    df = df.apply(pd.to_numeric, errors='ignore')

    dpi = 96
    fig_w = ${width} / dpi
    fig_h = ${height} / dpi
    fig, ax = plt.subplots(figsize=(fig_w, fig_h), dpi=dpi)

    chart_type = "${chartType}"
    x_col = ${xColumn ? `"${xColumn}"` : 'None'}
    y_cols_raw = ${yColumns ? JSON.stringify(yColumns) : 'None'}
    y_cols = [c for c in (y_cols_raw or []) if c in df.columns] or list(df.select_dtypes(include='number').columns)
    title_str = "${title.replace(/"/g, '\\"')}"

    if chart_type == 'line':
        for col in y_cols:
            if x_col and x_col in df.columns:
                ax.plot(df[x_col], df[col], label=col)
            else:
                ax.plot(df[col], label=col)
        if len(y_cols) > 1:
            ax.legend()

    elif chart_type == 'bar':
        if x_col and x_col in df.columns:
            for col in y_cols:
                ax.bar(df[x_col], df[col], label=col, alpha=0.7)
        else:
            for col in y_cols:
                ax.bar(range(len(df)), df[col], label=col, alpha=0.7)
        if len(y_cols) > 1:
            ax.legend()

    elif chart_type == 'scatter':
        if x_col and x_col in df.columns and len(y_cols) > 0:
            ax.scatter(df[x_col], df[y_cols[0]], alpha=0.6)
            ax.set_xlabel(x_col)
            ax.set_ylabel(y_cols[0])
        elif len(y_cols) >= 2:
            ax.scatter(df[y_cols[0]], df[y_cols[1]], alpha=0.6)
            ax.set_xlabel(y_cols[0])
            ax.set_ylabel(y_cols[1])

    elif chart_type == 'histogram':
        col = y_cols[0] if y_cols else df.select_dtypes(include='number').columns[0]
        ax.hist(df[col].dropna(), bins='auto', edgecolor='black', alpha=0.7)
        ax.set_xlabel(col)

    elif chart_type == 'boxplot':
        numeric_df = df[y_cols] if y_cols else df.select_dtypes(include='number')
        numeric_df.boxplot(ax=ax)

    elif chart_type == 'heatmap':
        numeric_df = df[y_cols] if y_cols else df.select_dtypes(include='number')
        corr = numeric_df.corr()
        im = ax.imshow(corr.values, cmap='coolwarm', vmin=-1, vmax=1)
        ax.set_xticks(range(len(corr.columns)))
        ax.set_yticks(range(len(corr.columns)))
        ax.set_xticklabels(corr.columns, rotation=45, ha='right')
        ax.set_yticklabels(corr.columns)
        plt.colorbar(im, ax=ax)

    if title_str:
        ax.set_title(title_str)

    plt.tight_layout()

    buf = io.BytesIO()
    plt.savefig(buf, format='png', dpi=dpi)
    plt.close(fig)
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode('utf-8')
    result = {'image': f'data:image/png;base64,{b64}'}

result
`;

      const pyResult = await runPythonSafe(code, { data: rows }, 120000);
      const res = pyResult.result as { image?: string; error?: string } | null;

      if (res?.error) {
        return {
          response: {
            success: false as const,
            error: { code: ErrorCodes.INVALID_PARAMS, message: res.error, retryable: false },
          },
        };
      }

      return {
        response: {
          success: true as const,
          action: 'matplotlib_chart',
          chartImage: res?.image,
          pythonExecutionMs: pyResult.executionMs,
        },
      };
    } catch (err) {
      logger.error('Matplotlib chart error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        response: {
          success: false as const,
          error: {
            code: ErrorCodes.INTERNAL_ERROR,
            message: err instanceof Error ? err.message : 'Chart generation failed',
            retryable: false,
          },
        },
      };
    }
  }
}

// ============================================================================
// Moving Window Helper
// ============================================================================

function computeMovingWindowResult(
  data: number[],
  windowSize: number,
  operation: 'average' | 'median' | 'sum'
): number[] {
  const result: number[] = [];
  const size = Math.max(1, Math.min(windowSize, data.length));

  for (let i = 0; i <= data.length - size; i++) {
    const window = data.slice(i, i + size);
    switch (operation) {
      case 'average':
        result.push(window.reduce((a, b) => a + b, 0) / window.length);
        break;
      case 'median': {
        const sorted = [...window].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        result.push(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
        break;
      }
      case 'sum':
        result.push(window.reduce((a, b) => a + b, 0));
        break;
    }
  }
  return result;
}

// ============================================================================
// Simple Expression Evaluator
// ============================================================================

function evaluateExpression(expr: string): number | string {
  // Handle IF function (ternary: IF(condition, true_value, false_value))
  // Need to parse carefully to handle nested parentheses in arguments
  const ifStart = /\bIF\s*\(/i.exec(expr);
  if (ifStart) {
    const startIndex = ifStart.index + ifStart[0].length - 1; // Position of opening paren
    let depth = 0;
    let commaPositions: number[] = [];
    let i = startIndex;

    // Find matching closing paren and comma positions at depth 1
    for (i = startIndex; i < expr.length; i++) {
      if (expr[i] === '(') depth++;
      else if (expr[i] === ')') {
        depth--;
        if (depth === 0) break;
      } else if (expr[i] === ',' && depth === 1) {
        commaPositions.push(i);
      }
    }

    const endIndex = i;
    if (commaPositions.length === 2 && depth === 0) {
      // Found IF with 3 arguments
      const condition = expr.substring(startIndex + 1, commaPositions[0]!).trim();
      const trueVal = expr.substring(commaPositions[0]! + 1, commaPositions[1]!).trim();
      const falseVal = expr.substring(commaPositions[1]! + 1, endIndex).trim();

      try {
        // Evaluate condition
        const condSanitized = condition.replace(/[^0-9+\-*/().<%>=!&|\s]/g, '');
        const condFn = new Function(`"use strict"; return (${condSanitized})`);
        const condResult = condFn();
        // Return appropriate branch
        const resultExpr = condResult ? trueVal : falseVal;
        return evaluateExpression(resultExpr);
      } catch {
        // Fallback if condition evaluation fails
        return `Cannot evaluate: ${expr}`;
      }
    }
  }

  // Handle common spreadsheet functions
  const funcPattern =
    /\b(SUM|AVERAGE|COUNT|MIN|MAX|ABS|ROUND|SQRT|POW|LOG|LN|EXP|MOD|CEIL|FLOOR)\s*\(([^)]*)\)/gi;
  let processed = expr;

  let match;
  while ((match = funcPattern.exec(processed)) !== null) {
    const fnName = match[1]!.toUpperCase();
    const argsStr = match[2]!;
    const args = argsStr.split(',').map((a) => {
      const trimmed = a.trim();
      const num = parseFloat(trimmed);
      return isNaN(num) ? 0 : num;
    });

    let result: number;
    switch (fnName) {
      case 'SUM':
        result = args.reduce((a, b) => a + b, 0);
        break;
      case 'AVERAGE':
        result = args.length > 0 ? args.reduce((a, b) => a + b, 0) / args.length : 0;
        break;
      case 'COUNT':
        result = args.length;
        break;
      case 'MIN':
        result = Math.min(...args);
        break;
      case 'MAX':
        result = Math.max(...args);
        break;
      case 'ABS':
        result = Math.abs(args[0] || 0);
        break;
      case 'ROUND':
        result =
          Math.round((args[0] || 0) * Math.pow(10, args[1] || 0)) / Math.pow(10, args[1] || 0);
        break;
      case 'SQRT':
        result = Math.sqrt(args[0] || 0);
        break;
      case 'POW':
        result = Math.pow(args[0] || 0, args[1] || 0);
        break;
      case 'LOG':
        result = Math.log10(args[0] || 1);
        break;
      case 'LN':
        result = Math.log(args[0] || 1);
        break;
      case 'EXP':
        result = Math.exp(args[0] || 0);
        break;
      case 'MOD':
        result = (args[0] || 0) % (args[1] || 1);
        break;
      case 'CEIL':
      case 'CEILING':
        result = Math.ceil(args[0] || 0);
        break;
      case 'FLOOR':
        result = Math.floor(args[0] || 0);
        break;
      default:
        result = 0;
    }

    processed =
      processed.slice(0, match.index) +
      String(result) +
      processed.slice(match.index! + match[0].length);
    funcPattern.lastIndex = 0; // Reset for nested functions
  }

  // Evaluate remaining arithmetic
  try {
    // Sanitize: only allow numbers, operators, parentheses, spaces, dots
    const sanitized = processed.replace(/[^0-9+\-*/().%\s]/g, '');
    if (sanitized.trim() === '') return 0;
    // Use Function constructor for safe arithmetic evaluation
    const fn = new Function(`"use strict"; return (${sanitized})`);
    const result = fn();
    return typeof result === 'number' && isFinite(result) ? result : 0;
  } catch {
    return `Cannot evaluate: ${expr}`;
  }
}
