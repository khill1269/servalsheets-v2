/**
 * ServalSheets - Computation Engine
 *
 * Server-side computation for spreadsheet data.
 * Provides deterministic math, statistics, forecasting, and matrix operations
 * without requiring AI/Sampling round-trips.
 *
 * Design: Stateless module-level functions, dynamically imported by handler.
 */

import type { sheets_v4 } from 'googleapis';
import { executeWithRetry } from '../utils/retry.js';
import { ValidationError, NotFoundError } from '../core/errors.js';
import {
  computeCorrelation,
  computeEigenvaluesQR,
  computeMedian,
  computeMode,
  computeMovingWindow,
  computePercentile,
  computeRank,
  computeStddev,
  computeVariance,
  determinant,
  invertMatrix,
  linearRegression,
  matrixMultiply,
  polynomialRegression,
  predictValue,
  transpose,
} from './compute-engine-math.js';
// logger imported for future use in compute engine

// ============================================================================
// Types
// ============================================================================

export interface AggregateOptions {
  functions: string[];
  groupBy?: string;
}

export interface AggregateResult {
  aggregations: Record<string, number | null>;
  groups?: Array<{
    key: string | number | boolean | null;
    aggregations: Record<string, number | null>;
    rowCount: number;
  }>;
  rowCount: number;
}

export interface StatisticalOptions {
  columns?: string[];
  percentiles: number[];
  includeCorrelations: boolean;
  movingWindowConfig?: {
    windowSize: number;
    operation: 'average' | 'median' | 'sum';
    column: string;
  };
}

export interface ColumnStats {
  count: number;
  mean: number | null;
  median: number | null;
  mode?: number | null;
  stddev: number | null;
  variance: number | null;
  min: number | null;
  max: number | null;
  range: number | null;
  skewness?: number | null;
  kurtosis?: number | null;
  percentiles?: Record<string, number>;
  nullCount?: number;
  movingWindow?: number[];
}

export interface CorrelationMatrix {
  columns: string[];
  matrix: number[][];
}

export interface RegressionOptions {
  xColumn: string;
  yColumn: string;
  type: 'linear' | 'polynomial' | 'exponential' | 'logarithmic' | 'power';
  degree: number;
  predict?: number[];
}

export interface RegressionResult {
  coefficients: number[];
  rSquared: number;
  equation: string;
  predictions?: Array<{ x: number; y: number }>;
  residuals: { mean: number; stddev: number; max: number };
}

export interface ForecastOptions {
  dateColumn: string;
  valueColumn: string;
  periods: number;
  method: 'linear_trend' | 'moving_average' | 'exponential_smoothing' | 'auto';
  seasonality?: number;
}

export interface ForecastResult {
  forecast: Array<{
    period: string | number;
    value: number;
    lowerBound?: number;
    upperBound?: number;
  }>;
  trend: {
    direction: 'increasing' | 'decreasing' | 'stable';
    strength: number;
    seasonalityDetected: boolean;
    seasonalPeriod?: number;
  };
  methodUsed: string;
}

export interface PivotOptions {
  rows: string[];
  columns?: string[];
  values: Array<{ column: string; function: string }>;
  filters?: Array<{ column: string; values: Array<string | number | boolean> }>;
}

export interface PivotResult {
  headers: string[];
  rows: Array<Array<string | number | null>>;
  totals?: Record<string, number>;
}

type CellValue = string | number | boolean | null;

// ============================================================================
// Data Fetching
// ============================================================================

export async function fetchRangeData(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string
): Promise<CellValue[][]> {
  const response = await executeWithRetry(async () =>
    sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    })
  );
  return (response.data.values as CellValue[][]) || [];
}

function resolveColumnIndex(headers: string[], col: string): number {
  // Try as column letter first (A, B, C, ...)
  if (/^[A-Z]{1,3}$/i.test(col)) {
    let idx = 0;
    for (let i = 0; i < col.length; i++) {
      idx = idx * 26 + (col.toUpperCase().charCodeAt(i) - 64);
    }
    return idx - 1; // 0-based
  }
  // Try as header name
  const headerIdx = headers.findIndex((h) => h?.toString().toLowerCase() === col.toLowerCase());
  if (headerIdx >= 0) return headerIdx;
  throw new NotFoundError('column', col, { availableHeaders: headers.join(', ') });
}

function extractNumericColumn(data: CellValue[][], colIdx: number): number[] {
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
  return values;
}

// ============================================================================
// Aggregation
// ============================================================================

export function aggregate(data: CellValue[][], options: AggregateOptions): AggregateResult {
  const headers = (data[0] || []).map(String);
  const rows = data.slice(1);

  if (options.groupBy) {
    const groupIdx = resolveColumnIndex(headers, options.groupBy);
    const groups = new Map<string, CellValue[][]>();
    for (const row of rows) {
      const key = String(row[groupIdx] ?? 'null');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    const groupResults = Array.from(groups.entries()).map(([key, groupRows]) => ({
      key: key === 'null' ? null : key,
      aggregations: computeAggregations(groupRows, options.functions),
      rowCount: groupRows.length,
    }));
    return {
      aggregations: computeAggregations(rows, options.functions),
      groups: groupResults,
      rowCount: rows.length,
    };
  }

  return { aggregations: computeAggregations(rows, options.functions), rowCount: rows.length };
}

function computeAggregations(
  rows: CellValue[][],
  functions: string[]
): Record<string, number | null> {
  const numericValues: number[] = [];
  for (const row of rows) {
    for (const cell of row) {
      if (typeof cell === 'number') numericValues.push(cell);
      else if (typeof cell === 'string') {
        const parsed = parseFloat(cell);
        if (!isNaN(parsed)) numericValues.push(parsed);
      }
    }
  }

  const result: Record<string, number | null> = {};
  for (const fn of functions) {
    result[fn] = computeAggFn(numericValues, fn, rows);
  }
  return result;
}

function computeAggFn(values: number[], fn: string, rows: CellValue[][]): number | null {
  if (values.length === 0 && !['count', 'counta', 'countblank'].includes(fn)) return null;
  switch (fn) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'average':
      return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
    case 'count':
      return values.length;
    case 'counta': {
      let count = 0;
      for (const row of rows)
        for (const cell of row) if (cell !== null && cell !== undefined && cell !== '') count++;
      return count;
    }
    case 'countblank': {
      let count = 0;
      for (const row of rows)
        for (const cell of row) if (cell === null || cell === undefined || cell === '') count++;
      return count;
    }
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'median':
      return computeMedian(values);
    case 'mode':
      return computeMode(values);
    case 'product':
      return values.reduce((a, b) => a * b, 1);
    case 'stdev':
      return computeStddev(values, false);
    case 'stdevp':
      return computeStddev(values, true);
    case 'var':
      return computeVariance(values, false);
    case 'varp':
      return computeVariance(values, true);
    default:
      return null;
  }
}

// ============================================================================
// Statistics
// ============================================================================

export function computeStatistics(
  data: CellValue[][],
  options: StatisticalOptions
): {
  statistics: Record<string, ColumnStats>;
  correlations?: Record<string, Record<string, number>>;
  correlationMatrix?: CorrelationMatrix;
} {
  const headers = (data[0] || []).map(String);
  const targetCols = options.columns
    ? options.columns.map((c) => resolveColumnIndex(headers, c))
    : headers.map((_, i) => i).filter((i) => extractNumericColumn(data, i).length > 0);

  const statistics: Record<string, ColumnStats> = {};
  const columnData: Record<string, number[]> = {};

  for (const colIdx of targetCols) {
    const colName = headers[colIdx] || `Col${colIdx}`;
    const values = extractNumericColumn(data, colIdx);
    columnData[colName] = values;

    const nullCount = data.slice(1).filter((row) => {
      const v = row[colIdx];
      return v === null || v === undefined || v === '';
    }).length;

    if (values.length === 0) {
      statistics[colName] = {
        count: 0,
        mean: null,
        median: null,
        stddev: null,
        variance: null,
        min: null,
        max: null,
        range: null,
        nullCount,
      };
      continue;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = computeVariance(values, false);
    const stddev = variance !== null ? Math.sqrt(variance) : null;

    const percentiles: Record<string, number> = {};
    for (const p of options.percentiles) {
      percentiles[String(p)] = computePercentile(sorted, p);
    }

    // Skewness and kurtosis
    let skewness: number | null = null;
    let kurtosis: number | null = null;
    if (values.length >= 3 && stddev !== null && stddev > 0) {
      const n = values.length;
      const m3 = values.reduce((sum, v) => sum + Math.pow(v - mean, 3), 0) / n;
      skewness = m3 / Math.pow(stddev, 3);
      const m4 = values.reduce((sum, v) => sum + Math.pow(v - mean, 4), 0) / n;
      kurtosis = m4 / Math.pow(stddev, 4) - 3; // excess kurtosis
    }

    // Moving window statistics if configured
    let movingWindow: number[] | undefined;
    if (options.movingWindowConfig && options.movingWindowConfig.column === colName) {
      movingWindow = computeMovingWindow(
        values,
        options.movingWindowConfig.windowSize,
        options.movingWindowConfig.operation
      );
    }

    statistics[colName] = {
      count: values.length,
      mean,
      median: computeMedian(values),
      mode: computeMode(values),
      stddev,
      variance,
      min: sorted[0]!,
      max: sorted[sorted.length - 1]!,
      range: sorted[sorted.length - 1]! - sorted[0]!,
      skewness,
      kurtosis,
      percentiles,
      nullCount,
      ...(movingWindow !== undefined ? { movingWindow } : {}),
    };
  }

  let correlations: Record<string, Record<string, number>> | undefined;
  let correlationMatrix: CorrelationMatrix | undefined;
  if (options.includeCorrelations && Object.keys(columnData).length > 1) {
    const correlationMap: Record<string, Record<string, number>> = {};
    const colNames = Object.keys(columnData);
    for (const a of colNames) {
      correlationMap[a] = {};
      for (const b of colNames) {
        correlationMap[a][b] = computeCorrelation(columnData[a]!, columnData[b]!);
      }
    }
    correlations = correlationMap;
    // Also provide structured matrix format
    const matrix = colNames.map((a) => {
      const row = correlationMap[a];
      return colNames.map((b) => row?.[b] ?? 0);
    });
    correlationMatrix = { columns: colNames, matrix };
  }

  return { statistics, correlations, correlationMatrix };
}

// ============================================================================
// Regression
// ============================================================================

export function computeRegression(
  data: CellValue[][],
  options: RegressionOptions
): RegressionResult {
  const headers = (data[0] || []).map(String);
  const xIdx = resolveColumnIndex(headers, options.xColumn);
  const yIdx = resolveColumnIndex(headers, options.yColumn);

  const xValues = extractNumericColumn(data, xIdx);
  const yValues = extractNumericColumn(data, yIdx);
  const n = Math.min(xValues.length, yValues.length);
  if (n < 2)
    throw new ValidationError(
      'Regression requires at least 2 data points',
      'data',
      'at least 2 numeric rows'
    );

  const x = xValues.slice(0, n);
  const y = yValues.slice(0, n);

  let coefficients: number[];
  let equation: string;

  switch (options.type) {
    case 'linear': {
      const [slope, intercept] = linearRegression(x, y);
      coefficients = [slope, intercept];
      equation = `y = ${slope.toFixed(4)}x + ${intercept.toFixed(4)}`;
      break;
    }
    case 'polynomial': {
      coefficients = polynomialRegression(x, y, options.degree);
      equation = coefficients.map((c, i) => `${c.toFixed(4)}x^${i}`).join(' + ');
      break;
    }
    case 'exponential': {
      const logY = y.map((v) => (v > 0 ? Math.log(v) : 0));
      const [slope, intercept] = linearRegression(x, logY);
      coefficients = [Math.exp(intercept), slope];
      equation = `y = ${coefficients[0]!.toFixed(4)} * e^(${coefficients[1]!.toFixed(4)}x)`;
      break;
    }
    case 'logarithmic': {
      const logX = x.map((v) => (v > 0 ? Math.log(v) : 0));
      const [slope, intercept] = linearRegression(logX, y);
      coefficients = [slope, intercept];
      equation = `y = ${slope.toFixed(4)} * ln(x) + ${intercept.toFixed(4)}`;
      break;
    }
    case 'power': {
      const logX = x.map((v) => (v > 0 ? Math.log(v) : 0));
      const logY = y.map((v) => (v > 0 ? Math.log(v) : 0));
      const [slope, intercept] = linearRegression(logX, logY);
      coefficients = [Math.exp(intercept), slope];
      equation = `y = ${coefficients[0]!.toFixed(4)} * x^${coefficients[1]!.toFixed(4)}`;
      break;
    }
    default:
      throw new ValidationError(
        `Unsupported regression type: ${options.type}`,
        'type',
        'linear | polynomial | exponential | logarithmic | power'
      );
  }

  // R-squared
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const ssTotal = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
  const predicted = x.map((xi) => predictValue(xi, coefficients, options.type, options.degree));
  const ssResidual = y.reduce((sum, yi, i) => sum + Math.pow(yi - predicted[i]!, 2), 0);
  const rSquared = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

  // Residuals
  const residualValues = y.map((yi, i) => yi - predicted[i]!);
  const residualMean = residualValues.reduce((a, b) => a + b, 0) / n;
  const residualStddev = Math.sqrt(
    residualValues.reduce((sum, r) => sum + Math.pow(r - residualMean, 2), 0) / (n - 1)
  );

  const result: RegressionResult = {
    coefficients,
    rSquared,
    equation,
    residuals: {
      mean: residualMean,
      stddev: residualStddev,
      max: Math.max(...residualValues.map(Math.abs)),
    },
  };

  if (options.predict) {
    result.predictions = options.predict.map((xi) => ({
      x: xi,
      y: predictValue(xi, coefficients, options.type, options.degree),
    }));
  }

  return result;
}

// ============================================================================
// Forecasting
// ============================================================================

export function computeForecast(data: CellValue[][], options: ForecastOptions): ForecastResult {
  const headers = (data[0] || []).map(String);
  const valueIdx = resolveColumnIndex(headers, options.valueColumn);
  const values = extractNumericColumn(data, valueIdx);

  if (values.length < 3)
    throw new ValidationError(
      'Forecasting requires at least 3 data points',
      'data',
      'at least 3 numeric rows'
    );

  const method =
    options.method === 'auto' ? selectBestMethod(values, options.seasonality) : options.method;
  let forecastValues: number[];
  let trend: ForecastResult['trend'];

  switch (method) {
    case 'linear_trend': {
      const xArr = values.map((_, i) => i);
      const [slope, intercept] = linearRegression(xArr, values);
      forecastValues = Array.from(
        { length: options.periods },
        (_, i) => slope * (values.length + i) + intercept
      );
      trend = {
        direction: slope > 0.01 ? 'increasing' : slope < -0.01 ? 'decreasing' : 'stable',
        strength: Math.abs(slope) / (Math.max(...values) - Math.min(...values) || 1),
        seasonalityDetected: false,
      };
      break;
    }
    case 'moving_average': {
      const window = Math.min(Math.floor(values.length / 3), 12);
      const lastWindow = values.slice(-window);
      const avg = lastWindow.reduce((a, b) => a + b, 0) / window;
      forecastValues = Array(options.periods).fill(avg) as number[];
      const firstHalf = values.slice(0, Math.floor(values.length / 2));
      const secondHalf = values.slice(Math.floor(values.length / 2));
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      const diff = secondAvg - firstAvg;
      trend = {
        direction:
          diff > 0.01 * firstAvg ? 'increasing' : diff < -0.01 * firstAvg ? 'decreasing' : 'stable',
        strength: Math.abs(diff) / (firstAvg || 1),
        seasonalityDetected: false,
      };
      break;
    }
    case 'exponential_smoothing': {
      const alpha = 0.3;
      let smoothed = values[0]!;
      for (let i = 1; i < values.length; i++) {
        smoothed = alpha * values[i]! + (1 - alpha) * smoothed;
      }
      forecastValues = Array(options.periods).fill(smoothed) as number[];
      const trendSlope = (smoothed - values[0]!) / values.length;
      trend = {
        direction: trendSlope > 0.01 ? 'increasing' : trendSlope < -0.01 ? 'decreasing' : 'stable',
        strength: Math.abs(trendSlope) / (Math.max(...values) - Math.min(...values) || 1),
        seasonalityDetected: false,
      };
      break;
    }
    default:
      throw new ValidationError(
        `Unsupported forecast method: ${method}`,
        'method',
        'linear_trend | exponential_smoothing | moving_average | seasonal'
      );
  }

  // Add confidence bounds (simple ±2 stddev)
  const stddev = computeStddev(values, true) || 0;
  const forecast = forecastValues.map((value, i) => ({
    period: values.length + i + 1,
    value: Math.round(value * 100) / 100,
    lowerBound: Math.round((value - 2 * stddev) * 100) / 100,
    upperBound: Math.round((value + 2 * stddev) * 100) / 100,
  }));

  return { forecast, trend: trend!, methodUsed: method };
}

function selectBestMethod(
  values: number[],
  seasonality?: number
): 'linear_trend' | 'moving_average' | 'exponential_smoothing' {
  // Simple heuristic: use linear trend if data shows clear trend, otherwise exponential smoothing
  const xArr = values.map((_, i) => i);
  const [slope] = linearRegression(xArr, values);
  const yMean = values.reduce((a, b) => a + b, 0) / values.length;
  const trendStrength = Math.abs(slope * values.length) / (yMean || 1);
  if (trendStrength > 0.3) return 'linear_trend';
  if (seasonality && values.length >= seasonality * 2) return 'moving_average';
  return 'exponential_smoothing';
}

// ============================================================================

export function matrixOp(
  matrix: number[][],
  operation: string,
  secondMatrix?: number[][]
): { matrix?: number[][]; scalar?: number; eigenvalues?: number[] } {
  switch (operation) {
    case 'transpose':
      return { matrix: transpose(matrix) };
    case 'multiply': {
      if (!secondMatrix)
        throw new ValidationError(
          'multiply requires secondRange',
          'secondRange',
          'a valid A1 range string'
        );
      return { matrix: matrixMultiply(matrix, secondMatrix) };
    }
    case 'determinant': {
      if (matrix.length !== matrix[0]?.length)
        throw new ValidationError(
          'Determinant requires a square matrix',
          'range',
          'NxN square range'
        );
      return { scalar: determinant(matrix) };
    }
    case 'inverse': {
      if (matrix.length !== matrix[0]?.length)
        throw new ValidationError('Inverse requires a square matrix', 'range', 'NxN square range');
      return { matrix: invertMatrix(matrix) };
    }
    case 'trace': {
      if (matrix.length !== matrix[0]?.length)
        throw new ValidationError('Trace requires a square matrix', 'range', 'NxN square range');
      let sum = 0;
      for (let i = 0; i < matrix.length; i++) sum += matrix[i]![i]!;
      return { scalar: sum };
    }
    case 'rank':
      return { scalar: computeRank(matrix) };
    case 'eigenvalues': {
      if (matrix.length !== matrix[0]?.length)
        throw new ValidationError(
          'Eigenvalues requires a square matrix',
          'range',
          'NxN square range'
        );
      return { eigenvalues: computeEigenvaluesQR(matrix) };
    }
    default:
      throw new ValidationError(
        `Unsupported matrix operation: ${operation}`,
        'operation',
        'transpose | multiply | determinant | inverse | trace | rank | eigenvalues'
      );
  }
}

// ============================================================================
// Pivot Computation
// ============================================================================

export function computePivot(data: CellValue[][], options: PivotOptions): PivotResult {
  const headers = (data[0] || []).map(String);
  let rows = data.slice(1);

  // Apply filters
  if (options.filters) {
    for (const filter of options.filters) {
      const colIdx = resolveColumnIndex(headers, filter.column);
      rows = rows.filter((row) => {
        const val = row[colIdx];
        return filter.values.some((fv) => String(fv) === String(val));
      });
    }
  }

  const rowIndices = options.rows.map((r) => resolveColumnIndex(headers, r));
  const valueSpecs = options.values.map((v) => ({
    colIdx: resolveColumnIndex(headers, v.column),
    fn: v.function,
  }));

  // Multi-value pivot: if column indices specified, group by row + column key
  if (options.columns && options.columns.length > 0) {
    const colIndices = options.columns.map((c) => resolveColumnIndex(headers, c));
    const groups = new Map<string, Map<string, CellValue[][]>>();

    // Group by (rowKey, colKey)
    for (const row of rows) {
      const rowKey = rowIndices.map((i) => String(row[i] ?? '')).join('|');
      const colKey = colIndices.map((i) => String(row[i] ?? '')).join('|');

      if (!groups.has(rowKey)) groups.set(rowKey, new Map());
      const colMap = groups.get(rowKey)!;
      if (!colMap.has(colKey)) colMap.set(colKey, []);
      colMap.get(colKey)!.push(row);
    }

    // Get unique column keys (sorted)
    const uniqueColKeys = Array.from(
      new Set(Array.from(groups.values()).flatMap((m) => Array.from(m.keys())))
    ).sort();

    // Build headers: row keys + (colKey | valueFunc) for each column
    const pivotHeaders = [...options.rows];
    for (const colKey of uniqueColKeys) {
      for (const spec of valueSpecs) {
        const colName = colKey === '' ? '(empty)' : colKey;
        pivotHeaders.push(`${colName} | ${spec.fn}(${headers[spec.colIdx]})`);
      }
    }

    // Build pivot rows
    const pivotRows: Array<Array<string | number | null>> = [];
    const totals: Record<string, number> = {};

    const uniqueRowKeys = Array.from(new Set(Array.from(groups.keys()).map((k) => k))).sort();

    for (const rowKey of uniqueRowKeys) {
      const keyParts = rowKey.split('|');
      const row: Array<string | number | null> = [...keyParts];
      const colMap: Map<string, CellValue[][]> =
        groups.get(rowKey) ?? new Map<string, CellValue[][]>();

      for (const colKey of uniqueColKeys) {
        const groupRows = colMap.get(colKey) || [];
        for (const spec of valueSpecs) {
          const values = groupRows
            .map((r) => r[spec.colIdx])
            .filter((v): v is number => typeof v === 'number');
          const aggResult = computeAggFn(values, spec.fn, groupRows);
          row.push(aggResult);

          const colName = colKey === '' ? '(empty)' : colKey;
          const totalKey = `${colName} | ${spec.fn}(${headers[spec.colIdx]})`;
          totals[totalKey] = (totals[totalKey] || 0) + (aggResult || 0);
        }
      }

      pivotRows.push(row);
    }

    return { headers: pivotHeaders, rows: pivotRows, totals };
  }

  // Standard pivot: single-value group by row key only
  const groups = new Map<string, CellValue[][]>();
  for (const row of rows) {
    const key = rowIndices.map((i) => String(row[i] ?? '')).join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // Build pivot headers
  const pivotHeaders = [
    ...options.rows,
    ...options.values.map((v) => `${v.function}(${v.column})`),
  ];

  // Build pivot rows
  const pivotRows: Array<Array<string | number | null>> = [];
  const totals: Record<string, number> = {};

  for (const [key, groupRows] of groups) {
    const keyParts = key.split('|');
    const row: Array<string | number | null> = [...keyParts];

    for (const spec of valueSpecs) {
      const values = groupRows
        .map((r) => r[spec.colIdx])
        .filter((v): v is number => typeof v === 'number');
      const aggResult = computeAggFn(values, spec.fn, groupRows);
      row.push(aggResult);

      const totalKey = `${spec.fn}(${headers[spec.colIdx]})`;
      totals[totalKey] = (totals[totalKey] || 0) + (aggResult || 0);
    }

    pivotRows.push(row);
  }

  return { headers: pivotHeaders, rows: pivotRows, totals };
}

export { explainFormula } from './compute-engine-math.js';
