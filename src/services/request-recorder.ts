/**
 * Request Recorder Service
 *
 * Records all MCP tool calls for debugging and replay.
 * Stores requests, responses, timing, and metadata in SQLite.
 */

import Database from 'better-sqlite3';
import { resolve } from 'path';
import { existsSync, mkdirSync, chmodSync } from 'fs';
import { logger } from '../utils/logger.js';

/** Keys whose values are replaced with '[REDACTED]' before storage */
const SENSITIVE_KEYS = new Set([
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'password',
  'authorization',
  'authorization_code',
  'code',
  'x-api-key',
  'x-goog-api-key',
  'x-goog-authenticated-user-email',
  'api_key',
  'apikey',
  'secret',
  'token',
  'private_key',
  'encryption_key',
]);

const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(BEARER_PATTERN, 'Bearer [REDACTED]');
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value !== null && typeof value === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      redacted[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redactValue(v);
    }
    return redacted;
  }
  return value;
}

function redactForStorage(json: string): string {
  try {
    return JSON.stringify(redactValue(JSON.parse(json)));
  } catch {
    return json;
  }
}

/**
 * Recorded request entry
 */
export interface RecordedRequest {
  id?: number;
  timestamp: number;
  tool_name: string;
  action: string;
  spreadsheet_id: string | null;
  request_body: string; // JSON serialized
  response_body: string; // JSON serialized
  status_code: number;
  duration_ms: number;
  error_message: string | null;
}

/**
 * Filter options for querying recorded requests
 */
export interface RecordFilter {
  tool_name?: string;
  action?: string;
  spreadsheet_id?: string;
  start_time?: number;
  end_time?: number;
  status_code?: number;
  has_error?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Request Recorder Service
 *
 * Singleton service that records all MCP tool calls to SQLite database
 * for debugging, replay, and analysis.
 */
export class RequestRecorder {
  private db: Database.Database;
  private insertStmt: Database.Statement;
  private enabled: boolean;

  constructor(dbPath?: string) {
    // Opt-in only: recording requires explicit RECORD_REQUESTS=true
    this.enabled = process.env['RECORD_REQUESTS'] === 'true';

    if (!this.enabled) {
      logger.info('Request recording disabled');
      // Create mock database that does nothing
      this.db = null as unknown as Database.Database;
      this.insertStmt = null as unknown as Database.Statement;
      return;
    }

    // Default to .data/requests.db
    const defaultPath = resolve(process.cwd(), '.data', 'requests.db');
    const finalPath = dbPath || defaultPath;

    // Ensure .data directory exists
    const dir = resolve(finalPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Open database with restricted permissions (owner read/write only)
    this.db = new Database(finalPath);
    try {
      chmodSync(finalPath, 0o600);
    } catch {
      /* non-fatal */
    }
    this.db.pragma('journal_mode = WAL'); // Write-Ahead Logging for performance

    // Initialize schema
    this.initSchema();

    // Prepare insert statement for performance
    this.insertStmt = this.db.prepare(`
      INSERT INTO recorded_requests (
        timestamp, tool_name, action, spreadsheet_id,
        request_body, response_body, status_code, duration_ms, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    logger.info('Request recorder initialized', { dbPath: finalPath });
  }

  /**
   * Initialize database schema
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS recorded_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        tool_name TEXT NOT NULL,
        action TEXT NOT NULL,
        spreadsheet_id TEXT,
        request_body TEXT NOT NULL,
        response_body TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_timestamp ON recorded_requests(timestamp);
      CREATE INDEX IF NOT EXISTS idx_tool_action ON recorded_requests(tool_name, action);
      CREATE INDEX IF NOT EXISTS idx_spreadsheet ON recorded_requests(spreadsheet_id);
      CREATE INDEX IF NOT EXISTS idx_status ON recorded_requests(status_code);
    `);
  }

  /**
   * Record a request/response pair
   */
  record(entry: Omit<RecordedRequest, 'id'>): number | null {
    if (!this.enabled) return null;

    try {
      const result = this.insertStmt.run(
        entry.timestamp,
        entry.tool_name,
        entry.action,
        entry.spreadsheet_id,
        redactForStorage(entry.request_body),
        redactForStorage(entry.response_body),
        entry.status_code,
        entry.duration_ms,
        entry.error_message
      );

      return result.lastInsertRowid as number;
    } catch (error) {
      logger.error('Failed to record request', {
        error: error instanceof Error ? error.message : String(error),
        tool: entry.tool_name,
        action: entry.action,
      });
      return null;
    }
  }

  /**
   * Get a recorded request by ID
   */
  getById(id: number): RecordedRequest | null {
    if (!this.enabled) return null;

    try {
      const stmt = this.db.prepare('SELECT * FROM recorded_requests WHERE id = ?');
      return (stmt.get(id) as RecordedRequest | undefined) || null;
    } catch (error) {
      logger.error('Failed to get recorded request', {
        error: error instanceof Error ? error.message : String(error),
        id,
      });
      return null;
    }
  }

  /**
   * Query recorded requests with filters
   */
  query(filter: RecordFilter = {}): RecordedRequest[] {
    if (!this.enabled) return [];

    try {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (filter.tool_name) {
        conditions.push('tool_name = ?');
        params.push(filter.tool_name);
      }

      if (filter.action) {
        conditions.push('action = ?');
        params.push(filter.action);
      }

      if (filter.spreadsheet_id) {
        conditions.push('spreadsheet_id = ?');
        params.push(filter.spreadsheet_id);
      }

      if (filter.start_time) {
        conditions.push('timestamp >= ?');
        params.push(filter.start_time);
      }

      if (filter.end_time) {
        conditions.push('timestamp <= ?');
        params.push(filter.end_time);
      }

      if (filter.status_code) {
        conditions.push('status_code = ?');
        params.push(filter.status_code);
      }

      if (filter.has_error !== undefined) {
        if (filter.has_error) {
          conditions.push('error_message IS NOT NULL');
        } else {
          conditions.push('error_message IS NULL');
        }
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = filter.limit || 100;
      const offset = filter.offset || 0;

      const sql = `
        SELECT * FROM recorded_requests
        ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `;

      const stmt = this.db.prepare(sql);
      return stmt.all(...params, limit, offset) as RecordedRequest[];
    } catch (error) {
      logger.error('Failed to query recorded requests', {
        error: error instanceof Error ? error.message : String(error),
        filter,
      });
      return [];
    }
  }

  /**
   * Get statistics about recorded requests
   */
  getStats(): {
    total: number;
    by_tool: Record<string, number>;
    by_status: Record<number, number>;
    errors: number;
    date_range: { earliest: number; latest: number } | null;
  } {
    if (!this.enabled) {
      return {
        total: 0,
        by_tool: {},
        by_status: {},
        errors: 0,
        date_range: null,
      };
    }

    try {
      // Total count
      const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM recorded_requests');
      const total = (totalStmt.get() as { count: number }).count;

      // By tool
      const byToolStmt = this.db.prepare(`
        SELECT tool_name, COUNT(*) as count
        FROM recorded_requests
        GROUP BY tool_name
      `);
      const byToolRows = byToolStmt.all() as Array<{ tool_name: string; count: number }>;
      const by_tool: Record<string, number> = {};
      byToolRows.forEach((row) => {
        by_tool[row.tool_name] = row.count;
      });

      // By status code
      const byStatusStmt = this.db.prepare(`
        SELECT status_code, COUNT(*) as count
        FROM recorded_requests
        GROUP BY status_code
      `);
      const byStatusRows = byStatusStmt.all() as Array<{ status_code: number; count: number }>;
      const by_status: Record<number, number> = {};
      byStatusRows.forEach((row) => {
        by_status[row.status_code] = row.count;
      });

      // Errors
      const errorsStmt = this.db.prepare(
        'SELECT COUNT(*) as count FROM recorded_requests WHERE error_message IS NOT NULL'
      );
      const errors = (errorsStmt.get() as { count: number }).count;

      // Date range
      const rangeStmt = this.db.prepare(
        'SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest FROM recorded_requests'
      );
      const range = rangeStmt.get() as { earliest: number; latest: number } | undefined;

      return {
        total,
        by_tool,
        by_status,
        errors,
        date_range: range || null,
      };
    } catch (error) {
      logger.error('Failed to get request stats', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        total: 0,
        by_tool: {},
        by_status: {},
        errors: 0,
        date_range: null,
      };
    }
  }

  /**
   * Delete old recorded requests
   */
  cleanup(olderThanMs: number): number {
    if (!this.enabled) return 0;

    try {
      const cutoff = Date.now() - olderThanMs;
      const stmt = this.db.prepare('DELETE FROM recorded_requests WHERE timestamp < ?');
      const result = stmt.run(cutoff);
      return result.changes;
    } catch (error) {
      logger.error('Failed to cleanup old requests', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
    }
  }

  /**
   * Get database path
   */
  getDbPath(): string | null {
    if (!this.enabled || !this.db) return null;
    return this.db.name;
  }
}

/**
 * Global request recorder instance
 */
export let requestRecorder: RequestRecorder;

/**
 * Initialize the global request recorder
 */
export function initRequestRecorder(dbPath?: string): RequestRecorder {
  requestRecorder = new RequestRecorder(dbPath);
  return requestRecorder;
}

/**
 * Get the global request recorder instance
 */
export function getRequestRecorder(): RequestRecorder {
  if (!requestRecorder) {
    requestRecorder = initRequestRecorder();
  }
  return requestRecorder;
}
