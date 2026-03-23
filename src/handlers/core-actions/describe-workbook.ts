import { createHash } from 'node:crypto';

/** Convert 1-based column index to A1-notation letter(s). E.g., 1→A, 26→Z, 27→AA */
function columnIndexToLetter(col: number): string {
  let result = '';
  let n = col;
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}
import type { sheets_v4, drive_v3 } from 'googleapis';
import type {
  CoreDescribeWorkbookInput,
  CoreWorkbookFingerprintInput,
  CoreResponse,
} from '../../schemas/index.js';
import type { ErrorDetail, MutationSummary, ResponseMeta } from '../../schemas/shared.js';

interface DescribeWorkbookDeps {
  sheetsApi: sheets_v4.Sheets;
  driveApi?: drive_v3.Drive;
  success: (
    action: string,
    data: Record<string, unknown>,
    mutation?: MutationSummary,
    dryRun?: boolean,
    meta?: ResponseMeta
  ) => CoreResponse;
  mapError: (error: unknown) => CoreResponse;
  error: (error: ErrorDetail) => CoreResponse;
}

/**
 * Handler for `describe_workbook` action.
 *
 * Returns a fast, metadata-only structured summary of a workbook:
 * title, sheets count, per-sheet dimensions and formula counts,
 * last modified time, and owner email.
 *
 * Distinct from `get_comprehensive` which performs deep analysis.
 * This action uses lightweight field masks and does NOT include cell data.
 */
export async function handleDescribeWorkbookAction(
  input: CoreDescribeWorkbookInput,
  deps: DescribeWorkbookDeps
): Promise<CoreResponse> {
  try {
    const { spreadsheetId } = input;

    // Pass 1: metadata only — no grid data. Fast and lightweight regardless of spreadsheet size.
    const spreadsheetRes = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields:
        'spreadsheetId,properties(title,locale,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))',
      includeGridData: false,
    });

    const spreadsheet = spreadsheetRes.data;
    const properties = spreadsheet.properties ?? {};
    const sheets = spreadsheet.sheets ?? [];

    // Pass 2: bounded values fetch for formula + cell counts.
    // Cap at MAX_ROWS rows per sheet to prevent full-grid fetches on large workbooks.
    const MAX_ROWS = 2000;
    const sheetMeta = sheets.map((sheet) => {
      const props = sheet.properties ?? {};
      const grid = props.gridProperties ?? {};
      const rowCount = Math.min((grid.rowCount as number) ?? 0, MAX_ROWS);
      const columnCount = (grid.columnCount as number) ?? 0;
      const title = props.title ?? '';
      return {
        name: title,
        sheetId: (props.sheetId as number) ?? 0,
        rowCount: (grid.rowCount as number) ?? 0,
        columnCount,
        // A1 range bounded to MAX_ROWS to avoid full-grid fetch
        range:
          columnCount > 0 && rowCount > 0
            ? `'${title}'!A1:${columnIndexToLetter(columnCount)}${rowCount}`
            : null,
      };
    });

    const rangeQueries = sheetMeta.filter((s) => s.range !== null).map((s) => s.range as string);

    let valueRanges: Array<{ range: string; values?: string[][] }> = [];
    if (rangeQueries.length > 0) {
      try {
        const valuesRes = await deps.sheetsApi.spreadsheets.values.batchGet({
          spreadsheetId,
          ranges: rangeQueries,
          valueRenderOption: 'FORMULA', // See formula strings directly (start with '=')
        });
        valueRanges = (valuesRes.data.valueRanges ?? []) as Array<{
          range: string;
          values?: string[][];
        }>;
      } catch {
        // Best-effort: if values fetch fails, skip formula/cell counting
      }
    }

    // Build a range→values map for O(1) lookup
    const valuesByRange = new Map<string, string[][]>();
    for (const vr of valueRanges) {
      if (vr.range) valuesByRange.set(vr.range, vr.values ?? []);
    }

    let totalFormulaCount = 0;
    let totalNonEmptyCells = 0;

    const sheetSummaries = sheetMeta.map((meta) => {
      let formulaCount = 0;
      let nonEmptyCells = 0;

      if (meta.range) {
        // Try exact range first, then any key that includes the sheet name
        const rows =
          valuesByRange.get(meta.range) ??
          [...valuesByRange.entries()].find(
            ([k]) => k.startsWith(`'${meta.name}'!`) || k.startsWith(`${meta.name}!`)
          )?.[1] ??
          [];

        for (const row of rows) {
          for (const cell of row) {
            if (cell !== '' && cell !== null && cell !== undefined) {
              nonEmptyCells++;
              if (typeof cell === 'string' && cell.startsWith('=')) {
                formulaCount++;
              }
            }
          }
        }
      }

      totalFormulaCount += formulaCount;
      totalNonEmptyCells += nonEmptyCells;

      return {
        name: meta.name,
        sheetId: meta.sheetId,
        rowCount: meta.rowCount,
        columnCount: meta.columnCount,
        formulaCount,
        nonEmptyCells,
        isEmpty: nonEmptyCells === 0,
      };
    });

    // Optionally fetch Drive metadata for last modified time + owner
    let lastModifiedTime: string | undefined;
    let ownerEmail: string | undefined;

    if (deps.driveApi) {
      try {
        const driveRes = await deps.driveApi.files.get({
          fileId: spreadsheetId,
          fields: 'modifiedTime,owners(emailAddress)',
        });
        lastModifiedTime = driveRes.data.modifiedTime ?? undefined;
        const owners = driveRes.data.owners ?? [];
        ownerEmail = owners[0]?.emailAddress ?? undefined;
      } catch {
        // Drive API call is best-effort — don't fail the whole action
      }
    }

    return deps.success('describe_workbook', {
      workbookSummary: {
        title: (properties.title as string) ?? '',
        locale: (properties.locale as string) ?? undefined,
        timeZone: (properties.timeZone as string) ?? undefined,
        sheetCount: sheets.length,
        totalFormulaCount,
        totalCells: totalNonEmptyCells,
        sheets: sheetSummaries,
        lastModifiedTime,
        ownerEmail,
      },
    });
  } catch (err) {
    return deps.mapError(err);
  }
}

/**
 * Handler for `workbook_fingerprint` action.
 *
 * Returns a stable SHA-256 hex fingerprint of the workbook structure:
 * sheet names, row/column counts, and formula counts.
 * Lightweight — uses the same field mask as describe_workbook without grid data.
 */
export async function handleWorkbookFingerprintAction(
  input: CoreWorkbookFingerprintInput,
  deps: Omit<DescribeWorkbookDeps, 'driveApi'>
): Promise<CoreResponse> {
  try {
    const { spreadsheetId } = input;

    // Metadata-only fetch — no grid data. The fingerprint uses sheet structure
    // (names, dimensions) which doesn't require full cell values.
    const spreadsheetRes = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields:
        'spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))',
      includeGridData: false,
    });

    const sheets = spreadsheetRes.data.sheets ?? [];
    const title = spreadsheetRes.data.properties?.title ?? '';

    // Formula counting: bounded per-sheet values fetch (capped at 2000 rows)
    const MAX_ROWS = 2000;
    const rangeQueries = sheets
      .map((sheet) => {
        const props = sheet.properties ?? {};
        const grid = props.gridProperties ?? {};
        const sheetTitle = props.title ?? '';
        const cols = (grid.columnCount as number) ?? 0;
        const rows = Math.min((grid.rowCount as number) ?? 0, MAX_ROWS);
        if (cols === 0 || rows === 0) return null;
        return `'${sheetTitle}'!A1:${columnIndexToLetter(cols)}${rows}`;
      })
      .filter(Boolean) as string[];

    let valueRanges: Array<{ range: string; values?: string[][] }> = [];
    if (rangeQueries.length > 0) {
      try {
        const valuesRes = await deps.sheetsApi.spreadsheets.values.batchGet({
          spreadsheetId,
          ranges: rangeQueries,
          valueRenderOption: 'FORMULA',
        });
        valueRanges = (valuesRes.data.valueRanges ?? []) as Array<{
          range: string;
          values?: string[][];
        }>;
      } catch {
        // Best-effort: fingerprint still works using only sheet structure
      }
    }
    const valuesByRange = new Map<string, string[][]>();
    for (const vr of valueRanges) {
      if (vr.range) valuesByRange.set(vr.range, vr.values ?? []);
    }

    const parts: string[] = [`title:${title}`];
    for (const sheet of sheets) {
      const props = sheet.properties ?? {};
      const grid = props.gridProperties ?? {};
      const sheetTitle = props.title ?? '';
      let formulaCount = 0;
      const rows =
        valuesByRange.get(
          `'${sheetTitle}'!A1:${columnIndexToLetter((grid.columnCount as number) ?? 1)}${Math.min((grid.rowCount as number) ?? 0, MAX_ROWS)}`
        ) ??
        [...valuesByRange.entries()].find(
          ([k]) => k.startsWith(`'${sheetTitle}'!`) || k.startsWith(`${sheetTitle}!`)
        )?.[1] ??
        [];
      for (const row of rows) {
        for (const cell of row) {
          if (typeof cell === 'string' && cell.startsWith('=')) formulaCount++;
        }
      }
      parts.push(
        `sheet:${sheetTitle}|id:${props.sheetId ?? 0}|rows:${grid.rowCount ?? 0}|cols:${grid.columnCount ?? 0}|formulas:${formulaCount}`
      );
    }

    const fingerprintInput = parts.join(';');
    const fingerprint = createHash('sha256').update(fingerprintInput).digest('hex');

    return deps.success('workbook_fingerprint', { fingerprint, fingerprintInput });
  } catch (err) {
    return deps.mapError(err);
  }
}
