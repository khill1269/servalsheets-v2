/**
 * CompositeOperationsService
 *
 * @purpose Provides high-level operations combining multiple API calls: import_csv, smart_append, bulk_update, deduplicate
 * @category Core
 * @usage Use for complex multi-step operations that need CSV parsing, intelligent column matching, or data deduplication
 * @dependencies sheets_v4, SheetResolver, logger
 * @stateful No - stateless service processing operations on-demand
 * @singleton No - can be instantiated per request
 *
 * @example
 * const service = new CompositeOperationsService(sheetsClient, sheetResolver);
 * await service.importCsv({ spreadsheetId, csvData, sheet: 'Data', skipHeader: true });
 * await service.smartAppend({ spreadsheetId, range: 'A1:Z100', values: [[...]], matchHeaders: true });
 */

import type { sheets_v4 } from 'googleapis';
import { logger } from '../utils/logger.js';
import type { SheetResolver, ResolvedSheet } from './sheet-resolver.js';
import { ValidationError, ServiceError } from '../core/errors.js';
import { executeWithRetry } from '../utils/retry.js';
import type {
  BulkUpdateOptions,
  BulkUpdateResult,
  CsvImportOptions,
  CsvImportResult,
  DeduplicateOptions,
  DeduplicateResult,
  SmartAppendOptions,
  SmartAppendResult,
} from './composite-operations-types.js';

export type {
  BulkUpdateOptions,
  BulkUpdateResult,
  CsvImportOptions,
  CsvImportResult,
  DeduplicateOptions,
  DeduplicateResult,
  SmartAppendOptions,
  SmartAppendResult,
} from './composite-operations-types.js';

// ============================================================================
// Composite Operations Service
// ============================================================================

/**
 * Composite Operations Service
 *
 * Provides high-level operations that abstract away API complexity.
 */
export class CompositeOperationsService {
  private sheetsApi: sheets_v4.Sheets;
  private sheetResolver: SheetResolver;

  constructor(sheetsApi: sheets_v4.Sheets, sheetResolver: SheetResolver) {
    this.sheetsApi = sheetsApi;
    this.sheetResolver = sheetResolver;
    logger.info('Composite operations service initialized');
  }

  /**
   * Import CSV data into a sheet
   */
  async importCsv(options: CsvImportOptions): Promise<CsvImportResult> {
    const {
      spreadsheetId,
      csvData,
      delimiter = ',',
      hasHeader: _hasHeader = true,
      mode = 'replace',
      skipEmptyRows = true,
      trimValues = true,
    } = options;

    // Parse CSV
    const rows = this.parseCsv(csvData, delimiter, skipEmptyRows, trimValues);

    if (rows.length === 0) {
      return {
        rowsImported: 0,
        columnsImported: 0,
        range: '',
        sheetId: 0,
        sheetName: '',
        rowsSkipped: 0,
        newSheetCreated: false,
      };
    }

    let targetSheet: ResolvedSheet;
    let newSheetCreated = false;

    // Resolve or create target sheet
    if (mode === 'new_sheet' || !options.sheet) {
      const baseName = options.newSheetName ?? `Import_${new Date().toISOString().slice(0, 10)}`;
      let sheetName = baseName;

      // Avoid collision with existing sheets by appending a suffix
      try {
        const result = await this.createSheet(spreadsheetId, sheetName);
        targetSheet = result;
      } catch (createErr: unknown) {
        const errMsg = createErr instanceof Error ? createErr.message : String(createErr);
        if (errMsg.includes('already exists') || errMsg.includes('400')) {
          // Sheet name collision — append a unique suffix
          sheetName = `${baseName}_${Date.now().toString(36)}`;
          const result = await this.createSheet(spreadsheetId, sheetName);
          targetSheet = result;
        } else {
          throw createErr;
        }
      }
      newSheetCreated = true;
    } else {
      const resolved = await this.sheetResolver.resolve(spreadsheetId, {
        sheetName: typeof options.sheet === 'string' ? options.sheet : undefined,
        sheetId: typeof options.sheet === 'number' ? options.sheet : undefined,
      });
      targetSheet = resolved.sheet;
    }

    // Determine range
    const numRows = rows.length;
    const numCols = Math.max(...rows.map((r) => r.length));
    const endCol = this.columnIndexToLetter(numCols - 1);
    const range = `'${targetSheet.title}'!A1:${endCol}${numRows}`;

    // Clear existing data if mode is 'replace'
    if (mode === 'replace') {
      await executeWithRetry(() =>
        this.sheetsApi.spreadsheets.values.clear({
          spreadsheetId,
          range: `'${targetSheet.title}'`,
        })
      );
    }

    // Write data
    const writeRange = mode === 'append' ? `'${targetSheet.title}'!A:${endCol}` : range;

    if (mode === 'append') {
      await executeWithRetry(() =>
        this.sheetsApi.spreadsheets.values.append({
          spreadsheetId,
          range: writeRange,
          valueInputOption: 'RAW', // CSV data is never formulas — RAW prevents formula injection
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: rows },
        })
      );
    } else {
      await executeWithRetry(() =>
        this.sheetsApi.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption: 'RAW', // CSV data is never formulas — RAW prevents formula injection
          requestBody: { values: rows },
        })
      );
    }

    // Count skipped rows (difference between CSV lines and imported rows)
    const originalRowCount = csvData.split('\n').filter((l) => l.trim()).length;
    const rowsSkipped = originalRowCount - numRows;

    return {
      rowsImported: numRows,
      columnsImported: numCols,
      range,
      sheetId: targetSheet.sheetId,
      sheetName: targetSheet.title,
      rowsSkipped,
      newSheetCreated,
    };
  }

  /**
   * Smart append - matches columns by header
   */
  async smartAppend(options: SmartAppendOptions): Promise<SmartAppendResult> {
    const {
      spreadsheetId,
      sheet,
      data,
      matchHeaders: _matchHeaders = true,
      createMissingColumns: optionsCreateMissing = false,
      skipEmptyRows = true,
    } = options;

    if (data.length === 0) {
      return {
        rowsAppended: 0,
        columnsMatched: [],
        columnsCreated: [],
        columnsSkipped: [],
        range: '',
        sheetId: 0,
      };
    }

    // Resolve target sheet
    const resolved = await this.sheetResolver.resolve(spreadsheetId, {
      sheetName: typeof sheet === 'string' ? sheet : undefined,
      sheetId: typeof sheet === 'number' ? sheet : undefined,
    });
    const targetSheet = resolved.sheet;

    // Get existing headers
    const headerResponse = await executeWithRetry(() =>
      this.sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range: `'${targetSheet.title}'!1:1`,
      })
    );

    const existingHeaders: string[] = (headerResponse.data.values?.[0] ?? []).map((h) =>
      String(h ?? '').trim()
    );

    // BUG-020 FIX: When sheet is empty (no headers), auto-set createMissingColumns=true
    // so that data keys become headers instead of being skipped
    const createMissingColumns = existingHeaders.length === 0 ? true : optionsCreateMissing;
    // Get all column keys from data
    const dataKeys = new Set<string>();
    for (const row of data) {
      Object.keys(row).forEach((k) => dataKeys.add(k));
    }

    // Map data columns to sheet columns
    const columnMap = new Map<string, number>(); // dataKey -> columnIndex
    const columnsMatched: string[] = [];
    const columnsSkipped: string[] = [];
    const columnsCreated: string[] = [];

    for (const key of dataKeys) {
      const headerIndex = existingHeaders.findIndex((h) => h.toLowerCase() === key.toLowerCase());
      if (headerIndex >= 0) {
        columnMap.set(key, headerIndex);
        columnsMatched.push(key);
      } else if (createMissingColumns) {
        // Add new column
        const newIndex = existingHeaders.length + columnsCreated.length;
        columnMap.set(key, newIndex);
        columnsCreated.push(key);
      } else {
        columnsSkipped.push(key);
      }
    }

    // If creating new columns, add headers first
    if (columnsCreated.length > 0) {
      const newHeaderStart = this.columnIndexToLetter(existingHeaders.length);
      const newHeaderEnd = this.columnIndexToLetter(
        existingHeaders.length + columnsCreated.length - 1
      );
      await executeWithRetry(() =>
        this.sheetsApi.spreadsheets.values.update({
          spreadsheetId,
          range: `'${targetSheet.title}'!${newHeaderStart}1:${newHeaderEnd}1`,
          valueInputOption: 'RAW',
          requestBody: { values: [columnsCreated] },
        })
      );
    }

    // Build rows based on column mapping
    const totalCols = Math.max(existingHeaders.length, ...Array.from(columnMap.values())) + 1;
    const rows: unknown[][] = [];

    for (const record of data) {
      const row: unknown[] = new Array(totalCols).fill('');
      let hasValue = false;

      for (const [key, value] of Object.entries(record)) {
        const colIndex = columnMap.get(key);
        if (colIndex !== undefined) {
          row[colIndex] = value ?? '';
          if (value !== null && value !== undefined && value !== '') {
            hasValue = true;
          }
        }
      }

      if (!skipEmptyRows || hasValue) {
        rows.push(row);
      }
    }

    if (rows.length === 0) {
      return {
        rowsAppended: 0,
        columnsMatched,
        columnsCreated,
        columnsSkipped,
        range: '',
        sheetId: targetSheet.sheetId,
      };
    }

    // Append data
    const endCol = this.columnIndexToLetter(totalCols - 1);
    const response = await executeWithRetry(() =>
      this.sheetsApi.spreadsheets.values.append({
        spreadsheetId,
        range: `'${targetSheet.title}'!A:${endCol}`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rows },
      })
    );

    return {
      rowsAppended: rows.length,
      columnsMatched,
      columnsCreated,
      columnsSkipped,
      range: response.data.updates?.updatedRange ?? '',
      sheetId: targetSheet.sheetId,
    };
  }

  /**
   * Bulk update rows by key column
   */
  async bulkUpdate(options: BulkUpdateOptions): Promise<BulkUpdateResult> {
    const { spreadsheetId, sheet, keyColumn, updates, createUnmatched = false } = options;

    if (updates.length === 0) {
      return {
        rowsUpdated: 0,
        rowsCreated: 0,
        keysNotFound: [],
        cellsModified: 0,
      };
    }

    // Resolve target sheet
    const resolved = await this.sheetResolver.resolve(spreadsheetId, {
      sheetName: typeof sheet === 'string' ? sheet : undefined,
      sheetId: typeof sheet === 'number' ? sheet : undefined,
    });
    const targetSheet = resolved.sheet;

    // Get all data including headers
    const dataResponse = await executeWithRetry(() =>
      this.sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range: `'${targetSheet.title}'`,
      })
    );

    const allRows = dataResponse.data.values ?? [];
    if (allRows.length === 0) {
      return {
        rowsUpdated: 0,
        rowsCreated: 0,
        keysNotFound: updates.map((u) => String(u[keyColumn] ?? '')),
        cellsModified: 0,
      };
    }

    const headers = allRows[0] ?? [];
    const keyColIndex = headers.findIndex(
      (h: unknown) => String(h ?? '').toLowerCase() === keyColumn.toLowerCase()
    );

    if (keyColIndex < 0) {
      throw new ValidationError(
        `Key column "${keyColumn}" not found in sheet`,
        'keyColumn',
        undefined,
        { keyColumn }
      );
    }

    // Build column index map
    const colMap = new Map<string, number>();
    headers.forEach((h: unknown, i: number) => {
      colMap.set(String(h ?? '').toLowerCase(), i);
    });

    // Build key -> row index map
    const keyRowMap = new Map<string, number>();
    for (let i = 1; i < allRows.length; i++) {
      const row = allRows[i];
      const keyValue = row ? String(row[keyColIndex] ?? '') : '';
      if (keyValue) {
        keyRowMap.set(keyValue.toLowerCase(), i);
      }
    }

    // Process updates
    const batchData: Array<{
      range: string;
      values: unknown[][];
    }> = [];
    const keysNotFound: string[] = [];
    const rowsToCreate: unknown[][] = [];
    let cellsModified = 0;

    for (const update of updates) {
      const keyValue = String(update[keyColumn] ?? '');
      const rowIndex = keyRowMap.get(keyValue.toLowerCase());

      if (rowIndex !== undefined) {
        // Update existing row
        const existingRow = allRows[rowIndex] ?? [];
        const newRow = [...existingRow];

        for (const [col, value] of Object.entries(update)) {
          if (col === keyColumn) continue;
          const colIndex = colMap.get(col.toLowerCase());
          if (colIndex !== undefined) {
            newRow[colIndex] = value;
            cellsModified++;
          }
        }

        const endCol = this.columnIndexToLetter(newRow.length - 1);
        batchData.push({
          range: `'${targetSheet.title}'!A${rowIndex + 1}:${endCol}${rowIndex + 1}`,
          values: [newRow],
        });
      } else if (createUnmatched) {
        // Create new row
        const newRow: unknown[] = new Array(headers.length).fill('');
        newRow[keyColIndex] = keyValue;

        for (const [col, value] of Object.entries(update)) {
          const colIndex = colMap.get(col.toLowerCase());
          if (colIndex !== undefined) {
            newRow[colIndex] = value;
          }
        }

        rowsToCreate.push(newRow);
      } else {
        keysNotFound.push(keyValue);
      }
    }

    // Execute batch update
    if (batchData.length > 0) {
      await executeWithRetry(() =>
        this.sheetsApi.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'RAW',
            data: batchData,
          },
        })
      );
    }

    // Append new rows
    if (rowsToCreate.length > 0) {
      const endCol = this.columnIndexToLetter(headers.length - 1);
      await executeWithRetry(() =>
        this.sheetsApi.spreadsheets.values.append({
          spreadsheetId,
          range: `'${targetSheet.title}'!A:${endCol}`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: rowsToCreate },
        })
      );
      cellsModified += rowsToCreate.length * headers.length;
    }

    return {
      rowsUpdated: batchData.length,
      rowsCreated: rowsToCreate.length,
      keysNotFound,
      cellsModified,
    };
  }

  /**
   * Deduplicate rows in a sheet
   */
  async deduplicate(options: DeduplicateOptions): Promise<DeduplicateResult> {
    const {
      spreadsheetId,
      sheet,
      keyColumns,
      keep = 'first',
      preview = false,
      _preComputedDuplicateRows,
      _preComputedTotalRows,
      _preComputedUniqueRows,
    } = options;

    // Resolve target sheet
    const resolved = await this.sheetResolver.resolve(spreadsheetId, {
      sheetName: typeof sheet === 'string' ? sheet : undefined,
      sheetId: typeof sheet === 'number' ? sheet : undefined,
    });
    const targetSheet = resolved.sheet;

    // Fast path: reuse pre-computed duplicate rows from a prior preview pass
    // Skips the expensive values.get API call and in-memory scan entirely
    if (_preComputedDuplicateRows && _preComputedDuplicateRows.size > 0 && !preview) {
      const duplicateRows = [..._preComputedDuplicateRows].sort((a, b) => b - a);
      const requests = duplicateRows.map((rowIndex) => ({
        deleteDimension: {
          range: {
            sheetId: targetSheet.sheetId,
            dimension: 'ROWS' as const,
            startIndex: rowIndex,
            endIndex: rowIndex + 1,
          },
        },
      }));

      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
      });

      return {
        totalRows: _preComputedTotalRows ?? 0,
        uniqueRows: _preComputedUniqueRows ?? 0,
        duplicatesFound: _preComputedDuplicateRows.size,
        rowsDeleted: duplicateRows.length,
      };
    }

    // Get all data
    const dataResponse = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: `'${targetSheet.title}'`,
    });

    const allRows = dataResponse.data.values ?? [];
    if (allRows.length <= 1) {
      // BUG-021 FIX: Return with informative message instead of silently reporting 0
      const message =
        allRows.length === 0
          ? 'Cannot deduplicate: sheet is empty'
          : 'Cannot deduplicate: sheet has only headers, no data rows';
      logger.info(message, { spreadsheetId, sheet: targetSheet.title });
      return {
        totalRows: Math.max(0, allRows.length - 1),
        uniqueRows: Math.max(0, allRows.length - 1),
        duplicatesFound: 0,
        rowsDeleted: 0,
        message,
      };
    }

    const headers = allRows[0] ?? [];

    // Find key column indices
    const keyColIndices = keyColumns.map((col) => {
      const idx = headers.findIndex(
        (h: unknown) => String(h ?? '').toLowerCase() === col.toLowerCase()
      );
      if (idx < 0) {
        throw new ValidationError(`Key column "${col}" not found`, 'keyColumns', undefined, {
          column: col,
        });
      }
      return idx;
    });

    // Track duplicates
    const seen = new Map<string, number>(); // key -> first row index
    const duplicateRowSet = new Set<number>();
    const duplicatePreview: Array<{
      rowNumber: number;
      keyValues: Record<
        string,
        string | number | boolean | unknown[] | Record<string, unknown> | null
      >;
      keepStatus: 'keep' | 'delete';
    }> = [];

    for (let i = 1; i < allRows.length; i++) {
      const row = allRows[i] ?? [];
      const keyValue = keyColIndices.map((idx) => String(row[idx] ?? '')).join('|');

      const existingRow = seen.get(keyValue);
      if (existingRow !== undefined) {
        const deleteRow = keep === 'first' ? i : existingRow;

        if (keep === 'last') {
          duplicateRowSet.add(existingRow);
        }
        if (keep === 'first') {
          duplicateRowSet.add(i);
        }

        if (preview) {
          const keyValues: Record<
            string,
            string | number | boolean | unknown[] | Record<string, unknown> | null
          > = {};
          keyColumns.forEach((col, idx) => {
            keyValues[col] = row[keyColIndices[idx] ?? 0];
          });

          duplicatePreview.push({
            rowNumber: deleteRow + 1, // 1-based for user
            keyValues,
            keepStatus: 'delete',
          });
        }

        if (keep === 'last') {
          seen.set(keyValue, i);
        }
      } else {
        seen.set(keyValue, i);
      }
    }

    // Delete duplicate rows (if not preview)
    let rowsDeleted = 0;
    const duplicateRows = [...duplicateRowSet];
    if (!preview && duplicateRows.length > 0) {
      // Sort in reverse order to delete from bottom up
      duplicateRows.sort((a, b) => b - a);

      // Delete in batches
      const requests = duplicateRows.map((rowIndex) => ({
        deleteDimension: {
          range: {
            sheetId: targetSheet.sheetId,
            dimension: 'ROWS' as const,
            startIndex: rowIndex,
            endIndex: rowIndex + 1,
          },
        },
      }));

      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
      });

      rowsDeleted = duplicateRows.length;
    }

    return {
      totalRows: allRows.length - 1,
      uniqueRows: seen.size,
      duplicatesFound: duplicateRowSet.size,
      rowsDeleted,
      duplicatePreview: preview ? duplicatePreview : undefined,
      _duplicateRowSet: preview ? duplicateRowSet : undefined,
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Parse CSV string to 2D array
   */
  private parseCsv(
    csvData: string,
    delimiter: string,
    skipEmptyRows: boolean,
    trimValues: boolean
  ): unknown[][] {
    const rows: unknown[][] = [];
    const lines = csvData.split(/\r?\n/);

    for (const line of lines) {
      if (skipEmptyRows && !line.trim()) {
        continue;
      }

      // Simple CSV parsing (handles basic cases)
      const values = this.parseCsvLine(line, delimiter);

      if (trimValues) {
        for (let i = 0; i < values.length; i++) {
          const val = values[i];
          if (typeof val === 'string') {
            values[i] = val.trim();
          }
        }
      }

      rows.push(values);
    }

    return rows;
  }

  /**
   * Parse a single CSV line handling quoted values
   */
  private parseCsvLine(line: string, delimiter: string): unknown[] {
    const values: unknown[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (inQuotes) {
        if (char === '"' && nextChar === '"') {
          current += '"';
          i++; // Skip next quote
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === delimiter) {
          values.push(this.parseValue(current));
          current = '';
        } else {
          current += char;
        }
      }
    }

    values.push(this.parseValue(current));
    return values;
  }

  /**
   * Parse a string value to appropriate type
   */
  private parseValue(str: string): unknown {
    const trimmed = str.trim();

    // Empty string
    if (!trimmed) return '';

    // Boolean
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;

    // Number
    const num = Number(trimmed);
    if (!isNaN(num) && trimmed !== '') return num;

    return trimmed;
  }

  /**
   * Create a new sheet
   */
  private async createSheet(spreadsheetId: string, title: string): Promise<ResolvedSheet> {
    const response = await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title },
            },
          },
        ],
      },
    });

    const reply = response.data.replies?.[0]?.addSheet;
    const sheetId = reply?.properties?.sheetId ?? 0;

    // Invalidate cache
    this.sheetResolver.invalidate(spreadsheetId);

    return {
      sheetId,
      title: reply?.properties?.title ?? title,
      index: reply?.properties?.index ?? 0,
      hidden: false,
    };
  }

  /**
   * Convert column index to letter
   */
  private columnIndexToLetter(index: number): string {
    let letter = '';
    let temp = index + 1;
    while (temp > 0) {
      const mod = (temp - 1) % 26;
      letter = String.fromCharCode(65 + mod) + letter;
      temp = Math.floor((temp - 1) / 26);
    }
    return letter;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let compositeOpsInstance: CompositeOperationsService | null = null;

/**
 * Get the composite operations service instance
 */
export function getCompositeOperations(): CompositeOperationsService | null {
  return compositeOpsInstance;
}

/**
 * Initialize composite operations service
 */
export function initializeCompositeOperations(
  sheetsApi: sheets_v4.Sheets,
  sheetResolver: SheetResolver
): CompositeOperationsService {
  compositeOpsInstance = new CompositeOperationsService(sheetsApi, sheetResolver);
  return compositeOpsInstance;
}

/**
 * Reset composite operations service (for testing only)
 * @internal
 */
export function resetCompositeOperations(): void {
  if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] !== 'true') {
    throw new ServiceError(
      'resetCompositeOperations() can only be called in test environment',
      'INTERNAL_ERROR',
      'CompositeOperations'
    );
  }
  compositeOpsInstance = null;
}
