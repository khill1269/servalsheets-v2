/**
 * ServalSheets - Task Store Tests
 *
 * Comprehensive test suite for InMemoryTaskStore implementation
 * Tests task lifecycle, expiration, pagination, and edge cases
 *
 * MCP Protocol: 2025-11-25 (SEP-1686)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryTaskStore } from '../../src/core/task-store.js';
import type { TaskStatus } from '../../src/core/task-store.js';
import { waitFor } from '../helpers/wait-for.js';

describe('InMemoryTaskStore', () => {
  let store: InMemoryTaskStore;

  beforeEach(() => {
    store = new InMemoryTaskStore();
  });

  afterEach(() => {
    store.dispose();
  });

  describe('createTask', () => {
    it('should create a task with default TTL', async () => {
      const task = await store.createTask();

      expect(task.taskId).toMatch(/^task_[0-9a-f-]+$/);
      expect(task.status).toBe('working');
      expect(task.ttl).toBe(3600000); // 1 hour
      expect(task.pollInterval).toBe(5000);
      expect(task.createdAt).toBeDefined();
      expect(task.lastUpdatedAt).toBeDefined();
    });

    it('should create a task with custom TTL', async () => {
      const task = await store.createTask({ ttl: 600000 });
      expect(task.ttl).toBe(600000); // 10 minutes
    });

    it('should create tasks with unique IDs', async () => {
      const task1 = await store.createTask();
      const task2 = await store.createTask();

      expect(task1.taskId).not.toBe(task2.taskId);
    });

    it('should set timestamps correctly', async () => {
      const before = new Date().toISOString();
      const task = await store.createTask();
      const after = new Date().toISOString();

      expect(task.createdAt >= before).toBe(true);
      expect(task.createdAt <= after).toBe(true);
      expect(task.lastUpdatedAt).toBe(task.createdAt);
    });
  });

  describe('getTask', () => {
    it('should retrieve an existing task', async () => {
      const created = await store.createTask();
      const retrieved = await store.getTask(created.taskId);

      expect(retrieved).toEqual(created);
    });

    it('should return null for non-existent task', async () => {
      const retrieved = await store.getTask('task_nonexistent');
      expect(retrieved).toBeNull();
    });

    it('should return null for expired task', async () => {
      // Create task with 1ms TTL
      const task = await store.createTask({ ttl: 1 });

      // Wait for expiration
      await waitFor(10);

      const retrieved = await store.getTask(task.taskId);
      expect(retrieved).toBeNull();
    });

    it('should return task with updated fields', async () => {
      const task = await store.createTask();
      await store.updateTaskStatus(task.taskId, 'completed', 'Done!');

      const retrieved = await store.getTask(task.taskId);
      expect(retrieved?.status).toBe('completed');
      expect(retrieved?.statusMessage).toBe('Done!');
    });
  });

  describe('updateTaskStatus', () => {
    it('should update task status', async () => {
      const task = await store.createTask();

      await store.updateTaskStatus(task.taskId, 'completed', 'Success');

      const updated = await store.getTask(task.taskId);
      expect(updated?.status).toBe('completed');
      expect(updated?.statusMessage).toBe('Success');
    });

    it('should throw for non-existent task', async () => {
      await expect(store.updateTaskStatus('task_nonexistent', 'completed')).rejects.toThrow(
        'task not found'
      );
    });

    it('should update lastUpdatedAt timestamp', async () => {
      const task = await store.createTask();
      const originalTimestamp = task.lastUpdatedAt;

      // Wait a bit
      await waitFor(10);

      await store.updateTaskStatus(task.taskId, 'working', 'In progress...');

      const updated = await store.getTask(task.taskId);
      expect(updated?.lastUpdatedAt).not.toBe(originalTimestamp);
      expect(updated!.lastUpdatedAt > originalTimestamp).toBe(true);
    });

    it('should allow status transition to all valid states', async () => {
      const states: TaskStatus[] = [
        'working',
        'completed',
        'failed',
        'input_required',
        'cancelled',
      ];

      for (const status of states) {
        const task = await store.createTask();
        await store.updateTaskStatus(task.taskId, status);
        const updated = await store.getTask(task.taskId);
        expect(updated?.status).toBe(status);
      }
    });

    it('should handle optional status message', async () => {
      const task = await store.createTask();

      // Without message
      await store.updateTaskStatus(task.taskId, 'working');
      let updated = await store.getTask(task.taskId);
      expect(updated?.statusMessage).toBeUndefined();

      // With message
      await store.updateTaskStatus(task.taskId, 'completed', 'All done');
      updated = await store.getTask(task.taskId);
      expect(updated?.statusMessage).toBe('All done');
    });
  });

  describe('storeTaskResult and getTaskResult', () => {
    it('should store and retrieve task result', async () => {
      const task = await store.createTask();
      const result = {
        content: [{ type: 'text' as const, text: 'Success!' }],
        isError: false,
      };

      await store.storeTaskResult(task.taskId, 'completed', result);
      const retrieved = await store.getTaskResult(task.taskId);

      expect(retrieved).toEqual({ status: 'completed', result });
    });

    it('should return null for task without result', async () => {
      const task = await store.createTask();
      const result = await store.getTaskResult(task.taskId);

      expect(result).toBeNull();
    });

    it('should throw for non-existent task', async () => {
      await expect(
        store.storeTaskResult('task_nonexistent', 'completed', { content: [], isError: false })
      ).rejects.toThrow('task not found');
    });

    it('should store failed result', async () => {
      const task = await store.createTask();
      const result = {
        content: [{ type: 'text' as const, text: 'Error occurred' }],
        isError: true,
      };

      await store.storeTaskResult(task.taskId, 'failed', result);
      const retrieved = await store.getTaskResult(task.taskId);

      expect(retrieved).toEqual({ status: 'failed', result });
    });

    it('should overwrite previous result', async () => {
      const task = await store.createTask();

      const result1 = { content: [{ type: 'text' as const, text: 'First' }], isError: false };
      await store.storeTaskResult(task.taskId, 'completed', result1);

      const result2 = { content: [{ type: 'text' as const, text: 'Second' }], isError: false };
      await store.storeTaskResult(task.taskId, 'completed', result2);

      const retrieved = await store.getTaskResult(task.taskId);
      const first = retrieved?.result.content[0];
      if (!first || first.type !== 'text') {
        throw new Error('Expected text result');
      }
      expect(first.text).toBe('Second');
    });

    it('should preserve cancelled status when a late completion result arrives', async () => {
      const task = await store.createTask();
      await store.cancelTask(task.taskId, 'User cancelled');

      await store.storeTaskResult(task.taskId, 'completed', {
        content: [{ type: 'text' as const, text: 'Late success' }],
        isError: false,
      });

      const retrievedTask = await store.getTask(task.taskId);
      const retrievedResult = await store.getTaskResult(task.taskId);

      expect(retrievedTask?.status).toBe('cancelled');
      expect(retrievedResult?.status).toBe('cancelled');
    });

    it('should return a TASK_CANCELLED result immediately after cancellation', async () => {
      const task = await store.createTask();

      await store.cancelTask(task.taskId, 'User cancelled');

      const retrievedResult = await store.getTaskResult(task.taskId);

      expect(retrievedResult?.status).toBe('cancelled');
      expect(retrievedResult?.result.structuredContent).toMatchObject({
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

  describe('getAllTasks', () => {
    it('should return empty array when no tasks', async () => {
      const tasks = await store.getAllTasks();
      expect(tasks).toEqual([]);
    });

    it('should return all tasks', async () => {
      await store.createTask();
      await store.createTask();
      await store.createTask();

      const tasks = await store.getAllTasks();
      expect(tasks).toHaveLength(3);
    });

    it('should sort tasks by creation time (newest first)', async () => {
      const task1 = await store.createTask();
      await waitFor(10);
      const task2 = await store.createTask();
      await waitFor(10);
      const task3 = await store.createTask();

      const tasks = await store.getAllTasks();

      const [first, second, third] = tasks;
      if (!first || !second || !third) {
        throw new Error('Expected at least 3 tasks');
      }
      expect(first.taskId).toBe(task3.taskId);
      expect(second.taskId).toBe(task2.taskId);
      expect(third.taskId).toBe(task1.taskId);
    });

    it('should not include expired tasks', async () => {
      // Create short-lived task
      await store.createTask({ ttl: 1 });
      // Create long-lived task
      await store.createTask({ ttl: 60000 });

      // Wait for short task to expire
      await waitFor(10);

      const tasks = await store.getAllTasks();
      expect(tasks).toHaveLength(1);
    });
  });

  describe('deleteTask', () => {
    it('should delete task and result', async () => {
      const task = await store.createTask();
      const result = { content: [{ type: 'text' as const, text: 'Test' }], isError: false };
      await store.storeTaskResult(task.taskId, 'completed', result);

      await store.deleteTask(task.taskId);

      const retrieved = await store.getTask(task.taskId);
      expect(retrieved).toBeNull();

      const retrievedResult = await store.getTaskResult(task.taskId);
      expect(retrievedResult).toBeNull();
    });

    it('should not throw for non-existent task', async () => {
      await expect(store.deleteTask('task_nonexistent')).resolves.not.toThrow();
    });
  });

  describe('cleanupExpiredTasks', () => {
    it('should remove expired tasks', async () => {
      // Create tasks with different TTLs
      const shortTask = await store.createTask({ ttl: 1 });
      const longTask = await store.createTask({ ttl: 60000 });

      // Wait for short task to expire
      await waitFor(10);

      const cleaned = await store.cleanupExpiredTasks();

      expect(cleaned).toBe(1);

      const shortRetrieved = await store.getTask(shortTask.taskId);
      expect(shortRetrieved).toBeNull();

      const longRetrieved = await store.getTask(longTask.taskId);
      expect(longRetrieved).not.toBeNull();
    });

    it('should return count of cleaned tasks', async () => {
      // Create 3 short-lived tasks
      await store.createTask({ ttl: 1 });
      await store.createTask({ ttl: 1 });
      await store.createTask({ ttl: 1 });

      await waitFor(10);

      const cleaned = await store.cleanupExpiredTasks();
      expect(cleaned).toBe(3);
    });

    it('should delete results along with tasks', async () => {
      const task = await store.createTask({ ttl: 1 });
      await store.storeTaskResult(task.taskId, 'completed', {
        content: [{ type: 'text', text: 'Test' }],
        isError: false,
      });

      await waitFor(10);
      await store.cleanupExpiredTasks();

      const result = await store.getTaskResult(task.taskId);
      expect(result).toBeNull();
    });
  });

  describe('getTaskStats', () => {
    it('should return counts by status', async () => {
      // Create tasks with different statuses
      await store.createTask(); // working
      const task2 = await store.createTask();
      await store.updateTaskStatus(task2.taskId, 'completed');
      const task3 = await store.createTask();
      await store.updateTaskStatus(task3.taskId, 'failed');
      const task4 = await store.createTask();
      await store.updateTaskStatus(task4.taskId, 'cancelled');

      const stats = await store.getTaskStats();

      expect(stats.working).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.cancelled).toBe(1);
      expect(stats.input_required).toBe(0);
    });

    it('should return zero counts when no tasks', async () => {
      const stats = await store.getTaskStats();

      expect(stats.working).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.cancelled).toBe(0);
      expect(stats.input_required).toBe(0);
    });

    it('should not count expired tasks', async () => {
      // Create expired task with very short TTL
      const task = await store.createTask({ ttl: 50 });
      await store.updateTaskStatus(task.taskId, 'completed');

      // Wait significantly longer than TTL to ensure task has definitely expired
      await waitFor(200);

      const stats = await store.getTaskStats();
      expect(stats.completed).toBe(0);
    });
  });

  describe('automatic cleanup', () => {
    it('should run cleanup periodically', async () => {
      // Create store with fast cleanup (100ms)
      const fastStore = new InMemoryTaskStore(100);

      // Create expired task
      await fastStore.createTask({ ttl: 1 });

      // Wait for cleanup cycle
      await waitFor(150);

      const tasks = await fastStore.getAllTasks();
      expect(tasks).toHaveLength(0);

      fastStore.dispose();
    });

    it('should stop cleanup on dispose', async () => {
      const fastStore = new InMemoryTaskStore(50);
      await fastStore.createTask({ ttl: 1 });

      fastStore.dispose();

      // Cleanup should not run after dispose
      await waitFor(100);

      // Task count should be 0 because dispose clears all
      const tasks = await fastStore.getAllTasks();
      expect(tasks).toHaveLength(0);
    });
  });

  describe('dispose', () => {
    it('should clear all tasks and stop cleanup', async () => {
      await store.createTask();
      await store.createTask();

      store.dispose();

      const tasks = await store.getAllTasks();
      expect(tasks).toHaveLength(0);
    });

    it('should be safe to call multiple times', () => {
      expect(() => {
        store.dispose();
        store.dispose();
        store.dispose();
      }).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle many concurrent task creations', async () => {
      const promises = Array.from({ length: 100 }, () => store.createTask());
      const tasks = await Promise.all(promises);

      expect(tasks).toHaveLength(100);
      expect(new Set(tasks.map((t) => t.taskId)).size).toBe(100); // All unique
    });

    it('should handle very short TTL', async () => {
      const task = await store.createTask({ ttl: 1 });
      expect(task).toBeDefined();

      // Wait for task to expire
      await waitFor(10);

      // Should be expired now
      const retrieved = await store.getTask(task.taskId);
      expect(retrieved).toBeNull();
    });

    it('should handle status message with special characters', async () => {
      const task = await store.createTask();
      const message = 'Error: "Invalid" <data> & more\n\tSpecial\u0000chars';

      await store.updateTaskStatus(task.taskId, 'failed', message);

      const updated = await store.getTask(task.taskId);
      expect(updated?.statusMessage).toBe(message);
    });

    it('should handle large result data', async () => {
      const task = await store.createTask();
      const largeText = 'x'.repeat(100000); // 100KB text
      const result = {
        content: [{ type: 'text' as const, text: largeText }],
        isError: false,
      };

      await store.storeTaskResult(task.taskId, 'completed', result);
      const retrieved = await store.getTaskResult(task.taskId);

      const first = retrieved?.result.content[0];
      if (!first || first.type !== 'text') {
        throw new Error('Expected text result');
      }
      expect(first.text).toBe(largeText);
    });

    it('should ignore non-cancel status updates after cancellation', async () => {
      const task = await store.createTask();
      await store.cancelTask(task.taskId, 'User cancelled');

      await store.updateTaskStatus(task.taskId, 'working', 'Should be ignored');

      const retrieved = await store.getTask(task.taskId);
      expect(retrieved?.status).toBe('cancelled');
    });
  });
});
