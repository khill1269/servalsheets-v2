/**
 * Serval Core - Operation History Types
 *
 * Types for tracking operation history for debugging, undo, and audit.
 * Platform-agnostic: uses `documentId` instead of platform-specific identifiers.
 */

export interface OperationHistory {
  /** Unique operation ID */
  id: string;
  /** Timestamp when operation started */
  timestamp: string;
  /** Tool name (e.g., 'sheets_data', 'excel_data') */
  tool: string;
  /** Action name (e.g., 'write', 'read') */
  action: string;
  /** Operation parameters */
  params: Record<string, unknown>;
  /** Operation result status */
  result: 'success' | 'error';
  /** Duration in milliseconds */
  duration: number;
  /** Number of cells affected (if applicable) */
  cellsAffected?: number;
  /** Number of rows affected (if applicable) */
  rowsAffected?: number;
  /** Snapshot ID for undo (if created) */
  snapshotId?: string;
  /** Error message if failed */
  errorMessage?: string;
  /** Error code if failed */
  errorCode?: string;
  /** User/session ID (if available) */
  userId?: string;
  /** Request ID for tracing */
  requestId?: string;
  /** Platform-specific document identifier (spreadsheetId, workbookId, etc.) */
  documentId?: string;
  /** Sheet/tab identifier (if applicable) */
  sheetId?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface OperationHistoryStats {
  /** Total operations recorded */
  totalOperations: number;
  /** Successful operations */
  successfulOperations: number;
  /** Failed operations */
  failedOperations: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Average operation duration (ms) */
  averageDuration: number;
  /** Total cells affected across all operations */
  totalCellsAffected: number;
  /** Most common tool */
  mostCommonTool?: string;
  /** Most common action */
  mostCommonAction?: string;
  /** Oldest operation timestamp */
  oldestOperation?: string;
  /** Newest operation timestamp */
  newestOperation?: string;
}

export interface OperationHistoryFilter {
  /** Filter by tool name */
  tool?: string;
  /** Filter by action */
  action?: string;
  /** Filter by result */
  result?: 'success' | 'error';
  /** Filter by document ID */
  documentId?: string;
  /** Filter by time range (start) */
  startTime?: string;
  /** Filter by time range (end) */
  endTime?: string;
  /** Limit number of results */
  limit?: number;
}
