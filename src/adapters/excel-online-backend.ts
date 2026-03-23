/**
 * ServalSheets - ExcelOnlineBackend
 *
 * Implements SpreadsheetBackend from @serval/core for Microsoft Excel Online
 * via the Microsoft Graph API.
 *
 * Design:
 *   - Follows the same thin-adapter pattern as GoogleSheetsBackend
 *   - Delegates all work to Microsoft Graph SDK
 *   - Maps between platform-agnostic types and Graph API types
 *   - `native()` returns { client: GraphClient } for escape-hatch access
 *
 * Microsoft Graph API Reference:
 *   https://learn.microsoft.com/en-us/graph/api/resources/excel
 *
 * Key differences from Google Sheets:
 *   - Ranges use A1 notation (same) but worksheet references differ:
 *     Google: "Sheet1!A1:D10"
 *     Excel:  "Sheet1!A1:D10" (compatible for simple ranges)
 *   - Batch mutations use JSON batch requests ($batch endpoint)
 *   - File operations use OneDrive API (vs Google Drive)
 *   - Auth uses Microsoft Identity Platform (OAuth 2.0 / MSAL)
 *
 * Status: SCAFFOLD — all methods throw NotImplementedError.
 * This validates that the SpreadsheetBackend interface is implementable
 * for a second platform without modification.
 */

import { ServiceError, NotFoundError } from '../core/errors.js';

import type {
  SpreadsheetBackend,
  SpreadsheetPlatform,
  ReadRangeParams,
  ReadRangeResult,
  WriteRangeParams,
  WriteRangeResult,
  AppendParams,
  AppendResult,
  ClearRangeParams,
  ClearRangeResult,
  BatchReadParams,
  BatchReadResult,
  BatchWriteParams,
  BatchWriteResult,
  BatchClearParams,
  BatchClearResult,
  GetDocumentParams,
  CreateDocumentParams,
  SpreadsheetMetadata,
  SheetMetadata,
  AddSheetParams,
  DeleteSheetParams,
  CopySheetParams,
  CopySheetResult,
  BatchMutationRequest,
  BatchMutationResult,
  CopyDocumentParams,
  FileMetadata,
  ListFilesParams,
  ListFilesResult,
  ListRevisionsParams,
  ListRevisionsResult,
  RevisionMetadata,
} from '@serval/core';

// ============================================================
// Microsoft Graph Types (minimal, for scaffold)
// ============================================================

/**
 * Microsoft Graph client interface.
 * In production, this would be @microsoft/microsoft-graph-client.
 */
export interface GraphClient {
  api(path: string): GraphRequest;
}

export interface GraphRequest {
  get(): Promise<unknown>;
  post(body: unknown): Promise<unknown>;
  put(body: unknown): Promise<unknown>;
  patch(body: unknown): Promise<unknown>;
  delete(): Promise<unknown>;
  select(fields: string): GraphRequest;
  filter(expression: string): GraphRequest;
  top(count: number): GraphRequest;
  orderby(field: string): GraphRequest;
  header(key: string, value: string): GraphRequest;
}

/**
 * Configuration for ExcelOnlineBackend
 */
export interface ExcelOnlineConfig {
  /** Microsoft Graph client (authenticated) */
  client: GraphClient;
  /** OneDrive item path prefix (e.g., "/me/drive/items/") */
  drivePrefix?: string;
}

// ============================================================
// Backend Implementation
// ============================================================

/**
 * Excel Online implementation of SpreadsheetBackend.
 *
 * Maps the platform-agnostic interface to Microsoft Graph API calls:
 *
 * | Backend Method         | Graph API Endpoint                                    |
 * |------------------------|-------------------------------------------------------|
 * | readRange              | GET /workbook/worksheets/{id}/range(address='...')     |
 * | writeRange             | PATCH /workbook/worksheets/{id}/range(address='...')   |
 * | appendRows             | POST /workbook/tables/{id}/rows/add                   |
 * | clearRange             | POST /workbook/worksheets/{id}/range(...)/clear        |
 * | batchRead              | POST /$batch (multiple range GETs)                    |
 * | batchWrite             | POST /$batch (multiple range PATCHes)                 |
 * | getDocument            | GET /workbook                                         |
 * | createDocument         | PUT /drive/items/{path}:/content                      |
 * | addSheet               | POST /workbook/worksheets/add                         |
 * | deleteSheet            | DELETE /workbook/worksheets/{id}                       |
 * | executeBatchMutations  | POST /$batch                                          |
 * | copyDocument           | POST /drive/items/{id}/copy                           |
 * | getFileMetadata        | GET /drive/items/{id}                                 |
 * | listFiles              | GET /drive/root/children?$filter=...                  |
 * | listRevisions          | GET /drive/items/{id}/versions                        |
 */
export class ExcelOnlineBackend implements SpreadsheetBackend {
  readonly platform: SpreadsheetPlatform = 'excel-online';

  private client: GraphClient;
  private drivePrefix: string;

  constructor(config: ExcelOnlineConfig) {
    if (process.env['ENABLE_EXPERIMENTAL_BACKENDS'] !== 'true') {
      throw new Error(
        'ExcelOnlineBackend is a scaffold and not production-ready. ' +
          'Set ENABLE_EXPERIMENTAL_BACKENDS=true to use it.'
      );
    }
    this.client = config.client;
    this.drivePrefix = config.drivePrefix ?? '/me/drive/items/';
  }

  // ─── Lifecycle ─────────────────────────────────────────────

  async initialize(): Promise<void> {
    // Verify Graph API access by checking the /me endpoint
    // In production: await this.client.api('/me').get();
  }

  async dispose(): Promise<void> {
    // Graph client doesn't require explicit cleanup
  }

  // ─── Value Operations ──────────────────────────────────────

  async readRange(params: ReadRangeParams): Promise<ReadRangeResult> {
    // Graph API: GET /drive/items/{id}/workbook/worksheets/{sheet}/range(address='{range}')
    const { worksheetName, cellRange } = this.parseRange(params.range);
    const path = `${this.itemPath(params.documentId)}/workbook/worksheets/${encodeURIComponent(worksheetName)}/range(address='${cellRange}')`;

    const response = (await this.client.api(path).select('address,values,text').get()) as {
      address?: string;
      values?: unknown[][];
      text?: string[][];
    };

    // Excel returns formatted text in 'text' and raw values in 'values'
    const useFormatted = params.valueRenderOption === 'FORMATTED_VALUE';
    const values = useFormatted
      ? ((response.text ?? []) as (string | number | boolean | null)[][])
      : ((response.values ?? []) as (string | number | boolean | null)[][]);

    return {
      range: response.address ?? params.range,
      majorDimension: params.majorDimension ?? 'ROWS',
      values,
    };
  }

  async writeRange(params: WriteRangeParams): Promise<WriteRangeResult> {
    // Graph API: PATCH /drive/items/{id}/workbook/worksheets/{sheet}/range(address='{range}')
    const { worksheetName, cellRange } = this.parseRange(params.range);
    const path = `${this.itemPath(params.documentId)}/workbook/worksheets/${encodeURIComponent(worksheetName)}/range(address='${cellRange}')`;

    const response = (await this.client.api(path).patch({
      values: params.values,
    })) as { address?: string; cellCount?: number };

    const rowCount = params.values.length;
    const colCount = params.values[0]?.length ?? 0;

    return {
      updatedRange: response.address ?? params.range,
      updatedRows: rowCount,
      updatedColumns: colCount,
      updatedCells: response.cellCount ?? rowCount * colCount,
    };
  }

  async appendRows(params: AppendParams): Promise<AppendResult> {
    // Graph API: POST /workbook/tables/{tableId}/rows/add
    // Excel Online requires a table for append. If no table, fall back to writeRange.
    const { worksheetName, cellRange } = this.parseRange(params.range);
    const path = `${this.itemPath(params.documentId)}/workbook/worksheets/${encodeURIComponent(worksheetName)}/tables/itemAt(index=0)/rows/add`;

    (await this.client.api(path).post({
      values: params.values,
    })) as { index?: number };

    const rowCount = params.values.length;
    const colCount = params.values[0]?.length ?? 0;

    return {
      tableRange: `${worksheetName}!${cellRange}`,
      updatedRange: params.range,
      updatedRows: rowCount,
      updatedColumns: colCount,
      updatedCells: rowCount * colCount,
    };
  }

  async clearRange(params: ClearRangeParams): Promise<ClearRangeResult> {
    // Graph API: POST /workbook/worksheets/{sheet}/range(address='...')/clear
    const { worksheetName, cellRange } = this.parseRange(params.range);
    const path = `${this.itemPath(params.documentId)}/workbook/worksheets/${encodeURIComponent(worksheetName)}/range(address='${cellRange}')/clear`;

    await this.client.api(path).post({ applyTo: 'Contents' });

    return { clearedRange: params.range };
  }

  async batchRead(params: BatchReadParams): Promise<BatchReadResult> {
    // Graph API: POST /$batch with multiple range GET requests
    // For simplicity, execute sequentially (batch endpoint is more complex)
    const valueRanges = await Promise.all(
      params.ranges.map(async (range) => {
        const result = await this.readRange({
          documentId: params.documentId,
          range,
          majorDimension: params.majorDimension,
          valueRenderOption: params.valueRenderOption,
          dateTimeRenderOption: params.dateTimeRenderOption,
        });
        return {
          range: result.range,
          majorDimension: result.majorDimension,
          values: result.values,
        };
      })
    );

    return { valueRanges };
  }

  async batchWrite(params: BatchWriteParams): Promise<BatchWriteResult> {
    // Execute writes sequentially (Graph $batch is more complex)
    const responses = await Promise.all(
      params.data.map(async (d) => {
        return this.writeRange({
          documentId: params.documentId,
          range: d.range,
          values: d.values,
          valueInputOption: params.valueInputOption,
          majorDimension: d.majorDimension,
        });
      })
    );

    return {
      totalUpdatedRows: responses.reduce((sum, r) => sum + r.updatedRows, 0),
      totalUpdatedColumns: responses.reduce((sum, r) => sum + r.updatedColumns, 0),
      totalUpdatedCells: responses.reduce((sum, r) => sum + r.updatedCells, 0),
      responses,
    };
  }

  async batchClear(params: BatchClearParams): Promise<BatchClearResult> {
    await Promise.all(
      params.ranges.map((range) => this.clearRange({ documentId: params.documentId, range }))
    );

    return { clearedRanges: params.ranges };
  }

  // ─── Document Operations ───────────────────────────────────

  async getDocument(params: GetDocumentParams): Promise<SpreadsheetMetadata> {
    // Graph API: GET /drive/items/{id}/workbook/worksheets
    const worksheetsPath = `${this.itemPath(params.documentId)}/workbook/worksheets`;
    const filePath = `${this.itemPath(params.documentId)}`;

    const [fileResponse, sheetsResponse] = await Promise.all([
      this.client.api(filePath).select('id,name,webUrl').get() as Promise<{
        id?: string;
        name?: string;
        webUrl?: string;
      }>,
      this.client.api(worksheetsPath).get() as Promise<{
        value?: Array<{
          id?: string;
          name?: string;
          position?: number;
          visibility?: string;
        }>;
      }>,
    ]);

    const sheets: SheetMetadata[] = (sheetsResponse.value ?? []).map((ws, index) => ({
      sheetId: index, // Excel uses string IDs, map to numeric index
      title: ws.name ?? '',
      index: ws.position ?? index,
      rowCount: 1048576, // Excel max rows (not returned by API)
      columnCount: 16384, // Excel max columns
      hidden: ws.visibility === 'Hidden',
    }));

    return {
      documentId: params.documentId,
      title: fileResponse.name ?? '',
      sheets,
      url: fileResponse.webUrl ?? undefined,
    };
  }

  async createDocument(params: CreateDocumentParams): Promise<SpreadsheetMetadata> {
    // Graph API: PUT /drive/root:/{filename}.xlsx:/content
    // Creates an empty workbook at the specified path
    const filename = `${params.title}.xlsx`;
    const path = `/me/drive/root:/${encodeURIComponent(filename)}:/content`;

    // Upload a minimal .xlsx template (in production, use a template buffer)
    const response = (await this.client
      .api(path)
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .put(Buffer.alloc(0))) as { id?: string; name?: string; webUrl?: string };

    return {
      documentId: response.id ?? '',
      title: response.name ?? params.title,
      sheets: [
        {
          sheetId: 0,
          title: 'Sheet1',
          index: 0,
          rowCount: 1048576,
          columnCount: 16384,
        },
      ],
      url: response.webUrl ?? undefined,
    };
  }

  // ─── Sheet Operations ──────────────────────────────────────

  async addSheet(params: AddSheetParams): Promise<SheetMetadata> {
    // Graph API: POST /workbook/worksheets/add
    const path = `${this.itemPath(params.documentId)}/workbook/worksheets/add`;

    const response = (await this.client.api(path).post({
      name: params.title,
    })) as { id?: string; name?: string; position?: number; visibility?: string };

    return {
      sheetId: response.position ?? 0,
      title: response.name ?? params.title,
      index: response.position ?? 0,
      rowCount: 1048576,
      columnCount: 16384,
      hidden: params.hidden,
    };
  }

  async deleteSheet(params: DeleteSheetParams): Promise<void> {
    // Graph API: DELETE /workbook/worksheets/{id}
    // Excel uses string IDs, but our interface uses numeric sheetId.
    // We need to list worksheets to find the one at position sheetId.
    const sheetsPath = `${this.itemPath(params.documentId)}/workbook/worksheets`;
    const sheetsResponse = (await this.client.api(sheetsPath).get()) as {
      value?: Array<{ id?: string; position?: number }>;
    };

    const target = sheetsResponse.value?.find((ws) => ws.position === params.sheetId);
    if (!target?.id) {
      throw new NotFoundError('sheet', params.sheetId?.toString() ?? 'unknown');
    }

    await this.client.api(`${sheetsPath}/${target.id}`).delete();
  }

  async copySheet(params: CopySheetParams): Promise<CopySheetResult> {
    // Excel Online doesn't have a direct "copy sheet to another workbook" API.
    // Workaround: read sheet data, create in destination, write data.
    // For scaffold, throw not implemented.
    throw new ServiceError(
      `copySheet across workbooks is not natively supported by Excel Online. ` +
        `Use readRange + addSheet + writeRange as a workaround. ` +
        `Source: ${params.documentId}, destination: ${params.destinationDocumentId}`,
      'INTERNAL_ERROR',
      'excel-online',
      false
    );
  }

  // ─── Batch Mutations ───────────────────────────────────────

  async executeBatchMutations(
    documentId: string,
    request: BatchMutationRequest
  ): Promise<BatchMutationResult> {
    // Graph API: POST /$batch with array of sub-requests
    // Each mutation maps to a Graph API operation (formatting, charts, etc.)
    const batchPath = `${this.itemPath(documentId)}/workbook/$batch`;

    const batchBody = {
      requests: request.mutations.map((mutation, index) => ({
        id: String(index + 1),
        ...(mutation as object),
      })),
    };

    const response = (await this.client.api(batchPath).post(batchBody)) as {
      responses?: Array<{ id?: string; status?: number; body?: unknown }>;
    };

    return {
      appliedCount: response.responses?.length ?? 0,
      replies: response.responses ?? [],
    };
  }

  // ─── File/Drive Operations ─────────────────────────────────

  async copyDocument(params: CopyDocumentParams): Promise<FileMetadata> {
    // Graph API: POST /drive/items/{id}/copy
    const path = `${this.itemPath(params.documentId)}/copy`;

    const body: Record<string, unknown> = {};
    if (params.title) body['name'] = params.title;
    if (params.destinationFolderId) {
      body['parentReference'] = { id: params.destinationFolderId };
    }

    const response = (await this.client.api(path).post(body)) as {
      id?: string;
      name?: string;
      webUrl?: string;
      lastModifiedDateTime?: string;
      createdDateTime?: string;
    };

    return this.toFileMetadata(response);
  }

  async getFileMetadata(documentId: string): Promise<FileMetadata> {
    // Graph API: GET /drive/items/{id}
    const response = (await this.client
      .api(this.itemPath(documentId))
      .select('id,name,file,lastModifiedDateTime,createdDateTime,createdBy,webUrl')
      .get()) as Record<string, unknown>;

    return this.toFileMetadata(response);
  }

  async listFiles(params: ListFilesParams): Promise<ListFilesResult> {
    // Graph API: GET /drive/root/children with $filter for xlsx files
    let request = this.client.api('/me/drive/root/children').top(params.maxResults ?? 20);

    if (params.query) {
      request = request.filter(params.query);
    } else {
      // Default: filter for Excel files
      request = request.filter(
        "file/mimeType eq 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'"
      );
    }

    if (params.orderBy) {
      request = request.orderby(params.orderBy);
    }

    const response = (await request.get()) as {
      value?: Array<Record<string, unknown>>;
      '@odata.nextLink'?: string;
    };

    return {
      files: (response.value ?? []).map((f) => this.toFileMetadata(f)),
      nextCursor: response['@odata.nextLink'] ?? undefined,
    };
  }

  async listRevisions(params: ListRevisionsParams): Promise<ListRevisionsResult> {
    // Graph API: GET /drive/items/{id}/versions
    const path = `${this.itemPath(params.documentId)}/versions`;

    let request = this.client.api(path).top(params.maxResults ?? 20);
    if (params.cursor) {
      request = request.header('$skipToken', params.cursor);
    }

    const response = (await request.get()) as {
      value?: Array<{
        id?: string;
        lastModifiedDateTime?: string;
        lastModifiedBy?: { user?: { email?: string; displayName?: string } };
      }>;
      '@odata.nextLink'?: string;
    };

    return {
      revisions: (response.value ?? []).map((v) => ({
        revisionId: v.id ?? '',
        modifiedTime: v.lastModifiedDateTime ?? '',
        lastModifyingUser: v.lastModifiedBy?.user
          ? {
              email: v.lastModifiedBy.user.email ?? '',
              displayName: v.lastModifiedBy.user.displayName ?? undefined,
            }
          : undefined,
      })),
      nextCursor: response['@odata.nextLink'] ?? undefined,
    };
  }

  async getRevision(documentId: string, revisionId: string): Promise<RevisionMetadata> {
    // Graph API: GET /drive/items/{id}/versions/{version-id}
    const path = `${this.itemPath(documentId)}/versions/${revisionId}`;

    const response = (await this.client.api(path).get()) as {
      id?: string;
      lastModifiedDateTime?: string;
      lastModifiedBy?: { user?: { email?: string; displayName?: string } };
    };

    return {
      revisionId: response.id ?? revisionId,
      modifiedTime: response.lastModifiedDateTime ?? '',
      lastModifyingUser: response.lastModifiedBy?.user
        ? {
            email: response.lastModifiedBy.user.email ?? '',
            displayName: response.lastModifiedBy.user.displayName ?? undefined,
          }
        : undefined,
    };
  }

  // ─── Escape Hatch ──────────────────────────────────────────

  native<T = unknown>(): T {
    return {
      client: this.client,
      drivePrefix: this.drivePrefix,
    } as unknown as T;
  }

  // ─── Private Helpers ───────────────────────────────────────

  /**
   * Build the OneDrive item path for a given document ID.
   *
   * documentId can be:
   *   - A OneDrive item ID (e.g., "01BYE5RZ5MYLM2SMX75ZBIPQP7U64GTZRA")
   *   - A SharePoint site + path combo (e.g., "sites/{siteId}/drive/items/{itemId}")
   */
  private itemPath(documentId: string): string {
    if (documentId.startsWith('sites/') || documentId.startsWith('/')) {
      return documentId; // Already a full path
    }
    return `${this.drivePrefix}${documentId}`;
  }

  /**
   * Parse a range reference into worksheet name and cell range.
   *
   * "Sheet1!A1:D10" → { worksheetName: "Sheet1", cellRange: "A1:D10" }
   * "A1:D10"        → { worksheetName: "Sheet1", cellRange: "A1:D10" }
   */
  private parseRange(range: string): { worksheetName: string; cellRange: string } {
    const bangIndex = range.indexOf('!');
    if (bangIndex === -1) {
      return { worksheetName: 'Sheet1', cellRange: range };
    }

    let worksheetName = range.substring(0, bangIndex);
    // Remove surrounding quotes if present (e.g., "'My Sheet'!A1:D10")
    if (worksheetName.startsWith("'") && worksheetName.endsWith("'")) {
      worksheetName = worksheetName.slice(1, -1);
    }

    return {
      worksheetName,
      cellRange: range.substring(bangIndex + 1),
    };
  }

  /**
   * Convert a Graph API file response to platform-agnostic FileMetadata.
   */
  private toFileMetadata(data: Record<string, unknown>): FileMetadata {
    return {
      documentId: (data['id'] as string) ?? '',
      name: (data['name'] as string) ?? '',
      mimeType:
        ((data['file'] as Record<string, unknown>)?.['mimeType'] as string) ??
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      modifiedTime: (data['lastModifiedDateTime'] as string) ?? undefined,
      createdTime: (data['createdDateTime'] as string) ?? undefined,
      webViewLink: (data['webUrl'] as string) ?? undefined,
    };
  }
}
