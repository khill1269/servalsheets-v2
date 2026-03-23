import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type { SheetsAdvancedInput, AdvancedResponse } from '../../schemas/index.js';
import type { ErrorDetail, MutationSummary, RangeInput } from '../../schemas/shared.js';
import type { GridRangeInput } from '../../utils/google-sheets-helpers.js';
import { toGridRange } from '../../utils/google-sheets-helpers.js';
import { confirmDestructiveAction } from '../../mcp/elicitation.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';
import { recordProtectedRangeId } from '../../mcp/completions.js';

type AdvancedSuccess = Extract<AdvancedResponse, { success: true }>;

type AddProtectedRangeRequest = Extract<
  SheetsAdvancedInput['request'],
  { action: 'add_protected_range' }
>;
type UpdateProtectedRangeRequest = Extract<
  SheetsAdvancedInput['request'],
  { action: 'update_protected_range' }
>;
type DeleteProtectedRangeRequest = Extract<
  SheetsAdvancedInput['request'],
  { action: 'delete_protected_range' }
>;
type ListProtectedRangesRequest = Extract<
  SheetsAdvancedInput['request'],
  { action: 'list_protected_ranges' }
>;

interface ProtectedRangesDeps {
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

function mapProtectedRange(
  pr: sheets_v4.Schema$ProtectedRange,
  deps: ProtectedRangesDeps
): NonNullable<AdvancedSuccess['protectedRange']> {
  return {
    protectedRangeId: pr.protectedRangeId ?? 0,
    range: deps.gridRangeToOutput(pr.range ?? { sheetId: 0 }),
    description: pr.description ?? undefined,
    warningOnly: pr.warningOnly ?? false,
    requestingUserCanEdit: pr.requestingUserCanEdit ?? false,
    editors: pr.editors
      ? {
          groups: pr.editors.groups?.filter((g): g is string => g !== null) ?? undefined,
          users: pr.editors.users?.filter((u): u is string => u !== null) ?? undefined,
          domainUsersCanEdit: pr.editors.domainUsersCanEdit ?? undefined,
        }
      : undefined,
  };
}

export async function handleAddProtectedRangeAction(
  req: AddProtectedRangeRequest,
  deps: ProtectedRangesDeps
): Promise<AdvancedResponse> {
  if (req.safety?.dryRun) {
    return deps.success('add_protected_range', {}, undefined, true);
  }

  // Create snapshot before mutating (allows rollback of protection settings)
  const snapshot = await createSnapshotIfNeeded(
    deps.context.snapshotService,
    {
      operationType: 'add_protected_range',
      isDestructive: false,
      spreadsheetId: req.spreadsheetId,
    },
    req.safety
  );

  // Request confirmation if elicitation available
  if (deps.context.elicitationServer) {
    try {
      const confirmation = await confirmDestructiveAction(
        deps.context.elicitationServer,
        'add_protected_range',
        `Add protection to range ${req.range} in spreadsheet ${req.spreadsheetId}. This will restrict editing for the specified range.`
      );

      if (!confirmation.confirmed) {
        return deps.error({
          code: ErrorCodes.PRECONDITION_FAILED,
          message: confirmation.reason || 'User cancelled the operation',
          retryable: false,
          suggestedFix: 'Review the operation requirements and try again',
        });
      }
    } catch (err) {
      deps.context.logger?.warn(
        `Elicitation failed for add_protected_range, proceeding with operation`,
        {
          error: err,
        }
      );
    }
  }

  const gridRange = await deps.rangeToGridRange(req.spreadsheetId!, req.range!);
  const targetGrid = toGridRange(gridRange);

  // Idempotency guard: check if a protected range already exists on the same range
  try {
    const existing = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId: req.spreadsheetId!,
      fields: 'sheets.protectedRanges,sheets.properties.sheetId',
    });
    for (const sheet of existing.data.sheets ?? []) {
      for (const pr of sheet.protectedRanges ?? []) {
        const r = pr.range;
        if (
          r &&
          r.sheetId === targetGrid.sheetId &&
          r.startRowIndex === targetGrid.startRowIndex &&
          r.endRowIndex === targetGrid.endRowIndex &&
          r.startColumnIndex === targetGrid.startColumnIndex &&
          r.endColumnIndex === targetGrid.endColumnIndex
        ) {
          return deps.success('add_protected_range', {
            protectedRange: mapProtectedRange(pr, deps),
            snapshotId: snapshot?.snapshotId,
            _idempotent: true,
            _hint: `Protected range already exists on this range. Returning existing protection instead of creating a duplicate.`,
          });
        }
      }
    }
  } catch {
    // Non-blocking: proceed with creation if lookup fails
  }

  const request: sheets_v4.Schema$ProtectedRange = {
    range: targetGrid,
    description: req.description,
    warningOnly: req.warningOnly ?? false,
    editors: req.editors,
  };

  const response = await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: req.spreadsheetId!,
    requestBody: {
      requests: [
        {
          addProtectedRange: { protectedRange: request },
        },
      ],
    },
  });

  const protectedRange = response.data?.replies?.[0]?.addProtectedRange?.protectedRange;
  return deps.success('add_protected_range', {
    protectedRange: protectedRange ? mapProtectedRange(protectedRange, deps) : undefined,
    snapshotId: snapshot?.snapshotId,
  });
}

export async function handleUpdateProtectedRangeAction(
  req: UpdateProtectedRangeRequest,
  deps: ProtectedRangesDeps
): Promise<AdvancedResponse> {
  if (req.safety?.dryRun) {
    return deps.success('update_protected_range', {}, undefined, true);
  }

  const update: sheets_v4.Schema$ProtectedRange = {
    protectedRangeId: req.protectedRangeId,
    description: req.description,
    warningOnly: req.warningOnly,
    editors: req.editors,
  };
  const fields: string[] = [];
  if (req.description !== undefined) fields.push('description');
  if (req.warningOnly !== undefined) fields.push('warningOnly');
  if (req.editors !== undefined) fields.push('editors');
  if (req.range) {
    const gridRange = await deps.rangeToGridRange(req.spreadsheetId!, req.range);
    update.range = toGridRange(gridRange);
    fields.push('range');
  }

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: req.spreadsheetId!,
    requestBody: {
      requests: [
        {
          updateProtectedRange: {
            protectedRange: update,
            fields: fields.join(','),
          },
        },
      ],
    },
  });

  return deps.success('update_protected_range', {});
}

export async function handleDeleteProtectedRangeAction(
  req: DeleteProtectedRangeRequest,
  deps: ProtectedRangesDeps
): Promise<AdvancedResponse> {
  if (req.safety?.dryRun) {
    return deps.success('delete_protected_range', {}, undefined, true);
  }

  // Request confirmation if elicitation available
  if (deps.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      deps.context.elicitationServer,
      'delete_protected_range',
      `Delete protected range (ID: ${req.protectedRangeId}) from spreadsheet ${req.spreadsheetId}. This will remove all protection settings. This action cannot be undone.`
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
      operationType: 'delete_protected_range',
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
          deleteProtectedRange: { protectedRangeId: req.protectedRangeId },
        },
      ],
    },
  });

  return deps.success('delete_protected_range', {
    snapshotId: snapshot?.snapshotId,
  });
}

export async function handleListProtectedRangesAction(
  req: ListProtectedRangesRequest,
  deps: ProtectedRangesDeps
): Promise<AdvancedResponse> {
  const response = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: req.spreadsheetId!,
    fields: 'sheets.protectedRanges,sheets.properties(sheetId,title)',
  });

  const allItems: NonNullable<AdvancedSuccess['protectedRanges']> = [];
  for (const sheet of response.data.sheets ?? []) {
    if (req.sheetId !== undefined && sheet.properties?.sheetId !== req.sheetId) continue;
    for (const pr of sheet.protectedRanges ?? []) {
      allItems.push(mapProtectedRange(pr, deps));
    }
  }

  const { page, nextCursor, hasMore, totalCount } = deps.paginateItems(
    allItems,
    req.cursor,
    req.pageSize ?? 100
  );
  for (const pr of page) {
    recordProtectedRangeId(pr.protectedRangeId);
  }

  return deps.success('list_protected_ranges', {
    protectedRanges: page,
    nextCursor,
    hasMore,
    totalCount,
  });
}
