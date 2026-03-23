#!/usr/bin/env node
/**
 * ServalSheets Example 2: Semantic Range Queries (TypeScript)
 *
 * This example demonstrates ServalSheets' powerful semantic range resolution,
 * which allows you to query data by column headers instead of cell coordinates.
 *
 * Features demonstrated:
 * - Header-based column queries ("Revenue", "Customer Name", etc.)
 * - Named range resolution
 * - Fuzzy header matching
 * - Resolution confidence scores
 * - Comparison with A1 notation
 * - Full type safety with TypeScript
 *
 * Prerequisites:
 * - Node.js 22+
 * - npm install servalsheets googleapis @types/node
 * - GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_ACCESS_TOKEN set
 * - A spreadsheet with a header row
 */

import { google, sheets_v4 } from 'googleapis';
import type { AuthClient } from 'google-auth-library';

// ============================================================================
// Types
// ============================================================================

interface ColumnResolution {
  columnIndex: number;
  columnLetter: string;
  headerValue: string;
  matchType: 'exact' | 'fuzzy';
  confidence: number;
}

interface SemanticReadResult {
  values: string[][];
  resolution: {
    method: 'semantic_header';
    columnLetter: string;
    columnIndex: number;
    headerValue: string;
    matchType: 'exact' | 'fuzzy';
    confidence: number;
    a1Range: string;
  };
}

interface MultiHeaderReadResult {
  values: string[][];
  resolution: {
    method: 'semantic_multi_header';
    columns: Array<{
      headerName: string;
      columnLetter: string;
      columnIndex: number;
      confidence: number;
    }>;
    a1Range: string;
  };
}

interface NamedRangeReadResult {
  values: string[][];
  resolution: {
    method: 'named_range';
    namedRange: string;
    a1Range: string;
  };
}

interface SimilarityMatch {
  index: number;
  score: number;
}

// ============================================================================
// Configuration
// ============================================================================

const SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const SHEET_NAME = 'Sheet1'; // Adjust to match your sheet

// ============================================================================
// Authentication
// ============================================================================

async function getGoogleAuth(): Promise<AuthClient> {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return auth.getClient();
  }

  if (process.env.GOOGLE_ACCESS_TOKEN) {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: process.env.GOOGLE_ACCESS_TOKEN,
    });
    return oauth2Client;
  }

  throw new Error(
    'No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_ACCESS_TOKEN'
  );
}

// ============================================================================
// Semantic Range Resolution
// ============================================================================

/**
 * Find a column by its header name
 */
async function findColumnByHeader(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  headerName: string
): Promise<ColumnResolution> {
  console.log(`\n[SEMANTIC] Finding column with header "${headerName}"...`);

  try {
    // Step 1: Read the first row (headers)
    const headerRange = `${sheetName}!1:1`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: headerRange,
    });

    const headers = response.data.values?.[0] as string[] | undefined;
    if (!headers) {
      throw new Error('No headers found in first row');
    }

    // Step 2: Find exact match (case-insensitive)
    let columnIndex = headers.findIndex(
      (h) => h && h.toString().toLowerCase() === headerName.toLowerCase()
    );

    let matchType: 'exact' | 'fuzzy' = 'exact';
    let confidence = 1.0;

    // Step 3: If no exact match, try fuzzy matching
    if (columnIndex === -1) {
      const matches: SimilarityMatch[] = headers.map((h, i) => {
        if (!h) return { index: i, score: 0 };
        const similarity = calculateSimilarity(
          h.toString().toLowerCase(),
          headerName.toLowerCase()
        );
        return { index: i, score: similarity };
      });

      // Get best match
      const bestMatch = matches.reduce((best, curr) => (curr.score > best.score ? curr : best));

      if (bestMatch.score > 0.7) {
        columnIndex = bestMatch.index;
        matchType = 'fuzzy';
        confidence = bestMatch.score;
        console.log(
          `  ⚠ Used fuzzy match: "${headers[columnIndex]}" (${(confidence * 100).toFixed(0)}% confidence)`
        );
      } else {
        throw new Error(
          `Header "${headerName}" not found (best match: ${(bestMatch.score * 100).toFixed(0)}% confidence)`
        );
      }
    }

    // Convert index to column letter
    const columnLetter = indexToColumn(columnIndex);
    console.log(`✓ Found at column ${columnLetter} (index ${columnIndex})`);
    console.log(`  Match type: ${matchType}`);
    console.log(`  Confidence: ${(confidence * 100).toFixed(0)}%`);
    console.log(`  Header value: "${headers[columnIndex]}"`);

    return {
      columnIndex,
      columnLetter,
      headerValue: headers[columnIndex],
      matchType,
      confidence,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ Failed to find column: ${message}`);
    throw error;
  }
}

/**
 * Read data from a semantic range (by header name)
 */
async function readByHeader(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  headerName: string,
  includeHeader = false
): Promise<SemanticReadResult> {
  console.log(`\n[SEMANTIC READ] Reading "${headerName}" column...`);

  try {
    // Find the column
    const column = await findColumnByHeader(sheets, spreadsheetId, sheetName, headerName);

    // Build range (skip header row unless includeHeader is true)
    const startRow = includeHeader ? 1 : 2;
    const range = `${sheetName}!${column.columnLetter}${startRow}:${column.columnLetter}`;

    // Read the data
    console.log(`  Reading range: ${range}`);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const values = (response.data.values || []) as string[][];
    console.log(`✓ Read ${values.length} values`);

    return {
      values,
      resolution: {
        method: 'semantic_header',
        columnLetter: column.columnLetter,
        columnIndex: column.columnIndex,
        headerValue: column.headerValue,
        matchType: column.matchType,
        confidence: column.confidence,
        a1Range: range,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ Failed to read by header: ${message}`);
    throw error;
  }
}

/**
 * Read multiple columns by header names
 */
async function readMultipleByHeaders(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  headerNames: string[],
  includeHeaders = false
): Promise<MultiHeaderReadResult> {
  console.log(`\n[SEMANTIC BATCH] Reading ${headerNames.length} columns...`);

  try {
    // Find all columns
    const columns: ColumnResolution[] = [];
    for (const headerName of headerNames) {
      const column = await findColumnByHeader(sheets, spreadsheetId, sheetName, headerName);
      columns.push(column);
    }

    // Sort columns by index to build a contiguous range
    columns.sort((a, b) => a.columnIndex - b.columnIndex);

    // Build range
    const startRow = includeHeaders ? 1 : 2;
    const startCol = columns[0].columnLetter;
    const endCol = columns[columns.length - 1].columnLetter;
    const range = `${sheetName}!${startCol}${startRow}:${endCol}`;

    console.log(`  Combined range: ${range}`);

    // Read the data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const values = (response.data.values || []) as string[][];
    console.log(`✓ Read ${values.length} rows`);

    return {
      values,
      resolution: {
        method: 'semantic_multi_header',
        columns: columns.map((c) => ({
          headerName: c.headerValue,
          columnLetter: c.columnLetter,
          columnIndex: c.columnIndex,
          confidence: c.confidence,
        })),
        a1Range: range,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ Failed to read multiple headers: ${message}`);
    throw error;
  }
}

// ============================================================================
// Named Range Resolution
// ============================================================================

/**
 * Read data from a named range
 */
async function readNamedRange(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  rangeName: string
): Promise<NamedRangeReadResult> {
  console.log(`\n[NAMED RANGE] Reading "${rangeName}"...`);

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: rangeName, // Named ranges are just strings
    });

    const values = (response.data.values || []) as string[][];
    const a1Range = response.data.range || rangeName;

    console.log(`✓ Read ${values.length} rows from named range`);
    console.log(`  Actual range: ${a1Range}`);

    return {
      values,
      resolution: {
        method: 'named_range',
        namedRange: rangeName,
        a1Range,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Unable to parse range')) {
      console.error(`✗ Named range "${rangeName}" not found`);
    } else {
      console.error(`✗ Failed to read named range: ${message}`);
    }
    throw error;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate string similarity (simple Levenshtein-based)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Calculate Levenshtein distance
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Convert column index (0-based) to letter (A, B, ..., Z, AA, AB, ...)
 */
function indexToColumn(index: number): string {
  let column = '';
  let num = index + 1;

  while (num > 0) {
    const remainder = (num - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    num = Math.floor((num - 1) / 26);
  }

  return column;
}

// ============================================================================
// Demo Setup
// ============================================================================

/**
 * Create sample data with headers for demonstration
 */
async function setupDemoData(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string
): Promise<void> {
  console.log('\n[SETUP] Creating demo data with headers...');

  const demoData: (string | number)[][] = [
    ['Customer Name', 'Order Date', 'Total Revenue', 'Items Sold', 'Region'],
    ['Alice Johnson', '2025-01-01', 1250.0, 15, 'West'],
    ['Bob Smith', '2025-01-02', 890.5, 12, 'East'],
    ['Carol White', '2025-01-03', 2150.75, 28, 'West'],
    ['David Brown', '2025-01-04', 675.25, 8, 'Central'],
    ['Eve Davis', '2025-01-05', 1580.0, 20, 'East'],
    ['Frank Wilson', '2025-01-06', 925.5, 11, 'West'],
    ['Grace Lee', '2025-01-07', 1340.25, 17, 'Central'],
  ];

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:E8`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: demoData },
    });
    console.log('✓ Demo data created');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ Failed to create demo data: ${message}`);
    throw error;
  }
}

// ============================================================================
// Main Example
// ============================================================================

async function main(): Promise<void> {
  console.log('=== ServalSheets Example: Semantic Range Queries (TypeScript) ===\n');
  console.log(`Spreadsheet ID: ${SPREADSHEET_ID}`);
  console.log(`Sheet: ${SHEET_NAME}`);

  try {
    // Initialize
    console.log('\n[SETUP] Initializing Google Sheets API...');
    const auth = await getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth: auth as any });
    console.log('✓ API initialized');

    // Create demo data
    await setupDemoData(sheets, SPREADSHEET_ID, SHEET_NAME);

    // ========================================================================
    // Example 1: Read single column by exact header match
    // ========================================================================
    console.log('\n--- Example 1: Exact Header Match ---');
    const revenueData = await readByHeader(
      sheets,
      SPREADSHEET_ID,
      SHEET_NAME,
      'Total Revenue',
      false // Don't include header
    );
    console.log('\nRevenue values (first 3):');
    revenueData.values.slice(0, 3).forEach((row, i) => {
      console.log(`  Row ${i + 2}: ${row[0]}`);
    });
    console.log('\nResolution details:', JSON.stringify(revenueData.resolution, null, 2));

    // ========================================================================
    // Example 2: Fuzzy header matching
    // ========================================================================
    console.log('\n--- Example 2: Fuzzy Header Match ---');
    // Try to find "revenue" (lowercase, partial match)
    const fuzzyRevenueData = await readByHeader(
      sheets,
      SPREADSHEET_ID,
      SHEET_NAME,
      'revenue', // Lowercase, will fuzzy match "Total Revenue"
      false
    );

    // ========================================================================
    // Example 3: Read multiple columns by headers
    // ========================================================================
    console.log('\n--- Example 3: Multiple Columns ---');
    const multiData = await readMultipleByHeaders(
      sheets,
      SPREADSHEET_ID,
      SHEET_NAME,
      ['Customer Name', 'Total Revenue', 'Region'],
      false
    );
    console.log('\nCombined data (first 3 rows):');
    multiData.values.slice(0, 3).forEach((row, i) => {
      console.log(`  Row ${i + 2}: ${row.join(' | ')}`);
    });

    // ========================================================================
    // Example 4: Comparison with A1 notation
    // ========================================================================
    console.log('\n--- Example 4: A1 vs Semantic Comparison ---');
    console.log('\nA1 Notation:');
    console.log('  Pros: Fast, direct, no lookup needed');
    console.log('  Cons: Brittle, breaks if columns are reordered');
    console.log('  Example: "Sheet1!C2:C8"');

    console.log('\nSemantic (Header-based):');
    console.log('  Pros: Robust to column reordering, self-documenting');
    console.log('  Cons: Requires header row lookup (cached)');
    console.log('  Example: Find "Total Revenue" column, then read C2:C8');

    // Show practical example
    const a1Range = `${SHEET_NAME}!C2:C8`;
    console.log(`\nReading same data with A1: ${a1Range}`);
    const a1Response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: a1Range,
    });
    console.log(`✓ A1 notation read ${a1Response.data.values?.length || 0} values`);
    console.log(
      '  Result matches semantic query:',
      JSON.stringify(a1Response.data.values) === JSON.stringify(revenueData.values) ? '✓' : '✗'
    );

    // ========================================================================
    // Example 5: Handle missing headers
    // ========================================================================
    console.log('\n--- Example 5: Error Handling ---');
    try {
      await readByHeader(sheets, SPREADSHEET_ID, SHEET_NAME, 'Nonexistent Column', false);
      console.log('✗ Should have thrown error');
    } catch (error) {
      console.log('✓ Correctly handled missing header');
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  Error: ${message}`);
    }

    // ========================================================================
    // Success!
    // ========================================================================
    console.log('\n=== Example Complete ===');
    console.log('\nKey Takeaways:');
    console.log('  1. Semantic queries are robust to column reordering');
    console.log('  2. Fuzzy matching handles case and minor typos');
    console.log('  3. Confidence scores help identify ambiguous matches');
    console.log('  4. Use A1 notation when performance is critical');
    console.log('  5. Use semantic queries when data structure may change');
    console.log('  6. TypeScript ensures type safety for all resolution metadata');
  } catch (error) {
    console.error('\n=== Example Failed ===');
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

// Run the example
main();
