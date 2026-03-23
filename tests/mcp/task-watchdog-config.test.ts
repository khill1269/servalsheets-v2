import { afterEach, describe, expect, it } from 'vitest';
import { ServalSheetsServer } from '../../src/server.js';
import { validateEnv } from '../../src/config/env.js';

async function waitForTaskResult(
  server: ServalSheetsServer,
  taskId: string,
  timeoutMs: number = 1000
): Promise<unknown> {
  const taskStore = (
    server as unknown as { taskStore: { getTaskResult: (id: string) => Promise<unknown> } }
  ).taskStore;

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await taskStore.getTaskResult(taskId);
      if (result) {
        return result;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('No result found') && !message.includes('task not found')) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for task result: ${taskId}`);
}

describe('task watchdog configuration', () => {
  const previousTaskWatchdog = process.env['TASK_WATCHDOG_MS'];

  afterEach(() => {
    if (previousTaskWatchdog === undefined) {
      delete process.env['TASK_WATCHDOG_MS'];
    } else {
      process.env['TASK_WATCHDOG_MS'] = previousTaskWatchdog;
    }
    validateEnv();
  });

  it('uses TASK_WATCHDOG_MS from env to abort hung tasks', async () => {
    process.env['TASK_WATCHDOG_MS'] = '25';
    validateEnv();

    const server = new ServalSheetsServer();
    const taskStore = (server as unknown as { taskStore: unknown }).taskStore;

    (
      server as unknown as {
        handleToolCall: (
          toolName: string,
          args: Record<string, unknown>,
          extra?: { abortSignal?: AbortSignal }
        ) => Promise<unknown>;
      }
    ).handleToolCall = (_toolName, _args, extra) =>
      new Promise((_resolve, reject) => {
        extra?.abortSignal?.addEventListener('abort', () => {
          const reason = String(extra.abortSignal?.reason ?? 'aborted');
          const error = new Error(reason);
          (error as Error & { name: string }).name = 'AbortError';
          reject(error);
        });
      });

    const taskHandler = (
      server as unknown as {
        createToolTaskHandler: (toolName: string) => {
          createTask: (
            args: Record<string, unknown>,
            extra: { taskStore: unknown; taskRequestedTtl?: number }
          ) => Promise<{ task: { taskId: string } }>;
        };
      }
    ).createToolTaskHandler('sheets_auth');

    const created = await taskHandler.createTask({}, { taskStore });
    const taskResult = (await waitForTaskResult(server, created.task.taskId)) as {
      structuredContent?: {
        response?: {
          error?: { code?: string; message?: string };
        };
      };
    };

    expect(taskResult.structuredContent?.response?.error?.code).toBe('TASK_CANCELLED');
    expect(taskResult.structuredContent?.response?.error?.message).toContain('maximum runtime');

    await server.shutdown();
  });

  it('stores a TASK_CANCELLED result when cancellation lands just before a successful result write', async () => {
    const server = new ServalSheetsServer();
    const taskStore = (
      server as unknown as {
        taskStore: {
          cancelTask: (taskId: string, reason?: string) => Promise<void>;
          getTask: (taskId: string) => Promise<{ status: string } | null>;
        };
      }
    ).taskStore;

    let taskId: string | undefined;
    let releaseHandleToolCall: (() => void) | undefined;
    const handleToolCallGate = new Promise<void>((resolve) => {
      releaseHandleToolCall = resolve;
    });

    (
      server as unknown as {
        handleToolCall: (
          toolName: string,
          args: Record<string, unknown>,
          extra?: { abortSignal?: AbortSignal }
        ) => Promise<unknown>;
      }
    ).handleToolCall = async () => {
      await handleToolCallGate;
      await taskStore.cancelTask(taskId!, 'Cancelled after execution completed');
      return {
        content: [{ type: 'text', text: 'Late success' }],
        isError: false,
      };
    };

    const taskHandler = (
      server as unknown as {
        createToolTaskHandler: (toolName: string) => {
          createTask: (
            args: Record<string, unknown>,
            extra: { taskStore: unknown; taskRequestedTtl?: number }
          ) => Promise<{ task: { taskId: string } }>;
        };
      }
    ).createToolTaskHandler('sheets_auth');

    const created = await taskHandler.createTask({}, { taskStore });
    taskId = created.task.taskId;
    releaseHandleToolCall?.();

    const taskResult = (await waitForTaskResult(server, created.task.taskId)) as {
      structuredContent?: {
        response?: {
          error?: { code?: string; message?: string };
        };
      };
    };
    const task = await taskStore.getTask(created.task.taskId);

    expect(task?.status).toBe('cancelled');
    expect(taskResult.structuredContent?.response?.error?.code).toBe('TASK_CANCELLED');
    expect(taskResult.structuredContent?.response?.error?.message).toContain(
      'Cancelled after execution completed'
    );

    await server.shutdown();
  });
});
