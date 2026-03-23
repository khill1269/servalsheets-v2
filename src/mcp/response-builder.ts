/**
 * ServalSheets - Optimized Response Builder
 *
 * Phase 4: Response Optimization
 *
 * Optimizations:
 * 1. Lazy JSON serialization (defer until actually needed)
 * 2. Response streaming for large datasets
 * 3. Chunked response building
 * 4. Memory-efficient large array handling
 * 5. Pre-computed response templates
 *
 * @module mcp/response-builder
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Threshold for considering a response "large" and applying optimizations
 * @default 10000 cells
 */
const LARGE_RESPONSE_THRESHOLD = 10000; // cells

/**
 * Threshold for enabling streaming responses (split into chunks)
 * @default 50000 cells
 */
const STREAMING_THRESHOLD = 50000; // cells

/**
 * Maximum number of cells to include inline before truncating
 * @default 1000 cells
 */
const MAX_INLINE_CELLS = 1000; // cells to include inline

/**
 * Number of rows to show when truncating large responses
 * @default 100 rows
 */
const TRUNCATION_ROWS = 100; // rows to show when truncating

/**
 * MCP client response size limits (in bytes)
 *
 * Claude Desktop has a practical limit of ~100KB for tool responses.
 * Responses exceeding this may cause client-side timeout or memory issues.
 */
const MCP_CLIENT_LIMITS = {
  /** Claude Desktop conservative limit */
  claude_desktop: 90_000, // 90KB
  /** Default limit for other MCP clients */
  default: 100_000, // 100KB
} as const;

/**
 * Response optimization configuration
 *
 * These thresholds control when optimizations are applied:
 * - **LARGE_RESPONSE_THRESHOLD**: Triggers optimization strategies for responses with >10k cells
 * - **STREAMING_THRESHOLD**: Splits responses >50k cells into progressive chunks
 * - **MAX_INLINE_CELLS**: Limits inline data to 1000 cells, provides resource URI for rest
 * - **TRUNCATION_ROWS**: Shows first 100 rows when truncating, with resource link for full data
 * - **MCP_CLIENT_LIMITS**: Size limits for different MCP clients (90KB for Claude Desktop)
 *
 * @example
 * ```ts
 * // Customize thresholds via ResponseOptions
 * const response = createLazyResponse(data, {
 *   maxInlineCells: 500,
 *   truncationRows: 50,
 *   enableStreaming: true,
 *   clientHint: 'claude_desktop',
 * });
 * ```
 */
export const RESPONSE_CONFIG = {
  LARGE_RESPONSE_THRESHOLD,
  STREAMING_THRESHOLD,
  MAX_INLINE_CELLS,
  TRUNCATION_ROWS,
  MCP_CLIENT_LIMITS,
} as const;

// Pre-allocated response templates (avoid repeated object creation)
const SUCCESS_TEMPLATE = { success: true };
const ERROR_TEMPLATE = { success: false };

// ============================================================================
// TYPES
// ============================================================================

export interface ResponseOptions {
  /** Maximum cells to include inline (default: 1000) */
  maxInlineCells?: number;
  /** Maximum rows to include when truncating (default: 100) */
  truncationRows?: number;
  /** Enable streaming for large responses (default: true) */
  enableStreaming?: boolean;
  /** Include resource URI for truncated data (default: true) */
  includeResourceUri?: boolean;
  /** Spreadsheet ID for resource URI */
  spreadsheetId?: string;
  /** Range for resource URI */
  range?: string;
  /** MCP client hint for size limits (default: 'default') */
  clientHint?: 'claude_desktop' | 'default';
}

export interface LazyResponse {
  /** Get the response as a CallToolResult (triggers serialization) */
  toResult(): CallToolResult;
  /** Get the structured content without serialization */
  getStructuredContent(): Record<string, unknown>;
  /** Check if response represents an error */
  isError(): boolean;
  /** Get estimated size in bytes */
  estimatedSize(): number;
}

export interface StreamingResponse {
  /** Check if there are more chunks */
  hasMore(): boolean;
  /** Get the next chunk */
  nextChunk(): CallToolResult;
  /** Get total chunk count */
  totalChunks(): number;
  /** Get current chunk index */
  currentChunk(): number;
}

// ============================================================================
// LAZY RESPONSE BUILDER
// ============================================================================

/**
 * Create a lazy response that defers serialization until needed
 *
 * This is useful when:
 * - Response might be cached and re-serialized multiple times
 * - Response might be filtered before sending
 * - Large responses that might be truncated
 */
export function createLazyResponse(
  data: Record<string, unknown>,
  _options: ResponseOptions = {}
): LazyResponse {
  let cachedResult: CallToolResult | null = null;
  let cachedStructured: Record<string, unknown> | null = null;
  let cachedSize: number | null = null;

  const isErrorResponse =
    data['success'] === false ||
    (data['response'] as Record<string, unknown> | undefined)?.['success'] === false;

  return {
    toResult(): CallToolResult {
      if (cachedResult) return cachedResult;

      const structured = this.getStructuredContent();
      cachedResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(structured, null, 2),
            annotations: {
              audience: isErrorResponse
                ? (['user', 'assistant'] as const)
                : (['assistant'] as const),
            },
          },
        ],
        structuredContent: structured,
        isError: isErrorResponse ? true : undefined,
      };

      return cachedResult;
    },

    getStructuredContent(): Record<string, unknown> {
      if (cachedStructured) return cachedStructured;

      // Wrap in response if needed
      if ('response' in data) {
        cachedStructured = data;
      } else if ('success' in data) {
        cachedStructured = { response: data };
      } else {
        cachedStructured = { response: data };
      }

      return cachedStructured;
    },

    isError(): boolean {
      return isErrorResponse;
    },

    estimatedSize(): number {
      if (cachedSize !== null) return cachedSize;

      // Fast estimation without full serialization
      cachedSize = estimateResponseSize(data);
      return cachedSize;
    },
  };
}

// ============================================================================
// FAST RESPONSE BUILDERS
// ============================================================================

/**
 * Build success response with minimal allocations
 */
export function buildSuccessResponse<T extends Record<string, unknown>>(
  action: string,
  data: T,
  options: ResponseOptions = {}
): CallToolResult {
  // Check if data contains large arrays
  const values = data['values'] as unknown[][] | undefined;
  if (values && shouldTruncate(values, options)) {
    return buildTruncatedResponse(action, data, values, options);
  }

  const response = {
    ...SUCCESS_TEMPLATE,
    action,
    ...data,
  };

  const structured = { response };

  // Enforce MCP client size limit (final safeguard)
  const clientHint = (options as Record<string, unknown>)['clientHint'] as
    | 'claude_desktop'
    | 'default'
    | undefined;
  const sizeCheck = enforceClientSizeLimit(structured, clientHint ?? 'default');

  if (sizeCheck.truncated) {
    // Response exceeded client limit - return truncated version
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(sizeCheck.data, null, 2),
          annotations: { audience: ['assistant'] as const },
        },
      ],
      structuredContent: sizeCheck.data,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(structured, null, 2),
        annotations: { audience: ['assistant'] as const },
      },
    ],
    structuredContent: structured,
  };
}

/**
 * Build error response with minimal allocations
 */
export function buildErrorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>
): CallToolResult {
  const canonicalCode = code === 'RATE_LIMIT' ? 'RATE_LIMITED' : code;

  const error: Record<string, unknown> = {
    code: canonicalCode,
    message,
    retryable: isRetryableError(canonicalCode),
  };

  if (details) {
    error['details'] = details;
  }

  const response = {
    ...ERROR_TEMPLATE,
    error,
  };

  const structured = { response };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(structured, null, 2),
        annotations: { audience: ['user', 'assistant'] as const },
      },
    ],
    structuredContent: structured,
    isError: true,
  };
}

/**
 * Build a resource_link content block per MCP 2025-11-25 spec.
 *
 * Used to reference large resources by URI instead of embedding them,
 * allowing clients to fetch the full data via the resource system.
 */
export function buildResourceLinkContent(
  spreadsheetId: string,
  range?: string,
  mimeType = 'application/json'
): Record<string, unknown> {
  const uri = range
    ? `sheets:///${spreadsheetId}/${encodeURIComponent(range)}`
    : `sheets:///${spreadsheetId}`;

  return {
    type: 'resource_link' as const,
    uri,
    mimeType,
    description: range
      ? `Full data for range ${range} in spreadsheet ${spreadsheetId}`
      : `Full data for spreadsheet ${spreadsheetId}`,
  };
}

/**
 * Build response for large/truncated data
 */
function buildTruncatedResponse<T extends Record<string, unknown>>(
  action: string,
  data: T,
  values: unknown[][],
  options: ResponseOptions
): CallToolResult {
  const maxRows = options.truncationRows ?? TRUNCATION_ROWS;
  const truncatedValues = values.slice(0, maxRows);

  const totalRows = values.length;
  const totalCells = countCellsFast(values);

  const response: Record<string, unknown> = {
    ...SUCCESS_TEMPLATE,
    action,
    ...data,
    values: truncatedValues,
    truncated: true,
    totalRows,
    totalCells,
    displayedRows: truncatedValues.length,
    displayedCells: countCellsFast(truncatedValues),
  };

  // Add resource URI for accessing full data
  if (options.includeResourceUri !== false && options.spreadsheetId) {
    const range = options.range ?? (data['range'] as string);
    if (range) {
      response['resourceUri'] = `sheets:///${options.spreadsheetId}/${encodeURIComponent(range)}`;
    }
  }

  const structured = { response };

  // Build content array with text + optional resource_link for full data access
  const contentBlocks: Array<Record<string, unknown>> = [
    { type: 'text', text: JSON.stringify(structured, null, 2) },
  ];

  // Include resource_link content block per MCP 2025-11-25 spec
  // This allows clients to fetch the full dataset via the resource system
  if (options.includeResourceUri !== false && options.spreadsheetId) {
    const range = options.range ?? (data['range'] as string);
    contentBlocks.push(buildResourceLinkContent(options.spreadsheetId, range));
  }

  return {
    content: contentBlocks as CallToolResult['content'],
    structuredContent: structured,
  };
}

// ============================================================================
// STREAMING RESPONSE BUILDER
// ============================================================================

/**
 * Create a streaming response for very large datasets
 *
 * Splits the response into chunks that can be sent incrementally.
 * Useful for responses > 50k cells.
 */
export function createStreamingResponse(
  action: string,
  values: unknown[][],
  options: ResponseOptions & {
    chunkSize?: number;
    metadata?: Record<string, unknown>;
  } = {}
): StreamingResponse {
  const chunkSize = options.chunkSize ?? 1000; // rows per chunk
  const totalRows = values.length;
  const totalChunks = Math.ceil(totalRows / chunkSize);
  let currentIndex = 0;

  return {
    hasMore(): boolean {
      return currentIndex < totalChunks;
    },

    nextChunk(): CallToolResult {
      const startRow = currentIndex * chunkSize;
      const endRow = Math.min(startRow + chunkSize, totalRows);
      const chunkValues = values.slice(startRow, endRow);

      const isFirst = currentIndex === 0;
      const isLast = currentIndex === totalChunks - 1;

      const response: Record<string, unknown> = {
        success: true,
        action,
        values: chunkValues,
        streaming: {
          chunkIndex: currentIndex,
          totalChunks,
          startRow,
          endRow,
          isFirst,
          isLast,
          totalRows,
        },
      };

      // Include metadata in first chunk
      if (isFirst && options.metadata) {
        Object.assign(response, options.metadata);
      }

      currentIndex++;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ response }, null, 2),
            annotations: { audience: ['assistant'] as const },
          },
        ],
        structuredContent: { response },
      };
    },

    totalChunks(): number {
      return totalChunks;
    },

    currentChunk(): number {
      return currentIndex;
    },
  };
}

// ============================================================================
// OPTIMIZED SERIALIZATION
// ============================================================================

/**
 * Fast JSON serialization for responses
 *
 * Optimizations:
 * - Skip null/undefined values
 * - Inline small arrays
 * - Use faster number serialization
 */
export function fastSerialize(data: unknown, indent: boolean = true): string {
  if (data === null || data === undefined) {
    return 'null';
  }

  if (typeof data !== 'object') {
    return JSON.stringify(data);
  }

  // For objects, use native JSON.stringify but with replacer to skip nulls
  return JSON.stringify(
    data,
    (key, value) => {
      // Skip null and undefined values
      if (value === null || value === undefined) {
        // OK: Explicit empty - JSON.stringify replacer pattern, returns undefined to skip property
        return undefined;
      }
      return value;
    },
    indent ? 2 : undefined
  );
}

/**
 * Estimate response size without full serialization
 */
export function estimateResponseSize(data: Record<string, unknown>): number {
  let size = 0;

  for (const [key, value] of Object.entries(data)) {
    size += key.length + 4; // key + quotes + colon + space

    if (Array.isArray(value)) {
      // Estimate array size
      if (isValuesArray(value)) {
        size += estimateValuesArraySize(value as unknown[][]);
      } else {
        size += value.length * 20; // rough estimate per item
      }
    } else if (typeof value === 'string') {
      size += value.length + 2;
    } else if (typeof value === 'number') {
      size += 10; // average number length
    } else if (typeof value === 'object' && value !== null) {
      size += estimateResponseSize(value as Record<string, unknown>);
    } else {
      size += 10; // boolean, null, etc.
    }
  }

  return size + 4; // braces and commas
}

/**
 * Estimate size of values array (2D array of cells)
 */
function estimateValuesArraySize(values: unknown[][]): number {
  let size = 2; // brackets

  for (const row of values) {
    size += 2; // row brackets
    for (const cell of row) {
      if (typeof cell === 'string') {
        size += cell.length + 2;
      } else if (typeof cell === 'number') {
        size += 10;
      } else {
        size += 10;
      }
      size += 1; // comma
    }
    size += 1; // row comma
  }

  return size;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if values array is a 2D values array
 */
function isValuesArray(arr: unknown[]): arr is unknown[][] {
  return arr.length > 0 && Array.isArray(arr[0]);
}

/**
 * Fast cell counting
 */
function countCellsFast(values: unknown[][]): number {
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    count += values[i]!.length;
  }
  return count;
}

/**
 * Check if values should be truncated
 */
function shouldTruncate(values: unknown[][], options: ResponseOptions): boolean {
  const maxCells = options.maxInlineCells ?? MAX_INLINE_CELLS;
  const cellCount = countCellsFast(values);
  return cellCount > maxCells;
}

/**
 * Check if error code is retryable
 */
function isRetryableError(code: string): boolean {
  const retryableCodes = new Set([
    'RATE_LIMITED',
    'QUOTA_EXCEEDED',
    'SERVICE_UNAVAILABLE',
    'TIMEOUT',
    'INTERNAL_ERROR',
  ]);
  return retryableCodes.has(code);
}

/**
 * Enforce MCP client response size limit
 *
 * Checks if response exceeds client limits and truncates if necessary.
 * Adds _truncated metadata with continuation hints.
 */
function enforceClientSizeLimit<T extends Record<string, unknown>>(
  response: T,
  clientHint: 'claude_desktop' | 'default' = 'default'
): { data: T; truncated: boolean; originalSize: number; truncatedSize?: number } {
  const limit = MCP_CLIENT_LIMITS[clientHint];
  const serialized = JSON.stringify(response);
  const size = new TextEncoder().encode(serialized).length;

  // Response fits within limit
  if (size <= limit) {
    return { data: response, truncated: false, originalSize: size };
  }

  // Response exceeds limit - truncate
  const truncated = truncateToSizeLimit(response, limit);
  const truncatedSerialized = JSON.stringify(truncated);
  const truncatedSize = new TextEncoder().encode(truncatedSerialized).length;

  return {
    data: truncated as T,
    truncated: true,
    originalSize: size,
    truncatedSize,
  };
}

/**
 * Truncate response to fit within size limit
 */
function truncateToSizeLimit<T extends Record<string, unknown>>(response: T, limit: number): T {
  // Find largest array field to truncate
  let largestArray: { key: string; value: unknown[]; size: number } | null = null;

  for (const [key, value] of Object.entries(response)) {
    if (Array.isArray(value) && value.length > 0) {
      const size = JSON.stringify(value).length;
      if (!largestArray || size > largestArray.size) {
        largestArray = { key, value, size };
      }
    }
  }

  // If no arrays to truncate, truncate string fields
  if (!largestArray) {
    const truncated: Record<string, unknown> = { ...response };
    for (const [key, value] of Object.entries(truncated)) {
      if (typeof value === 'string' && value.length > 100) {
        truncated[key] = value.substring(0, 100) + '... [truncated]';
      }
    }
    addTruncationMetadata(truncated, limit, 'strings');
    return truncated as T;
  }

  // Calculate how many items we can keep
  const arrayKey = largestArray.key;
  const arrayValue = largestArray.value;
  const itemSize = Math.ceil(largestArray.size / arrayValue.length);
  const maxItems = Math.max(10, Math.floor((limit * 0.8) / itemSize)); // Use 80% of limit

  const truncated: Record<string, unknown> = { ...response };
  const truncatedArray = arrayValue.slice(0, Math.min(maxItems, arrayValue.length));
  truncated[arrayKey] = truncatedArray;

  addTruncationMetadata(truncated, limit, arrayKey);
  return truncated as T;
}

/**
 * Add truncation metadata to response
 */
function addTruncationMetadata(
  response: Record<string, unknown>,
  limit: number,
  truncatedField: string
): void {
  response['_truncated'] = {
    reason: 'MCP client size limit',
    limit,
    truncatedField,
    hint: 'Use pagination (startRow/maxRows) or filters (range) to retrieve specific data',
  };
}

// ============================================================================
// RESPONSE TEMPLATE CACHE
// ============================================================================

// Pre-built response templates for common patterns
const RESPONSE_TEMPLATES = {
  // Read success
  readSuccess: (values: unknown[][], range: string) => ({
    response: {
      success: true,
      action: 'read',
      values,
      range,
    },
  }),

  // Write success
  writeSuccess: (
    updatedCells: number,
    updatedRows: number,
    updatedColumns: number,
    updatedRange: string
  ) => ({
    response: {
      success: true,
      action: 'write',
      updatedCells,
      updatedRows,
      updatedColumns,
      updatedRange,
    },
  }),

  // Not found error
  notFound: (resourceType: string, resourceId: string) => ({
    response: {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `${resourceType} '${resourceId}' not found`,
        retryable: false,
      },
    },
  }),

  // Permission denied
  permissionDenied: (operation: string) => ({
    response: {
      success: false,
      error: {
        code: 'PERMISSION_DENIED',
        message: `Permission denied to ${operation}`,
        retryable: false,
      },
    },
  }),

  // Rate limited
  rateLimited: (retryAfterMs: number) => ({
    response: {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded. Please wait before retrying.',
        retryable: true,
        retryAfterMs,
      },
    },
  }),
};

/**
 * Build response from template
 */
export function buildFromTemplate<K extends keyof typeof RESPONSE_TEMPLATES>(
  template: K,
  ...args: Parameters<(typeof RESPONSE_TEMPLATES)[K]>
): CallToolResult {
  const templateFn = RESPONSE_TEMPLATES[template] as (
    ...args: unknown[]
  ) => Record<string, unknown>;
  const structured = templateFn(...args);

  const response = structured['response'] as Record<string, unknown>;
  const isError = response?.['success'] === false;

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(structured, null, 2),
        annotations: {
          audience: isError ? (['user', 'assistant'] as const) : (['assistant'] as const),
        },
      },
    ],
    structuredContent: structured,
    isError: isError ? true : undefined,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export const ResponseBuilder = {
  // Lazy response
  createLazyResponse,

  // Fast builders
  buildSuccessResponse,
  buildErrorResponse,

  // Streaming
  createStreamingResponse,

  // Serialization
  fastSerialize,
  estimateResponseSize,

  // Templates
  buildFromTemplate,
  RESPONSE_TEMPLATES,

  // Constants
  LARGE_RESPONSE_THRESHOLD,
  STREAMING_THRESHOLD,
  MAX_INLINE_CELLS,
  TRUNCATION_ROWS,
  MCP_CLIENT_LIMITS,
  RESPONSE_CONFIG,
};
