import type { AnomalyMethod } from '../schemas/fix.js';

export type CellValue = string | number | boolean | null;

const ZERO_WIDTH_CHARS = new Set(['\u200B', '\u200C', '\u200D', '\uFEFF']);

function isDisallowedControlChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31);
}

function isDisallowedSpecialChar(char: string): boolean {
  return isDisallowedControlChar(char) || ZERO_WIDTH_CHARS.has(char);
}

function hasDisallowedSpecialChars(value: string): boolean {
  for (const char of value) {
    if (isDisallowedSpecialChar(char)) {
      return true;
    }
  }
  return false;
}

function stripDisallowedSpecialChars(value: string): string {
  let result = '';
  for (const char of value) {
    if (!isDisallowedSpecialChar(char)) {
      result += char;
    }
  }
  return result;
}

const STATE_ABBREV_MAP = new Map<string, string>([
  ['alabama', 'AL'],
  ['alaska', 'AK'],
  ['arizona', 'AZ'],
  ['arkansas', 'AR'],
  ['california', 'CA'],
  ['colorado', 'CO'],
  ['connecticut', 'CT'],
  ['delaware', 'DE'],
  ['florida', 'FL'],
  ['georgia', 'GA'],
  ['hawaii', 'HI'],
  ['idaho', 'ID'],
  ['illinois', 'IL'],
  ['indiana', 'IN'],
  ['iowa', 'IA'],
  ['kansas', 'KS'],
  ['kentucky', 'KY'],
  ['louisiana', 'LA'],
  ['maine', 'ME'],
  ['maryland', 'MD'],
  ['massachusetts', 'MA'],
  ['michigan', 'MI'],
  ['minnesota', 'MN'],
  ['mississippi', 'MS'],
  ['missouri', 'MO'],
  ['montana', 'MT'],
  ['nebraska', 'NE'],
  ['nevada', 'NV'],
  ['new hampshire', 'NH'],
  ['new jersey', 'NJ'],
  ['new mexico', 'NM'],
  ['new york', 'NY'],
  ['north carolina', 'NC'],
  ['north dakota', 'ND'],
  ['ohio', 'OH'],
  ['oklahoma', 'OK'],
  ['oregon', 'OR'],
  ['pennsylvania', 'PA'],
  ['rhode island', 'RI'],
  ['south carolina', 'SC'],
  ['south dakota', 'SD'],
  ['tennessee', 'TN'],
  ['texas', 'TX'],
  ['utah', 'UT'],
  ['vermont', 'VT'],
  ['virginia', 'VA'],
  ['washington', 'WA'],
  ['west virginia', 'WV'],
  ['wisconsin', 'WI'],
  ['wyoming', 'WY'],
  ['district of columbia', 'DC'],
  ['american samoa', 'AS'],
  ['guam', 'GU'],
  ['northern mariana islands', 'MP'],
  ['puerto rico', 'PR'],
  ['united states virgin islands', 'VI'],
]);

export const BUILT_IN_RULES: Record<
  string,
  {
    detect: (value: CellValue) => boolean;
    fix: (value: CellValue) => CellValue;
    description: string;
  }
> = {
  trim_whitespace: {
    detect: (v) => typeof v === 'string' && v !== v.trim(),
    fix: (v) => (typeof v === 'string' ? v.trim() : v),
    description: 'Remove leading/trailing whitespace',
  },
  normalize_case: {
    detect: (v) =>
      typeof v === 'string' &&
      v.length > 1 &&
      v !== v.toLowerCase() &&
      v !== v.toUpperCase() &&
      v !== toTitleCase(v),
    fix: (v) => (typeof v === 'string' ? toTitleCase(v) : v),
    description: 'Normalize to title case',
  },
  fix_dates: {
    detect: (v) => typeof v === 'string' && isAmbiguousDate(v),
    fix: (v) => (typeof v === 'string' ? normalizeDate(v) : v),
    description: 'Normalize date formats to YYYY-MM-DD',
  },
  fix_numbers: {
    detect: (v) =>
      typeof v === 'string' && v.trim() !== '' && !isNaN(parseFloat(v.replace(/[,$%]/g, ''))),
    fix: (v) => {
      if (typeof v !== 'string') return v;
      const cleaned = v.replace(/[$,\s]/g, '');
      if (cleaned.endsWith('%')) return parseFloat(cleaned) / 100;
      return parseFloat(cleaned);
    },
    description: 'Convert text numbers to numeric values',
  },
  fix_booleans: {
    detect: (v) => typeof v === 'string' && /^(yes|no|true|false|1|0|y|n)$/i.test(v.trim()),
    fix: (v) => {
      if (typeof v !== 'string') return v;
      return /^(yes|true|1|y)$/i.test(v.trim());
    },
    description: 'Normalize boolean-like values to TRUE/FALSE',
  },
  remove_duplicates: {
    // This is handled specially at the row level, not per-cell
    detect: () => false,
    fix: (v) => v,
    description: 'Remove exact duplicate rows',
  },
  fix_emails: {
    detect: (v) =>
      typeof v === 'string' && v.includes('@') && (v !== v.toLowerCase().trim() || /\s/.test(v)),
    fix: (v) => (typeof v === 'string' ? v.toLowerCase().trim() : v),
    description: 'Lowercase and trim email addresses',
  },
  fix_phones: {
    detect: (v) =>
      typeof v === 'string' && /[\d\s\-().+]{7,}/.test(v) && v.replace(/\D/g, '').length >= 7,
    fix: (v) => {
      if (typeof v !== 'string') return v;
      const digits = v.replace(/\D/g, '');
      if (digits.length === 10)
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
      if (digits.length === 11 && digits[0] === '1')
        return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
      return `+${digits}`;
    },
    description: 'Normalize phone numbers',
  },
  fix_urls: {
    detect: (v) =>
      typeof v === 'string' && /^(www\.|[a-z0-9-]+\.(com|org|net|io|dev|co))/i.test(v.trim()),
    fix: (v) => (typeof v === 'string' && !v.startsWith('http') ? `https://${v.trim()}` : v),
    description: 'Add https:// to URLs missing protocol',
  },
  fix_currency: {
    detect: (v) => typeof v === 'string' && /^\s*[$€£¥]\s*[\d,.]+\s*$/.test(v),
    fix: (v) => {
      if (typeof v !== 'string') return v;
      return parseFloat(v.replace(/[^0-9.-]/g, ''));
    },
    description: 'Strip currency symbols and convert to number',
  },
  remove_leading_zeros: {
    detect: (v) => typeof v === 'string' && /^0+\d+$/.test(v.trim()),
    fix: (v) => {
      if (typeof v !== 'string') return v;
      const trimmed = v.trim();
      // Only process if it's numeric and has leading zeros
      if (/^0+[0-9]/.test(trimmed)) {
        const num = parseInt(trimmed, 10);
        return isNaN(num) ? v : num;
      }
      return v;
    },
    description: 'Strip leading zeros from numeric strings',
  },
  normalize_whitespace: {
    detect: (v) => typeof v === 'string' && /\s{2,}|\t/.test(v),
    fix: (v) => {
      if (typeof v !== 'string') return v;
      return v.replace(/\s+/g, ' ').trim();
    },
    description: 'Collapse multiple spaces and tabs to single space',
  },
  fix_encoding: {
    detect: (v) =>
      typeof v === 'string' &&
      (v.includes('â€™') ||
        v.includes('Ã©') ||
        v.includes('â€œ') ||
        v.includes('â€') ||
        /[\x80-\xFF]{2,}/.test(v)),
    fix: (v) => {
      if (typeof v !== 'string') return v;
      // Fix common UTF-8 encoding errors from double-encoding
      const replacements: Record<string, string> = {
        'â€™': "'", // curly apostrophe
        'â€œ': '"', // left curly quote
        'â€\u009d': '"', // right curly quote
        'â€\u0093': '"',
        'Ã©': 'é',
        'Ã¡': 'á',
        'Ã®': 'î',
        'Ã¼': 'ü',
        'Ã§': 'ç',
        Â: '', // remove orphaned combining characters
      };
      let result = v;
      for (const [bad, good] of Object.entries(replacements)) {
        result = result.replace(new RegExp(bad, 'g'), good);
      }
      return result;
    },
    description: 'Fix common encoding issues (UTF-8 double-encoding, etc.)',
  },
  strip_html: {
    detect: (v) => typeof v === 'string' && /<[^>]+>/.test(v),
    fix: (v) => {
      if (typeof v !== 'string') return v;
      return v.replace(/<[^>]+>/g, '').trim();
    },
    description: 'Remove HTML tags from cell values',
  },
  normalize_nulls: {
    detect: (v) => typeof v === 'string' && /^(n\/a|na|none|null|-|#n\/a)$/i.test(v.trim()),
    fix: () => null,
    description: 'Normalize null representations (N/A, null, -, etc.) to empty',
  },
  fix_zip_codes: {
    detect: (v) => {
      if (typeof v !== 'string') return false;
      const trimmed = v.trim();
      // Detect values that look like ZIP codes: 3-5 digits, or digits-digits pattern
      return /^(\d{3,5}|\d{5}-\d{4}|\d{5}\s\d{4})$/.test(trimmed);
    },
    fix: (v) => {
      if (typeof v !== 'string') return v;
      const trimmed = v.trim();
      // Handle ZIP+4 format: normalize to "12345-6789"
      if (/^\d{5}\s\d{4}$/.test(trimmed)) {
        const parts = trimmed.split(/\s+/);
        return `${parts[0]}-${parts[1]}`;
      }
      // Already in ZIP+4 format
      if (/^\d{5}-\d{4}$/.test(trimmed)) return trimmed;
      // Pad 3-5 digit ZIPs to 5 digits with leading zeros
      const numOnly = trimmed.replace(/\D/g, '');
      if (numOnly.length <= 5 && numOnly.length > 0) {
        return numOnly.padStart(5, '0');
      }
      return v;
    },
    description: 'Normalize US ZIP codes (pad to 5 digits, format ZIP+4)',
  },
  fix_states: {
    detect: (v) => {
      if (typeof v !== 'string') return false;
      const trimmed = v.trim().toLowerCase();
      // Detect full state names or mixed-case abbreviations
      return (
        STATE_ABBREV_MAP.has(trimmed) ||
        Array.from(STATE_ABBREV_MAP.values()).some((abbr) => abbr.toLowerCase() === trimmed)
      );
    },
    fix: (v) => {
      if (typeof v !== 'string') return v;
      const trimmed = v.trim().toLowerCase();
      // Check if it's a state name
      if (STATE_ABBREV_MAP.has(trimmed)) return STATE_ABBREV_MAP.get(trimmed)!;
      // Check if it's already an abbreviation
      for (const abbr of STATE_ABBREV_MAP.values()) {
        if (abbr.toLowerCase() === trimmed) return abbr;
      }
      return v;
    },
    description: 'Normalize US state names to 2-letter abbreviations',
  },
  remove_special_chars: {
    detect: (v) => {
      if (typeof v !== 'string') return false;
      // Detect control characters (excluding tab/newline) and invisible unicode chars.
      return hasDisallowedSpecialChars(v);
    },
    fix: (v) => {
      if (typeof v !== 'string') return v;
      // Remove control/invisible chars and trim remaining content.
      return stripDisallowedSpecialChars(v).trim();
    },
    description: 'Remove non-printable and control characters',
  },
  fix_names: {
    detect: (v) => {
      if (typeof v !== 'string') return false;
      const trimmed = v.trim();
      // Detect names in ALL CAPS, all lowercase, or extra spaces
      return (
        (trimmed.length > 0 && trimmed === trimmed.toUpperCase()) ||
        (trimmed.length > 0 && trimmed === trimmed.toLowerCase() && /\s/.test(trimmed)) ||
        /\s{2,}/.test(trimmed)
      );
    },
    fix: (v) => {
      if (typeof v !== 'string') return v;
      const trimmed = v.trim();
      // Collapse multiple spaces
      let result = trimmed.replace(/\s+/g, ' ');
      // Apply title case with exceptions for common prefixes
      result = result
        .split(/\s+/)
        .map((word, idx) => {
          const lower = word.toLowerCase();
          // Handle prefixes: mc, mac, o', van, de, von
          if (idx > 0 && /^(mc|mac|o'|van|de|von)/.test(lower)) {
            if (lower.startsWith("o'")) {
              return "O'" + word.slice(2).charAt(0).toUpperCase() + word.slice(3).toLowerCase();
            }
            const prefix = lower.substring(0, lower === 'mc' ? 2 : lower === 'mac' ? 3 : 2);
            return (
              prefix.charAt(0).toUpperCase() +
              prefix.slice(1) +
              word.slice(prefix.length).charAt(0).toUpperCase() +
              word.slice(prefix.length + 1).toLowerCase()
            );
          }
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');
      return result;
    },
    description: 'Normalize personal names (title case, fix prefixes like Mc, Van)',
  },
  deduplicate_within_cell: {
    detect: (v) => {
      if (typeof v !== 'string') return false;
      const trimmed = v.trim();
      // Detect values with repeated items (comma or newline separated)
      const items = trimmed.split(/[,\n]/).map((s) => s.trim().toLowerCase());
      return items.length > 1 && items.length !== new Set(items).size;
    },
    fix: (v) => {
      if (typeof v !== 'string') return v;
      const trimmed = v.trim();
      // Detect separator (comma or newline)
      const isNewlineSep = trimmed.includes('\n');
      const separator = isNewlineSep ? '\n' : ',';
      const items = trimmed.split(separator).map((s) => s.trim());
      // Deduplicate while preserving order (case-insensitive)
      const seen = new Set<string>();
      const unique: string[] = [];
      for (const item of items) {
        const lower = item.toLowerCase();
        if (!seen.has(lower) && item.length > 0) {
          seen.add(lower);
          unique.push(item);
        }
      }
      return unique.join(isNewlineSep ? '\n' : ', ');
    },
    description: 'Remove duplicate values within comma or newline-separated cells',
  },
};

export const FORMAT_CONVERTERS: Record<string, (value: CellValue) => CellValue> = {
  iso_date: (v) => (typeof v === 'string' ? normalizeDate(v) : v),
  us_date: (v) => {
    if (typeof v !== 'string') return v;
    const d = parseAnyDate(v);
    return d
      ? `${String(d.month).padStart(2, '0')}/${String(d.day).padStart(2, '0')}/${d.year}`
      : v;
  },
  eu_date: (v) => {
    if (typeof v !== 'string') return v;
    const d = parseAnyDate(v);
    return d
      ? `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}/${d.year}`
      : v;
  },
  currency_usd: (v) => {
    const n =
      typeof v === 'number'
        ? v
        : typeof v === 'string'
          ? parseFloat(v.replace(/[^0-9.-]/g, ''))
          : NaN;
    return isNaN(n) ? v : `$${n.toFixed(2)}`;
  },
  currency_eur: (v) => {
    const n =
      typeof v === 'number'
        ? v
        : typeof v === 'string'
          ? parseFloat(v.replace(/[^0-9.-]/g, ''))
          : NaN;
    return isNaN(n) ? v : `€${n.toFixed(2)}`;
  },
  currency_gbp: (v) => {
    const n =
      typeof v === 'number'
        ? v
        : typeof v === 'string'
          ? parseFloat(v.replace(/[^0-9.-]/g, ''))
          : NaN;
    return isNaN(n) ? v : `£${n.toFixed(2)}`;
  },
  number_plain: (v) => {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return v;
    const n = parseFloat(v.replace(/[^0-9.-]/g, ''));
    return isNaN(n) ? v : n;
  },
  percentage: (v) => {
    if (typeof v === 'number') return v <= 1 ? `${(v * 100).toFixed(1)}%` : `${v.toFixed(1)}%`;
    if (typeof v !== 'string') return v;
    const n = parseFloat(v.replace(/[^0-9.-]/g, ''));
    if (isNaN(n)) return v;
    return n <= 1 ? `${(n * 100).toFixed(1)}%` : `${n.toFixed(1)}%`;
  },
  phone_e164: (v) => {
    if (typeof v !== 'string') return v;
    const digits = v.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
    return digits.length >= 7 ? `+${digits}` : v;
  },
  phone_national: (v) => {
    if (typeof v !== 'string') return v;
    const digits = v.replace(/\D/g, '');
    if (digits.length === 10)
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (digits.length === 11 && digits[0] === '1')
      return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    return v;
  },
  email_lowercase: (v) => (typeof v === 'string' ? v.toLowerCase().trim() : v),
  url_https: (v) => (typeof v === 'string' && !v.startsWith('http') ? `https://${v.trim()}` : v),
  title_case: (v) => (typeof v === 'string' ? toTitleCase(v) : v),
  upper_case: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
  lower_case: (v) => (typeof v === 'string' ? v.toLowerCase() : v),
  boolean: (v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v !== 'string') return v;
    return /^(yes|true|1|y)$/i.test(v.trim());
  },
  snake_case: (v) => {
    if (typeof v !== 'string') return v;
    return v
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^\w_]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  },
  camel_case: (v) => {
    if (typeof v !== 'string') return v;
    return v
      .trim()
      .split(/[\s_-]+/)
      .map((word, idx) => {
        if (idx === 0) return word.toLowerCase();
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join('');
  },
  trim_to_length: (v) => {
    if (typeof v !== 'string') return v;
    const maxLength = 50;
    if (v.length <= maxLength) return v;
    return v.substring(0, maxLength - 3) + '...';
  },
  timestamp_unix: (v) => {
    let date: Date | null = null;

    if (typeof v === 'number') {
      if (v > 1e11) {
        return Math.floor(v / 1000);
      }
      return v;
    }

    if (typeof v === 'string') {
      const parsed = parseAnyDate(v);
      if (parsed) {
        date = new Date(parsed.year, parsed.month - 1, parsed.day);
      } else {
        const d = new Date(v);
        if (!isNaN(d.getTime())) {
          date = d;
        }
      }
    }

    if (date && !isNaN(date.getTime())) {
      return Math.floor(date.getTime() / 1000);
    }

    return v;
  },
  timestamp_iso: (v) => {
    let date: Date | null = null;

    if (typeof v === 'number') {
      if (v > 1e11) {
        date = new Date(v);
      } else {
        date = new Date(v * 1000);
      }
    }

    if (typeof v === 'string') {
      const parsed = parseAnyDate(v);
      if (parsed) {
        date = new Date(parsed.year, parsed.month - 1, parsed.day);
      } else {
        const d = new Date(v);
        if (!isNaN(d.getTime())) {
          date = d;
        }
      }
    }

    if (date && !isNaN(date.getTime())) {
      return date.toISOString();
    }

    return v;
  },
};

export const ANOMALY_DETECTORS: Record<
  AnomalyMethod,
  (value: number, allValues: number[], threshold: number) => number
> = {
  iqr: (value, allValues) => {
    const sorted = [...allValues].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? 0;
    const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
    const iqr = q3 - q1;
    if (iqr === 0) return 0;
    return Math.max((q1 - value) / iqr, (value - q3) / iqr, 0);
  },
  zscore: (value, allValues) => {
    const mean = allValues.reduce((a, b) => a + b, 0) / allValues.length;
    const std = Math.sqrt(
      allValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / allValues.length
    );
    if (std === 0) return 0;
    return Math.abs((value - mean) / std);
  },
  modified_zscore: (value, allValues) => {
    const sorted = [...allValues].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const mad = (() => {
      const deviations = allValues.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
      return deviations[Math.floor(deviations.length / 2)] ?? 0;
    })();
    if (mad === 0) return 0;
    return Math.abs((0.6745 * (value - median)) / mad);
  },
};

function toTitleCase(str: string): string {
  return str.replace(
    /\w\S*/g,
    (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase()
  );
}

function isAmbiguousDate(str: string): boolean {
  return (
    /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(str.trim()) ||
    /^\d{4}[/.-]\d{1,2}[/.-]\d{1,2}$/.test(str.trim()) ||
    /^[A-Za-z]+ \d{1,2},? \d{4}$/.test(str.trim())
  );
}

interface ParsedDate {
  year: number;
  month: number;
  day: number;
}

function parseAnyDate(str: string): ParsedDate | null {
  const trimmed = str.trim();

  let m = trimmed.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (m) return { year: parseInt(m[1]!, 10), month: parseInt(m[2]!, 10), day: parseInt(m[3]!, 10) };

  m = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const a = parseInt(m[1]!, 10);
    const b = parseInt(m[2]!, 10);
    const year = parseInt(m[3]!, 10);
    if (a <= 12) return { year, month: a, day: b };
    return { year, month: b, day: a };
  }

  m = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/);
  if (m) {
    const yy = parseInt(m[3]!, 10);
    const year = yy < 50 ? 2000 + yy : 1900 + yy;
    return { year, month: parseInt(m[1]!, 10), day: parseInt(m[2]!, 10) };
  }

  m = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const monthNames: Record<string, number> = {
      jan: 1,
      january: 1,
      feb: 2,
      february: 2,
      mar: 3,
      march: 3,
      apr: 4,
      april: 4,
      may: 5,
      jun: 6,
      june: 6,
      jul: 7,
      july: 7,
      aug: 8,
      august: 8,
      sep: 9,
      september: 9,
      oct: 10,
      october: 10,
      nov: 11,
      november: 11,
      dec: 12,
      december: 12,
    };
    const month = monthNames[m[1]!.toLowerCase()];
    if (month) return { year: parseInt(m[3]!, 10), month, day: parseInt(m[2]!, 10) };
  }

  return null;
}

function normalizeDate(str: string): string {
  const d = parseAnyDate(str);
  if (!d) return str;
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}
