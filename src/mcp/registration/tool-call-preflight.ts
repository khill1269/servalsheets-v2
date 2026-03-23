import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { handlePreInitExemptToolCall } from '../../server/preinit-tool-routing.js';
import type { GoogleApiClient } from '../../services/google-api.js';
import {
  buildAuthErrorResponse,
  checkAuthAsync,
  type AuthGuardResult,
} from '../../utils/auth-guard.js';
import { buildRecordedStaticErrorResponse } from './tool-static-error.js';
import { buildToolResponse } from './tool-response.js';
import type { ToolDefinition } from './tool-definitions.js';
import { isToolCallAuthExempt } from './tool-definitions.js';
import type { ToolHandlerMap } from './tool-handler-map.js';

type ToolHandler = ToolHandlerMap[string];

export interface ToolCallPreflightInput {
  tool: Pick<ToolDefinition, 'name'>;
  args: Record<string, unknown>;
  handlerMap: ToolHandlerMap | null;
  googleClient: GoogleApiClient | null;
  operationId: string;
  timestamp: string;
  startTime: number;
  requestId?: string;
}

export interface ToolCallPreflightDependencies {
  authCheck?: (googleClient: GoogleApiClient | null) => Promise<AuthGuardResult>;
  handlePreInit?: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
}

export type ToolCallPreflightResult =
  | {
      kind: 'handler';
      handler: ToolHandler;
    }
  | {
      kind: 'response';
      response: CallToolResult;
    };

const DEFAULT_UNAUTHENTICATED_ERROR: Parameters<typeof buildAuthErrorResponse>[0] = {
  code: 'NOT_AUTHENTICATED',
  message: 'Authentication required before using this tool.',
  resolution: 'Complete the authentication flow, then retry your request.',
  resolutionSteps: [
    '1. Call sheets_auth with action: "status" to inspect the current auth state',
    '2. If not authenticated, call sheets_auth with action: "login"',
    '3. Complete the OAuth flow and then retry the original request',
  ],
  nextTool: {
    name: 'sheets_auth',
    action: 'status',
  },
};

function extractRawAction(args: Record<string, unknown>): string | undefined {
  const request =
    args['request'] && typeof args['request'] === 'object'
      ? (args['request'] as Record<string, unknown>)
      : undefined;
  const rawAction = request?.['action'] ?? args['action'];
  return typeof rawAction === 'string' ? rawAction : undefined;
}

async function maybeBuildPreInitResponse(
  input: Pick<ToolCallPreflightInput, 'tool' | 'args'>,
  isExempt: boolean,
  handlePreInit: NonNullable<ToolCallPreflightDependencies['handlePreInit']>
): Promise<CallToolResult | null> {
  if (!isExempt) {
    return null;
  }

  const preInitResult = await handlePreInit(input.tool.name, input.args);
  if (!preInitResult || typeof preInitResult !== 'object') {
    return null;
  }

  return buildToolResponse(preInitResult as Record<string, unknown>);
}

export async function resolveToolCallPreflight(
  input: ToolCallPreflightInput,
  dependencies: ToolCallPreflightDependencies = {}
): Promise<ToolCallPreflightResult> {
  const authCheck = dependencies.authCheck ?? checkAuthAsync;
  const handlePreInit = dependencies.handlePreInit ?? handlePreInitExemptToolCall;
  const isExempt = isToolCallAuthExempt(input.tool.name, extractRawAction(input.args));

  if (!isExempt) {
    const authResult = await authCheck(input.googleClient);
    if (!authResult.authenticated) {
      return {
        kind: 'response',
        response: buildToolResponse(
          buildAuthErrorResponse(authResult.error ?? DEFAULT_UNAUTHENTICATED_ERROR)
        ),
      };
    }
  }

  if (!input.handlerMap) {
    const preInitResponse = await maybeBuildPreInitResponse(input, isExempt, handlePreInit);
    if (preInitResponse) {
      return {
        kind: 'response',
        response: preInitResponse,
      };
    }

    return {
      kind: 'response',
      response: buildRecordedStaticErrorResponse({
        toolName: input.tool.name,
        args: input.args,
        operationId: input.operationId,
        timestamp: input.timestamp,
        startTime: input.startTime,
        requestId: input.requestId,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Google API client not initialized. Please provide credentials.',
          retryable: false,
          suggestedFix: 'Set GOOGLE_APPLICATION_CREDENTIALS or configure OAuth',
        },
      }),
    };
  }

  const handler = input.handlerMap[input.tool.name];
  if (!handler) {
    const preInitResponse = await maybeBuildPreInitResponse(input, isExempt, handlePreInit);
    if (preInitResponse) {
      return {
        kind: 'response',
        response: preInitResponse,
      };
    }

    return {
      kind: 'response',
      response: buildRecordedStaticErrorResponse({
        toolName: input.tool.name,
        args: input.args,
        operationId: input.operationId,
        timestamp: input.timestamp,
        startTime: input.startTime,
        requestId: input.requestId,
        error: {
          code: 'NOT_IMPLEMENTED',
          message: `Handler for ${input.tool.name} not yet implemented`,
          retryable: false,
          suggestedFix: 'This tool is planned for a future release',
        },
      }),
    };
  }

  return {
    kind: 'handler',
    handler,
  };
}
