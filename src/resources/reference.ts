/**
 * ServalSheets - Static Reference Resources
 *
 * Provides read-only reference documentation for LLMs:
 * - Color palettes and formatting codes
 * - Common formula patterns
 * - Number format strings
 * - API quotas and limits
 * - Data validation patterns
 *
 * These resources help LLMs understand Google Sheets conventions
 * without needing to make API calls or read external documentation.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NotFoundError } from '../core/errors.js';

/**
 * Register static reference resources
 */
export function registerReferenceResources(server: McpServer): void {
  // Color reference - Google Sheets color system
  server.registerResource(
    'Google Sheets Color Reference',
    'servalsheets://reference/colors',
    {
      description:
        'Color palette and RGB values for cell formatting. Colors use 0-1 scale (not 0-255).',
      mimeType: 'application/json',
    },
    async (uri) => readReferenceResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // Formula patterns - Common formula templates
  server.registerResource(
    'Common Formula Patterns',
    'servalsheets://reference/formulas',
    {
      description:
        'Templates and examples for frequently used Google Sheets formulas (VLOOKUP, SUMIF, etc.).',
      mimeType: 'application/json',
    },
    async (uri) => readReferenceResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // Number formats - Format string reference
  server.registerResource(
    'Number Format Strings',
    'servalsheets://reference/number-formats',
    {
      description:
        'Google Sheets number format patterns for currency, dates, percentages, and custom formats.',
      mimeType: 'text/plain',
    },
    async (uri) => readReferenceResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // API limits - Quotas and restrictions
  server.registerResource(
    'Google Sheets API Limits',
    'servalsheets://reference/api-limits',
    {
      description: 'API quotas, rate limits, and size restrictions for Google Sheets operations.',
      mimeType: 'application/json',
    },
    async (uri) => readReferenceResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // Data validation patterns
  server.registerResource(
    'Data Validation Patterns',
    'servalsheets://reference/validation-patterns',
    {
      description: 'Common validation rules for emails, URLs, phone numbers, and custom patterns.',
      mimeType: 'application/json',
    },
    async (uri) => readReferenceResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // Chart types reference
  server.registerResource(
    'Chart Types and Configuration',
    'servalsheets://reference/chart-types',
    {
      description:
        'Available chart types (line, bar, pie, scatter, etc.) with configuration options.',
      mimeType: 'application/json',
    },
    async (uri) => readReferenceResource(typeof uri === 'string' ? uri : uri.toString())
  );
}

/**
 * Read reference resource content
 */
export async function readReferenceResource(uri: string): Promise<{
  contents: Array<{ uri: string; mimeType?: string; text: string }>;
}> {
  const resourceId = uri.replace('servalsheets://reference/', '');

  switch (resourceId) {
    case 'colors':
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                note: 'Google Sheets uses RGB colors with values 0-1 (not 0-255). Divide by 255 to convert.',
                commonColors: {
                  white: { red: 1, green: 1, blue: 1 },
                  black: { red: 0, green: 0, blue: 0 },
                  red: { red: 1, green: 0, blue: 0 },
                  green: { red: 0, green: 1, blue: 0 },
                  blue: { red: 0, green: 0, blue: 1 },
                  yellow: { red: 1, green: 1, blue: 0 },
                  orange: { red: 1, green: 0.65, blue: 0 },
                  purple: { red: 0.5, green: 0, blue: 0.5 },
                  gray: { red: 0.5, green: 0.5, blue: 0.5 },
                  lightGray: { red: 0.85, green: 0.85, blue: 0.85 },
                },
                googleSheetsPalette: {
                  primary: { red: 0.26, green: 0.52, blue: 0.96 },
                  success: { red: 0.22, green: 0.73, blue: 0.29 },
                  warning: { red: 1, green: 0.76, blue: 0.03 },
                  danger: { red: 0.96, green: 0.26, blue: 0.21 },
                  info: { red: 0.13, green: 0.59, blue: 0.95 },
                },
                conversion: {
                  formula: '(RGB_0_255) / 255 = (RGB_0_1)',
                  example: 'RGB(128, 64, 192) → {red: 0.502, green: 0.251, blue: 0.753}',
                },
              },
              null,
              2
            ),
          },
        ],
      };

    case 'formulas':
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                lookup: {
                  VLOOKUP: {
                    syntax: '=VLOOKUP(search_key, range, index, [is_sorted])',
                    example: '=VLOOKUP(A2, Data!A:D, 3, FALSE)',
                    description:
                      'Look up value in first column, return value from specified column',
                  },
                  INDEX_MATCH: {
                    syntax: '=INDEX(return_range, MATCH(lookup_value, lookup_range, 0))',
                    example: '=INDEX(C:C, MATCH(A2, A:A, 0))',
                    description: 'More flexible alternative to VLOOKUP',
                  },
                },
                conditional: {
                  IF: {
                    syntax: '=IF(condition, value_if_true, value_if_false)',
                    example: '=IF(A2 > 100, "High", "Low")',
                  },
                  IFS: {
                    syntax: '=IFS(condition1, value1, condition2, value2, ...)',
                    example: '=IFS(A2 > 90, "A", A2 > 80, "B", TRUE, "C")',
                  },
                  SUMIF: {
                    syntax: '=SUMIF(range, criterion, [sum_range])',
                    example: '=SUMIF(A:A, ">100", B:B)',
                  },
                  COUNTIF: {
                    syntax: '=COUNTIF(range, criterion)',
                    example: '=COUNTIF(A:A, "Completed")',
                  },
                },
                text: {
                  CONCATENATE: {
                    syntax: '=CONCATENATE(text1, text2, ...)',
                    example: '=CONCATENATE(A2, " ", B2)',
                    alternative: '=A2 & " " & B2',
                  },
                  SPLIT: {
                    syntax: '=SPLIT(text, delimiter, [split_by_each], [remove_empty_text])',
                    example: '=SPLIT(A2, ",")',
                  },
                },
                date: {
                  TODAY: { syntax: '=TODAY()', description: 'Current date' },
                  NOW: {
                    syntax: '=NOW()',
                    description: 'Current date and time',
                  },
                  DATE: {
                    syntax: '=DATE(year, month, day)',
                    example: '=DATE(2024, 1, 15)',
                  },
                },
                array: {
                  ARRAYFORMULA: {
                    syntax: '=ARRAYFORMULA(formula)',
                    example: '=ARRAYFORMULA(A2:A * B2:B)',
                    description: 'Apply formula to entire range at once',
                  },
                  FILTER: {
                    syntax: '=FILTER(range, condition1, [condition2, ...])',
                    example: '=FILTER(A2:D, B2:B > 100)',
                  },
                },
              },
              null,
              2
            ),
          },
        ],
      };

    case 'number-formats':
      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text: `Google Sheets Number Format Patterns

CURRENCY:
$#,##0.00           → $1,234.56
$#,##0.00;($#,##0)  → $1,234.56 or ($1,234.56) for negatives
€#,##0.00           → €1,234.56

PERCENTAGE:
0%                  → 50%
0.00%               → 50.25%

DATE:
M/d/yyyy            → 1/15/2024
yyyy-MM-dd          → 2024-01-15
MMMM d, yyyy        → January 15, 2024
ddd, MMM d          → Mon, Jan 15

TIME:
h:mm AM/PM          → 2:30 PM
HH:mm:ss            → 14:30:45

SCIENTIFIC:
0.00E+00            → 1.23E+05

FRACTIONS:
# ?/?               → 1 1/2
# ??/??             → 1 23/45

CUSTOM:
[Green]0;[Red]-0    → Green for positive, Red for negative
"Yes: "0;"No: "0    → Prefix text based on sign
0_ ;[Red](0)        → Parentheses for negative with alignment

CONDITIONAL:
[>1000]0.0,"K";0    → 1.2K for values > 1000
[=0]"-";0.00        → Show "-" for zero values

Note: Use patterns with sheets_format action: set_number_format
`,
          },
        ],
      };

    case 'api-limits':
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                quotas: {
                  readRequests: {
                    perMinute: 300,
                    perUser: 'Shared with write requests',
                    note: 'values.get, spreadsheets.get, etc.',
                  },
                  writeRequests: {
                    perMinute: 300,
                    perUser: 'Shared with read requests',
                    note: 'values.update, batchUpdate, etc.',
                  },
                },
                limits: {
                  cellsPerSpreadsheet: 10_000_000,
                  sheetsPerSpreadsheet: 200,
                  columnsPerSheet: 18_278,
                  rowsPerSheet: 'Unlimited (but affects cell count)',
                  formulaLength: 50_000,
                  cellContentSize: 50_000,
                  importedDataSize: 20_000_000,
                },
                batchOperations: {
                  requestsPerBatch: 'No hard limit, but consider size',
                  recommendedMaxRequests: 100,
                  note: 'Use sheets_transaction for atomic batching',
                },
                bestPractices: [
                  'Use batch operations (batchUpdate) instead of multiple individual updates',
                  'Use sheets_transaction to save 80% API calls',
                  'Cache read results when possible',
                  'Use A1 notation for large ranges instead of cell-by-cell',
                  'Implement exponential backoff for rate limit errors',
                ],
              },
              null,
              2
            ),
          },
        ],
      };

    case 'validation-patterns':
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                email: {
                  pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
                  example: 'user@example.com',
                  tool: 'sheets_data',
                  action: 'set_validation',
                },
                url: {
                  pattern:
                    '^https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b',
                  example: 'https://example.com',
                },
                phone: {
                  us: {
                    pattern: '^\\(?([0-9]{3})\\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})$',
                    example: '(555) 123-4567',
                  },
                  international: {
                    pattern: '^\\+?[1-9]\\d{1,14}$',
                    example: '+12025551234',
                  },
                },
                zipCode: {
                  us: {
                    pattern: '^\\d{5}(-\\d{4})?$',
                    example: '12345 or 12345-6789',
                  },
                },
                custom: {
                  alphanumeric: {
                    pattern: '^[a-zA-Z0-9]+$',
                    description: 'Letters and numbers only',
                  },
                  noSpaces: {
                    pattern: '^\\S+$',
                    description: 'No whitespace allowed',
                  },
                },
                builtIn: {
                  note: 'Google Sheets provides built-in validations via sheets_data set_validation',
                  types: [
                    'NUMBER (with min/max)',
                    'TEXT (length constraints)',
                    'DATE (before/after)',
                    'LIST (dropdown from range or values)',
                    'CHECKBOX',
                    'CUSTOM_FORMULA',
                  ],
                },
              },
              null,
              2
            ),
          },
        ],
      };

    case 'chart-types':
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                basic: {
                  line: {
                    use: 'Show trends over time',
                    dataRequirements: 'X-axis (categories/dates), Y-axis (values)',
                    example: 'Sales over months',
                  },
                  bar: {
                    use: 'Compare categories',
                    dataRequirements: 'Categories, values',
                    example: 'Sales by product',
                  },
                  column: {
                    use: 'Compare categories (vertical bars)',
                    dataRequirements: 'Categories, values',
                    example: 'Revenue by quarter',
                  },
                  pie: {
                    use: 'Show proportions of a whole',
                    dataRequirements: 'Categories, values (positive only)',
                    example: 'Market share',
                  },
                  scatter: {
                    use: 'Show relationship between two variables',
                    dataRequirements: 'X values, Y values',
                    example: 'Height vs weight correlation',
                  },
                },
                advanced: {
                  area: {
                    use: 'Show cumulative trends',
                    dataRequirements: 'X-axis, multiple Y series',
                  },
                  combo: {
                    use: 'Mix chart types (line + column)',
                    dataRequirements: 'Multiple series with different scales',
                  },
                  histogram: {
                    use: 'Show distribution of values',
                    dataRequirements: 'Single column of numeric values',
                  },
                  waterfall: {
                    use: 'Show running total with increases/decreases',
                    dataRequirements: 'Categories, values (positive/negative)',
                  },
                },
                tool: {
                  create: 'Use sheets_visualize action: chart_create',
                  ai: 'Use sheets_analyze action: suggest_chart for recommendations',
                },
              },
              null,
              2
            ),
          },
        ],
      };

    default:
      throw new NotFoundError('reference resource', resourceId);
  }
}
