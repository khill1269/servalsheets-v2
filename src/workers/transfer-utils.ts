/**
 * ServalSheets - Worker Thread Transfer Utilities
 *
 * Zero-copy ArrayBuffer transfer utilities for efficient worker_threads
 * postMessage() communication. Converts 2D arrays into typed ArrayBuffers
 * with string pooling for minimal memory footprint.
 *
 * @module workers/transfer-utils
 */

/**
 * Metadata describing the structure of a transferred buffer.
 * Used to reconstruct the original 2D array after transfer.
 */
export interface TransferMetadata {
  /** Number of rows in the 2D array */
  rowCount: number;
  /** Number of columns per row */
  columnCount: number;
  /** Type per column: 'string' | 'number' | 'boolean' | 'null' | 'mixed' */
  columnTypes: Array<'string' | 'number' | 'boolean' | 'null' | 'mixed'>;
  /** Byte offset where string table begins */
  stringTableOffset: number;
  /** Total byte length of the buffer */
  bufferLength: number;
  /** Array of string values referenced by indices */
  stringTable: string[];
}

/**
 * Column type information for optimized storage.
 */
interface ColumnInfo {
  type: 'string' | 'number' | 'boolean' | 'null' | 'mixed';
  values: Array<string | number | boolean | null | undefined>;
}

/** Threshold (bytes) above which ArrayBuffer transfer is preferred over cloning */
const TRANSFER_SIZE_THRESHOLD = 1 * 1024 * 1024; // 1MB

/**
 * Analyzes a 2D array and returns true if it should use ArrayBuffer transfer.
 * Estimates serialization size and compares against threshold.
 *
 * @param data - The 2D array to evaluate
 * @returns true if estimated size exceeds threshold, false otherwise
 */
export function shouldUseTransfer(data: unknown[][]): boolean {
  let estimatedBytes = 0;

  for (const row of data) {
    for (const cell of row) {
      if (typeof cell === 'string') {
        // String: rough estimate (2 bytes per char + overhead)
        estimatedBytes += cell.length * 2 + 8;
      } else if (typeof cell === 'number' || typeof cell === 'boolean') {
        estimatedBytes += 8;
      } else if (cell === null || cell === undefined) {
        estimatedBytes += 1;
      } else {
        // Object/Array: conservative estimate
        estimatedBytes += JSON.stringify(cell).length * 2 + 16;
      }
    }
  }

  return estimatedBytes > TRANSFER_SIZE_THRESHOLD;
}

/**
 * Converts a 2D array into an ArrayBuffer with metadata for zero-copy transfer.
 * String values are pooled into a deduplicated string table to minimize size.
 *
 * @param data - The 2D array of cell values to serialize
 * @returns Object containing ArrayBuffer and metadata for reconstruction
 * @throws Error if data contains unsupported types
 */
export function serializeForTransfer(
  data: unknown[][]
): { buffer: ArrayBuffer; metadata: TransferMetadata } {
  if (data.length === 0) {
    return {
      buffer: new ArrayBuffer(0),
      metadata: {
        rowCount: 0,
        columnCount: 0,
        columnTypes: [],
        stringTableOffset: 0,
        bufferLength: 0,
        stringTable: [],
      },
    };
  }

  // Build string table (deduplicate strings)
  const stringTable = new Map<string, number>();
  const stringList: string[] = [];

  const addString = (str: string): number => {
    if (!stringTable.has(str)) {
      stringTable.set(str, stringList.length);
      stringList.push(str);
    }
    return stringTable.get(str)!;
  };

  // Analyze columns to determine types
  const rowCount = data.length;
  const columnCount = data[0]?.length ?? 0;
  const columnInfos: ColumnInfo[] = Array.from({ length: columnCount }, () => ({
    type: 'null' as const,
    values: [],
  }));

  // First pass: collect values and build string table
  for (const row of data) {
    for (let colIdx = 0; colIdx < columnCount; colIdx++) {
      const cell = row[colIdx];
      const ci = columnInfos[colIdx];
      if (!ci) continue;

      if (typeof cell === 'string') {
        addString(cell);
        ci.values.push(cell);
        if (ci.type === 'null') ci.type = 'string';
        else if (ci.type !== 'string') ci.type = 'mixed';
      } else if (typeof cell === 'number') {
        ci.values.push(cell);
        if (ci.type === 'null') ci.type = 'number';
        else if (ci.type !== 'number') ci.type = 'mixed';
      } else if (typeof cell === 'boolean') {
        ci.values.push(cell);
        if (ci.type === 'null') ci.type = 'boolean';
        else if (ci.type !== 'boolean') ci.type = 'mixed';
      } else if (cell === null || cell === undefined) {
        ci.values.push(null);
      } else {
        throw new Error(`Unsupported cell type: ${typeof cell}`);
      }
    }
  }

  // Encode string table
  const encoder = new TextEncoder();
  const stringTableBytes: Uint8Array[] = [];
  const stringOffsets: number[] = [];

  let tableOffset = 0;
  for (const str of stringList) {
    stringOffsets.push(tableOffset);
    const encoded = encoder.encode(str);
    stringTableBytes.push(encoded);
    tableOffset += encoded.byteLength + 4; // 4 bytes for length prefix
  }

  // Allocate buffer: header (8 bytes) + cell data (variable) + string table
  const cellDataSize = rowCount * columnCount * 12; // 4 bytes index/number + 4 bytes type + 4 bytes padding
  const stringTableSize = tableOffset;
  const headerSize = 8;
  const bufferLength = headerSize + cellDataSize + stringTableSize;

  const buffer = new ArrayBuffer(bufferLength);
  const view = new DataView(buffer);
  let offset = 0;

  // Write header: rowCount (4 bytes) + columnCount (4 bytes)
  view.setUint32(offset, rowCount, true);
  offset += 4;
  view.setUint32(offset, columnCount, true);
  offset += 4;

  // Write cell data: encode values as indices or direct values
  for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
    const row = data[rowIdx];
    for (let colIdx = 0; colIdx < columnCount; colIdx++) {
      const cell = row?.[colIdx];

      view.setUint32(offset, colIdx, true); // Column index
      offset += 4;

      if (typeof cell === 'string') {
        view.setUint32(offset, 1, true); // Type: string (1)
        offset += 4;
        view.setUint32(offset, stringTable.get(cell)!, true); // String index
      } else if (typeof cell === 'number') {
        view.setUint32(offset, 2, true); // Type: number (2)
        offset += 4;
        view.setFloat64(offset, cell, true);
        offset += 4; // Padding for alignment
      } else if (typeof cell === 'boolean') {
        view.setUint32(offset, 3, true); // Type: boolean (3)
        offset += 4;
        view.setUint32(offset, cell ? 1 : 0, true);
      } else {
        view.setUint32(offset, 0, true); // Type: null (0)
        offset += 4;
        view.setUint32(offset, 0, true);
      }
      offset += 4;
    }
  }

  // Write string table
  const stringTableOffset = offset;
  for (let i = 0; i < stringList.length; i++) {
    const encoded = stringTableBytes[i]!;
    const strView = new Uint8Array(buffer, offset);
    view.setUint32(offset, encoded.byteLength, true);
    offset += 4;
    strView.set(encoded, 4);
    offset += encoded.byteLength;
  }

  const metadata: TransferMetadata = {
    rowCount,
    columnCount,
    columnTypes: columnInfos.map((c) => c.type),
    stringTableOffset,
    bufferLength,
    stringTable: stringList,
  };

  return { buffer, metadata };
}

/**
 * Reconstructs a 2D array from a transferred ArrayBuffer and metadata.
 * Reverses the serialization process to restore original cell values.
 *
 * @param buffer - The ArrayBuffer containing serialized data
 * @param metadata - Metadata describing the buffer structure
 * @returns The reconstructed 2D array of cell values
 */
export function deserializeFromTransfer(
  buffer: ArrayBuffer,
  metadata: TransferMetadata
): unknown[][] {
  if (metadata.rowCount === 0 || metadata.columnCount === 0) {
    return [];
  }

  const view = new DataView(buffer);
  let offset = 8; // Skip header (already in metadata)

  const result: unknown[][] = [];

  for (let rowIdx = 0; rowIdx < metadata.rowCount; rowIdx++) {
    const row: unknown[] = [];

    for (let colIdx = 0; colIdx < metadata.columnCount; colIdx++) {
      // Skip stored column index (used for validation in debug builds)
      view.getUint32(offset, true);
      offset += 4;

      const typeCode = view.getUint32(offset, true);
      offset += 4;

      let value: unknown;

      if (typeCode === 0) {
        // Null
        value = null;
        offset += 4; // Skip padding
      } else if (typeCode === 1) {
        // String
        const stringIdx = view.getUint32(offset, true);
        value = metadata.stringTable[stringIdx] ?? null;
        offset += 4;
      } else if (typeCode === 2) {
        // Number
        value = view.getFloat64(offset, true);
        offset += 8;
      } else if (typeCode === 3) {
        // Boolean
        value = view.getUint32(offset, true) !== 0;
        offset += 4;
      } else {
        value = null;
        offset += 4;
      }

      row.push(value);
    }

    result.push(row);
  }

  return result;
}
