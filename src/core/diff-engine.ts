/**
 * ServalSheets - Diff Engine
 *
 * Tiered diffing for mutation summaries
 * Tighten-up #3: Don't try to diff everything
 */

import type { sheets_v4 } from 'googleapis';
import { createHash } from 'crypto';
import type { DiffResult, DiffOptions, CellValue } from '../schemas/shared.js';
import PQueue from 'p-queue';
import { logger } from '../utils/logger.js';
import { FIELD_MASKS } from '../config/field-masks.js';

type CellChangeRecord = {
  cell: string;
  before?: CellValue;
  after?: CellValue;
  type: 'value' | 'format' | 'formula' | 'note';
};

type SheetSamples = {
  firstRows: CellValue[][];
  lastRows: CellValue[][];
};

export interface SpreadsheetState {
  timestamp: string;
  spreadsheetId: string;
  sheets: SheetState[];
  checksum: string;
}

export interface SheetState {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
  checksum: string;
  blockChecksums?: string[];
  sampleData?: SheetSamples;
  values?: CellValue[][];
}

export interface DiffEngineOptions {
  sheetsApi: sheets_v4.Sheets;
  defaultTier?: 'METADATA' | 'SAMPLE' | 'FULL';
  sampleSize?: number;
  maxFullDiffCells?: number;
  blockSize?: number;
}

export interface CaptureStateOptions {
  tier?: 'METADATA' | 'SAMPLE' | 'FULL';
  sampleSize?: number;
  maxFullDiffCells?: number;
}

/**
 * Diff engine with tiered comparison
 */
export class DiffEngine {
  private sheetsApi: sheets_v4.Sheets;
  private defaultTier: 'METADATA' | 'SAMPLE' | 'FULL';
  private sampleSize: number;
  private maxFullDiffCells: number;
  private blockSize: number;

  constructor(options: DiffEngineOptions) {
    this.sheetsApi = options.sheetsApi;
    this.defaultTier = options.defaultTier ?? 'SAMPLE';
    this.sampleSize = options.sampleSize ?? 10;
    this.maxFullDiffCells = options.maxFullDiffCells ?? 5000;
    this.blockSize = options.blockSize ?? 1000;
  }

  getDefaultTier(): 'METADATA' | 'SAMPLE' | 'FULL' {
    return this.defaultTier;
  }

  /**
   * Capture current spreadsheet state by fetching from API
   *
   * NOTE: For update operations, prefer `captureStateFromResponse()` to avoid redundant API calls
   */
  async captureState(
    spreadsheetId: string,
    options?: CaptureStateOptions
  ): Promise<SpreadsheetState> {
    const targetTier = options?.tier ?? this.defaultTier;
    const sampleSize = options?.sampleSize ?? this.sampleSize;
    const maxFullDiffCells = options?.maxFullDiffCells ?? this.maxFullDiffCells;

    const response = await this.sheetsApi.spreadsheets.get({
      spreadsheetId,
      includeGridData: false,
      fields: FIELD_MASKS.SPREADSHEET_WITH_SHEETS,
    });

    const shouldCaptureSamples = targetTier !== 'METADATA';
    const shouldCaptureFull = targetTier === 'FULL';

    // Create queue to limit concurrent sheet fetches (prevent OOM on large spreadsheets)
    const concurrency = parseInt(process.env['DIFF_ENGINE_CONCURRENCY'] ?? '10');
    const queue = new PQueue({ concurrency });

    // Parallelize data fetching for all sheets with concurrency limit
    const sheets: SheetState[] = await Promise.all(
      (response.data.sheets ?? []).map((sheet) =>
        queue.add(async () => {
          const props = sheet.properties;
          if (!props) {
            return null;
          }

          const escapedTitle = (props.title ?? '').replace(/'/g, "''");
          const rowCount = props.gridProperties?.rowCount ?? 0;
          const columnCount = props.gridProperties?.columnCount ?? 0;

          // Fetch sample data and full values in parallel for this sheet
          const [sampleData, values] = await Promise.all([
            // Sample data fetch
            (async (): Promise<SheetSamples> => {
              if (!shouldCaptureSamples) {
                return { firstRows: [], lastRows: [] };
              }

              const firstRange = `'${escapedTitle}'!A1:ZZ${sampleSize}`;
              const firstRowsPromise = this.getRangeValues(spreadsheetId, firstRange);

              const lastRowsPromise =
                rowCount > sampleSize * 2
                  ? this.getRangeValues(
                      spreadsheetId,
                      `'${escapedTitle}'!A${rowCount - sampleSize}:ZZ${rowCount}`
                    )
                  : Promise.resolve([]);

              const [firstRows, lastRows] = await Promise.all([firstRowsPromise, lastRowsPromise]);
              return { firstRows, lastRows };
            })(),
            // Full values fetch
            (async (): Promise<CellValue[][] | undefined> => {
              if (!shouldCaptureFull) {
                // OK: Explicit empty - typed as optional, full diff not requested
                return undefined;
              }

              const maxRows = Math.min(
                rowCount,
                Math.ceil(maxFullDiffCells / Math.max(columnCount, 1))
              );
              // Match SAMPLE range limit (ZZ = column 702) instead of capping at Z (column 26)
              const endCol = this.columnIndexToLetter(Math.min(Math.max(columnCount - 1, 0), 701));
              const fullRange = `'${escapedTitle}'!A1:${endCol}${maxRows}`;
              return this.getRangeValues(spreadsheetId, fullRange);
            })(),
          ]);

          // Compute sheet checksum from dimensions and title
          const sheetMetadata = `${props.sheetId}-${props.title}-${rowCount}-${columnCount}`;
          const sheetChecksum = createHash('md5').update(sheetMetadata).digest('hex');

          // Compute block checksums if we have values (for faster diff)
          const blockChecksums = values ? this.computeBlockChecksums(values) : undefined;

          const sheetState: SheetState = {
            sheetId: props.sheetId ?? 0,
            title: props.title ?? '',
            rowCount,
            columnCount,
            checksum: sheetChecksum,
            blockChecksums,
            sampleData:
              sampleData.firstRows.length || sampleData.lastRows.length ? sampleData : undefined,
            values,
          };

          return sheetState;
        })
      )
    ).then((results) => results.filter((s): s is SheetState => s !== null));

    // Compute overall checksum from sheet metadata
    const stateString = JSON.stringify(
      sheets.map((s) => ({
        id: s.sheetId,
        title: s.title,
        rows: s.rowCount,
        cols: s.columnCount,
      }))
    );

    return {
      timestamp: new Date().toISOString(),
      spreadsheetId,
      sheets,
      checksum: createHash('md5').update(stateString).digest('hex'),
    };
  }

  /**
   * Capture detailed state for a specific range by fetching from API
   *
   * NOTE: For update operations, prefer `captureRangeStateFromResponse()` to avoid redundant API calls
   */
  async captureRangeState(
    spreadsheetId: string,
    range: string
  ): Promise<{ checksum: string; rowCount: number; values?: CellValue[][] }> {
    const response = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });

    const values = response.data.values ?? [];
    const valuesString = JSON.stringify(values);

    return {
      checksum: createHash('md5').update(valuesString).digest('hex'),
      rowCount: values.length,
      values: values as CellValue[][],
    };
  }

  /**
   * OPTIMIZATION: Capture state from API response without additional fetches
   *
   * Use this after update operations to avoid redundant API calls.
   * The Google Sheets API returns updated data in responses, eliminating the need
   * to fetch the "after" state separately.
   *
   * @param spreadsheetId - The spreadsheet ID
   * @param sheetsResponse - The response from spreadsheets.get() or spreadsheets.batchUpdate()
   * @param options - Capture options (tier, sample size, etc.)
   * @returns SpreadsheetState constructed from response data
   *
   * @example
   * ```typescript
   * // Before (2 API calls):
   * const before = await diffEngine.captureState(id);
   * const response = await sheetsApi.spreadsheets.batchUpdate(...);
   * const after = await diffEngine.captureState(id);  // ❌ Redundant fetch!
   *
   * // After (1 API call):
   * const before = await diffEngine.captureState(id);
   * const response = await sheetsApi.spreadsheets.batchUpdate(...);
   * const after = diffEngine.captureStateFromResponse(id, response.data);  // ✅ No fetch!
   * ```
   */
  captureStateFromResponse(
    spreadsheetId: string,
    sheetsResponse: sheets_v4.Schema$Spreadsheet,
    options?: CaptureStateOptions
  ): SpreadsheetState {
    const targetTier = options?.tier ?? this.defaultTier;
    const sampleSize = options?.sampleSize ?? this.sampleSize;

    const sheets: SheetState[] = (sheetsResponse.sheets ?? [])
      .filter((sheet) => sheet.properties)
      .map((sheet) => {
        const props = sheet.properties!;
        const rowCount = props.gridProperties?.rowCount ?? 0;
        const columnCount = props.gridProperties?.columnCount ?? 0;

        // Extract values from gridData if available (FULL tier)
        let values: CellValue[][] | undefined;
        let sampleData: SheetSamples | undefined;

        if (sheet.data && sheet.data.length > 0 && sheet.data[0] && targetTier === 'FULL') {
          // Extract cell values from RowData
          values = (sheet.data[0].rowData ?? []).map((rowData) =>
            (rowData.values ?? []).map(
              (cellData) =>
                cellData.effectiveValue?.numberValue ??
                cellData.effectiveValue?.stringValue ??
                cellData.effectiveValue?.boolValue ??
                cellData.formattedValue ??
                null
            )
          );
        } else if (
          sheet.data &&
          sheet.data.length > 0 &&
          sheet.data[0] &&
          targetTier === 'SAMPLE'
        ) {
          // Extract sample rows from gridData
          const allRows = (sheet.data[0].rowData ?? []).map((rowData) =>
            (rowData.values ?? []).map(
              (cellData) =>
                cellData.effectiveValue?.numberValue ??
                cellData.effectiveValue?.stringValue ??
                cellData.effectiveValue?.boolValue ??
                cellData.formattedValue ??
                null
            )
          );

          const firstRows = allRows.slice(0, sampleSize);
          const lastRows =
            rowCount > sampleSize * 2 ? allRows.slice(Math.max(0, rowCount - sampleSize)) : [];

          sampleData = { firstRows, lastRows };
        }

        // Compute checksums
        const sheetMetadata = `${props.sheetId}-${props.title}-${rowCount}-${columnCount}`;
        const sheetChecksum = createHash('md5').update(sheetMetadata).digest('hex');
        const blockChecksums = values ? this.computeBlockChecksums(values) : undefined;

        return {
          sheetId: props.sheetId ?? 0,
          title: props.title ?? '',
          rowCount,
          columnCount,
          checksum: sheetChecksum,
          blockChecksums,
          sampleData,
          values,
        };
      });

    // Compute overall checksum
    const stateString = JSON.stringify(
      sheets.map((s) => ({
        id: s.sheetId,
        title: s.title,
        rows: s.rowCount,
        cols: s.columnCount,
      }))
    );

    return {
      timestamp: new Date().toISOString(),
      spreadsheetId,
      sheets,
      checksum: createHash('md5').update(stateString).digest('hex'),
    };
  }

  /**
   * OPTIMIZATION: Capture range state from update response without additional fetches
   *
   * Use this after values.update() or values.batchUpdate() operations.
   *
   * @param range - The range that was updated
   * @param updatedData - The UpdateValuesResponse.updatedData from the API
   * @returns Range state constructed from response data
   *
   * @example
   * ```typescript
   * // Before (2 API calls):
   * const before = await diffEngine.captureRangeState(id, range);
   * const response = await sheetsApi.spreadsheets.values.update(...);
   * const after = await diffEngine.captureRangeState(id, range);  // ❌ Redundant fetch!
   *
   * // After (1 API call):
   * const before = await diffEngine.captureRangeState(id, range);
   * const response = await sheetsApi.spreadsheets.values.update(...);
   * const after = diffEngine.captureRangeStateFromResponse(
   *   range,
   *   response.data.updatedData
   * );  // ✅ No fetch!
   * ```
   */
  captureRangeStateFromResponse(
    range: string,
    updatedData?: sheets_v4.Schema$ValueRange
  ): { checksum: string; rowCount: number; values?: CellValue[][] } {
    const values = (updatedData?.values ?? []) as CellValue[][];
    const valuesString = JSON.stringify(values);

    return {
      checksum: createHash('md5').update(valuesString).digest('hex'),
      rowCount: values.length,
      values,
    };
  }

  /**
   * Generate diff between two states
   */
  async diff(
    before: SpreadsheetState,
    after: SpreadsheetState,
    options?: DiffOptions
  ): Promise<DiffResult> {
    const tier = this.selectTier(before, after, options);

    switch (tier) {
      case 'FULL':
        return await this.fullDiff(before, after);
      case 'SAMPLE':
        return await this.sampleDiff(before, after, options?.sampleSize);
      default:
        return this.metadataDiff(before, after);
    }
  }

  /**
   * Compare two spreadsheet states and return differences
   * (Phase 4.2A - Fine-Grained Event Filtering)
   *
   * Alias for diff() for webhook event categorization
   */
  async compareStates(
    before: SpreadsheetState,
    after: SpreadsheetState,
    options?: DiffOptions
  ): Promise<DiffResult> {
    return this.diff(before, after, options);
  }

  /**
   * Detect sheet-level changes between two states
   * (Phase 4.2A - Fine-Grained Event Filtering)
   */
  private detectSheetChanges(
    before: SpreadsheetState,
    after: SpreadsheetState
  ): {
    sheetsAdded: Array<{ sheetId: number; title: string }>;
    sheetsRemoved: Array<{ sheetId: number; title: string }>;
    sheetsRenamed: Array<{ sheetId: number; oldTitle: string; newTitle: string }>;
  } {
    const beforeSheetMap = new Map(before.sheets.map((s) => [s.sheetId, s]));
    const afterSheetMap = new Map(after.sheets.map((s) => [s.sheetId, s]));

    const sheetsAdded: Array<{ sheetId: number; title: string }> = [];
    const sheetsRemoved: Array<{ sheetId: number; title: string }> = [];
    const sheetsRenamed: Array<{ sheetId: number; oldTitle: string; newTitle: string }> = [];

    // Detect added sheets
    for (const afterSheet of after.sheets) {
      if (!beforeSheetMap.has(afterSheet.sheetId)) {
        sheetsAdded.push({
          sheetId: afterSheet.sheetId,
          title: afterSheet.title,
        });
      }
    }

    // Detect removed and renamed sheets
    for (const beforeSheet of before.sheets) {
      const afterSheet = afterSheetMap.get(beforeSheet.sheetId);
      if (!afterSheet) {
        // Sheet was removed
        sheetsRemoved.push({
          sheetId: beforeSheet.sheetId,
          title: beforeSheet.title,
        });
      } else if (beforeSheet.title !== afterSheet.title) {
        // Sheet was renamed
        sheetsRenamed.push({
          sheetId: beforeSheet.sheetId,
          oldTitle: beforeSheet.title,
          newTitle: afterSheet.title,
        });
      }
    }

    return { sheetsAdded, sheetsRemoved, sheetsRenamed };
  }

  /**
   * Metadata-only diff (Tier 1)
   */
  private metadataDiff(before: SpreadsheetState, after: SpreadsheetState): DiffResult {
    const beforeRows = before.sheets.reduce((sum, s) => sum + s.rowCount, 0);
    const afterRows = after.sheets.reduce((sum, s) => sum + s.rowCount, 0);
    const beforeCols = before.sheets.reduce((sum, s) => sum + s.columnCount, 0);
    const afterCols = after.sheets.reduce((sum, s) => sum + s.columnCount, 0);

    const sheetChanges = this.detectSheetChanges(before, after);

    return {
      tier: 'METADATA',
      before: {
        timestamp: before.timestamp,
        rowCount: beforeRows,
        columnCount: beforeCols,
        checksum: before.checksum,
      },
      after: {
        timestamp: after.timestamp,
        rowCount: afterRows,
        columnCount: afterCols,
        checksum: after.checksum,
      },
      summary: {
        rowsChanged: Math.abs(afterRows - beforeRows),
        estimatedCellsChanged: this.estimateChangedCells(before, after),
      },
      sheetChanges,
    };
  }

  /**
   * Sample diff (Tier 2) - Returns summary with sample statistics
   * OPTIMIZED: Uses Map-based lookup for O(1) before sheet access instead of O(n) find()
   */
  private async sampleDiff(
    before: SpreadsheetState,
    after: SpreadsheetState,
    sampleSize: number = this.sampleSize
  ): Promise<DiffResult> {
    const samples: {
      firstRows: CellChangeRecord[];
      lastRows: CellChangeRecord[];
      randomRows: CellChangeRecord[];
    } = {
      firstRows: [],
      lastRows: [],
      randomRows: [],
    };
    let cellsSampled = 0;
    const changedRows = new Set<number>();

    // OPTIMIZATION: Build O(1) lookup map for before sheets
    const beforeSheetMap = new Map(before.sheets.map((sheet) => [sheet.sheetId, sheet]));

    for (const sheet of after.sheets) {
      const beforeSheet = beforeSheetMap.get(sheet.sheetId);
      const escapedTitle = sheet.title.replace(/'/g, "''");

      const afterFirst =
        sheet.sampleData?.firstRows ??
        (await this.getRangeValues(after.spreadsheetId, `'${escapedTitle}'!A1:ZZ${sampleSize}`));
      const beforeFirst = beforeSheet?.sampleData?.firstRows ?? [];
      cellsSampled += this.countCells(afterFirst);
      this.collectSampleChanges(
        sheet.title,
        afterFirst,
        beforeFirst,
        0,
        samples.firstRows,
        changedRows
      );

      const shouldCheckLast = sheet.rowCount > sampleSize * 2;
      if (shouldCheckLast) {
        const afterLast =
          sheet.sampleData?.lastRows ??
          (await this.getRangeValues(
            after.spreadsheetId,
            `'${escapedTitle}'!A${sheet.rowCount - sampleSize}:ZZ${sheet.rowCount}`
          ));
        const beforeLast = beforeSheet?.sampleData?.lastRows ?? [];
        const startRowIndex = sheet.rowCount - afterLast.length;
        cellsSampled += this.countCells(afterLast);
        this.collectSampleChanges(
          sheet.title,
          afterLast,
          beforeLast,
          startRowIndex,
          samples.lastRows,
          changedRows
        );
      }
    }

    const sheetChanges = this.detectSheetChanges(before, after);

    return {
      tier: 'SAMPLE',
      samples,
      summary: {
        rowsChanged: changedRows.size,
        cellsSampled,
      },
      sheetChanges,
    };
  }

  /**
   * Full cell-by-cell diff (Tier 3) - Compares cells up to limit
   * OPTIMIZED: Uses block checksums for early termination, parallel processing, and Map-based lookups
   */
  private async fullDiff(before: SpreadsheetState, after: SpreadsheetState): Promise<DiffResult> {
    const changes: CellChangeRecord[] = [];

    let cellsCompared = 0;
    let cellsAdded = 0;
    let cellsRemoved = 0;
    const maxCells = this.maxFullDiffCells;

    // OPTIMIZATION: Build O(1) lookup map for before sheets
    const beforeSheetMap = new Map(before.sheets.map((sheet) => [sheet.sheetId, sheet]));

    // Create queue for parallel block processing
    const concurrency = parseInt(process.env['DIFF_ENGINE_CONCURRENCY'] ?? '10');
    const queue = new PQueue({ concurrency });

    // Process sheets in parallel
    const sheetResults = await Promise.all(
      after.sheets.map((afterSheet) =>
        queue.add(async () => {
          if (cellsCompared >= maxCells) {
            return {
              changes: [],
              cellsAdded: 0,
              cellsRemoved: 0,
              cellsCompared: 0,
            };
          }

          const beforeSheet = beforeSheetMap.get(afterSheet.sheetId);

          // OPTIMIZATION: Early termination if sheet checksums match
          if (beforeSheet && afterSheet.checksum === beforeSheet.checksum) {
            return {
              changes: [],
              cellsAdded: 0,
              cellsRemoved: 0,
              cellsCompared: 0,
            };
          }

          const afterValues = await this.ensureValues(
            afterSheet,
            after.spreadsheetId,
            maxCells - cellsCompared
          );
          const beforeValues = beforeSheet
            ? await this.ensureValues(beforeSheet, before.spreadsheetId, maxCells - cellsCompared)
            : [];

          // OPTIMIZATION: Use block checksums to identify changed regions
          const changedBlocks = this.identifyChangedBlocks(
            beforeSheet?.blockChecksums,
            afterSheet.blockChecksums
          );

          return this.diffSheetValues(
            afterSheet.title,
            afterValues,
            beforeValues,
            changedBlocks,
            maxCells - cellsCompared
          );
        })
      )
    );

    // Aggregate results from parallel processing
    for (const result of sheetResults) {
      changes.push(...result.changes);
      cellsAdded += result.cellsAdded;
      cellsRemoved += result.cellsRemoved;
      cellsCompared += result.cellsCompared;
    }

    // OPTIMIZATION: Check for removed sheets with O(1) lookup
    const afterSheetMap = new Map(after.sheets.map((sheet) => [sheet.sheetId, sheet]));
    for (const beforeSheet of before.sheets) {
      const stillExists = afterSheetMap.has(beforeSheet.sheetId);
      if (!stillExists) {
        cellsRemoved += beforeSheet.rowCount * beforeSheet.columnCount;
      }
    }

    const sheetChanges = this.detectSheetChanges(before, after);

    return {
      tier: 'FULL',
      changes,
      summary: {
        cellsChanged: changes.length,
        cellsAdded,
        cellsRemoved,
      },
      sheetChanges,
    };
  }

  /**
   * Convert column index to letter (0 = A, 25 = Z, 26 = AA)
   */
  private columnIndexToLetter(index: number): string {
    let letter = '';
    let temp = index + 1;
    while (temp > 0) {
      const mod = (temp - 1) % 26;
      letter = String.fromCharCode(65 + mod) + letter;
      temp = Math.floor((temp - 1) / 26);
    }
    return letter || 'A';
  }

  private formatCell(sheetTitle: string, colIndex: number, rowIndex: number): string {
    const sheetPrefix = sheetTitle ? `'${sheetTitle.replace(/'/g, "''")}'!` : '';
    return `${sheetPrefix}${this.columnIndexToLetter(colIndex)}${rowIndex + 1}`;
  }

  /**
   * Select appropriate diff tier based on data size
   */
  private selectTier(
    before: SpreadsheetState,
    after: SpreadsheetState,
    options?: DiffOptions
  ): 'METADATA' | 'SAMPLE' | 'FULL' {
    const requestedTier = options?.tier ?? this.defaultTier;
    const maxFull = options?.maxFullDiffCells ?? this.maxFullDiffCells;

    // Estimate total cells
    const beforeCells = before.sheets.reduce((sum, s) => sum + s.rowCount * s.columnCount, 0);
    const afterCells = after.sheets.reduce((sum, s) => sum + s.rowCount * s.columnCount, 0);
    const maxCells = Math.max(beforeCells, afterCells);

    // Auto-downgrade based on size
    if (requestedTier === 'FULL' && maxCells > maxFull) {
      return 'SAMPLE';
    }
    if (requestedTier === 'SAMPLE' && maxCells > maxFull * 10) {
      return 'METADATA';
    }

    return requestedTier;
  }

  /**
   * Estimate number of changed cells
   */
  private estimateChangedCells(before: SpreadsheetState, after: SpreadsheetState): number {
    if (before.checksum === after.checksum) {
      return 0;
    }

    // Rough estimate: if checksums differ, assume some percentage changed
    const totalCells = after.sheets.reduce((sum, s) => sum + s.rowCount * s.columnCount, 0);

    // Check for structural changes
    const beforeSheets = before.sheets.length;
    const afterSheets = after.sheets.length;

    if (beforeSheets !== afterSheets) {
      // Major structural change
      return totalCells;
    }

    // Assume 10% changed if checksums differ but structure is same
    return Math.ceil(totalCells * 0.1);
  }

  private async getRangeValues(spreadsheetId: string, range: string): Promise<CellValue[][]> {
    try {
      const response = await this.sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range,
        valueRenderOption: 'UNFORMATTED_VALUE',
      });
      return (response.data.values ?? []) as CellValue[][];
    } catch (error) {
      logger.error('Failed to fetch range values for diff', {
        error,
        spreadsheetId,
        range,
      });
      return [];
    }
  }

  private collectSampleChanges(
    sheetTitle: string,
    afterValues: CellValue[][],
    beforeValues: CellValue[][],
    rowOffset: number,
    bucket: CellChangeRecord[],
    changedRows: Set<number>
  ): void {
    for (let row = 0; row < afterValues.length; row++) {
      const afterRow = afterValues[row] ?? [];
      const beforeRow = beforeValues[row] ?? [];
      const maxCols = Math.max(afterRow.length, beforeRow.length);
      let rowChanged = false;

      for (let col = 0; col < maxCols; col++) {
        const afterVal = afterRow[col];
        const beforeVal = beforeRow[col];
        if (afterVal !== beforeVal) {
          rowChanged = true;
          bucket.push({
            cell: this.formatCell(sheetTitle, col, rowOffset + row),
            before: beforeVal,
            after: afterVal,
            type: 'value',
          });
        }
      }

      if (rowChanged) {
        changedRows.add(rowOffset + row);
      }
    }
  }

  private countCells(values: CellValue[][]): number {
    return values.reduce((sum, row) => sum + (row?.length ?? 0), 0);
  }

  private async ensureValues(
    sheet: SheetState,
    spreadsheetId: string,
    remainingBudget: number
  ): Promise<CellValue[][]> {
    if (sheet.values) {
      return sheet.values;
    }

    const rowCount = sheet.rowCount;
    const columnCount = sheet.columnCount;
    const maxRows = Math.min(rowCount, Math.ceil(remainingBudget / Math.max(columnCount, 1)));
    const endCol = this.columnIndexToLetter(Math.min(Math.max(columnCount - 1, 0), 25));
    const range = `'${sheet.title.replace(/'/g, "''")}'!A1:${endCol}${Math.max(maxRows, 1)}`;

    const values = await this.getRangeValues(spreadsheetId, range);
    sheet.values = values;
    return values;
  }

  /**
   * OPTIMIZATION: Compute block checksums for faster diff
   * Divides data into blocks and computes checksum for each
   */
  private computeBlockChecksums(values: CellValue[][]): string[] {
    const checksums: string[] = [];
    const blockSize = this.blockSize;

    for (let i = 0; i < values.length; i += blockSize) {
      const blockEnd = Math.min(i + blockSize, values.length);
      const block = values.slice(i, blockEnd);
      const blockString = JSON.stringify(block);
      const checksum = createHash('md5').update(blockString).digest('hex');
      checksums.push(checksum);
    }

    return checksums;
  }

  /**
   * OPTIMIZATION: Identify which blocks have changed
   * Returns set of block indices that differ between before/after
   */
  private identifyChangedBlocks(
    beforeChecksums?: string[],
    afterChecksums?: string[]
  ): Set<number> | null {
    // If either is missing, assume all blocks changed
    if (!beforeChecksums || !afterChecksums) {
      return null;
    }

    const changedBlocks = new Set<number>();
    const maxBlocks = Math.max(beforeChecksums.length, afterChecksums.length);

    for (let i = 0; i < maxBlocks; i++) {
      const beforeChecksum = beforeChecksums[i];
      const afterChecksum = afterChecksums[i];

      // Block changed if checksums differ or one is missing
      if (beforeChecksum !== afterChecksum) {
        changedBlocks.add(i);
      }
    }

    return changedBlocks;
  }

  /**
   * OPTIMIZATION: Diff sheet values with focus on changed blocks
   * Only processes blocks that have actually changed
   */
  private diffSheetValues(
    sheetTitle: string,
    afterValues: CellValue[][],
    beforeValues: CellValue[][],
    changedBlocks: Set<number> | null,
    maxCells: number
  ): {
    changes: CellChangeRecord[];
    cellsAdded: number;
    cellsRemoved: number;
    cellsCompared: number;
  } {
    const changes: CellChangeRecord[] = [];
    let cellsCompared = 0;
    let cellsAdded = 0;
    let cellsRemoved = 0;

    const maxRows = Math.max(afterValues.length, beforeValues.length);

    for (let row = 0; row < maxRows && cellsCompared < maxCells; row++) {
      // OPTIMIZATION: Skip blocks that haven't changed
      if (changedBlocks !== null) {
        const blockIndex = Math.floor(row / this.blockSize);
        if (!changedBlocks.has(blockIndex)) {
          // Skip this row, but still count the cells
          const afterRow = afterValues[row] ?? [];
          const beforeRow = beforeValues[row] ?? [];
          const maxCols = Math.max(afterRow.length, beforeRow.length);
          cellsCompared += maxCols;
          continue;
        }
      }

      const afterRow = afterValues[row] ?? [];
      const beforeRow = beforeValues[row] ?? [];
      const maxCols = Math.max(afterRow.length, beforeRow.length);

      for (let col = 0; col < maxCols && cellsCompared < maxCells; col++) {
        const afterVal = afterRow[col];
        const beforeVal = beforeRow[col];

        if (beforeVal !== afterVal) {
          changes.push({
            cell: this.formatCell(sheetTitle, col, row),
            before: beforeVal,
            after: afterVal,
            type: 'value',
          });
        }

        if (beforeVal === undefined && afterVal !== undefined) {
          cellsAdded++;
        }
        if (beforeVal !== undefined && afterVal === undefined) {
          cellsRemoved++;
        }
        cellsCompared++;
      }
    }

    return { changes, cellsAdded, cellsRemoved, cellsCompared };
  }
}
