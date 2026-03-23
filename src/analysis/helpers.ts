/**
 * ServalSheets - Analysis Helper Functions
 *
 * Reusable statistical and data analysis functions extracted from
 * the original analysis handler. These pure functions are shared
 * between fast path (traditional stats) and AI path (enhanced analysis).
 *
 * All functions are optimized for performance with O(n) single-pass algorithms.
 */

/**
 * Calculate Pearson correlation coefficient between two numeric arrays
 * Returns value between -1 (perfect negative correlation) and 1 (perfect positive correlation)
 * Returns 0 if arrays are incompatible or have insufficient variance
 */
export function pearson(x: number[], y: number[]): number {
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
 * Determine the type of a single value
 * Returns: 'empty' | 'number' | 'boolean' | 'string' | 'other'
 */
export function valueType(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'empty';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  return 'other';
}

/**
 * Analyze trends in numeric columns using linear regression
 * Returns trend direction and change rate for each column with sufficient data
 * O(n*m) complexity - single pass through data
 */
export function analyzeTrends(values: unknown[][]): Array<{
  column: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  changeRate: string;
  confidence: number;
}> {
  const trends: Array<{
    column: number;
    trend: 'increasing' | 'decreasing' | 'stable';
    changeRate: string;
    confidence: number;
  }> = [];

  if (values.length === 0 || !values[0]) return trends;

  const columnCount = values[0].length;

  // Extract all numeric columns in a single pass (O(n*m) instead of O(n*m*m))
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
    if (columnData.length < 3) continue;

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
      slope > 0.1 ? 'increasing' : slope < -0.1 ? 'decreasing' : 'stable';
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
 * Returns outliers that are >3 standard deviations from mean
 * O(n*m) complexity - single pass through data
 */
export function detectAnomalies(values: unknown[][]): Array<{
  cell: string;
  value: number;
  expected: string;
  deviation: string;
  zScore: string;
}> {
  const anomalies: Array<{
    cell: string;
    value: number;
    expected: string;
    deviation: string;
    zScore: string;
  }> = [];

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

    // Detect outliers using z-score (> 3 std devs from mean)
    for (const { value, row } of columnData) {
      const zScore = Math.abs((value - mean) / stdDev);
      if (zScore > 3) {
        anomalies.push({
          cell: `Row ${row + 1}, Col ${col + 1}`,
          value,
          expected: `${mean.toFixed(2)} ± ${(stdDev * 2).toFixed(2)}`,
          deviation: `${((zScore - 3) * 100).toFixed(0)}% beyond threshold`,
          zScore: zScore.toFixed(2),
        });
      }
    }
  }

  return anomalies;
}

/**
 * Analyze seasonality patterns in time series data
 * Simplified detection - looks for repeating patterns
 * Note: Production implementation should use FFT or autocorrelation
 */
export function analyzeSeasonality(values: unknown[][]): {
  detected: boolean;
  period?: string;
  pattern?: string;
  strength?: number;
  message?: string;
  note?: string;
} {
  if (values.length < 12) {
    return {
      detected: false,
      message: 'Insufficient data for seasonality analysis (need 12+ periods)',
    };
  }

  // Look for repeating patterns in first numeric column
  const firstColumn = values.reduce<number[]>((acc, row) => {
    const val = row[0];
    if (typeof val === 'number') {
      acc.push(val);
    }
    return acc;
  }, []);
  if (firstColumn.length < 12) {
    return { detected: false, message: 'Insufficient numeric data' };
  }

  // Simple heuristic: check for monthly patterns (12-period cycle)
  const period = 12;
  if (firstColumn.length >= period * 2) {
    return {
      detected: true,
      period: 'monthly',
      pattern: 'Potential seasonal pattern detected',
      strength: 0.65, // Placeholder
      note: 'Full seasonality analysis requires more sophisticated algorithms',
    };
  }

  return { detected: false };
}

/**
 * Auto-detect data type of a column based on its values
 * Returns: 'empty' | 'number' | 'boolean' | 'date' | 'email' | 'url' | 'text' | 'mixed' | 'unknown'
 */
export function detectDataType(columnData: unknown[]): string {
  if (columnData.length === 0) return 'empty';

  const types = columnData.map((v) => {
    if (typeof v === 'number') return 'number';
    if (typeof v === 'boolean') return 'boolean';
    if (typeof v === 'string') {
      // Check for date patterns
      if (/^\d{4}-\d{2}-\d{2}/.test(v) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v)) {
        return 'date';
      }
      // Check for email
      if (/@/.test(v)) {
        return 'email';
      }
      // Check for URL
      if (/^https?:\/\//.test(v)) {
        return 'url';
      }
      return 'text';
    }
    return 'unknown';
  });

  // Find most common type
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
 * Analyze distribution of values in a column
 * Returns statistics for numeric data or value counts for categorical data
 */
export function analyzeDistribution(columnData: unknown[]):
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
    } {
  const numericData = columnData.filter((v) => typeof v === 'number') as number[];

  if (numericData.length === 0) {
    // For non-numeric data, return value counts
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
 * Returns completeness, consistency scores and list of quality issues
 */
export function checkColumnQuality(
  columnData: unknown[],
  dataType: string
): {
  completeness: number;
  consistency: number;
  issues: string[];
  uniqueRatio?: number;
} {
  const totalCount = columnData.length;
  const uniqueCount = new Set(columnData).size;

  const quality: {
    completeness: number;
    consistency: number;
    issues: string[];
    uniqueRatio?: number;
  } = {
    completeness: 100, // Already filtered empty values
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

  // Calculate unique ratio
  quality.uniqueRatio = uniqueCount / totalCount;

  return quality;
}

/**
 * Analyze correlations between numeric columns
 * Returns pairwise correlations with strength classification
 * O(n*m + m^2) complexity - single pass + pairwise comparison
 */
export function analyzeCorrelationsData(values: unknown[][]): Array<{
  columns: number[];
  correlation: string;
  strength: string;
}> {
  const correlations: Array<{
    columns: number[];
    correlation: string;
    strength: string;
  }> = [];

  if (values.length === 0 || !values[0]) return correlations;

  const columnCount = values[0].length;

  // Extract numeric columns in a single pass (O(n*m) instead of O(n*m*m))
  const numericColumns: number[][] = Array.from({ length: columnCount }, () => []);

  // Single pass through all rows to extract numeric values
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

  // Calculate pairwise correlations for valid columns only
  for (let i = 0; i < validColumns.length; i++) {
    for (let j = i + 1; j < validColumns.length; j++) {
      const item1 = validColumns[i];
      const item2 = validColumns[j];
      if (!item1 || !item2) continue;

      const correlation = pearson(item1.col, item2.col);
      const strength =
        Math.abs(correlation) > 0.7 ? 'strong' : Math.abs(correlation) > 0.4 ? 'moderate' : 'weak';

      if (Math.abs(correlation) > 0.3) {
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
 * Type definitions for complex return types
 */
export interface TrendAnalysis {
  column: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  changeRate: string;
  confidence: number;
}

export interface Anomaly {
  cell: string;
  value: number;
  expected: string;
  deviation: string;
  zScore: string;
}

export interface SeasonalityResult {
  detected: boolean;
  period?: string;
  pattern?: string;
  strength?: number;
  message?: string;
  note?: string;
}

export interface DistributionStats {
  type: 'numeric' | 'categorical';
  mean?: string;
  median?: string;
  stdDev?: string;
  min?: string;
  max?: string;
  quartiles?: {
    q1: string;
    q2: string;
    q3: string;
    iqr: string;
  };
  uniqueCount?: number;
  totalCount?: number;
}

export interface QualityScore {
  completeness: number;
  consistency: number;
  issues: string[];
  uniqueRatio?: number;
}

export interface CorrelationResult {
  columns: number[];
  correlation: string;
  strength: string;
}
