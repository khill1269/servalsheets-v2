/**
 * ServalSheets - Task Store Adapter Tests
 *
 * Tests the TaskStoreAdapter that bridges SDK TaskStore interface
 * with custom InMemoryTaskStore implementation
 *
 * MCP Protocol: 2025-11-25 (SEP-1686)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Request, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TaskStoreAdapter } from '../../src/core/task-store-adapter.js';

describe('TaskStoreAdapter', () => {
  let adapter: TaskStoreAdapter;

  beforeEach(() => {
    adapter = new TaskStoreAdapter();
  });

  afterEach(() => {
    adapter.dispose();
  });

  describe('createTask', () => {
    it('should create task with SDK interface', async () => {
      const task = await adapter.createTask({ ttl: 300000 }, 'request-123', {
        method: 'tools/call',
        params: {},
      } as Request);

      expect(task.taskId).toBeDefined();
      expect(task.status).toBe('working');
      expect(task.ttl).toBe(300000);
      expect(task.createdAt).toBeDefined();
    });

    it('should handle null ttl (use default)', async () => {
      const task = await adapter.createTask({ ttl: null }, 'req-1', {
        method: 'test',
        params: {},
      } as Request);

      // Default TTL from InMemoryTaskStore is 1 hour (3600000ms)
      expect(task.ttl).toBe(3600000);
    });

    it('should handle undefined ttl (use default)', async () => {
      const task = await adapter.createTask({ ttl: undefined }, 'req-2', {
        method: 'test',
        params: {},
      } as Request);

      expect(task.ttl).toBe(3600000);
    });

    it('should create multiple tasks with unique IDs', async () => {
      const task1 = await adapter.createTask({ ttl: 300000 }, 'req-1', {
        method: 'test',
        params: {},
      } as Request);
      const task2 = await adapter.createTask({ ttl: 300000 }, 'req-2', {
        method: 'test',
        params: {},
      } as Request);

      expect(task1.taskId).not.toBe(task2.taskId);
    });
  });

  describe('getTask', () => {
    it('should retrieve task by ID', async () => {
      const created = await adapter.createTask({ ttl: 300000 }, 'req-1', {
        method: 'test',
        params: {},
      } as Request);

      const retrieved = await adapter.getTask(created.taskId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.taskId).toBe(created.taskId);
      expect(retrieved?.status).toBe('working');
    });

    it('should return null for non-existent task', async () => {
      const retrieved = await adapter.getTask('non-existent-id');
      expect(retrieved).toBeNull();
    });

    it('should ignore sessionId parameter', async () => {
      const created = await adapter.createTask({ ttl: 300000 }, 'req-1', {
        method: 'test',
        params: {},
      } as Request);

      // Should work with or without sessionId
      const retrieved1 = await adapter.getTask(created.taskId);
      const retrieved2 = await adapter.getTask(created.taskId, 'session-123');

      expect(retrieved1?.taskId).toBe(created.taskId);
      expect(retrieved2?.taskId).toBe(created.taskId);
    });
  });

  describe('storeTaskResult', () => {
    it('should store completed task result', async () => {
      const task = await adapter.createTask({ ttl: 300000 }, 'req-1', {
        method: 'test',
        params: {},
      } as Request);

      const result = {
        content: [{ type: 'text' as const, text: 'Success' }],
        isError: false,
      };

      await adapter.storeTaskResult(task.taskId, 'completed', result);

      const retrieved = await adapter.getTask(task.taskId);
      expect(retrieved?.status).toBe('completed');
    });

    it('should store failed task result', async () => {
      const task = await adapter.createTask({ ttl: 300000 }, 'req-1', {
        method: 'test',
        params: {},
      } as Request);

      const result = {
        content: [{ type: 'text' as const, text: 'Error occurred' }],
        isError: true,
      };

      await adapter.storeTaskResult(task.taskId, 'failed', result);

      const retrieved = await adapter.getTask(task.taskId);
      expect(retrieved?.status).toBe('failed');
    });

    it('should preserve cancelled status when a late completion result arrives', async () => {
      const task = await adapter.createTask({ ttl: 300000 }, 'req-1', {
        method: 'test',
        params: {},
      } as Request);

      await adapter.updateTaskStatus(task.taskId, 'cancelled', 'User cancelled');
      await adapter.storeTaskResult(task.taskId, 'completed', {
        content: [{ type: 'text' as const, text: 'Late success' }],
        isError: false,
      });

      const retrievedTask = await adapter.getTask(task.taskId);
      const retrievedResult = await adapter.getUnderlyingStore().getTaskResult(task.taskId);

      expect(retrievedTask?.status).toBe('cancelled');
      expect(retrievedResult?.status).toBe('cancelled');
    });

    it('should expose a TASK_CANCELLED result immediately after cancellation', async () => {
      const task = await adapter.createTask({ ttl: 300000 }, 'req-1', {
        method: 'test',
        params: {},
      } as Request);

      await adapter.cancelTask(task.taskId, 'User cancelled');

      const retrievedResult = await adapter.getTaskResult(task.taskId);

      expect(retrievedResult.structuredContent).toMatchObject({
        response: {
          success: false,
          error: {
            code: 'TASK_CANCELLED',
            message: 'User cancelled',
          },
        },
      });
    });
  });

  describe('getTaskResult', () => {
    it('should retrieve task result', async () => {
      const task = await adapter.createTask({ ttl: 300000 }, 'req-1', {
        method: 'test',
        params: {},
      } as Request);

      const result = {
        content: [{ type: 'text' as const, text: 'Success' }],
        isError: false,
      };

      await adapter.storeTaskResult(task.taskId, 'completed', result);
      const retrieved = (await adapter.getTaskResult(task.taskId)) as CallToolResult;
      const first = retrieved.content[0];
      if (!first || first.type !== 'text') {
        throw new Error('Expected text result');
      }
      expect(first).toEqual({ type: 'text', text: 'Success' });
      expect(retrieved.isError).toBe(false);
    });

    it('should throw error for task without result', async () => {
      const task = await adapter.createTask({ ttl: 300000 }, 'req-1', {
        method: 'test',
        params: {},
      } as Request);

      await expect(async () => {
        await adapter.getTaskResult(task.taskId);
      }).rejects.toThrow(`task not found: ${task.taskId}`);
    });

    it('should throw error for non-existent task', async () => {
      await expect(async () => {
        await adapter.getTaskResult('non-existent');
      }).rejects.toThrow('task not found: non-existent');
    });
  });

  describe('updateTaskStatus', () => {
    it('should update task status to input_required', async () => {
      const task = await adapter.createTask({ ttl: 300000 }, 'req-1', {
        method: 'test',
        params: {},
      } as Request);

      await adapter.updateTaskStatus(task.taskId, 'input_required', 'Waiting for user input');

      const retrieved = await adapter.getTask(task.taskId);
      expect(retrieved?.status).toBe('input_required');
      expect(retrieved?.statusMessage).toBe('Waiting for user input');
    });

    it('should update task status to cancelled', async () => {
      const task = await adapter.createTask({ ttl: 300000 }, 'req-1', {
        method: 'test',
        params: {},
      } as Request);

      await adapter.updateTaskStatus(task.taskId, 'cancelled', 'User cancelled');

      const retrieved = await adapter.getTask(task.taskId);
      expect(retrieved?.status).toBe('cancelled');
    });

    it('should update status without message', async () => {
      const task = await adapter.createTask({ ttl: 300000 }, 'req-1', {
        method: 'test',
        params: {},
      } as Request);

      await adapter.updateTaskStatus(task.taskId, 'completed');

      const retrieved = await adapter.getTask(task.taskId);
      expect(retrieved?.status).toBe('completed');
    });
  });

  describe('listTasks', () => {
    it('should list all tasks when under page size', async () => {
      // Create 5 tasks
      for (let i = 0; i < 5; i++) {
        await adapter.createTask({ ttl: 300000 }, `req-${i}`, {
          method: 'test',
          params: {},
        } as Request);
      }

      const result = await adapter.listTasks();

      expect(result.tasks).toHaveLength(5);
      expect(result.nextCursor).toBeUndefined();
    });

    it('should paginate tasks over page size', async () => {
      // Create 60 tasks (exceeds PAGE_SIZE of 50)
      for (let i = 0; i < 60; i++) {
        await adapter.createTask({ ttl: 300000 }, `req-${i}`, {
          method: 'test',
          params: {},
        } as Request);
      }

      // First page
      const page1 = await adapter.listTasks();
      expect(page1.tasks).toHaveLength(50);
      expect(page1.nextCursor).toBeDefined();

      // Second page
      const page2 = await adapter.listTasks(page1.nextCursor);
      expect(page2.tasks).toHaveLength(10);
      expect(page2.nextCursor).toBeUndefined();
    });

    it('should return tasks in reverse chronological order (newest first)', async () => {
      const task1 = await adapter.createTask({ ttl: 300000 }, 'req-1', {
        method: 'test',
        params: {},
      } as Request);

      // Wait to ensure different timestamps (50ms should be sufficient)
      await new Promise((resolve) => setTimeout(resolve, 50));

      const task2 = await adapter.createTask({ ttl: 300000 }, 'req-2', {
        method: 'test',
        params: {},
      } as Request);

      const result = await adapter.listTasks();

      // Newest task should be first
      const [first, second] = result.tasks;
      if (!first || !second) {
        throw new Error('Expected at least 2 tasks');
      }
      expect(first.taskId).toBe(task2.taskId);
      expect(second.taskId).toBe(task1.taskId);
    });

    it('should handle pagination with exact page size boundary', async () => {
      // Create exactly 50 tasks (PAGE_SIZE)
      for (let i = 0; i < 50; i++) {
        await adapter.createTask({ ttl: 300000 }, `req-${i}`, {
          method: 'test',
          params: {},
        } as Request);
      }

      const result = await adapter.listTasks();

      expect(result.tasks).toHaveLength(50);
      expect(result.nextCursor).toBeUndefined(); // No more pages
    });

    it('should ignore sessionId parameter', async () => {
      await adapter.createTask({ ttl: 300000 }, 'req-1', { method: 'test', params: {} } as Request);

      const result1 = await adapter.listTasks();
      const result2 = await adapter.listTasks(undefined, 'session-123');

      expect(result1.tasks).toHaveLength(1);
      expect(result2.tasks).toHaveLength(1);
    });
  });

  describe('type compatibility', () => {
    it('should handle Result to CallToolResult conversion', async () => {
      const task = await adapter.createTask({ ttl: 300000 }, 'test', {
        method: 'test',
        params: {},
      } as Request);

      const result = {
        content: [{ type: 'text' as const, text: 'Success' }],
        isError: false,
      };

      await adapter.storeTaskResult(task.taskId, 'completed', result);
      const retrieved = (await adapter.getTaskResult(task.taskId)) as CallToolResult;

      // Both Result and CallToolResult have same structure
      const first = retrieved.content[0];
      if (!first || first.type !== 'text') {
        throw new Error('Expected text result');
      }
      expect(first.text).toBe('Success');
      expect(retrieved.isError).toBe(false);
    });

    it('should handle Result with isError=true', async () => {
      const task = await adapter.createTask({ ttl: 300000 }, 'test', {
        method: 'test',
        params: {},
      } as Request);

      const result = {
        content: [{ type: 'text' as const, text: 'Error occurred' }],
        isError: true,
      };

      await adapter.storeTaskResult(task.taskId, 'failed', result);
      const retrieved = (await adapter.getTaskResult(task.taskId)) as CallToolResult;

      expect(retrieved.isError).toBe(true);
    });
  });

  describe('getUnderlyingStore', () => {
    it('should expose underlying task store', () => {
      const store = adapter.getUnderlyingStore();
      expect(store).toBeDefined();
      expect(typeof store.createTask).toBe('function');
      expect(typeof store.getTask).toBe('function');
    });
  });

  describe('dispose', () => {
    it('should dispose underlying store resources', () => {
      // Create new adapter for this test
      const testAdapter = new TaskStoreAdapter();

      // Should not throw
      expect(() => {
        testAdapter.dispose();
      }).not.toThrow();
    });

    it('should handle multiple dispose calls', () => {
      const testAdapter = new TaskStoreAdapter();

      // Should be safe to call multiple times
      testAdapter.dispose();
      testAdapter.dispose();
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete task lifecycle', async () => {
      // 1. Create task
      const task = await adapter.createTask({ ttl: 300000 }, 'req-1', {
        method: 'test',
        params: {},
      } as Request);
      expect(task.status).toBe('working');

      // 2. Update status to input_required
      await adapter.updateTaskStatus(task.taskId, 'input_required', 'Need confirmation');
      let retrieved = await adapter.getTask(task.taskId);
      expect(retrieved?.status).toBe('input_required');

      // 3. Update status back to working
      await adapter.updateTaskStatus(task.taskId, 'working', 'Processing');
      retrieved = await adapter.getTask(task.taskId);
      expect(retrieved?.status).toBe('working');

      // 4. Complete with result
      const result = {
        content: [{ type: 'text' as const, text: 'Done' }],
        isError: false,
      };
      await adapter.storeTaskResult(task.taskId, 'completed', result);
      retrieved = await adapter.getTask(task.taskId);
      expect(retrieved?.status).toBe('completed');

      // 5. Retrieve result
      const finalResult = (await adapter.getTaskResult(task.taskId)) as CallToolResult;
      const first = finalResult.content[0];
      if (!first || first.type !== 'text') {
        throw new Error('Expected text result');
      }
      expect(first.text).toBe('Done');
    });

    it('should handle error scenario', async () => {
      // 1. Create task
      const task = await adapter.createTask({ ttl: 300000 }, 'req-1', {
        method: 'test',
        params: {},
      } as Request);

      // 2. Task fails
      const errorResult = {
        content: [{ type: 'text' as const, text: 'Operation failed' }],
        isError: true,
      };
      await adapter.storeTaskResult(task.taskId, 'failed', errorResult);

      // 3. Verify failure
      const retrieved = await adapter.getTask(task.taskId);
      expect(retrieved?.status).toBe('failed');

      const result = (await adapter.getTaskResult(task.taskId)) as CallToolResult;
      expect(result.isError).toBe(true);
    });
  });
});
