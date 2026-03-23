/**
 * ServalSheets - AirtableBackend
 *
 * Implements SpreadsheetBackend from @serval/core for Airtable bases
 * via the Airtable REST API (https://airtable.com/developers/web/api).
 *
 * Design:
 *   - Follows the same thin-adapter pattern as GoogleSheetsBackend
 *   - Maps between cell-grid SpreadsheetBackend model and Airtable's
 *     base/table/record/field model
 *   - `native()` returns { client: AirtableClient } for escape-hatch access
 *
 * Airtable REST API Reference:
 *   https://airtable.com/developers/web/api/introduction
 *
 * Conceptual mapping (Airtable ↔ SpreadsheetBackend):
 *
 *   | Airtable Concept   | SpreadsheetBackend Concept          |
 *   |--------------------|-------------------------------------|
 *   | Base               | Document / Workbook                 |
 *   | Table              | Sheet / Worksheet                   |
 *   | Record             | Row                                 |
 *   | Field              | Column                              |
 *   | Cell value         | Cell value                          |
 *   | Base ID            | documentId (appXXXXXX)              |
 *   | Table ID/name      | Sheet name in A1 ref                |
 *   | Record ID          | Row index (synthetic)               |
 *
 * Range mapping (synthetic A1 notation):
 *   - "TableName!A1:D10" → table "TableName", records 0-9, fields 0-3
 *   - Fields are sorted: primary field first, then alphabetical
 *   - Records are in default list order (Airtable's view-dependent sort)
 *
 * Key advantages over Notion for SpreadsheetBackend mapping:
 *   - Tables are first-class objects (closer to sheets)
 *   - A base has multiple tables (closer to multi-sheet workbook)
 *   - List records API supports offset pagination and field selection
 *   - Batch create/update/delete up to 10 records per request
 *
 * Limitations:
 *   - Rate limit: 5 requests per second per base
 *   - Batch operations limited to 10 records per request
 *   - No revision/version history API
 *   - No "copy base" API (must recreate)
 *   - Field types are strict (unlike free-form cells)
 *
 * Status: SCAFFOLD — validates SpreadsheetBackend for Airtable's model.
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
  CellValue,
} from '@serval/core';

// ============================================================
// Airtable API Types (minimal, for scaffold)
// ============================================================

/**
 * Airtable REST API client interface.
 * In production, this would be the official airtable.js SDK or a custom HTTP client.
 */
export interface AirtableClient {
  /** Make a GET request to the Airtable API */
  get(path: string, params?: Record<string, string | number>): Promise<unknown>;
  /** Make a POST request to the Airtable API */
  post(path: string, body: unknown): Promise<unknown>;
  /** Make a PATCH request to the Airtable API */
  patch(path: string, body: unknown): Promise<unknown>;
  /** Make a DELETE request to the Airtable API */
  delete(path: string, params?: Record<string, string[]>): Promise<unknown>;
}

export interface AirtableBase {
  id: string;
  name: string;
  tables: AirtableTable[];
}

export interface AirtableTable {
  id: string;
  name: string;
  primaryFieldId: string;
  fields: AirtableField[];
  views: Array<{ id: string; name: string; type: string }>;
}

export interface AirtableField {
  id: string;
  name: string;
  type: string;
  description?: string;
  options?: Record<string, unknown>;
}

export interface AirtableRecord {
  id: string;
  createdTime: string;
  fields: Record<string, AirtableCellValue>;
}

export type AirtableCellValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | string[]
  | Array<{ id: string; name?: string }>
  | Array<{ url: string; filename?: string }>
  | { label: string; url: string }
  | { name: string; email?: string; id?: string };

export interface AirtableListRecordsResponse {
  records: AirtableRecord[];
  offset?: string;
}

/**
 * Configuration for AirtableBackend
 */
export interface AirtableBackendConfig {
  /** Airtable REST API client (authenticated with PAT or OAuth token) */
  client: AirtableClient;
}

// ============================================================
// Backend Implementation
// ============================================================

/**
 * Airtable implementation of SpreadsheetBackend.
 *
 * Maps the cell-grid interface to Airtable REST API:
 *
 * | Backend Method         | Airtable API Endpoint                        |
 * |------------------------|----------------------------------------------|
 * | readRange              | GET /v0/{baseId}/{tableId} (list records)    |
 * | writeRange             | PATCH /v0/{baseId}/{tableId} (update records)|
 * | appendRows             | POST /v0/{baseId}/{tableId} (create records) |
 * | clearRange             | PATCH /v0/{baseId}/{tableId} (set fields null)|
 * | getDocument            | GET /v0/meta/bases/{baseId}/tables           |
 * | createDocument         | POST /v0/meta/bases (create base)            |
 * | addSheet               | POST /v0/meta/bases/{baseId}/tables          |
 * | deleteSheet            | Not supported (API limitation)               |
 * | copyDocument           | Not natively supported                       |
 * | listFiles              | GET /v0/meta/bases (list bases)              |
 * | listRevisions          | Not available (API limitation)               |
 */
export class AirtableBackend implements SpreadsheetBackend {
  readonly platform: SpreadsheetPlatform = 'airtable';

  private client: AirtableClient;

  /**
   * Cache of table schemas (field order needed for A1 column mapping).
   * Maps "baseId:tableIdOrName" → ordered field names.
   */
  private fieldOrderCache: Map<string, string[]> = new Map();

  /**
   * Cache of record IDs for row-index mapping.
   * Maps "baseId:tableIdOrName" → record IDs in list order.
   */
  private recordIdCache: Map<string, string[]> = new Map();

  constructor(config: AirtableBackendConfig) {
    if (process.env['ENABLE_EXPERIMENTAL_BACKENDS'] !== 'true') {
      throw new Error(
        'AirtableBackend is a scaffold and not production-ready. ' +
          'Set ENABLE_EXPERIMENTAL_BACKENDS=true to use it.'
      );
    }
    this.client = config.client;
  }

  // ─── Lifecycle ─────────────────────────────────────────────

  async initialize(): Promise<void> {
    // Verify Airtable API access
    // In production: await this.client.get('/v0/meta/whoami');
  }

  async dispose(): Promise<void> {
    this.fieldOrderCache.clear();
    this.recordIdCache.clear();
  }

  // ─── Value Operations ──────────────────────────────────────

  async readRange(params: ReadRangeParams): Promise<ReadRangeResult> {
    const { tableName, startRow, endRow, startCol, endCol } = this.parseAirtableRange(params.range);
    const fieldNames = await this.getFieldOrder(params.documentId, tableName);

    // Determine which fields to request (column filtering)
    const selectedFields = fieldNames.slice(startCol, endCol);

    // List records with field filtering
    const records = await this.listRecords(params.documentId, tableName, {
      fields: selectedFields,
      maxRecords: endRow,
    });

    // Slice to requested row range
    const selectedRecords = records.slice(startRow, endRow);

    // Extract cell values in column order
    const values: CellValue[][] = selectedRecords.map((record) =>
      selectedFields.map((fieldName) => this.coerceCellValue(record.fields[fieldName]))
    );

    return {
      range: params.range,
      majorDimension: params.majorDimension ?? 'ROWS',
      values,
    };
  }

  async writeRange(params: WriteRangeParams): Promise<WriteRangeResult> {
    const { tableName, startRow, startCol } = this.parseAirtableRange(params.range);
    const fieldNames = await this.getFieldOrder(params.documentId, tableName);

    // Get record IDs for the target rows
    const maxRow = startRow + params.values.length;
    const recordIds = await this.getRecordIds(params.documentId, tableName, maxRow);

    let updatedCells = 0;

    // Airtable batch update: max 10 records per request
    const batchSize = 10;
    for (let batchStart = 0; batchStart < params.values.length; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, params.values.length);
      const batchRecords: Array<{ id: string; fields: Record<string, CellValue> }> = [];

      for (let rowIdx = batchStart; rowIdx < batchEnd; rowIdx++) {
        const recordId = recordIds[startRow + rowIdx];
        if (!recordId) continue; // Row doesn't exist — use appendRows for new rows

        const fields: Record<string, CellValue> = {};
        const rowValues = params.values[rowIdx];
        if (!rowValues) continue; // Guard against undefined rows

        for (let colIdx = 0; colIdx < rowValues.length; colIdx++) {
          const fieldName = fieldNames[startCol + colIdx];
          if (!fieldName) continue;
          const cellValue = rowValues[colIdx];
          if (cellValue !== undefined) fields[fieldName] = cellValue;
          updatedCells++;
        }

        batchRecords.push({ id: recordId, fields });
      }

      if (batchRecords.length > 0) {
        await this.client.patch(`/v0/${params.documentId}/${encodeURIComponent(tableName)}`, {
          records: batchRecords,
        });
      }
    }

    const rowCount = params.values.length;
    const colCount = params.values[0]?.length ?? 0;

    return {
      updatedRange: params.range,
      updatedRows: rowCount,
      updatedColumns: colCount,
      updatedCells,
    };
  }

  async appendRows(params: AppendParams): Promise<AppendResult> {
    const { tableName, startCol } = this.parseAirtableRange(params.range);
    const fieldNames = await this.getFieldOrder(params.documentId, tableName);

    let totalCells = 0;

    // Airtable batch create: max 10 records per request
    const batchSize = 10;
    for (let batchStart = 0; batchStart < params.values.length; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, params.values.length);
      const batchRecords: Array<{ fields: Record<string, CellValue> }> = [];

      for (let rowIdx = batchStart; rowIdx < batchEnd; rowIdx++) {
        const fields: Record<string, CellValue> = {};
        const rowValues = params.values[rowIdx];
        if (!rowValues) continue; // Guard against undefined rows

        for (let colIdx = 0; colIdx < rowValues.length; colIdx++) {
          const fieldName = fieldNames[startCol + colIdx];
          if (!fieldName) continue;
          const cellValue = rowValues[colIdx];
          if (cellValue !== undefined) fields[fieldName] = cellValue;
          totalCells++;
        }

        batchRecords.push({ fields });
      }

      if (batchRecords.length > 0) {
        await this.client.post(`/v0/${params.documentId}/${encodeURIComponent(tableName)}`, {
          records: batchRecords,
        });
      }
    }

    // Invalidate record ID cache since we added new records
    this.recordIdCache.delete(`${params.documentId}:${tableName}`);

    const rowCount = params.values.length;
    const colCount = params.values[0]?.length ?? 0;

    return {
      tableRange: params.range,
      updatedRange: params.range,
      updatedRows: rowCount,
      updatedColumns: colCount,
      updatedCells: totalCells,
    };
  }

  async clearRange(params: ClearRangeParams): Promise<ClearRangeResult> {
    const { tableName, startRow, endRow, startCol, endCol } = this.parseAirtableRange(params.range);
    const fieldNames = await this.getFieldOrder(params.documentId, tableName);
    const selectedFields = fieldNames.slice(startCol, endCol);

    const recordIds = await this.getRecordIds(params.documentId, tableName, endRow);
    const targetRecordIds = recordIds.slice(startRow, endRow);

    // Clear by setting field values to null, in batches of 10
    const batchSize = 10;
    for (let batchStart = 0; batchStart < targetRecordIds.length; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, targetRecordIds.length);
      const batchRecords: Array<{ id: string; fields: Record<string, null> }> = [];

      for (let i = batchStart; i < batchEnd; i++) {
        const recordId = targetRecordIds[i];
        if (!recordId) continue;

        const fields: Record<string, null> = {};
        for (const fieldName of selectedFields) {
          fields[fieldName] = null;
        }
        batchRecords.push({ id: recordId, fields });
      }

      if (batchRecords.length > 0) {
        await this.client.patch(`/v0/${params.documentId}/${encodeURIComponent(tableName)}`, {
          records: batchRecords,
        });
      }
    }

    return { clearedRange: params.range };
  }

  async batchRead(params: BatchReadParams): Promise<BatchReadResult> {
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
    // Airtable: GET /v0/meta/bases/{baseId}/tables
    const response = (await this.client.get(`/v0/meta/bases/${params.documentId}/tables`)) as {
      tables: AirtableTable[];
    };

    const sheets: SheetMetadata[] = response.tables.map((table, index) => ({
      sheetId: index,
      title: table.name,
      index,
      rowCount: 50000, // Airtable free tier limit; Pro is 100k
      columnCount: table.fields.length,
    }));

    // Get base name from meta endpoint
    const basesResponse = (await this.client.get('/v0/meta/bases')) as {
      bases: AirtableBase[];
    };
    const base = basesResponse.bases.find((b) => b.id === params.documentId);

    return {
      documentId: params.documentId,
      title: base?.name ?? params.documentId,
      sheets,
      url: `https://airtable.com/${params.documentId}`,
    };
  }

  async createDocument(params: CreateDocumentParams): Promise<SpreadsheetMetadata> {
    // Airtable: POST /v0/meta/bases
    // Requires at least one table with at least one field
    const tables = (params.sheets ?? [{ title: 'Table 1' }]).map((sheet) => ({
      name: sheet.title,
      fields: [
        { name: 'Name', type: 'singleLineText' },
        // Add additional text fields based on requested column count
        ...Array.from({ length: Math.max(0, (sheet.columnCount ?? 5) - 1) }, (_, i) => ({
          name: `Field ${i + 2}`,
          type: 'singleLineText' as const,
        })),
      ],
    }));

    const response = (await this.client.post('/v0/meta/bases', {
      name: params.title,
      tables,
      workspaceId: undefined, // Uses default workspace
    })) as AirtableBase;

    const sheets: SheetMetadata[] = response.tables.map((table, index) => ({
      sheetId: index,
      title: table.name,
      index,
      rowCount: 0,
      columnCount: table.fields.length,
    }));

    return {
      documentId: response.id,
      title: response.name,
      sheets,
      url: `https://airtable.com/${response.id}`,
    };
  }

  // ─── Sheet Operations ──────────────────────────────────────

  async addSheet(params: AddSheetParams): Promise<SheetMetadata> {
    // Airtable: POST /v0/meta/bases/{baseId}/tables
    const colCount = params.columnCount ?? 5;
    const fields = [
      { name: 'Name', type: 'singleLineText' },
      ...Array.from({ length: Math.max(0, colCount - 1) }, (_, i) => ({
        name: `Field ${i + 2}`,
        type: 'singleLineText' as const,
      })),
    ];

    const response = (await this.client.post(`/v0/meta/bases/${params.documentId}/tables`, {
      name: params.title,
      fields,
    })) as AirtableTable;

    return {
      sheetId: params.index ?? 0,
      title: response.name,
      index: params.index ?? 0,
      rowCount: 0,
      columnCount: response.fields.length,
      hidden: params.hidden,
    };
  }

  async deleteSheet(params: DeleteSheetParams): Promise<void> {
    // Airtable API does not support deleting tables programmatically.
    void params;
    throw new ServiceError(
      'AirtableBackend.deleteSheet: The Airtable API does not support deleting tables. ' +
        'Tables must be deleted manually through the Airtable UI.',
      'INTERNAL_ERROR',
      'airtable',
      false
    );
  }

  async copySheet(params: CopySheetParams): Promise<CopySheetResult> {
    // Airtable doesn't support copying tables across bases natively.
    void params;
    throw new ServiceError(
      'AirtableBackend.copySheet: Not natively supported by Airtable API. ' +
        'Use getDocument + addSheet + readRange + appendRows as a workaround.',
      'INTERNAL_ERROR',
      'airtable',
      false
    );
  }

  // ─── Batch Mutations ───────────────────────────────────────

  async executeBatchMutations(
    documentId: string,
    request: BatchMutationRequest
  ): Promise<BatchMutationResult> {
    // Airtable has no generic batch mutation endpoint.
    // Each mutation is executed individually.
    const replies: unknown[] = [];

    for (const mutation of request.mutations) {
      const m = mutation as { type: string; table: string; params: Record<string, unknown> };

      switch (m.type) {
        case 'create_records': {
          const response = await this.client.post(
            `/v0/${documentId}/${encodeURIComponent(m.table)}`,
            m.params
          );
          replies.push(response);
          break;
        }
        case 'update_records': {
          const response = await this.client.patch(
            `/v0/${documentId}/${encodeURIComponent(m.table)}`,
            m.params
          );
          replies.push(response);
          break;
        }
        case 'delete_records': {
          const recordIds = m.params['records'] as string[];
          const response = await this.client.delete(
            `/v0/${documentId}/${encodeURIComponent(m.table)}`,
            { records: recordIds }
          );
          replies.push(response);
          break;
        }
        case 'create_field': {
          const response = await this.client.post(
            `/v0/meta/bases/${documentId}/tables/${encodeURIComponent(m.table)}/fields`,
            m.params
          );
          replies.push(response);
          break;
        }
        case 'update_field': {
          const response = await this.client.patch(
            `/v0/meta/bases/${documentId}/tables/${encodeURIComponent(m.table)}/fields/${m.params['fieldId'] as string}`,
            m.params
          );
          replies.push(response);
          break;
        }
        default:
          replies.push({ error: `Unknown mutation type: ${m.type}` });
      }
    }

    return {
      appliedCount: replies.length,
      replies,
    };
  }

  // ─── File/Drive Operations ─────────────────────────────────

  async copyDocument(params: CopyDocumentParams): Promise<FileMetadata> {
    // Airtable doesn't support duplicating bases via API.
    void params;
    throw new ServiceError(
      'AirtableBackend.copyDocument: Not supported by Airtable API. ' +
        'Bases can only be duplicated through the Airtable UI.',
      'INTERNAL_ERROR',
      'airtable',
      false
    );
  }

  async getFileMetadata(documentId: string): Promise<FileMetadata> {
    // Get base info from meta endpoint
    const basesResponse = (await this.client.get('/v0/meta/bases')) as {
      bases: Array<{ id: string; name: string; permissionLevel: string }>;
    };

    const base = basesResponse.bases.find((b) => b.id === documentId);
    if (!base) {
      throw new NotFoundError('base', documentId);
    }

    return {
      documentId: base.id,
      name: base.name,
      mimeType: 'application/x-airtable-base',
      webViewLink: `https://airtable.com/${base.id}`,
    };
  }

  async listFiles(params: ListFilesParams): Promise<ListFilesResult> {
    // Airtable: GET /v0/meta/bases — list all bases accessible to the token
    const response = (await this.client.get('/v0/meta/bases')) as {
      bases: Array<{ id: string; name: string; permissionLevel: string }>;
      offset?: string;
    };

    let bases = response.bases;

    // Simple client-side name filtering (Airtable doesn't support server-side search)
    if (params.query) {
      const query = params.query.toLowerCase();
      bases = bases.filter((b) => b.name.toLowerCase().includes(query));
    }

    // Apply maxResults limit
    const limit = params.maxResults ?? 20;
    const paginatedBases = bases.slice(0, limit);

    const files: FileMetadata[] = paginatedBases.map((base) => ({
      documentId: base.id,
      name: base.name,
      mimeType: 'application/x-airtable-base',
      webViewLink: `https://airtable.com/${base.id}`,
    }));

    return {
      files,
      nextCursor: bases.length > limit ? String(limit) : undefined,
    };
  }

  async listRevisions(params: ListRevisionsParams): Promise<ListRevisionsResult> {
    // Airtable does not provide revision/version history via API.
    void params;
    return {
      revisions: [],
      nextCursor: undefined,
    };
  }

  async getRevision(_documentId: string, _revisionId: string): Promise<RevisionMetadata> {
    throw new ServiceError(
      'AirtableBackend.getRevision: Airtable does not expose revision history via API.',
      'INTERNAL_ERROR',
      'airtable',
      false
    );
  }

  // ─── Escape Hatch ──────────────────────────────────────────

  native<T = unknown>(): T {
    return {
      client: this.client,
      fieldOrderCache: this.fieldOrderCache,
      recordIdCache: this.recordIdCache,
    } as unknown as T;
  }

  // ─── Private Helpers ───────────────────────────────────────

  /**
   * Get the ordered list of field names for a table.
   * Primary field first, then alphabetical by name.
   */
  private async getFieldOrder(baseId: string, tableName: string): Promise<string[]> {
    const cacheKey = `${baseId}:${tableName}`;
    const cached = this.fieldOrderCache.get(cacheKey);
    if (cached) return cached;

    const response = (await this.client.get(`/v0/meta/bases/${baseId}/tables`)) as {
      tables: AirtableTable[];
    };

    const table = response.tables.find((t) => t.name === tableName || t.id === tableName);
    if (!table) {
      throw new NotFoundError('table', `${tableName} in base ${baseId}`);
    }

    // Primary field first, then alphabetical
    const primaryField = table.fields.find((f) => f.id === table.primaryFieldId);
    const otherFields = table.fields
      .filter((f) => f.id !== table.primaryFieldId)
      .sort((a, b) => a.name.localeCompare(b.name));

    const order = primaryField
      ? [primaryField.name, ...otherFields.map((f) => f.name)]
      : otherFields.map((f) => f.name);

    this.fieldOrderCache.set(cacheKey, order);
    return order;
  }

  /**
   * List records from a table with optional field filtering and pagination.
   */
  private async listRecords(
    baseId: string,
    tableName: string,
    options: { fields?: string[]; maxRecords?: number }
  ): Promise<AirtableRecord[]> {
    const allRecords: AirtableRecord[] = [];
    let offset: string | undefined;
    const pageSize = 100; // Airtable max page size

    while (allRecords.length < (options.maxRecords ?? Infinity)) {
      const params: Record<string, string | number> = {
        pageSize: Math.min(pageSize, (options.maxRecords ?? pageSize) - allRecords.length),
      };

      if (offset) {
        params['offset'] = offset;
      }

      // Airtable field filtering uses repeated fields[] params
      // For the scaffold, we request all fields and filter client-side
      const response = (await this.client.get(
        `/v0/${baseId}/${encodeURIComponent(tableName)}`,
        params
      )) as AirtableListRecordsResponse;

      allRecords.push(...response.records);

      if (!response.offset) break;
      offset = response.offset;
    }

    return allRecords;
  }

  /**
   * Get record IDs for row-index mapping.
   * Caches record IDs to avoid re-listing for write operations.
   */
  private async getRecordIds(
    baseId: string,
    tableName: string,
    maxRows: number
  ): Promise<string[]> {
    const cacheKey = `${baseId}:${tableName}`;
    const cached = this.recordIdCache.get(cacheKey);
    if (cached && cached.length >= maxRows) return cached;

    const records = await this.listRecords(baseId, tableName, {
      maxRecords: maxRows,
    });
    const ids = records.map((r) => r.id);

    this.recordIdCache.set(cacheKey, ids);
    return ids;
  }

  /**
   * Coerce an Airtable cell value to CellValue (string | number | boolean | null).
   *
   * Airtable field types and their coercion:
   *   - singleLineText, multilineText, richText → string
   *   - number, currency, percent, duration → number
   *   - checkbox → boolean
   *   - singleSelect → string (option name)
   *   - multipleSelects → string (comma-separated)
   *   - date, dateTime → string (ISO format)
   *   - email, url, phoneNumber → string
   *   - multipleRecordLinks → string (comma-separated record IDs)
   *   - multipleAttachments → string (comma-separated filenames)
   *   - formula, rollup, count, lookup → depends on result type
   *   - rating → number
   *   - barcode → string
   *   - autoNumber → number
   *   - createdTime, lastModifiedTime → string
   *   - createdBy, lastModifiedBy → string (user name)
   *   - button → null (not readable)
   */
  private coerceCellValue(value: AirtableCellValue): CellValue {
    if (value === null || value === undefined) return null;

    // Primitives map directly
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value;

    // Arrays: join as comma-separated strings
    if (Array.isArray(value)) {
      if (value.length === 0) return null;

      // Array of strings (multipleSelects)
      if (typeof value[0] === 'string') {
        return (value as string[]).join(', ');
      }

      // Array of linked records
      if ('id' in (value[0] as Record<string, unknown>)) {
        const records = value as Array<{ id: string; name?: string }>;
        return records.map((r) => r.name ?? r.id).join(', ');
      }

      // Array of attachments
      if ('url' in (value[0] as Record<string, unknown>)) {
        const attachments = value as Array<{ url: string; filename?: string }>;
        return attachments.map((a) => a.filename ?? a.url).join(', ');
      }

      return String(value); // intentional: fallback for unknown array types
    }

    // Objects
    if (typeof value === 'object') {
      // Button link
      if ('label' in value && 'url' in value) {
        return (value as { label: string; url: string }).label;
      }
      // Collaborator
      if ('name' in value) {
        return (value as { name: string }).name;
      }
      return String(value); // intentional: fallback for unknown object types
    }

    return null; // intentional: truly unknown types
  }

  /**
   * Parse a synthetic A1 range reference into Airtable-compatible coordinates.
   *
   * "TableName!A1:D10" → { tableName, startRow: 0, endRow: 10, startCol: 0, endCol: 4 }
   * "A1:D10"           → { tableName: "Table 1", startRow: 0, endRow: 10, startCol: 0, endCol: 4 }
   */
  private parseAirtableRange(range: string): {
    tableName: string;
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
  } {
    // Strip table name prefix
    const bangIndex = range.indexOf('!');
    let tableName = 'Table 1'; // Airtable default table name
    let cellRange = range;

    if (bangIndex !== -1) {
      tableName = range.substring(0, bangIndex);
      // Remove surrounding quotes
      if (tableName.startsWith("'") && tableName.endsWith("'")) {
        tableName = tableName.slice(1, -1);
      }
      cellRange = range.substring(bangIndex + 1);
    }

    // Parse A1:D10 format
    const match = cellRange.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
    if (!match) {
      return {
        tableName,
        startRow: 0,
        endRow: 10000,
        startCol: 0,
        endCol: 100,
      };
    }

    const startCol = this.colLetterToIndex(match[1]!);
    const startRow = parseInt(match[2]!, 10) - 1; // 1-based → 0-based
    const endCol = match[3] ? this.colLetterToIndex(match[3]) + 1 : startCol + 1;
    const endRow = match[4] ? parseInt(match[4], 10) : startRow + 1;

    return { tableName, startRow, endRow, startCol, endCol };
  }

  /**
   * Convert column letters to 0-based index: A→0, B→1, ..., Z→25, AA→26
   */
  private colLetterToIndex(letters: string): number {
    let index = 0;
    for (let i = 0; i < letters.length; i++) {
      index = index * 26 + (letters.charCodeAt(i) - 64);
    }
    return index - 1;
  }
}
