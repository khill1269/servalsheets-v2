import type { ToolTaskHandler } from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type {
  CallToolResult,
  RequestInfo,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import { AuthHandler } from '../../handlers/auth.js';
import { ConfirmHandler } from '../../handlers/confirm.js';
import { SessionHandler } from '../../handlers/session.js';
import {
  handleGenerateTemplateAction,
  handlePreviewGenerationAction,
} from '../../handlers/composite-actions/generation.js';
import { getEnv } from '../../config/env.js';
import { resourceNotifications } from '../../resources/notifications.js';
import { SheetsAuthInputSchema } from '../../schemas/index.js';
import type { RelatedRequestSender, TaskStatusUpdater } from '../../utils/request-context.js';
import { createTaskAwareSamplingServer } from '../sampling.js';
import { TOOL_EXECUTION_CONFIG, TOOL_ICONS } from '../features-2025-11-25.js';
import { replaceAvailableToolNames } from '../tool-registry-state.js';
import type { ToolDefinition } from './tool-definitions.js';
import { ACTIVE_TOOL_DEFINITIONS } from './tool-definitions.js';
import { parseForHandler } from './tool-arg-normalization.js';
import { assertValidMcpToolNames } from './tool-name-validation.js';
import {
  CompositeInputSchemaLegacy,
  SheetsConfirmInputSchemaLegacy,
  SheetsSessionInputSchemaLegacy,
  type ToolHandlerMap,
} from './tool-handler-map.js';
import { registerToolsListCompatibilityHandler } from './tools-list-compat.js';

export interface ToolExecutionExtra {
  requestId?: string | number;
  elicit?: unknown;
  sample?: unknown;
  sendNotification?: (
    notification: import('@modelcontextprotocol/sdk/types.js').ServerNotification
  ) => Promise<void>;
  sendRequest?: RelatedRequestSender;
  taskId?: string;
  taskStore?: TaskStatusUpdater;
  abortSignal?: AbortSignal;
  signal?: AbortSignal;
  progressToken?: string | number;
  requestInfo?: Pick<RequestInfo, 'headers'>;
  _meta?: { progressToken?: string | number };
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  requestHeaders?: Record<string, string | string[] | undefined>;
}

export type ToolExecutionHandler = (
  args: Record<string, unknown>,
  extra?: ToolExecutionExtra
) => Promise<CallToolResult>;

export function assertValidToolDefinitionNames(
  tools: readonly Pick<ToolDefinition, 'name'>[] = ACTIVE_TOOL_DEFINITIONS
): void {
  assertValidMcpToolNames(tools);
}

export function createPreAuthToolHandlerMap(options: {
  server: McpServer;
  authHandler: AuthHandler;
}): ToolHandlerMap {
  const sessionHandler = new SessionHandler();
  const samplingServer = createTaskAwareSamplingServer(options.server.server);

  return {
    sheets_auth: (args: unknown, _extra?: unknown) =>
      options.authHandler.handle(
        parseForHandler<Parameters<AuthHandler['handle']>[0]>(
          SheetsAuthInputSchema,
          args,
          'SheetsAuthInput',
          'sheets_auth'
        )
      ),
    sheets_confirm: (args: unknown, extra?: unknown) => {
      const requestExtra = extra as { requestId?: string | number } | undefined;
      return new ConfirmHandler({
        context: {
          batchCompiler: {} as never,
          rangeResolver: {} as never,
          server: options.server.server,
          elicitationServer: options.server.server,
          samplingServer,
          requestId: requestExtra?.requestId ? String(requestExtra.requestId) : undefined,
        },
      }).handle(
        parseForHandler<Parameters<ConfirmHandler['handle']>[0]>(
          SheetsConfirmInputSchemaLegacy,
          args,
          'SheetsConfirmInput',
          'sheets_confirm'
        )
      );
    },
    sheets_composite: async (args: unknown, _extra?: unknown) => {
      const parsed = parseForHandler<{ request: { action: string } }>(
        CompositeInputSchemaLegacy,
        args,
        'CompositeInput',
        'sheets_composite'
      );

      if (parsed.request.action === 'generate_template') {
        return {
          response: await handleGenerateTemplateAction(parsed.request as never, {
            samplingServer,
          }),
        };
      }

      if (parsed.request.action === 'preview_generation') {
        return {
          response: await handlePreviewGenerationAction(parsed.request as never, {
            samplingServer,
          }),
        };
      }

      return {
        response: {
          success: false,
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Google authentication is required for this sheets_composite action.',
            retryable: false,
          },
        },
      };
    },
    sheets_session: (args: unknown, _extra?: unknown) =>
      sessionHandler.handle(
        parseForHandler<Parameters<SessionHandler['handle']>[0]>(
          SheetsSessionInputSchemaLegacy,
          args,
          'SheetsSessionInput',
          'sheets_session'
        )
      ),
  };
}

export function registerActiveTools(options: {
  server: McpServer;
  createRunTool: (tool: ToolDefinition) => ToolExecutionHandler;
  createTaskHandler: (
    toolName: string,
    runTool: ToolExecutionHandler
  ) => ToolTaskHandler<AnySchema>;
  tools?: readonly ToolDefinition[];
}): void {
  const tools = options.tools ?? ACTIVE_TOOL_DEFINITIONS;
  assertValidToolDefinitionNames(tools);

  for (const tool of tools) {
    // Native Zod schemas are required for live SDK registration. Deferred /
    // compact schema serialization is exposed separately via tools/list.
    const inputSchemaForRegistration = tool.inputSchema;
    const outputSchemaForRegistration = tool.outputSchema;

    const execution = TOOL_EXECUTION_CONFIG[tool.name];
    const supportsTasks = execution?.taskSupport && execution.taskSupport !== 'forbidden';
    const runTool = options.createRunTool(tool);

    if (supportsTasks) {
      const taskHandler = options.createTaskHandler(tool.name, runTool);
      const taskSupport = execution?.taskSupport === 'required' ? 'required' : 'optional';
      const taskExecution = {
        ...(execution ?? {}),
        taskSupport,
      };

      options.server.experimental.tasks.registerToolTask<AnySchema, AnySchema>(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: inputSchemaForRegistration as AnySchema,
          outputSchema: outputSchemaForRegistration as AnySchema,
          annotations: tool.annotations,
          execution: taskExecution,
        } as Parameters<
          typeof options.server.experimental.tasks.registerToolTask<AnySchema, AnySchema>
        >[1],
        taskHandler
      );
      continue;
    }

    (
      options.server.registerTool as (
        name: string,
        config: {
          title?: string;
          description?: string;
          inputSchema?: unknown;
          outputSchema?: unknown;
          annotations?: ToolAnnotations;
          icons?: import('@modelcontextprotocol/sdk/types.js').Icon[];
          execution?: import('@modelcontextprotocol/sdk/types.js').ToolExecution;
        },
        cb: ToolExecutionHandler
      ) => void
    )(
      tool.name,
      {
        title: tool.annotations.title,
        description: tool.description,
        inputSchema: inputSchemaForRegistration,
        outputSchema: outputSchemaForRegistration,
        annotations: tool.annotations,
        icons: TOOL_ICONS[tool.name],
        execution,
      },
      runTool
    );
  }

  registerToolsListCompatibilityHandler(options.server);

  const registeredToolNames = tools.map((tool) => tool.name);
  if (getEnv().ENABLE_TOOLS_LIST_CHANGED_NOTIFICATIONS) {
    resourceNotifications.syncToolList(registeredToolNames, {
      emitOnFirstSet: false,
      reason: 'registered active tool definitions',
    });
  }

  replaceAvailableToolNames(registeredToolNames);
}
