/**
 * Shared math and formula helper functions for compute engine operations.
 */
import { ValidationError } from '../core/errors.js';

export function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function computeMode(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  let bestValue: number | null = null;
  let bestCount = 0;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) {
      bestCount = count;
      bestValue = value;
    }
  }
  return bestValue;
}

export function computeVariance(values: number[], population: boolean): number | null {
  if (values.length === 0) return null;
  if (!population && values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const squaredDiffs = values.map((value) => (value - mean) ** 2);
  const divisor = population ? values.length : values.length - 1;
  return squaredDiffs.reduce((sum, value) => sum + value, 0) / (divisor || 1);
}

export function computeStddev(values: number[], population: boolean): number | null {
  const variance = computeVariance(values, population);
  return variance === null ? null : Math.sqrt(Math.max(variance, 0));
}

export function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const clamped = Math.max(0, Math.min(100, p));
  const idx = (clamped / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower] ?? 0;
  const weight = idx - lower;
  const lowerVal = sorted[lower] ?? 0;
  const upperVal = sorted[upper] ?? lowerVal;
  return lowerVal * (1 - weight) + upperVal * weight;
}

export function computeCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0;
  const n = x.length;
  const meanX = x.reduce((sum, value) => sum + value, 0) / n;
  const meanY = y.reduce((sum, value) => sum + value, 0) / n;

  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;

  for (let i = 0; i < n; i++) {
    const dx = (x[i] ?? 0) - meanX;
    const dy = (y[i] ?? 0) - meanY;
    numerator += dx * dy;
    denominatorX += dx * dx;
    denominatorY += dy * dy;
  }

  const denominator = Math.sqrt(denominatorX * denominatorY);
  return denominator === 0 ? 0 : numerator / denominator;
}

export function linearRegression(x: number[], y: number[]): [number, number] {
  if (x.length !== y.length || x.length === 0) {
    return [0, 0];
  }

  const n = x.length;
  const meanX = x.reduce((sum, value) => sum + value, 0) / n;
  const meanY = y.reduce((sum, value) => sum + value, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] ?? 0) - meanX;
    const dy = (y[i] ?? 0) - meanY;
    numerator += dx * dy;
    denominator += dx * dx;
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;
  return [slope, intercept];
}

export function polynomialRegression(x: number[], y: number[], degree: number): number[] {
  if (x.length !== y.length || x.length === 0) return [0, 0];

  const safeDegree = Math.max(1, Math.min(degree, 6));
  const X: number[][] = x.map((value) => {
    const row: number[] = [];
    for (let power = 0; power <= safeDegree; power++) {
      row.push(Math.pow(value, power));
    }
    return row;
  });

  const XT = transpose(X);
  const XTX = matrixMultiply(XT, X);
  const XTy = matrixMultiply(
    XT,
    y.map((value) => [value])
  );

  try {
    const inverse = invertMatrix(XTX);
    const coeffs = matrixMultiply(inverse, XTy);
    return coeffs.map((row) => row[0] ?? 0);
  } catch {
    const [slope, intercept] = linearRegression(x, y);
    return [intercept, slope];
  }
}

export function predictValue(
  x: number,
  coefficients: number[],
  type: string,
  _degree: number
): number {
  switch (type) {
    case 'linear':
      return (coefficients[0] ?? 0) + (coefficients[1] ?? 0) * x;
    case 'polynomial':
      return coefficients.reduce(
        (sum, coefficient, power) => sum + coefficient * Math.pow(x, power),
        0
      );
    case 'exponential':
      return (coefficients[0] ?? 0) * Math.exp((coefficients[1] ?? 0) * x);
    case 'logarithmic':
      return (coefficients[0] ?? 0) + (coefficients[1] ?? 0) * Math.log(Math.max(x, 1e-12));
    case 'power':
      return (coefficients[0] ?? 0) * Math.pow(Math.max(x, 1e-12), coefficients[1] ?? 0);
    default:
      return x;
  }
}

export function transpose(m: number[][]): number[][] {
  const rows = m.length;
  const cols = m[0]?.length ?? 0;
  return Array.from({ length: cols }, (_, i) =>
    Array.from({ length: rows }, (_, j) => m[j]?.[i] ?? 0)
  );
}

export function matrixMultiply(a: number[][], b: number[][]): number[][] {
  const rows = a.length;
  const cols = b[0]?.length ?? 0;
  const shared = b.length;
  const result: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let sum = 0;
      for (let k = 0; k < shared; k++) {
        sum += (a[i]?.[k] ?? 0) * (b[k]?.[j] ?? 0);
      }
      result[i]![j] = sum;
    }
  }

  return result;
}

export function determinant(m: number[][]): number {
  const n = m.length;
  if (n === 0) return 0;
  if (n === 1) return m[0]?.[0] ?? 0;
  if (n === 2) {
    return (m[0]?.[0] ?? 0) * (m[1]?.[1] ?? 0) - (m[0]?.[1] ?? 0) * (m[1]?.[0] ?? 0);
  }

  let det = 0;
  for (let j = 0; j < n; j++) {
    const sub = m.slice(1).map((row) => row.filter((_, idx) => idx !== j));
    det += Math.pow(-1, j) * (m[0]?.[j] ?? 0) * determinant(sub);
  }
  return det;
}

export function invertMatrix(m: number[][]): number[][] {
  const n = m.length;
  if (n === 0 || n !== (m[0]?.length ?? 0)) {
    throw new ValidationError('Matrix must be square', 'matrix');
  }

  const augmented = m.map((row, i) => {
    const identity = Array.from({ length: n }, (_, j) => (i === j ? 1 : 0));
    return [...row, ...identity];
  });

  for (let i = 0; i < n; i++) {
    let pivot = augmented[i]?.[i] ?? 0;

    if (Math.abs(pivot) < 1e-12) {
      const swapIndex = augmented.findIndex((row, idx) => idx > i && Math.abs(row[i] ?? 0) > 1e-12);
      if (swapIndex === -1) throw new ValidationError('Matrix is singular', 'matrix');
      const temp = augmented[i];
      augmented[i] = augmented[swapIndex]!;
      augmented[swapIndex] = temp!;
      pivot = augmented[i]?.[i] ?? 0;
    }

    for (let j = 0; j < 2 * n; j++) {
      augmented[i]![j] = (augmented[i]?.[j] ?? 0) / pivot;
    }

    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = augmented[k]?.[i] ?? 0;
      for (let j = 0; j < 2 * n; j++) {
        augmented[k]![j] = (augmented[k]?.[j] ?? 0) - factor * (augmented[i]?.[j] ?? 0);
      }
    }
  }

  return augmented.map((row) => row.slice(n));
}

export function computeRank(m: number[][]): number {
  const rows = m.length;
  const cols = m[0]?.length ?? 0;
  const matrix = m.map((row) => [...row]);

  let rank = 0;
  let row = 0;
  for (let col = 0; col < cols && row < rows; col++) {
    let pivotRow = row;
    for (let i = row + 1; i < rows; i++) {
      if (Math.abs(matrix[i]?.[col] ?? 0) > Math.abs(matrix[pivotRow]?.[col] ?? 0)) {
        pivotRow = i;
      }
    }

    if (Math.abs(matrix[pivotRow]?.[col] ?? 0) < 1e-12) continue;

    const temp = matrix[row];
    matrix[row] = matrix[pivotRow]!;
    matrix[pivotRow] = temp!;

    const pivot = matrix[row]?.[col] ?? 1;
    for (let j = col; j < cols; j++) {
      matrix[row]![j] = (matrix[row]?.[j] ?? 0) / pivot;
    }

    for (let i = 0; i < rows; i++) {
      if (i === row) continue;
      const factor = matrix[i]?.[col] ?? 0;
      for (let j = col; j < cols; j++) {
        matrix[i]![j] = (matrix[i]?.[j] ?? 0) - factor * (matrix[row]?.[j] ?? 0);
      }
    }

    row++;
    rank++;
  }

  return rank;
}

export function computeEigenvaluesQR(A: number[][]): number[] {
  const n = A.length;

  if (n === 0) return [];
  if (n === 1) return [A[0]?.[0] ?? 0];

  if (n === 2) {
    const a = A[0]?.[0] ?? 0;
    const b = A[0]?.[1] ?? 0;
    const c = A[1]?.[0] ?? 0;
    const d = A[1]?.[1] ?? 0;
    const trace = a + d;
    const det = a * d - b * c;
    const disc = Math.sqrt(Math.max(trace * trace - 4 * det, 0));
    return [(trace + disc) / 2, (trace - disc) / 2];
  }

  let isDiagonal = true;
  for (let i = 0; i < n && isDiagonal; i++) {
    for (let j = 0; j < n && isDiagonal; j++) {
      if (i !== j && Math.abs(A[i]?.[j] ?? 0) > 1e-10) {
        isDiagonal = false;
      }
    }
  }
  if (isDiagonal) return A.map((row, i) => row[i] ?? 0);

  let current = A.map((row) => [...row]);
  const maxIter = 100;
  const threshold = 1e-10;

  for (let iter = 0; iter < maxIter; iter++) {
    const { Q, R } = householderQR(current);
    current = matrixMultiply(R, Q);

    let converged = true;
    for (let i = 0; i < n && converged; i++) {
      for (let j = i + 1; j < n; j++) {
        if (
          Math.abs(current[i]?.[j] ?? 0) > threshold ||
          Math.abs(current[j]?.[i] ?? 0) > threshold
        ) {
          converged = false;
          break;
        }
      }
    }

    if (converged) break;
  }

  return current.map((row, i) => row[i] ?? 0).sort((a, b) => b - a);
}

function householderQR(A: number[][]): { Q: number[][]; R: number[][] } {
  const m = A.length;
  const n = A[0]?.length ?? 0;
  const R = A.map((row) => [...row]);
  const Q = Array.from({ length: m }, (_, i) => {
    const row = Array(m).fill(0) as number[];
    row[i] = 1;
    return row;
  });

  for (let k = 0; k < Math.min(m - 1, n); k++) {
    const x = R.slice(k).map((row) => row[k] ?? 0);

    const sigma =
      Math.sign(x[0] ?? 0) * Math.sqrt(x.reduce((sum, value) => sum + value * value, 0));
    if (Math.abs(sigma) < 1e-10) continue;

    const u = [...x];
    const first = u[0];
    if (first === undefined) continue;
    u[0] = first + sigma;

    const norm = Math.sqrt(u.reduce((sum, value) => sum + value * value, 0));
    if (norm < 1e-10) continue;

    const v = u.map((value) => value / norm);

    for (let j = k; j < n; j++) {
      let dot = 0;
      for (let i = 0; i < v.length; i++) {
        dot += (v[i] ?? 0) * (R[k + i]?.[j] ?? 0);
      }
      for (let i = 0; i < v.length; i++) {
        R[k + i]![j] = (R[k + i]?.[j] ?? 0) - 2 * (v[i] ?? 0) * dot;
      }
    }

    for (let i = 0; i < m; i++) {
      let dot = 0;
      for (let j = 0; j < v.length; j++) {
        dot += (v[j] ?? 0) * (Q[k + j]?.[i] ?? 0);
      }
      for (let j = 0; j < v.length; j++) {
        Q[k + j]![i] = (Q[k + j]?.[i] ?? 0) - 2 * (v[j] ?? 0) * dot;
      }
    }
  }

  return { Q, R };
}

export function computeMovingWindow(
  values: number[],
  windowSize: number,
  operation: 'average' | 'median' | 'sum'
): number[] {
  if (values.length === 0) return [];
  const size = Math.max(1, Math.min(windowSize, values.length));
  const result: number[] = [];

  for (let i = 0; i <= values.length - size; i++) {
    const window = values.slice(i, i + size);
    if (operation === 'sum') {
      result.push(window.reduce((sum, value) => sum + value, 0));
      continue;
    }
    if (operation === 'average') {
      result.push(window.reduce((sum, value) => sum + value, 0) / size);
      continue;
    }
    result.push(computeMedian(window) ?? 0);
  }

  return result;
}

export function explainFormula(formula: string): {
  summary: string;
  functions: Array<{ name: string; description: string; arguments: string[] }>;
  references: Array<{ ref: string }>;
  complexity: 'simple' | 'moderate' | 'complex';
} {
  const cleaned = formula.startsWith('=') ? formula.slice(1) : formula;

  const fnRegex = /([A-Z_]+)\s*\(/g;
  const functions: Array<{ name: string; description: string; arguments: string[] }> = [];
  const seenFns = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = fnRegex.exec(cleaned)) !== null) {
    const fnName = match[1] ?? '';
    if (seenFns.has(fnName)) continue;
    seenFns.add(fnName);
    functions.push({
      name: fnName,
      description: FUNCTION_DESCRIPTIONS[fnName] ?? `Google Sheets function: ${fnName}`,
      arguments: extractFunctionArgs(cleaned, match.index + fnName.length),
    });
  }

  const refRegex = /(?:(?:[A-Za-z_]\w*!\s*)?\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)/g;
  const references: Array<{ ref: string }> = [];
  const seenRefs = new Set<string>();

  while ((match = refRegex.exec(cleaned)) !== null) {
    const ref = match[0] ?? '';
    if (!seenRefs.has(ref)) {
      seenRefs.add(ref);
      references.push({ ref });
    }
  }

  const complexity: 'simple' | 'moderate' | 'complex' =
    functions.length >= 4 || cleaned.length > 120
      ? 'complex'
      : functions.length >= 2 || cleaned.length > 50
        ? 'moderate'
        : 'simple';

  return {
    summary: `Uses ${functions.length} function(s) with ${references.length} reference(s).`,
    functions,
    references,
    complexity,
  };
}

function extractFunctionArgs(formula: string, startIdx: number): string[] {
  const openIdx = formula.indexOf('(', startIdx);
  if (openIdx === -1) return [];

  let depth = 0;
  let current = '';
  const args: string[] = [];

  for (let i = openIdx + 1; i < formula.length; i++) {
    const ch = formula[i] ?? '';

    if (ch === '(') {
      depth++;
      current += ch;
      continue;
    }

    if (ch === ')') {
      if (depth === 0) {
        if (current.trim()) args.push(current.trim());
        break;
      }
      depth--;
      current += ch;
      continue;
    }

    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  return args;
}

const FUNCTION_DESCRIPTIONS: Record<string, string> = {
  SUM: 'Adds numbers in a range.',
  AVERAGE: 'Returns the arithmetic mean of values.',
  COUNT: 'Counts numeric values in a range.',
  COUNTA: 'Counts non-empty values in a range.',
  MIN: 'Returns the smallest value in a range.',
  MAX: 'Returns the largest value in a range.',
  IF: 'Returns one value if a condition is true and another if false.',
  IFS: 'Evaluates multiple conditions and returns the first matching result.',
  AND: 'Returns TRUE if all conditions are TRUE.',
  OR: 'Returns TRUE if any condition is TRUE.',
  NOT: 'Reverses TRUE/FALSE.',
  VLOOKUP: 'Looks up a value in the first column of a range.',
  XLOOKUP: 'Looks up a value in a range or array and returns a match.',
  INDEX: 'Returns a value by row/column position in a range.',
  MATCH: 'Returns the position of a value in a range.',
  FILTER: 'Filters a range by one or more conditions.',
  QUERY: 'Runs a SQL-like query against a range.',
  ARRAYFORMULA: 'Applies a formula to an entire range.',
  IFERROR: 'Returns an alternate value when an error occurs.',
  ROUND: 'Rounds a number to a specified number of digits.',
  ROUNDUP: 'Rounds a number up to a specified number of digits.',
  ROUNDDOWN: 'Rounds a number down to a specified number of digits.',
  CONCATENATE: 'Joins multiple text values.',
  TEXTJOIN: 'Joins text with a delimiter.',
  SPLIT: 'Splits text around a delimiter.',
  REGEXMATCH: 'Tests whether text matches a regular expression.',
  REGEXEXTRACT: 'Extracts text matching a regular expression.',
  REGEXREPLACE: 'Replaces text matching a regular expression.',
};
