/**
 * ImpactAnalyzer
 *
 * @purpose Analyzes operation impact before execution: cells/rows/columns affected, formulas broken, charts/pivots impacted
 * @category Quality
 * @usage Use before destructive operations (delete rows, clear range); provides warnings, recommendations, risk assessment
 * @dependencies sheets_v4, logger
 * @stateful No - stateless analysis service processing operations on-demand
 * @singleton No - can be instantiated per analysis request
 *
 * @example
 * const analyzer = new ImpactAnalyzer(sheetsClient);
 * const impact = await analyzer.analyze(spreadsheetId, { type: 'delete_rows', startRow: 5, endRow: 10 });
 * if (impact.severity === 'high') logger.warn('Will break', impact.formulasAffected, 'formulas!');
 */

import { v4 as uuidv4 } from 'uuid';
import { sheets_v4 } from 'googleapis';
import { logger } from '../utils/logger.js';
import { ServiceError } from '../core/errors.js';
import {
  ImpactAnalysis,
  ImpactSeverity,
  ImpactWarning,
  AffectedFormula,
  AffectedChart,
  AffectedPivotTable,
  AffectedValidationRule,
  AffectedNamedRange,
  AffectedProtectedRange,
  ImpactAnalyzerConfig,
  ImpactAnalyzerStats,
} from '../types/impact.js';

/**
 * Impact Analyzer - Analyzes operation impact before execution
 */
export class ImpactAnalyzer {
  private config: Required<Omit<ImpactAnalyzerConfig, 'googleClient'>>;
  private googleClient?: ImpactAnalyzerConfig['googleClient'];
  private stats: ImpactAnalyzerStats;

  constructor(config: ImpactAnalyzerConfig = {}) {
    this.googleClient = config.googleClient;
    this.config = {
      enabled: config.enabled ?? true,
      analyzeFormulas: config.analyzeFormulas ?? true,
      analyzeCharts: config.analyzeCharts ?? true,
      analyzePivotTables: config.analyzePivotTables ?? true,
      analyzeValidationRules: config.analyzeValidationRules ?? true,
      analyzeNamedRanges: config.analyzeNamedRanges ?? true,
      analyzeProtectedRanges: config.analyzeProtectedRanges ?? true,
      analysisTimeoutMs: config.analysisTimeoutMs ?? 5000,
      verboseLogging: config.verboseLogging ?? false,
    };

    this.stats = {
      totalAnalyses: 0,
      operationsPrevented: 0,
      avgAnalysisTime: 0,
      totalWarnings: 0,
      warningsBySeverity: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      },
    };
  }

  /**
   * Analyze operation impact
   */
  async analyzeOperation(operation: {
    type: string;
    tool: string;
    action: string;
    params: Record<string, unknown>;
  }): Promise<ImpactAnalysis> {
    const startTime = Date.now();
    this.stats.totalAnalyses++;

    this.log(`Analyzing impact for operation: ${operation.tool}.${operation.action}`);

    // Parse range from parameters
    const range = this.extractRange(operation.params);
    const { rows, columns, cells } = this.calculateRangeSize(range);

    // OPTIMIZED: Single comprehensive API call to get all data
    const comprehensiveData = await this.fetchComprehensiveData(range);

    // Parse affected resources from comprehensive data
    const formulasAffected = this.config.analyzeFormulas
      ? this.parseFormulasFromData(comprehensiveData, range)
      : [];

    const chartsAffected = this.config.analyzeCharts
      ? this.parseChartsFromData(comprehensiveData, range)
      : [];

    const pivotTablesAffected = this.config.analyzePivotTables
      ? this.parsePivotTablesFromData(comprehensiveData, range)
      : [];

    const validationRulesAffected = this.config.analyzeValidationRules
      ? this.parseValidationRulesFromData(comprehensiveData, range)
      : [];

    const namedRangesAffected = this.config.analyzeNamedRanges
      ? this.parseNamedRangesFromData(comprehensiveData, range)
      : [];

    const protectedRangesAffected = this.config.analyzeProtectedRanges
      ? this.parseProtectedRangesFromData(comprehensiveData, range)
      : [];

    // Calculate execution time estimate
    const estimatedExecutionTime = this.estimateExecutionTime(operation, cells);

    // Determine severity
    const severity = this.calculateSeverity(
      cells,
      formulasAffected.length,
      chartsAffected.length,
      protectedRangesAffected.length
    );

    // Generate warnings
    const warnings = this.generateWarnings(
      cells,
      formulasAffected,
      chartsAffected,
      pivotTablesAffected,
      protectedRangesAffected
    );

    // Update statistics
    warnings.forEach((w) => {
      this.stats.totalWarnings++;
      this.stats.warningsBySeverity[w.severity]++;
    });

    if (severity === 'critical') {
      this.stats.operationsPrevented++;
    }

    const duration = Date.now() - startTime;
    this.stats.avgAnalysisTime =
      (this.stats.avgAnalysisTime * (this.stats.totalAnalyses - 1) + duration) /
      this.stats.totalAnalyses;

    // Generate recommendations
    const recommendations = this.generateRecommendations(operation, warnings, severity);

    const analysis: ImpactAnalysis = {
      id: uuidv4(),
      operation,
      cellsAffected: cells,
      rowsAffected: rows,
      columnsAffected: columns,
      formulasAffected,
      chartsAffected,
      pivotTablesAffected,
      validationRulesAffected,
      conditionalFormatsAffected: 0,
      namedRangesAffected,
      protectedRangesAffected,
      estimatedExecutionTime,
      severity,
      warnings,
      recommendations,
      timestamp: Date.now(),
    };

    this.log(
      `Impact analysis complete: ${cells} cells, ${warnings.length} warnings, ${severity} severity`
    );

    return analysis;
  }

  /**
   * Extract range from operation parameters
   */
  private extractRange(params: Record<string, unknown>): string {
    return (params['range'] as string) || (params['targetRange'] as string) || 'A1';
  }

  /**
   * Calculate range size
   */
  private calculateRangeSize(range: string): {
    rows: number;
    columns: number;
    cells: number;
  } {
    // Parse A1 notation (e.g., "A1:B10")
    const match = range.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);

    if (!match) {
      return { rows: 1, columns: 1, cells: 1 };
    }

    if (!match[1] || !match[2] || !match[3] || !match[4]) {
      return { rows: 1, columns: 1, cells: 1 };
    }

    const startCol = this.columnToNumber(match[1]);
    const startRow = parseInt(match[2], 10);
    const endCol = this.columnToNumber(match[3]);
    const endRow = parseInt(match[4], 10);

    const rows = endRow - startRow + 1;
    const columns = endCol - startCol + 1;
    const cells = rows * columns;

    return { rows, columns, cells };
  }

  /**
   * Convert column letter to number
   */
  private columnToNumber(column: string): number {
    let result = 0;
    for (let i = 0; i < column.length; i++) {
      result = result * 26 + (column.charCodeAt(i) - 64);
    }
    return result;
  }

  /**
   * Convert row/column index to A1 notation
   */
  private indexToA1(row: number, col: number): string {
    let column = '';
    let colNum = col + 1; // Convert from 0-based to 1-based

    while (colNum > 0) {
      const remainder = (colNum - 1) % 26;
      column = String.fromCharCode(65 + remainder) + column;
      colNum = Math.floor((colNum - 1) / 26);
    }

    return `${column}${row + 1}`; // row is also 0-based
  }

  /**
   * Parse range string to extract spreadsheetId and range
   */
  private parseRange(range: string): { spreadsheetId?: string; range: string } {
    // Check if range includes spreadsheetId (format: "spreadsheetId!Sheet1!A1:B10")
    const parts = range.split('!');
    if (parts.length >= 3) {
      return {
        spreadsheetId: parts[0],
        range: parts.slice(1).join('!'),
      };
    }
    return { range };
  }

  /**
   * Check if formula references a given range
   */
  private formulaReferencesRange(formula: string, range: string): boolean {
    // Simple heuristic: check if the range appears in the formula
    // This is a simplified implementation; a real one would parse the formula AST
    const rangePattern = this.parseRange(range).range;
    return formula.toUpperCase().includes(rangePattern.toUpperCase());
  }

  /**
   * Convert GridRange to A1 notation
   */
  private gridRangeToA1(gridRange: {
    startRowIndex?: number | null;
    endRowIndex?: number | null;
    startColumnIndex?: number | null;
    endColumnIndex?: number | null;
  }): string {
    const startRow = (gridRange.startRowIndex ?? 0) + 1;
    const endRow = (gridRange.endRowIndex ?? startRow - 1) + 1;
    const startCol = this.numberToColumn((gridRange.startColumnIndex ?? 0) + 1);
    const endCol = this.numberToColumn(
      (gridRange.endColumnIndex ?? startCol.charCodeAt(0) - 65) + 1
    );

    if (startRow === endRow && startCol === endCol) {
      return `${startCol}${startRow}`;
    }
    return `${startCol}${startRow}:${endCol}${endRow}`;
  }

  /**
   * Convert column number to letter
   */
  private numberToColumn(num: number): string {
    let column = '';
    while (num > 0) {
      const remainder = (num - 1) % 26;
      column = String.fromCharCode(65 + remainder) + column;
      num = Math.floor((num - 1) / 26);
    }
    return column;
  }

  /**
   * Check if two ranges overlap
   */
  private rangesOverlap(range1: string, range2: string): boolean {
    // Simplified overlap check - just check if range strings are similar
    // A real implementation would parse both ranges and check for geometric overlap
    return (
      range1.toUpperCase().includes(range2.toUpperCase()) ||
      range2.toUpperCase().includes(range1.toUpperCase())
    );
  }

  /**
   * Get chart type from chart spec
   */
  private getChartType(spec: unknown): string {
    const specObj = spec as Record<string, unknown>;
    if (specObj['basicChart'])
      return ((specObj['basicChart'] as Record<string, unknown>)['chartType'] as string) || 'BASIC';
    if (specObj['pieChart']) return 'PIE';
    if (specObj['bubbleChart']) return 'BUBBLE';
    if (specObj['candlestickChart']) return 'CANDLESTICK';
    if (specObj['orgChart']) return 'ORG';
    if (specObj['histogramChart']) return 'HISTOGRAM';
    if (specObj['waterfallChart']) return 'WATERFALL';
    if (specObj['treemapChart']) return 'TREEMAP';
    if (specObj['scorecardChart']) return 'SCORECARD';
    return 'UNKNOWN';
  }

  /**
   * Fetch comprehensive spreadsheet data in a single API call
   * OPTIMIZATION: Replaces 6 sequential calls with 1 comprehensive call
   */
  private async fetchComprehensiveData(
    range: string
  ): Promise<sheets_v4.Schema$Spreadsheet | null> {
    if (!this.googleClient) {
      return null;
    }

    const params = this.parseRange(range);
    if (!params.spreadsheetId) {
      return null;
    }

    try {
      // Single comprehensive field mask combining all analysis needs
      const comprehensiveFields = [
        'spreadsheetId',
        'properties.title',
        'sheets(properties(sheetId,title),',
        'data.rowData.values.userEnteredValue.formulaValue,', // Formulas
        'charts(chartId,spec),', // Charts
        'pivotTables,', // Pivot tables
        'conditionalFormats,', // Conditional formatting
        'dataValidation)', // Validation rules
        'namedRanges,', // Named ranges
        'protectedRanges', // Protected ranges
      ].join('');

      const spreadsheet = await this.googleClient.sheets.spreadsheets.get({
        spreadsheetId: params.spreadsheetId,
        fields: comprehensiveFields,
      });

      return spreadsheet.data;
    } catch (error) {
      this.log(
        `Error fetching comprehensive data: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Parse formulas from comprehensive data
   */
  private parseFormulasFromData(
    data: sheets_v4.Schema$Spreadsheet | null,
    range: string
  ): AffectedFormula[] {
    if (!data?.sheets) return [];

    const affected: AffectedFormula[] = [];
    for (const sheet of data.sheets) {
      const sheetName = sheet.properties?.title || 'Unknown';
      const gridData = sheet.data;

      if (!gridData) continue;

      for (const grid of gridData) {
        const rowData = grid.rowData;
        if (!rowData) continue;

        for (let rowIndex = 0; rowIndex < rowData.length; rowIndex++) {
          const row = rowData[rowIndex];
          const values = row?.values;
          if (!values) continue;

          for (let colIndex = 0; colIndex < values.length; colIndex++) {
            const cell = values[colIndex];
            const formula = cell?.userEnteredValue?.formulaValue;

            if (formula && this.formulaReferencesRange(formula, range)) {
              const cellAddress = this.indexToA1(rowIndex, colIndex);
              affected.push({
                cell: cellAddress,
                sheetName,
                formula,
                impactType: 'references_affected_range',
                description: `Formula references cells in the affected range ${range}`,
              });
            }
          }
        }
      }
    }

    return affected;
  }

  /**
   * Parse charts from comprehensive data
   */
  private parseChartsFromData(
    data: sheets_v4.Schema$Spreadsheet | null,
    range: string
  ): AffectedChart[] {
    if (!data?.sheets) return [];

    const affected: AffectedChart[] = [];
    for (const sheet of data.sheets) {
      const sheetName = sheet.properties?.title || 'Unknown';
      const charts = sheet.charts || [];

      for (const chart of charts) {
        if (!chart.chartId || !chart.spec) continue;

        // Check if chart uses the affected range
        const spec = chart.spec;
        const domains = spec.basicChart?.domains || [];
        const series = spec.basicChart?.series || [];

        let usesRange = false;
        for (const domain of domains) {
          if (domain.domain?.sourceRange?.sources) {
            for (const source of domain.domain.sourceRange.sources) {
              const chartRange = this.gridRangeToA1(source);
              if (this.rangesOverlap(range, chartRange)) {
                usesRange = true;
                break;
              }
            }
          }
        }

        for (const s of series) {
          if (s.series?.sourceRange?.sources) {
            for (const source of s.series.sourceRange.sources) {
              const chartRange = this.gridRangeToA1(source);
              if (this.rangesOverlap(range, chartRange)) {
                usesRange = true;
                break;
              }
            }
          }
        }

        if (usesRange) {
          affected.push({
            chartId: chart.chartId,
            title: chart.spec.title || 'Untitled Chart',
            sheetName,
            chartType: this.getChartType(spec),
            dataRanges: [range],
            impactType: 'data_source_affected',
            description: `Chart uses data from the affected range ${range}`,
          });
        }
      }
    }

    return affected;
  }

  /**
   * Parse pivot tables from comprehensive data
   */
  private parsePivotTablesFromData(
    data: sheets_v4.Schema$Spreadsheet | null,
    _range: string
  ): AffectedPivotTable[] {
    if (!data?.sheets) return [];

    // Type assertion: The API response includes pivotTables but TypeScript types don't expose it
    const sheets = data.sheets as Array<{
      properties?: { title?: string | null; sheetId?: number | null } | null;
      pivotTables?: Array<{
        pivotTableId?: number | null;
        source?: {
          sheetId?: number | null;
          startRowIndex?: number | null;
          endRowIndex?: number | null;
          startColumnIndex?: number | null;
          endColumnIndex?: number | null;
        } | null;
      }> | null;
    }>;

    const affected: AffectedPivotTable[] = [];
    for (const sheet of sheets) {
      const sheetName = sheet.properties?.title || 'Unknown';
      const pivotTables = sheet.pivotTables || [];

      for (const pivot of pivotTables) {
        if (!pivot.source) continue;

        const sourceRange = this.gridRangeToA1(pivot.source);
        if (this.rangesOverlap(_range, sourceRange)) {
          affected.push({
            pivotTableId: pivot.pivotTableId || 0,
            sheetName,
            sourceRange,
            impactType: 'source_data_affected',
            description: `Pivot table source data overlaps with ${_range}`,
          });
        }
      }
    }

    return affected;
  }

  /**
   * Parse validation rules from comprehensive data
   */
  private parseValidationRulesFromData(
    data: sheets_v4.Schema$Spreadsheet | null,
    _range: string
  ): AffectedValidationRule[] {
    if (!data?.sheets) return [];

    const affected: AffectedValidationRule[] = [];
    for (const sheet of data.sheets) {
      const _sheetName = sheet.properties?.title || 'Unknown';
      const gridData = sheet.data;

      if (!gridData) continue;

      for (const grid of gridData) {
        const rowData = grid.rowData;
        if (!rowData) continue;

        for (let rowIndex = 0; rowIndex < rowData.length; rowIndex++) {
          const row = rowData[rowIndex];
          const values = row?.values;
          if (!values) continue;

          for (let colIndex = 0; colIndex < values.length; colIndex++) {
            const cell = values[colIndex];
            const validation = cell?.dataValidation;

            if (validation) {
              const cellAddress = this.indexToA1(rowIndex, colIndex);
              affected.push({
                ruleId: `${_sheetName}:${cellAddress}`,
                range: cellAddress,
                ruleType: validation.condition?.type || 'UNKNOWN',
                impactType: 'may_conflict',
                description: `Validation rule at ${cellAddress} may be affected`,
              });
            }
          }
        }
      }
    }

    return affected;
  }

  /**
   * Parse named ranges from comprehensive data
   */
  private parseNamedRangesFromData(
    data: sheets_v4.Schema$Spreadsheet | null,
    range: string
  ): AffectedNamedRange[] {
    if (!data?.namedRanges) return [];

    const affected: AffectedNamedRange[] = [];
    for (const namedRange of data.namedRanges) {
      const name = namedRange.name || 'Unnamed';
      const nr = namedRange.range;

      if (nr) {
        const namedRangeStr = this.gridRangeToA1(nr);
        if (this.rangesOverlap(range, namedRangeStr)) {
          affected.push({
            namedRangeId: namedRange.namedRangeId || 'unknown',
            name,
            range: namedRangeStr,
            impactType: 'will_be_affected',
            description: `Named range "${name}" overlaps with ${range}`,
          });
        }
      }
    }

    return affected;
  }

  /**
   * Parse protected ranges from comprehensive data
   */
  private parseProtectedRangesFromData(
    data: sheets_v4.Schema$Spreadsheet | null,
    _range: string
  ): AffectedProtectedRange[] {
    if (!data?.sheets) return [];

    const affected: AffectedProtectedRange[] = [];
    for (const sheet of data.sheets) {
      const protectedRanges = sheet.protectedRanges || [];

      for (const pr of protectedRanges) {
        const protectedRange = pr.range ? this.gridRangeToA1(pr.range) : 'Entire sheet';

        if (pr.range && this.rangesOverlap(_range, protectedRange)) {
          affected.push({
            protectedRangeId: pr.protectedRangeId || 0,
            range: protectedRange,
            description: `Protected range at ${protectedRange} overlaps with ${_range}`,
            impactType: 'will_be_affected',
            editors: pr.editors?.users || [],
          });
        }
      }
    }

    return affected;
  }

  /**
   * Estimate execution time
   */
  private estimateExecutionTime(
    operation: { type: string; tool: string; action: string },
    cellCount: number
  ): number {
    // Base time: 100ms
    let time = 100;

    // Add time based on cell count
    time += cellCount * 0.5;

    // Add time based on operation type
    if (operation.tool.includes('format')) {
      time += cellCount * 0.3;
    }

    if (operation.tool.includes('formula')) {
      time += cellCount * 1.0;
    }

    return Math.round(time);
  }

  /**
   * Calculate impact severity
   */
  private calculateSeverity(
    cells: number,
    formulas: number,
    charts: number,
    protectedRanges: number
  ): ImpactSeverity {
    // Critical: Protected ranges or large cell count
    if (protectedRanges > 0 || cells > 10000) {
      return 'critical';
    }

    // High: Many formulas or charts affected
    if (formulas > 10 || charts > 3) {
      return 'high';
    }

    // Medium: Some formulas or charts
    if (formulas > 0 || charts > 0 || cells > 1000) {
      return 'medium';
    }

    // Low: Minimal impact
    return 'low';
  }

  /**
   * Generate warnings
   */
  private generateWarnings(
    cells: number,
    formulas: AffectedFormula[],
    charts: AffectedChart[],
    pivotTables: AffectedPivotTable[],
    protectedRanges: AffectedProtectedRange[]
  ): ImpactWarning[] {
    const warnings: ImpactWarning[] = [];

    // Large cell count warning
    if (cells > 10000) {
      warnings.push({
        severity: 'critical',
        message: `This operation affects ${cells.toLocaleString()} cells, which may take significant time`,
        resourceType: 'cells',
        affectedCount: cells,
        suggestedAction: 'Consider breaking into smaller operations',
      });
    } else if (cells > 1000) {
      warnings.push({
        severity: 'medium',
        message: `This operation affects ${cells.toLocaleString()} cells`,
        resourceType: 'cells',
        affectedCount: cells,
      });
    }

    // Formulas warning
    if (formulas.length > 0) {
      warnings.push({
        severity: formulas.length > 10 ? 'high' : 'medium',
        message: `${formulas.length} formula(s) reference this range and may be affected`,
        resourceType: 'formulas',
        affectedCount: formulas.length,
        suggestedAction: 'Review formulas before proceeding',
      });
    }

    // Charts warning
    if (charts.length > 0) {
      warnings.push({
        severity: charts.length > 3 ? 'high' : 'medium',
        message: `${charts.length} chart(s) use data from this range`,
        resourceType: 'charts',
        affectedCount: charts.length,
        suggestedAction: 'Charts may need to be updated',
      });
    }

    // Protected ranges warning
    if (protectedRanges.length > 0) {
      warnings.push({
        severity: 'critical',
        message: `This range is protected. Edit permissions required.`,
        resourceType: 'protected_ranges',
        affectedCount: protectedRanges.length,
        suggestedAction: 'Request edit permissions from sheet owner',
      });
    }

    return warnings;
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(
    operation: { type: string; tool: string; action: string },
    warnings: ImpactWarning[],
    severity: ImpactSeverity
  ): string[] {
    const recommendations: string[] = [];

    // Critical severity recommendations
    if (severity === 'critical') {
      recommendations.push('Review all warnings carefully before proceeding');
      recommendations.push('Consider creating a backup snapshot');
    }

    // Large operation recommendations
    if (warnings.some((w) => w.resourceType === 'cells' && w.affectedCount > 1000)) {
      recommendations.push('Use a transaction to ensure atomicity');
      recommendations.push('Consider breaking into smaller batches');
    }

    // Formula recommendations
    if (warnings.some((w) => w.resourceType === 'formulas')) {
      recommendations.push('Verify formula references after operation');
    }

    // Chart recommendations
    if (warnings.some((w) => w.resourceType === 'charts')) {
      recommendations.push('Refresh charts after operation');
    }

    return recommendations;
  }

  /**
   * Log message
   */
  private log(message: string): void {
    if (this.config.verboseLogging) {
      logger.debug('[ImpactAnalyzer] ' + message);
    }
  }

  /**
   * Get statistics
   */
  getStats(): ImpactAnalyzerStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalAnalyses: 0,
      operationsPrevented: 0,
      avgAnalysisTime: 0,
      totalWarnings: 0,
      warningsBySeverity: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      },
    };
  }
}

// Singleton instance
let impactAnalyzerInstance: ImpactAnalyzer | null = null;

/**
 * Initialize impact analyzer (call once during server startup)
 */
export function initImpactAnalyzer(
  googleClient?: ImpactAnalyzerConfig['googleClient']
): ImpactAnalyzer {
  if (!impactAnalyzerInstance) {
    impactAnalyzerInstance = new ImpactAnalyzer({
      enabled: process.env['IMPACT_ANALYSIS_ENABLED'] !== 'false',
      analyzeFormulas: process.env['IMPACT_ANALYZE_FORMULAS'] !== 'false',
      analyzeCharts: process.env['IMPACT_ANALYZE_CHARTS'] !== 'false',
      analyzePivotTables: process.env['IMPACT_ANALYZE_PIVOT_TABLES'] !== 'false',
      analyzeValidationRules: process.env['IMPACT_ANALYZE_VALIDATION'] !== 'false',
      analyzeNamedRanges: process.env['IMPACT_ANALYZE_NAMED_RANGES'] !== 'false',
      analyzeProtectedRanges: process.env['IMPACT_ANALYZE_PROTECTED'] !== 'false',
      analysisTimeoutMs: parseInt(process.env['IMPACT_ANALYSIS_TIMEOUT_MS'] || '5000'),
      verboseLogging: process.env['IMPACT_VERBOSE'] === 'true',
      googleClient,
    });
  }
  return impactAnalyzerInstance;
}

/**
 * Get impact analyzer instance
 */
export function getImpactAnalyzer(): ImpactAnalyzer {
  if (!impactAnalyzerInstance) {
    throw new ServiceError(
      'Impact analyzer not initialized. Call initImpactAnalyzer() first.',
      'SERVICE_NOT_INITIALIZED',
      'ImpactAnalyzer'
    );
  }
  return impactAnalyzerInstance;
}

/**
 * Reset impact analyzer (for testing only)
 * @internal
 */
export function resetImpactAnalyzer(): void {
  if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] !== 'true') {
    throw new ServiceError(
      'resetImpactAnalyzer() can only be called in test environment',
      'INTERNAL_ERROR',
      'ImpactAnalyzer'
    );
  }
  impactAnalyzerInstance = null;
}
