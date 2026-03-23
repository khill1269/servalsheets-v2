import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Handlers, HandlerContext } from '../handlers/index.js';
import type { AuthHandler } from '../handlers/auth.js';
import type { GoogleApiClient } from '../services/google-api.js';
import { STAGED_REGISTRATION } from '../config/constants.js';
import { toolStageManager } from '../mcp/registration/tool-stage-manager.js';
import { createToolHandlerMap, buildToolResponse } from '../mcp/registration/tool-handlers.js';
import { startKeepalive } from '../utils/keepalive.js';

type ServerToolHandler = (args: unknown, extra?: unknown) => Promise<unknown>;
type ServerToolHandlerMap = Record<string, ServerToolHandler>;

export interface DispatchServerToolCallParams {
  toolName: string;
  args: Record<string, unknown>;
  extra?: (Record<string, unknown> & { abortSignal?: AbortSignal }) | undefined;
  rawArgs: Record<string, unknown>;
  rawAction: string | undefined;
  handlers: Handlers;
  authHandler: AuthHandler | null;
  cachedHandlerMap: ServerToolHandlerMap | null;
  context: HandlerContext | null;
  googleClient: GoogleApiClient | null;
  requestId: string;
  costTrackingTenantId: string;
}

export type DispatchServerToolCallResult =
  | { kind: 'result'; result: unknown; handlerMap: ServerToolHandlerMap }
  | { kind: 'error'; response: CallToolResult; handlerMap: ServerToolHandlerMap | null };

export async function dispatchServerToolCall(
  params: DispatchServerToolCallParams
): Promise<DispatchServerToolCallResult> {
  const {
    toolName,
    args,
    extra,
    rawArgs,
    rawAction,
    handlers,
    authHandler,
    context,
    googleClient,
    requestId,
    costTrackingTenantId,
  } = params;

  if (STAGED_REGISTRATION) {
    if (
      toolStageManager.currentStage < 2 &&
      (rawAction === 'set_active' ||
        rawArgs['spreadsheetId'] ||
        (rawArgs['request'] as Record<string, unknown> | undefined)?.['spreadsheetId'])
    ) {
      toolStageManager.advanceToStage(2);
    }
    toolStageManager.ensureToolAvailable(toolName);
  }

  const handlerMap =
    params.cachedHandlerMap ??
    createToolHandlerMap(handlers, authHandler ?? undefined, googleClient ?? undefined);
  const handler = handlerMap[toolName];
  if (!handler) {
    return {
      kind: 'error',
      response: buildToolResponse({
        response: {
          success: false,
          error: {
            code: 'METHOD_NOT_FOUND',
            message: `Handler for ${toolName} not yet implemented`,
            retryable: false,
            suggestedFix: 'This tool is planned for a future release',
            alternatives: [
              {
                tool: 'sheets_data',
                action: 'read',
                description: 'Use sheets_data for basic read/write operations',
              },
            ],
          },
        },
      }),
      handlerMap,
    };
  }

  if (!context) {
    return {
      kind: 'error',
      response: buildToolResponse({
        response: {
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Server context not initialized',
            retryable: false,
          },
        },
      }),
      handlerMap,
    };
  }

  const { createMetadataCache } = await import('../services/metadata-cache.js');
  const metadataCache = googleClient?.sheets ? createMetadataCache(googleClient.sheets) : undefined;

  const perRequestContext: HandlerContext = {
    ...context,
    requestId,
    abortSignal: extra?.abortSignal,
    metadataCache,
  };

  const keepalive = startKeepalive({
    operationName: toolName,
    debug: process.env['DEBUG_KEEPALIVE'] === 'true',
  });

  try {
    const result = await handler(args, { ...extra, context: perRequestContext });
    return { kind: 'result', result, handlerMap };
  } finally {
    keepalive.stop();
    metadataCache?.clear();
    perRequestContext.costTracker?.trackApiCall(costTrackingTenantId, 'sheets');
  }
}
