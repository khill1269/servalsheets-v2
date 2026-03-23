/**
 * Type definitions for composite operations service.
 */

/**
 * CSV import options
 */
export interface CsvImportOptions {
  spreadsheetId: string;
  sheet?: string | number;
  csvData: string;
  delimiter?: string;
  hasHeader?: boolean;
  mode?: 'replace' | 'append' | 'new_sheet';
  newSheetName?: string;
  skipEmptyRows?: boolean;
  trimValues?: boolean;
}

/**
 * CSV import result
 */
export interface CsvImportResult {
  rowsImported: number;
  columnsImported: number;
  range: string;
  sheetId: number;
  sheetName: string;
  rowsSkipped: number;
  newSheetCreated: boolean;
}

/**
 * Smart append options
 */
export interface SmartAppendOptions {
  spreadsheetId: string;
  sheet: string | number;
  data: Array<Record<string, unknown>>;
  matchHeaders?: boolean;
  createMissingColumns?: boolean;
  skipEmptyRows?: boolean;
}

/**
 * Smart append result
 */
export interface SmartAppendResult {
  rowsAppended: number;
  columnsMatched: string[];
  columnsCreated: string[];
  columnsSkipped: string[];
  range: string;
  sheetId: number;
}

/**
 * Bulk update options
 */
export interface BulkUpdateOptions {
  spreadsheetId: string;
  sheet: string | number;
  keyColumn: string;
  updates: Array<Record<string, unknown>>;
  createUnmatched?: boolean;
}

/**
 * Bulk update result
 */
export interface BulkUpdateResult {
  rowsUpdated: number;
  rowsCreated: number;
  keysNotFound: string[];
  cellsModified: number;
}

/**
 * Data deduplication options
 */
export interface DeduplicateOptions {
  spreadsheetId: string;
  sheet: string | number;
  keyColumns: string[];
  keep?: 'first' | 'last';
  preview?: boolean;
  _preComputedDuplicateRows?: Set<number>;
  _preComputedTotalRows?: number;
  _preComputedUniqueRows?: number;
}

/**
 * Deduplication result
 */
export interface DeduplicateResult {
  totalRows: number;
  uniqueRows: number;
  duplicatesFound: number;
  rowsDeleted: number;
  message?: string;
  duplicatePreview?: Array<{
    rowNumber: number;
    keyValues: Record<
      string,
      string | number | boolean | unknown[] | Record<string, unknown> | null
    >;
    keepStatus: 'keep' | 'delete';
  }>;
  _duplicateRowSet?: Set<number>;
}
