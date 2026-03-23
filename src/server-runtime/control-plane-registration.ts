import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import type { TaskStoreAdapter } from '../core/index.js';
import { handleLoggingSetLevel } from '../handlers/logging.js';
import { logger as baseLogger } from '../utils/logger.js';

export function registerServerTaskCancelHandler(params: {
  taskStore: TaskStoreAdapter;
  taskAbortControllers: Map<string, AbortController>;
  taskWatchdogTimers: Map<string, NodeJS.Timeout>;
  log?: typeof baseLogger;
}): void {
  const { taskStore, taskAbortControllers, taskWatchdogTimers, log = baseLogger } = params;

  try {
    // Wire the cancel callback: when the SDK's TaskStore.cancelTask() is called
    // (via tasks/cancel protocol request), abort the running operation's AbortController.
    const underlyingStore = taskStore.getUnderlyingStore();
    if ('onTaskCancelled' in underlyingStore) {
      (
        underlyingStore as { onTaskCancelled?: (taskId: string, reason: string) => void }
      ).onTaskCancelled = (taskId, reason) => {
        const abortController = taskAbortControllers.get(taskId);
        if (abortController) {
          abortController.abort(reason);
          taskAbortControllers.delete(taskId);
          log.info('Task abort signal sent', { taskId, reason });
        }

        // Clear watchdog timer when task is cancelled via store.
        clearTimeout(taskWatchdogTimers.get(taskId));
        taskWatchdogTimers.delete(taskId);
      };
      log.info('Task cancellation support enabled');
    } else {
      log.warn('Task cancellation not available (store does not support onTaskCancelled)');
    }
  } catch (error) {
    log.error('Failed to register task cancel handler', { error });
  }
}

export function registerServerLoggingSetLevelHandler(params: {
  server: McpServer;
  setRequestedMcpLogLevel: (level: LoggingLevel) => void;
  installLoggingBridge: () => void;
  log?: typeof baseLogger;
}): void {
  const { server, setRequestedMcpLogLevel, installLoggingBridge, log = baseLogger } = params;

  try {
    server.server.setRequestHandler(
      SetLevelRequestSchema,
      async (request: { params: { level: LoggingLevel } }) => {
        const level = request.params.level;
        setRequestedMcpLogLevel(level);
        installLoggingBridge();

        const response = await handleLoggingSetLevel({ level });
        log.info('Log level changed via logging/setLevel', {
          previousLevel: response.previousLevel,
          newLevel: response.newLevel,
        });

        // OK: Explicit empty - MCP logging/setLevel returns empty object per protocol.
        return {};
      }
    );

    log.info('Logging handler registered (logging/setLevel)');
  } catch (error) {
    log.error('Failed to register logging handler', { error });
  }
}
