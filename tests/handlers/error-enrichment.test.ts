import { describe, it, expect } from 'vitest';
import { BaseHandler, type HandlerContext, type HandlerError } from '../../src/handlers/base.js';
import type { Intent } from '../../src/core/intent.js';
import type { BatchCompiler } from '../../src/core/batch-compiler.js';
import { ValidationError } from '../../src/core/errors.js';
import { RangeResolutionError } from '../../src/core/range-resolver.js';
import type { RangeResolver } from '../../src/core/range-resolver.js';

class TestHandler extends BaseHandler<unknown, unknown> {
  async handle(): Promise<unknown> {
    throw new Error('not used');
  }

  protected createIntents(): Intent[] {
    return [];
  }

  public mapErrorPublic(err: unknown): HandlerError {
    return this.mapError(err);
  }
}

function createContext(): HandlerContext {
  return {
    batchCompiler: {} as BatchCompiler,
    rangeResolver: {} as RangeResolver,
  };
}

describe('BaseHandler error enrichment', () => {
  it('uses toErrorDetail for ServalSheetsError subclasses', () => {
    const handler = new TestHandler('test', createContext());
    const error = new ValidationError('Invalid range', 'range', 'A1 notation');
    const result = handler.mapErrorPublic(error);

    expect(result.error.code).toBe('VALIDATION_ERROR');
    expect(result.error.resolutionSteps?.length).toBeGreaterThan(0);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('adds resolution steps for range errors', () => {
    const handler = new TestHandler('test', createContext());
    const error = new RangeResolutionError('Sheet "Sheet1" not found', 'SHEET_NOT_FOUND', {
      spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
      sheetName: 'Sheet1',
    });
    const result = handler.mapErrorPublic(error);

    expect(result.error.resolutionSteps?.some((step) => step.includes('list_sheets'))).toBe(true);
  });
});
