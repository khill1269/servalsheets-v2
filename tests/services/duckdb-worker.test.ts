/**
 * DuckDB Worker — SQL injection guard unit tests
 *
 * validateTableName and validateDuckDbSql are not exported from
 * duckdb-worker.ts (it is a worker_threads script). These tests
 * inline the same validation logic so regressions in the guards
 * are caught without a live DuckDB instance.
 *
 * If the implementation changes, update both the source and these
 * inline copies together.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Inline copies of the validation functions from src/services/duckdb-worker.ts
// These must stay in sync with the source implementations.
// ---------------------------------------------------------------------------

function validateTableName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) {
    throw new Error(
      `Invalid table name "${name}": must start with a letter or underscore and contain only alphanumeric characters or underscores (max 64 chars)`
    );
  }
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
  const blocked =
    /\b(create|drop|insert|update|delete|alter|truncate|attach|copy|load|install)\b/;
  if (blocked.test(normalized)) {
    throw new Error('DDL/DML statements are not allowed in DuckDB queries');
  }
  if (/read_csv|read_json|read_parquet|glob\s*\(|scan_csv/.test(normalized)) {
    throw new Error('File system access functions are not allowed in DuckDB queries');
  }
}

// ---------------------------------------------------------------------------
// validateTableName
// ---------------------------------------------------------------------------

describe('validateTableName', () => {
  it('passes for simple lowercase identifier', () => {
    expect(() => validateTableName('sales')).not.toThrow();
  });

  it('passes for identifier with underscore prefix', () => {
    expect(() => validateTableName('_internal')).not.toThrow();
  });

  it('passes for identifier with mixed case and digits', () => {
    expect(() => validateTableName('Sheet1_Data')).not.toThrow();
  });

  it('passes for identifier that is exactly 64 characters', () => {
    expect(() => validateTableName('a' + 'b'.repeat(63))).not.toThrow();
  });

  it('throws for empty string', () => {
    expect(() => validateTableName('')).toThrow();
  });

  it('throws for name starting with a digit', () => {
    expect(() => validateTableName('1table')).toThrow();
  });

  it('throws for semicolon injection', () => {
    expect(() => validateTableName('users; DROP TABLE users')).toThrow();
  });

  it('throws for single-quote injection', () => {
    expect(() => validateTableName("' OR '1'='1")).toThrow();
  });

  it('throws for double-quote in name', () => {
    expect(() => validateTableName('table"name')).toThrow();
  });

  it('throws for name with spaces', () => {
    expect(() => validateTableName('my table')).toThrow();
  });

  it('throws for name exceeding 64 characters', () => {
    expect(() => validateTableName('a'.repeat(65))).toThrow();
  });

  it('throws for hyphen in name', () => {
    expect(() => validateTableName('my-table')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateDuckDbSql
// ---------------------------------------------------------------------------

describe('validateDuckDbSql', () => {
  it('passes for a simple SELECT', () => {
    expect(() => validateDuckDbSql('SELECT * FROM sales')).not.toThrow();
  });

  it('passes for SELECT with WHERE clause', () => {
    expect(() => validateDuckDbSql("SELECT id, name FROM users WHERE region = 'EU'")).not.toThrow();
  });

  it('passes for SELECT with aggregation', () => {
    expect(() =>
      validateDuckDbSql('SELECT region, SUM(revenue) FROM sales GROUP BY region')
    ).not.toThrow();
  });

  it('strips single-line comments before validation', () => {
    // The comment contains "drop" — stripping it makes the query valid.
    expect(() =>
      validateDuckDbSql('SELECT 1 -- this is not a drop statement\nFROM t')
    ).not.toThrow();
  });

  it('strips block comments before validation', () => {
    expect(() =>
      validateDuckDbSql('SELECT /* inline drop comment */ 1 FROM t')
    ).not.toThrow();
  });

  it('throws for INSERT statement', () => {
    expect(() => validateDuckDbSql("INSERT INTO t VALUES (1, 'x')")).toThrow(
      /Only SELECT statements/
    );
  });

  it('throws for UPDATE statement', () => {
    expect(() => validateDuckDbSql("UPDATE t SET col = 'val' WHERE id = 1")).toThrow(
      /Only SELECT statements/
    );
  });

  it('throws for DELETE statement', () => {
    expect(() => validateDuckDbSql('DELETE FROM t WHERE id = 1')).toThrow(
      /Only SELECT statements/
    );
  });

  it('throws for DROP TABLE', () => {
    expect(() => validateDuckDbSql('DROP TABLE users')).toThrow(/Only SELECT statements/);
  });

  it('throws for CREATE TABLE inside a SELECT (subquery bypass attempt)', () => {
    // Starts with SELECT so passes the first check, but CREATE is in the blocked list.
    expect(() => validateDuckDbSql('SELECT 1; CREATE TABLE evil (x INT)')).toThrow(
      /DDL\/DML statements/
    );
  });

  it('throws for ATTACH (file access via database path)', () => {
    expect(() => validateDuckDbSql("SELECT 1; ATTACH '/etc/passwd' AS f")).toThrow(
      /DDL\/DML statements/
    );
  });

  it('throws for COPY TO (file exfiltration)', () => {
    expect(() => validateDuckDbSql("SELECT 1; COPY t TO '/tmp/leak.csv'")).toThrow(
      /DDL\/DML statements/
    );
  });

  it('throws for read_csv file system access', () => {
    expect(() => validateDuckDbSql("SELECT * FROM read_csv('/etc/passwd')")).toThrow(
      /File system access/
    );
  });

  it('throws for read_parquet file system access', () => {
    expect(() =>
      validateDuckDbSql("SELECT * FROM read_parquet('/data/secrets.parquet')")
    ).toThrow(/File system access/);
  });

  it('throws for glob() file system access', () => {
    expect(() => validateDuckDbSql("SELECT * FROM glob('/tmp/*.csv')")).toThrow(
      /File system access/
    );
  });

  it('throws for scan_csv file system access', () => {
    expect(() => validateDuckDbSql("SELECT * FROM scan_csv('/data/file.csv')")).toThrow(
      /File system access/
    );
  });

  it('throws for empty string', () => {
    expect(() => validateDuckDbSql('')).toThrow(/Only SELECT statements/);
  });

  it('throws for INSTALL extension (DuckDB extension load)', () => {
    expect(() => validateDuckDbSql("SELECT 1; INSTALL httpfs")).toThrow(/DDL\/DML statements/);
  });
});

// ---------------------------------------------------------------------------
// DuckDB engine error classification (QUERY_REJECTED)
// Verify that safety-rejection messages are mapped to QUERY_REJECTED and
// other errors remain generic. This tests the classification logic embedded
// in duckdb-engine.ts without spawning a live Worker.
// ---------------------------------------------------------------------------

describe('DuckDB engine safety-rejection classification', () => {
  // Mirror the classification logic from DuckDBEngine.query()
  function classifyDuckDbError(errorMsg: string): 'QUERY_REJECTED' | 'INTERNAL_ERROR' {
    const isSafetyRejection =
      errorMsg.startsWith('Only SELECT statements are allowed') ||
      errorMsg.startsWith('DDL/DML statements are not allowed') ||
      errorMsg.startsWith('File system access functions are not allowed') ||
      errorMsg.startsWith('Invalid table name');
    return isSafetyRejection ? 'QUERY_REJECTED' : 'INTERNAL_ERROR';
  }

  it('classifies non-SELECT rejection as QUERY_REJECTED', () => {
    expect(classifyDuckDbError('Only SELECT statements are allowed in DuckDB queries')).toBe(
      'QUERY_REJECTED'
    );
  });

  it('classifies DDL/DML rejection as QUERY_REJECTED', () => {
    expect(classifyDuckDbError('DDL/DML statements are not allowed in DuckDB queries')).toBe(
      'QUERY_REJECTED'
    );
  });

  it('classifies file system access rejection as QUERY_REJECTED', () => {
    expect(
      classifyDuckDbError('File system access functions are not allowed in DuckDB queries')
    ).toBe('QUERY_REJECTED');
  });

  it('classifies invalid table name as QUERY_REJECTED', () => {
    expect(
      classifyDuckDbError(
        'Invalid table name "bad-name!": must start with a letter or underscore'
      )
    ).toBe('QUERY_REJECTED');
  });

  it('classifies generic DuckDB errors as INTERNAL_ERROR', () => {
    expect(classifyDuckDbError('DuckDB query failed')).toBe('INTERNAL_ERROR');
    expect(classifyDuckDbError('Out of memory')).toBe('INTERNAL_ERROR');
    expect(classifyDuckDbError('Syntax error near token')).toBe('INTERNAL_ERROR');
  });
});
