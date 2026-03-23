/**
 * DuckDB Worker — runs inside a worker_threads Worker.
 *
 * Receives WorkerRequest via workerData, executes the SQL query
 * against in-memory tables, and posts the result back via parentPort.
 *
 * This file is compiled to duckdb-worker.js and loaded dynamically
 * by DuckDBEngine via new Worker(workerPath, { workerData }).
 */

import { workerData, parentPort } from 'worker_threads';

interface WorkerRequest {
  tables: Array<{ name: string; rows: unknown[][] }>;
  sql: string;
}

interface WorkerSuccess {
  success: true;
  columns: string[];
  rows: unknown[][];
  executionMs: number;
}

interface WorkerFailure {
  success: false;
  error: string;
}

function validateDuckDbSql(sql: string): void {
  const normalized = sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .toLowerCase()
    .trim();
  if (!/^select\b/.test(normalized)) {
    throw new Error('Only SELECT statements are allowed in DuckDB queries');
  }
  const blocked = /\b(create|drop|insert|update|delete|alter|truncate|attach|copy|load|install)\b/;
  if (blocked.test(normalized)) {
    throw new Error('DDL/DML statements are not allowed in DuckDB queries');
  }
  if (/read_csv|read_json|read_parquet|glob\s*\(|scan_csv/.test(normalized)) {
    throw new Error('File system access functions are not allowed in DuckDB queries');
  }
}

function validateTableName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) {
    throw new Error(
      `Invalid table name "${name}": must start with a letter or underscore and contain only alphanumeric characters or underscores (max 64 chars)`
    );
  }
}

async function runQuery(): Promise<void> {
  try {
    const { DuckDBInstance } = await import('@duckdb/node-api');
    const instance = await DuckDBInstance.create();
    const conn = await instance.connect();
    const req = workerData as WorkerRequest;

    // Validate user SQL before creating any views
    validateDuckDbSql(req.sql);

    // Register each table as a view using DuckDB's read_json_auto
    for (const table of req.tables) {
      if (table.rows.length === 0) continue;

      // Validate table name against strict allowlist before any SQL interpolation
      validateTableName(table.name);

      const rawHeaders = table.rows[0] as string[];
      // Sanitize column headers: allow only alphanumeric, underscore, space, hyphen
      // to prevent JSON key injection attacks via crafted spreadsheet column names
      const headers = rawHeaders.map((h, i) =>
        typeof h === 'string' && /^[\w\s.-]{1,128}$/.test(h) ? h : `col_${i}`
      );
      const dataRows = table.rows.slice(1);

      // BUG-10 fix: Use CREATE TABLE + INSERT instead of read_json_auto().
      // read_json_auto() treats its argument as a file path, not inline data.
      // Building a proper table with typed columns and inserting values directly
      // avoids file-path interpretation and handles all data types correctly.

      const escapedTableName = table.name.replace(/"/g, '""');

      // Build column definitions — infer types from first data row
      const firstRow = dataRows[0] ?? [];
      const colDefs = headers.map((h, i) => {
        const escapedCol = h.replace(/"/g, '""');
        const sampleVal = firstRow[i];
        let colType = 'VARCHAR';
        if (typeof sampleVal === 'number') {
          colType = Number.isInteger(sampleVal) ? 'BIGINT' : 'DOUBLE';
        } else if (typeof sampleVal === 'boolean') {
          colType = 'BOOLEAN';
        }
        return `"${escapedCol}" ${colType}`;
      });

      await conn.run(`CREATE TABLE "${escapedTableName}" (${colDefs.join(', ')})`);

      // Insert data in batches to avoid oversized SQL strings
      const BATCH_SIZE = 500;
      for (let batchStart = 0; batchStart < dataRows.length; batchStart += BATCH_SIZE) {
        const batch = dataRows.slice(batchStart, batchStart + BATCH_SIZE);
        const valueClauses = batch.map((row) => {
          const vals = headers.map((_, i) => {
            const v = row[i];
            if (v === null || v === undefined) return 'NULL';
            if (typeof v === 'number') return String(v);
            if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
            // Escape single quotes in string values
            return `'${String(v).replace(/'/g, "''")}'`;
          });
          return `(${vals.join(', ')})`;
        });
        await conn.run(`INSERT INTO "${escapedTableName}" VALUES ${valueClauses.join(', ')}`);
      }
    }

    const start = Date.now();
    const reader = await conn.runAndReadAll(req.sql);
    const executionMs = Date.now() - start;

    const columns = reader.columnNames();
    const rows = reader.getRowsJson() as unknown[][];

    const result: WorkerSuccess = {
      success: true,
      columns,
      rows,
      executionMs,
    };

    parentPort?.postMessage(result);
    instance.closeSync();
  } catch (err) {
    const result: WorkerFailure = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
    parentPort?.postMessage(result);
  }
}

runQuery();
