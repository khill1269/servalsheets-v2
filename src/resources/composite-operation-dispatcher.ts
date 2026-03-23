import type { sheets_v4, drive_v3 } from 'googleapis';
import type { HandlerContext } from '../handlers/base.js';

interface DispatchResult {
  success: boolean;
  error?: { code: string; message: string; retryable: boolean };
}

interface DispatchInput {
  context: HandlerContext;
  sheetsApi: sheets_v4.Sheets;
  driveApi?: drive_v3.Drive;
  tool: string;
  action: string;
  params: Record<string, unknown>;
}

interface DispatchHandler {
  handle: (input: never) => Promise<{ response: unknown }>;
}

function isDispatchError(
  response: unknown
): response is { error: { code: string; message: string; retryable: boolean } } {
  if (typeof response !== 'object' || response === null || !('error' in response)) {
    return false;
  }

  const error = (response as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const typed = error as { code?: unknown; message?: unknown; retryable?: unknown };
  return (
    typeof typed.code === 'string' &&
    typeof typed.message === 'string' &&
    typeof typed.retryable === 'boolean'
  );
}

async function runHandler(
  handler: DispatchHandler,
  action: string,
  params: Record<string, unknown>
): Promise<DispatchResult> {
  const result = await handler.handle({ request: { action, ...params } } as never);
  if (isDispatchError(result.response)) {
    return { success: false, error: result.response.error };
  }
  return { success: true };
}

/**
 * Resource-layer dispatcher for composite batch operations.
 * Keeps handler-layer architecture clean by centralizing dynamic sub-handler dispatch.
 */
export async function dispatchCompositeOperation(input: DispatchInput): Promise<DispatchResult> {
  const { context, sheetsApi, driveApi, tool, action, params } = input;

  switch (tool) {
    case 'sheets_data': {
      const { SheetsDataHandler } = await import('../handlers/data.js');
      return runHandler(
        new SheetsDataHandler(context, sheetsApi) as unknown as DispatchHandler,
        action,
        params
      );
    }
    case 'sheets_format': {
      const { FormatHandler } = await import('../handlers/format.js');
      return runHandler(
        new FormatHandler(context, sheetsApi) as unknown as DispatchHandler,
        action,
        params
      );
    }
    case 'sheets_dimensions': {
      const { DimensionsHandler } = await import('../handlers/dimensions.js');
      return runHandler(
        new DimensionsHandler(context, sheetsApi) as unknown as DispatchHandler,
        action,
        params
      );
    }
    case 'sheets_core': {
      const { SheetsCoreHandler } = await import('../handlers/core.js');
      return runHandler(
        new SheetsCoreHandler(context, sheetsApi, driveApi) as unknown as DispatchHandler,
        action,
        params
      );
    }
    default:
      return {
        success: false,
        error: {
          code: 'UNSUPPORTED_TOOL',
          message:
            "Tool '" +
            tool +
            "' is not supported in batch_operations. Supported: sheets_data, sheets_format, sheets_dimensions, sheets_core",
          retryable: false,
        },
      };
  }
}
