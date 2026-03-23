/**
 * ServalSheets - Shared Schemas
 *
 * MCP Protocol: 2025-11-25
 * Google Sheets API: v4
 */

import { z } from 'zod';
import {
  SPREADSHEET_ID_REGEX,
  A1_NOTATION_REGEX,
  A1_NOTATION_MAX_LENGTH,
  SHEET_NAME_REGEX,
  SHEET_NAME_MAX_LENGTH,
  URL_REGEX,
} from '../config/google-limits.js';

// ============================================================================
// PROTOCOL CONSTANTS
// ============================================================================

export { MCP_PROTOCOL_VERSION } from '../config/protocol.js';
export const SHEETS_API_VERSION = 'v4';
export const DRIVE_API_VERSION = 'v3';

// ============================================================================
// COLOR UTILITIES
// ============================================================================

/** Convert hex color to RGB (0-1 scale) */
function hexToRgb(hex: string): { red: number; green: number; blue: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result || !result[1] || !result[2] || !result[3]) return null;
  return {
    red: parseInt(result[1], 16) / 255,
    green: parseInt(result[2], 16) / 255,
    blue: parseInt(result[3], 16) / 255,
  };
}

/** Named colors map (0-1 scale) */
const NAMED_COLORS: Record<string, { red: number; green: number; blue: number }> = {
  red: { red: 1, green: 0, blue: 0 },
  green: { red: 0, green: 0.5, blue: 0 },
  blue: { red: 0, green: 0, blue: 1 },
  white: { red: 1, green: 1, blue: 1 },
  black: { red: 0, green: 0, blue: 0 },
  yellow: { red: 1, green: 1, blue: 0 },
  orange: { red: 1, green: 0.65, blue: 0 },
  purple: { red: 0.5, green: 0, blue: 0.5 },
  pink: { red: 1, green: 0.75, blue: 0.8 },
  gray: { red: 0.5, green: 0.5, blue: 0.5 },
  grey: { red: 0.5, green: 0.5, blue: 0.5 },
  // Google's brand colors
  'google-blue': { red: 0.26, green: 0.52, blue: 0.96 },
  'google-red': { red: 0.92, green: 0.26, blue: 0.21 },
  'google-green': { red: 0.13, green: 0.55, blue: 0.13 },
  'google-yellow': { red: 0.98, green: 0.74, blue: 0.02 },
};

// ============================================================================
// PRIMITIVE SCHEMAS
// ============================================================================

/**
 * Google Sheets API color format (0-1 scale)
 * Accepts:
 * - RGB object: {red: 1, green: 0, blue: 0}
 * - Hex string: "#FF0000" or "FF0000"
 * - Named color: "red", "blue", "google-blue"
 */
export const ColorSchema = z
  .preprocess(
    (val) => {
      // Already an object with color values - pass through
      if (
        typeof val === 'object' &&
        val !== null &&
        ('red' in val || 'green' in val || 'blue' in val)
      ) {
        return val;
      }
      if (typeof val === 'string') {
        // Hex string (with or without #)
        if (/^#?[a-f\d]{6}$/i.test(val)) {
          const rgb = hexToRgb(val);
          if (rgb) return rgb;
        }
        // Named color
        const lower = val.toLowerCase();
        if (NAMED_COLORS[lower]) {
          return NAMED_COLORS[lower];
        }
      }
      return val;
    },
    z.object({
      red: z.number().min(0).max(1).optional().default(0),
      green: z.number().min(0).max(1).optional().default(0),
      blue: z.number().min(0).max(1).optional().default(0),
      alpha: z.number().min(0).max(1).optional().default(1),
    })
  )
  .transform((color) => ({
    red: Math.round(color.red * 10000) / 10000,
    green: Math.round(color.green * 10000) / 10000,
    blue: Math.round(color.blue * 10000) / 10000,
    alpha: Math.round(color.alpha * 10000) / 10000,
  }))
  .describe(
    'Color in RGB 0-1 scale, hex (#4285F4), or named (red, blue, google-blue). Examples: {red:1,green:0,blue:0}, "#FF0000", "red"'
  );

// ISSUE-079: Theme color support for Google Sheets dynamic theming
/** ThemeColorType enum — colors that update automatically with the spreadsheet theme */
export const ThemeColorTypeSchema = z
  .enum([
    'TEXT',
    'BACKGROUND',
    'ACCENT1',
    'ACCENT2',
    'ACCENT3',
    'ACCENT4',
    'ACCENT5',
    'ACCENT6',
    'LINK',
  ])
  .describe(
    'Theme color that updates with the spreadsheet theme. Values: TEXT, BACKGROUND, ACCENT1-6, LINK'
  );

/** ColorStyle — either an explicit RGB color or a theme color reference */
export const ColorStyleSchema = z
  .union([
    z.object({ rgbColor: ColorSchema }).describe('Explicit RGB color'),
    z
      .object({ themeColor: ThemeColorTypeSchema })
      .describe('Theme color (auto-updates with spreadsheet theme)'),
  ])
  .describe(
    'Color as explicit RGB { rgbColor: {red,green,blue} } or theme reference { themeColor: "ACCENT1" }'
  );

/** Cell value types */
export const CellValueSchema = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .describe('Cell value');

/** 2D array of values */
export const ValuesArraySchema = z
  .array(z.array(CellValueSchema))
  .describe(
    '2D array of values (rows × columns): [["Name","Age"],["Alice",30],["Bob",25]] writes 3 rows × 2 columns'
  );

/** Spreadsheet ID */
export const SpreadsheetIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(SPREADSHEET_ID_REGEX, 'Invalid spreadsheet ID format')
  .describe(
    'Spreadsheet ID from URL (e.g., "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms" from https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit)'
  );

/** Sheet ID (numeric) - coerces strings from MCP clients */
export const SheetIdSchema = z.coerce
  .number()
  .int()
  .min(0)
  .describe(
    'Numeric sheet/tab ID (e.g., 0 for first sheet, found in URL #gid=123456789). Use sheets_core get to retrieve sheet IDs.'
  );

/** A1 Notation */
export const A1NotationSchema = z.preprocess(
  (val) => {
    // Defensive: Ensure value is a string before regex validation
    // Prevents "a1.match is not a function" runtime errors
    if (typeof val !== 'string') {
      // Return invalid value to trigger proper Zod validation error
      return val;
    }
    return val;
  },
  z
    .string()
    .min(1)
    .max(A1_NOTATION_MAX_LENGTH)
    .regex(A1_NOTATION_REGEX, 'Invalid A1 notation format')
    .refine(
      (val) => !val.startsWith("'") || /^'([^']|'')*'!/.test(val),
      "Sheet names with single quotes must use '' escaping in A1 notation (e.g., 'Tom''s Sheet'!A1)"
    )
    .refine((val) => {
      // Reject unbounded multi-column refs like "A:Z" or "Sheet1!A:Z" — triggers full grid fetch.
      // Single-column refs like "A:A" are allowed and used throughout the API/docs/tests.
      const range = val.includes('!') ? val.split('!')[1] : val;
      const columnRangeMatch = /^(\$?[A-Z]+):(\$?[A-Z]+)$/i.exec(range ?? '');
      if (!columnRangeMatch) {
        return true;
      }

      const startColumn = columnRangeMatch[1]?.replace(/\$/g, '');
      const endColumn = columnRangeMatch[2]?.replace(/\$/g, '');
      return startColumn === endColumn;
    }, 'Full column references spanning multiple columns like "A:Z" are not allowed — use explicit row bounds like "A1:Z1000" to prevent unbounded API fetches. Single-column references like "A:A" are allowed.')
    .describe(
      'A1 notation range: "A1" (single cell), "A1:C10" (range), "Sheet1!A1:C10" (with sheet name). Full column refs (A:Z) are rejected — always include row numbers.'
    )
);

/** Sheet name */
export const SheetNameSchema = z
  .string()
  .min(1)
  .max(SHEET_NAME_MAX_LENGTH)
  .regex(SHEET_NAME_REGEX, String.raw`Sheet name cannot contain: \ / ? * [ ]`)
  .describe(String.raw`Sheet/tab name (no special chars: \ / ? * [ ])`);

// ============================================================================
// ENUMS (Google Sheets API)
// ============================================================================

export const ValueRenderOptionSchema = z
  .preprocess(
    (val) => (typeof val === 'string' ? val.toUpperCase() : val),
    z.enum(['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'])
  )
  .default('FORMATTED_VALUE')
  .describe(
    'How to render cell values: FORMATTED_VALUE (default, displays "$1,234.56"), UNFORMATTED_VALUE (raw number 1234.56), FORMULA (shows "=SUM(A1:A10)"). Case-insensitive.'
  );

export const ValueInputOptionSchema = z
  .preprocess(
    (val) => (typeof val === 'string' ? val.toUpperCase() : val),
    z.enum(['RAW', 'USER_ENTERED'])
  )
  .default('USER_ENTERED')
  .describe(
    'How to interpret input: USER_ENTERED (default, parses formulas/dates like typing in UI), RAW (stores exactly as provided, "=SUM" becomes literal text). Case-insensitive.'
  );

export const InsertDataOptionSchema = z
  .preprocess(
    (val) => (typeof val === 'string' ? val.toUpperCase() : val),
    z.enum(['OVERWRITE', 'INSERT_ROWS'])
  )
  .default('INSERT_ROWS')
  .describe(
    'How to handle existing data when appending: INSERT_ROWS (default, adds new rows after last row with data), OVERWRITE (replaces existing data in the range). Case-insensitive.'
  );

export const MajorDimensionSchema = z
  .preprocess(
    (val) => (typeof val === 'string' ? val.toUpperCase() : val),
    z.enum(['ROWS', 'COLUMNS'])
  )
  .default('ROWS')
  .describe(
    'Data organization: ROWS (default, data[0]=first row), COLUMNS (data[0]=first column, useful for column-oriented data). Case-insensitive.'
  );

export const DimensionSchema = z
  .preprocess(
    (val) => (typeof val === 'string' ? val.toUpperCase() : val),
    z.enum(['ROWS', 'COLUMNS'])
  )
  .describe(
    'Dimension type: ROWS (horizontal bands) or COLUMNS (vertical bands). Case-insensitive.'
  );

export const HorizontalAlignSchema = z
  .enum(['LEFT', 'CENTER', 'RIGHT'])
  .describe('Horizontal text alignment within cell');
export const VerticalAlignSchema = z
  .enum(['TOP', 'MIDDLE', 'BOTTOM'])
  .describe('Vertical text alignment within cell');

export const WrapStrategySchema = z
  .enum(['OVERFLOW_CELL', 'LEGACY_WRAP', 'CLIP', 'WRAP'])
  .describe(
    'Text wrapping: WRAP (wraps to fit column width), CLIP (truncates at cell edge), OVERFLOW_CELL (extends into adjacent empty cells)'
  );

export const BorderStyleSchema = z
  .enum(['NONE', 'DOTTED', 'DASHED', 'SOLID', 'SOLID_MEDIUM', 'SOLID_THICK', 'DOUBLE'])
  .describe('Cell border style (e.g., SOLID, DASHED, DOTTED, DOUBLE, NONE).');

export const MergeTypeSchema = z
  .enum(['MERGE_ALL', 'MERGE_COLUMNS', 'MERGE_ROWS'])
  .describe(
    'Cell merge type: MERGE_ALL (all cells), MERGE_COLUMNS (by column), MERGE_ROWS (by row).'
  );

export const PasteTypeSchema = z
  .enum([
    'PASTE_NORMAL',
    'PASTE_VALUES',
    'PASTE_FORMAT',
    'PASTE_NO_BORDERS',
    'PASTE_FORMULA',
    'PASTE_DATA_VALIDATION',
    'PASTE_CONDITIONAL_FORMATTING',
  ])
  .describe(
    'Paste type: PASTE_NORMAL (all), PASTE_VALUES (values only), PASTE_FORMAT (format only), PASTE_FORMULA (formulas only).'
  );

export const ChartTypeSchema = z
  .preprocess(
    (val) => {
      if (typeof val !== 'string') return val;
      const upper = val.toUpperCase();
      // COMBO is a valid Sheets API enum but requires series-level chartType
      // overrides to work. Without them, Google API returns "No basic chart
      // type specified." Fall back to COLUMN which is the closest visual.
      if (upper === 'COMBO') return 'COLUMN';
      return upper;
    },
    z.enum([
      'BAR',
      'LINE',
      'AREA',
      'COLUMN',
      'SCATTER',
      'COMBO',
      'STEPPED_AREA',
      'PIE',
      'DOUGHNUT',
      'TREEMAP',
      'WATERFALL',
      'HISTOGRAM',
      'CANDLESTICK',
      'ORG',
      'RADAR',
      'SCORECARD',
      'BUBBLE',
    ])
  )
  .describe(
    'Chart type (e.g., BAR, LINE, PIE, COLUMN). Case-insensitive. Note: COMBO requires series-level type overrides; auto-falls back to COLUMN.'
  );

export const LegendPositionSchema = z
  .preprocess(
    (val) => (typeof val === 'string' ? val.toUpperCase() : val),
    z.enum(['BOTTOM_LEGEND', 'LEFT_LEGEND', 'RIGHT_LEGEND', 'TOP_LEGEND', 'NO_LEGEND'])
  )
  .describe('Legend position for charts. Case-insensitive.');

export const SummarizeFunctionSchema = z
  .enum([
    'SUM',
    'COUNTA',
    'COUNT',
    'COUNTUNIQUE',
    'AVERAGE',
    'MAX',
    'MIN',
    'MEDIAN',
    'PRODUCT',
    'STDEV',
    'STDEVP',
    'VAR',
    'VARP',
    'CUSTOM',
  ])
  .describe('Aggregation function for pivot table values (e.g., SUM, AVERAGE, COUNT, MAX, MIN).');

export const SortOrderSchema = z
  .preprocess(
    (val) => (typeof val === 'string' ? val.toUpperCase() : val),
    z.enum(['ASCENDING', 'DESCENDING'])
  )
  .describe('Sort order: ASCENDING or DESCENDING. Case-insensitive.');

export const PermissionRoleSchema = z
  .enum(['owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader'])
  .describe(
    'Drive permission role: reader (view), commenter (comment), writer (edit), owner (full control).'
  );

export const PermissionTypeSchema = z
  .enum(['user', 'group', 'domain', 'anyone'])
  .describe(
    'Drive permission type: user (email), group (Google group), domain (whole domain), anyone (public).'
  );

export const ConditionTypeSchema = z
  .enum([
    // Number
    'NUMBER_GREATER',
    'NUMBER_GREATER_THAN_EQ',
    'NUMBER_LESS',
    'NUMBER_LESS_THAN_EQ',
    'NUMBER_EQ',
    'NUMBER_NOT_EQ',
    'NUMBER_BETWEEN',
    'NUMBER_NOT_BETWEEN',
    // Text
    'TEXT_CONTAINS',
    'TEXT_NOT_CONTAINS',
    'TEXT_STARTS_WITH',
    'TEXT_ENDS_WITH',
    'TEXT_EQ',
    'TEXT_IS_EMAIL',
    'TEXT_IS_URL',
    // Date
    'DATE_EQ',
    'DATE_BEFORE',
    'DATE_AFTER',
    'DATE_ON_OR_BEFORE',
    'DATE_ON_OR_AFTER',
    'DATE_BETWEEN',
    'DATE_NOT_BETWEEN',
    'DATE_IS_VALID',
    // Other
    'BLANK',
    'NOT_BLANK',
    'CUSTOM_FORMULA',
    'ONE_OF_LIST',
    'ONE_OF_RANGE',
    'BOOLEAN',
    'TEXT_NOT_EQ',
    'DATE_NOT_EQ',
    'FILTER_EXPRESSION',
  ])
  .describe(
    'Conditional format condition type (e.g., NUMBER_GREATER, TEXT_CONTAINS, DATE_BEFORE, CUSTOM_FORMULA, BLANK).'
  );

// ============================================================================
// ERROR CODES
// ============================================================================

export const ErrorCodeSchema = z
  .enum([
    // MCP Standard (5 codes)
    'PARSE_ERROR',
    'INVALID_REQUEST',
    'METHOD_NOT_FOUND',
    'INVALID_PARAMS',
    'INTERNAL_ERROR',
    // Authentication & Authorization (5 codes)
    'UNAUTHENTICATED',
    'NOT_AUTHENTICATED',
    'PERMISSION_DENIED',
    'INVALID_CREDENTIALS',
    'TOKEN_EXPIRED',
    'INSUFFICIENT_PERMISSIONS',
    'INCREMENTAL_SCOPE_REQUIRED', // Phase 0: OAuth incremental consent
    // Quota & Rate Limiting (3 codes)
    'QUOTA_EXCEEDED',
    'RATE_LIMITED',
    'RESOURCE_EXHAUSTED',
    // Spreadsheet Errors (8 codes)
    'SPREADSHEET_NOT_FOUND',
    'SPREADSHEET_TOO_LARGE',
    'SHEET_NOT_FOUND',
    'INVALID_SHEET_ID',
    'DUPLICATE_SHEET_NAME',
    'INVALID_RANGE',
    'RANGE_NOT_FOUND',
    'PROTECTED_RANGE',
    // Data & Formula Errors (5 codes)
    'COMPUTE_ERROR', // Computation/expression evaluation failure (sheets_compute)
    'FORMULA_ERROR',
    'CIRCULAR_REFERENCE',
    'INVALID_DATA_VALIDATION',
    'MERGE_CONFLICT',
    'FORMULA_INJECTION_BLOCKED', // ISSUE-214: dangerous import/query formula rejected
    // Feature-Specific Errors (7 codes)
    'CONDITIONAL_FORMAT_ERROR',
    'PIVOT_TABLE_ERROR',
    'CHART_ERROR',
    'FILTER_VIEW_ERROR',
    'NAMED_RANGE_ERROR',
    'DEVELOPER_METADATA_ERROR',
    'DIMENSION_ERROR',
    // Operation Errors (8 codes)
    'BATCH_UPDATE_ERROR',
    'TRANSACTION_ERROR',
    'ABORTED',
    'DEADLINE_EXCEEDED',
    'CANCELLED',
    'OPERATION_CANCELLED', // Phase 1.3: User cancelled operation via elicitation
    'OPERATION_FAILED', // Generic operation failure (composite, agent)
    'DATA_LOSS',
    // Network & Service Errors (6 codes)
    'UNAVAILABLE',
    'CONNECTION_ERROR', // HTTP/2 GOAWAY, stream errors, connection resets
    'UNIMPLEMENTED',
    'UNKNOWN',
    'OUT_OF_RANGE',
    'FAILED_PRECONDITION',
    // Safety Rails (3 codes)
    'PRECONDITION_FAILED',
    'EFFECT_SCOPE_EXCEEDED',
    'EXPLICIT_RANGE_REQUIRED',
    'AMBIGUOUS_RANGE',
    // Features
    'FEATURE_UNAVAILABLE',
    'FEATURE_DEGRADED',
    // Auth & configuration
    'AUTHENTICATION_REQUIRED',
    'AUTH_ERROR',
    'CONFIG_ERROR',
    'NOT_CONFIGURED',
    'VALIDATION_ERROR',
    // Resource/handler lifecycle
    'NOT_FOUND',
    'NOT_IMPLEMENTED',
    'HANDLER_LOAD_ERROR',
    // Session limits
    'TOO_MANY_SESSIONS',
    // Data integrity
    'DATA_ERROR',
    'VERSION_MISMATCH',
    'NO_DATA',
    // Service lifecycle
    'SERVICE_NOT_INITIALIZED',
    'SERVICE_NOT_ENABLED', // BUG FIX 0.9: For GCP API not enabled errors
    'SNAPSHOT_CREATION_FAILED',
    'SNAPSHOT_RESTORE_FAILED',
    // Transactions
    'TRANSACTION_CONFLICT',
    'TRANSACTION_EXPIRED',
    // HTTP Transport
    'SESSION_NOT_FOUND',
    // Session checkpoints (sheets_session.save_checkpoint / load_checkpoint)
    'CHECKPOINTS_DISABLED',
    'CHECKPOINT_NOT_FOUND',
    // Batch/Payload
    'PAYLOAD_TOO_LARGE',
    'OPERATION_LIMIT_EXCEEDED',
    // MCP-native features (SEP-1036, SEP-1577)
    'ELICITATION_UNAVAILABLE',
    'SAMPLING_UNAVAILABLE',
    // Discovery & Replay
    'FORBIDDEN',
    'DISCOVERY_FAILED', // Action discovery in discover_action failed
    'REPLAY_FAILED',
    // Generic
    'UNKNOWN_ERROR',
    // Connectors
    'INVALID_ACTION',
    'CONNECTOR_ERROR',
    // Session errors
    'SESSION_ERROR',
    // DuckDB / SQL query safety
    'QUERY_REJECTED', // SQL safety rejection (non-SELECT, DDL/DML, file-system access, invalid name)
    // Write locking
    'LOCK_TIMEOUT', // Write lock acquisition timed out (concurrent write contention)
  ])
  .describe(
    'Structured error code for tool call failures. ' +
      'PERMISSION_DENIED: credentials expired — call sheets_auth.login. ' +
      'QUOTA_EXCEEDED: rate-limited — wait 60s and retry. ' +
      'INVALID_PARAMS: check required fields and A1 range format. ' +
      'SHEET_NOT_FOUND: call sheets_core.list_sheets to verify names. ' +
      'AUTHENTICATION_REQUIRED: no active session — call sheets_auth.login first.'
  );

export const ErrorCodes = ErrorCodeSchema.enum;

export const ErrorCodeFamilySchema = z.enum([
  'protocol',
  'validation',
  'authentication',
  'authorization',
  'quota',
  'not_found',
  'conflict',
  'precondition',
  'transport',
  'service',
  'feature',
  'session',
  'data',
  'unknown',
]);

// ============================================================================
// COMPOSITE SCHEMAS
// ============================================================================

/** Border specification */
export const BorderSchema = z.object({
  style: BorderStyleSchema,
  color: ColorSchema.optional(),
});

/** Text format */
export const TextFormatSchema = z.object({
  foregroundColor: ColorSchema.optional(),
  foregroundColorStyle: ColorStyleSchema.optional().describe(
    'Text color as ColorStyle (preferred over foregroundColor; supports theme colors)'
  ),
  fontFamily: z.string().optional(),
  fontSize: z.number().positive().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
});

/**
 * Infer number format type from pattern string
 * Fix 2.1: Accept string shorthand for numberFormat
 */
function inferNumberFormatType(pattern: string): {
  type?: string;
  pattern: string;
} {
  if (pattern.includes('%')) {
    return { type: 'PERCENT', pattern };
  }
  if (
    pattern.includes('$') ||
    pattern.includes('€') ||
    pattern.includes('£') ||
    pattern.includes('¥')
  ) {
    return { type: 'CURRENCY', pattern };
  }
  if (pattern.match(/[dmy]/i) || pattern.includes('/')) {
    return { type: 'DATE', pattern };
  }
  if (pattern.match(/[hms]/i) || pattern.includes(':')) {
    return { type: 'TIME', pattern };
  }
  if (pattern.includes('#') || pattern.includes('0') || pattern.includes(',')) {
    return { type: 'NUMBER', pattern };
  }
  return { type: 'TEXT', pattern };
}

/** Number format - accepts string pattern or object with type and pattern */
export const NumberFormatSchema = z
  .preprocess(
    (val) => {
      // Fix 2.1: Auto-convert string pattern to object
      if (typeof val === 'string') {
        return inferNumberFormatType(val);
      }
      // Fix QA-1.1: Auto-infer type when object has pattern but no type
      // Google Sheets API requires numberFormat.type alongside pattern
      if (val && typeof val === 'object') {
        const obj = val as Record<string, unknown>;
        if (
          'pattern' in obj &&
          typeof obj['pattern'] === 'string' &&
          !('type' in obj && obj['type'])
        ) {
          const inferred = inferNumberFormatType(obj['pattern'] as string);
          return { ...obj, type: inferred.type };
        }
      }
      return val;
    },
    z.object({
      type: z
        .enum(['TEXT', 'NUMBER', 'PERCENT', 'CURRENCY', 'DATE', 'TIME', 'DATE_TIME', 'SCIENTIFIC'])
        .optional(),
      pattern: z.string().optional(),
    })
  )
  .describe(
    'Number format: string pattern like "MMM d, yyyy" or "0.0%" (auto-infers type), or object {type, pattern}'
  );

/** Cell format */
export const CellFormatSchema = z.object({
  backgroundColor: ColorSchema.optional(),
  backgroundColorStyle: ColorStyleSchema.optional().describe(
    'Background color as ColorStyle (preferred over backgroundColor; supports theme colors)'
  ),
  textFormat: TextFormatSchema.optional(),
  horizontalAlignment: HorizontalAlignSchema.optional(),
  verticalAlignment: VerticalAlignSchema.optional(),
  wrapStrategy: WrapStrategySchema.optional(),
  numberFormat: NumberFormatSchema.optional(),
  borders: z
    .object({
      top: BorderSchema.optional(),
      bottom: BorderSchema.optional(),
      left: BorderSchema.optional(),
      right: BorderSchema.optional(),
    })
    .optional(),
  textRotation: z
    .union([
      z.object({ angle: z.number().int().min(-90).max(90) }),
      z.object({ vertical: z.boolean() }),
    ])
    .optional()
    .describe('Text rotation: { angle: -90..90 } or { vertical: true }'),
  padding: z
    .object({
      top: z.number().int().min(0).optional(),
      right: z.number().int().min(0).optional(),
      bottom: z.number().int().min(0).optional(),
      left: z.number().int().min(0).optional(),
    })
    .optional()
    .describe('Cell padding in pixels (top, right, bottom, left)'),
});

/** Grid range (numeric coordinates) */
export const GridRangeSchema = z
  .object({
    sheetId: SheetIdSchema,
    startRowIndex: z.number().int().min(0).optional(),
    endRowIndex: z.number().int().min(0).optional(),
    startColumnIndex: z.number().int().min(0).optional(),
    endColumnIndex: z.number().int().min(0).optional(),
  })
  .superRefine((val, ctx) => {
    if (
      val.startRowIndex !== undefined &&
      val.endRowIndex !== undefined &&
      val.startRowIndex >= val.endRowIndex
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'startRowIndex must be less than endRowIndex',
        path: ['startRowIndex'],
      });
    }
    if (
      val.startColumnIndex !== undefined &&
      val.endColumnIndex !== undefined &&
      val.startColumnIndex >= val.endColumnIndex
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'startColumnIndex must be less than endColumnIndex',
        path: ['startColumnIndex'],
      });
    }
  });

/** Developer metadata lookup */
export const DeveloperMetadataLookupSchema = z.object({
  metadataId: z.coerce.number().int().optional(),
  metadataKey: z.string().optional(),
  metadataValue: z.string().optional(),
  locationType: z
    .enum(['DEVELOPER_METADATA_LOCATION_TYPE_UNSPECIFIED', 'ROW', 'COLUMN', 'SHEET', 'SPREADSHEET'])
    .optional(),
  locationMatchingStrategy: z
    .enum([
      'DEVELOPER_METADATA_LOCATION_MATCHING_STRATEGY_UNSPECIFIED',
      'EXACT_LOCATION',
      'INTERSECTING_LOCATION',
    ])
    .optional(),
  visibility: z
    .enum(['DEVELOPER_METADATA_VISIBILITY_UNSPECIFIED', 'DOCUMENT', 'PROJECT'])
    .optional(),
});

/** Data filter for advanced range selection */
export const DataFilterSchema = z
  .object({
    a1Range: z.string().optional(),
    gridRange: GridRangeSchema.optional(),
    developerMetadataLookup: DeveloperMetadataLookupSchema.optional(),
  })
  .refine((val) => val.a1Range || val.gridRange || val.developerMetadataLookup, {
    message: 'DataFilter must include a1Range, gridRange, or developerMetadataLookup',
  });

/** Condition for rules - accepts flexible value formats */
export const ConditionSchema = z
  .object({
    type: ConditionTypeSchema,
    values: z
      .preprocess((val) => {
        // Undefined/null - return undefined
        if (val === undefined || val === null) return undefined;

        // Helper to extract string value from various formats
        const extractValue = (v: unknown): string => {
          if (v === null || v === undefined) return '';
          // Handle Google Sheets API format: { userEnteredValue: "..." }
          if (typeof v === 'object' && v !== null && 'userEnteredValue' in v) {
            return String((v as { userEnteredValue: unknown }).userEnteredValue ?? '');
          }
          return String(v);
        };

        // Already an array - convert elements to strings
        if (Array.isArray(val)) {
          return val.map(extractValue);
        }
        // Single value - wrap in array
        return [extractValue(val)];
      }, z.array(z.string()).optional())
      .describe('Condition values (single value or array, automatically converted to strings)'),
  })
  .superRefine((data, ctx) => {
    const { type, values } = data;
    // BETWEEN/NOT_BETWEEN conditions require exactly 2 boundary values
    const betweenTypes = [
      'NUMBER_BETWEEN',
      'NUMBER_NOT_BETWEEN',
      'DATE_BETWEEN',
      'DATE_NOT_BETWEEN',
    ] as const;
    if (betweenTypes.includes(type as (typeof betweenTypes)[number])) {
      if (!values || values.length !== 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${type} condition requires exactly 2 values (lower bound and upper bound)`,
          path: ['values'],
        });
      }
    }
    // BLANK/NOT_BLANK conditions require no values
    if (type === 'BLANK' || type === 'NOT_BLANK') {
      if (values && values.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${type} condition must have no values`,
          path: ['values'],
        });
      }
    }
    // CUSTOM_FORMULA requires a formula starting with '='
    if (type === 'CUSTOM_FORMULA') {
      if (!values || values.length === 0 || !values[0]?.startsWith('=')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'CUSTOM_FORMULA condition requires a formula value starting with "="',
          path: ['values'],
        });
      }
    }
  });

/** Convert column index to letter (0 = A, 1 = B, 25 = Z, 26 = AA) */
const indexToColumnLetter = (index: number): string => {
  let letter = '';
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
};

/** Chart position */
export const ChartPositionSchema = z
  .preprocess(
    (val) => {
      if (typeof val !== 'object' || val === null) return val;
      const pos = val as Record<string, unknown>;

      // Handle Google API format: { overlayPosition: { anchorCell: { sheetId, rowIndex, columnIndex } } }
      const overlayPos = pos['overlayPosition'] as Record<string, unknown> | undefined;
      if (overlayPos && typeof overlayPos === 'object') {
        const anchor = overlayPos['anchorCell'] as Record<string, unknown> | undefined;
        if (
          anchor &&
          typeof anchor === 'object' &&
          'rowIndex' in anchor &&
          'columnIndex' in anchor
        ) {
          const rowIndex = Number(anchor['rowIndex']) || 0;
          const colIndex = Number(anchor['columnIndex']) || 0;
          // Convert to A1 notation (e.g., "E1" for col=4, row=0)
          const cellRef = `${indexToColumnLetter(colIndex)}${rowIndex + 1}`;
          return {
            anchorCell: cellRef,
            offsetX: Number((overlayPos['offsetXPixels'] as number) ?? pos['offsetX'] ?? 0),
            offsetY: Number((overlayPos['offsetYPixels'] as number) ?? pos['offsetY'] ?? 0),
            width: Number((overlayPos['widthPixels'] as number) ?? pos['width'] ?? 600),
            height: Number((overlayPos['heightPixels'] as number) ?? pos['height'] ?? 400),
          };
        }
      }

      // Handle anchorCell as object: { anchorCell: { sheetId, rowIndex, columnIndex } }
      const anchorCell = pos['anchorCell'];
      if (typeof anchorCell === 'object' && anchorCell !== null) {
        const anchor = anchorCell as Record<string, unknown>;
        if ('rowIndex' in anchor && 'columnIndex' in anchor) {
          const rowIndex = Number(anchor['rowIndex']) || 0;
          const colIndex = Number(anchor['columnIndex']) || 0;
          const cellRef = `${indexToColumnLetter(colIndex)}${rowIndex + 1}`;
          // Extract sheetId from the anchor object if not already at top level
          const sheetId =
            pos['sheetId'] !== undefined
              ? pos['sheetId']
              : anchor['sheetId'] !== undefined
                ? anchor['sheetId']
                : undefined;
          return { ...pos, anchorCell: cellRef, ...(sheetId !== undefined ? { sheetId } : {}) };
        }
      }

      return val;
    },
    z.object({
      anchorCell: z.string(),
      sheetId: z.coerce.number().int().optional().describe('Sheet ID for the chart position'),
      offsetX: z.coerce.number().optional().default(0),
      offsetY: z.coerce.number().optional().default(0),
      width: z.coerce.number().optional().default(600),
      height: z.coerce.number().optional().default(400),
    })
  )
  .describe(
    'Chart position. Use "Sheet1!E1" when you know the sheet name, or use "E1" together with position.sheetId.'
  );

/** Sort specification */
export const SortSpecSchema = z.object({
  columnIndex: z.number().int().min(0),
  ascending: z.boolean().optional().default(true),
});

// ============================================================================
// SAFETY RAILS
// ============================================================================

/** Effect scope limits */
export const EffectScopeSchema = z.object({
  maxCellsAffected: z.number().int().positive().optional().default(50000),
  maxRowsAffected: z.number().int().positive().optional(),
  maxColumnsAffected: z.number().int().positive().optional(),
  requireExplicitRange: z.boolean().optional().default(false),
});

/** Expected state for optimistic locking */
export const ExpectedStateSchema = z.object({
  version: z.string().optional().describe('Specific version to validate'),
  rowCount: z.number().int().min(0).optional().describe('Expected total row count'),
  columnCount: z.number().int().min(0).optional().describe('Expected total column count'),
  sheetTitle: z.string().optional().describe('Sheet title that must exist'),
  checksum: z.string().optional().describe('MD5 hash of range values to verify'),
  checksumRange: z
    .string()
    .optional()
    .describe('A1 range for checksum calculation (default: A1:J10)'),
  firstRowValues: z.array(z.string()).optional().describe('Expected header values in first row'),
});

/** Safety options for destructive actions */
export const SafetyOptionsSchema = z.object({
  dryRun: z.boolean().optional().default(false),
  expectedState: ExpectedStateSchema.optional(),
  transactionId: z.string().uuid().optional(),
  autoSnapshot: z.boolean().optional().default(true),
  effectScope: EffectScopeSchema.optional(),
  // ISSUE-214: Formula injection guard for write/append
  sanitizeFormulas: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'When true, reject cell values containing dangerous data-exfiltration formulas (IMPORTDATA, IMPORTRANGE, IMPORTFEED, IMPORTHTML, IMPORTXML, GOOGLEFINANCE, QUERY). Returns FORMULA_INJECTION_BLOCKED error if detected.'
    ),
});

// ============================================================================
// DIFF ENGINE
// ============================================================================

export const DiffTierSchema = z.enum(['METADATA', 'SAMPLE', 'FULL']).default('METADATA');

export const DiffOptionsSchema = z.object({
  tier: DiffTierSchema.optional(),
  sampleSize: z.number().int().positive().optional().default(10),
  maxFullDiffCells: z.number().int().positive().optional().default(5000),
});

export const CellChangeSchema = z.object({
  cell: z.string(),
  before: CellValueSchema.optional(),
  after: CellValueSchema.optional(),
  type: z.enum(['value', 'format', 'formula', 'note']),
});

export const MetadataDiffSchema = z.object({
  tier: z.literal('METADATA'),
  before: z.object({
    timestamp: z.string(),
    rowCount: z.number().int(),
    columnCount: z.number().int(),
    checksum: z.string(),
  }),
  after: z.object({
    timestamp: z.string(),
    rowCount: z.number().int(),
    columnCount: z.number().int(),
    checksum: z.string(),
  }),
  summary: z.object({
    rowsChanged: z.number().int(),
    estimatedCellsChanged: z.number().int(),
  }),
  sheetChanges: z
    .object({
      sheetsAdded: z.array(z.object({ sheetId: z.number(), title: z.string() })),
      sheetsRemoved: z.array(z.object({ sheetId: z.number(), title: z.string() })),
      sheetsRenamed: z.array(
        z.object({ sheetId: z.number(), oldTitle: z.string(), newTitle: z.string() })
      ),
    })
    .optional(),
});

export const SampleDiffSchema = z.object({
  tier: z.literal('SAMPLE'),
  samples: z.object({
    firstRows: z.array(CellChangeSchema),
    lastRows: z.array(CellChangeSchema),
    randomRows: z.array(CellChangeSchema),
  }),
  summary: z.object({
    rowsChanged: z.number().int(),
    cellsSampled: z.number().int(),
  }),
  sheetChanges: z
    .object({
      sheetsAdded: z.array(z.object({ sheetId: z.number(), title: z.string() })),
      sheetsRemoved: z.array(z.object({ sheetId: z.number(), title: z.string() })),
      sheetsRenamed: z.array(
        z.object({ sheetId: z.number(), oldTitle: z.string(), newTitle: z.string() })
      ),
    })
    .optional(),
});

export const FullDiffSchema = z.object({
  tier: z.literal('FULL'),
  changes: z.array(CellChangeSchema),
  summary: z.object({
    cellsChanged: z.number().int(),
    cellsAdded: z.number().int(),
    cellsRemoved: z.number().int(),
  }),
  sheetChanges: z
    .object({
      sheetsAdded: z.array(z.object({ sheetId: z.number(), title: z.string() })),
      sheetsRemoved: z.array(z.object({ sheetId: z.number(), title: z.string() })),
      sheetsRenamed: z.array(
        z.object({ sheetId: z.number(), oldTitle: z.string(), newTitle: z.string() })
      ),
    })
    .optional(),
});

/**
 * Sheet-level changes for webhook event categorization
 * (Phase 4.2A - Fine-Grained Event Filtering)
 */
export const SheetLevelChangesSchema = z.object({
  sheetsAdded: z.array(z.object({ sheetId: z.number(), title: z.string() })),
  sheetsRemoved: z.array(z.object({ sheetId: z.number(), title: z.string() })),
  sheetsRenamed: z.array(
    z.object({ sheetId: z.number(), oldTitle: z.string(), newTitle: z.string() })
  ),
});

export const DiffResultSchema = z.discriminatedUnion('tier', [
  MetadataDiffSchema,
  SampleDiffSchema,
  FullDiffSchema,
]);

// ============================================================================
// RANGE RESOLVER
// ============================================================================

export const ResolutionMethodSchema = z.enum([
  'a1_direct',
  'named_range',
  'semantic_header',
  'semantic_search',
]);

export const ResolvedRangeSchema = z.object({
  sheetId: SheetIdSchema,
  sheetName: z.string(),
  a1Notation: z.string(),
  gridRange: GridRangeSchema,
  resolution: z.object({
    method: ResolutionMethodSchema,
    confidence: z.number().min(0).max(1),
    path: z.string(),
    alternatives: z
      .array(
        z.object({
          a1Notation: z.string(),
          reason: z.string(),
        })
      )
      .optional(),
  }),
});

export const SemanticRangeQuerySchema = z.object({
  sheet: z.string(),
  column: z.string(),
  includeHeader: z.boolean().optional().default(false),
  rowStart: z.number().int().min(1).optional(),
  rowEnd: z.number().int().min(1).optional(),
});

/**
 * Range input schema that accepts:
 * - Plain string (A1 notation) - transformed to { a1: string }
 * - Object with a1 key: { a1: "Sheet1!A1:B10" }
 * - Object with namedRange key: { namedRange: "MyRange" }
 * - Object with semantic key: { semantic: { sheet: "Sheet1", column: "Name" } }
 * - Object with grid key: { grid: { sheetId, startRowIndex, ... } }
 */
export const RangeInputSchema = z.preprocess(
  (val) => {
    // Transform plain strings to { a1: string } format
    if (typeof val === 'string') {
      return { a1: val };
    }
    return val;
  },
  z.union([
    z.object({ a1: A1NotationSchema }),
    z.object({ namedRange: z.string() }),
    z.object({ semantic: SemanticRangeQuerySchema }),
    z.object({ grid: GridRangeSchema }),
  ])
);

// ============================================================================
// RESPONSE SCHEMAS
// ============================================================================

/** Error detail */
export const ErrorDetailSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.any()]))
    .optional()
    .describe('Error details as key-value pairs with primitive or generic values'),
  retryable: z.boolean().optional().default(false),
  retryAfterMs: z.number().int().positive().optional(),
  suggestedFix: z.string().optional(),
  // BUG-8 fix: fixableVia is auto-injected by error-fix-suggester in BaseHandler.mapError()
  // as a structured object. Previously missing from schema, causing output validation failures.
  fixableVia: z
    .object({
      tool: z.string().describe('Tool name to fix the issue'),
      action: z.string().describe('Action name to fix the issue'),
      params: z
        .record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.array(z.any()),
            z.record(z.string(), z.any()),
            z.null(),
          ])
        )
        .optional()
        .describe('Suggested parameters for the fix action'),
    })
    .optional()
    .describe('Structured fix suggestion with tool/action to resolve the error'),
  alternatives: z
    .array(
      z.object({
        tool: z.string().describe('Tool name as alternative'),
        action: z.string().describe('Action name in the alternative tool'),
        description: z.string().describe('Description of the alternative approach'),
      })
    )
    .optional()
    .describe('Alternative tools/actions to try'),
  // Agent-actionable fields
  resolution: z.string().optional().describe('Recommended resolution strategy'),
  resolutionSteps: z
    .array(z.string())
    .optional()
    .describe('Step-by-step instructions to resolve the error'),
  category: z
    .enum(['client', 'server', 'network', 'auth', 'quota', 'transient', 'unknown'])
    .optional()
    .describe('Error category for routing/handling'),
  severity: z
    .enum(['low', 'medium', 'high', 'critical'])
    .optional()
    .describe('Error severity level'),
  retryStrategy: z
    .enum(['exponential_backoff', 'wait_for_reset', 'manual', 'reauthorize', 'none'])
    .optional()
    .describe('Recommended retry strategy'),
  suggestedTools: z
    .array(z.string())
    .optional()
    .describe('Tools that might help resolve this error'),
  // Quick Win #2: Resource links for error guidance
  resources: z
    .array(
      z.object({
        uri: z.string(),
        description: z.string(),
      })
    )
    .optional()
    .describe(
      'Resource URIs for error guidance (e.g., servalsheets://decisions/find-sheet, servalsheets://reference/authentication)'
    ),
});

/** Mutation summary */
export const MutationSummarySchema = z.object({
  cellsAffected: z.number().int(),
  rowsAffected: z.number().int().optional(),
  columnsAffected: z.number().int().optional(),
  diff: DiffResultSchema.optional(),
  reversible: z.boolean(),
  revertSnapshotId: z.string().optional(),
});

/** Sheet info */
export const SheetInfoSchema = z.object({
  sheetId: z.number().int(),
  title: z.string(),
  // BUG-1 fix: Google API may not return index for all sheet types.
  // Made optional with default 0 to prevent output validation failures.
  index: z.number().int().optional().default(0),
  rowCount: z.number().int(),
  columnCount: z.number().int(),
  hidden: z.boolean().optional().default(false),
  tabColor: ColorSchema.optional(),
  tabColorStyle: ColorStyleSchema.optional().describe(
    'Tab color as RGB or theme color (Google Sheets API v4 ColorStyle)'
  ),
});

/** Spreadsheet info */
export const SpreadsheetInfoSchema = z.object({
  spreadsheetId: z.string(),
  title: z.string(),
  url: z.string().optional(),
  locale: z.string().optional(),
  timeZone: z.string().optional(),
  sheets: z.array(SheetInfoSchema).optional(),
  // Additional metadata for list operations
  createdTime: z.string().optional(),
  modifiedTime: z.string().optional(),
  owners: z
    .array(
      z.object({
        email: z.string().optional(),
        displayName: z.string().optional(),
      })
    )
    .optional(),
  lastModifiedBy: z.string().optional(),
});

// ============================================================================
// RESPONSE METADATA (Quick Win: Enhanced tool responses)
// ============================================================================

/** Tool suggestion for follow-up or optimization */
export const ToolSuggestionSchema = z.object({
  type: z.enum(['optimization', 'alternative', 'follow_up', 'warning', 'related']),
  message: z.string(),
  tool: z.string().optional(),
  action: z.string().optional(),
  reason: z.string(),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
});

/** Cost estimation for the operation */
export const CostEstimateSchema = z.object({
  apiCalls: z.number().int().min(0),
  estimatedLatencyMs: z.number().min(0),
  cellsAffected: z.number().int().min(0).optional(),
  quotaImpact: z
    .object({
      current: z.number().int().min(0),
      limit: z.number().int().min(0),
      remaining: z.number().int().min(0),
    })
    .optional(),
});

/** Quota status with prediction and recommendations */
export const QuotaStatusSchema = z.object({
  current: z.number().int().min(0),
  limit: z.number().int().min(0),
  remaining: z.number().int().min(0),
  resetIn: z.string(),
  burnRate: z.number().min(0),
  projection: z
    .object({
      willExceedIn: z.string(),
      confidence: z.number().min(0).max(1),
    })
    .optional(),
  recommendation: z
    .object({
      action: z.string(),
      reason: z.string(),
      savings: z.string(),
    })
    .optional(),
});

/** Response metadata with suggestions and cost info */
export const ResponseMetaSchema = z.object({
  suggestions: z
    .array(ToolSuggestionSchema)
    .optional()
    .describe('Follow-up tool suggestions and optimizations'),
  costEstimate: CostEstimateSchema.optional().describe('API call cost estimate'),
  relatedTools: z.array(z.string()).optional().describe('Related tools that might be useful'),
  documentation: z
    .string()
    .regex(URL_REGEX, 'Invalid URL format')
    .optional()
    .describe('URL to relevant documentation'),
  journeyStage: z
    .enum([
      'onboarding',
      'readiness',
      'authentication',
      'connector_setup',
      'first_success',
      'mutation',
      'recovery',
    ])
    .optional()
    .describe('User journey stage this response belongs to'),
  nextBestAction: z
    .string()
    .optional()
    .describe('Single next action that will make the most progress for the user'),
  verificationSummary: z
    .string()
    .optional()
    .describe('Short verification summary describing what was checked or confirmed'),
  nextSteps: z.array(z.string()).optional().describe('Recommended next steps'),
  warnings: z.array(z.string()).optional().describe('Safety warnings or considerations'),
  snapshot: z
    .object({
      snapshotId: z.string().describe('Unique snapshot identifier'),
      timestamp: z.string().describe('ISO 8601 timestamp of snapshot creation'),
      description: z.string().optional().describe('Human-readable snapshot description'),
      metadata: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .optional()
        .describe('Additional snapshot metadata'),
    })
    .optional()
    .describe('Snapshot info for undo/rollback'),
  quotaStatus: QuotaStatusSchema.optional().describe('Predictive quota management'),
  summary: z
    .object({
      total: z.number().int().describe('Total item count'),
      byStatus: z
        .record(z.string(), z.number().int())
        .optional()
        .describe('Counts grouped by status'),
    })
    .optional()
    .describe('Summary statistics for list-type responses'),
  pagination: z
    .object({
      hasMore: z.boolean().describe('True when additional pages are available'),
      nextCursor: z
        .string()
        .optional()
        .describe('Opaque cursor/page token to request the next page'),
      totalCount: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Total number of matching records when known'),
      count: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Number of records returned in the current page'),
      offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Offset used for this page when offset-based pagination is used'),
      limit: z.number().int().positive().optional().describe('Page size used for this response'),
    })
    .optional()
    .describe('Standardized pagination metadata envelope'),
  collection: z
    .object({
      itemsField: z
        .string()
        .min(1)
        .describe('Field name on response containing the current page item array'),
      count: z
        .number()
        .int()
        .nonnegative()
        .describe('Number of items in the current response page'),
      totalCount: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Total matching item count when known'),
      hasMore: z.boolean().optional().describe('True when more pages are available'),
      nextCursor: z.string().optional().describe('Cursor/token for the next page'),
      offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Offset used for this page when offset-based paging applies'),
      limit: z.number().int().positive().optional().describe('Page size used for this response'),
    })
    .optional()
    .describe('Standardized list envelope metadata'),
  // ISSUE-107: Protocol version surfacing + deprecation guidance
  protocolVersion: z
    .string()
    .optional()
    .describe('MCP protocol version this server implements (e.g. "2025-11-25")'),
  deprecationWarning: z
    .string()
    .optional()
    .describe(
      'Present when the client used a legacy invocation pattern. Contains migration guidance.'
    ),
  errorCode: ErrorCodeSchema.optional().describe(
    'Original error code reported by the handler when success=false'
  ),
  errorCodeCanonical: ErrorCodeSchema.optional().describe(
    'Compatibility canonical error code used for taxonomy consolidation'
  ),
  errorCodeFamily: ErrorCodeFamilySchema.optional().describe(
    'Coarse error-code family for analytics and migration-safe client handling'
  ),
  errorCodeIsAlias: z
    .boolean()
    .optional()
    .describe('True when errorCode differs from errorCodeCanonical'),
  truncated: z
    .boolean()
    .optional()
    .describe('True when response payload was truncated and full data is available elsewhere'),
  originalSizeBytes: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Original serialized response size before truncation'),
  deliveredSizeBytes: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Serialized size of the delivered truncated payload'),
  retrievalUri: z
    .string()
    .optional()
    .describe('Resource URI for retrieving full non-truncated payload'),
  continuationHint: z
    .string()
    .optional()
    .describe('Machine-readable hint describing how to continue retrieval'),
});

// ============================================================================
// TOOL TYPES
// ============================================================================

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolExecution {
  taskSupport?: 'forbidden' | 'optional' | 'required';
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type Color = z.infer<typeof ColorSchema>;
export type ThemeColorType = z.infer<typeof ThemeColorTypeSchema>;
export type ColorStyle = z.infer<typeof ColorStyleSchema>;
export type CellValue = z.infer<typeof CellValueSchema>;
export type ValuesArray = z.infer<typeof ValuesArraySchema>;
export type GridRange = z.infer<typeof GridRangeSchema>;
export type DeveloperMetadataLookup = z.infer<typeof DeveloperMetadataLookupSchema>;
export type DataFilter = z.infer<typeof DataFilterSchema>;
export type CellFormat = z.infer<typeof CellFormatSchema>;
export type SafetyOptions = z.infer<typeof SafetyOptionsSchema>;
export type EffectScope = z.infer<typeof EffectScopeSchema>;
export type ExpectedState = z.infer<typeof ExpectedStateSchema>;
export type DiffResult = z.infer<typeof DiffResultSchema>;
export type DiffOptions = z.infer<typeof DiffOptionsSchema>;
export type RangeInput = z.infer<typeof RangeInputSchema>;
export type ResolvedRange = z.infer<typeof ResolvedRangeSchema>;
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;
export type MutationSummary = z.infer<typeof MutationSummarySchema>;
export type SheetInfo = z.infer<typeof SheetInfoSchema>;
export type SpreadsheetInfo = z.infer<typeof SpreadsheetInfoSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type ToolSuggestion = z.infer<typeof ToolSuggestionSchema>;
export type CostEstimate = z.infer<typeof CostEstimateSchema>;
export type ResponseMeta = z.infer<typeof ResponseMetaSchema>;

// ============================================================================
// ANALYSIS OPTIMIZATION: NEXT ACTIONS (LLM Guidance)
// MCP Protocol: 2025-11-25
// Google Sheets API Best Practice: Executable params ready for immediate use
// ============================================================================

/**
 * Risk level for executable actions
 * Aligns with Google Sheets API write operation classifications
 */
export const ActionRiskLevelSchema = z
  .enum(['none', 'low', 'medium', 'high'])
  .describe(
    'Risk level: none (read-only), low (easily reversible), medium (requires confirmation), high (destructive/irreversible)'
  );

/**
 * Action category for grouping related actions
 */
export const ActionCategorySchema = z
  .enum(['fix', 'optimize', 'visualize', 'format', 'structure', 'analyze', 'other'])
  .describe('Category for grouping related actions');

/**
 * Executable Action - Ready to call another tool
 *
 * DESIGN PRINCIPLE: Every action must have complete params ready to execute.
 * LLMs should be able to call the tool directly without modification.
 *
 * @example
 * ```typescript
 * // LLM receives this in response.next.recommended:
 * {
 *   tool: "sheets_fix",
 *   action: "fix",
 *   params: { spreadsheetId: "abc123", issues: [...] }
 * }
 * // LLM can immediately call: sheets_fix with these params
 * ```
 */
export const ExecutableActionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .describe('Unique action ID for reference (e.g., "fix-empty-headers-1")'),
  priority: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe('Priority: 1=highest (critical), 10=lowest (nice-to-have)'),

  // Execution details - REQUIRED for LLM to execute
  tool: z
    .string()
    .min(1)
    .describe('Tool name (e.g., "sheets_fix", "sheets_data", "sheets_format")'),
  action: z.string().min(1).describe('Action name within the tool'),
  params: z
    .object({
      spreadsheetId: z
        .string()
        .min(1)
        .describe('Target spreadsheet ID (required for action routing)'),
    })
    .catchall(
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.any()),
        z.record(z.string(), z.any()),
      ])
    )
    .describe(
      'Complete parameters ready to execute - spreadsheetId is required; all other values must be concrete (strings, numbers, booleans, arrays, or objects)'
    ),

  // Human-readable context
  title: z.string().max(80).describe('Short action title for display'),
  description: z.string().max(300).describe('What this action does'),

  // Impact assessment (helps LLM decide priority)
  impact: z
    .object({
      metric: z
        .string()
        .describe('What metric improves (e.g., "qualityScore", "performanceScore")'),
      before: z.union([z.number(), z.string()]).optional().describe('Current value'),
      after: z.union([z.number(), z.string()]).optional().describe('Expected value after action'),
      change: z.string().describe('Human-readable change (e.g., "+15%", "fixes 23 issues")'),
    })
    .optional()
    .describe('Estimated impact of this action'),

  // Risk assessment (helps LLM decide if confirmation needed)
  risk: ActionRiskLevelSchema,
  reversible: z.boolean().describe('Can this action be undone?'),
  requiresConfirmation: z
    .boolean()
    .describe('Should LLM ask user before executing? (true for medium/high risk)'),

  // Grouping
  category: ActionCategorySchema,
  relatedFindings: z
    .array(z.string())
    .max(10)
    .optional()
    .describe('IDs of related findings/issues this action addresses'),

  // Reasoning transparency (helps Claude understand WHY and WHEN)
  reasoning: z
    .object({
      why: z.string().describe('Why this action is recommended'),
      impact: z
        .object({
          quotaSavings: z
            .string()
            .optional()
            .describe('API quota savings (e.g., "90% fewer calls")'),
          latencySavings: z
            .string()
            .optional()
            .describe('Performance improvement (e.g., "3x faster")'),
          qualityImprovement: z
            .string()
            .optional()
            .describe('Quality improvement (e.g., "+15% data quality score")'),
        })
        .optional()
        .describe('Expected impact metrics'),
      tradeoffs: z
        .object({
          pros: z.array(z.string()).describe('Benefits of this approach'),
          cons: z.array(z.string()).describe('Drawbacks or limitations'),
        })
        .optional()
        .describe('Pros and cons of this action'),
      alternatives: z
        .array(
          z.object({
            action: z.string().describe('Alternative approach'),
            when: z.string().describe('When to use this alternative'),
            benefit: z.string().describe('Why you might prefer this alternative'),
          })
        )
        .optional()
        .describe('Alternative actions to consider'),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe('Confidence level in this recommendation (0-1)'),
      basedOn: z
        .array(z.string())
        .optional()
        .describe('What evidence this recommendation is based on'),
    })
    .optional()
    .describe('Reasoning transparency - helps Claude make informed decisions'),
});

/**
 * Drill Down Option - Area that warrants deeper analysis
 *
 * Returned when analysis finds something interesting that could be explored further.
 * LLM can use these params to call sheets_analyze:drill_down.
 */
export const DrillDownOptionSchema = z.object({
  target: z.string().describe('What to drill into (e.g., "Sheet1", "Column B", "issue-123")'),
  type: z
    .enum(['issue', 'sheet', 'column', 'formula', 'anomaly', 'pattern', 'correlation'])
    .describe('Type of target'),
  reason: z.string().max(200).describe('Why this is interesting/worth exploring'),
  severity: z
    .enum(['info', 'warning', 'critical'])
    .optional()
    .describe('Severity if this is a potential problem'),
  params: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.any()),
        z.record(z.string(), z.any()),
      ])
    )
    .describe('Ready-to-use params for sheets_analyze:drill_down action with concrete values'),
});

/**
 * Clarification Request - Question for user when analysis is ambiguous
 */
export const ClarificationRequestSchema = z.object({
  question: z.string().describe('Question to ask the user'),
  context: z.string().optional().describe('Why we need this clarification'),
  options: z.array(z.string()).max(5).optional().describe('Suggested options if applicable'),
  default: z.string().optional().describe('Default value if user skips'),
});

/**
 * Next Actions - What should happen next
 *
 * CRITICAL: Every analysis response MUST include this.
 * This is the primary guidance mechanism for LLMs.
 *
 * @example
 * ```typescript
 * // In response:
 * next: {
 *   recommended: { tool: "sheets_fix", action: "fix", params: {...} },
 *   alternatives: [...],
 *   drillDown: [{ target: "Sheet2", type: "sheet", reason: "Low quality score" }]
 * }
 * ```
 */
export const NextActionsSchema = z.object({
  recommended: ExecutableActionSchema.nullable().describe(
    'Single best next action. null if nothing to do (all good!)'
  ),
  alternatives: z
    .array(ExecutableActionSchema)
    .max(5)
    .describe('Other good options, prioritized by impact'),
  drillDown: z
    .array(DrillDownOptionSchema)
    .max(5)
    .optional()
    .describe('Areas to explore deeper with sheets_analyze:drill_down'),
  clarifications: z
    .array(ClarificationRequestSchema)
    .max(3)
    .optional()
    .describe('Questions for user if analysis needs more context'),
});

/**
 * Analysis Summary - Quick overview for LLM context efficiency
 *
 * Kept under 100 tokens to minimize context usage in multi-turn conversations.
 */
export const AnalysisSummarySchema = z.object({
  headline: z
    .string()
    .max(100)
    .describe('One-line summary (e.g., "12 quality issues found, 3 critical")'),
  status: z
    .enum(['healthy', 'warning', 'critical'])
    .describe(
      'Overall status: healthy (no action needed), warning (issues found), critical (urgent)'
    ),
  keyMetrics: z
    .record(z.string(), z.union([z.number(), z.string()]))
    .describe('Key metrics map (e.g., { issues: 12, qualityScore: 67, sheets: 3 })'),
});

/**
 * Analysis Session - For multi-step workflows
 */
export const AnalysisSessionSchema = z.object({
  analysisId: z.string().describe('Unique ID to reference this analysis result'),
  canResume: z.boolean().describe('Can this analysis be continued with more detail?'),
  expiresAt: z.number().optional().describe('Unix timestamp when cached results expire'),
  step: z.number().int().min(1).optional().describe('Current step in multi-step workflow'),
  totalSteps: z.number().int().min(1).optional().describe('Total steps in workflow'),
});

// Type exports for analysis optimization
export type ExecutableAction = z.infer<typeof ExecutableActionSchema>;
export type DrillDownOption = z.infer<typeof DrillDownOptionSchema>;
export type ClarificationRequest = z.infer<typeof ClarificationRequestSchema>;
export type NextActions = z.infer<typeof NextActionsSchema>;
export type AnalysisSummary = z.infer<typeof AnalysisSummarySchema>;
export type AnalysisSession = z.infer<typeof AnalysisSessionSchema>;
export type ActionRiskLevel = z.infer<typeof ActionRiskLevelSchema>;
export type ActionCategory = z.infer<typeof ActionCategorySchema>;
