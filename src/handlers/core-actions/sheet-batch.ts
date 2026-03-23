import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type {
  CoreBatchDeleteSheetsInput,
  CoreBatchUpdateSheetsInput,
  CoreClearSheetInput,
  CoreMoveSheetInput,
  CoreResponse,
} from '../../schemas/index.js';
import type { ErrorDetail } from '../../schemas/shared.js';
import { confirmDestructiveAction } from '../../mcp/elicitation.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';
import { createNotFoundError, createValidationError } from '../../utils/error-factory.js';

interface SheetBatchDeps {
  sheetsApi: sheets_v4.Sheets;
  context: HandlerContext;
  success: (action: string, data: Record<string, unknown>) => CoreResponse;
  error: (error: ErrorDetail) => CoreResponse;
}

/**
 * Decomposed action handler for `batch_delete_sheets`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleBatchDeleteSheetsAction(
  input: CoreBatchDeleteSheetsInput,
  deps: SheetBatchDeps
): Promise<CoreResponse> {
  if (!input.sheetIds || input.sheetIds.length === 0) {
    return deps.error(
      createValidationError({
        field: 'sheetIds',
        value: input.sheetIds ?? null,
        expectedFormat: 'non-empty array of sheet IDs',
        reason: 'Provide at least one sheetId to delete',
      })
    );
  }

  const spreadsheetResponse = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.properties.sheetId',
  });

  const existingSheetIds = new Set(
    spreadsheetResponse.data.sheets?.map((s) => s.properties?.sheetId) ?? []
  );

  const sheetsToDelete = input.sheetIds.filter((id) => existingSheetIds.has(id));
  const skippedSheetIds = input.sheetIds.filter((id) => !existingSheetIds.has(id));

  if (sheetsToDelete.length === 0) {
    return deps.success('batch_delete_sheets', {
      deletedCount: 0,
      skippedSheetIds,
      message: 'No sheets found to delete',
    });
  }

  if (sheetsToDelete.length >= existingSheetIds.size) {
    return deps.error(
      createValidationError({
        field: 'sheetIds',
        value: input.sheetIds,
        expectedFormat: 'at least one sheet to remain',
        reason: 'A spreadsheet must have at least one sheet. Remove one sheetId from the list.',
      })
    );
  }

  // Safety: confirm destructive batch deletion
  if (deps.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      deps.context.elicitationServer,
      'batch_delete_sheets',
      `Delete ${sheetsToDelete.length} sheet(s) from spreadsheet ${input.spreadsheetId}. All data in these sheets will be permanently removed.`
    );
    if (!confirmation.confirmed) {
      return deps.error({
        code: ErrorCodes.OPERATION_CANCELLED,
        message: confirmation.reason || 'User cancelled the batch delete operation',
        retryable: false,
        suggestedFix: 'Review the operation requirements and try again',
      });
    }
  }

  // Safety: snapshot before destructive operation
  await createSnapshotIfNeeded(
    deps.context.snapshotService,
    {
      operationType: 'batch_delete_sheets',
      isDestructive: true,
      spreadsheetId: input.spreadsheetId,
    },
    input.safety
  );

  const requests: sheets_v4.Schema$Request[] = sheetsToDelete.map((sheetId) => ({
    deleteSheet: { sheetId },
  }));

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: { requests },
  });

  deps.context.sheetResolver?.invalidate(input.spreadsheetId);

  // Record operation in session context for LLM follow-up references
  try {
    if (deps.context.sessionContext) {
      deps.context.sessionContext.recordOperation({
        tool: 'sheets_core',
        action: 'batch_delete_sheets',
        spreadsheetId: input.spreadsheetId,
        description: `Deleted ${sheetsToDelete.length} sheet(s) from spreadsheet`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return deps.success('batch_delete_sheets', {
    deletedCount: sheetsToDelete.length,
    skippedSheetIds: skippedSheetIds.length > 0 ? skippedSheetIds : undefined,
    message: `Deleted ${sheetsToDelete.length} sheet(s)${skippedSheetIds.length > 0 ? `, skipped ${skippedSheetIds.length} non-existent` : ''}`,
  });
}

/**
 * Decomposed action handler for `batch_update_sheets`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleBatchUpdateSheetsAction(
  input: CoreBatchUpdateSheetsInput,
  deps: SheetBatchDeps
): Promise<CoreResponse> {
  if (!input.updates || input.updates.length === 0) {
    return deps.error(
      createValidationError({
        field: 'updates',
        value: input.updates ?? null,
        expectedFormat: 'non-empty array of sheet updates',
        reason: 'Provide at least one update object with sheetId and properties to update',
      })
    );
  }

  const requests: sheets_v4.Schema$Request[] = input.updates.map((update) => {
    const fields: string[] = [];
    const properties: sheets_v4.Schema$SheetProperties = {
      sheetId: update.sheetId,
    };

    if (update.title !== undefined) {
      properties.title = update.title;
      fields.push('title');
    }
    if (update.index !== undefined) {
      properties.index = update.index;
      fields.push('index');
    }
    if (update.hidden !== undefined) {
      properties.hidden = update.hidden;
      fields.push('hidden');
    }
    if (update.tabColor !== undefined) {
      const colorValue = {
        red: update.tabColor.red,
        green: update.tabColor.green,
        blue: update.tabColor.blue,
        alpha: update.tabColor.alpha ?? 1,
      };
      properties.tabColor = colorValue;
      properties.tabColorStyle = { rgbColor: colorValue };
      fields.push('tabColorStyle');
    }

    return {
      updateSheetProperties: {
        properties,
        fields: fields.join(','),
      },
    };
  });

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: { requests },
  });

  deps.context.sheetResolver?.invalidate(input.spreadsheetId);

  // Record operation in session context for LLM follow-up references
  try {
    if (deps.context.sessionContext) {
      deps.context.sessionContext.recordOperation({
        tool: 'sheets_core',
        action: 'batch_update_sheets',
        spreadsheetId: input.spreadsheetId,
        description: `Updated properties of ${input.updates.length} sheet(s)`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return deps.success('batch_update_sheets', {
    updatedCount: input.updates.length,
    message: `Updated ${input.updates.length} sheet(s)`,
  });
}

/**
 * Decomposed action handler for `clear_sheet`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleClearSheetAction(
  input: CoreClearSheetInput,
  deps: SheetBatchDeps
): Promise<CoreResponse> {
  let resolvedSheetId = input.sheetId;

  if (resolvedSheetId === undefined && input.sheetName) {
    const lookupResponse = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      fields: 'sheets.properties(sheetId,title)',
    });

    const matchingSheet = lookupResponse.data.sheets?.find(
      (s) => s.properties?.title?.toLowerCase() === input.sheetName!.toLowerCase()
    );

    const matchingSheetId = matchingSheet?.properties?.sheetId;
    if (matchingSheetId === undefined || matchingSheetId === null) {
      return deps.error(
        createNotFoundError({
          resourceType: 'sheet',
          resourceId: `sheetName: "${input.sheetName}"`,
          searchSuggestion: `Available sheets: ${lookupResponse.data.sheets?.map((s) => s.properties?.title).join(', ')}`,
          parentResourceId: input.spreadsheetId,
        })
      );
    }

    resolvedSheetId = matchingSheetId;
  }

  if (resolvedSheetId === undefined) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message: 'Either sheetId (number) or sheetName (string) is required',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  const sheetInfo = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.properties(sheetId,title,gridProperties)',
  });

  const targetSheet = sheetInfo.data.sheets?.find((s) => s.properties?.sheetId === resolvedSheetId);

  if (!targetSheet?.properties?.title) {
    return deps.error(
      createNotFoundError({
        resourceType: 'sheet',
        resourceId: `sheetId: ${resolvedSheetId}`,
        parentResourceId: input.spreadsheetId,
      })
    );
  }

  const sheetTitle = targetSheet.properties.title;

  if (deps.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      deps.context.elicitationServer,
      'clear_sheet',
      `Clear all data from sheet "${sheetTitle}" in spreadsheet ${input.spreadsheetId}. This will remove all cell values${input.clearFormats ? ', formatting' : ''}${input.clearNotes ? ', and notes' : ''}. This action cannot be undone without a snapshot.`
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

  const clearValues = input.clearValues !== false;
  const clearFormats = input.clearFormats === true;
  const clearNotes = input.clearNotes === true;

  const requests: sheets_v4.Schema$Request[] = [];

  if (clearValues) {
    requests.push({
      updateCells: {
        range: {
          sheetId: resolvedSheetId,
        },
        fields: 'userEnteredValue',
      },
    });
  }

  if (clearFormats) {
    requests.push({
      updateCells: {
        range: {
          sheetId: resolvedSheetId,
        },
        fields: 'userEnteredFormat',
      },
    });
  }

  if (clearNotes) {
    requests.push({
      updateCells: {
        range: {
          sheetId: resolvedSheetId,
        },
        fields: 'note',
      },
    });
  }

  if (requests.length === 0) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message: 'Nothing to clear. Set at least one of: clearValues, clearFormats, clearNotes',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: { requests },
  });

  // Record operation in session context for LLM follow-up references
  try {
    if (deps.context.sessionContext) {
      deps.context.sessionContext.recordOperation({
        tool: 'sheets_core',
        action: 'clear_sheet',
        spreadsheetId: input.spreadsheetId,
        description: `Cleared sheet "${sheetTitle}" (values: ${clearValues}, formats: ${clearFormats}, notes: ${clearNotes})`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return deps.success('clear_sheet', {
    sheetId: resolvedSheetId,
    sheetTitle,
    cleared: {
      values: clearValues,
      formats: clearFormats,
      notes: clearNotes,
    },
  });
}

/**
 * Decomposed action handler for `move_sheet`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleMoveSheetAction(
  input: CoreMoveSheetInput,
  deps: SheetBatchDeps
): Promise<CoreResponse> {
  let resolvedSheetId = input.sheetId;

  let sheetHidden = false;
  if (resolvedSheetId === undefined && input.sheetName) {
    const lookupResponse = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      fields: 'sheets.properties(sheetId,title,index,hidden)',
    });

    const matchingSheet = lookupResponse.data.sheets?.find(
      (s) => s.properties?.title?.toLowerCase() === input.sheetName!.toLowerCase()
    );

    const matchingSheetId = matchingSheet?.properties?.sheetId;
    if (matchingSheetId === undefined || matchingSheetId === null) {
      return deps.error(
        createNotFoundError({
          resourceType: 'sheet',
          resourceId: `sheetName: "${input.sheetName}"`,
          searchSuggestion: `Available sheets: ${lookupResponse.data.sheets?.map((s) => s.properties?.title).join(', ')}`,
          parentResourceId: input.spreadsheetId,
        })
      );
    }

    resolvedSheetId = matchingSheetId;
    sheetHidden = matchingSheet?.properties?.hidden === true;
  } else if (resolvedSheetId !== undefined) {
    try {
      const lookupResponse = await deps.sheetsApi.spreadsheets.get({
        spreadsheetId: input.spreadsheetId,
        fields: 'sheets.properties(sheetId,hidden)',
      });
      const sheet = lookupResponse.data.sheets?.find(
        (s) => s.properties?.sheetId === resolvedSheetId
      );
      sheetHidden = sheet?.properties?.hidden === true;
    } catch {
      // Non-critical - continue without hidden check
    }
  }

  if (resolvedSheetId === undefined) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message: 'Either sheetId (number) or sheetName (string) is required',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  if (input.newIndex === undefined) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message: 'newIndex is required - the 0-based position to move the sheet to',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId: resolvedSheetId,
              index: input.newIndex,
            },
            fields: 'index',
          },
        },
      ],
    },
  });

  const verifyResponse = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.properties(sheetId,title,index)',
  });

  const movedSheet = verifyResponse.data.sheets?.find(
    (s) => s.properties?.sheetId === resolvedSheetId
  );

  if (!movedSheet) {
    return deps.error({
      code: ErrorCodes.SHEET_NOT_FOUND,
      message: `Sheet with ID ${resolvedSheetId} not found after move operation`,
      retryable: false,
      suggestedFix: 'Verify the sheet still exists in the spreadsheet',
    });
  }

  const actualIndex = movedSheet.properties?.index ?? -1;
  const verified = actualIndex === input.newIndex;

  if (!verified) {
    deps.context.logger?.warn?.('move_sheet verification failed', {
      requestedIndex: input.newIndex,
      actualIndex,
      sheetId: resolvedSheetId,
    });
  }

  const warnings: string[] = [];
  if (!verified) {
    warnings.push(
      `Sheet moved but ended at index ${actualIndex} instead of ${input.newIndex}. Google Sheets uses 0-based indexing and adjusts if newIndex exceeds sheet count.`
    );
  }
  if (sheetHidden) {
    warnings.push(
      `Warning: Sheet "${movedSheet.properties?.title}" is hidden. Moving a hidden sheet may not have the expected visual effect. Consider unhiding it first with sheets_dimensions action:"show".`
    );
  }

  deps.context.sheetResolver?.invalidate(input.spreadsheetId);

  // Record operation in session context for LLM follow-up references
  try {
    if (deps.context.sessionContext) {
      deps.context.sessionContext.recordOperation({
        tool: 'sheets_core',
        action: 'move_sheet',
        spreadsheetId: input.spreadsheetId,
        description: `Moved sheet "${movedSheet.properties?.title}" to index ${actualIndex}`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return deps.success('move_sheet', {
    sheetId: resolvedSheetId,
    sheetTitle: movedSheet.properties?.title,
    requestedIndex: input.newIndex,
    actualIndex,
    verified,
    hidden: sheetHidden,
    ...(warnings.length > 0 ? { warning: warnings.join(' | ') } : {}),
  });
}
