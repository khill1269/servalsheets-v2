import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type {
  CompositeCloneStructureInput,
  CompositeImportAndFormatInput,
  CompositeOutput,
  CompositeSetupSheetInput,
} from '../../schemas/composite.js';
import type {
  CompositeOperationsService,
  CsvImportResult,
} from '../../services/composite-operations.js';
import type { SheetResolver } from '../../services/sheet-resolver.js';
import type { ResponseMeta } from '../../schemas/shared.js';

type GenerateMetaFn = (
  action: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  options: Record<string, unknown>
) => ResponseMeta;

interface StructureBaseDeps {
  sheetsApi: sheets_v4.Sheets;
  invalidateSheetCache: (spreadsheetId: string) => void;
  generateMeta: GenerateMetaFn;
}

export interface SetupSheetDeps extends StructureBaseDeps {}

export interface ImportAndFormatDeps extends StructureBaseDeps {
  compositeService: CompositeOperationsService;
}

export interface CloneStructureDeps extends StructureBaseDeps {
  sheetResolver: SheetResolver;
}

/**
 * Decomposed action handler for `setup_sheet`.
 * Preserves original behavior while moving logic out of the main CompositeHandler class.
 */
export async function handleSetupSheetAction(
  input: CompositeSetupSheetInput,
  deps: SetupSheetDeps
): Promise<CompositeOutput['response']> {
  const existingSheets = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.properties(sheetId,title)',
  });
  const existing = existingSheets.data.sheets?.find((s) => s.properties?.title === input.sheetName);

  const buildFormatRequests = (id: number): sheets_v4.Schema$Request[] => {
    const reqs: sheets_v4.Schema$Request[] = [];
    if (input.headerFormat) {
      reqs.push({
        repeatCell: {
          range: {
            sheetId: id,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: input.headers.length,
          },
          cell: {
            userEnteredFormat: {
              textFormat: {
                bold: input.headerFormat.bold ?? true,
                foregroundColor: input.headerFormat.textColor,
              },
              backgroundColor: input.headerFormat.backgroundColor,
            },
          },
          fields: 'userEnteredFormat(textFormat,backgroundColor)',
        },
      });
    }
    if (input.columnWidths && input.columnWidths.length > 0) {
      input.columnWidths.forEach((width, idx) => {
        if (idx < input.headers.length) {
          reqs.push({
            updateDimensionProperties: {
              range: { sheetId: id, dimension: 'COLUMNS', startIndex: idx, endIndex: idx + 1 },
              properties: { pixelSize: width },
              fields: 'pixelSize',
            },
          });
        }
      });
    }
    return reqs;
  };

  let sheetId: number;

  if (existing?.properties?.sheetId !== undefined && existing.properties.sheetId !== null) {
    sheetId = existing.properties.sheetId;

    await deps.sheetsApi.spreadsheets.values.update({
      spreadsheetId: input.spreadsheetId,
      range: `'${input.sheetName}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [input.headers] },
    });

    const formatRequests = buildFormatRequests(sheetId);
    if (formatRequests.length > 0) {
      await deps.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: input.spreadsheetId,
        requestBody: { requests: formatRequests },
      });
    }
  } else {
    // Use deterministic in-request sheetId so addSheet + follow-up format requests fit one batchUpdate.
    sheetId = Math.floor(Math.random() * 2_147_483_647);

    const formatRequests = buildFormatRequests(sheetId);
    await deps.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                sheetId,
                title: input.sheetName,
                gridProperties: {
                  rowCount: 1000,
                  columnCount: input.headers.length,
                  frozenRowCount: input.freezeHeaderRow ? 1 : 0,
                },
              },
            },
          },
          ...formatRequests,
        ],
      },
    });

    await deps.sheetsApi.spreadsheets.values.update({
      spreadsheetId: input.spreadsheetId,
      range: `'${input.sheetName}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [input.headers] },
    });
  }

  const apiCallsSaved = Math.max(0, 4 + (input.columnWidths?.length ?? 0) - 3);
  deps.invalidateSheetCache(input.spreadsheetId);

  return {
    success: true as const,
    action: 'setup_sheet' as const,
    sheetId,
    sheetName: input.sheetName,
    columnCount: input.headers.length,
    rowsCreated: input.data?.length ?? 0,
    apiCallsSaved,
    _meta: deps.generateMeta(
      'setup_sheet',
      input as unknown as Record<string, unknown>,
      { sheetId, columnCount: input.headers.length } as Record<string, unknown>,
      {}
    ),
  };
}

/**
 * Decomposed action handler for `import_and_format`.
 * Preserves original behavior while moving logic out of the main CompositeHandler class.
 */
export async function handleImportAndFormatAction(
  input: CompositeImportAndFormatInput,
  deps: ImportAndFormatDeps
): Promise<CompositeOutput['response']> {
  const importResult: CsvImportResult = await deps.compositeService.importCsv({
    spreadsheetId: input.spreadsheetId,
    sheet:
      input.sheet !== undefined
        ? typeof input.sheet === 'string'
          ? input.sheet
          : input.sheet
        : undefined,
    csvData: input.csvData,
    delimiter: input.delimiter,
    hasHeader: input.hasHeader,
    mode: input.newSheetName ? 'new_sheet' : 'replace',
    newSheetName: input.newSheetName,
    skipEmptyRows: true,
    trimValues: true,
  });

  const formatRequests: sheets_v4.Schema$Request[] = [];

  if (input.hasHeader && input.headerFormat) {
    formatRequests.push({
      repeatCell: {
        range: {
          sheetId: importResult.sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: importResult.columnsImported,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              bold: input.headerFormat.bold ?? true,
            },
            backgroundColor: input.headerFormat.backgroundColor,
          },
        },
        fields: 'userEnteredFormat(textFormat,backgroundColor)',
      },
    });
  }

  if (input.freezeHeaderRow && input.hasHeader) {
    formatRequests.push({
      updateSheetProperties: {
        properties: {
          sheetId: importResult.sheetId,
          gridProperties: {
            frozenRowCount: 1,
          },
        },
        fields: 'gridProperties.frozenRowCount',
      },
    });
  }

  if (input.autoResizeColumns) {
    formatRequests.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId: importResult.sheetId,
          dimension: 'COLUMNS',
          startIndex: 0,
          endIndex: importResult.columnsImported,
        },
      },
    });
  }

  if (formatRequests.length > 0) {
    await deps.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: { requests: formatRequests },
    });
  }

  const apiCallsSaved = Math.max(0, 4 - 2);
  deps.invalidateSheetCache(input.spreadsheetId);

  const cellsAffected = importResult.rowsImported * importResult.columnsImported;
  return {
    success: true as const,
    action: 'import_and_format' as const,
    rowsImported: importResult.rowsImported,
    columnsImported: importResult.columnsImported,
    sheetId: importResult.sheetId,
    sheetName: importResult.sheetName,
    range: importResult.range,
    apiCallsSaved,
    mutation: {
      cellsAffected,
      reversible: false,
    },
    _meta: deps.generateMeta(
      'import_and_format',
      input as unknown as Record<string, unknown>,
      importResult as unknown as Record<string, unknown>,
      { cellsAffected }
    ),
  };
}

/**
 * Decomposed action handler for `clone_structure`.
 * Preserves original behavior while moving logic out of the main CompositeHandler class.
 */
export async function handleCloneStructureAction(
  input: CompositeCloneStructureInput,
  deps: CloneStructureDeps
): Promise<CompositeOutput['response']> {
  const sourceSheetRef =
    typeof input.sourceSheet === 'string'
      ? { sheetName: input.sourceSheet }
      : { sheetId: input.sourceSheet };
  const resolved = await deps.sheetResolver.resolve(input.spreadsheetId, sourceSheetRef);
  const sourceSheetId = resolved.sheet.sheetId;

  const copyResponse = await deps.sheetsApi.spreadsheets.sheets.copyTo({
    spreadsheetId: input.spreadsheetId,
    sheetId: sourceSheetId,
    requestBody: {
      destinationSpreadsheetId: input.spreadsheetId,
    },
  });

  const copiedSheetId = copyResponse.data.sheetId;
  if (copiedSheetId === undefined || copiedSheetId === null) {
    return {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Failed to copy sheet - no sheet ID returned',
        retryable: true,
      },
    };
  }
  const newSheetId: number = copiedSheetId;

  const sheetInfo = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.properties',
  });

  const newSheet = sheetInfo.data.sheets?.find((s) => s.properties?.sheetId === newSheetId);
  const columnCount = newSheet?.properties?.gridProperties?.columnCount ?? 26;

  const requests: sheets_v4.Schema$Request[] = [
    {
      updateSheetProperties: {
        properties: {
          sheetId: newSheetId,
          title: input.newSheetName,
        },
        fields: 'title',
      },
    },
  ];

  const headerRowCount = input.headerRowCount ?? 1;
  requests.push({
    updateCells: {
      range: {
        sheetId: newSheetId,
        startRowIndex: headerRowCount,
        startColumnIndex: 0,
      },
      fields: 'userEnteredValue',
    },
  });

  if (!input.includeFormatting) {
    requests.push({
      updateCells: {
        range: {
          sheetId: newSheetId,
          startRowIndex: headerRowCount,
          startColumnIndex: 0,
        },
        fields: 'userEnteredFormat',
      },
    });
  }

  if (!input.includeConditionalFormatting) {
    const detailedInfo = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      fields: 'sheets.conditionalFormats',
    });

    const conditionalFormats = detailedInfo.data.sheets?.find(
      (s) => s.conditionalFormats && s.conditionalFormats.length > 0
    )?.conditionalFormats;

    if (conditionalFormats) {
      // Deleting only cloned-sheet inherited rules requires more granular rule-target logic.
    }
  }

  if (!input.includeDataValidation) {
    requests.push({
      setDataValidation: {
        range: {
          sheetId: newSheetId,
          startRowIndex: headerRowCount,
          startColumnIndex: 0,
        },
        rule: undefined,
      },
    });
  }

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: { requests },
  });

  const apiCallsSaved = Math.max(0, 5 - 2);
  deps.invalidateSheetCache(input.spreadsheetId);

  return {
    success: true as const,
    action: 'clone_structure' as const,
    newSheetId,
    newSheetName: input.newSheetName,
    columnCount,
    headerRowsPreserved: headerRowCount,
    formattingCopied: input.includeFormatting ?? true,
    validationCopied: input.includeDataValidation ?? true,
    apiCallsSaved,
    _meta: deps.generateMeta(
      'clone_structure',
      input as unknown as Record<string, unknown>,
      { newSheetId, columnCount } as Record<string, unknown>,
      {}
    ),
  };
}
