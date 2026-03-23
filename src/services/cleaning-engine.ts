/**
 * ServalSheets - Cleaning Engine (F3: Automated Data Cleaning)
 *
 * Detects and fixes data quality issues: inconsistent formats, duplicates,
 * type mismatches, trailing whitespace, empty cells, invalid values, outliers.
 *
 * Used by FixHandler for: clean, standardize_formats, fill_missing,
 * detect_anomalies, suggest_cleaning actions.
 */

import type {
  CleanCellChange,
  CleanRule,
  FormatSpec,
  FillStrategy,
  AnomalyMethod,
  AnomalyRecord,
  CleaningRecommendation,
} from '../schemas/fix.js';
import { ANOMALY_DETECTORS, BUILT_IN_RULES, FORMAT_CONVERTERS } from './cleaning-engine-rules.js';
// ─── Types ───

export type CellValue = string | number | boolean | null;

export interface CleanResult {
  changes: CleanCellChange[];
  summary: {
    totalCells: number;
    cellsCleaned: number;
    rulesApplied: string[];
    byRule: Record<string, number>;
  };
}

export interface FormatResult {
  changes: CleanCellChange[];
  summary: {
    columnsProcessed: number;
    cellsChanged: number;
    byFormat: Record<string, number>;
  };
}

export interface FillResult {
  changes: CleanCellChange[];
  summary: {
    totalEmpty: number;
    filled: number;
    strategy: FillStrategy;
    byColumn: Record<string, number>;
  };
}

export interface AnomalyResult {
  anomalies: AnomalyRecord[];
  summary: {
    totalCellsAnalyzed: number;
    anomaliesFound: number;
    method: AnomalyMethod;
    threshold: number;
    byColumn: Record<string, number>;
  };
}

export interface ColumnProfile {
  column: string;
  header: string | undefined;
  type: string;
  nullCount: number;
  uniqueCount: number;
  sampleValues: CellValue[];
}

export interface DataProfile {
  [x: string]: unknown;
  totalRows: number;
  totalColumns: number;
  nullRate: number;
  columnProfiles: ColumnProfile[];
}

export interface SuggestResult {
  recommendations: CleaningRecommendation[];
  dataProfile: DataProfile;
}

// ─── Helpers ───

/** Convert column index to letter (0 = A, 25 = Z, 26 = AA) */
function colToLetter(col: number): string {
  let result = '';
  let c = col;
  while (c >= 0) {
    result = String.fromCharCode((c % 26) + 65) + result;
    c = Math.floor(c / 26) - 1;
  }
  return result;
}

/** Convert column letter to index (A = 0, Z = 25, AA = 26) */
function letterToCol(letter: string): number {
  let result = 0;
  for (let i = 0; i < letter.length; i++) {
    result = result * 26 + (letter.charCodeAt(i) - 64);
  }
  return result - 1;
}

/** Parse A1 range to extract start row/col offsets */
function parseRangeOffset(range: string): { startRow: number; startCol: number } {
  // Extract cell reference (e.g., "Sheet1!A1:Z100" → "A1")
  const cellPart = range.includes('!') ? (range.split('!')[1] ?? range) : range;
  const match = cellPart.match(/^([A-Z]+)(\d+)/);
  if (!match) return { startRow: 0, startCol: 0 };
  return { startRow: parseInt(match[2]!, 10) - 1, startCol: letterToCol(match[1]!) };
}

/** Resolve column reference (letter or header name) to column index */
function resolveColumnIndex(ref: string, headers: CellValue[]): number {
  // Try as letter first (A, B, AA, etc.)
  if (/^[A-Z]+$/.test(ref)) {
    return letterToCol(ref);
  }
  // Try as header name
  const idx = headers.findIndex(
    (h) => typeof h === 'string' && h.toLowerCase() === ref.toLowerCase()
  );
  return idx >= 0 ? idx : -1;
}

// ─── Cleaning Engine ───

export class CleaningEngine {
  // ─── clean ───

  async clean(
    data: CellValue[][],
    rules?: CleanRule[],
    rangeOffset?: { startRow: number; startCol: number }
  ): Promise<CleanResult> {
    const offset = rangeOffset ?? { startRow: 0, startCol: 0 };
    const changes: CleanCellChange[] = [];
    const rulesApplied = new Set<string>();
    const byRule: Record<string, number> = {};

    // Determine which rules to apply
    const activeRuleIds = rules
      ? rules.filter((r) => r.enabled !== false).map((r) => r.id)
      : Object.keys(BUILT_IN_RULES);

    // Skip header row (row 0)
    const startRow = data.length > 0 ? 1 : 0;
    let totalCells = 0;

    // Handle remove_duplicates specially (row-level)
    const dedupActive = activeRuleIds.includes('remove_duplicates');
    const seenRows = new Set<string>();
    const duplicateRows = new Set<number>();

    if (dedupActive && data.length > 1) {
      for (let r = startRow; r < data.length; r++) {
        const key = JSON.stringify(data[r]);
        if (seenRows.has(key)) {
          duplicateRows.add(r);
        } else {
          seenRows.add(key);
        }
      }
      if (duplicateRows.size > 0) {
        rulesApplied.add('remove_duplicates');
        byRule['remove_duplicates'] = duplicateRows.size;
      }
    }

    // Per-cell cleaning
    for (let r = startRow; r < data.length; r++) {
      if (duplicateRows.has(r)) continue; // Skip duplicate rows

      for (let c = 0; c < (data[r]?.length ?? 0); c++) {
        totalCells++;
        const value = data[r]?.[c] ?? null;

        for (const ruleId of activeRuleIds) {
          if (ruleId === 'remove_duplicates') continue;

          const rule = BUILT_IN_RULES[ruleId];
          if (!rule) continue;

          // Check column filter from user-provided rules
          if (rules) {
            const userRule = rules.find((ur) => ur.id === ruleId);
            if (userRule?.column) {
              const targetCol = resolveColumnIndex(userRule.column, data[0] ?? []);
              if (targetCol !== c) continue;
            }
          }

          if (rule.detect(value)) {
            const newValue = rule.fix(value);
            if (newValue !== value) {
              const cellRef = `${colToLetter(c + offset.startCol)}${r + 1 + offset.startRow}`;
              changes.push({
                row: r + offset.startRow,
                col: c + offset.startCol,
                cell: cellRef,
                oldValue: value,
                newValue: newValue,
                rule: ruleId,
              });
              rulesApplied.add(ruleId);
              byRule[ruleId] = (byRule[ruleId] ?? 0) + 1;
              break; // Apply first matching rule per cell
            }
          }
        }
      }
    }

    return {
      changes,
      summary: {
        totalCells,
        cellsCleaned: changes.length + duplicateRows.size,
        rulesApplied: Array.from(rulesApplied),
        byRule,
      },
    };
  }

  // ─── standardize_formats ───

  async standardizeFormats(
    data: CellValue[][],
    specs: FormatSpec[],
    rangeOffset?: { startRow: number; startCol: number }
  ): Promise<FormatResult> {
    const offset = rangeOffset ?? { startRow: 0, startCol: 0 };
    const changes: CleanCellChange[] = [];
    const byFormat: Record<string, number> = {};
    const headers = data[0] ?? [];
    const columnsProcessed = new Set<number>();

    for (const spec of specs) {
      const colIdx = resolveColumnIndex(spec.column, headers);
      if (colIdx < 0) continue;
      columnsProcessed.add(colIdx);

      const formatter = FORMAT_CONVERTERS[spec.targetFormat];
      if (!formatter) continue;

      // Skip header row
      for (let r = 1; r < data.length; r++) {
        const value = data[r]?.[colIdx];
        if (value === null || value === undefined || value === '') continue;

        const newValue = formatter(value);
        if (newValue !== value && newValue !== null) {
          const cellRef = `${colToLetter(colIdx + offset.startCol)}${r + 1 + offset.startRow}`;
          changes.push({
            row: r + offset.startRow,
            col: colIdx + offset.startCol,
            cell: cellRef,
            oldValue: value,
            newValue,
            rule: spec.targetFormat,
          });
          byFormat[spec.targetFormat] = (byFormat[spec.targetFormat] ?? 0) + 1;
        }
      }
    }

    return {
      changes,
      summary: {
        columnsProcessed: columnsProcessed.size,
        cellsChanged: changes.length,
        byFormat,
      },
    };
  }

  // ─── fill_missing ───

  async fillMissing(
    data: CellValue[][],
    strategy: FillStrategy,
    options?: {
      constantValue?: CellValue;
      columns?: string[];
    },
    rangeOffset?: { startRow: number; startCol: number }
  ): Promise<FillResult> {
    const offset = rangeOffset ?? { startRow: 0, startCol: 0 };
    const changes: CleanCellChange[] = [];
    const byColumn: Record<string, number> = {};
    const headers = data[0] ?? [];
    let totalEmpty = 0;

    // Determine which columns to fill
    const targetCols = options?.columns
      ? options.columns.map((c) => resolveColumnIndex(c, headers)).filter((c) => c >= 0)
      : Array.from({ length: headers.length }, (_, i) => i);

    for (const colIdx of targetCols) {
      const colRef = colToLetter(colIdx + offset.startCol);
      const colValues: { row: number; value: CellValue }[] = [];

      // Collect non-empty values and find empties
      for (let r = 1; r < data.length; r++) {
        const v = data[r]?.[colIdx];
        if (v === null || v === undefined || v === '') {
          totalEmpty++;
          colValues.push({ row: r, value: null });
        } else {
          colValues.push({ row: r, value: v });
        }
      }

      // Compute fill values based on strategy
      const numericValues = colValues
        .filter((cv) => cv.value !== null && typeof cv.value === 'number')
        .map((cv) => cv.value as number);

      for (let i = 0; i < colValues.length; i++) {
        const currentItem = colValues[i];
        if (!currentItem || currentItem.value !== null) continue;

        let fillValue: CellValue = null;
        const r = currentItem.row;

        switch (strategy) {
          case 'forward': {
            // Find last non-empty value before this index
            for (let j = i - 1; j >= 0; j--) {
              const jItem = colValues[j];
              if (jItem && jItem.value !== null) {
                fillValue = jItem.value;
                break;
              }
            }
            break;
          }
          case 'backward': {
            // Find next non-empty value after this index
            for (let j = i + 1; j < colValues.length; j++) {
              const jItem = colValues[j];
              if (jItem && jItem.value !== null) {
                fillValue = jItem.value;
                break;
              }
            }
            break;
          }
          case 'mean': {
            if (numericValues.length > 0) {
              fillValue =
                Math.round(
                  (numericValues.reduce((a, b) => a + b, 0) / numericValues.length) * 100
                ) / 100;
            }
            break;
          }
          case 'median': {
            if (numericValues.length > 0) {
              const sorted = [...numericValues].sort((a, b) => a - b);
              const mid = Math.floor(sorted.length / 2);
              const midVal = sorted[mid] ?? 0;
              const midPrevVal = sorted[mid - 1] ?? 0;
              fillValue =
                sorted.length % 2 !== 0
                  ? midVal
                  : Math.round(((midPrevVal + midVal) / 2) * 100) / 100;
            }
            break;
          }
          case 'mode': {
            const counts = new Map<string, { value: CellValue; count: number }>();
            for (const cv of colValues) {
              if (cv.value === null) continue;
              const key = String(cv.value);
              const entry = counts.get(key);
              if (entry) entry.count++;
              else counts.set(key, { value: cv.value, count: 1 });
            }
            let maxCount = 0;
            counts.forEach((entry) => {
              if (entry.count > maxCount) {
                maxCount = entry.count;
                fillValue = entry.value;
              }
            });
            break;
          }
          case 'constant': {
            fillValue = options?.constantValue ?? null;
            break;
          }
        }

        if (fillValue !== null) {
          const cellRef = `${colRef}${r + 1 + offset.startRow}`;
          changes.push({
            row: r + offset.startRow,
            col: colIdx + offset.startCol,
            cell: cellRef,
            oldValue: null,
            newValue: fillValue,
            rule: `fill_${strategy}`,
          });
          byColumn[colRef] = (byColumn[colRef] ?? 0) + 1;
        }
      }
    }

    return {
      changes,
      summary: {
        totalEmpty,
        filled: changes.length,
        strategy,
        byColumn,
      },
    };
  }

  // ─── detect_anomalies ───

  async detectAnomalies(
    data: CellValue[][],
    method: AnomalyMethod = 'iqr',
    threshold?: number,
    columns?: string[],
    rangeOffset?: { startRow: number; startCol: number }
  ): Promise<AnomalyResult> {
    const offset = rangeOffset ?? { startRow: 0, startCol: 0 };
    const anomalies: AnomalyRecord[] = [];
    const byColumn: Record<string, number> = {};
    const headers = data[0] ?? [];
    let totalCellsAnalyzed = 0;

    // Default thresholds per method
    const effectiveThreshold =
      threshold ?? (method === 'iqr' ? 1.5 : method === 'zscore' ? 3.0 : 3.5);

    // Determine which columns to analyze
    const targetCols = columns
      ? columns.map((c) => resolveColumnIndex(c, headers)).filter((c) => c >= 0)
      : this.detectNumericColumns(data);

    for (const colIdx of targetCols) {
      const colRef = colToLetter(colIdx + offset.startCol);
      const headerName = typeof headers[colIdx] === 'string' ? (headers[colIdx] as string) : colRef;

      // Collect numeric values from this column
      const numericEntries: { row: number; value: number }[] = [];
      for (let r = 1; r < data.length; r++) {
        const v = data[r]?.[colIdx];
        if (typeof v === 'number' && !isNaN(v)) {
          numericEntries.push({ row: r, value: v });
          totalCellsAnalyzed++;
        }
      }

      if (numericEntries.length < 3) continue; // Need at least 3 values

      // Detect anomalies using the chosen method
      const values = numericEntries.map((e) => e.value);
      const detector = ANOMALY_DETECTORS[method];

      for (const entry of numericEntries) {
        const score = detector(entry.value, values, effectiveThreshold);
        const isAnomaly = score > effectiveThreshold;

        if (isAnomaly) {
          const cellRef = `${colRef}${entry.row + 1 + offset.startRow}`;
          anomalies.push({
            cell: cellRef,
            value: entry.value,
            score: Math.round(score * 1000) / 1000,
            column: headerName,
            method,
            threshold: effectiveThreshold,
            isAnomaly: true,
          });
          byColumn[headerName] = (byColumn[headerName] ?? 0) + 1;
        }
      }
    }

    return {
      anomalies,
      summary: {
        totalCellsAnalyzed,
        anomaliesFound: anomalies.length,
        method,
        threshold: effectiveThreshold,
        byColumn,
      },
    };
  }

  // ─── suggest_cleaning ───

  async suggestCleaning(
    data: CellValue[][],
    maxRecommendations: number = 10,
    rangeOffset?: { startRow: number; startCol: number }
  ): Promise<SuggestResult> {
    const offset = rangeOffset ?? { startRow: 0, startCol: 0 };
    const headers = data[0] ?? [];
    const recommendations: CleaningRecommendation[] = [];

    // Build data profile
    const dataProfile = this.profileData(data, offset);

    // Run each built-in rule as a detector and count hits
    for (const [ruleId, rule] of Object.entries(BUILT_IN_RULES)) {
      if (ruleId === 'remove_duplicates') continue; // Handle separately

      let hitCount = 0;
      const sampleBefore: CellValue[] = [];
      const sampleAfter: CellValue[] = [];
      let affectedColumn: string | undefined;

      for (let c = 0; c < (data[0]?.length ?? 0); c++) {
        let colHits = 0;
        for (let r = 1; r < data.length; r++) {
          const v = data[r]?.[c] ?? null;
          if (rule.detect(v)) {
            colHits++;
            if (sampleBefore.length < 3) {
              sampleBefore.push(v);
              sampleAfter.push(rule.fix(v));
            }
          }
        }
        if (colHits > hitCount) {
          hitCount = colHits;
          affectedColumn = typeof headers[c] === 'string' ? (headers[c] as string) : colToLetter(c);
        }
      }

      if (hitCount > 0) {
        recommendations.push({
          id: `suggest_${ruleId}`,
          title: rule.description,
          description: `Found ${hitCount} cell(s) that can be cleaned using "${ruleId}" rule${affectedColumn ? ` (highest in column "${affectedColumn}")` : ''}`,
          column: affectedColumn,
          issueCount: hitCount,
          severity: hitCount > 50 ? 'high' : hitCount > 10 ? 'medium' : 'low',
          suggestedRule: ruleId,
          sampleBefore,
          sampleAfter,
        });
      }
    }

    // Check for duplicate rows
    if (data.length > 1) {
      const seen = new Set<string>();
      let dupeCount = 0;
      for (let r = 1; r < data.length; r++) {
        const key = JSON.stringify(data[r]);
        if (seen.has(key)) dupeCount++;
        else seen.add(key);
      }
      if (dupeCount > 0) {
        recommendations.push({
          id: 'suggest_remove_duplicates',
          title: 'Remove duplicate rows',
          description: `Found ${dupeCount} exact duplicate row(s)`,
          issueCount: dupeCount,
          severity: dupeCount > 20 ? 'high' : dupeCount > 5 ? 'medium' : 'low',
          suggestedRule: 'remove_duplicates',
          sampleBefore: [],
          sampleAfter: [],
        });
      }
    }

    // Check for anomalies in numeric columns
    const numericCols = this.detectNumericColumns(data);
    if (numericCols.length > 0) {
      const anomalyResult = await this.detectAnomalies(data, 'iqr', 1.5, undefined, offset);
      if (anomalyResult.anomalies.length > 0) {
        recommendations.push({
          id: 'suggest_detect_anomalies',
          title: 'Review statistical outliers',
          description: `Found ${anomalyResult.anomalies.length} potential outlier(s) across ${Object.keys(anomalyResult.summary.byColumn).length} column(s) using IQR method`,
          issueCount: anomalyResult.anomalies.length,
          severity:
            anomalyResult.anomalies.length > 10
              ? 'high'
              : anomalyResult.anomalies.length > 3
                ? 'medium'
                : 'low',
          suggestedRule: 'detect_anomalies',
          sampleBefore: anomalyResult.anomalies.slice(0, 3).map((a) => a.value),
          sampleAfter: anomalyResult.anomalies.slice(0, 3).map((a) => a.value), // Anomalies aren't "fixed", just flagged
        });
      }
    }

    // Check for missing values
    const emptyCount = dataProfile.columnProfiles.reduce((sum, cp) => sum + cp.nullCount, 0);
    if (emptyCount > 0) {
      recommendations.push({
        id: 'suggest_fill_missing',
        title: 'Fill empty cells',
        description: `Found ${emptyCount} empty cell(s) across ${dataProfile.columnProfiles.filter((cp) => cp.nullCount > 0).length} column(s). Consider using fill_missing with forward, mean, or constant strategy.`,
        issueCount: emptyCount,
        severity: emptyCount > 50 ? 'high' : emptyCount > 10 ? 'medium' : 'low',
        suggestedRule: 'fill_missing',
        sampleBefore: [],
        sampleAfter: [],
      });
    }

    // Sort by severity (high first) then by issue count
    const severityOrder = { high: 0, medium: 1, low: 2 };
    recommendations.sort(
      (a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.issueCount - a.issueCount
    );

    return {
      recommendations: recommendations.slice(0, maxRecommendations),
      dataProfile,
    };
  }

  // ─── Utility methods ───

  /** Detect columns that are predominantly numeric */
  private detectNumericColumns(data: CellValue[][]): number[] {
    const numericCols: number[] = [];
    const colCount = data[0]?.length ?? 0;

    for (let c = 0; c < colCount; c++) {
      let numericCount = 0;
      let totalCount = 0;

      for (let r = 1; r < data.length; r++) {
        const v = data[r]?.[c];
        if (v === null || v === undefined || v === '') continue;
        totalCount++;
        if (typeof v === 'number') numericCount++;
      }

      if (totalCount > 0 && numericCount / totalCount >= 0.8) {
        numericCols.push(c);
      }
    }

    return numericCols;
  }

  /** Build a profile of the data */
  profileData(
    data: CellValue[][],
    rangeOffset?: { startRow: number; startCol: number }
  ): DataProfile {
    const offset = rangeOffset ?? { startRow: 0, startCol: 0 };
    const headers = data[0] ?? [];
    const colCount = headers.length;
    const rowCount = data.length - 1; // Exclude header
    let totalNulls = 0;
    let totalCells = 0;

    const columnProfiles: ColumnProfile[] = [];

    for (let c = 0; c < colCount; c++) {
      const colRef = colToLetter(c + offset.startCol);
      const typeCounts: Record<string, number> = {};
      let nullCount = 0;
      const uniqueValues = new Set<string>();
      const sampleValues: CellValue[] = [];

      for (let r = 1; r < data.length; r++) {
        totalCells++;
        const v = data[r]?.[c];

        if (v === null || v === undefined || v === '') {
          nullCount++;
          totalNulls++;
          continue;
        }

        const type = typeof v;
        typeCounts[type] = (typeCounts[type] ?? 0) + 1;
        uniqueValues.add(String(v));
        if (sampleValues.length < 5) sampleValues.push(v);
      }

      // Find dominant type
      let dominantType = 'empty';
      let maxTypeCount = 0;
      for (const [type, count] of Object.entries(typeCounts)) {
        if (count > maxTypeCount) {
          maxTypeCount = count;
          dominantType = type;
        }
      }

      columnProfiles.push({
        column: colRef,
        header: typeof headers[c] === 'string' ? (headers[c] as string) : undefined,
        type: dominantType,
        nullCount,
        uniqueCount: uniqueValues.size,
        sampleValues,
      });
    }

    return {
      totalRows: rowCount,
      totalColumns: colCount,
      nullRate: totalCells > 0 ? Math.round((totalNulls / totalCells) * 10000) / 10000 : 0,
      columnProfiles,
    };
  }
}
// Export parseRangeOffset for handler use
export { parseRangeOffset };
