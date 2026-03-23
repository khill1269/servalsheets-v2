/**
 * Audit Log Sheet Service
 *
 * When ENABLE_ACTION_LOG_SHEET=true, appends each mutation event to a designated
 * Google Sheet for persistent audit trail purposes.
 *
 * Row format: [ISO timestamp, tool, action, spreadsheetId, user, success, durationMs]
 */

import type { sheets_v4 } from 'googleapis';
import { logger } from '../utils/logger.js';

const AUDIT_HEADERS = [
  'Timestamp',
  'Tool',
  'Action',
  'SpreadsheetId',
  'User',
  'Success',
  'DurationMs',
];

export interface AuditLogRow {
  timestamp: string;
  tool: string;
  action: string;
  spreadsheetId: string;
  userId: string;
  success: boolean;
  durationMs: number;
}

/**
 * Ensures the audit log sheet exists with headers, then appends the row.
 * All errors are caught and logged — never propagates to caller.
 */
export async function appendAuditLogRow(
  sheetsApi: sheets_v4.Sheets,
  logSpreadsheetId: string,
  sheetName: string,
  row: AuditLogRow
): Promise<void> {
  try {
    await ensureSheetExists(sheetsApi, logSpreadsheetId, sheetName);

    const values = [
      [
        row.timestamp,
        row.tool,
        row.action,
        row.spreadsheetId,
        row.userId,
        row.success,
        row.durationMs,
      ],
    ];

    await sheetsApi.spreadsheets.values.append({
      spreadsheetId: logSpreadsheetId,
      range: `'${sheetName}'!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
  } catch (error) {
    logger.warn('audit-log-sheet: failed to append row', {
      error: error instanceof Error ? error.message : String(error),
      action: row.action,
    });
  }
}

const ensuredSheets = new Set<string>();

async function ensureSheetExists(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string
): Promise<void> {
  const key = `${spreadsheetId}::${sheetName}`;
  if (ensuredSheets.has(key)) return;

  // Check if sheet already has headers
  try {
    const res = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A1:G1`,
    });
    if (res.data.values && res.data.values.length > 0) {
      ensuredSheets.add(key);
      return;
    }
  } catch {
    // Sheet may not exist — attempt to create it below
  }

  // Try to create the sheet tab
  try {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });
  } catch {
    // Sheet may already exist — ignore duplicate error
  }

  // Write headers
  try {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [AUDIT_HEADERS] },
    });
  } catch (error) {
    logger.warn('audit-log-sheet: failed to write headers', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  ensuredSheets.add(key);
}
