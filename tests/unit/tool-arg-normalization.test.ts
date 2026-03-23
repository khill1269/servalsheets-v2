import { describe, expect, it } from 'vitest';
import {
  detectLegacyInvocation,
  normalizeRequestHeaders,
  normalizeToolArgs,
  parseForHandler,
} from '../../src/mcp/registration/tool-arg-normalization.js';
import { SheetsCoreInputSchema } from '../../src/schemas/index.js';
import { wrapInputSchemaForLegacyRequest } from '../../src/mcp/registration/schema-helpers.js';

describe('tool arg normalization', () => {
  it('normalizes legacy wrapper shapes and object-based ranges', () => {
    expect(
      normalizeToolArgs({
        action: 'read',
        params: {
          spreadsheetId: 'sheet-123',
          range: { a1: 'Sheet1!A1:B2' },
          ranges: [{ a1: 'Sheet1!A1:A5' }, 'Sheet1!B1:B5'],
          data: [{ range: { a1: 'Sheet1!C1:C2' }, values: [[1], [2]] }],
        },
      })
    ).toEqual({
      request: {
        action: 'read',
        spreadsheetId: 'sheet-123',
        range: 'Sheet1!A1:B2',
        ranges: ['Sheet1!A1:A5', 'Sheet1!B1:B5'],
        data: [{ range: 'Sheet1!C1:C2', values: [[1], [2]] }],
      },
    });
  });

  it('detects legacy invocation patterns', () => {
    expect(
      detectLegacyInvocation({
        action: 'get',
        params: { spreadsheetId: 'sheet-123' },
      })
    ).toContain('Flat { action, params }');

    expect(
      detectLegacyInvocation({
        action: 'get',
        spreadsheetId: 'sheet-123',
      })
    ).toContain('without request envelope');

    expect(
      detectLegacyInvocation({
        request: {
          action: 'get',
          params: { spreadsheetId: 'sheet-123' },
        },
      })
    ).toContain('Nested { request: { action, params');
  });

  it('normalizes iterable request headers', () => {
    const headers = new Headers({
      'x-user-id': 'user-123',
      'x-trace-id': 'trace-abc',
    });

    expect(normalizeRequestHeaders(headers)).toEqual({
      'x-trace-id': 'trace-abc',
      'x-user-id': 'user-123',
    });
  });
});

describe('parseForHandler', () => {
  it('enhances invalid action errors with valid actions', () => {
    const schema = wrapInputSchemaForLegacyRequest(SheetsCoreInputSchema);

    expect(() =>
      parseForHandler(
        schema,
        {
          request: {
            action: 'rename_sheet',
            spreadsheetId: 'sheet-123',
          },
        },
        'SheetsCoreInput',
        'sheets_core'
      )
    ).toThrow(/Valid actions:|update_sheet|title/);
  });
});
