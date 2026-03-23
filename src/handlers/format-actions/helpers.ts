/**
 * Shared helper functions used across format-actions submodules.
 * Includes: queue-related types, format merge helper, NL conditional format parser.
 */

import { createValidationError } from '../../utils/error-factory.js';
import type { FormatResponse } from '../../schemas/index.js';
import type { FormatRequest } from '../../schemas/index.js';

// ─── Format batching queue types ──────────────────────────────────────────────

export interface QueuedFormatOperation {
  request: FormatRequest;
  timestamp: number;
  resolve: (value: FormatResponse) => void;
  reject: (error: unknown) => void;
}

// ─── Format merge helper ──────────────────────────────────────────────────────

/**
 * Fix 1.4 COMPLETION: Merge multiple format operations into one set_format call
 */
export function mergeFormatOperations(operations: FormatRequest[]): FormatRequest {
  if (operations.length === 0) {
    throw createValidationError({
      field: 'operations',
      value: [],
      reason: 'Cannot merge empty operations array',
    });
  }

  const base = operations[0]!;
  const merged: Partial<FormatRequest> & { format: Record<string, unknown> } = {
    action: 'set_format',
    spreadsheetId: base.spreadsheetId,
    range: 'range' in base ? base.range : undefined,
    format: {},
  };

  for (const op of operations) {
    switch (op.action) {
      case 'set_background':
        if (
          'backgroundColor' in op &&
          op.backgroundColor &&
          typeof op.backgroundColor === 'object' &&
          'red' in op.backgroundColor &&
          'green' in op.backgroundColor &&
          'blue' in op.backgroundColor &&
          'alpha' in op.backgroundColor
        ) {
          merged.format.backgroundColor = op.backgroundColor as {
            red: number;
            green: number;
            blue: number;
            alpha: number;
          };
        }
        break;
      case 'set_text_format':
        if ('textFormat' in op && op.textFormat) {
          merged.format.textFormat = {
            ...merged.format.textFormat,
            ...op.textFormat,
          };
        }
        break;
      case 'set_number_format':
        if ('numberFormat' in op && op.numberFormat) {
          merged.format.numberFormat = op.numberFormat;
        }
        break;
      case 'set_borders':
        if ('borders' in op && op.borders) {
          merged.format.borders = {
            ...merged.format.borders,
            ...op.borders,
          };
        }
        break;
      case 'set_alignment':
        if (
          'horizontalAlignment' in op &&
          (op.horizontalAlignment === 'LEFT' ||
            op.horizontalAlignment === 'CENTER' ||
            op.horizontalAlignment === 'RIGHT')
        ) {
          merged.format.horizontalAlignment = op.horizontalAlignment;
        }
        if (
          'verticalAlignment' in op &&
          (op.verticalAlignment === 'TOP' ||
            op.verticalAlignment === 'MIDDLE' ||
            op.verticalAlignment === 'BOTTOM')
        ) {
          merged.format.verticalAlignment = op.verticalAlignment;
        }
        if (
          'wrapStrategy' in op &&
          (op.wrapStrategy === 'OVERFLOW_CELL' ||
            op.wrapStrategy === 'LEGACY_WRAP' ||
            op.wrapStrategy === 'CLIP' ||
            op.wrapStrategy === 'WRAP')
        ) {
          merged.format.wrapStrategy = op.wrapStrategy;
        }
        break;
      case 'set_format':
        if ('format' in op && op.format) {
          merged.format = {
            ...merged.format,
            ...op.format,
          };
        }
        break;
    }
  }

  return merged as FormatRequest;
}

// ─── NL Conditional Format parser ─────────────────────────────────────────────

/** Parse a color name from a natural language string */
export function parseNLColor(text: string): Record<string, number> | undefined {
  if (/\bred\b/.test(text)) return { red: 0.9, green: 0.2, blue: 0.2 };
  if (/\bgreen\b/.test(text)) return { red: 0.2, green: 0.7, blue: 0.2 };
  if (/\byellow\b/.test(text)) return { red: 1, green: 0.9, blue: 0 };
  if (/\bblue\b/.test(text)) return { red: 0.2, green: 0.4, blue: 0.8 };
  if (/\borange\b/.test(text)) return { red: 1, green: 0.5, blue: 0 };
  if (/\bpurple\b/.test(text)) return { red: 0.6, green: 0.2, blue: 0.8 };
  if (/\bpink\b/.test(text)) return { red: 1, green: 0.5, blue: 0.7 };
  return undefined; // OK: Explicit empty — no recognized color keyword
}

/**
 * Parse a natural language conditional format description into rule parameters.
 */
export function parseNLConditionalFormat(description: string): {
  success: boolean;
  rulePreset?: string;
  rule?: Record<string, unknown>;
  hint?: string;
} {
  const d = description.toLowerCase().trim();

  // === Preset patterns (delegate to add_conditional_format_rule) ===
  if (/\bblank|empty cell/.test(d)) return { success: true, rulePreset: 'highlight_blanks' };
  if (/\bduplicate/.test(d)) return { success: true, rulePreset: 'highlight_duplicates' };
  if (/\berror/.test(d)) return { success: true, rulePreset: 'highlight_errors' };
  if (/\bdata.?bar/.test(d)) return { success: true, rulePreset: 'data_bars' };
  if (/\babove.?average/.test(d)) return { success: true, rulePreset: 'above_average' };
  if (/\bbelow.?average/.test(d)) return { success: true, rulePreset: 'below_average' };
  if (/\btop\s+10/.test(d)) return { success: true, rulePreset: 'top_10_percent' };
  if (/\bbottom\s+10/.test(d)) return { success: true, rulePreset: 'bottom_10_percent' };

  // Color scale patterns
  if (/\bcolor.?scale|heat.?map|gradient/.test(d)) {
    if (/blue/.test(d)) return { success: true, rulePreset: 'color_scale_blue_red' };
    return { success: true, rulePreset: 'color_scale_green_red' };
  }

  // === Comparison rules (build full rule object) ===
  const color = parseNLColor(d);

  // Number comparisons
  const numMatch = d.match(
    /(?:greater\s+than|more\s+than|above|>)\s*([\d.,]+)|(?:less\s+than|below|<)\s*([\d.,]+)|(?:equal(?:s)?\s+to|=)\s*([\d.,]+)|(?:not\s+equal|!=)\s*([\d.,]+)/
  );
  if (numMatch) {
    let condType: string;
    let value: string;
    if (numMatch[1]) {
      condType = 'NUMBER_GREATER';
      value = numMatch[1].replace(/,/g, '');
    } else if (numMatch[2]) {
      condType = 'NUMBER_LESS';
      value = numMatch[2].replace(/,/g, '');
    } else if (numMatch[3]) {
      condType = 'NUMBER_EQ';
      value = numMatch[3].replace(/,/g, '');
    } else {
      condType = 'NUMBER_NOT_EQ';
      value = numMatch[4]!.replace(/,/g, '');
    }

    return {
      success: true,
      rule: {
        type: 'boolean',
        condition: { type: condType, values: [{ userEnteredValue: value }] },
        format: { backgroundColor: color ?? { red: 0.9, green: 0.2, blue: 0.2 } },
      },
    };
  }

  // Between range: "between 10 and 100"
  const betweenMatch = d.match(/between\s+([\d.,]+)\s+and\s+([\d.,]+)/);
  if (betweenMatch) {
    return {
      success: true,
      rule: {
        type: 'boolean',
        condition: {
          type: 'NUMBER_BETWEEN',
          values: [
            { userEnteredValue: betweenMatch[1]!.replace(/,/g, '') },
            { userEnteredValue: betweenMatch[2]!.replace(/,/g, '') },
          ],
        },
        format: { backgroundColor: color ?? { red: 0.9, green: 0.9, blue: 0.2 } },
      },
    };
  }

  // Text comparisons
  const textContainsMatch = d.match(/contains?\s+["']?([^"']+?)["']?\s*(?:in\s+\w+)?$/);
  if (textContainsMatch && !/greater|less|equal|above|below|blank|duplicate|error|scale/.test(d)) {
    return {
      success: true,
      rule: {
        type: 'boolean',
        condition: {
          type: 'TEXT_CONTAINS',
          values: [{ userEnteredValue: textContainsMatch[1]!.trim() }],
        },
        format: { backgroundColor: color ?? { red: 0.9, green: 0.9, blue: 0.2 } },
      },
    };
  }

  // Text starts with
  const startsWithMatch = d.match(/starts?\s+with\s+["']?([^"']+?)["']?/);
  if (startsWithMatch) {
    return {
      success: true,
      rule: {
        type: 'boolean',
        condition: {
          type: 'TEXT_STARTS_WITH',
          values: [{ userEnteredValue: startsWithMatch[1]!.trim() }],
        },
        format: { backgroundColor: color ?? { red: 0.9, green: 0.9, blue: 0.2 } },
      },
    };
  }

  // Not blank
  if (/not\s+blank|not\s+empty|has\s+value|is\s+filled/.test(d)) {
    return {
      success: true,
      rule: {
        type: 'boolean',
        condition: { type: 'NOT_BLANK' },
        format: { backgroundColor: color ?? { red: 0.2, green: 0.7, blue: 0.2 } },
      },
    };
  }

  return {
    success: false,
    hint: 'Supported patterns: "greater than N", "less than N", "between X and Y", "contains text", "starts with text", "blank", "duplicate", "error", "above average", "below average", "top 10%", "color scale", "data bars".',
  };
}

// ─── RGB to hex helper ─────────────────────────────────────────────────────────

/**
 * Convert RGB color (0-1 scale) to hex string
 */
export function rgbToHex(color: { red?: number; green?: number; blue?: number }): string {
  const r = Math.round((color.red ?? 0) * 255);
  const g = Math.round((color.green ?? 0) * 255);
  const b = Math.round((color.blue ?? 0) * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
