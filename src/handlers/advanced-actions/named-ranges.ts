import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type { SheetsAdvancedInput, AdvancedResponse } from '../../schemas/index.js';
import type { ErrorDetail, MutationSummary, RangeInput } from '../../schemas/shared.js';
import type { GridRangeInput } from '../../utils/google-sheets-helpers.js';
import { toGridRange } from '../../utils/google-sheets-helpers.js';
import { confirmDestructiveAction } from '../../mcp/elicitation.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';
import { recordNamedRange } from '../../mcp/completions.js';

type AdvancedSuccess = Extract<AdvancedResponse, { success: true }>;

type AddNamedRangeRequest = Extract<SheetsAdvancedInput['request'], { action: 'add_named_range' }>;
type UpdateNamedRangeRequest = Extract<
  SheetsAdvancedInput['request'],
  { action: 'update_named_range' }
>;
type DeleteNamedRangeRequest = Extract<
  SheetsAdvancedInput['request'],
  { action: 'delete_named_range' }
>;
type ListNamedRangesRequest = Extract<
  SheetsAdvancedInput['request'],
  { action: 'list_named_ranges' }
>;
type GetNamedRangeRequest = Extract<SheetsAdvancedInput['request'], { action: 'get_named_range' }>;

interface NamedRangesDeps {
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
  notFoundError: (resourceType: string, resourceId: string | number) => AdvancedResponse;
}

function mapNamedRange(
  named: sheets_v4.Schema$NamedRange,
  deps: NamedRangesDeps
): NonNullable<AdvancedSuccess['namedRange']> {
  return {
    namedRangeId: named.namedRangeId ?? '',
    name: named.name ?? '',
    range: deps.gridRangeToOutput(named.range ?? { sheetId: 0 }),
  };
}

export async function handleAddNamedRangeAction(
  req: AddNamedRangeRequest,
  deps: NamedRangesDeps
): Promise<AdvancedResponse> {
  // Idempotency guard: check if a named range with the same name already exists
  try {
    const existing = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId: req.spreadsheetId!,
      fields: 'namedRanges',
    });
    const duplicate = (existing.data.namedRanges ?? []).find(
      (n) => n.name === req.name
    );
    if (duplicate) {
      return deps.success('add_named_range', {
        namedRange: mapNamedRange(duplicate, deps),
        _idempotent: true,
        _hint: `Named range "${req.name}" already exists. Returning existing range instead of creating a duplicate.`,
      });
    }
  } catch {
    // Non-blocking: proceed with creation if lookup fails
  }

  const gridRange = await deps.rangeToGridRange(req.spreadsheetId!, req.range!);

  const response = await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: req.spreadsheetId!,
    requestBody: {
      requests: [
        {
          addNamedRange: {
            namedRange: {
              name: req.name!,
              range: toGridRange(gridRange),
            },
          },
        },
      ],
    },
  });

  const namedRange = response.data?.replies?.[0]?.addNamedRange?.namedRange;
  return deps.success('add_named_range', {
    namedRange: namedRange ? mapNamedRange(namedRange, deps) : undefined,
  });
}

export async function handleUpdateNamedRangeAction(
  req: UpdateNamedRangeRequest,
  deps: NamedRangesDeps
): Promise<AdvancedResponse> {
  if (req.safety?.dryRun) {
    return deps.success('update_named_range', {}, undefined, true);
  }

  const update: sheets_v4.Schema$NamedRange = {
    namedRangeId: req.namedRangeId,
    name: req.name,
  };
  if (req.range) {
    const gridRange = await deps.rangeToGridRange(req.spreadsheetId!, req.range);
    update.range = toGridRange(gridRange);
  }

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: req.spreadsheetId!,
    requestBody: {
      requests: [
        {
          updateNamedRange: {
            namedRange: update,
            fields: req.range ? 'name,range' : 'name',
          },
        },
      ],
    },
  });

  return deps.success('update_named_range', {});
}

export async function handleDeleteNamedRangeAction(
  req: DeleteNamedRangeRequest,
  deps: NamedRangesDeps
): Promise<AdvancedResponse> {
  if (req.safety?.dryRun) {
    return deps.success('delete_named_range', {}, undefined, true);
  }

  // Request confirmation if elicitation available
  if (deps.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      deps.context.elicitationServer,
      'delete_named_range',
      `Delete named range (ID: ${req.namedRangeId}) from spreadsheet ${req.spreadsheetId}. This action cannot be undone.`
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
      operationType: 'delete_named_range',
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
          deleteNamedRange: { namedRangeId: req.namedRangeId! },
        },
      ],
    },
  });

  return deps.success('delete_named_range', {
    snapshotId: snapshot?.snapshotId,
  });
}

export async function handleListNamedRangesAction(
  req: ListNamedRangesRequest,
  deps: NamedRangesDeps
): Promise<AdvancedResponse> {
  const response = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: req.spreadsheetId!,
    fields: 'namedRanges',
  });
  const allItems = (response.data.namedRanges ?? []).map((n) => mapNamedRange(n, deps));
  const { page, nextCursor, hasMore, totalCount } = deps.paginateItems(
    allItems,
    req.cursor,
    req.pageSize ?? 100
  );
  // Wire completions: cache named range names for argument autocompletion (ISSUE-062)
  for (const nr of page) {
    if (nr.name) recordNamedRange(nr.name);
  }

  return deps.success('list_named_ranges', {
    namedRanges: page,
    nextCursor,
    hasMore,
    totalCount,
  });
}

export async function handleGetNamedRangeAction(
  req: GetNamedRangeRequest,
  deps: NamedRangesDeps
): Promise<AdvancedResponse> {
  const response = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: req.spreadsheetId!,
    fields: 'namedRanges',
  });
  const match = (response.data.namedRanges ?? []).find((n) => n.name === req.name);
  if (!match) {
    return deps.notFoundError('Named range', req.name!);
  }
  return deps.success('get_named_range', {
    namedRange: mapNamedRange(match, deps),
  });
}
