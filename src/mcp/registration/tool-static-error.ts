import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getHistoryService } from '../../services/history-service.js';
import { extractAction, extractSpreadsheetId } from './extraction-helpers.js';
import { buildToolResponse } from './tool-response.js';

type ErrorPayload = {
  code: string;
  message: string;
  retryable: boolean;
  suggestedFix?: string;
  resolution?: string;
  resolutionSteps?: string[];
  nextTool?: {
    name: string;
    action: string;
  };
};

export interface RecordedStaticErrorInput {
  toolName: string;
  args: Record<string, unknown>;
  operationId: string;
  timestamp: string;
  startTime: number;
  requestId?: string;
  error: ErrorPayload;
}

export function buildRecordedStaticErrorResponse(
  input: RecordedStaticErrorInput,
  historyService: Pick<ReturnType<typeof getHistoryService>, 'record'> = getHistoryService()
): CallToolResult {
  historyService.record({
    id: input.operationId,
    timestamp: input.timestamp,
    tool: input.toolName,
    action: extractAction(input.args),
    params: input.args,
    result: 'error',
    duration: Date.now() - input.startTime,
    errorMessage: input.error.message,
    errorCode: input.error.code,
    requestId: input.requestId,
    spreadsheetId: extractSpreadsheetId(input.args),
  });

  return buildToolResponse({
    response: {
      success: false,
      error: input.error,
    },
  });
}
