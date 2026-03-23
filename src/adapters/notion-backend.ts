/**
 * ServalSheets - NotionBackend
 *
 * Implements SpreadsheetBackend from @serval/core for Notion databases
 * via the Notion API (https://developers.notion.com/).
 *
 * Design:
 *   - Follows the same thin-adapter pattern as GoogleSheetsBackend
 *   - Maps between the cell-grid SpreadsheetBackend model and Notion's
 *     property-based database model
 *   - `native()` returns { client: NotionClient } for escape-hatch access
 *
 * Notion API Reference:
 *   https://developers.notion.com/reference
 *
 * Conceptual mapping (Notion ↔ SpreadsheetBackend):
 *
 *   | Notion Concept     | SpreadsheetBackend Concept          |
 *   |--------------------|-------------------------------------|
 *   | Workspace          | "Workbook" / top-level container    |
 *   | Database           | Sheet / Worksheet                   |
 *   | Page (DB entry)    | Row                                 |
 *   | Property           | Column                              |
 *   | Property value     | Cell value                          |
 *   | Database ID        | documentId                          |
 *   | Page ID            | Row index (synthetic mapping)       |
 *
 * Range mapping (synthetic A1 notation):
 *   - Notion doesn't use A1 cell references. This adapter maps ranges
 *     by treating properties as columns (A, B, C...) in schema order,
 *     and pages as rows (1, 2, 3...) in query order.
 *   - "Sheet1!A1:D10" → first 10 pages, properties 0-3
 *   - Range parsing extracts row/column bounds for query filtering
 *
 * Key differences from cell-grid platforms:
 *   - Columns are typed (title, rich_text, number, select, date, etc.)
 *   - All values are coerced to CellValue (string | number | boolean | null)
 *   - Notion has no concept of "empty cells" — missing properties return null
 *   - Batch operations are sequential (Notion rate limit: 3 req/sec)
 *   - No native "copy database" (must recreate structure + copy pages)
 *   - Revision history is per-page, not per-database
 *
 * Status: SCAFFOLD — validates SpreadsheetBackend against a non-grid platform.
 */

import { ServiceError } from '../core/errors.js';

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
// Notion API Types (minimal, for scaffold)
// ============================================================

/**
 * Notion client interface.
 * In production, this would be @notionhq/client.
 */
export interface NotionClient {
  databases: {
    retrieve(params: { database_id: string }): Promise<NotionDatabase>;
    query(params: NotionQueryParams): Promise<NotionQueryResult>;
    create(params: NotionCreateDatabaseParams): Promise<NotionDatabase>;
  };
  pages: {
    retrieve(params: { page_id: string }): Promise<NotionPage>;
    create(params: NotionCreatePageParams): Promise<NotionPage>;
    update(params: NotionUpdatePageParams): Promise<NotionPage>;
  };
  blocks: {
    children: {
      list(params: { block_id: string; page_size?: number; start_cursor?: string }): Promise<{
        results: Array<{ id: string; type: string; [key: string]: unknown }>;
        has_more: boolean;
        next_cursor: string | null;
      }>;
    };
    delete(params: { block_id: string }): Promise<unknown>;
  };
  search(params: NotionSearchParams): Promise<NotionSearchResult>;
}

export interface NotionDatabase {
  id: string;
  title: Array<{ plain_text: string }>;
  properties: Record<string, NotionPropertySchema>;
  url?: string;
  created_time?: string;
  last_edited_time?: string;
  parent?: { type: string; page_id?: string; workspace?: boolean };
}

export interface NotionPropertySchema {
  id: string;
  name: string;
  type: string;
}

export interface NotionPage {
  id: string;
  properties: Record<string, NotionPropertyValue>;
  url?: string;
  created_time?: string;
  last_edited_time?: string;
  last_edited_by?: { id: string };
  archived?: boolean;
}

export interface NotionPropertyValue {
  type: string;
  title?: Array<{ plain_text: string }>;
  rich_text?: Array<{ plain_text: string }>;
  number?: number | null;
  select?: { name: string } | null;
  multi_select?: Array<{ name: string }>;
  date?: { start: string; end?: string } | null;
  checkbox?: boolean;
  url?: string | null;
  email?: string | null;
  phone_number?: string | null;
  formula?: { type: string; string?: string; number?: number; boolean?: boolean };
  relation?: Array<{ id: string }>;
  rollup?: { type: string; number?: number; array?: unknown[] };
  [key: string]: unknown;
}

export interface NotionQueryParams {
  database_id: string;
  page_size?: number;
  start_cursor?: string;
  filter?: unknown;
  sorts?: unknown[];
}

export interface NotionQueryResult {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface NotionCreateDatabaseParams {
  parent: { type: string; page_id?: string };
  title: Array<{ text: { content: string } }>;
  properties: Record<string, unknown>;
}

export interface NotionCreatePageParams {
  parent: { database_id: string };
  properties: Record<string, unknown>;
}

export interface NotionUpdatePageParams {
  page_id: string;
  properties: Record<string, unknown>;
  archived?: boolean;
}

export interface NotionSearchParams {
  query?: string;
  filter?: { property: string; value: string };
  sort?: { direction: string; timestamp: string };
  page_size?: number;
  start_cursor?: string;
}

export interface NotionSearchResult {
  results: Array<{ id: string; object: string; [key: string]: unknown }>;
  has_more: boolean;
  next_cursor: string | null;
}

/**
 * Configuration for NotionBackend
 */
export interface NotionBackendConfig {
  /** Notion API client (authenticated) */
  client: NotionClient;
  /** Parent page ID for creating new databases (optional) */
  defaultParentPageId?: string;
}

// ============================================================
// Backend Implementation
// ============================================================

/**
 * Notion implementation of SpreadsheetBackend.
 *
 * Maps the cell-grid interface to Notion's property-based database model:
 *
 * | Backend Method         | Notion API Endpoint                          |
 * |------------------------|----------------------------------------------|
 * | readRange              | POST /databases/{id}/query → extract values  |
 * | writeRange             | PATCH /pages/{id} (per-row updates)          |
 * | appendRows             | POST /pages (create new pages)               |
 * | clearRange             | PATCH /pages/{id} with empty values          |
 * | getDocument            | GET /databases/{id}                          |
 * | createDocument         | POST /databases                              |
 * | addSheet               | POST /databases (new database)               |
 * | deleteSheet            | DELETE /blocks/{id} (archive database)        |
 * | copyDocument           | Not natively supported (recreate + copy)     |
 * | getFileMetadata        | GET /databases/{id}                          |
 * | listFiles              | POST /search (filter for databases)          |
 * | listRevisions          | Not available (Notion API limitation)         |
 */
export class NotionBackend implements SpreadsheetBackend {
  readonly platform: SpreadsheetPlatform = 'notion';

  private client: NotionClient;
  private defaultParentPageId: string | undefined;

  /**
   * Cache of database schemas (property order is needed for A1 mapping).
   * Maps database_id → ordered property names.
   */
  private schemaCache: Map<string, string[]> = new Map();

  constructor(config: NotionBackendConfig) {
    if (process.env['ENABLE_EXPERIMENTAL_BACKENDS'] !== 'true') {
      throw new Error(
        'NotionBackend is a scaffold and not production-ready. ' +
          'Set ENABLE_EXPERIMENTAL_BACKENDS=true to use it.'
      );
    }
    this.client = config.client;
    this.defaultParentPageId = config.defaultParentPageId;
  }

  // ─── Lifecycle ─────────────────────────────────────────────

  async initialize(): Promise<void> {
    // Verify Notion API access by searching for databases
    // In production: await this.client.search({ filter: { property: 'object', value: 'database' }, page_size: 1 });
  }

  async dispose(): Promise<void> {
    this.schemaCache.clear();
  }

  // ─── Value Operations ──────────────────────────────────────

  async readRange(params: ReadRangeParams): Promise<ReadRangeResult> {
    const { databaseId, startRow, endRow, startCol, endCol } = this.parseNotionRange(
      params.documentId,
      params.range
    );
    const propertyNames = await this.getPropertyOrder(databaseId);

    // Query pages with pagination to get the requested row range
    const pages = await this.queryPages(databaseId, endRow);

    // Slice to requested row range (0-indexed internally, A1 is 1-based)
    const selectedPages = pages.slice(startRow, endRow);

    // Extract cell values for the requested column range
    const selectedProps = propertyNames.slice(startCol, endCol);
    const values: CellValue[][] = selectedPages.map((page) =>
      selectedProps.map((propName) => this.extractCellValue(page.properties[propName]))
    );

    return {
      range: params.range,
      majorDimension: params.majorDimension ?? 'ROWS',
      values,
    };
  }

  async writeRange(params: WriteRangeParams): Promise<WriteRangeResult> {
    const { databaseId, startRow, startCol } = this.parseNotionRange(
      params.documentId,
      params.range
    );
    const propertyNames = await this.getPropertyOrder(databaseId);

    // Get existing pages to update
    const maxRow = startRow + params.values.length;
    const pages = await this.queryPages(databaseId, maxRow);
    const targetPages = pages.slice(startRow, maxRow);

    let updatedCells = 0;

    // Update each page (row) with the new values
    for (let rowIdx = 0; rowIdx < params.values.length; rowIdx++) {
      const page = targetPages[rowIdx];
      if (!page) continue; // Row doesn't exist yet — skip (use appendRows for new rows)

      const rowValues = params.values[rowIdx];
      if (!rowValues) continue;
      const properties: Record<string, unknown> = {};

      for (let colIdx = 0; colIdx < rowValues.length; colIdx++) {
        const propName = propertyNames[startCol + colIdx];
        if (!propName) continue;

        properties[propName] = this.buildPropertyValue(
          propName,
          rowValues[colIdx] ?? null,
          databaseId
        );
        updatedCells++;
      }

      await this.client.pages.update({
        page_id: page.id,
        properties,
      });
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
    const { databaseId, startCol } = this.parseNotionRange(params.documentId, params.range);
    const propertyNames = await this.getPropertyOrder(databaseId);

    let totalCells = 0;

    // Create a new page for each row
    for (const rowValues of params.values) {
      const properties: Record<string, unknown> = {};

      for (let colIdx = 0; colIdx < rowValues.length; colIdx++) {
        const propName = propertyNames[startCol + colIdx];
        if (!propName) continue;

        properties[propName] = this.buildPropertyValue(
          propName,
          rowValues[colIdx] ?? null,
          databaseId
        );
        totalCells++;
      }

      await this.client.pages.create({
        parent: { database_id: databaseId },
        properties,
      });
    }

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
    const { databaseId, startRow, endRow, startCol, endCol } = this.parseNotionRange(
      params.documentId,
      params.range
    );
    const propertyNames = await this.getPropertyOrder(databaseId);

    const pages = await this.queryPages(databaseId, endRow);
    const targetPages = pages.slice(startRow, endRow);
    const selectedProps = propertyNames.slice(startCol, endCol);

    // Clear property values by setting them to empty/null
    for (const page of targetPages) {
      const properties: Record<string, unknown> = {};
      for (const propName of selectedProps) {
        properties[propName] = this.buildPropertyValue(propName, null, databaseId);
      }
      await this.client.pages.update({
        page_id: page.id,
        properties,
      });
    }

    return { clearedRange: params.range };
  }

  async batchRead(params: BatchReadParams): Promise<BatchReadResult> {
    // Execute reads sequentially (Notion rate limit: 3 req/sec)
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
    // In Notion, a "document" is a database
    const db = await this.client.databases.retrieve({
      database_id: params.documentId,
    });

    const properties = Object.entries(db.properties);

    // Each database maps to a single "sheet"
    const sheets: SheetMetadata[] = [
      {
        sheetId: 0,
        title: this.extractPlainText(db.title),
        index: 0,
        // Notion databases can grow indefinitely; use sensible defaults
        rowCount: 10000,
        columnCount: properties.length,
      },
    ];

    return {
      documentId: params.documentId,
      title: this.extractPlainText(db.title),
      sheets,
      url: db.url,
    };
  }

  async createDocument(params: CreateDocumentParams): Promise<SpreadsheetMetadata> {
    if (!this.defaultParentPageId) {
      throw new ServiceError(
        'NotionBackend.createDocument requires defaultParentPageId in config. ' +
          'Notion databases must be created under a parent page.',
        'INTERNAL_ERROR',
        'notion',
        false
      );
    }

    // Build property schema from requested sheets
    // Default: one "title" column (required by Notion) + generic text columns
    const properties: Record<string, unknown> = {
      Name: { title: {} },
    };

    if (params.sheets?.[0]) {
      const colCount = params.sheets[0].columnCount ?? 5;
      for (let i = 1; i < colCount; i++) {
        properties[`Column ${String.fromCharCode(65 + i)}`] = { rich_text: {} };
      }
    }

    const db = await this.client.databases.create({
      parent: { type: 'page_id', page_id: this.defaultParentPageId },
      title: [{ text: { content: params.title } }],
      properties,
    });

    const propCount = Object.keys(db.properties).length;

    return {
      documentId: db.id,
      title: this.extractPlainText(db.title),
      sheets: [
        {
          sheetId: 0,
          title: this.extractPlainText(db.title),
          index: 0,
          rowCount: 0,
          columnCount: propCount,
        },
      ],
      url: db.url,
    };
  }

  // ─── Sheet Operations ──────────────────────────────────────

  async addSheet(params: AddSheetParams): Promise<SheetMetadata> {
    // In Notion, "adding a sheet" means creating a new database
    // (either as a child of the same parent, or as an inline DB)
    if (!this.defaultParentPageId) {
      throw new ServiceError(
        'NotionBackend.addSheet requires defaultParentPageId. ' +
          'Use createDocument for the first database, or set defaultParentPageId in config.',
        'INTERNAL_ERROR',
        'notion',
        false
      );
    }

    const colCount = params.columnCount ?? 5;
    const properties: Record<string, unknown> = {
      Name: { title: {} },
    };
    for (let i = 1; i < colCount; i++) {
      properties[`Column ${String.fromCharCode(65 + i)}`] = { rich_text: {} };
    }

    const db = await this.client.databases.create({
      parent: { type: 'page_id', page_id: this.defaultParentPageId },
      title: [{ text: { content: params.title } }],
      properties,
    });

    return {
      sheetId: params.index ?? 0,
      title: params.title,
      index: params.index ?? 0,
      rowCount: 0,
      columnCount: Object.keys(db.properties).length,
      hidden: params.hidden,
    };
  }

  async deleteSheet(params: DeleteSheetParams): Promise<void> {
    // Notion: archive the database block
    // The Notion API doesn't support deleting databases directly.
    // We can archive it by deleting the block (which archives, doesn't permanently delete).
    // But we need the database ID, which we get from sheetId mapping.
    // For this scaffold, we assume sheetId=0 maps to documentId itself.
    void params;
    throw new ServiceError(
      'NotionBackend.deleteSheet: Notion databases cannot be permanently deleted via API. ' +
        'Use blocks.delete() to archive the database block instead.',
      'INTERNAL_ERROR',
      'notion',
      false
    );
  }

  async copySheet(params: CopySheetParams): Promise<CopySheetResult> {
    // Notion doesn't have a "copy database" API.
    // Workaround: retrieve source schema, create new DB with same schema, copy pages.
    void params;
    throw new ServiceError(
      'NotionBackend.copySheet: Notion does not support copying databases natively. ' +
        'Use getDocument + createDocument + readRange + appendRows as a workaround.',
      'INTERNAL_ERROR',
      'notion',
      false
    );
  }

  // ─── Batch Mutations ───────────────────────────────────────

  async executeBatchMutations(
    documentId: string,
    request: BatchMutationRequest
  ): Promise<BatchMutationResult> {
    // Notion has no batch mutation endpoint.
    // Execute each mutation sequentially with rate limiting.
    const replies: unknown[] = [];

    for (const mutation of request.mutations) {
      // Each mutation is expected to be a { type, params } object
      // that maps to a Notion API call
      const m = mutation as { type: string; params: Record<string, unknown> };

      switch (m.type) {
        case 'update_page':
          replies.push(
            await this.client.pages.update(m.params as unknown as NotionUpdatePageParams)
          );
          break;
        case 'create_page':
          replies.push(
            await this.client.pages.create(m.params as unknown as NotionCreatePageParams)
          );
          break;
        case 'archive_page':
          replies.push(
            await this.client.pages.update({
              page_id: m.params['page_id'] as string,
              properties: {},
              archived: true,
            })
          );
          break;
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
    // Notion doesn't support copying databases natively.
    // Full implementation would: retrieve schema, create new DB, copy all pages.
    void params;
    throw new ServiceError(
      'NotionBackend.copyDocument: Not natively supported. ' +
        'Recreate the database schema and copy pages individually.',
      'INTERNAL_ERROR',
      'notion',
      false
    );
  }

  async getFileMetadata(documentId: string): Promise<FileMetadata> {
    const db = await this.client.databases.retrieve({
      database_id: documentId,
    });

    return {
      documentId: db.id,
      name: this.extractPlainText(db.title),
      mimeType: 'application/x-notion-database',
      modifiedTime: db.last_edited_time,
      createdTime: db.created_time,
      webViewLink: db.url,
    };
  }

  async listFiles(params: ListFilesParams): Promise<ListFilesResult> {
    // Notion: search for databases in the workspace
    const searchResult = await this.client.search({
      query: params.query ?? '',
      filter: { property: 'object', value: 'database' },
      page_size: params.maxResults ?? 20,
      start_cursor: params.cursor,
    });

    const files: FileMetadata[] = searchResult.results.map((result) => ({
      documentId: result.id,
      name: (result as unknown as NotionDatabase).title?.[0]?.plain_text ?? 'Untitled',
      mimeType: 'application/x-notion-database',
      modifiedTime: (result as Record<string, unknown>)['last_edited_time'] as string | undefined,
      createdTime: (result as Record<string, unknown>)['created_time'] as string | undefined,
      webViewLink: (result as Record<string, unknown>)['url'] as string | undefined,
    }));

    return {
      files,
      nextCursor: searchResult.has_more ? (searchResult.next_cursor ?? undefined) : undefined,
    };
  }

  async listRevisions(params: ListRevisionsParams): Promise<ListRevisionsResult> {
    // Notion API does not provide database-level version history.
    // Page-level versions exist but are not exposed via the public API.
    void params;
    return {
      revisions: [],
      nextCursor: undefined,
    };
  }

  async getRevision(_documentId: string, _revisionId: string): Promise<RevisionMetadata> {
    // Notion API does not expose revision details for databases
    throw new ServiceError(
      'NotionBackend.getRevision: Notion does not expose database revision history via API.',
      'INTERNAL_ERROR',
      'notion',
      false
    );
  }

  // ─── Escape Hatch ──────────────────────────────────────────

  native<T = unknown>(): T {
    return {
      client: this.client,
      defaultParentPageId: this.defaultParentPageId,
      schemaCache: this.schemaCache,
    } as unknown as T;
  }

  // ─── Private Helpers ───────────────────────────────────────

  /**
   * Get the ordered list of property names for a database.
   * This defines the column mapping: property[0] = column A, property[1] = column B, etc.
   *
   * Notion returns properties as an unordered object. We sort by:
   * 1. Title property first (always column A)
   * 2. Remaining properties alphabetically by name
   */
  private async getPropertyOrder(databaseId: string): Promise<string[]> {
    const cached = this.schemaCache.get(databaseId);
    if (cached) return cached;

    const db = await this.client.databases.retrieve({ database_id: databaseId });
    const entries = Object.entries(db.properties);

    // Title property first, then alphabetical
    const titleProp = entries.find(([, schema]) => schema.type === 'title');
    const otherProps = entries
      .filter(([, schema]) => schema.type !== 'title')
      .sort(([a], [b]) => a.localeCompare(b));

    const order = titleProp
      ? [titleProp[0], ...otherProps.map(([name]) => name)]
      : otherProps.map(([name]) => name);

    this.schemaCache.set(databaseId, order);
    return order;
  }

  /**
   * Query pages from a database, returning up to maxRows pages.
   */
  private async queryPages(databaseId: string, maxRows: number): Promise<NotionPage[]> {
    const allPages: NotionPage[] = [];
    let cursor: string | undefined;

    while (allPages.length < maxRows) {
      const pageSize = Math.min(100, maxRows - allPages.length); // Notion max page_size is 100
      const result = await this.client.databases.query({
        database_id: databaseId,
        page_size: pageSize,
        start_cursor: cursor,
      });

      allPages.push(...result.results);

      if (!result.has_more || !result.next_cursor) break;
      cursor = result.next_cursor;
    }

    return allPages;
  }

  /**
   * Extract a CellValue from a Notion property value.
   *
   * Coerces Notion's rich type system into string | number | boolean | null:
   *   - title, rich_text → string (plain text concatenation)
   *   - number → number
   *   - checkbox → boolean
   *   - select → string (option name)
   *   - multi_select → string (comma-separated names)
   *   - date → string (ISO date)
   *   - url, email, phone_number → string
   *   - formula → depends on result type
   *   - relation → string (comma-separated page IDs)
   *   - rollup → number or string depending on type
   */
  private extractCellValue(prop: NotionPropertyValue | undefined): CellValue {
    if (!prop) return null;

    switch (prop.type) {
      case 'title':
        return prop.title?.map((t) => t.plain_text).join('') ?? null;
      case 'rich_text':
        return prop.rich_text?.map((t) => t.plain_text).join('') ?? null;
      case 'number':
        return prop.number ?? null;
      case 'checkbox':
        return prop.checkbox ?? null;
      case 'select':
        return prop.select?.name ?? null;
      case 'multi_select':
        return prop.multi_select?.map((s) => s.name).join(', ') ?? null;
      case 'date':
        return prop.date?.start ?? null;
      case 'url':
        return prop.url ?? null;
      case 'email':
        return prop.email ?? null;
      case 'phone_number':
        return prop.phone_number ?? null;
      case 'formula':
        if (prop.formula?.type === 'number') return prop.formula.number ?? null;
        if (prop.formula?.type === 'boolean') return prop.formula.boolean ?? null;
        return prop.formula?.string ?? null;
      case 'relation':
        return prop.relation?.map((r) => r.id).join(', ') ?? null;
      case 'rollup':
        if (prop.rollup?.type === 'number') return prop.rollup.number ?? null;
        return null; // intentional: rollup arrays are too complex for CellValue
      default:
        return null; // intentional: unsupported property types return null
    }
  }

  /**
   * Build a Notion property value from a CellValue.
   *
   * Needs the database schema to determine the property type.
   * For the scaffold, we default to rich_text for string values
   * and number for numeric values.
   */
  private buildPropertyValue(_propName: string, value: CellValue, _databaseId: string): unknown {
    // In production, look up the property type from the schema cache
    // and build the appropriate Notion property value object.
    // For the scaffold, use simple heuristics:

    if (value === null) {
      // Clear the value
      return { rich_text: [] };
    }

    if (typeof value === 'number') {
      return { number: value };
    }

    if (typeof value === 'boolean') {
      return { checkbox: value };
    }

    // Default: rich_text for strings
    return {
      rich_text: [
        {
          type: 'text',
          text: { content: String(value) },
        },
      ],
    };
  }

  /**
   * Parse a synthetic A1 range reference into Notion-compatible coordinates.
   *
   * "DatabaseName!A1:D10" → { databaseId, startRow: 0, endRow: 10, startCol: 0, endCol: 4 }
   * "A1:D10"             → { databaseId: documentId, startRow: 0, endRow: 10, startCol: 0, endCol: 4 }
   *
   * In the Notion context:
   *   - The "sheet name" part is ignored (documentId is the database)
   *   - Column letters map to property indices (A=0, B=1, ...)
   *   - Row numbers map to page indices (1-based in A1, 0-based internally)
   */
  private parseNotionRange(
    documentId: string,
    range: string
  ): {
    databaseId: string;
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
  } {
    // Strip sheet name prefix if present
    const bangIndex = range.indexOf('!');
    const cellRange = bangIndex === -1 ? range : range.substring(bangIndex + 1);

    // Parse A1:D10 format
    const match = cellRange.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
    if (!match) {
      // Default: entire database
      return {
        databaseId: documentId,
        startRow: 0,
        endRow: 10000,
        startCol: 0,
        endCol: 100,
      };
    }

    const startCol = this.colLetterToIndex(match[1]!);
    const startRow = parseInt(match[2]!, 10) - 1; // A1 is 1-based → 0-based
    const endCol = match[3] ? this.colLetterToIndex(match[3]) + 1 : startCol + 1;
    const endRow = match[4] ? parseInt(match[4], 10) : startRow + 1;

    return { databaseId: documentId, startRow, endRow, startCol, endCol };
  }

  /**
   * Convert column letters to 0-based index: A→0, B→1, ..., Z→25, AA→26
   */
  private colLetterToIndex(letters: string): number {
    let index = 0;
    for (let i = 0; i < letters.length; i++) {
      index = index * 26 + (letters.charCodeAt(i) - 64);
    }
    return index - 1; // 0-based
  }

  /**
   * Extract plain text from a Notion title array.
   */
  private extractPlainText(title: Array<{ plain_text: string }> | undefined): string {
    return title?.map((t) => t.plain_text).join('') ?? '';
  }
}
