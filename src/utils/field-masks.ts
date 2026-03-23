/**
 * ServalSheets - Google API Field Masks
 *
 * Provides field mask patterns for Google Sheets API requests.
 * Field masks reduce payload size by 30-50% by returning only requested fields.
 *
 * Benefits:
 * - Smaller payloads (30-50% reduction)
 * - Faster responses
 * - Reduced bandwidth
 * - Same quota cost (but faster)
 *
 * @see https://developers.google.com/sheets/api/guides/field-masks
 * @category Utils
 */

/**
 * Common field mask patterns for Google Sheets API
 *
 * These patterns are optimized for typical ServalSheets operations.
 * Use the most specific mask possible to minimize payload size.
 */
export const FIELD_MASKS = {
  /**
   * Spreadsheet metadata only
   * Returns: spreadsheetId, title, locale, timeZone
   * Use for: Quick metadata checks, title lookups
   * Payload reduction: ~95%
   */
  METADATA_MINIMAL: 'spreadsheetId,properties(title,locale,timeZone)',

  /**
   * Sheet list with properties
   * Returns: Sheet titles, IDs, dimensions, visibility
   * Use for: Sheet enumeration, dimension checks
   * Payload reduction: ~80%
   */
  SHEETS_LIST: 'spreadsheetId,sheets(properties(title,sheetId,index,gridProperties,hidden))',

  /**
   * Sheet properties with grid dimensions
   * Returns: Sheet title, ID, row/column counts
   * Use for: Range validation, dimension checks
   * Payload reduction: ~85%
   */
  SHEET_DIMENSIONS:
    'sheets(properties(title,sheetId,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)))',

  /**
   * Named ranges only
   * Returns: Named range definitions
   * Use for: Named range resolution
   * Payload reduction: ~90%
   */
  NAMED_RANGES: 'namedRanges(namedRangeId,name,range)',

  /**
   * Data validation rules
   * Returns: Validation rules for cells
   * Use for: Validation checks
   * Payload reduction: ~70%
   */
  DATA_VALIDATION: 'sheets(data(rowData(values(dataValidation))))',

  /**
   * Conditional formatting rules
   * Returns: Conditional format rules
   * Use for: Format analysis
   * Payload reduction: ~75%
   */
  CONDITIONAL_FORMATTING: 'sheets(conditionalFormats)',

  /**
   * Protected ranges
   * Returns: Protection settings
   * Use for: Permission checks
   * Payload reduction: ~80%
   */
  PROTECTED_RANGES: 'sheets(protectedRanges)',

  /**
   * Charts and embedded objects
   * Returns: Chart definitions
   * Use for: Visualization analysis
   * Payload reduction: ~60%
   */
  CHARTS: 'sheets(charts)',

  /**
   * Merged cells
   * Returns: Merged cell ranges
   * Use for: Merge detection
   * Payload reduction: ~85%
   */
  MERGES: 'sheets(merges)',

  /**
   * Developer metadata
   * Returns: Custom metadata
   * Use for: Metadata queries
   * Payload reduction: ~90%
   */
  DEVELOPER_METADATA: 'developerMetadata',

  /**
   * Full spreadsheet (default)
   * Returns: Everything
   * Use for: Complete spreadsheet analysis only
   * Payload reduction: 0% (baseline)
   */
  FULL: '*',
} as const;

/**
 * Field mask for batchUpdate responses
 *
 * Limits response to essential fields after mutations.
 * Reduces response size while preserving critical data.
 */
export const BATCH_UPDATE_RESPONSE_FIELDS = {
  /**
   * Minimal response (default for most operations)
   * Returns: spreadsheetId only
   * Use for: Write operations where response data isn't needed
   */
  MINIMAL: 'spreadsheetId',

  /**
   * Standard response
   * Returns: spreadsheetId + update results
   * Use for: Operations needing confirmation of changes
   */
  STANDARD: 'spreadsheetId,replies',

  /**
   * Detailed response
   * Returns: Full response with all reply data
   * Use for: Operations requiring complete feedback
   */
  DETAILED: '*',
} as const;

/**
 * Build custom field mask for values.get requests
 *
 * Values API has limited field mask support.
 * Only majorDimension and range are typically useful.
 *
 * @param options - Field mask options
 * @returns Field mask string
 */
export function buildValuesMask(options: {
  includeRange?: boolean;
  includeMajorDimension?: boolean;
}): string | undefined {
  const fields: string[] = ['values'];

  if (options.includeRange) {
    fields.push('range');
  }

  if (options.includeMajorDimension) {
    fields.push('majorDimension');
  }

  // If only values requested, return undefined (default behavior)
  return fields.length === 1 ? undefined : fields.join(',');
}

/**
 * Build custom field mask for spreadsheets.get
 *
 * Combines multiple standard masks or creates custom mask.
 *
 * @param parts - Array of mask keys or custom mask strings
 * @returns Combined field mask string
 */
export function buildSpreadsheetMask(parts: Array<keyof typeof FIELD_MASKS | string>): string {
  const masks = parts.map((part) => {
    // Check if it's a known mask key
    if (part in FIELD_MASKS) {
      return FIELD_MASKS[part as keyof typeof FIELD_MASKS];
    }
    // Otherwise treat as custom mask
    return part;
  });

  return masks.join(',');
}

/**
 * Get appropriate field mask for operation type
 *
 * Returns optimized field mask based on operation requirements.
 *
 * @param operation - Type of operation
 * @returns Field mask string or undefined (full response)
 */
export function getFieldMaskForOperation(
  operation:
    | 'metadata'
    | 'list_sheets'
    | 'dimensions'
    | 'named_ranges'
    | 'validation'
    | 'formatting'
    | 'protection'
    | 'charts'
    | 'full'
): string {
  const maskMap: Record<typeof operation, string> = {
    metadata: FIELD_MASKS.METADATA_MINIMAL,
    list_sheets: FIELD_MASKS.SHEETS_LIST,
    dimensions: FIELD_MASKS.SHEET_DIMENSIONS,
    named_ranges: FIELD_MASKS.NAMED_RANGES,
    validation: FIELD_MASKS.DATA_VALIDATION,
    formatting: FIELD_MASKS.CONDITIONAL_FORMATTING,
    protection: FIELD_MASKS.PROTECTED_RANGES,
    charts: FIELD_MASKS.CHARTS,
    full: FIELD_MASKS.FULL,
  };

  return maskMap[operation];
}

/**
 * Validate field mask syntax
 *
 * Basic validation to catch common mistakes.
 * Google API will reject invalid masks with 400 error.
 *
 * @param mask - Field mask to validate
 * @returns true if valid, false otherwise
 */
export function validateFieldMask(mask: string): boolean {
  // Basic syntax checks
  if (!mask || mask.trim() === '') {
    return false;
  }

  // Check for common mistakes
  const invalidPatterns = [
    /\s+/g, // No spaces allowed
    /\.\./g, // No double dots
    /^,|,$/g, // No leading/trailing commas
    /,,/g, // No double commas
  ];

  return !invalidPatterns.some((pattern) => pattern.test(mask));
}

/**
 * Estimate payload size reduction from field mask
 *
 * Rough estimate based on typical field sizes.
 * Actual reduction depends on spreadsheet content.
 *
 * @param mask - Field mask being used
 * @returns Estimated percentage reduction (0-95)
 */
export function estimatePayloadReduction(mask: string): number {
  // Full response (no reduction)
  if (mask === '*' || mask === FIELD_MASKS.FULL) {
    return 0;
  }

  // Minimal metadata (~95% reduction)
  if (mask === FIELD_MASKS.METADATA_MINIMAL) {
    return 95;
  }

  // Sheet list (~80% reduction)
  if (mask === FIELD_MASKS.SHEETS_LIST) {
    return 80;
  }

  // Named ranges (~90% reduction)
  if (mask === FIELD_MASKS.NAMED_RANGES) {
    return 90;
  }

  // Other masks: estimate based on complexity
  const fieldCount = mask.split(',').length;
  const nestedDepth = (mask.match(/\(/g) || []).length;

  // More fields = less reduction
  // More nesting = less reduction
  const baseReduction = 70;
  const fieldPenalty = Math.min(fieldCount * 5, 30);
  const nestingPenalty = Math.min(nestedDepth * 10, 20);

  return Math.max(baseReduction - fieldPenalty - nestingPenalty, 10);
}
