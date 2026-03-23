import { ErrorCodes } from '../error-codes.js';
import type { drive_v3, sheets_v4 } from 'googleapis';
import { Readable } from 'stream';
import type {
  CompositeExportXlsxInput,
  CompositeGetFormResponsesInput,
  CompositeImportXlsxInput,
  CompositeOutput,
} from '../../schemas/composite.js';
import { getEnv } from '../../config/env.js';
import { withTimeout } from '../../utils/timeout.js';
import type { ErrorDetail, ResponseMeta } from '../../schemas/shared.js';

type GenerateMetaFn = (
  action: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  options: Record<string, unknown>
) => ResponseMeta;

export interface ImportExportDeps {
  sheetsApi: sheets_v4.Sheets;
  driveApi?: drive_v3.Drive;
  generateMeta: GenerateMetaFn;
  error: (error: ErrorDetail) => CompositeOutput['response'];
}

/**
 * Decomposed action handler for `export_xlsx`.
 * Preserves original behavior while moving logic out of the main CompositeHandler class.
 */
export async function handleExportXlsxAction(
  input: CompositeExportXlsxInput,
  deps: ImportExportDeps
): Promise<CompositeOutput['response']> {
  if (!deps.driveApi) {
    return {
      success: false,
      error: {
        code: ErrorCodes.FEATURE_UNAVAILABLE,
        message:
          'Drive API not available for XLSX export. Ensure OAuth authentication is configured.',
        retryable: false,
      },
    };
  }

  const metadataResponse = await deps.driveApi.files.get({
    fileId: input.spreadsheetId,
    fields: 'name',
    supportsAllDrives: true,
  });
  const filename = `${metadataResponse.data.name ?? 'export'}.xlsx`;

  const exportResponse = await deps.driveApi.files.export(
    {
      fileId: input.spreadsheetId,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    { responseType: 'arraybuffer' }
  );

  const buffer = Buffer.from(exportResponse.data as ArrayBuffer);
  const base64Content = buffer.toString('base64');

  return {
    success: true,
    action: 'export_xlsx',
    fileContent: base64Content,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename,
    sizeBytes: buffer.length,
    _meta: deps.generateMeta(
      'export_xlsx',
      input as unknown as Record<string, unknown>,
      { sizeBytes: buffer.length } as Record<string, unknown>,
      {}
    ),
  };
}

/**
 * Decomposed action handler for `import_xlsx`.
 * Preserves original behavior while moving logic out of the main CompositeHandler class.
 */
export async function handleImportXlsxAction(
  input: CompositeImportXlsxInput,
  deps: ImportExportDeps
): Promise<CompositeOutput['response']> {
  if (!deps.driveApi) {
    return {
      success: false,
      error: {
        code: ErrorCodes.FEATURE_UNAVAILABLE,
        message:
          'Drive API not available for XLSX import. Ensure OAuth authentication is configured.',
        retryable: false,
      },
    };
  }

  if (input.safety?.dryRun) {
    return {
      success: true,
      action: 'import_xlsx',
      spreadsheetId: 'dry-run-id',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/dry-run-id/edit',
      sheetsImported: 0,
      sheetNames: [],
      _meta: deps.generateMeta(
        'import_xlsx',
        input as unknown as Record<string, unknown>,
        {} as Record<string, unknown>,
        {}
      ),
    };
  }

  const buffer = Buffer.from(input.fileContent, 'base64');
  const env = getEnv();

  const response = await withTimeout(
    () =>
      deps.driveApi!.files.create({
        requestBody: {
          name: input.title ?? 'Imported Spreadsheet',
          mimeType: 'application/vnd.google-apps.spreadsheet',
        },
        media: {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          body: Readable.from(buffer),
        },
        fields: 'id,name',
        supportsAllDrives: true,
      }),
    env.COMPOSITE_TIMEOUT_MS,
    'import_xlsx'
  );

  const spreadsheetId = response.data.id!;

  const sheetInfo = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });
  const sheetNames = sheetInfo.data.sheets?.map((s) => s.properties?.title ?? '') ?? [];

  return {
    success: true,
    action: 'import_xlsx',
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    sheetsImported: sheetNames.length,
    sheetNames,
    mutation: {
      cellsAffected: 0,
      reversible: false,
    },
    _meta: deps.generateMeta(
      'import_xlsx',
      input as unknown as Record<string, unknown>,
      { spreadsheetId, sheetsImported: sheetNames.length } as Record<string, unknown>,
      {}
    ),
  };
}

/**
 * Decomposed action handler for `get_form_responses`.
 * Preserves original behavior while moving logic out of the main CompositeHandler class.
 */
export async function handleGetFormResponsesAction(
  input: CompositeGetFormResponsesInput,
  deps: ImportExportDeps
): Promise<CompositeOutput['response']> {
  const sheetName = input.formResponsesSheet ?? 'Form Responses 1';

  let response;
  try {
    response = await deps.sheetsApi.spreadsheets.values.get({
      spreadsheetId: input.spreadsheetId,
      range: sheetName,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
  } catch (_err) {
    return deps.error({
      code: ErrorCodes.SHEET_NOT_FOUND,
      message: `Form responses sheet "${sheetName}" not found or inaccessible. Verify the sheet exists and you have read access.`,
      retryable: false,
      details: { formResponsesSheet: sheetName, spreadsheetId: input.spreadsheetId },
    });
  }

  const values = response.data.values ?? [];
  if (values.length === 0) {
    return {
      success: true,
      action: 'get_form_responses',
      responseCount: 0,
      columnHeaders: [],
      formLinked: false,
      _meta: deps.generateMeta(
        'get_form_responses',
        input as unknown as Record<string, unknown>,
        { responseCount: 0 } as Record<string, unknown>,
        {}
      ),
    };
  }

  const headers = (values[0] as unknown[]).map(String);
  const dataRows = values.slice(1);
  const responseCount = dataRows.length;

  const formLinked =
    headers.length > 0 && (headers[0]?.toLowerCase().includes('timestamp') ?? false);

  let latestResponse: Record<string, unknown> | undefined;
  let oldestResponse: Record<string, unknown> | undefined;

  if (dataRows.length > 0) {
    const buildResponse = (row: unknown[]): Record<string, unknown> => {
      const obj: Record<string, unknown> = {};
      headers.forEach((header, idx) => {
        obj[header] = row[idx];
      });
      return obj;
    };

    latestResponse = buildResponse(dataRows[dataRows.length - 1] as unknown[]);
    oldestResponse = buildResponse(dataRows[0] as unknown[]);
  }

  return {
    success: true,
    action: 'get_form_responses',
    responseCount,
    columnHeaders: headers,
    latestResponse: latestResponse as
      | Record<string, string | number | boolean | unknown[] | Record<string, unknown> | null>
      | undefined,
    oldestResponse: oldestResponse as
      | Record<string, string | number | boolean | unknown[] | Record<string, unknown> | null>
      | undefined,
    formLinked,
    _meta: deps.generateMeta(
      'get_form_responses',
      input as unknown as Record<string, unknown>,
      { responseCount } as Record<string, unknown>,
      {}
    ),
  };
}
