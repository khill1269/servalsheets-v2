/**
 * ServalSheets - Analysis Worker
 *
 * Worker thread for CPU-intensive data analysis operations.
 * Offloads statistical computations from the main thread for large datasets (10K+ rows).
 *
 * Target operations:
 * - Trend analysis (linear regression on all numeric columns)
 * - Anomaly detection (z-score calculations)
 * - Correlation analysis (pairwise Pearson correlation)
 * - Distribution analysis (statistics, quartiles)
 * - Quality checks (type consistency, duplicates)
 *
 * @module workers/analysis-worker
 */

import { ServiceError } from '../core/errors.js';

/**
 * Worker task input types
 */
export interface AnalysisWorkerTask {
  operation:
    | 'analyzeTrends'
    | 'detectAnomalies'
    | 'analyzeCorrelations'
    | 'analyzeDistribution'
    | 'checkColumnQuality'
    | 'detectDataType'
    | 'fullAnalysis'; // Run all analyses in one pass
  data: unknown[][];
  options?: {
    // Trend analysis options
    minDataPoints?: number;
    trendThreshold?: number;

    // Anomaly detection options
    zScoreThreshold?: number;

    // Correlation analysis options
    correlationThreshold?: number;

    // Distribution analysis options
    columnIndex?: number;

    // Quality check options
    dataType?: string;
  };
}

/**
 * Trend analysis result
 */
interface TrendResult {
  column: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  changeRate: string;
  confidence: number;
}

/**
 * Anomaly detection result
 */
interface AnomalyResult {
  cell: string;
  value: number;
  expected: string;
  deviation: string;
  zScore: string;
}

/**
 * Correlation analysis result
 */
interface CorrelationResult {
  columns: number[];
  correlation: string;
  strength: string;
}

/**
 * Distribution analysis result
 */
type DistributionResult =
  | {
      type: 'categorical';
      uniqueCount: number;
      totalCount: number;
    }
  | {
      type: 'numeric';
      mean: string;
      median: string;
      stdDev: string;
      min: string;
      max: string;
      quartiles: {
        q1: string;
        q2: string;
        q3: string;
        iqr: string;
      };
    };

/**
 * Quality check result
 */
interface QualityResult {
  completeness: number;
  consistency: number;
  issues: string[];
  uniqueRatio?: number;
}

/**
 * Full analysis result (all operations)
 */
interface FullAnalysisResult {
  trends: TrendResult[];
  anomalies: AnomalyResult[];
  correlations: CorrelationResult[];
  rowCount: number;
  columnCount: number;
  duration: number;
}

/**
 * Calculate Pearson correlation coefficient
 */
function pearson(x: number[], y: number[]): number {
  if (x.length === 0 || y.length === 0 || x.length !== y.length) return 0;
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = y[i];
    if (xi === undefined || yi === undefined) continue;
    const dx = xi - meanX;
    const dy = yi - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

/**
 * Analyze trends in numeric columns using linear regression
 */
function analyzeTrends(
  values: unknown[][],
  options?: { minDataPoints?: number; trendThreshold?: number }
): TrendResult[] {
  const minDataPoints = options?.minDataPoints ?? 3;
  const trendThreshold = options?.trendThreshold ?? 0.1;
  const trends: TrendResult[] = [];

  if (values.length === 0 || !values[0]) return trends;

  const columnCount = values[0].length;

  // Extract all numeric columns in a single pass
  const numericColumns: number[][] = Array.from({ length: columnCount }, () => []);

  for (const row of values) {
    for (let col = 0; col < columnCount; col++) {
      const value = row[col];
      if (typeof value === 'number') {
        numericColumns[col]!.push(value);
      }
    }
  }

  // Analyze trends for each column with sufficient data
  for (let col = 0; col < columnCount; col++) {
    const columnData = numericColumns[col]!;
    if (columnData.length < minDataPoints) continue;

    // Simple linear trend calculation
    const n = columnData.length;
    const indices = Array.from({ length: n }, (_, i) => i);
    const meanX = indices.reduce((a, b) => a + b, 0) / n;
    const meanY = columnData.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      const indexVal = indices[i];
      const dataVal = columnData[i];
      if (indexVal === undefined || dataVal === undefined) continue;
      numerator += (indexVal - meanX) * (dataVal - meanY);
      denominator += (indexVal - meanX) ** 2;
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;
    const direction: 'increasing' | 'decreasing' | 'stable' =
      slope > trendThreshold ? 'increasing' : slope < -trendThreshold ? 'decreasing' : 'stable';
    const changeRate = Math.abs(slope / meanY) * 100;

    trends.push({
      column: col,
      trend: direction,
      changeRate: `${changeRate.toFixed(1)}% per period`,
      confidence: Math.min(0.9, Math.abs(slope) / Math.abs(meanY)),
    });
  }

  return trends;
}

/**
 * Detect statistical anomalies using z-score method
 */
function detectAnomalies(
  values: unknown[][],
  options?: { zScoreThreshold?: number }
): AnomalyResult[] {
  const zScoreThreshold = options?.zScoreThreshold ?? 3;
  const anomalies: AnomalyResult[] = [];

  if (values.length === 0 || !values[0]) return anomalies;

  const columnCount = values[0].length;

  for (let col = 0; col < columnCount; col++) {
    const columnData = values
      .map((row, idx) => ({ value: row[col], row: idx }))
      .filter((v) => typeof v.value === 'number') as {
      value: number;
      row: number;
    }[];

    if (columnData.length < 4) continue;

    const numericValues = columnData.map((d) => d.value);
    const mean = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
    const variance =
      numericValues.reduce((sum, val) => sum + (val - mean) ** 2, 0) / numericValues.length;
    const stdDev = Math.sqrt(variance);

    // Detect outliers using z-score
    for (const { value, row } of columnData) {
      const zScore = Math.abs((value - mean) / stdDev);
      if (zScore > zScoreThreshold) {
        anomalies.push({
          cell: `Row ${row + 1}, Col ${col + 1}`,
          value,
          expected: `${mean.toFixed(2)} ± ${(stdDev * 2).toFixed(2)}`,
          deviation: `${((zScore - zScoreThreshold) * 100).toFixed(0)}% beyond threshold`,
          zScore: zScore.toFixed(2),
        });
      }
    }
  }

  return anomalies;
}

/**
 * Analyze correlations between numeric columns
 */
function analyzeCorrelations(
  values: unknown[][],
  options?: { correlationThreshold?: number }
): CorrelationResult[] {
  const correlationThreshold = options?.correlationThreshold ?? 0.3;
  const correlations: CorrelationResult[] = [];

  if (values.length === 0 || !values[0]) return correlations;

  const columnCount = values[0].length;

  // Extract numeric columns in a single pass
  const numericColumns: number[][] = Array.from({ length: columnCount }, () => []);

  for (const row of values) {
    for (let col = 0; col < columnCount; col++) {
      const value = row[col];
      if (typeof value === 'number') {
        numericColumns[col]!.push(value);
      }
    }
  }

  // Filter out columns with insufficient data
  const validColumns = numericColumns
    .map((col, idx) => ({ col, idx }))
    .filter((item) => item.col.length >= 3);

  // Calculate pairwise correlations
  for (let i = 0; i < validColumns.length; i++) {
    for (let j = i + 1; j < validColumns.length; j++) {
      const item1 = validColumns[i];
      const item2 = validColumns[j];
      if (!item1 || !item2) continue;

      const correlation = pearson(item1.col, item2.col);
      const strength =
        Math.abs(correlation) > 0.7 ? 'strong' : Math.abs(correlation) > 0.4 ? 'moderate' : 'weak';

      if (Math.abs(correlation) > correlationThreshold) {
        correlations.push({
          columns: [item1.idx, item2.idx],
          correlation: correlation.toFixed(3),
          strength: `${strength} ${correlation > 0 ? 'positive' : 'negative'}`,
        });
      }
    }
  }

  return correlations;
}

/**
 * Analyze distribution of values in a column
 */
function analyzeDistribution(
  values: unknown[][],
  options?: { columnIndex?: number }
): DistributionResult {
  const columnIndex = options?.columnIndex ?? 0;
  const columnData = values.map((row) => row[columnIndex]).filter((v) => v !== undefined);

  const numericData = columnData.filter((v) => typeof v === 'number') as number[];

  if (numericData.length === 0) {
    const uniqueValues = new Set(columnData);
    return {
      type: 'categorical',
      uniqueCount: uniqueValues.size,
      totalCount: columnData.length,
    };
  }

  // For numeric data, calculate statistics
  const sorted = [...numericData].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = sorted.reduce((acc, val) => acc + (val - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  const q1 = sorted[Math.floor(n * 0.25)] ?? 0;
  const median = sorted[Math.floor(n * 0.5)] ?? 0;
  const q3 = sorted[Math.floor(n * 0.75)] ?? 0;
  const min = sorted[0] ?? 0;
  const max = sorted[n - 1] ?? 0;

  return {
    type: 'numeric',
    mean: mean.toFixed(2),
    median: median.toFixed(2),
    stdDev: stdDev.toFixed(2),
    min: min.toFixed(2),
    max: max.toFixed(2),
    quartiles: {
      q1: q1.toFixed(2),
      q2: median.toFixed(2),
      q3: q3.toFixed(2),
      iqr: (q3 - q1).toFixed(2),
    },
  };
}

/**
 * Check quality metrics for a column
 */
function checkColumnQuality(
  values: unknown[][],
  options?: { columnIndex?: number; dataType?: string }
): QualityResult {
  const columnIndex = options?.columnIndex ?? 0;
  const dataType = options?.dataType ?? 'unknown';
  const columnData = values.map((row) => row[columnIndex]).filter((v) => v !== undefined);

  const totalCount = columnData.length;
  const uniqueCount = new Set(columnData).size;

  const quality: QualityResult = {
    completeness: 100,
    consistency: 100,
    issues: [],
  };

  // Check for data type consistency
  const actualTypes = new Set(columnData.map((v) => typeof v));
  if (actualTypes.size > 1 && dataType !== 'mixed') {
    quality.consistency = 70;
    quality.issues.push('Mixed data types detected');
  }

  // Check for duplicates
  const duplicateRatio = (totalCount - uniqueCount) / totalCount;
  if (duplicateRatio > 0.5) {
    quality.issues.push(`High duplicate rate: ${(duplicateRatio * 100).toFixed(0)}%`);
  }

  quality.uniqueRatio = uniqueCount / totalCount;

  return quality;
}

/**
 * Auto-detect data type of a column
 */
function detectDataType(values: unknown[][], options?: { columnIndex?: number }): string {
  const columnIndex = options?.columnIndex ?? 0;
  const columnData = values.map((row) => row[columnIndex]).filter((v) => v !== undefined);

  if (columnData.length === 0) return 'empty';

  const types = columnData.map((v) => {
    if (typeof v === 'number') return 'number';
    if (typeof v === 'boolean') return 'boolean';
    if (typeof v === 'string') {
      if (/^\d{4}-\d{2}-\d{2}/.test(v) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v)) {
        return 'date';
      }
      if (/@/.test(v)) {
        return 'email';
      }
      if (/^https?:\/\//.test(v)) {
        return 'url';
      }
      return 'text';
    }
    return 'unknown';
  });

  const typeCounts: Record<string, number> = {};
  for (const type of types) {
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }

  const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const dominantTypeEntry = sortedTypes[0];
  if (!dominantTypeEntry) return 'unknown';

  const dominantType = dominantTypeEntry[0];
  const typePercentage = (dominantTypeEntry[1] / types.length) * 100;

  return typePercentage > 80 ? dominantType : 'mixed';
}

/**
 * Run full analysis (all operations in one pass for maximum efficiency)
 */
function runFullAnalysis(
  values: unknown[][],
  options?: AnalysisWorkerTask['options']
): FullAnalysisResult {
  const startTime = Date.now();

  const trends = analyzeTrends(values, options);
  const anomalies = detectAnomalies(values, options);
  const correlations = analyzeCorrelations(values, options);

  const duration = Date.now() - startTime;

  return {
    trends,
    anomalies,
    correlations,
    rowCount: values.length,
    columnCount: values[0]?.length ?? 0,
    duration,
  };
}

/**
 * Worker entry point - called by worker-runner.ts
 */
export function execute(task: AnalysisWorkerTask): unknown {
  const { operation, data, options } = task;

  switch (operation) {
    case 'analyzeTrends':
      return analyzeTrends(data, options);

    case 'detectAnomalies':
      return detectAnomalies(data, options);

    case 'analyzeCorrelations':
      return analyzeCorrelations(data, options);

    case 'analyzeDistribution':
      return analyzeDistribution(data, options);

    case 'checkColumnQuality':
      return checkColumnQuality(data, options);

    case 'detectDataType':
      return detectDataType(data, options);

    case 'fullAnalysis':
      return runFullAnalysis(data, options);

    default:
      throw new ServiceError(
        `Unknown analysis operation: ${operation as string}`,
        'INTERNAL_ERROR',
        'analysis-worker',
        false
      );
  }
}
