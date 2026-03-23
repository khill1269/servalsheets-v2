import { describe, expect, it, vi } from 'vitest';
import { TaskStoreAdapter } from '../../src/core/task-store-adapter.js';
import { InMemoryTaskStore } from '../../src/core/task-store.js';
import { createToolTaskHandler } from '../../src/mcp/registration/tool-handlers.js';

describe('legacy tool task handler cancellation control plane', () => {
  it('aborts in-flight work when the task store receives a cancellation request', async () => {
    const taskStore = new TaskStoreAdapter(new InMemoryTaskStore());
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    let seenAbortSignal: AbortSignal | undefined;
    let abortReason: unknown;

    const handler = createToolTaskHandler('test_tool', async (_args, extra) => {
      seenAbortSignal = extra?.abortSignal;
      resolveStarted?.();

      await new Promise<never>((_resolve, reject) => {
        extra?.abortSignal?.addEventListener(
          'abort',
          () => {
            abortReason = extra.abortSignal?.reason;
            const error = new Error(
              typeof abortReason === 'string' ? abortReason : 'Task aborted by test'
            );
            error.name = 'AbortError';
            reject(error);
          },
          { once: true }
        );
      });

      throw new Error('Unreachable');
    });

    try {
      const { task } = await handler.createTask(
        {},
        { taskStore, taskRequestedTtl: 60000 } as Parameters<typeof handler.createTask>[1]
      );

      await started;

      expect(seenAbortSignal).toBeDefined();
      expect(
        (
          taskStore.getUnderlyingStore() as { onTaskCancelled?: (taskId: string, reason: string) => void }
        ).onTaskCancelled
      ).toBeTypeOf('function');

      await taskStore.cancelTask(task.taskId, 'Cancelled by tool-handlers regression test');

      await vi.waitFor(async () => {
        const storedTask = await taskStore.getTask(task.taskId);
        const taskResult = await taskStore.getUnderlyingStore().getTaskResult(task.taskId);

        expect(storedTask?.status).toBe('cancelled');
        expect(taskResult?.status).toBe('cancelled');
        expect(taskResult?.result.structuredContent).toMatchObject({
          response: {
            success: false,
            error: {
              code: 'TASK_CANCELLED',
              message: 'Cancelled by tool-handlers regression test',
            },
          },
        });
      });

      expect(seenAbortSignal?.aborted).toBe(true);
      expect(abortReason).toBe('Cancelled by tool-handlers regression test');
    } finally {
      taskStore.dispose();
    }
  });
});
