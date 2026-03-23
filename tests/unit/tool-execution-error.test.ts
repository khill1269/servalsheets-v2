import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildToolExecutionErrorPayload } from '../../src/mcp/registration/tool-execution-error.js';

describe('buildToolExecutionErrorPayload', () => {
  it('preserves explicit error codes from thrown runtime errors', () => {
    const error = Object.assign(new Error('Quota exceeded'), {
      code: 'RATE_LIMITED',
    });

    const result = buildToolExecutionErrorPayload(error, 'sheets_data');

    expect(result).toMatchObject({
      errorCode: 'RATE_LIMITED',
      errorMessage: 'Quota exceeded',
      errorPayload: {
        code: 'RATE_LIMITED',
        message: 'Quota exceeded',
        retryable: false,
      },
    });
  });

  it('normalizes zod validation errors into structured MCP-friendly payloads', () => {
    const schema = z.object({
      request: z.object({
        action: z.enum(['read', 'write']),
      }),
    });

    const parsed = schema.safeParse({
      request: {
        action: 'append',
      },
    });

    expect(parsed.success).toBe(false);
    const result = buildToolExecutionErrorPayload(parsed.error, 'sheets_data', {
      request: {
        action: 'write',
      },
    });

    expect(result.errorCode).toBe('INVALID_PARAMS');
    expect(result.errorMessage).toContain('Invalid option');
    expect(result.errorPayload).toMatchObject({
      code: 'INVALID_PARAMS',
      retryable: false,
      category: 'client',
      severity: 'medium',
      resolution: expect.stringContaining('sheets_data'),
      resolutionSteps: expect.any(Array),
      suggestedFix: expect.stringContaining('request.action="write"'),
      expectedParams: expect.objectContaining({
        action: 'write',
        required: expect.arrayContaining(['spreadsheetId', 'values']),
      }),
    });
    expect(String(result.errorPayload['suggestedFix'])).not.toContain('schema://tools/');
  });

  it('maps invalid_union_discriminator validation failures to INVALID_PARAMS', () => {
    const schema = z.object({
      request: z.discriminatedUnion('action', [
        z.object({
          action: z.literal('sort_range'),
          range: z.string(),
        }),
        z.object({
          action: z.literal('set_basic_filter'),
          sheetId: z.number(),
        }),
      ]),
    });

    const parsed = schema.safeParse({
      request: {
        action: 'unknown_action',
      },
    });

    expect(parsed.success).toBe(false);
    const result = buildToolExecutionErrorPayload(parsed.error, 'sheets_dimensions', {
      request: {
        action: 'sort_range',
      },
    });

    expect(result.errorCode).toBe('INVALID_PARAMS');
    expect(result.errorPayload).toMatchObject({
      code: 'INVALID_PARAMS',
      retryable: false,
      category: 'client',
    });
  });
});
