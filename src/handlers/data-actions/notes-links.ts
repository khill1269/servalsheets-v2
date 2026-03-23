/**
 * Notes and hyperlinks action handlers for sheets_data.
 */

import { ErrorCodes } from '../error-codes.js';
import type { DataResponse, SheetsDataInput } from '../../schemas/data.js';
import { toGridRange } from '../../utils/google-sheets-helpers.js';
import { validateHyperlinkUrl } from '../../utils/url.js';
import type { DataHandlerAccess } from './internal.js';
import { cellToGridRange, escapeFormulaString } from './helpers.js';

type DataRequest = SheetsDataInput['request'];

// ─── handleAddNote ────────────────────────────────────────────────────────────

export async function handleAddNote(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'add_note' }
): Promise<DataResponse> {
  const gridRange = await cellToGridRange(ha, input.spreadsheetId, input.cell);

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          updateCells: {
            range: toGridRange(gridRange),
            rows: [{ values: [{ note: input.note }] }],
            fields: 'note',
          },
        },
      ],
    },
  });

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_data',
        action: 'add_note',
        spreadsheetId: input.spreadsheetId,
        description: `Added note to cell ${input.cell}`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.makeSuccess('add_note', {});
}

// ─── handleGetNote ────────────────────────────────────────────────────────────

export async function handleGetNote(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'get_note' }
): Promise<DataResponse> {
  const response = await ha.api.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    ranges: [input.cell],
    includeGridData: true,
    fields: 'sheets.data.rowData.values.note',
  });

  const note = response.data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.note ?? '';
  return ha.makeSuccess('get_note', { note });
}

// ─── handleClearNote ─────────────────────────────────────────────────────────

export async function handleClearNote(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'clear_note' }
): Promise<DataResponse> {
  const gridRange = await cellToGridRange(ha, input.spreadsheetId, input.cell);

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          updateCells: {
            range: toGridRange(gridRange),
            rows: [{ values: [{ note: '' }] }],
            fields: 'note',
          },
        },
      ],
    },
  });

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_data',
        action: 'clear_note',
        spreadsheetId: input.spreadsheetId,
        description: `Cleared note from cell ${input.cell}`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.makeSuccess('clear_note', {});
}

// ─── handleSetHyperlink ───────────────────────────────────────────────────────

export async function handleSetHyperlink(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'set_hyperlink' }
): Promise<DataResponse> {
  const validation = validateHyperlinkUrl(input.url);
  if (!validation.ok) {
    return ha.makeError({
      code: ErrorCodes.INVALID_PARAMS,
      message: `Invalid hyperlink URL: ${validation.reason}`,
      retryable: false,
      suggestedFix: 'Use a valid http or https URL.',
    });
  }

  const gridRange = await cellToGridRange(ha, input.spreadsheetId, input.cell);
  const safeUrl = escapeFormulaString(validation.normalized);
  const safeLabel = input.label ? escapeFormulaString(input.label) : undefined;
  const formula = safeLabel
    ? `=HYPERLINK("${safeUrl}","${safeLabel}")`
    : `=HYPERLINK("${safeUrl}")`;

  await ha.withCircuitBreaker('batchUpdate.setHyperlink', () =>
    ha.api.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            updateCells: {
              range: toGridRange(gridRange),
              rows: [
                {
                  values: [
                    {
                      userEnteredValue: { formulaValue: formula },
                    },
                  ],
                },
              ],
              fields: 'userEnteredValue',
            },
          },
        ],
      },
    })
  );

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_data',
        action: 'set_hyperlink',
        spreadsheetId: input.spreadsheetId,
        description: `Set hyperlink on cell ${input.cell}`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.makeSuccess('set_hyperlink', {});
}

// ─── handleClearHyperlink ─────────────────────────────────────────────────────

export async function handleClearHyperlink(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'clear_hyperlink' }
): Promise<DataResponse> {
  const gridRange = await cellToGridRange(ha, input.spreadsheetId, input.cell);

  const dedupKey = `values:get:${input.spreadsheetId}:${input.cell}:FORMATTED_VALUE:ROWS`;
  const response = await ha.deduplicatedApiCall(dedupKey, () =>
    ha.api.spreadsheets.values.get({
      spreadsheetId: input.spreadsheetId,
      range: input.cell,
      valueRenderOption: 'FORMATTED_VALUE',
      fields: 'values',
    })
  );
  const currentValue = response.data.values?.[0]?.[0] ?? '';

  await ha.withCircuitBreaker('batchUpdate.clearHyperlink', () =>
    ha.api.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            updateCells: {
              range: toGridRange(gridRange),
              rows: [
                {
                  values: [
                    {
                      userEnteredValue: { stringValue: String(currentValue) },
                    },
                  ],
                },
              ],
              fields: 'userEnteredValue',
            },
          },
        ],
      },
    })
  );

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_data',
        action: 'clear_hyperlink',
        spreadsheetId: input.spreadsheetId,
        description: `Cleared hyperlink from cell ${input.cell}`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.makeSuccess('clear_hyperlink', {});
}
