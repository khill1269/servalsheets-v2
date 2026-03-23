/**
 * DuckDB Engine — wraps DuckDB queries inside a worker_threads Worker.
 *
 * Each query runs in an isolated Worker so that DuckDB's native bindings
 * cannot block the main event loop. The Worker is terminated after the
 * query completes or times out.
 */

import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ServiceError } from '../core/errors.js';
import { ErrorCodes } from '../schemas/shared.js';

// ============================================================================
// Types
// ============================================================================

export interface TableDef {
  name: string;
  range: string;
  hasHeaders: boolean;
  rows: unknown[][];
}

export interface QueryRequest {
  tables: TableDef[];
  sql: string;
  timeoutMs?: number;
  /** Maximum rows to return (safety LIMIT injected if query lacks one). Default: 10,000 */
  maxRows?: number;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  executionMs: number;
}

interface WorkerMessage {
  success: boolean;
  columns?: string[];
  rows?: unknown[][];
  executionMs?: number;
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum rows returned by a single DuckDB query to prevent memory exhaustion. */
const DEFAULT_MAX_ROWS = 10000;

// ============================================================================
// DuckDBEngine
// ============================================================================

export class DuckDBEngine {
  /**
   * Inject a safety LIMIT clause when the query does not already contain one.
   * This prevents unbounded result sets from exhausting Node.js heap memory.
   */
  private ensureLimit(sql: string, maxRows: number): string {
    // Strip trailing whitespace and semicolons for reliable detection
    const trimmed = sql.replace(/[\s;]+$/, '');
    // Check if the query already has a LIMIT clause (case-insensitive)
    // Match LIMIT at word boundary to avoid false positives in column names
    if (/\bLIMIT\s+\d+/i.test(trimmed)) {
      return sql;
    }
    return `${trimmed} LIMIT ${maxRows}`;
  }

  /**
   * Execute a SQL query against in-memory tables populated from spreadsheet data.
   *
   * Each call spawns a fresh Worker and tears it down on completion.
   * The default timeout is 30 seconds.
   * A safety LIMIT is injected if the query lacks one (default: 10,000 rows).
   */
  async query(request: QueryRequest): Promise<QueryResult> {
    return new Promise<QueryResult>((resolve, reject) => {
      // Build the path to the compiled worker JS file.
      // In the compiled dist/, this file lives next to duckdb-engine.js.
      const thisDir = dirname(fileURLToPath(import.meta.url));
      const workerPath = join(thisDir, 'duckdb-worker.js');

      const safeSql = this.ensureLimit(request.sql, request.maxRows ?? DEFAULT_MAX_ROWS);

      const workerData = {
        tables: request.tables.map((t) => ({
          name: t.name,
          rows: t.rows,
        })),
        sql: safeSql,
      };

      const worker = new Worker(workerPath, { workerData });

      const timeoutMs = request.timeoutMs ?? 30000;
      const timer = setTimeout(() => {
        worker.terminate().catch(() => {
          // ignore termination errors
        });
        reject(new Error(`DuckDB query timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      worker.on('message', (msg: WorkerMessage) => {
        clearTimeout(timer);
        if (msg.success) {
          resolve({
            columns: msg.columns!,
            rows: msg.rows!,
            executionMs: msg.executionMs!,
          });
        } else {
          const errorMsg = msg.error ?? 'DuckDB query failed';
          // Classify safety-rejection errors with a typed error so handlers can surface QUERY_REJECTED
          const isSafetyRejection =
            errorMsg.startsWith('Only SELECT statements are allowed') ||
            errorMsg.startsWith('DDL/DML statements are not allowed') ||
            errorMsg.startsWith('File system access functions are not allowed') ||
            errorMsg.startsWith('Invalid table name');
          if (isSafetyRejection) {
            reject(new ServiceError(errorMsg, ErrorCodes.QUERY_REJECTED, 'DuckDBEngine', false));
          } else {
            reject(new Error(errorMsg));
          }
        }
      });

      worker.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      worker.on('exit', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`DuckDB worker exited with code ${code}`));
        }
      });
    });
  }
}
