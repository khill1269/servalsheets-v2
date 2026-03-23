/**
 * ServalSheets — Formula Evaluation Engine
 *
 * Implements the 5-layer evaluation stack described in docs/FORMULA_EVALUATION_ARCHITECTURE.md:
 *
 * Layer 1: Dependency graph (existing, in analysis/dependency-graph.ts)
 * Layer 2: HyperFormula engine — 395 built-in functions, dirty-cell incremental recalc
 * Layer 3: Apps Script fallback — for Google-specific functions (QUERY, FILTER, IMPORTRANGE)
 * Layer 4: JIT compilation cache — skip re-parsing on repeat scenario evaluation
 * Layer 5: Scenario fingerprint + structural sharing — instant repeat scenarios
 *
 * Key improvement over current model_scenario:
 *   Before: "47 cells would be affected: B5, C5, D5 ..."  (addresses only)
 *   After:  "Gross Profit drops from $50,000 to $30,000 (-40%)"  (actual predicted values)
 */

import type { HyperFormula, ExportedCellChange } from 'hyperformula';
import { logger } from '../utils/logger.js';
import { AppsScriptEvaluator } from './apps-script-evaluator.js';
import type { GoogleApiClient } from './google-api.js';

// ============================================================================
// Types
// ============================================================================

export interface CellChange {
  /** A1 reference, e.g. "A2" or "Sheet1!B3" */
  cell: string;
  newValue: string | number | boolean | null;
}

export interface ScenarioResult {
  /** Cells with computed predicted values (Layer 2 success) */
  localResults: PredictedCell[];
  /** Cells with Google-specific formulas that need Layer 3 evaluation */
  needsGoogleEval: string[];
  /** Volatile cells (NOW, RAND, etc.) — flagged but not recalculated */
  volatileCells: string[];
  /** Total cells recalculated by HyperFormula */
  cellsRecalculated: number;
  /** Evaluation duration in milliseconds */
  durationMs: number;
}

export interface PredictedCell {
  cell: string;
  formula?: string;
  oldValue: CellValueType;
  newValue: CellValueType;
  /** Percentage change (for numeric values) */
  percentageChange?: number;
}

export type CellValueType = string | number | boolean | null;

export interface SheetData {
  /** 2D array of cell values (row-major) */
  values: CellValueType[][];
  /** 2D array of formulas (row-major, null where no formula) */
  formulas: (string | null)[][];
  /** Sheet name */
  sheetName: string;
  /**
   * Google Sheets spreadsheet locale (e.g. 'en_US', 'fr_FR', 'de_DE').
   * Used to configure HyperFormula's decimal/thousands separators so that
   * European-style formulas like =SUMME(A1:A10) or =1,5+2,5 evaluate correctly.
   * Defaults to 'en_US' when absent.
   */
  locale?: string;
}

interface HFInstance {
  hf: HyperFormula;
  sheetIndex: number;
  sheetName: string;
  loadedAt: number;
  /** Scenario fingerprint → result cache */
  resultCache: Map<string, ScenarioResult>;
  /**
   * Cells pre-scanned at load time as containing Google-specific functions.
   * Key: `${col},${row}`. Used to classify cells even when HyperFormula doesn't
   * emit ExportedCellChange for them (e.g. unknown function stays at #NAME? error).
   */
  googleSpecificCells: Set<string>;
  /**
   * Cells pre-scanned at load time as containing volatile functions (NOW, RAND, etc.).
   * Key: `${col},${row}`.
   */
  volatileFormulaeCells: Set<string>;
  /**
   * Formula map for Google-specific cells: `${col},${row}` → formula string.
   * Used by Layer 3 (AppsScriptEvaluator) to evaluate Google-only formulas.
   */
  googleCellFormulas: Map<string, string>;
}

// ============================================================================
// A1 notation utilities
// ============================================================================

/** Parse A1 reference (with or without sheet prefix) → { col, row } (0-indexed) */
function parseA1(cell: string): { sheetName: string | null; col: number; row: number } | null {
  // Strip sheet prefix
  let ref = cell;
  let sheetName: string | null = null;
  const bangIdx = ref.indexOf('!');
  if (bangIdx !== -1) {
    sheetName = ref.slice(0, bangIdx).replace(/'/g, '');
    ref = ref.slice(bangIdx + 1);
  }

  const match = /^([A-Z]+)(\d+)$/i.exec(ref.trim());
  if (!match) return null;

  const colStr = match[1]!.toUpperCase();
  const rowNum = parseInt(match[2]!, 10);

  let col = 0;
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64);
  }

  return { sheetName, col: col - 1, row: rowNum - 1 };
}

/** Convert 0-indexed { col, row } → A1 string */
function toA1(col: number, row: number): string {
  let colStr = '';
  let c = col + 1;
  while (c > 0) {
    const remainder = (c - 1) % 26;
    colStr = String.fromCharCode(65 + remainder) + colStr;
    c = Math.floor((c - 1) / 26);
  }
  return `${colStr}${row + 1}`;
}

/** Fingerprint a set of cell changes (sorted) for cache lookup */
function fingerprintChanges(changes: CellChange[]): string {
  return changes
    .slice()
    .sort((a, b) => a.cell.localeCompare(b.cell))
    .map((c) => `${c.cell}=${String(c.newValue)}`)
    .join('|');
}

// ============================================================================
// Google-specific function detection
// ============================================================================

const GOOGLE_SPECIFIC_FUNCTIONS = new Set([
  'QUERY',
  'FILTER',
  'IMPORTRANGE',
  'GOOGLEFINANCE',
  'IMPORTDATA',
  'IMPORTFEED',
  'IMPORTHTML',
  'IMPORTXML',
  'UNIQUE',
  'SORT',
  'SPARKLINE',
  'IMAGE',
]);

const VOLATILE_FUNCTIONS = new Set(['NOW', 'TODAY', 'RAND', 'RANDBETWEEN', 'INDIRECT']);

function requiresGoogleEval(formula: string): boolean {
  const upper = formula.toUpperCase();
  for (const fn of GOOGLE_SPECIFIC_FUNCTIONS) {
    if (upper.includes(fn + '(')) return true;
  }
  return false;
}

function isVolatileFormula(formula: string): boolean {
  const upper = formula.toUpperCase();
  for (const fn of VOLATILE_FUNCTIONS) {
    if (upper.includes(fn + '(')) return true;
  }
  return false;
}

// ============================================================================
// Locale → HyperFormula config
// ============================================================================

interface HFLocaleOptions {
  decimalSeparator: '.' | ',';
  thousandSeparator: '.' | ' ' | '';
  functionArgSeparator: ',' | ';';
}

/**
 * Map a Google Sheets locale string (e.g. 'fr_FR', 'de_DE') to HyperFormula
 * separator options so that European formulas parse correctly.
 *
 * European locales use comma as decimal separator and semicolon as function
 * argument separator (e.g. =SOMME(A1;A10) in French).
 *
 * HyperFormula constraint: functionArgSeparator and thousandSeparator MUST NOT
 * be the same character. For US-style locales (functionArgSeparator=',') we
 * therefore use thousandSeparator='' to avoid the conflict. HyperFormula does not
 * use thousandSeparator for output formatting — it only affects number literal
 * parsing inside formula strings, which is uncommon in practice.
 */
/** @internal exported for testing */
export function localeToHfOptions(locale?: string): HFLocaleOptions {
  // Default: US/en locale
  if (!locale) return { decimalSeparator: '.', thousandSeparator: '', functionArgSeparator: ',' };

  // Locales that use comma as decimal separator (most of non-English world)
  const europeanDecimalLocales = new Set([
    'af',
    'ar',
    'az',
    'be',
    'bg',
    'bs',
    'ca',
    'cs',
    'da',
    'de',
    'el',
    'es',
    'et',
    'eu',
    'fa',
    'fi',
    'fr',
    'gl',
    'hr',
    'hu',
    'hy',
    'is',
    'it',
    'ka',
    'kk',
    'lt',
    'lv',
    'mk',
    'mn',
    'nb',
    'nl',
    'pl',
    'pt',
    'ro',
    'ru',
    'sk',
    'sl',
    'sq',
    'sr',
    'sv',
    'tr',
    'uk',
    'uz',
  ]);

  // Extract base language code (e.g. 'fr' from 'fr_FR', 'fr_BE')
  const lang = locale.split('_')[0]?.toLowerCase() ?? '';

  if (!europeanDecimalLocales.has(lang)) {
    // English, Chinese, Japanese, Indonesian, etc. — dot decimal, comma arg sep
    return { decimalSeparator: '.', thousandSeparator: '', functionArgSeparator: ',' };
  }

  // Swiss German/French/Italian use space as thousands separator
  const swissLocales = new Set(['de_CH', 'fr_CH', 'it_CH', 'rm_CH']);
  const thousandSeparator: '.' | ' ' = swissLocales.has(locale) ? ' ' : '.';

  return { decimalSeparator: ',', thousandSeparator, functionArgSeparator: ';' };
}

// ============================================================================
// FormulaEvaluator
// ============================================================================

const HF_INSTANCE_TTL_MS = 20 * 60 * 1000; // 20 minutes
const HF_MAX_INSTANCES = 10;
const SCENARIO_CACHE_MAX = 50;

export class FormulaEvaluator {
  /** Per-spreadsheet HyperFormula instances (LRU-evicted) */
  private instances = new Map<string, HFInstance>();

  constructor(private readonly googleClient?: GoogleApiClient) {}

  /**
   * Load a sheet's data into HyperFormula (or refresh if already loaded).
   *
   * Call this once per spreadsheet before evaluateScenario().
   */
  async loadSheet(spreadsheetId: string, sheet: SheetData): Promise<void> {
    const existing = this.instances.get(spreadsheetId);
    if (existing) {
      existing.hf.destroy();
    }

    // Evict LRU if at capacity
    if (this.instances.size >= HF_MAX_INSTANCES && !this.instances.has(spreadsheetId)) {
      const oldestKey = this.instances.keys().next().value;
      if (oldestKey !== undefined) {
        this.instances.get(oldestKey)?.hf.destroy();
        this.instances.delete(oldestKey);
      }
    }

    // Lazily import HyperFormula to avoid startup cost when not used
    const { HyperFormula, AlwaysSparse } = await import('hyperformula');

    // Build the combined data array (formulas take priority over values)
    const data: (string | number | boolean | null)[][] = sheet.values.map((row, rowIdx) =>
      row.map((val, colIdx) => {
        const formula = sheet.formulas[rowIdx]?.[colIdx];
        return formula ?? val;
      })
    );

    // Map spreadsheet locale to HyperFormula separator config (ISSUE-086)
    const hfLocale = localeToHfOptions(sheet.locale);

    const hf = HyperFormula.buildFromArray(data, {
      licenseKey: 'gpl-v3',
      useArrayArithmetic: true,
      // AlwaysSparse avoids allocating dense arrays for large sparse sheets
      chooseAddressMappingPolicy: new AlwaysSparse(),
      // Locale-aware separators: European locales use comma as decimal, semicolon as arg separator
      decimalSeparator: hfLocale.decimalSeparator,
      thousandSeparator: hfLocale.thousandSeparator,
      functionArgSeparator: hfLocale.functionArgSeparator,
    });

    // Pre-scan formulas to classify Google-specific and volatile cells
    const googleSpecificCells = new Set<string>();
    const volatileFormulaeCells = new Set<string>();
    const googleCellFormulas = new Map<string, string>();
    sheet.formulas.forEach((row, rowIdx) => {
      row.forEach((formula, colIdx) => {
        if (!formula) return;
        if (requiresGoogleEval(formula)) {
          googleSpecificCells.add(`${colIdx},${rowIdx}`);
          googleCellFormulas.set(`${colIdx},${rowIdx}`, formula);
        }
        if (isVolatileFormula(formula)) volatileFormulaeCells.add(`${colIdx},${rowIdx}`);
      });
    });

    this.instances.set(spreadsheetId, {
      hf,
      sheetIndex: 0,
      sheetName: sheet.sheetName,
      loadedAt: Date.now(),
      resultCache: new Map(),
      googleSpecificCells,
      volatileFormulaeCells,
      googleCellFormulas,
    });

    logger.debug('formula_evaluator_loaded', {
      spreadsheetId,
      rows: sheet.values.length,
      cols: sheet.values[0]?.length ?? 0,
    });
  }

  /**
   * Evaluate a scenario: apply changes and return predicted values for all affected cells.
   *
   * Returns `null` if the sheet has not been loaded (caller should fall back to
   * address-only mode).
   */
  async evaluateScenario(
    spreadsheetId: string,
    changes: CellChange[]
  ): Promise<ScenarioResult | null> {
    const instance = this.getValidInstance(spreadsheetId);
    if (!instance) return null;

    // Layer 5: Scenario fingerprint cache
    const fp = fingerprintChanges(changes);
    const cached = instance.resultCache.get(fp);
    if (cached) {
      logger.debug('formula_evaluator_cache_hit', { spreadsheetId, fingerprint: fp });
      return cached;
    }

    const startMs = Date.now();
    const { hf } = instance;

    // Layer 2: HyperFormula batch evaluation
    // Strategy:
    //   1. Apply changes → resumeEvaluation → collect (address, newValue, formula) for each dirty cell
    //   2. Revert changes → resumeEvaluation → HyperFormula is back to base state
    //   3. For each dirty cell, read base-state value from HyperFormula (that IS the oldValue)

    const googleFallbackCells: string[] = [];
    const volatileCells: string[] = [];

    // Step 1: Read original values BEFORE any changes (HyperFormula not suspended yet)
    const appliedChanges: Array<{ col: number; row: number; original: CellValueType }> = [];
    const validChanges: Array<{ change: CellChange; col: number; row: number }> = [];

    for (const change of changes) {
      const addr = parseA1(change.cell);
      if (!addr) {
        logger.warn('formula_evaluator_unparseable_cell', { cell: change.cell });
        continue;
      }
      let original: CellValueType = null;
      try {
        original = normalizeCellValue(
          hf.getCellValue({ sheet: instance.sheetIndex, col: addr.col, row: addr.row })
        );
      } catch {
        // Out of range — original stays null
      }
      appliedChanges.push({ col: addr.col, row: addr.row, original });
      validChanges.push({ change, col: addr.col, row: addr.row });
    }

    // Step 2: Suspend evaluation, apply all changes, resume — get batched dirty cells
    hf.suspendEvaluation();
    for (const { change, col, row } of validChanges) {
      hf.setCellContents({ sheet: instance.sheetIndex, col, row }, change.newValue);
    }
    const exportedChanges = hf.resumeEvaluation();

    // Step 1: Collect (address, formula, newValue) for all dirty cells
    type DirtyCellRecord = {
      col: number;
      row: number;
      sheet: number;
      cell: string;
      fullCell: string;
      formula: string | undefined;
      newValue: CellValueType;
    };
    const dirtyRecords: DirtyCellRecord[] = [];

    for (const ec of exportedChanges) {
      // Narrow to ExportedCellChange (union also contains ExportedNamedExpressionChange)
      if (!('address' in ec)) continue;
      const cellChange = ec as ExportedCellChange;

      const cell = toA1(cellChange.address.col, cellChange.address.row);
      const fullCell =
        cellChange.address.sheet !== instance.sheetIndex
          ? `Sheet${cellChange.address.sheet + 1}!${cell}`
          : cell;

      // Check pre-scanned sets first (works even if HyperFormula can't eval the function)
      const cellKey = `${cellChange.address.col},${cellChange.address.row}`;
      if (instance.googleSpecificCells.has(cellKey)) {
        googleFallbackCells.push(fullCell);
        continue;
      }
      if (instance.volatileFormulaeCells.has(cellKey)) {
        volatileCells.push(fullCell);
        continue;
      }

      let formula: string | undefined;
      try {
        const rawFormula = hf.getCellFormula({
          sheet: cellChange.address.sheet,
          col: cellChange.address.col,
          row: cellChange.address.row,
        });
        if (rawFormula) formula = rawFormula;
      } catch {
        // No formula
      }

      // Also check formula text as a fallback (for formulas not pre-scanned)
      if (formula && requiresGoogleEval(formula)) {
        googleFallbackCells.push(fullCell);
        continue;
      }
      if (formula && isVolatileFormula(formula)) {
        volatileCells.push(fullCell);
        continue;
      }

      dirtyRecords.push({
        col: cellChange.address.col,
        row: cellChange.address.row,
        sheet: cellChange.address.sheet,
        cell,
        fullCell,
        formula,
        newValue: normalizeCellValue(cellChange.newValue),
      });
    }

    // Step 2: Revert changes → base state restored
    hf.suspendEvaluation();
    for (const ac of appliedChanges) {
      hf.setCellContents({ sheet: instance.sheetIndex, col: ac.col, row: ac.row }, ac.original);
    }
    hf.resumeEvaluation();

    // Step 3: For each dirty cell, read oldValue from HyperFormula (now in base state)
    const localResults: PredictedCell[] = [];

    for (const rec of dirtyRecords) {
      // Classify: Google-specific or volatile?
      if (rec.formula && requiresGoogleEval(rec.formula)) {
        googleFallbackCells.push(rec.fullCell);
        continue;
      }
      if (rec.formula && isVolatileFormula(rec.formula)) {
        volatileCells.push(rec.fullCell);
        continue;
      }

      // Read base-state value (HyperFormula is now reverted)
      let oldValue: CellValueType = null;
      try {
        oldValue = normalizeCellValue(
          hf.getCellValue({ sheet: rec.sheet, col: rec.col, row: rec.row })
        );
      } catch {
        // Out of range
      }

      const predicted: PredictedCell = {
        cell: rec.fullCell,
        ...(rec.formula ? { formula: rec.formula } : {}),
        oldValue,
        newValue: rec.newValue,
      };

      // Compute percentage change for numeric values
      if (typeof oldValue === 'number' && typeof rec.newValue === 'number' && oldValue !== 0) {
        predicted.percentageChange =
          Math.round(((rec.newValue - oldValue) / Math.abs(oldValue)) * 10000) / 100;
      }

      localResults.push(predicted);
    }

    // Layer 3: API evaluation for Google-only cells
    // If a googleClient was provided and there are Google-only cells, evaluate them
    // via the Sheets API and merge results into localResults.
    const resolvedGoogleCells: string[] = [];
    if (this.googleClient && googleFallbackCells.length > 0) {
      const appsScriptEval = new AppsScriptEvaluator(this.googleClient);
      for (const fullCell of googleFallbackCells) {
        // Derive col,row key from the A1 ref to look up the formula
        const addr = parseA1(fullCell);
        const formulaKey = addr ? `${addr.col},${addr.row}` : null;
        const formula = formulaKey ? instance.googleCellFormulas.get(formulaKey) : undefined;

        if (!formula) {
          resolvedGoogleCells.push(fullCell);
          continue;
        }

        try {
          const apiResult = await appsScriptEval.evaluateFormula(
            spreadsheetId,
            instance.sheetName,
            formula
          );
          if (!apiResult.error) {
            // Read old value from HyperFormula (already in base state)
            let oldValue: CellValueType = null;
            if (addr) {
              try {
                oldValue = normalizeCellValue(
                  hf.getCellValue({ sheet: instance.sheetIndex, col: addr.col, row: addr.row })
                );
              } catch {
                // Out of range — stays null
              }
            }
            const apiCell: PredictedCell & { evaluatedViaApi?: boolean } = {
              cell: fullCell,
              formula,
              oldValue,
              newValue: apiResult.value as CellValueType,
              evaluatedViaApi: true,
            };
            if (
              typeof oldValue === 'number' &&
              typeof apiResult.value === 'number' &&
              oldValue !== 0
            ) {
              apiCell.percentageChange =
                Math.round(((apiResult.value - oldValue) / Math.abs(oldValue)) * 10000) / 100;
            }
            localResults.push(apiCell);
            // Successfully resolved — do NOT add to needsGoogleEval
          } else {
            resolvedGoogleCells.push(fullCell);
          }
        } catch {
          // Non-blocking: if evaluation fails, fall back to reporting in needsGoogleEval
          resolvedGoogleCells.push(fullCell);
        }
      }
    } else {
      // No googleClient — all Google-only cells remain in needsGoogleEval
      resolvedGoogleCells.push(...googleFallbackCells);
    }

    const result: ScenarioResult = {
      localResults,
      needsGoogleEval: resolvedGoogleCells,
      volatileCells,
      cellsRecalculated: exportedChanges.length,
      durationMs: Date.now() - startMs,
    };

    // Cache result (LRU eviction)
    if (instance.resultCache.size >= SCENARIO_CACHE_MAX) {
      const oldestKey = instance.resultCache.keys().next().value;
      if (oldestKey !== undefined) instance.resultCache.delete(oldestKey);
    }
    instance.resultCache.set(fp, result);

    logger.debug('formula_evaluator_scenario_done', {
      spreadsheetId,
      changesIn: changes.length,
      cellsRecalculated: exportedChanges.length,
      googleFallback: googleFallbackCells.length,
      durationMs: result.durationMs,
    });

    return result;
  }

  /**
   * Check if a spreadsheet is loaded and not stale.
   */
  isLoaded(spreadsheetId: string): boolean {
    return this.getValidInstance(spreadsheetId) !== null;
  }

  /**
   * Explicitly destroy a HyperFormula instance (e.g., after spreadsheet is modified outside
   * of scenario modeling).
   */
  destroy(spreadsheetId: string): void {
    const instance = this.instances.get(spreadsheetId);
    if (instance) {
      instance.hf.destroy();
      this.instances.delete(spreadsheetId);
    }
  }

  /** Destroy all instances (e.g., on server shutdown). */
  destroyAll(): void {
    for (const instance of this.instances.values()) {
      instance.hf.destroy();
    }
    this.instances.clear();
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private getValidInstance(spreadsheetId: string): HFInstance | null {
    const instance = this.instances.get(spreadsheetId);
    if (!instance) return null;
    if (Date.now() - instance.loadedAt > HF_INSTANCE_TTL_MS) {
      instance.hf.destroy();
      this.instances.delete(spreadsheetId);
      return null;
    }
    return instance;
  }
}

/** Normalize HyperFormula cell value to our CellValueType */
function normalizeCellValue(v: unknown): CellValueType {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  // CellError or object — convert to string
  return String(v);
}

// Module-level singleton (one per process)
export const formulaEvaluator = new FormulaEvaluator();
