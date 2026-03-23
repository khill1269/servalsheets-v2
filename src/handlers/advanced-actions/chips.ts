import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type { SheetsAdvancedInput, AdvancedResponse } from '../../schemas/index.js';
import type { ErrorDetail, MutationSummary, RangeInput } from '../../schemas/shared.js';
import type { GridRangeInput, PersonChipDisplayFormat } from '../../utils/google-sheets-helpers.js';
import {
  buildA1Notation,
  toGridRange,
  buildPersonChip,
  buildDriveChip,
  buildRichLinkChip,
  parseChipRuns,
} from '../../utils/google-sheets-helpers.js';

type AddPersonChipRequest = Extract<SheetsAdvancedInput['request'], { action: 'add_person_chip' }>;
type AddDriveChipRequest = Extract<SheetsAdvancedInput['request'], { action: 'add_drive_chip' }>;
type AddRichLinkChipRequest = Extract<
  SheetsAdvancedInput['request'],
  { action: 'add_rich_link_chip' }
>;
type ListChipsRequest = Extract<SheetsAdvancedInput['request'], { action: 'list_chips' }>;

interface ChipsDeps {
  sheetsApi: sheets_v4.Sheets;
  context: HandlerContext;
  sendProgress?: (completed: number, total: number, message?: string) => Promise<void>;
  rangeToGridRange: (spreadsheetId: string, range: RangeInput) => Promise<GridRangeInput>;
  resolveRange: (spreadsheetId: string, range: RangeInput) => Promise<string>;
  validateGridDataSize: (spreadsheetId: string, sheetId?: number) => Promise<unknown | null>;
  paginateItems: <T>(
    items: T[],
    cursor: string | undefined,
    pageSize: number
  ) => { page: T[]; nextCursor: string | undefined; hasMore: boolean; totalCount: number };
  success: (
    action: string,
    data: Record<string, unknown>,
    mutation?: MutationSummary,
    dryRun?: boolean
  ) => AdvancedResponse;
  error: (error: ErrorDetail) => AdvancedResponse;
}

export async function handleAddPersonChipAction(
  req: AddPersonChipRequest,
  deps: ChipsDeps
): Promise<AdvancedResponse> {
  const gridRange = await deps.rangeToGridRange(req.spreadsheetId!, req.range!);

  // Build person chip using chipRuns API (June 2025)
  const cellData = buildPersonChip(req.email, req.displayFormat as PersonChipDisplayFormat);

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: req.spreadsheetId!,
    requestBody: {
      requests: [
        {
          updateCells: {
            range: toGridRange(gridRange),
            rows: [{ values: [cellData] }],
            fields: 'userEnteredValue,chipRuns',
          },
        },
      ],
    },
  });

  const cellA1 = buildA1Notation(
    '',
    gridRange.startColumnIndex ?? 0,
    gridRange.startRowIndex ?? 0,
    (gridRange.startColumnIndex ?? 0) + 1,
    (gridRange.startRowIndex ?? 0) + 1
  );

  return deps.success('add_person_chip', {
    chip: {
      type: 'person' as const,
      cell: cellA1,
      email: req.email,
      displayText: cellData.userEnteredValue?.stringValue ?? req.email,
    },
  });
}

export async function handleAddDriveChipAction(
  req: AddDriveChipRequest,
  deps: ChipsDeps
): Promise<AdvancedResponse> {
  // Validate Drive scope (P3-5: Drive file access required for Drive chips)
  // Accept either drive.file or the broader drive scope (which is a superset)
  const scopes = deps.context.auth?.scopes ?? [];
  const hasDriveScope =
    scopes.includes('https://www.googleapis.com/auth/drive.file') ||
    scopes.includes('https://www.googleapis.com/auth/drive');
  if (!hasDriveScope) {
    return deps.error({
      code: ErrorCodes.INCREMENTAL_SCOPE_REQUIRED,
      message:
        'Drive file access required. Please grant drive.file or drive scope to write Drive chips.',
      retryable: true,
      suggestedFix: 'Grant the required permissions when prompted',
      details: {
        requiredScope: 'https://www.googleapis.com/auth/drive.file',
        currentScopes: scopes,
      },
    });
  }

  const gridRange = await deps.rangeToGridRange(req.spreadsheetId!, req.range!);

  // Build Drive chip using chipRuns API (June 2025)
  const cellData = buildDriveChip(req.fileId, req.displayText);
  const driveUri = `https://drive.google.com/file/d/${req.fileId}/view`;

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: req.spreadsheetId!,
    requestBody: {
      requests: [
        {
          updateCells: {
            range: toGridRange(gridRange),
            rows: [{ values: [cellData] }],
            fields: 'userEnteredValue,chipRuns',
          },
        },
      ],
    },
  });

  const cellA1 = buildA1Notation(
    '',
    gridRange.startColumnIndex ?? 0,
    gridRange.startRowIndex ?? 0,
    (gridRange.startColumnIndex ?? 0) + 1,
    (gridRange.startRowIndex ?? 0) + 1
  );

  return deps.success('add_drive_chip', {
    chip: {
      type: 'drive' as const,
      cell: cellA1,
      fileId: req.fileId,
      uri: driveUri,
      displayText: cellData.userEnteredValue?.stringValue ?? req.fileId,
    },
  });
}

export async function handleAddRichLinkChipAction(
  req: AddRichLinkChipRequest,
  deps: ChipsDeps
): Promise<AdvancedResponse> {
  // Validate Drive scope (P3-5: Drive file access required for rich link chips)
  // Accept either drive.file or the broader drive scope (which is a superset)
  const scopes = deps.context.auth?.scopes ?? [];
  const hasDriveScope =
    scopes.includes('https://www.googleapis.com/auth/drive.file') ||
    scopes.includes('https://www.googleapis.com/auth/drive');
  if (!hasDriveScope) {
    return deps.error({
      code: ErrorCodes.INCREMENTAL_SCOPE_REQUIRED,
      message:
        'Drive file access required. Please grant drive.file or drive scope to write rich link chips.',
      retryable: true,
      suggestedFix: 'Grant the required permissions when prompted',
      details: {
        requiredScope: 'https://www.googleapis.com/auth/drive.file',
        currentScopes: scopes,
      },
    });
  }

  const gridRange = await deps.rangeToGridRange(req.spreadsheetId!, req.range!);

  // Build rich link chip using chipRuns API (June 2025)
  const cellData = buildRichLinkChip(req.uri, req.displayText);

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: req.spreadsheetId!,
    requestBody: {
      requests: [
        {
          updateCells: {
            range: toGridRange(gridRange),
            rows: [{ values: [cellData] }],
            fields: 'userEnteredValue,chipRuns',
          },
        },
      ],
    },
  });

  const cellA1 = buildA1Notation(
    '',
    gridRange.startColumnIndex ?? 0,
    gridRange.startRowIndex ?? 0,
    (gridRange.startColumnIndex ?? 0) + 1,
    (gridRange.startRowIndex ?? 0) + 1
  );

  return deps.success('add_rich_link_chip', {
    chip: {
      type: 'rich_link' as const,
      cell: cellA1,
      uri: req.uri,
      displayText: cellData.userEnteredValue?.stringValue ?? req.uri,
    },
  });
}

export async function handleListChipsAction(
  req: ListChipsRequest,
  deps: ChipsDeps
): Promise<AdvancedResponse> {
  // ISSUE-019: Require range to prevent unbounded full-grid fetch (chipRuns requires includeGridData)
  if (!req.range) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message:
        'list_chips requires a range parameter to prevent fetching the entire spreadsheet. Use A1 notation (e.g., "Sheet1!A1:Z100").',
      retryable: false,
      suggestedFix: 'Add a range param like "Sheet1!A1:Z1000" to scope the chip search.',
    });
  }

  // Validate spreadsheet size before loading grid data
  const sizeError = await deps.validateGridDataSize(req.spreadsheetId!, req.sheetId);
  if (sizeError) return sizeError as AdvancedResponse;

  // Get cell data with chipRuns using optimized field mask
  // Note: includeGridData is expensive but required for chipRuns
  // Scope to the requested range if provided to avoid fetching all cells
  const rangeParam = req.range
    ? [await deps.resolveRange(req.spreadsheetId!, req.range)]
    : undefined;
  const response = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: req.spreadsheetId!,
    includeGridData: true,
    ranges: rangeParam,
    fields: 'sheets(properties.sheetId,data.rowData.values(chipRuns,formattedValue))',
  });

  const chips: Array<{
    type: 'person' | 'drive' | 'rich_link';
    cell: string;
    email?: string;
    fileId?: string;
    uri?: string;
    displayText?: string;
  }> = [];
  // ISSUE-124: Track chips that have chipRuns but couldn't be mapped to a known type
  let skippedChips = 0;

  const sheetsToScan = (response.data.sheets ?? []).filter((sheet) => {
    const sheetId = sheet.properties?.sheetId;
    return req.sheetId === undefined || sheetId === req.sheetId;
  });
  const shouldReportProgress = sheetsToScan.length >= 2 && typeof deps.sendProgress === 'function';
  let scannedSheets = 0;

  if (shouldReportProgress) {
    try {
      await deps.sendProgress!(
        0,
        sheetsToScan.length,
        `Scanning chips in ${sheetsToScan.length} sheet(s)...`
      );
    } catch {
      // Best-effort progress reporting.
    }
  }

  for (const sheet of sheetsToScan) {
    for (const gridData of sheet.data ?? []) {
      const startRow = gridData.startRow ?? 0;
      const startCol = gridData.startColumn ?? 0;

      for (let rowIdx = 0; rowIdx < (gridData.rowData?.length ?? 0); rowIdx++) {
        const row = gridData.rowData?.[rowIdx];
        for (let colIdx = 0; colIdx < (row?.values?.length ?? 0); colIdx++) {
          const cell = row?.values?.[colIdx];

          const cellA1 = buildA1Notation(
            '',
            startCol + colIdx,
            startRow + rowIdx,
            startCol + colIdx + 1,
            startRow + rowIdx + 1
          );

          // Parse chip using chipRuns API (ISSUE-124: catch parse errors)
          let parsedChip;
          try {
            parsedChip = parseChipRuns(cell ?? {}, cellA1);
          } catch (parseError) {
            deps.context.logger?.warn('chip_parse_failure', {
              cellA1,
              error: parseError instanceof Error ? parseError.message : String(parseError),
            });
            skippedChips++;
            continue;
          }
          if (!parsedChip) continue;

          // Filter by type
          if (req.chipType !== 'all' && parsedChip.type !== req.chipType) continue;

          // Only include person, drive, and rich_link chips; count unknown as skipped
          if (
            parsedChip.type === 'person' ||
            parsedChip.type === 'drive' ||
            parsedChip.type === 'rich_link'
          ) {
            chips.push(
              parsedChip as typeof parsedChip & {
                type: 'person' | 'drive' | 'rich_link';
              }
            );
          } else {
            // ISSUE-124: 'unknown' chip type — log and count as skipped
            deps.context.logger?.warn('chip_unknown_type', { cellA1, type: parsedChip.type });
            skippedChips++;
          }
        }
      }
    }

    scannedSheets += 1;
    if (shouldReportProgress) {
      try {
        await deps.sendProgress!(
          scannedSheets,
          sheetsToScan.length,
          scannedSheets === sheetsToScan.length
            ? `Chip scan complete: ${scannedSheets}/${sheetsToScan.length} sheet(s)`
            : `Scanned chips in ${scannedSheets}/${sheetsToScan.length} sheet(s)...`
        );
      } catch {
        // Best-effort progress reporting.
      }
    }
  }

  const { page, nextCursor, hasMore, totalCount } = deps.paginateItems(
    chips,
    req.cursor,
    req.pageSize ?? 100
  );
  return deps.success('list_chips', {
    chips: page,
    skippedChips,
    nextCursor,
    hasMore,
    totalCount,
  });
}
