/**
 * ServalSheets - GoogleSheetsBackend
 *
 * Implements SpreadsheetBackend from @serval/core by wrapping
 * the existing GoogleApiClient and its auto-retry/circuit-breaker proxy.
 *
 * Design:
 *   - Thin adapter: delegates all work to GoogleApiClient
 *   - No new error handling (GoogleApiClient already has retry + circuit breaker)
 *   - Maps between platform-agnostic types and Google Sheets API types
 *   - `native()` returns { sheets, drive, bigquery } for escape-hatch access
 */

import type { sheets_v4, drive_v3 } from 'googleapis';
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
import type { GoogleApiClient } from '../services/google-api.js';

/**
 * Google Sheets implementation of SpreadsheetBackend.
 *
 * Wraps an existing GoogleApiClient instance — does NOT create its own.
 * The caller is responsible for initializing and disposing the GoogleApiClient.
 */
export class GoogleSheetsBackend implements SpreadsheetBackend {
  readonly platform: SpreadsheetPlatform = 'google-sheets';

  private client: GoogleApiClient;
  private _sheets: sheets_v4.Sheets | null = null;
  private _drive: drive_v3.Drive | null = null;

  constructor(client: GoogleApiClient) {
    this.client = client;
  }

  // ─── Lifecycle ─────────────────────────────────────────────

  async initialize(): Promise<void> {
    // GoogleApiClient is already initialized by the caller.
    // Cache the API client references for convenience.
    this._sheets = this.client.sheets;
    this._drive = this.client.drive;
  }

  async dispose(): Promise<void> {
    // GoogleApiClient lifecycle is managed externally.
    this._sheets = null;
    this._drive = null;
  }

  // ─── Convenience Getters ───────────────────────────────────

  private get sheets(): sheets_v4.Sheets {
    if (!this._sheets) {
      this._sheets = this.client.sheets;
    }
    return this._sheets;
  }

  private get drive(): drive_v3.Drive {
    if (!this._drive) {
      this._drive = this.client.drive;
    }
    return this._drive;
  }

  // ─── Value Operations ──────────────────────────────────────

  async readRange(params: ReadRangeParams): Promise<ReadRangeResult> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: params.documentId,
      range: params.range,
      majorDimension: params.majorDimension,
      valueRenderOption: params.valueRenderOption,
      dateTimeRenderOption: params.dateTimeRenderOption,
    });

    const data = response.data;
    return {
      range: data.range ?? params.range,
      majorDimension: (data.majorDimension as 'ROWS' | 'COLUMNS') ?? 'ROWS',
      values: (data.values as (string | number | boolean | null)[][]) ?? [],
    };
  }

  async writeRange(params: WriteRangeParams): Promise<WriteRangeResult> {
    const response = await this.sheets.spreadsheets.values.update({
      spreadsheetId: params.documentId,
      range: params.range,
      valueInputOption: params.valueInputOption ?? 'USER_ENTERED',
      includeValuesInResponse: params.includeValuesInResponse,
      requestBody: {
        range: params.range,
        majorDimension: params.majorDimension,
        values: params.values,
      },
    });

    const data = response.data;
    return {
      updatedRange: data.updatedRange ?? params.range,
      updatedRows: data.updatedRows ?? 0,
      updatedColumns: data.updatedColumns ?? 0,
      updatedCells: data.updatedCells ?? 0,
      updatedValues: data.updatedData?.values as (string | number | boolean | null)[][] | undefined,
    };
  }

  async appendRows(params: AppendParams): Promise<AppendResult> {
    const response = await this.sheets.spreadsheets.values.append({
      spreadsheetId: params.documentId,
      range: params.range,
      valueInputOption: params.valueInputOption ?? 'USER_ENTERED',
      insertDataOption: params.insertDataOption ?? 'INSERT_ROWS',
      includeValuesInResponse: params.includeValuesInResponse,
      requestBody: {
        range: params.range,
        values: params.values,
      },
    });

    const data = response.data;
    const updates = data.updates;
    return {
      tableRange: data.tableRange ?? params.range,
      updatedRange: updates?.updatedRange ?? params.range,
      updatedRows: updates?.updatedRows ?? 0,
      updatedColumns: updates?.updatedColumns ?? 0,
      updatedCells: updates?.updatedCells ?? 0,
    };
  }

  async clearRange(params: ClearRangeParams): Promise<ClearRangeResult> {
    const response = await this.sheets.spreadsheets.values.clear({
      spreadsheetId: params.documentId,
      range: params.range,
      requestBody: {},
    });

    return {
      clearedRange: response.data.clearedRange ?? params.range,
    };
  }

  async batchRead(params: BatchReadParams): Promise<BatchReadResult> {
    const response = await this.sheets.spreadsheets.values.batchGet({
      spreadsheetId: params.documentId,
      ranges: params.ranges,
      majorDimension: params.majorDimension,
      valueRenderOption: params.valueRenderOption,
      dateTimeRenderOption: params.dateTimeRenderOption,
    });

    const valueRanges = (response.data.valueRanges ?? []).map((vr) => ({
      range: vr.range ?? '',
      majorDimension: (vr.majorDimension as 'ROWS' | 'COLUMNS') ?? 'ROWS',
      values: (vr.values as (string | number | boolean | null)[][]) ?? [],
    }));

    return { valueRanges };
  }

  async batchWrite(params: BatchWriteParams): Promise<BatchWriteResult> {
    const response = await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: params.documentId,
      requestBody: {
        valueInputOption: params.valueInputOption ?? 'USER_ENTERED',
        includeValuesInResponse: params.includeValuesInResponse,
        data: params.data.map((d) => ({
          range: d.range,
          majorDimension: d.majorDimension,
          values: d.values,
        })),
      },
    });

    const data = response.data;
    return {
      totalUpdatedRows: data.totalUpdatedRows ?? 0,
      totalUpdatedColumns: data.totalUpdatedColumns ?? 0,
      totalUpdatedCells: data.totalUpdatedCells ?? 0,
      responses: (data.responses ?? []).map((r) => ({
        updatedRange: r.updatedRange ?? '',
        updatedRows: r.updatedRows ?? 0,
        updatedColumns: r.updatedColumns ?? 0,
        updatedCells: r.updatedCells ?? 0,
        updatedValues: r.updatedData?.values as (string | number | boolean | null)[][] | undefined,
      })),
    };
  }

  async batchClear(params: BatchClearParams): Promise<BatchClearResult> {
    const response = await this.sheets.spreadsheets.values.batchClear({
      spreadsheetId: params.documentId,
      requestBody: {
        ranges: params.ranges,
      },
    });

    return {
      clearedRanges: response.data.clearedRanges ?? [],
    };
  }

  // ─── Document Operations ───────────────────────────────────

  async getDocument(params: GetDocumentParams): Promise<SpreadsheetMetadata> {
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId: params.documentId,
      ranges: params.ranges,
      includeGridData: params.includeGridData,
      fields: params.fields,
    });

    return this.toSpreadsheetMetadata(response.data);
  }

  async createDocument(params: CreateDocumentParams): Promise<SpreadsheetMetadata> {
    const response = await this.sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: params.title,
          locale: params.locale,
          timeZone: params.timeZone,
        },
        sheets: params.sheets?.map((s) => ({
          properties: {
            title: s.title,
            gridProperties: {
              rowCount: s.rowCount,
              columnCount: s.columnCount,
            },
          },
        })),
      },
    });

    return this.toSpreadsheetMetadata(response.data);
  }

  // ─── Sheet Operations ──────────────────────────────────────

  async addSheet(params: AddSheetParams): Promise<SheetMetadata> {
    const response = await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: params.documentId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: params.title,
                index: params.index,
                hidden: params.hidden,
                tabColorStyle: params.tabColor ? { rgbColor: params.tabColor } : undefined,
                gridProperties: {
                  rowCount: params.rowCount ?? 1000,
                  columnCount: params.columnCount ?? 26,
                },
              },
            },
          },
        ],
      },
    });

    const reply = response.data.replies?.[0]?.addSheet;
    const props = reply?.properties;

    return {
      sheetId: props?.sheetId ?? 0,
      title: props?.title ?? params.title,
      index: props?.index ?? 0,
      rowCount: props?.gridProperties?.rowCount ?? params.rowCount ?? 1000,
      columnCount: props?.gridProperties?.columnCount ?? params.columnCount ?? 26,
      hidden: props?.hidden ?? undefined,
    };
  }

  async deleteSheet(params: DeleteSheetParams): Promise<void> {
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: params.documentId,
      requestBody: {
        requests: [{ deleteSheet: { sheetId: params.sheetId } }],
      },
    });
  }

  async copySheet(params: CopySheetParams): Promise<CopySheetResult> {
    const response = await this.sheets.spreadsheets.sheets.copyTo({
      spreadsheetId: params.documentId,
      sheetId: params.sheetId,
      requestBody: {
        destinationSpreadsheetId: params.destinationDocumentId,
      },
    });

    return {
      sheetId: response.data.sheetId ?? 0,
      title: response.data.title ?? '',
      index: response.data.index ?? 0,
    };
  }

  // ─── Batch Mutations ───────────────────────────────────────

  async executeBatchMutations(
    documentId: string,
    request: BatchMutationRequest
  ): Promise<BatchMutationResult> {
    const response = await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: documentId,
      requestBody: {
        requests: request.mutations as sheets_v4.Schema$Request[],
      },
    });

    return {
      appliedCount: response.data.replies?.length ?? 0,
      replies: response.data.replies ?? [],
    };
  }

  // ─── File/Drive Operations ─────────────────────────────────

  async copyDocument(params: CopyDocumentParams): Promise<FileMetadata> {
    const response = await this.drive.files.copy({
      fileId: params.documentId,
      supportsAllDrives: true,
      requestBody: {
        name: params.title,
        parents: params.destinationFolderId ? [params.destinationFolderId] : undefined,
      },
      fields: 'id,name,mimeType,modifiedTime,createdTime,owners,webViewLink',
    });

    return this.toFileMetadata(response.data);
  }

  async getFileMetadata(documentId: string): Promise<FileMetadata> {
    const response = await this.drive.files.get({
      fileId: documentId,
      supportsAllDrives: true,
      fields: 'id,name,mimeType,modifiedTime,createdTime,owners,webViewLink',
    });

    return this.toFileMetadata(response.data);
  }

  async listFiles(params: ListFilesParams): Promise<ListFilesResult> {
    const response = await this.drive.files.list({
      q: params.query ?? "mimeType='application/vnd.google-apps.spreadsheet'",
      pageSize: params.maxResults ?? 20,
      orderBy: params.orderBy ?? 'modifiedTime desc',
      pageToken: params.cursor,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,owners,webViewLink)',
    });

    return {
      files: (response.data.files ?? []).map((f) => this.toFileMetadata(f)),
      nextCursor: response.data.nextPageToken ?? undefined,
    };
  }

  async listRevisions(params: ListRevisionsParams): Promise<ListRevisionsResult> {
    const response = await this.drive.revisions.list({
      fileId: params.documentId,
      pageSize: params.maxResults ?? 20,
      pageToken: params.cursor,
      fields: 'nextPageToken,revisions(id,modifiedTime,lastModifyingUser)',
    });

    return {
      revisions: (response.data.revisions ?? []).map((r) => ({
        revisionId: r.id ?? '',
        modifiedTime: r.modifiedTime ?? '',
        lastModifyingUser: r.lastModifyingUser
          ? {
              email: r.lastModifyingUser.emailAddress ?? '',
              displayName: r.lastModifyingUser.displayName ?? undefined,
            }
          : undefined,
      })),
      nextCursor: response.data.nextPageToken ?? undefined,
    };
  }

  async getRevision(documentId: string, revisionId: string): Promise<RevisionMetadata> {
    const response = await this.drive.revisions.get({
      fileId: documentId,
      revisionId,
      fields: 'id,modifiedTime,lastModifyingUser',
    });

    return {
      revisionId: response.data.id ?? revisionId,
      modifiedTime: response.data.modifiedTime ?? '',
      lastModifyingUser: response.data.lastModifyingUser
        ? {
            email: response.data.lastModifyingUser.emailAddress ?? '',
            displayName: response.data.lastModifyingUser.displayName ?? undefined,
          }
        : undefined,
    };
  }

  // ─── Escape Hatch ──────────────────────────────────────────

  native<T = unknown>(): T {
    return {
      sheets: this.sheets,
      drive: this.drive,
      bigquery: this.client.bigquery,
      docs: this.client.docs,
      slides: this.client.slides,
      oauth2: this.client.oauth2,
      client: this.client,
    } as unknown as T;
  }

  // ─── Private Helpers ───────────────────────────────────────

  private toSpreadsheetMetadata(data: sheets_v4.Schema$Spreadsheet): SpreadsheetMetadata {
    return {
      documentId: data.spreadsheetId ?? '',
      title: data.properties?.title ?? '',
      locale: data.properties?.locale ?? undefined,
      timeZone: data.properties?.timeZone ?? undefined,
      url: data.spreadsheetUrl ?? undefined,
      sheets: (data.sheets ?? []).map((s) => this.toSheetMetadata(s)),
    };
  }

  private toSheetMetadata(sheet: sheets_v4.Schema$Sheet): SheetMetadata {
    const props = sheet.properties;
    return {
      sheetId: props?.sheetId ?? 0,
      title: props?.title ?? '',
      index: props?.index ?? 0,
      rowCount: props?.gridProperties?.rowCount ?? 0,
      columnCount: props?.gridProperties?.columnCount ?? 0,
      hidden: props?.hidden ?? undefined,
      tabColor: props?.tabColorStyle?.rgbColor
        ? {
            red: props.tabColorStyle.rgbColor.red ?? undefined,
            green: props.tabColorStyle.rgbColor.green ?? undefined,
            blue: props.tabColorStyle.rgbColor.blue ?? undefined,
            alpha: props.tabColorStyle.rgbColor.alpha ?? undefined,
          }
        : undefined,
      frozen:
        props?.gridProperties?.frozenRowCount || props?.gridProperties?.frozenColumnCount
          ? {
              rows: props?.gridProperties?.frozenRowCount ?? undefined,
              columns: props?.gridProperties?.frozenColumnCount ?? undefined,
            }
          : undefined,
    };
  }

  private toFileMetadata(data: drive_v3.Schema$File): FileMetadata {
    return {
      documentId: data.id ?? '',
      name: data.name ?? '',
      mimeType: data.mimeType ?? '',
      modifiedTime: data.modifiedTime ?? undefined,
      createdTime: data.createdTime ?? undefined,
      owners: data.owners?.map((o) => ({
        email: o.emailAddress ?? '',
        displayName: o.displayName ?? undefined,
      })),
      webViewLink: data.webViewLink ?? undefined,
    };
  }
}
