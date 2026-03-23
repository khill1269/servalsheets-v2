/**
 * Serval Core - Interface exports
 */
export type {
  // Core types
  SpreadsheetPlatform,
  RangeRef,
  ValueInputOption,
  ValueRenderOption,
  MajorDimension,
  CellValue,
  ValueRange,

  // Value operation types
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

  // Document/metadata types
  SpreadsheetMetadata,
  SheetMetadata,
  CreateDocumentParams,
  GetDocumentParams,
  AddSheetParams,
  DeleteSheetParams,
  CopySheetParams,
  CopySheetResult,

  // Batch mutation types
  BatchMutationRequest,
  BatchMutationResult,

  // File/Drive types
  FileMetadata,
  ListFilesParams,
  ListFilesResult,
  CopyDocumentParams,
  RevisionMetadata,
  ListRevisionsParams,
  ListRevisionsResult,

  // The main interface
  SpreadsheetBackend,

  // Factory types
  MutationFactory,
  BackendConfig,
  BackendFactory,
} from './backend.js';
