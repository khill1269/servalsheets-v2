/**
 * Serval Core - SpreadsheetBackend Interface
 *
 * Platform-agnostic abstraction over spreadsheet APIs (Google Sheets, Excel Online, etc.)
 * Designed from analysis of actual API call patterns across 22 handlers:
 *
 *   - spreadsheets.batchUpdate: 114 calls (structural mutations)
 *   - spreadsheets.get: 69 calls (metadata reads)
 *   - spreadsheets.values.*: 30+ calls (cell value operations)
 *   - drive files/revisions: 9 calls (sharing/versioning)
 *   - developerMetadata: 2 calls (custom metadata)
 *
 * The interface is intentionally thin — wrapping the most common operations.
 * Platform-specific features (e.g., Google's developerMetadata, Excel's tables)
 * are exposed via the `native()` escape hatch.
 */

// ============================================================
// Core Types
// ============================================================

/** Platform identifier */
export type SpreadsheetPlatform = 'google-sheets' | 'excel-online' | 'excel-desktop' | 'notion' | 'airtable';

/** A reference to a cell range, always A1 notation (e.g., "Sheet1!A1:D10") */
export type RangeRef = string;

/** Value input options for write operations */
export type ValueInputOption = 'RAW' | 'USER_ENTERED';

/** Value render options for read operations */
export type ValueRenderOption = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';

/** Major dimension for value arrays */
export type MajorDimension = 'ROWS' | 'COLUMNS';

// ============================================================
// Data Types (cell values)
// ============================================================

export type CellValue = string | number | boolean | null;

export interface ValueRange {
  range: RangeRef;
  majorDimension?: MajorDimension;
  values: CellValue[][];
}

export interface ReadRangeParams {
  documentId: string;
  range: RangeRef;
  majorDimension?: MajorDimension;
  valueRenderOption?: ValueRenderOption;
  dateTimeRenderOption?: 'SERIAL_NUMBER' | 'FORMATTED_STRING';
}

export interface ReadRangeResult {
  range: RangeRef;
  majorDimension: MajorDimension;
  values: CellValue[][];
}

export interface WriteRangeParams {
  documentId: string;
  range: RangeRef;
  values: CellValue[][];
  valueInputOption?: ValueInputOption;
  majorDimension?: MajorDimension;
  includeValuesInResponse?: boolean;
}

export interface WriteRangeResult {
  updatedRange: RangeRef;
  updatedRows: number;
  updatedColumns: number;
  updatedCells: number;
  updatedValues?: CellValue[][];
}

export interface AppendParams {
  documentId: string;
  range: RangeRef;
  values: CellValue[][];
  valueInputOption?: ValueInputOption;
  insertDataOption?: 'OVERWRITE' | 'INSERT_ROWS';
  includeValuesInResponse?: boolean;
}

export interface AppendResult {
  tableRange: RangeRef;
  updatedRange: RangeRef;
  updatedRows: number;
  updatedColumns: number;
  updatedCells: number;
}

export interface ClearRangeParams {
  documentId: string;
  range: RangeRef;
}

export interface ClearRangeResult {
  clearedRange: RangeRef;
}

export interface BatchReadParams {
  documentId: string;
  ranges: RangeRef[];
  majorDimension?: MajorDimension;
  valueRenderOption?: ValueRenderOption;
  dateTimeRenderOption?: 'SERIAL_NUMBER' | 'FORMATTED_STRING';
}

export interface BatchReadResult {
  valueRanges: ValueRange[];
}

export interface BatchWriteParams {
  documentId: string;
  data: ValueRange[];
  valueInputOption?: ValueInputOption;
  includeValuesInResponse?: boolean;
}

export interface BatchWriteResult {
  totalUpdatedRows: number;
  totalUpdatedColumns: number;
  totalUpdatedCells: number;
  responses: WriteRangeResult[];
}

export interface BatchClearParams {
  documentId: string;
  ranges: RangeRef[];
}

export interface BatchClearResult {
  clearedRanges: RangeRef[];
}

// ============================================================
// Spreadsheet Metadata Types
// ============================================================

export interface SpreadsheetMetadata {
  documentId: string;
  title: string;
  locale?: string;
  timeZone?: string;
  sheets: SheetMetadata[];
  /** Platform-specific URL for the document */
  url?: string;
}

export interface SheetMetadata {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
  hidden?: boolean;
  tabColor?: { red?: number; green?: number; blue?: number; alpha?: number };
  frozen?: { rows?: number; columns?: number };
}

export interface CreateDocumentParams {
  title: string;
  locale?: string;
  timeZone?: string;
  sheets?: Array<{
    title: string;
    rowCount?: number;
    columnCount?: number;
  }>;
}

export interface GetDocumentParams {
  documentId: string;
  /** If provided, only include these ranges in the response */
  ranges?: RangeRef[];
  /** Include cell data for the specified ranges */
  includeGridData?: boolean;
  /** Field mask for partial responses */
  fields?: string;
}

export interface AddSheetParams {
  documentId: string;
  title: string;
  index?: number;
  rowCount?: number;
  columnCount?: number;
  tabColor?: { red?: number; green?: number; blue?: number; alpha?: number };
  hidden?: boolean;
}

export interface DeleteSheetParams {
  documentId: string;
  sheetId: number;
}

export interface CopySheetParams {
  documentId: string;
  sheetId: number;
  destinationDocumentId: string;
}

export interface CopySheetResult {
  sheetId: number;
  title: string;
  index: number;
}

// ============================================================
// Batch Mutation Types
// ============================================================

/**
 * A generic batch request containing platform-agnostic mutation operations.
 *
 * This maps to:
 *   - Google Sheets: `spreadsheets.batchUpdate` requests array
 *   - Excel Online: `POST /$batch` requests
 *
 * Each mutation is a { type, params } tuple representing a single operation
 * (e.g., addSheet, updateCells, addChart, setFormat).
 */
export interface BatchMutationRequest {
  /** Opaque mutation objects (platform-specific internally) */
  mutations: unknown[];
}

export interface BatchMutationResult {
  /** Number of mutations applied */
  appliedCount: number;
  /** Per-mutation results (platform-specific) */
  replies: unknown[];
}

// ============================================================
// Drive/File Operations
// ============================================================

export interface FileMetadata {
  documentId: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  createdTime?: string;
  owners?: Array<{ email: string; displayName?: string }>;
  webViewLink?: string;
}

export interface ListFilesParams {
  query?: string;
  maxResults?: number;
  orderBy?: string;
  cursor?: string;
}

export interface ListFilesResult {
  files: FileMetadata[];
  nextCursor?: string;
}

export interface CopyDocumentParams {
  documentId: string;
  title?: string;
  destinationFolderId?: string;
}

export interface RevisionMetadata {
  revisionId: string;
  modifiedTime: string;
  lastModifyingUser?: { email: string; displayName?: string };
}

export interface ListRevisionsParams {
  documentId: string;
  maxResults?: number;
  cursor?: string;
}

export interface ListRevisionsResult {
  revisions: RevisionMetadata[];
  nextCursor?: string;
}

// ============================================================
// The Main Interface
// ============================================================

/**
 * SpreadsheetBackend — platform-agnostic spreadsheet operations.
 *
 * Implementations:
 *   - GoogleSheetsBackend (wraps googleapis)
 *   - ExcelOnlineBackend (wraps Microsoft Graph)
 *
 * Design principles:
 *   1. Methods match the most common handler patterns (verified by grep)
 *   2. Parameters use `documentId` (not `spreadsheetId` or `workbookId`)
 *   3. Results are plain objects (no googleapis response wrappers)
 *   4. Platform-specific access via `native()` escape hatch
 *   5. All methods are async (HTTP API calls under the hood)
 */
export interface SpreadsheetBackend {
  // ─── Identity ──────────────────────────────────────────────
  readonly platform: SpreadsheetPlatform;

  // ─── Lifecycle ─────────────────────────────────────────────
  /** Initialize the backend (connect, authenticate, etc.) */
  initialize(): Promise<void>;
  /** Clean up resources (close connections, etc.) */
  dispose(): Promise<void>;

  // ─── Value Operations (30+ handler calls) ──────────────────
  /** Read cell values from a single range */
  readRange(params: ReadRangeParams): Promise<ReadRangeResult>;
  /** Write cell values to a single range */
  writeRange(params: WriteRangeParams): Promise<WriteRangeResult>;
  /** Append rows after existing data */
  appendRows(params: AppendParams): Promise<AppendResult>;
  /** Clear cell values from a range */
  clearRange(params: ClearRangeParams): Promise<ClearRangeResult>;
  /** Read cell values from multiple ranges at once */
  batchRead(params: BatchReadParams): Promise<BatchReadResult>;
  /** Write cell values to multiple ranges at once */
  batchWrite(params: BatchWriteParams): Promise<BatchWriteResult>;
  /** Clear cell values from multiple ranges at once */
  batchClear(params: BatchClearParams): Promise<BatchClearResult>;

  // ─── Document Operations (69+ handler calls) ───────────────
  /** Get spreadsheet/workbook metadata */
  getDocument(params: GetDocumentParams): Promise<SpreadsheetMetadata>;
  /** Create a new spreadsheet/workbook */
  createDocument(params: CreateDocumentParams): Promise<SpreadsheetMetadata>;

  // ─── Sheet/Worksheet Operations ────────────────────────────
  /** Add a new sheet/worksheet */
  addSheet(params: AddSheetParams): Promise<SheetMetadata>;
  /** Delete a sheet/worksheet */
  deleteSheet(params: DeleteSheetParams): Promise<void>;
  /** Copy a sheet to another document */
  copySheet(params: CopySheetParams): Promise<CopySheetResult>;

  // ─── Batch Mutations (114 handler calls) ───────────────────
  /**
   * Execute a batch of structural mutations atomically.
   *
   * This is the powerhouse operation — handles formatting, charts,
   * filters, conditional formatting, named ranges, protection, etc.
   *
   * Mutations are platform-specific objects built by the adapter.
   * Handlers use platform-specific helpers to construct mutations,
   * then pass them through this single execution point.
   */
  executeBatchMutations(
    documentId: string,
    request: BatchMutationRequest
  ): Promise<BatchMutationResult>;

  // ─── File/Drive Operations ─────────────────────────────────
  /** Copy an entire document */
  copyDocument(params: CopyDocumentParams): Promise<FileMetadata>;
  /** Get file metadata */
  getFileMetadata(documentId: string): Promise<FileMetadata>;
  /** List files (with optional query/filter) */
  listFiles(params: ListFilesParams): Promise<ListFilesResult>;
  /** List document revision history */
  listRevisions(params: ListRevisionsParams): Promise<ListRevisionsResult>;
  /** Get a specific revision */
  getRevision(documentId: string, revisionId: string): Promise<RevisionMetadata>;

  // ─── Escape Hatch ──────────────────────────────────────────
  /**
   * Access the underlying platform-specific client.
   *
   * For GoogleSheetsBackend: returns `{ sheets: sheets_v4.Sheets, drive: drive_v3.Drive }`
   * For ExcelOnlineBackend: returns `{ client: GraphClient }`
   *
   * Use this for platform-specific features not covered by the interface
   * (e.g., developerMetadata, pivot tables, etc.)
   */
  native<T = unknown>(): T;
}

// ============================================================
// Batch Mutation Helpers (Platform-Specific Factories)
// ============================================================

/**
 * Factory for creating platform-specific batch mutation objects.
 *
 * Each platform implements this to provide typed mutation builders.
 * This keeps the mutation construction type-safe while allowing
 * the SpreadsheetBackend.executeBatchMutations() method to be generic.
 */
export interface MutationFactory {
  /** Build a platform-specific mutation from a generic operation description */
  createMutation(type: string, params: Record<string, unknown>): unknown;
}

// ============================================================
// Backend Factory
// ============================================================

/** Configuration for creating a backend instance */
export interface BackendConfig {
  platform: SpreadsheetPlatform;
  /** Platform-specific configuration (credentials, endpoints, etc.) */
  options: Record<string, unknown>;
}

/** Factory function type for creating backend instances */
export type BackendFactory = (config: BackendConfig) => SpreadsheetBackend;
