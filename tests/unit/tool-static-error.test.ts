import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRecordedStaticErrorResponse } from '../../src/mcp/registration/tool-static-error.js';

describe('buildRecordedStaticErrorResponse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records history and returns a structured MCP error response', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2500);
    const historyService = {
      record: vi.fn(),
    };

    const result = buildRecordedStaticErrorResponse(
      {
        toolName: 'sheets_data',
        args: {
          request: {
            action: 'write',
            spreadsheetId: 'sheet-123',
          },
        },
        operationId: 'op-1',
        timestamp: '2026-03-12T00:00:00.000Z',
        startTime: 2000,
        requestId: 'req-1',
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Client not initialized',
          retryable: false,
          suggestedFix: 'Configure OAuth',
        },
      },
      historyService
    );

    expect(historyService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'op-1',
        tool: 'sheets_data',
        action: 'write',
        result: 'error',
        duration: 500,
        errorCode: 'AUTHENTICATION_REQUIRED',
        errorMessage: 'Client not initialized',
        spreadsheetId: 'sheet-123',
      })
    );
    expect((result.structuredContent as any).response.error).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Client not initialized',
      suggestedFix: 'Configure OAuth',
    });
  });
});
