/**
 * Slicer action handlers for sheets_dimensions.
 * Covers: create_slicer, update_slicer, delete_slicer, list_slicers
 */

import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type {
  DimensionsCreateSlicerInput,
  DimensionsUpdateSlicerInput,
  DimensionsDeleteSlicerInput,
  DimensionsListSlicersInput,
  DimensionsResponse,
} from '../../schemas/index.js';
import { confirmDestructiveAction } from '../../mcp/elicitation.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';
import { parseCellReference, toGridRange } from '../../utils/google-sheets-helpers.js';
import { toApiSlicerFilterCriteria } from '../dimensions-filter-helpers.js';
import type { DimensionsHandlerAccess } from './internal.js';

// ─── handleCreateSlicer ───────────────────────────────────────────────────────

export async function handleCreateSlicer(
  ha: DimensionsHandlerAccess,
  input: DimensionsCreateSlicerInput
): Promise<DimensionsResponse> {
  const dataRange = await ha.rangeToGridRange(input.spreadsheetId, input.dataRange, ha.sheetsApi);

  // Slicer Position Enhancement: Convert simple anchorCell format to Google API's overlayPosition
  // User provides: anchorCell: "P1" (string)
  // Google API expects: overlayPosition.anchorCell: {sheetId, rowIndex, columnIndex} (object)
  // This conversion allows simpler AI instruction format while maintaining API compatibility
  const anchor = parseCellReference(input.position.anchorCell);

  const batchResponse = await ha.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    fields: 'replies',
    requestBody: {
      requests: [
        {
          addSlicer: {
            slicer: {
              spec: {
                title: input.title,
                dataRange: toGridRange(dataRange),
                columnIndex: input.filterColumn,
                ...(input.filterCriteria
                  ? { filterCriteria: toApiSlicerFilterCriteria(input.filterCriteria) }
                  : {}),
              },
              position: {
                overlayPosition: {
                  anchorCell: {
                    sheetId: dataRange.sheetId,
                    rowIndex: anchor.row,
                    columnIndex: anchor.col,
                  },
                  offsetXPixels: input.position.offsetX ?? 0,
                  offsetYPixels: input.position.offsetY ?? 0,
                  widthPixels: input.position.width ?? 200,
                  heightPixels: input.position.height ?? 150,
                },
              },
            },
          },
        },
      ],
    },
  });

  const replies = 'data' in batchResponse ? batchResponse.data?.replies : undefined;
  const slicerId = replies?.[0]?.addSlicer?.slicer?.slicerId ?? undefined;

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_dimensions',
        action: 'create_slicer',
        spreadsheetId: input.spreadsheetId,
        description: `Created slicer`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.success('create_slicer', { slicerId });
}

// ─── handleUpdateSlicer ───────────────────────────────────────────────────────

export async function handleUpdateSlicer(
  ha: DimensionsHandlerAccess,
  input: DimensionsUpdateSlicerInput
): Promise<DimensionsResponse> {
  if (input.safety?.dryRun) {
    return ha.success('update_slicer', {}, undefined, true);
  }

  const spec: sheets_v4.Schema$SlicerSpec = {
    title: input.title,
    columnIndex: input.filterColumn,
    ...(input.filterCriteria
      ? { filterCriteria: toApiSlicerFilterCriteria(input.filterCriteria) }
      : {}),
  };

  await ha.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    fields: 'replies',
    requestBody: {
      requests: [
        {
          updateSlicerSpec: {
            slicerId: input.slicerId,
            spec,
            fields:
              [
                input.title !== undefined ? 'title' : '',
                input.filterColumn !== undefined ? 'columnIndex' : '',
                input.filterCriteria !== undefined ? 'filterCriteria' : '',
              ]
                .filter(Boolean)
                .join(',') || 'title',
          },
        },
      ],
    },
  });

  return ha.success('update_slicer', {});
}

// ─── handleDeleteSlicer ───────────────────────────────────────────────────────

export async function handleDeleteSlicer(
  ha: DimensionsHandlerAccess,
  input: DimensionsDeleteSlicerInput
): Promise<DimensionsResponse> {
  if (input.safety?.dryRun) {
    return ha.success('delete_slicer', {}, undefined, true);
  }

  // Safety: snapshot BEFORE confirmation (backup must exist before user approves)
  await createSnapshotIfNeeded(
    ha.context.snapshotService,
    { operationType: 'delete_slicer', isDestructive: true, spreadsheetId: input.spreadsheetId },
    input.safety
  );

  if (ha.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      ha.context.elicitationServer,
      'delete_slicer',
      `Delete slicer ${input.slicerId} from spreadsheet ${input.spreadsheetId}. This cannot be undone.`
    );
    if (!confirmation.confirmed) {
      return ha.error({
        code: ErrorCodes.PRECONDITION_FAILED,
        message: confirmation.reason || 'User cancelled the operation',
        retryable: false,
        suggestedFix: 'Review the operation requirements and try again',
      });
    }
  }

  await ha.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    fields: 'replies',
    requestBody: {
      requests: [
        {
          deleteEmbeddedObject: { objectId: input.slicerId },
        },
      ],
    },
  });

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_dimensions',
        action: 'delete_slicer',
        spreadsheetId: input.spreadsheetId,
        description: `Deleted slicer`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.success('delete_slicer', {});
}

// ─── handleListSlicers ────────────────────────────────────────────────────────

export async function handleListSlicers(
  ha: DimensionsHandlerAccess,
  input: DimensionsListSlicersInput
): Promise<DimensionsResponse> {
  const response = await ha.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.slicers,sheets.properties.sheetId',
  });

  const slicers = [];
  for (const sheet of response.data.sheets ?? []) {
    if (input.sheetId !== undefined && sheet.properties?.sheetId !== input.sheetId) continue;
    for (const slicer of sheet.slicers ?? []) {
      slicers.push({
        slicerId: slicer.slicerId ?? 0,
        sheetId: sheet.properties?.sheetId ?? 0,
        title: slicer.spec?.title ?? undefined,
        // Full slicer spec (ISSUE-180: was previously omitted)
        columnIndex: slicer.spec?.columnIndex ?? undefined,
        dataRange: slicer.spec?.dataRange ?? undefined,
        filterCriteria: slicer.spec?.filterCriteria ?? undefined,
        horizontalAlignment: slicer.spec?.horizontalAlignment ?? undefined,
        textFormat: slicer.spec?.textFormat ?? undefined,
        backgroundColorStyle: slicer.spec?.backgroundColorStyle ?? undefined,
      });
    }
  }

  return ha.success('list_slicers', { slicers });
}
