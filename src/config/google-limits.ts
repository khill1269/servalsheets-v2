/**
 * Google Sheets API v4 Limits and Constants
 *
 * Official limits from Google Sheets API documentation.
 * These constants are used for input validation across all schemas.
 *
 * References:
 * - https://developers.google.com/sheets/api/limits
 * - https://support.google.com/drive/answer/37603
 *
 * @module config/google-limits
 */

// ============================================================================
// SPREADSHEET & SHEET LIMITS
// ============================================================================

/**
 * Maximum length for spreadsheet title
 * @see https://developers.google.com/sheets/api/limits
 */
export const SPREADSHEET_TITLE_MAX_LENGTH = 255;

/**
 * Maximum length for sheet name
 * @see https://developers.google.com/sheets/api/limits
 */
export const SHEET_NAME_MAX_LENGTH = 255;

/**
 * Maximum number of sheets per spreadsheet
 * @see https://support.google.com/drive/answer/37603
 */
export const MAX_SHEETS_PER_SPREADSHEET = 200;

/**
 * Maximum cells per spreadsheet (10 million)
 * @see https://support.google.com/drive/answer/37603
 */
export const MAX_CELLS_PER_SPREADSHEET = 10_000_000;

// ============================================================================
// CELL CONTENT LIMITS
// ============================================================================

/**
 * Maximum length for cell note/comment
 * @see https://developers.google.com/sheets/api/limits
 */
export const CELL_NOTE_MAX_LENGTH = 50_000;

/**
 * Maximum length for formula
 * @see https://developers.google.com/sheets/api/limits
 */
export const FORMULA_MAX_LENGTH = 50_000;

/**
 * Maximum length for hyperlink URL
 * @see https://developers.google.com/sheets/api/limits
 */
export const HYPERLINK_URL_MAX_LENGTH = 50_000;

/**
 * Maximum characters per cell
 * @see https://support.google.com/drive/answer/37603
 */
export const MAX_CHARACTERS_PER_CELL = 50_000;

// ============================================================================
// RANGE & REFERENCE LIMITS
// ============================================================================

/**
 * Maximum length for A1 notation string
 * Conservative limit for A1 notation including sheet name and range
 * Example: "Very Long Sheet Name!A1:ZZZ999999"
 */
export const A1_NOTATION_MAX_LENGTH = 500;

/**
 * Maximum length for named range name
 * @see https://developers.google.com/sheets/api/limits
 */
export const NAMED_RANGE_NAME_MAX_LENGTH = 255;

/**
 * Maximum number of named ranges per spreadsheet
 * @see https://developers.google.com/sheets/api/limits
 */
export const MAX_NAMED_RANGES = 500;

// ============================================================================
// BATCH OPERATION LIMITS
// ============================================================================

/**
 * Maximum number of requests in a single batchUpdate call
 * @see https://developers.google.com/sheets/api/limits
 */
export const BATCH_REQUEST_LIMIT = 100;

/**
 * Maximum number of rows to read/write in a single operation
 * Not a hard API limit, but practical limit for performance
 */
export const BATCH_ROW_LIMIT = 10_000;

// ============================================================================
// CONDITIONAL FORMATTING LIMITS
// ============================================================================

/**
 * Maximum number of conditional format rules per sheet
 * @see https://developers.google.com/sheets/api/limits
 */
export const MAX_CONDITIONAL_FORMAT_RULES = 500;

// ============================================================================
// FILTER & SORT LIMITS
// ============================================================================

/**
 * Maximum number of filter views per sheet
 * @see https://developers.google.com/sheets/api/limits
 */
export const MAX_FILTER_VIEWS = 200;

/**
 * Maximum number of sort specs per request
 * @see https://developers.google.com/sheets/api/limits
 */
export const MAX_SORT_SPECS = 255;

// ============================================================================
// API RATE LIMITS
// ============================================================================

/**
 * Read requests per minute per project
 * @see https://developers.google.com/sheets/api/limits
 */
export const READ_REQUESTS_PER_MINUTE_PER_PROJECT = 300;

/**
 * Write requests per minute per project
 * @see https://developers.google.com/sheets/api/limits
 */
export const WRITE_REQUESTS_PER_MINUTE_PER_PROJECT = 300;

/**
 * Read requests per minute per user per project
 * @see https://developers.google.com/sheets/api/limits
 */
export const READ_REQUESTS_PER_MINUTE_PER_USER = 60;

/**
 * Write requests per minute per user per project
 * @see https://developers.google.com/sheets/api/limits
 */
export const WRITE_REQUESTS_PER_MINUTE_PER_USER = 60;

/**
 * Legacy 100-second quota window constants retained for compatibility.
 *
 * Google publishes per-minute quotas for Sheets API; these aliases map
 * to the current per-user-per-minute values to avoid stale numeric limits.
 *
 * @deprecated Use READ_REQUESTS_PER_MINUTE_PER_USER and WRITE_REQUESTS_PER_MINUTE_PER_USER.
 * @see https://developers.google.com/sheets/api/limits
 */
export const READ_REQUESTS_PER_100_SECONDS = READ_REQUESTS_PER_MINUTE_PER_USER;
export const WRITE_REQUESTS_PER_100_SECONDS = WRITE_REQUESTS_PER_MINUTE_PER_USER;

// ============================================================================
// GRID DIMENSION LIMITS
// ============================================================================

/**
 * Maximum columns per sheet
 * @see https://support.google.com/drive/answer/37603
 */
export const MAX_COLUMNS_PER_SHEET = 18_278;

/**
 * Maximum rows per sheet
 * @see https://support.google.com/drive/answer/37603
 */
export const MAX_ROWS_PER_SHEET = 10_000_000;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Regular expression for valid A1 notation (supports multi-range)
 * Matches:
 * - Single ranges: A1, Sheet1!A1, Sheet1!A1:B10, A:A, 1:1, Sheet1!A:B
 * - Multi-ranges: A1:A10,D1:D10, Sheet1!A1:B10,Sheet1!E1:F10 (comma-separated)
 * - Whole sheets: Sheet1, 'Sheet Name'
 * - Quoted sheet names: 'My Sheet'!A1
 *
 * Note: Multi-range notation is required for chart data sources and batch operations.
 * Google Sheets API performs comprehensive validation of range syntax.
 */
export const A1_NOTATION_REGEX = /^[^[\]]+$/;

/**
 * Regular expression for valid sheet name
 * Sheet names cannot contain: \ / ? * [ ]
 * Also cannot be empty or exceed 255 characters
 */
export const SHEET_NAME_REGEX = /^[^\\/?*[\]]+$/;

/**
 * Regular expression for valid spreadsheet ID
 * Format: alphanumeric, hyphens, underscores (44 characters typical)
 */
export const SPREADSHEET_ID_REGEX = /^[a-zA-Z0-9-_]+$/;

/**
 * Regular expression for valid URL (HTTP/HTTPS)
 * Supports:
 * - Standard domain URLs: http://example.com
 * - localhost: http://localhost:3000
 * - IP addresses: http://127.0.0.1:3000
 * - Paths, query strings, and fragments
 */
export const URL_REGEX =
  /^https?:\/\/(?:(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}|localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d{1,5})?(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)$/;

// ============================================================================
// EXPORTED VALIDATION OBJECT
// ============================================================================

/**
 * All Google Sheets API limits in a single object for easy reference
 */
export const GOOGLE_SHEETS_LIMITS = {
  // Spreadsheet & Sheet
  spreadsheetTitleMaxLength: SPREADSHEET_TITLE_MAX_LENGTH,
  sheetNameMaxLength: SHEET_NAME_MAX_LENGTH,
  maxSheetsPerSpreadsheet: MAX_SHEETS_PER_SPREADSHEET,
  maxCellsPerSpreadsheet: MAX_CELLS_PER_SPREADSHEET,

  // Cell Content
  cellNoteMaxLength: CELL_NOTE_MAX_LENGTH,
  formulaMaxLength: FORMULA_MAX_LENGTH,
  hyperlinkUrlMaxLength: HYPERLINK_URL_MAX_LENGTH,
  maxCharactersPerCell: MAX_CHARACTERS_PER_CELL,

  // Ranges & References
  a1NotationMaxLength: A1_NOTATION_MAX_LENGTH,
  namedRangeNameMaxLength: NAMED_RANGE_NAME_MAX_LENGTH,
  maxNamedRanges: MAX_NAMED_RANGES,

  // Batch Operations
  batchRequestLimit: BATCH_REQUEST_LIMIT,
  batchRowLimit: BATCH_ROW_LIMIT,

  // Conditional Formatting
  maxConditionalFormatRules: MAX_CONDITIONAL_FORMAT_RULES,

  // Filters & Sorting
  maxFilterViews: MAX_FILTER_VIEWS,
  maxSortSpecs: MAX_SORT_SPECS,

  // API Rate Limits
  readRequestsPerMinute: READ_REQUESTS_PER_MINUTE_PER_PROJECT,
  writeRequestsPerMinute: WRITE_REQUESTS_PER_MINUTE_PER_PROJECT,
  readRequestsPerMinutePerProject: READ_REQUESTS_PER_MINUTE_PER_PROJECT,
  writeRequestsPerMinutePerProject: WRITE_REQUESTS_PER_MINUTE_PER_PROJECT,
  readRequestsPerMinutePerUser: READ_REQUESTS_PER_MINUTE_PER_USER,
  writeRequestsPerMinutePerUser: WRITE_REQUESTS_PER_MINUTE_PER_USER,
  readRequestsPer100Seconds: READ_REQUESTS_PER_100_SECONDS,
  writeRequestsPer100Seconds: WRITE_REQUESTS_PER_100_SECONDS,

  // Grid Dimensions
  maxColumnsPerSheet: MAX_COLUMNS_PER_SHEET,
  maxRowsPerSheet: MAX_ROWS_PER_SHEET,

  // Validation Patterns
  a1NotationRegex: A1_NOTATION_REGEX,
  sheetNameRegex: SHEET_NAME_REGEX,
  spreadsheetIdRegex: SPREADSHEET_ID_REGEX,
  urlRegex: URL_REGEX,
} as const;
