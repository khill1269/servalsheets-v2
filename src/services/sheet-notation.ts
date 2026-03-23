import { RangeResolutionError } from '../core/errors.js';

export interface A1NotationComponents {
  sheetName?: string;
  startColumn?: string;
  startRow?: number;
  endColumn?: string;
  endRow?: number;
}

/**
 * Convert 0-based column index to letter (A, B, ..., Z, AA, AB, ...).
 */
export function columnIndexToLetter(index: number): string {
  let letter = '';
  let num = index + 1;

  while (num > 0) {
    const remainder = (num - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    num = Math.floor((num - 1) / 26);
  }

  return letter;
}

/**
 * Convert column letter to 0-based index (A->0, B->1, ..., AA->26).
 */
export function letterToColumnIndex(letter: string): number {
  let index = 0;
  for (let i = 0; i < letter.length; i++) {
    index = index * 26 + (letter.charCodeAt(i) - 64);
  }
  return index - 1;
}

/**
 * Calculate string similarity using a Levenshtein-based metric.
 */
export function calculateSheetNameSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0;

  if (a.includes(b) || b.includes(a)) {
    const minLen = Math.min(a.length, b.length);
    const maxLen = Math.max(a.length, b.length);
    return minLen / maxLen;
  }

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    const firstRow = matrix[0];
    if (firstRow) {
      firstRow[j] = j;
    }
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      const row = matrix[i];
      const prevRow = matrix[i - 1];
      if (row && prevRow) {
        row[j] = Math.min(
          (prevRow[j] ?? 0) + 1,
          (row[j - 1] ?? 0) + 1,
          (prevRow[j - 1] ?? 0) + cost
        );
      }
    }
  }

  const lastRow = matrix[b.length];
  const distance = lastRow?.[a.length] ?? Math.max(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

/**
 * Parse A1 notation into components.
 */
export function parseA1Notation(notation: string): A1NotationComponents {
  const firstRange = extractFirstRange(notation);

  let sheetName: string | undefined;
  let rangeStr = firstRange;

  if (notation.includes('!')) {
    const parts = notation.split('!');
    const extractedSheetName = parts[0];
    const extractedRange = parts[1];

    if (extractedSheetName && extractedRange) {
      sheetName = extractedSheetName;
      rangeStr = extractedRange;

      if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
        sheetName = sheetName.slice(1, -1);
      }
    }
  }

  if (rangeStr.includes(':')) {
    const parts = rangeStr.split(':');
    const start = parts[0];
    const end = parts[1];

    if (!start || !end) {
      throw new RangeResolutionError(`Invalid A1 notation: ${notation}`, 'INVALID_RANGE', {
        range: notation,
      });
    }

    if (/^\d+$/.test(start) && /^\d+$/.test(end)) {
      return {
        sheetName,
        startRow: parseInt(start, 10),
        endRow: parseInt(end, 10),
      };
    }

    const startMatch = start.match(/^([A-Z]+)(\d+)?$/);
    if (!startMatch) {
      throw new RangeResolutionError(`Invalid A1 notation: ${notation}`, 'INVALID_RANGE', {
        range: notation,
      });
    }

    const startColumn = startMatch[1];
    const startRow = startMatch[2] ? parseInt(startMatch[2], 10) : undefined;

    const endMatch = end.match(/^([A-Z]+)(\d+)?$/);
    if (!endMatch) {
      throw new RangeResolutionError(`Invalid A1 notation: ${notation}`, 'INVALID_RANGE', {
        range: notation,
      });
    }

    const endColumn = endMatch[1];
    const endRow = endMatch[2] ? parseInt(endMatch[2], 10) : undefined;

    return {
      sheetName,
      startColumn,
      startRow,
      endColumn,
      endRow,
    };
  }

  const match = rangeStr.match(/^([A-Z]+)(\d+)?$/);
  if (!match) {
    throw new RangeResolutionError(`Invalid A1 notation: ${notation}`, 'INVALID_RANGE', {
      range: notation,
    });
  }

  return {
    sheetName,
    startColumn: match[1],
    startRow: match[2] ? parseInt(match[2], 10) : undefined,
  };
}

/**
 * Parse multiple A1 notation ranges separated by commas.
 */
export function parseMultipleRanges(notation: string): A1NotationComponents[] {
  if (!notation.includes(',')) {
    return [parseA1Notation(notation)];
  }

  const ranges: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of notation) {
    if (char === "'" && !inQuotes) {
      inQuotes = true;
      current += char;
    } else if (char === "'" && inQuotes) {
      inQuotes = false;
      current += char;
    } else if (char === ',' && !inQuotes) {
      if (current.trim()) {
        ranges.push(current.trim());
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    ranges.push(current.trim());
  }

  return ranges.map((range) => parseA1Notation(range));
}

/**
 * Check if a notation contains multiple ranges (comma-separated).
 */
export function isMultipleRanges(notation: string): boolean {
  let inQuotes = false;
  for (const char of notation) {
    if (char === "'") inQuotes = !inQuotes;
    if (char === ',' && !inQuotes) return true;
  }
  return false;
}

/**
 * Build A1 notation from components.
 */
export function buildA1Notation(components: {
  sheetName?: string;
  startColumn: string;
  startRow?: number;
  endColumn?: string;
  endRow?: number;
}): string {
  const { sheetName, startColumn, startRow, endColumn, endRow } = components;

  let range = startColumn;
  if (startRow) {
    range += startRow;
  }

  if (endColumn) {
    range += `:${endColumn}`;
    if (endRow) {
      range += endRow;
    }
  }

  if (sheetName) {
    const needsQuotes = /[^a-zA-Z0-9_]/.test(sheetName);
    const quotedName = needsQuotes ? `'${sheetName}'` : sheetName;
    return `${quotedName}!${range}`;
  }

  return range;
}

/**
 * Extract just the first range from comma-separated ranges.
 */
function extractFirstRange(notation: string): string {
  if (!notation.includes(',')) {
    return notation;
  }

  let current = '';
  let inQuotes = false;

  for (const char of notation) {
    if (char === "'" && !inQuotes) {
      inQuotes = true;
      current += char;
    } else if (char === "'" && inQuotes) {
      inQuotes = false;
      current += char;
    } else if (char === ',' && !inQuotes) {
      return current.trim() || notation;
    } else {
      current += char;
    }
  }

  return notation;
}
