/**
 * ServalSheets - Task Endpoints Integration Tests
 *
 * Tests MCP task endpoints (SEP-1686)
 * - tasks/get
 * - tasks/list
 * - tasks/cancel
 * - tasks/result (blocking)
 *
 * Uses an in-memory MCP client/transport to exercise protocol handlers.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GetTaskPayloadResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { TaskStoreAdapter } from '../../src/core/task-store-adapter.js';
import type { McpTestHarness } from '../helpers/mcp-test-harness.js';
import { createServalSheetsTestHarness } from '../helpers/mcp-test-harness.js';

type TaskListResponse = {
  tasks: Array<{ taskId: string }>;
  nextCursor?: string;
};

describe('Task Endpoints (SEP-1686)', () => {
  let harness: McpTestHarness;
  let taskStore: TaskStoreAdapter;
  const createdTaskIds: string[] = [];

  const tasksClient = () => harness.client.experimental.tasks;
  const taskResultSchema = GetTaskPayloadResultSchema;

  beforeAll(async () => {
    harness = await createServalSheetsTestHarness({
      serverOptions: {
        name: 'servalsheets-test',
        version: '1.0.0-test',
      },
      clientCapabilities: {
        tasks: {
          requests: {
            tools: { call: {} },
          },
        },
      },
    });

    // Access task store for test setup/cleanup (private field)
    taskStore = (harness.server as unknown as { taskStore: TaskStoreAdapter }).taskStore;
  });

  afterAll(async () => {
    for (const taskId of createdTaskIds) {
      try {
        await taskStore.getUnderlyingStore().deleteTask(taskId);
      } catch {
        // Ignore cleanup errors
      }
    }

    await harness.close();
  });

  describe('tasks/get endpoint', () => {
    it('should retrieve task by ID', async () => {
      const task = await taskStore.getUnderlyingStore().createTask({ ttl: 300000 });
      createdTaskIds.push(task.taskId);

      const response = await tasksClient().getTask(task.taskId);

      expect(response.taskId).toBe(task.taskId);
      expect(response.status).toBe('working');
      expect(response.ttl).toBe(300000);
    });

    it('should return error for non-existent task', async () => {
      await expect(tasksClient().getTask('task_nonexistent')).rejects.toThrow(/not found/i);
    });

    it('should return updated status after status change', async () => {
      const task = await taskStore.getUnderlyingStore().createTask({ ttl: 300000 });
      createdTaskIds.push(task.taskId);

      await taskStore.updateTaskStatus(task.taskId, 'completed', 'Task finished');

      const response = await tasksClient().getTask(task.taskId);

      expect(response.status).toBe('completed');
      expect(response.statusMessage).toBe('Task finished');
    });
  });

  describe('tasks/list endpoint', () => {
    it('should list all tasks', async () => {
      const task1 = await taskStore.getUnderlyingStore().createTask({ ttl: 300000 });
      const task2 = await taskStore.getUnderlyingStore().createTask({ ttl: 300000 });
      createdTaskIds.push(task1.taskId, task2.taskId);

      const response = await tasksClient().listTasks();

      expect(response.tasks).toBeInstanceOf(Array);
      const taskIds = (response as TaskListResponse).tasks.map((t) => t.taskId);
      expect(taskIds).toContain(task1.taskId);
      expect(taskIds).toContain(task2.taskId);
    });

    it('should support cursor-based pagination', async () => {
      const tasksToCreate = 55; // Default page size is 50
      for (let i = 0; i < tasksToCreate; i++) {
        const task = await taskStore.getUnderlyingStore().createTask({ ttl: 300000 });
        createdTaskIds.push(task.taskId);
      }

      const page1 = await tasksClient().listTasks();
      expect(page1.tasks).toBeInstanceOf(Array);

      if (page1.nextCursor) {
        const page2 = await tasksClient().listTasks(page1.nextCursor);
        expect(page2.tasks).toBeInstanceOf(Array);

        const page1Ids = new Set((page1 as TaskListResponse).tasks.map((t) => t.taskId));
        const page2Ids = (page2 as TaskListResponse).tasks.map((t) => t.taskId);

        for (const id of page2Ids) {
          expect(page1Ids.has(id)).toBe(false);
        }
      } else {
        expect(page1.tasks.length).toBeLessThanOrEqual(50);
      }
    });

    it('should return tasks sorted by creation time (newest first)', async () => {
      const task1 = await taskStore.getUnderlyingStore().createTask({ ttl: 300000 });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const task2 = await taskStore.getUnderlyingStore().createTask({ ttl: 300000 });
      createdTaskIds.push(task1.taskId, task2.taskId);

      const response = await tasksClient().listTasks();

      const tasks = response.tasks;
      const task1Index = (tasks as Array<{ taskId: string }>).findIndex(
        (t) => t.taskId === task1.taskId
      );
      const task2Index = (tasks as Array<{ taskId: string }>).findIndex(
        (t) => t.taskId === task2.taskId
      );

      if (task1Index >= 0 && task2Index >= 0) {
        expect(task2Index < task1Index).toBe(true);
      }
    });
  });

  describe('tasks/cancel endpoint', () => {
    it('should cancel an active task', async () => {
      const task = await taskStore.getUnderlyingStore().createTask({ ttl: 300000 });
      createdTaskIds.push(task.taskId);

      const cancelResponse = await tasksClient().cancelTask(task.taskId);

      expect(cancelResponse).toBeDefined();
      expect(cancelResponse.status).toBe('cancelled');

      const updatedTask = await tasksClient().getTask(task.taskId);
      expect(updatedTask.status).toBe('cancelled');
    });

    it('should reject cancellation of terminal task', async () => {
      const task = await taskStore.getUnderlyingStore().createTask({ ttl: 300000 });
      createdTaskIds.push(task.taskId);

      await taskStore.updateTaskStatus(task.taskId, 'completed');

      await expect(tasksClient().cancelTask(task.taskId)).rejects.toThrow(/terminal|completed/i);
    });

    it('should reject cancellation of non-existent task', async () => {
      await expect(tasksClient().cancelTask('task_nonexistent')).rejects.toThrow(/not found/i);
    });
  });

  describe('tasks/result endpoint (blocking)', () => {
    it('should wait for task completion and return result', async () => {
      const task = await taskStore.getUnderlyingStore().createTask({ ttl: 300000 });
      createdTaskIds.push(task.taskId);
      task.pollInterval = 50;

      setTimeout(async () => {
        await taskStore.storeTaskResult(task.taskId, 'completed', {
          content: [{ type: 'text', text: 'Task completed successfully!' }],
          isError: false,
        });
      }, 100);

      const resultPromise = tasksClient().getTaskResult(task.taskId, taskResultSchema);
      const result = await Promise.race([
        resultPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout waiting for result')), 5000)
        ),
      ]);

      expect(result).toBeDefined();
      expect((result as { content: Array<{ text: string }> }).content[0]?.text).toBe(
        'Task completed successfully!'
      );
    });

    it('should return immediately if task already completed', async () => {
      const task = await taskStore.getUnderlyingStore().createTask({ ttl: 300000 });
      createdTaskIds.push(task.taskId);

      await taskStore.storeTaskResult(task.taskId, 'completed', {
        content: [{ type: 'text', text: 'Already done!' }],
        isError: false,
      });

      const start = Date.now();
      const result = await tasksClient().getTaskResult(task.taskId, taskResultSchema);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
      expect((result as { content: Array<{ text: string }> }).content[0]?.text).toBe(
        'Already done!'
      );
    });
  });

  describe('Task lifecycle', () => {
    it('should follow complete lifecycle: create → work → complete → result', async () => {
      const task = await taskStore.getUnderlyingStore().createTask({ ttl: 300000 });
      createdTaskIds.push(task.taskId);

      expect(task.status).toBe('working');

      await taskStore.updateTaskStatus(task.taskId, 'working', 'Step 1 of 3...');
      let retrieved = await tasksClient().getTask(task.taskId);
      expect(retrieved.statusMessage).toBe('Step 1 of 3...');

      await taskStore.updateTaskStatus(task.taskId, 'working', 'Step 2 of 3...');

      await taskStore.storeTaskResult(task.taskId, 'completed', {
        content: [{ type: 'text', text: 'All done!' }],
        isError: false,
      });

      retrieved = await tasksClient().getTask(task.taskId);
      expect(retrieved.status).toBe('completed');

      const result = await tasksClient().getTaskResult(task.taskId, taskResultSchema);
      expect((result as { content: Array<{ text: string }> }).content[0]?.text).toBe('All done!');
    });

    it('should handle failed task lifecycle', async () => {
      const task = await taskStore.getUnderlyingStore().createTask({ ttl: 300000 });
      createdTaskIds.push(task.taskId);

      await taskStore.storeTaskResult(task.taskId, 'failed', {
        content: [{ type: 'text', text: 'Operation failed: Network error' }],
        isError: true,
      });

      const retrieved = await tasksClient().getTask(task.taskId);
      expect(retrieved.status).toBe('failed');

      const result = await tasksClient().getTaskResult(task.taskId, taskResultSchema);
      expect((result as { isError?: boolean }).isError).toBe(true);
    });
  });

  describe('Task expiration', () => {
    it('should expire task after TTL', async () => {
      const task = await taskStore.getUnderlyingStore().createTask({ ttl: 50 });
      createdTaskIds.push(task.taskId);

      const initial = await taskStore.getTask(task.taskId);
      expect(initial).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 100));

      await expect(tasksClient().getTask(task.taskId)).rejects.toThrow(/not found/i);
    });
  });

  describe('Error handling', () => {
    it('should handle malformed taskId', async () => {
      await expect(tasksClient().getTask('')).rejects.toThrow();
      await expect(tasksClient().getTask('not-a-task-id')).rejects.toThrow();
    });
  });
});
