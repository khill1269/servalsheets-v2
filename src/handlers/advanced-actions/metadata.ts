import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type { SheetsAdvancedInput, AdvancedResponse } from '../../schemas/index.js';
import type { ErrorDetail, MutationSummary } from '../../schemas/shared.js';
import { confirmDestructiveAction } from '../../mcp/elicitation.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';

type SetMetadataRequest = Extract<SheetsAdvancedInput['request'], { action: 'set_metadata' }>;
type GetMetadataRequest = Extract<SheetsAdvancedInput['request'], { action: 'get_metadata' }>;
type DeleteMetadataRequest = Extract<SheetsAdvancedInput['request'], { action: 'delete_metadata' }>;

interface MetadataDeps {
  sheetsApi: sheets_v4.Sheets;
  context: HandlerContext;
  success: (
    action: string,
    data: Record<string, unknown>,
    mutation?: MutationSummary,
    dryRun?: boolean
  ) => AdvancedResponse;
  error: (error: ErrorDetail) => AdvancedResponse;
}

export async function handleSetMetadataAction(
  req: SetMetadataRequest,
  deps: MetadataDeps
): Promise<AdvancedResponse> {
  // Build location - default to spreadsheet-level if not specified
  const location: sheets_v4.Schema$DeveloperMetadataLocation = req.location ?? {
    spreadsheet: true,
  };

  const response = await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: req.spreadsheetId!,
    requestBody: {
      requests: [
        {
          createDeveloperMetadata: {
            developerMetadata: {
              metadataKey: req.metadataKey,
              metadataValue: req.metadataValue,
              visibility: req.visibility ?? 'DOCUMENT',
              location,
            },
          },
        },
      ],
    },
  });

  const metaId =
    response.data?.replies?.[0]?.createDeveloperMetadata?.developerMetadata?.metadataId;
  return deps.success('set_metadata', { metadataId: metaId ?? undefined });
}

export async function handleGetMetadataAction(
  req: GetMetadataRequest,
  deps: MetadataDeps
): Promise<AdvancedResponse> {
  // Support lookup by metadataId (direct GET) or metadataKey (search) or list all
  if ((req as Record<string, unknown>)['metadataId']) {
    const metadataId = (req as Record<string, unknown>)['metadataId'] as number;
    const response = await deps.sheetsApi.spreadsheets.developerMetadata.get({
      spreadsheetId: req.spreadsheetId!,
      metadataId,
    });
    const m = response.data;
    return deps.success('get_metadata', {
      metadata: {
        metadataId: m.metadataId ?? 0,
        metadataKey: m.metadataKey ?? '',
        metadataValue: m.metadataValue ?? '',
        visibility: (m.visibility ?? 'DOCUMENT') as 'DOCUMENT' | 'PROJECT',
        location: m.location
          ? {
              spreadsheet: m.location.spreadsheet ?? undefined,
              sheetId: m.location.sheetId ?? undefined,
              dimensionRange: m.location.dimensionRange
                ? {
                    sheetId: m.location.dimensionRange.sheetId ?? 0,
                    dimension: (m.location.dimensionRange.dimension ?? 'ROWS') as
                      | 'ROWS'
                      | 'COLUMNS',
                    startIndex: m.location.dimensionRange.startIndex ?? 0,
                    endIndex: m.location.dimensionRange.endIndex ?? 0,
                  }
                : undefined,
            }
          : undefined,
      },
    });
  }

  const response = await deps.sheetsApi.spreadsheets.developerMetadata.search({
    spreadsheetId: req.spreadsheetId!,
    requestBody: {
      dataFilters: req.metadataKey
        ? [
            {
              developerMetadataLookup: { metadataKey: req.metadataKey },
            },
          ]
        : [
            {
              developerMetadataLookup: {},
            },
          ],
    },
  });

  const metadataList = (response.data.matchedDeveloperMetadata ?? []).map((m) => ({
    metadataId: m.developerMetadata?.metadataId ?? 0,
    metadataKey: m.developerMetadata?.metadataKey ?? '',
    metadataValue: m.developerMetadata?.metadataValue ?? '',
  }));

  return deps.success('get_metadata', { metadataList });
}

export async function handleDeleteMetadataAction(
  req: DeleteMetadataRequest,
  deps: MetadataDeps
): Promise<AdvancedResponse> {
  if (req.safety?.dryRun) {
    return deps.success('delete_metadata', {}, undefined, true);
  }

  // Request confirmation if elicitation available
  if (deps.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      deps.context.elicitationServer,
      'delete_metadata',
      `Delete developer metadata (ID: ${req.metadataId}) from spreadsheet ${req.spreadsheetId}. This action cannot be undone.`
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
      operationType: 'delete_metadata',
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
          deleteDeveloperMetadata: {
            dataFilter: {
              developerMetadataLookup: { metadataId: req.metadataId },
            },
          },
        },
      ],
    },
  });

  return deps.success('delete_metadata', {
    snapshotId: snapshot?.snapshotId,
  });
}
