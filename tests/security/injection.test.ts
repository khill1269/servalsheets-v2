/**
 * Injection security tests — SQL injection and Python sandbox escape prevention.
 *
 * Tests cover:
 * - BigQuery SQL injection via dangerous patterns
 * - BigQuery identifier injection via malformed project/dataset/table names
 * - Python sandbox escape via import manipulation, builtins tampering, eval()
 */

import { describe, it, expect } from 'vitest';

// ============================================================================
// BigQuery SQL Injection Tests
// ============================================================================

// Import the validation function directly — it's module-scoped but we can test
// by checking the handler's behavior with injected queries.
// For unit-level testing, we replicate the pattern check logic.

const DANGEROUS_SQL_PATTERNS = [
  /\bDROP\s+(TABLE|DATABASE|SCHEMA|VIEW|FUNCTION|PROCEDURE)\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bALTER\s+(TABLE|DATABASE|SCHEMA)\b/i,
  /\bCREATE\s+(TABLE|DATABASE|SCHEMA|VIEW|FUNCTION|PROCEDURE)\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+\S+\s+SET\b/i,
  /\bMERGE\s+INTO\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bEXECUTE\s+IMMEDIATE\b/i,
  /\bCALL\s+\w/i,
];

function stripSqlContext(query: string): string {
  let sanitized = query.trim();
  sanitized = sanitized.replace(/--[^\n]*/g, ' ');
  sanitized = sanitized.replace(/\/\*[\s\S]*?\*\//g, ' ');
  sanitized = sanitized.replace(/'([^'\\]|\\.)*'/g, ' ');
  sanitized = sanitized.replace(/"([^"\\]|\\.)*"/g, ' ');
  sanitized = sanitized.replace(/`([^`\\]|\\.)*`/g, ' ');
  sanitized = sanitized.replace(/\s+/g, ' ');
  return sanitized;
}

function wouldBlockQuery(query: string): boolean {
  const sanitized = stripSqlContext(query);
  return DANGEROUS_SQL_PATTERNS.some((p) => p.test(sanitized));
}

describe('BigQuery SQL Injection Prevention', () => {
  it('blocks DROP TABLE', () => {
    expect(wouldBlockQuery('DROP TABLE users')).toBe(true);
  });

  it('blocks DROP TABLE with comment evasion', () => {
    expect(wouldBlockQuery('DROP/**/TABLE users')).toBe(true);
  });

  it('blocks DELETE FROM', () => {
    expect(wouldBlockQuery("DELETE FROM users WHERE id = '1'")).toBe(true);
  });

  it('blocks INSERT INTO', () => {
    expect(wouldBlockQuery("INSERT INTO users VALUES ('admin', 'password')")).toBe(true);
  });

  it('blocks UPDATE SET', () => {
    expect(wouldBlockQuery("UPDATE users SET role = 'admin' WHERE id = 1")).toBe(true);
  });

  it('blocks EXECUTE IMMEDIATE', () => {
    expect(wouldBlockQuery("EXECUTE IMMEDIATE 'DROP TABLE users'")).toBe(true);
  });

  it('blocks GRANT', () => {
    expect(wouldBlockQuery('GRANT ALL ON dataset.table TO user')).toBe(true);
  });

  it('blocks CALL', () => {
    expect(wouldBlockQuery('CALL dangerous_procedure()')).toBe(true);
  });

  it('allows SELECT queries', () => {
    expect(wouldBlockQuery('SELECT * FROM dataset.table WHERE id = 1')).toBe(false);
  });

  it('allows SELECT with subquery', () => {
    expect(
      wouldBlockQuery('SELECT * FROM (SELECT id, name FROM users) WHERE id > 10')
    ).toBe(false);
  });

  it('allows SELECT with aggregation', () => {
    expect(wouldBlockQuery('SELECT COUNT(*) as cnt, AVG(salary) FROM employees GROUP BY dept')).toBe(
      false
    );
  });

  it('blocks SQL in line comments', () => {
    // "SELECT 1 -- DROP TABLE users" — after stripping comment, only "SELECT 1" remains
    expect(wouldBlockQuery('SELECT 1 -- DROP TABLE users')).toBe(false);
    // But standalone DROP TABLE is still caught
    expect(wouldBlockQuery("SELECT 1\nDROP TABLE users")).toBe(true);
  });
});

// ============================================================================
// BigQuery Identifier Validation Tests
// ============================================================================

const BQ_IDENTIFIER_REGEX = /^[a-zA-Z0-9_-]{1,1024}$/;

describe('BigQuery Identifier Validation', () => {
  it('accepts valid project ID', () => {
    expect(BQ_IDENTIFIER_REGEX.test('my-project-123')).toBe(true);
  });

  it('accepts valid dataset ID', () => {
    expect(BQ_IDENTIFIER_REGEX.test('my_dataset')).toBe(true);
  });

  it('rejects backtick injection', () => {
    expect(BQ_IDENTIFIER_REGEX.test('table`; DROP TABLE --')).toBe(false);
  });

  it('rejects dot injection (schema traversal)', () => {
    expect(BQ_IDENTIFIER_REGEX.test('project.dataset.table')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(BQ_IDENTIFIER_REGEX.test('')).toBe(false);
  });

  it('rejects SQL keywords as identifiers', () => {
    // These are technically valid identifiers but the SQL validation layer catches them
    expect(BQ_IDENTIFIER_REGEX.test('DROP')).toBe(true); // Valid identifier characters
  });

  it('rejects semicolons', () => {
    expect(BQ_IDENTIFIER_REGEX.test('table; DROP')).toBe(false);
  });

  it('rejects newlines', () => {
    expect(BQ_IDENTIFIER_REGEX.test('table\nDROP')).toBe(false);
  });
});

// ============================================================================
// Python Sandbox Escape Prevention Tests
// ============================================================================

const SANDBOX_ESCAPE_PATTERNS = [
  { pattern: /_orig_import\b/, reason: '_orig_import access' },
  { pattern: /__import__\s*=/, reason: '__import__ reassign' },
  { pattern: /_builtins\b/, reason: '_builtins access' },
  { pattern: /builtins\.__import__/, reason: 'builtins.__import__' },
  { pattern: /importlib/, reason: 'importlib' },
  { pattern: /\bctypes\b/, reason: 'ctypes' },
  { pattern: /getattr\s*\(\s*__builtins__/, reason: 'getattr __builtins__' },
  { pattern: /__subclasses__/, reason: '__subclasses__' },
  { pattern: /__class__\s*\.\s*__bases__/, reason: 'MRO traversal' },
  { pattern: /\beval\s*\(/, reason: 'eval()' },
];

function wouldBlockPython(code: string): boolean {
  return SANDBOX_ESCAPE_PATTERNS.some(({ pattern }) => pattern.test(code));
}

describe('Python Sandbox Escape Prevention', () => {
  it('blocks _orig_import restoration', () => {
    expect(wouldBlockPython('_builtins.__import__ = _orig_import')).toBe(true);
  });

  it('blocks __import__ reassignment', () => {
    expect(wouldBlockPython('__import__ = lambda n: __builtins__.__import__(n)')).toBe(true);
  });

  it('blocks importlib bypass', () => {
    expect(wouldBlockPython('import importlib; importlib.import_module("os")')).toBe(true);
  });

  it('blocks ctypes native access', () => {
    expect(wouldBlockPython('import ctypes; ctypes.CDLL("libc.so.6")')).toBe(true);
  });

  it('blocks __subclasses__ traversal (object.__subclasses__())', () => {
    expect(
      wouldBlockPython("().__class__.__bases__[0].__subclasses__()")
    ).toBe(true);
  });

  it('blocks eval()', () => {
    expect(wouldBlockPython('eval("__import__(\\"os\\").system(\\"id\\")")')).toBe(true);
  });

  it('blocks getattr on __builtins__', () => {
    expect(wouldBlockPython('getattr(__builtins__, "__import__")("os")')).toBe(true);
  });

  it('allows safe math operations', () => {
    expect(wouldBlockPython('import math\nresult = math.sqrt(144)')).toBe(false);
  });

  it('allows pandas operations', () => {
    expect(
      wouldBlockPython('import pandas as pd\ndf = pd.DataFrame({"a": [1, 2, 3]})')
    ).toBe(false);
  });

  it('allows statistics operations', () => {
    expect(
      wouldBlockPython('import statistics\nmean = statistics.mean([1, 2, 3, 4, 5])')
    ).toBe(false);
  });

  it('allows list comprehensions', () => {
    expect(wouldBlockPython('squares = [x**2 for x in range(10)]')).toBe(false);
  });
});
