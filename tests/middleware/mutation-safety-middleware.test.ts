import { describe, it, expect } from 'vitest';
import { detectMutationSafetyViolation } from '../../src/middleware/mutation-safety-middleware.js';

describe('mutation-safety-middleware', () => {
  it('detects dangerous formulas in values arrays for mutation actions', () => {
    const violation = detectMutationSafetyViolation({
      request: {
        action: 'write',
        spreadsheetId: 'sheet-1',
        values: [['ok'], ['=IMPORTXML("https://evil.example","//data")']],
      },
    });

    expect(violation).not.toBeNull();
    expect(violation?.path).toContain('request.values');
  });

  it('detects dangerous formulas in find_replace replacement payloads', () => {
    const violation = detectMutationSafetyViolation({
      request: {
        action: 'find_replace',
        spreadsheetId: 'sheet-1',
        find: 'old',
        replacement: '=QUERY(A1:B10, "select A")',
      },
    });

    expect(violation).not.toBeNull();
    expect(violation?.path).toContain('request.replacement');
  });

  it('detects dangerous formulas in nested composite batch operation params', () => {
    const violation = detectMutationSafetyViolation({
      request: {
        action: 'batch_operations',
        spreadsheetId: 'sheet-1',
        operations: [
          {
            tool: 'sheets_data',
            action: 'write',
            params: {
              values: [['=IMPORTRANGE("other", "A1:B2")']],
            },
          },
        ],
      },
    });

    expect(violation).not.toBeNull();
    expect(violation?.path).toContain('operations');
  });

  it('detects dangerous formulas under non-standard keys', () => {
    const violation = detectMutationSafetyViolation({
      request: {
        action: 'write',
        spreadsheetId: 'sheet-1',
        rows: [{ cells: [{ content: '=IMPORTDATA("https://evil.example/data.csv")' }] }],
      },
    });

    expect(violation).not.toBeNull();
    expect(violation?.path).toContain('request.rows');
  });

  it('returns null for non-mutation actions', () => {
    const violation = detectMutationSafetyViolation({
      request: {
        action: 'read',
        spreadsheetId: 'sheet-1',
        values: [['=IMPORTXML("https://example.com","//row")']],
      },
    });

    expect(violation).toBeNull();
  });

  it('respects sanitizeFormulas opt-out at top level', () => {
    const violation = detectMutationSafetyViolation({
      request: {
        action: 'write',
        spreadsheetId: 'sheet-1',
        safety: { sanitizeFormulas: false },
        values: [['=IMPORTHTML("https://example.com","table",1)']],
      },
    });

    expect(violation).toBeNull();
  });

  it('respects sanitizeFormulas opt-out on nested branch', () => {
    const violation = detectMutationSafetyViolation({
      request: {
        action: 'batch_operations',
        spreadsheetId: 'sheet-1',
        operations: [
          {
            tool: 'sheets_data',
            action: 'write',
            params: {
              safety: { sanitizeFormulas: false },
              values: [['=QUERY(A1:B10,"select A")']],
            },
          },
        ],
      },
    });

    expect(violation).toBeNull();
  });
});
