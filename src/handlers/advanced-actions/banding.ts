import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type { SheetsAdvancedInput, AdvancedResponse } from '../../schemas/index.js';
import type { ErrorDetail, MutationSummary, RangeInput } from '../../schemas/shared.js';
import type { GridRangeInput } from '../../utils/google-sheets-helpers.js';
import { toGridRange } from '../../utils/google-sheets-helpers.js';
import { confirmDestructiveAction } from '../../mcp/elicitation.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';
import { recordBandingId } from '../../mcp/completions.js';

type AdvancedSuccess = Extract<AdvancedResponse, { success: true }>;

type AddBandingRequest = Extract<SheetsAdvancedInput['request'], { action: 'add_banding' }>;
type UpdateBandingRequest = Extract<SheetsAdvancedInput['request'], { action: 'update_banding' }>;
type DeleteBandingRequest = Extract<SheetsAdvancedInput['request'], { action: 'delete_banding' }>;
type ListBandingRequest = Extract<SheetsAdvancedInput['request'], { action: 'list_banding' }>;

interface BandingDeps {
  sheetsApi: sheets_v4.Sheets;
  context: HandlerContext;
  rangeToGridRange: (spreadsheetId: string, range: RangeInput) => Promise<GridRangeInput>;
  gridRangeToOutput: (range: sheets_v4.Schema$GridRange) => GridRangeInput;
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

export async function handleAddBandingAction(
  req: AddBandingRequest,
  deps: BandingDeps
): Promise<AdvancedResponse> {
  // Pre-validation: Catch common LLM parameter errors before API call
  if (!req.range) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message:
        'Missing required "range" parameter. Specify the range to apply banding (e.g., "Sheet1!A1:D10").',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  // Validate that at least one of rowProperties or columnProperties is provided
  if (!req.rowProperties && !req.columnProperties) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message:
        'Banding requires either "rowProperties" or "columnProperties". ' +
        'Example: rowProperties: { headerColor: { red: 0.2, green: 0.4, blue: 0.8 }, ' +
        'firstBandColor: { red: 1, green: 1, blue: 1 }, secondBandColor: { red: 0.9, green: 0.9, blue: 0.9 } }',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  // Validate color values are in 0-1 range (common LLM mistake: using 0-255)
  const validateColors = (
    props: typeof req.rowProperties | typeof req.columnProperties,
    propName: string
  ): AdvancedResponse | null => {
    if (!props) return null;
    const colorFields = [
      'headerColor',
      'firstBandColor',
      'secondBandColor',
      'footerColor',
    ] as const;
    for (const field of colorFields) {
      const color = props[field];
      if (color) {
        const { red = 0, green = 0, blue = 0 } = color;
        if (red > 1 || green > 1 || blue > 1) {
          return deps.error({
            code: ErrorCodes.INVALID_PARAMS,
            message:
              `Color values in ${propName}.${field} must be between 0 and 1 (not 0-255). ` +
              `Received: red=${red}, green=${green}, blue=${blue}. ` +
              `Example: { red: 0.2, green: 0.4, blue: 0.8 } for a blue color.`,
            retryable: false,
            suggestedFix:
              'Check the parameter format and ensure all required parameters are provided',
          });
        }
      }
    }
    return null;
  };

  const rowColorError = validateColors(req.rowProperties, 'rowProperties');
  if (rowColorError) return rowColorError;
  const colColorError = validateColors(req.columnProperties, 'columnProperties');
  if (colColorError) return colColorError;

  const gridRange = await deps.rangeToGridRange(req.spreadsheetId!, req.range!);
  const targetGrid = toGridRange(gridRange);

  // Idempotency guard: check if banding already exists on the same range
  try {
    const existing = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId: req.spreadsheetId!,
      fields: 'sheets.bandedRanges,sheets.properties.sheetId',
    });
    for (const sheet of existing.data.sheets ?? []) {
      for (const br of sheet.bandedRanges ?? []) {
        const r = br.range;
        if (
          r &&
          r.sheetId === targetGrid.sheetId &&
          r.startRowIndex === targetGrid.startRowIndex &&
          r.endRowIndex === targetGrid.endRowIndex &&
          r.startColumnIndex === targetGrid.startColumnIndex &&
          r.endColumnIndex === targetGrid.endColumnIndex
        ) {
          return deps.success('add_banding', {
            bandedRangeId: br.bandedRangeId ?? undefined,
            _idempotent: true,
            _hint: `Banding already exists on this range. Returning existing banding ID instead of creating a duplicate.`,
          });
        }
      }
    }
  } catch {
    // Non-blocking: proceed with creation if lookup fails
  }

  const response = await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: req.spreadsheetId!,
    requestBody: {
      requests: [
        {
          addBanding: {
            bandedRange: {
              range: targetGrid,
              rowProperties: req.rowProperties,
              columnProperties: req.columnProperties,
            },
          },
        },
      ],
    },
  });

  const bandedRangeId = response.data?.replies?.[0]?.addBanding?.bandedRange?.bandedRangeId;
  return deps.success('add_banding', {
    bandedRangeId: bandedRangeId ?? undefined,
  });
}

export async function handleUpdateBandingAction(
  req: UpdateBandingRequest,
  deps: BandingDeps
): Promise<AdvancedResponse> {
  if (req.safety?.dryRun) {
    return deps.success('update_banding', {}, undefined, true);
  }

  const fields: string[] = [];
  if (req.rowProperties !== undefined) fields.push('rowProperties');
  if (req.columnProperties !== undefined) fields.push('columnProperties');

  // BUG-13 fix: Google API requires non-empty fields mask for updateBanding.
  // Return a clear error instead of sending an invalid request.
  if (fields.length === 0) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message:
        'At least one of rowProperties or columnProperties must be provided for update_banding.',
      retryable: false,
      suggestedFix:
        'Provide rowProperties and/or columnProperties with color definitions (headerColor, firstBandColor, secondBandColor).',
    });
  }

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: req.spreadsheetId!,
    requestBody: {
      requests: [
        {
          updateBanding: {
            bandedRange: {
              bandedRangeId: req.bandedRangeId,
              rowProperties: req.rowProperties,
              columnProperties: req.columnProperties,
            },
            fields: fields.join(','),
          },
        },
      ],
    },
  });

  return deps.success('update_banding', {});
}

export async function handleDeleteBandingAction(
  req: DeleteBandingRequest,
  deps: BandingDeps
): Promise<AdvancedResponse> {
  if (req.safety?.dryRun) {
    return deps.success('delete_banding', {}, undefined, true);
  }

  // Request confirmation if elicitation available
  if (deps.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      deps.context.elicitationServer,
      'delete_banding',
      `Delete banding (ID: ${req.bandedRangeId}) from spreadsheet ${req.spreadsheetId}. This will remove alternating color formatting. This action cannot be undone.`
    );

    if (!confirmation.confirmed) {
      return deps.error({
        code: ErrorCodes.PRECONDITION_FAILED,
        message: confirmation.reason || 'User cancelled the operation',
        retryable: false,
        suggestedFix: 'Review the operation requirements and try again',
      });
    }
  }

  // Create snapshot if requested
  const snapshot = await createSnapshotIfNeeded(
    deps.context.snapshotService,
    {
      operationType: 'delete_banding',
      isDestructive: true,
      spreadsheetId: req.spreadsheetId,
    },
    req.safety
  );

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: req.spreadsheetId!,
    requestBody: {
      requests: [
        {
          deleteBanding: { bandedRangeId: req.bandedRangeId },
        },
      ],
    },
  });

  return deps.success('delete_banding', {
    snapshotId: snapshot?.snapshotId,
  });
}

export async function handleListBandingAction(
  req: ListBandingRequest,
  deps: BandingDeps
): Promise<AdvancedResponse> {
  const response = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: req.spreadsheetId!,
    fields: 'sheets.bandedRanges,sheets.properties.sheetId',
  });

  const allItems: NonNullable<AdvancedSuccess['bandedRanges']> = [];
  for (const sheet of response.data.sheets ?? []) {
    if (req.sheetId !== undefined && sheet.properties?.sheetId !== req.sheetId) continue;
    for (const br of sheet.bandedRanges ?? []) {
      allItems.push({
        bandedRangeId: br.bandedRangeId ?? 0,
        range: deps.gridRangeToOutput(br.range ?? { sheetId: sheet.properties?.sheetId ?? 0 }),
      });
    }
  }

  const { page, nextCursor, hasMore, totalCount } = deps.paginateItems(
    allItems,
    req.cursor,
    req.pageSize ?? 100
  );
  for (const b of page) {
    recordBandingId(b.bandedRangeId);
  }

  return deps.success('list_banding', {
    bandedRanges: page,
    nextCursor,
    hasMore,
    totalCount,
  });
}
