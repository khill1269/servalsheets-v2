import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { RELATED_TASK_META_KEY } from '@modelcontextprotocol/sdk/types.js';
import type { ToolTaskHandler } from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js';
import { getEnv } from '../../config/env.js';
import { registerServerTaskCancelHandler } from '../../server/control-plane-registration.js';
import { logger } from '../../utils/logger.js';
import { buildToolExecutionErrorPayload } from './tool-execution-error.js';
import { buildToolResponse } from './tool-response.js';
import { ServiceError } from '../../core/errors.js';

type RegisteredTaskStore = Parameters<typeof registerServerTaskCancelHandler>[0]['taskStore'];

const taskAbortControllersByStore = new WeakMap<
  RegisteredTaskStore,
  Map<string, AbortController>
>();
const taskWatchdogTimersByStore = new WeakMap<RegisteredTaskStore, Map<string, NodeJS.Timeout>>();
const taskCancelHandlersRegistered = new WeakSet<RegisteredTaskStore>();

type ToolRunner = (
  args: Record<string, unknown>,
  extra?:
    | (Record<string, unknown> & {
        requestId?: string | number;
        abortSignal?: AbortSignal;
        signal?: AbortSignal;
      })
    | undefined
) => Promise<CallToolResult>;

function getTaskAbortControllers(taskStore: RegisteredTaskStore): Map<string, AbortController> {
  const existing = taskAbortControllersByStore.get(taskStore);
  if (existing) {
    return existing;
  }

  const controllers = new Map<string, AbortController>();
  taskAbortControllersByStore.set(taskStore, controllers);
  return controllers;
}

function getTaskWatchdogTimers(taskStore: RegisteredTaskStore): Map<string, NodeJS.Timeout> {
  const existing = taskWatchdogTimersByStore.get(taskStore);
  if (existing) {
    return existing;
  }

  const timers = new Map<string, NodeJS.Timeout>();
  taskWatchdogTimersByStore.set(taskStore, timers);
  return timers;
}

function ensureTaskCancellationControlPlane(taskStore: RegisteredTaskStore): {
  abortControllers: Map<string, AbortController>;
  watchdogTimers: Map<string, NodeJS.Timeout>;
} {
  const abortControllers = getTaskAbortControllers(taskStore);
  const watchdogTimers = getTaskWatchdogTimers(taskStore);

  if (!taskCancelHandlersRegistered.has(taskStore)) {
    registerServerTaskCancelHandler({
      taskStore,
      taskAbortControllers: abortControllers,
      taskWatchdogTimers: watchdogTimers,
      log: logger,
    });
    taskCancelHandlersRegistered.add(taskStore);
  }

  return { abortControllers, watchdogTimers };
}

function injectRelatedTaskMeta(result: CallToolResult, taskId: string): CallToolResult {
  return {
    ...result,
    _meta: {
      ...result._meta,
      [RELATED_TASK_META_KEY]: { taskId },
    },
  };
}

function buildCancelledTaskResult(message: string): CallToolResult {
  return buildToolResponse({
    response: {
      success: false,
      error: {
        code: 'TASK_CANCELLED',
        message,
        retryable: false,
      },
    },
  });
}

async function logTaskStoreFailure(
  context: string,
  toolName: string,
  error: unknown
): Promise<void> {
  try {
    const loggerModule = await import('../../utils/logger.js');
    loggerModule.logger.error(context, {
      toolName,
      error,
    });
  } catch {
    // Never surface secondary logging failures to the caller.
  }
}

export function createToolTaskHandler(
  toolName: string,
  runTool: ToolRunner
): ToolTaskHandler<AnySchema> {
  return {
    createTask: async (args, extra) => {
      if (!extra.taskStore) {
        throw new ServiceError(
          `[${toolName}] Task store not configured`,
          'INTERNAL_ERROR',
          toolName
        );
      }

      const task = await extra.taskStore.createTask({
        ttl: extra.taskRequestedTtl ?? undefined,
      });

      const taskStore = extra.taskStore as unknown as RegisteredTaskStore;
      const { abortControllers, watchdogTimers } = ensureTaskCancellationControlPlane(taskStore);
      const abortController = new AbortController();
      abortControllers.set(task.taskId, abortController);

      const taskWatchdogMs = getEnv().TASK_WATCHDOG_MS;
      const watchdogTimer = setTimeout(() => {
        if (abortControllers.has(task.taskId)) {
          logger.warn('Task watchdog: aborting hung task', {
            taskId: task.taskId,
            toolName,
            maxLifetimeMs: taskWatchdogMs,
          });
          abortController.abort(
            `Task exceeded maximum runtime of ${(taskWatchdogMs / 60000).toFixed(1)} minutes`
          );
          abortControllers.delete(task.taskId);
          watchdogTimers.delete(task.taskId);
        }
      }, taskWatchdogMs);
      watchdogTimers.set(task.taskId, watchdogTimer);

      const isTaskStoreCancelled = async (): Promise<boolean> => {
        if (!('isTaskCancelled' in taskStore) || typeof taskStore.isTaskCancelled !== 'function') {
          return false;
        }
        return await taskStore.isTaskCancelled(task.taskId);
      };
      const getCancellationReason = async (): Promise<string> => {
        if (
          'getCancellationReason' in taskStore &&
          typeof taskStore.getCancellationReason === 'function'
        ) {
          return (await taskStore.getCancellationReason(task.taskId)) || 'Task was cancelled';
        }
        return 'Task was cancelled';
      };
      const storeCancelledTaskResult = async (message: string): Promise<void> => {
        // C11: SDK storeTaskResult only accepts 'completed'|'failed'; use 'failed' for
        // cancelled tasks (the task store preserves cancelled status and the payload carries TASK_CANCELLED).
        await taskStore.storeTaskResult(
          task.taskId,
          'failed',
          injectRelatedTaskMeta(buildCancelledTaskResult(message), task.taskId)
        );
      };

      void (async () => {
        try {
          if (await isTaskStoreCancelled()) {
            await storeCancelledTaskResult(await getCancellationReason());
            return;
          }

          const result = await runTool(args as Record<string, unknown>, {
            ...(extra as unknown as Record<string, unknown>),
            taskId: task.taskId,
            taskStore,
            abortSignal: abortController.signal,
            signal: abortController.signal,
          });

          if (await isTaskStoreCancelled()) {
            await storeCancelledTaskResult(await getCancellationReason());
            return;
          }

          await taskStore.storeTaskResult(
            task.taskId,
            'completed',
            injectRelatedTaskMeta(result, task.taskId)
          );
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            try {
              await storeCancelledTaskResult(error.message);
            } catch (storeError) {
              await logTaskStoreFailure(
                'Failed to store cancelled task result',
                toolName,
                storeError
              );
            }
            return;
          }

          if (await isTaskStoreCancelled()) {
            try {
              await storeCancelledTaskResult(await getCancellationReason());
            } catch (storeError) {
              await logTaskStoreFailure(
                'Failed to store cancelled task result',
                toolName,
                storeError
              );
            }
            return;
          }

          const { errorPayload } = buildToolExecutionErrorPayload(
            error,
            toolName,
            args as Record<string, unknown>
          );
          const errorResult = buildToolResponse({
            response: {
              success: false,
              error: errorPayload,
            },
          });
          try {
            await taskStore.storeTaskResult(
              task.taskId,
              'failed',
              injectRelatedTaskMeta(errorResult, task.taskId)
            );
          } catch (storeError) {
            await logTaskStoreFailure('Failed to store task result', toolName, storeError);
          }
        } finally {
          abortControllers.delete(task.taskId);
          clearTimeout(watchdogTimers.get(task.taskId));
          watchdogTimers.delete(task.taskId);
        }
      })();

      return { task };
    },
    getTask: async (_args, extra) => {
      if (!extra.taskStore) {
        throw new ServiceError(
          `[${toolName}] Task store not configured`,
          'INTERNAL_ERROR',
          toolName
        );
      }
      return await extra.taskStore.getTask(extra.taskId);
    },
    getTaskResult: async (_args, extra) => {
      if (!extra.taskStore) {
        throw new ServiceError(
          `[${toolName}] Task store not configured`,
          'INTERNAL_ERROR',
          toolName
        );
      }
      return (await extra.taskStore.getTaskResult(extra.taskId)) as CallToolResult;
    },
  };
}
