#!/usr/bin/env node
/**
 * ServalSheets Example 1: Basic Read/Write Operations (TypeScript)
 *
 * This example demonstrates:
 * - Reading cell values from a spreadsheet
 * - Writing data to cells
 * - Proper error handling
 * - Basic spreadsheet operations
 * - Full type safety with TypeScript
 *
 * Prerequisites:
 * - Node.js 22+
 * - npm install servalsheets googleapis @types/node
 * - GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_ACCESS_TOKEN set
 * - A Google Spreadsheet with read/write access
 */

import { google, sheets_v4 } from 'googleapis';
import type { AuthClient } from 'google-auth-library';

// ============================================================================
// Types
// ============================================================================

interface ReadResult {
  values: string[][];
  range: string;
  majorDimension?: string;
}

interface WriteResult {
  updatedCells: number;
  updatedRows: number | null | undefined;
  updatedColumns: number | null | undefined;
  updatedRange: string | null | undefined;
}

interface AppendResult {
  updatedCells: number;
  updatedRange: string;
  tableRange?: string | null;
}

interface ClearResult {
  clearedRange: string;
}

// ============================================================================
// Configuration
// ============================================================================

// Replace with your actual spreadsheet ID
// Example: https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
const SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

// Sheet names - adjust to match your spreadsheet
const READ_SHEET = 'Sheet1';
const WRITE_SHEET = 'Sheet1';

// ============================================================================
// Authentication Setup
// ============================================================================

/**
 * Initialize Google Sheets API client
 */
async function getGoogleAuth(): Promise<AuthClient> {
  // Option 1: Service Account (recommended)
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return auth.getClient();
  }

  // Option 2: OAuth Access Token
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
// Example Functions
// ============================================================================

/**
 * Read data from a spreadsheet range
 */
async function readData(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string
): Promise<string[][]> {
  console.log(`\n[READ] Reading from ${range}...`);

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'FORMATTED_VALUE', // Get formatted values
      majorDimension: 'ROWS', // Data organized by rows
    });

    const values = response.data.values as string[][] | undefined;

    if (!values || values.length === 0) {
      console.log('✓ Range is empty');
      return [];
    }

    console.log(`✓ Successfully read ${values.length} rows`);
    console.log('\nFirst 3 rows:');
    values.slice(0, 3).forEach((row, i) => {
      console.log(`  Row ${i + 1}: [${row.join(', ')}]`);
    });

    return values;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ Failed to read data: ${message}`);
    throw error;
  }
}

/**
 * Write data to a spreadsheet range
 */
async function writeData(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string,
  values: (string | number)[][]
): Promise<WriteResult> {
  console.log(`\n[WRITE] Writing ${values.length} rows to ${range}...`);

  try {
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED', // Parse values (formulas, numbers, etc.)
      requestBody: {
        values,
      },
    });

    const updated = response.data.updatedCells || 0;
    const updatedRows = response.data.updatedRows || 0;
    const updatedColumns = response.data.updatedColumns || 0;
    const updatedRange = response.data.updatedRange || range;

    console.log(`✓ Successfully wrote ${updated} cells`);
    console.log(`  Rows affected: ${updatedRows}`);
    console.log(`  Columns affected: ${updatedColumns}`);

    return {
      updatedCells: updated,
      updatedRows,
      updatedColumns,
      updatedRange,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ Failed to write data: ${message}`);
    throw error;
  }
}

/**
 * Append data to the end of a sheet
 */
async function appendData(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string,
  values: (string | number)[][]
): Promise<AppendResult> {
  console.log(`\n[APPEND] Appending ${values.length} rows to ${range}...`);

  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS', // Insert new rows
      requestBody: {
        values,
      },
    });

    const updated = response.data.updates?.updatedCells || 0;
    const updatedRange = response.data.updates?.updatedRange || '';
    const tableRange = response.data.tableRange;

    console.log(`✓ Successfully appended ${updated} cells`);
    console.log(`  Range: ${updatedRange}`);

    return {
      updatedCells: updated,
      updatedRange,
      tableRange,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ Failed to append data: ${message}`);
    throw error;
  }
}

/**
 * Clear data from a range
 */
async function clearData(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string
): Promise<ClearResult> {
  console.log(`\n[CLEAR] Clearing range ${range}...`);

  try {
    const response = await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range,
    });

    const clearedRange = response.data.clearedRange || range;
    console.log(`✓ Successfully cleared ${clearedRange}`);

    return { clearedRange };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ Failed to clear data: ${message}`);
    throw error;
  }
}

// ============================================================================
// Main Example
// ============================================================================

async function main(): Promise<void> {
  console.log('=== ServalSheets Example: Basic Read/Write (TypeScript) ===\n');
  console.log(`Spreadsheet ID: ${SPREADSHEET_ID}`);

  try {
    // Initialize Google Sheets API
    console.log('\n[SETUP] Initializing Google Sheets API...');
    const auth = await getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth: auth as any });
    console.log('✓ API initialized');

    // ========================================================================
    // Example 1: Read existing data
    // ========================================================================
    console.log('\n--- Example 1: Read Data ---');
    const readRange = `${READ_SHEET}!A1:D10`;
    const existingData = await readData(sheets, SPREADSHEET_ID, readRange);

    // ========================================================================
    // Example 2: Write new data
    // ========================================================================
    console.log('\n--- Example 2: Write Data ---');
    const writeRange = `${WRITE_SHEET}!F1:H4`;
    const newData: (string | number)[][] = [
      ['Product', 'Price', 'Stock'], // Header row
      ['Widget A', 29.99, 100], // Data rows
      ['Widget B', 39.99, 50],
      ['Widget C', 19.99, 200],
    ];
    await writeData(sheets, SPREADSHEET_ID, writeRange, newData);

    // ========================================================================
    // Example 3: Verify the write
    // ========================================================================
    console.log('\n--- Example 3: Verify Write ---');
    const verifyData = await readData(sheets, SPREADSHEET_ID, writeRange);
    console.log(
      'Data verification:',
      verifyData.length === newData.length ? '✓ Match' : '✗ Mismatch'
    );

    // ========================================================================
    // Example 4: Append data
    // ========================================================================
    console.log('\n--- Example 4: Append Data ---');
    const appendRange = `${WRITE_SHEET}!F:H`;
    const moreData: (string | number)[][] = [
      ['Widget D', 24.99, 75],
      ['Widget E', 34.99, 125],
    ];
    await appendData(sheets, SPREADSHEET_ID, appendRange, moreData);

    // ========================================================================
    // Example 5: Read formulas
    // ========================================================================
    console.log('\n--- Example 5: Read with Formulas ---');

    // First, write a formula
    const formulaRange = `${WRITE_SHEET}!J1:J2`;
    await writeData(sheets, SPREADSHEET_ID, formulaRange, [
      ['=SUM(G2:G6)'], // Sum of prices
      ['=AVERAGE(H2:H6)'], // Average of stock
    ]);

    // Read it back as formatted values
    console.log('\nFormatted values:');
    const formatted = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: formulaRange,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    console.log('  Result:', formatted.data.values);

    // Read it back as formulas
    console.log('\nFormulas:');
    const formulas = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: formulaRange,
      valueRenderOption: 'FORMULA',
    });
    console.log('  Formula:', formulas.data.values);

    // ========================================================================
    // Example 6: Clear data (cleanup)
    // ========================================================================
    console.log('\n--- Example 6: Clear Test Data ---');
    await clearData(sheets, SPREADSHEET_ID, `${WRITE_SHEET}!F1:J10`);

    // ========================================================================
    // Success!
    // ========================================================================
    console.log('\n=== Example Complete ===');
    console.log('✓ All operations succeeded!');
    console.log('\nKey Takeaways:');
    console.log('  1. Use FORMATTED_VALUE to read user-visible data');
    console.log('  2. Use USER_ENTERED to write formulas and formatted data');
    console.log('  3. Use FORMULA to read formula definitions');
    console.log('  4. Always handle errors with try/catch');
    console.log('  5. Verify writes by reading back the data');
    console.log('  6. TypeScript provides type safety for all operations');
  } catch (error) {
    console.error('\n=== Example Failed ===');

    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);

      if ('code' in error) {
        const code = (error as NodeJS.ErrnoException).code;

        if (code === 'ENOENT') {
          console.error('\nFile not found. Check GOOGLE_APPLICATION_CREDENTIALS path.');
        } else if (error.message.includes('Unable to parse range')) {
          console.error('\nInvalid range format. Use A1 notation (e.g., "Sheet1!A1:D10")');
        } else if (error.message.includes('Requested entity was not found')) {
          console.error('\nSpreadsheet or sheet not found. Check:');
          console.error('  1. Spreadsheet ID is correct');
          console.error('  2. Sheet name matches exactly (case-sensitive)');
          console.error('  3. Service account has access (if using service account)');
        } else if (error.message.includes('insufficient authentication scopes')) {
          console.error('\nInsufficient permissions. Required scope:');
          console.error('  https://www.googleapis.com/auth/spreadsheets');
        }
      }
    } else {
      console.error(`Error: ${String(error)}`);
    }

    process.exit(1);
  }
}

// Run the example
main();
