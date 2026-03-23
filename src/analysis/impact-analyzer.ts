/**
 * ServalSheets - Impact Analyzer
 *
 * Analyzes the impact of changes to cells by:
 * 1. Building dependency graph from spreadsheet formulas
 * 2. Detecting circular dependencies
 * 3. Calculating affected cells when a cell changes
 * 4. Estimating recalculation cost
 *
 * Usage:
 * ```typescript
 * const analyzer = new ImpactAnalyzer();
 * await analyzer.buildFromSpreadsheet(sheetsApi, spreadsheetId);
 * const impact = analyzer.analyzeImpact('Sheet1!A1');
 * ```
 *
 * @category Analysis
 */

import type { sheets_v4 } from 'googleapis';
import { DependencyGraph, type CircularDependency } from './dependency-graph.js';
import { parseFormula, normalizeReference } from './formula-parser.js';
import { logger } from '../utils/logger.js';
import { sendProgress } from '../utils/request-context.js';

/**
 * Cell with formula info
 */
export interface CellInfo {
  /** Cell address (A1 notation) */
  cell: string;
  /** Formula (if any) */
  formula?: string;
  /** Cell value */
  value?: unknown;
  /** Sheet name */
  sheet?: string;
}

/**
 * Impact analysis result
 */
export interface ImpactAnalysis {
  /** Cell being analyzed */
  targetCell: string;
  /** Cells directly dependent on target */
  directDependents: string[];
  /** All cells affected (direct + indirect) */
  allAffectedCells: string[];
  /** Cells the target depends on */
  dependencies: string[];
  /** Depth of dependency chain */
  maxDepth: number;
  /** Estimated recalculation cost */
  recalculationCost: {
    /** Number of cells that need recalc */
    cellCount: number;
    /** Estimated complexity score (0-100) */
    complexityScore: number;
    /** Estimated time category */
    timeEstimate: 'instant' | 'fast' | 'moderate' | 'slow' | 'very_slow';
  };
  /** Any circular dependencies detected */
  circularDependencies: CircularDependency[];
}

/**
 * Dependency tree node for visualization
 */
export interface DependencyTreeNode {
  cell: string;
  formula?: string;
  dependents: DependencyTreeNode[];
  dependencies: DependencyTreeNode[];
}

/**
 * Impact Analyzer
 *
 * Builds and analyzes formula dependency graphs.
 */
export class ImpactAnalyzer {
  private graph: DependencyGraph;
  private cellFormulas: Map<string, string>;

  constructor() {
    this.graph = new DependencyGraph();
    this.cellFormulas = new Map();
  }

  /**
   * Build dependency graph from spreadsheet data
   *
   * Fetches all formulas from the spreadsheet and builds the dependency graph.
   *
   * @param sheetsApi - Google Sheets API client
   * @param spreadsheetId - Spreadsheet ID
   * @param sheetNames - Optional list of sheet names (defaults to all sheets)
   */
  async buildFromSpreadsheet(
    sheetsApi: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetNames?: string[]
  ): Promise<void> {
    logger.info('Building dependency graph from spreadsheet', {
      spreadsheetId,
      sheets: sheetNames || 'all',
    });

    try {
      // Get spreadsheet metadata if sheet names not provided
      if (!sheetNames) {
        const metadata = await sheetsApi.spreadsheets.get({
          spreadsheetId,
          fields: 'sheets.properties.title',
        });

        sheetNames =
          metadata.data.sheets
            ?.map((s: sheets_v4.Schema$Sheet) => s.properties?.title!)
            .filter(Boolean) || [];
      }

      // Fetch formulas from all sheets (parallel with concurrency limit)
      const totalSheets = sheetNames.length;
      const CONCURRENCY_LIMIT = 5; // Process up to 5 sheets in parallel

      // Process sheets in parallel batches
      for (let i = 0; i < sheetNames.length; i += CONCURRENCY_LIMIT) {
        const batch = sheetNames.slice(i, i + CONCURRENCY_LIMIT).filter(Boolean);

        // Emit progress notification for batch start
        await sendProgress(
          i,
          totalSheets,
          `Processing sheets ${i + 1}-${Math.min(i + CONCURRENCY_LIMIT, totalSheets)}/${totalSheets}`
        );

        // Process batch in parallel
        await Promise.all(
          batch.map((sheetName) => this.buildFromSheet(sheetsApi, spreadsheetId, sheetName))
        );
      }

      // Emit completion progress
      await sendProgress(totalSheets, totalSheets, 'Dependency graph built successfully');

      logger.info('Dependency graph built successfully', {
        spreadsheetId,
        cellCount: this.graph.size,
        formulaCount: this.cellFormulas.size,
      });
    } catch (error) {
      logger.error('Failed to build dependency graph', {
        spreadsheetId,
        error,
      });
      throw error;
    }
  }

  /**
   * Build dependencies from a single sheet
   */
  private async buildFromSheet(
    sheetsApi: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetName: string
  ): Promise<void> {
    try {
      // Fetch all formulas from sheet
      // Using valueRenderOption=FORMULA to get formula strings
      const response = await sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range: sheetName,
        valueRenderOption: 'FORMULA',
      });

      const rows = response.data.values || [];

      // Process each cell
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        if (!row) continue;

        for (let colIndex = 0; colIndex < row.length; colIndex++) {
          const value = row[colIndex];
          if (typeof value !== 'string' || !value.startsWith('=')) {
            continue; // Skip non-formula cells
          }

          // Cell address in A1 notation
          const cellAddr = `${this.indexToColumn(colIndex + 1)}${rowIndex + 1}`;
          const fullCellAddr = `${sheetName}!${cellAddr}`;

          // Store formula
          this.cellFormulas.set(fullCellAddr, value);

          // Parse formula and extract references
          const parsed = parseFormula(value);

          for (const ref of parsed.references) {
            // Normalize reference (add sheet name if missing)
            let referencedCell = ref.raw;
            if (!referencedCell.includes('!')) {
              referencedCell = `${sheetName}!${referencedCell}`;
            }

            // Add dependency edge
            this.graph.addDependency(fullCellAddr, normalizeReference(referencedCell), value);
          }
        }
      }

      logger.debug('Sheet dependencies built', {
        sheetName,
        formulaCount: rows.flat().filter((v) => typeof v === 'string' && v.startsWith('=')).length,
      });
    } catch (error) {
      logger.error('Failed to build dependencies for sheet', {
        sheetName,
        error,
      });
      throw error;
    }
  }

  /**
   * Add a single cell formula to the graph
   *
   * @param cell - Cell address (Sheet1!A1)
   * @param formula - Formula string (with leading =)
   */
  addFormula(cell: string, formula: string): void {
    this.cellFormulas.set(cell, formula);

    // Parse and add dependencies
    const parsed = parseFormula(formula);

    for (const ref of parsed.references) {
      let referencedCell = ref.raw;

      // Add sheet name if missing
      if (!referencedCell.includes('!') && cell.includes('!')) {
        const [sheet] = cell.split('!');
        referencedCell = `${sheet}!${referencedCell}`;
      }

      this.graph.addDependency(cell, normalizeReference(referencedCell), formula);
    }

    logger.debug('Formula added to graph', {
      cell,
      dependencyCount: parsed.references.length,
    });
  }

  /**
   * Remove a cell from the graph
   *
   * @param cell - Cell address
   */
  removeCell(cell: string): void {
    this.cellFormulas.delete(cell);
    this.graph.removeCell(cell);

    logger.debug('Cell removed from graph', { cell });
  }

  /**
   * Analyze the impact of changing a cell
   *
   * @param cell - Cell address (Sheet1!A1)
   * @returns Impact analysis result
   */
  analyzeImpact(cell: string): ImpactAnalysis {
    const normalizedCell = normalizeReference(cell);

    // Get affected cells
    const allAffectedCells = this.graph.getAffectedCells(normalizedCell);
    const directDependents = allAffectedCells.slice(0, 10); // First level only

    // Get dependencies
    const dependencies = this.graph.getDependencies(normalizedCell);

    // Detect cycles
    const circularDependencies = this.graph.detectCycles();

    // Calculate depth
    const maxDepth = this.calculateMaxDepth(normalizedCell);

    // Estimate recalculation cost
    const recalculationCost = this.estimateRecalculationCost(allAffectedCells);

    logger.info('Impact analysis completed', {
      cell: normalizedCell,
      affectedCells: allAffectedCells.length,
      dependencies: dependencies.length,
      maxDepth,
      circularDependencies: circularDependencies.length,
    });

    return {
      targetCell: normalizedCell,
      directDependents,
      allAffectedCells,
      dependencies,
      maxDepth,
      recalculationCost,
      circularDependencies,
    };
  }

  /**
   * Calculate maximum dependency depth from a cell
   */
  private calculateMaxDepth(cell: string, visited = new Set<string>()): number {
    if (visited.has(cell)) {
      return 0;
    }

    visited.add(cell);

    const affected = this.graph.getAffectedCells(cell);
    if (affected.length === 0) {
      return 0;
    }

    let maxDepth = 0;
    for (const affectedCell of affected) {
      const depth = this.calculateMaxDepth(affectedCell, new Set(visited));
      maxDepth = Math.max(maxDepth, depth);
    }

    return maxDepth + 1;
  }

  /**
   * Estimate recalculation cost for affected cells
   */
  private estimateRecalculationCost(affectedCells: string[]): ImpactAnalysis['recalculationCost'] {
    const cellCount = affectedCells.length;

    // Count complex formulas (functions, nested refs)
    let complexityScore = 0;
    for (const cell of affectedCells) {
      const formula = this.cellFormulas.get(cell);
      if (!formula) continue;

      const parsed = parseFormula(formula);
      complexityScore += parsed.functions.length * 2;
      complexityScore += parsed.references.length;
    }

    // Normalize complexity score (0-100)
    const normalizedComplexity = Math.min(100, Math.floor((complexityScore / cellCount) * 10));

    // Estimate time category
    let timeEstimate: ImpactAnalysis['recalculationCost']['timeEstimate'];
    if (cellCount < 10) timeEstimate = 'instant';
    else if (cellCount < 50) timeEstimate = 'fast';
    else if (cellCount < 200) timeEstimate = 'moderate';
    else if (cellCount < 1000) timeEstimate = 'slow';
    else timeEstimate = 'very_slow';

    return {
      cellCount,
      complexityScore: normalizedComplexity,
      timeEstimate,
    };
  }

  /**
   * Detect all circular dependencies in the graph
   *
   * @returns Array of circular dependencies
   */
  detectCircularDependencies(): CircularDependency[] {
    return this.graph.detectCycles();
  }

  /**
   * Get dependency statistics
   */
  getStats(): ReturnType<typeof this.graph.getStats> {
    return this.graph.getStats();
  }

  /**
   * Export dependency graph as DOT format
   */
  exportDOT(): string {
    return this.graph.toDOT();
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.graph.clear();
    this.cellFormulas.clear();
    logger.debug('Impact analyzer cleared');
  }

  /**
   * Convert column index to letter (1=A, 2=B, ..., 26=Z, 27=AA, ...)
   */
  private indexToColumn(index: number): string {
    let col = '';
    while (index > 0) {
      const remainder = (index - 1) % 26;
      col = String.fromCharCode(65 + remainder) + col;
      index = Math.floor((index - 1) / 26);
    }
    return col;
  }
}
