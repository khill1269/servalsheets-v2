/**
 * TaskManager Tests
 *
 * Comprehensive test suite for task lifecycle management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskManager } from '../../src/services/task-manager';

describe('TaskManager', () => {
  let taskManager: TaskManager;

  beforeEach(() => {
    vi.useFakeTimers();
    taskManager = new TaskManager({
      taskTTL: 3600000, // 1 hour
      maxTasks: 100,
      cleanupIntervalMs: 60000,
    });
  });

  afterEach(() => {
    taskManager.destroy();
    vi.useRealTimers();
  });

  describe('Task Registration', () => {
    it('should register new task with pending status', () => {
      const taskId = 'task-123';
      const now = 1704067200000;

      taskManager.registerTask(taskId, {
        operation: 'spreadsheets.update',
        spreadsheetId: 'sheet-1',
        startTime: now,
      });

      const status = taskManager.getTaskStatus(taskId);
      expect(status).toBeDefined();
      expect(status?.status).toBe('pending');
      expect(status?.taskId).toBe(taskId);
      expect(status?.metadata.operation).toBe('spreadsheets.update');
      expect(status?.metadata.spreadsheetId).toBe('sheet-1');
      expect(status?.startTime).toBe(now);
    });

    it('should enforce max tasks limit', () => {
      const tm = new TaskManager({ maxTasks: 2 });

      tm.registerTask('task-1', { operation: 'op1', startTime: 1704067200000 });
      tm.registerTask('task-2', { operation: 'op2', startTime: 1704067200000 });

      expect(() => {
        tm.registerTask('task-3', { operation: 'op3', startTime: 1704067200000 });
      }).toThrow('Maximum concurrent tasks reached');

      tm.destroy();
    });

    it('should not count completed tasks toward max limit', () => {
      const tm = new TaskManager({ maxTasks: 2 });

      tm.registerTask('task-1', { operation: 'op1', startTime: 1704067200000 });
      tm.registerTask('task-2', { operation: 'op2', startTime: 1704067200000 });
      tm.completeTask('task-1');

      // Should succeed because task-1 is completed
      expect(() => {
        tm.registerTask('task-3', { operation: 'op3', startTime: 1704067200000 });
      }).not.toThrow();

      tm.destroy();
    });

    it('should overwrite existing task with warning', () => {
      const taskId = 'task-123';
      const now = 1704067200000;

      taskManager.registerTask(taskId, {
        operation: 'operation1',
        startTime: now,
      });

      // Register again with different operation
      taskManager.registerTask(taskId, {
        operation: 'operation2',
        startTime: now + 1000,
      });

      const status = taskManager.getTaskStatus(taskId);
      expect(status?.metadata.operation).toBe('operation2');
    });

    it('should store custom metadata fields', () => {
      const taskId = 'task-123';

      taskManager.registerTask(taskId, {
        operation: 'test',
        startTime: 1704067200000,
        customField: 'custom-value',
        userId: 'user-123',
      });

      const status = taskManager.getTaskStatus(taskId);
      expect(status?.metadata.customField).toBe('custom-value');
      expect(status?.metadata.userId).toBe('user-123');
    });
  });

  describe('Task Progress', () => {
    it('should update task progress', () => {
      const taskId = 'task-123';
      taskManager.registerTask(taskId, {
        operation: 'test',
        startTime: 1704067200000,
      });

      taskManager.updateTaskProgress(taskId, 50, 'Processing...');

      const status = taskManager.getTaskStatus(taskId);
      expect(status?.progress).toBe(50);
      expect(status?.progressMessage).toBe('Processing...');
    });

    it('should auto-transition from pending to running on progress update', () => {
      const taskId = 'task-123';
      taskManager.registerTask(taskId, {
        operation: 'test',
        startTime: 1704067200000,
      });

      expect(taskManager.getTaskStatus(taskId)?.status).toBe('pending');

      taskManager.updateTaskProgress(taskId, 10, 'Starting...');

      expect(taskManager.getTaskStatus(taskId)?.status).toBe('running');
    });

    it('should clamp progress to 0-100 range', () => {
      const taskId = 'task-123';
      taskManager.registerTask(taskId, {
        operation: 'test',
        startTime: 1704067200000,
      });

      taskManager.updateTaskProgress(taskId, -10);
      expect(taskManager.getTaskStatus(taskId)?.progress).toBe(0);

      taskManager.updateTaskProgress(taskId, 150);
      expect(taskManager.getTaskStatus(taskId)?.progress).toBe(100);
    });

    it('should throw error for non-existent task', () => {
      expect(() => {
        taskManager.updateTaskProgress('non-existent', 50);
      }).toThrow('task not found');
    });

    it('should update progress multiple times', () => {
      const taskId = 'task-123';
      taskManager.registerTask(taskId, {
        operation: 'test',
        startTime: 1704067200000,
      });

      taskManager.updateTaskProgress(taskId, 25, 'Step 1');
      expect(taskManager.getTaskStatus(taskId)?.progress).toBe(25);

      taskManager.updateTaskProgress(taskId, 50, 'Step 2');
      expect(taskManager.getTaskStatus(taskId)?.progress).toBe(50);

      taskManager.updateTaskProgress(taskId, 75, 'Step 3');
      expect(taskManager.getTaskStatus(taskId)?.progress).toBe(75);
    });
  });

  describe('Task Completion', () => {
    it('should mark task as complete', () => {
      const taskId = 'task-123';
      const startTime = 1704067200000;
      taskManager.registerTask(taskId, {
        operation: 'test',
        startTime,
      });

      vi.advanceTimersByTime(1000);
      taskManager.completeTask(taskId, { result: 'success' });

      const status = taskManager.getTaskStatus(taskId);
      expect(status?.status).toBe('completed');
      expect(status?.result).toEqual({ result: 'success' });
      expect(status?.endTime).toBeDefined();
      expect(status?.progress).toBe(100);
      expect(status?.endTime! - startTime).toBeGreaterThanOrEqual(1000);
    });

    it('should mark task as failed', () => {
      const taskId = 'task-123';
      taskManager.registerTask(taskId, {
        operation: 'test',
        startTime: 1704067200000,
      });

      const error = new Error('Task failed');
      taskManager.failTask(taskId, error);

      const status = taskManager.getTaskStatus(taskId);
      expect(status?.status).toBe('failed');
      expect(status?.error).toBe('Task failed');
      expect(status?.endTime).toBeDefined();
    });

    it('should handle string error in failTask', () => {
      const taskId = 'task-123';
      taskManager.registerTask(taskId, {
        operation: 'test',
        startTime: 1704067200000,
      });

      taskManager.failTask(taskId, 'Simple error message');

      const status = taskManager.getTaskStatus(taskId);
      expect(status?.status).toBe('failed');
      expect(status?.error).toBe('Simple error message');
    });

    it('should throw error when completing non-existent task', () => {
      expect(() => {
        taskManager.completeTask('non-existent');
      }).toThrow('task not found');
    });

    it('should throw error when failing non-existent task', () => {
      expect(() => {
        taskManager.failTask('non-existent', new Error('test'));
      }).toThrow('task not found');
    });

    it('should store result data on completion', () => {
      const taskId = 'task-123';
      taskManager.registerTask(taskId, {
        operation: 'test',
        startTime: 1704067200000,
      });

      const result = {
        updatedCells: 100,
        spreadsheetId: 'abc123',
        values: [[1, 2, 3]],
      };

      taskManager.completeTask(taskId, result);

      const status = taskManager.getTaskStatus(taskId);
      expect(status?.result).toEqual(result);
    });
  });

  describe('Task Cancellation', () => {
    it('should cancel pending task', () => {
      const taskId = 'task-123';
      taskManager.registerTask(taskId, {
        operation: 'test',
        startTime: 1704067200000,
      });

      const cancelled = taskManager.cancelTask(taskId);

      expect(cancelled).toBe(true);
      const status = taskManager.getTaskStatus(taskId);
      expect(status?.status).toBe('cancelled');
      expect(status?.endTime).toBeDefined();
    });

    it('should cancel running task', () => {
      const taskId = 'task-123';
      taskManager.registerTask(taskId, {
        operation: 'test',
        startTime: 1704067200000,
      });

      taskManager.updateTaskProgress(taskId, 50);
      expect(taskManager.getTaskStatus(taskId)?.status).toBe('running');

      const cancelled = taskManager.cancelTask(taskId);

      expect(cancelled).toBe(true);
      expect(taskManager.getTaskStatus(taskId)?.status).toBe('cancelled');
    });

    it('should not cancel completed task', () => {
      const taskId = 'task-123';
      taskManager.registerTask(taskId, {
        operation: 'test',
        startTime: 1704067200000,
      });
      taskManager.completeTask(taskId);

      const cancelled = taskManager.cancelTask(taskId);

      expect(cancelled).toBe(false);
      expect(taskManager.getTaskStatus(taskId)?.status).toBe('completed');
    });

    it('should not cancel failed task', () => {
      const taskId = 'task-123';
      taskManager.registerTask(taskId, {
        operation: 'test',
        startTime: 1704067200000,
      });
      taskManager.failTask(taskId, 'error');

      const cancelled = taskManager.cancelTask(taskId);

      expect(cancelled).toBe(false);
      expect(taskManager.getTaskStatus(taskId)?.status).toBe('failed');
    });

    it('should not cancel already cancelled task', () => {
      const taskId = 'task-123';
      taskManager.registerTask(taskId, {
        operation: 'test',
        startTime: 1704067200000,
      });

      taskManager.cancelTask(taskId);
      const cancelled = taskManager.cancelTask(taskId);

      expect(cancelled).toBe(false);
    });

    it('should throw error when cancelling non-existent task', () => {
      expect(() => {
        taskManager.cancelTask('non-existent');
      }).toThrow('task not found');
    });
  });

  describe('Task Listing', () => {
    it('should list all active tasks', () => {
      taskManager.registerTask('task-1', { operation: 'op1', startTime: 1704067200000 });
      taskManager.registerTask('task-2', { operation: 'op2', startTime: 1704067200000 });
      taskManager.registerTask('task-3', { operation: 'op3', startTime: 1704067200000 });
      taskManager.completeTask('task-3');

      const activeTasks = taskManager.listActiveTasks();

      expect(activeTasks).toHaveLength(2);
      expect(activeTasks.map((t) => t.taskId)).toContain('task-1');
      expect(activeTasks.map((t) => t.taskId)).toContain('task-2');
      expect(activeTasks.map((t) => t.taskId)).not.toContain('task-3');
    });

    it('should not include failed tasks in active list', () => {
      taskManager.registerTask('task-1', { operation: 'op1', startTime: 1704067200000 });
      taskManager.registerTask('task-2', { operation: 'op2', startTime: 1704067200000 });
      taskManager.failTask('task-2', 'error');

      const activeTasks = taskManager.listActiveTasks();

      expect(activeTasks).toHaveLength(1);
      expect(activeTasks[0].taskId).toBe('task-1');
    });

    it('should not include cancelled tasks in active list', () => {
      taskManager.registerTask('task-1', { operation: 'op1', startTime: 1704067200000 });
      taskManager.registerTask('task-2', { operation: 'op2', startTime: 1704067200000 });
      taskManager.cancelTask('task-2');

      const activeTasks = taskManager.listActiveTasks();

      expect(activeTasks).toHaveLength(1);
      expect(activeTasks[0].taskId).toBe('task-1');
    });

    it('should return empty array when no active tasks', () => {
      const activeTasks = taskManager.listActiveTasks();
      expect(activeTasks).toHaveLength(0);
    });

    it('should list all tasks including completed', () => {
      taskManager.registerTask('task-1', { operation: 'op1', startTime: 1704067200000 });
      taskManager.registerTask('task-2', { operation: 'op2', startTime: 1704067200000 });
      taskManager.registerTask('task-3', { operation: 'op3', startTime: 1704067200000 });
      taskManager.completeTask('task-3');

      const allTasks = taskManager.getAllTasks();

      expect(allTasks).toHaveLength(3);
      expect(allTasks.map((t) => t.taskId)).toContain('task-1');
      expect(allTasks.map((t) => t.taskId)).toContain('task-2');
      expect(allTasks.map((t) => t.taskId)).toContain('task-3');
    });
  });

  describe('Task Retrieval', () => {
    it('should get task status by ID', () => {
      const taskId = 'task-123';
      taskManager.registerTask(taskId, {
        operation: 'test',
        spreadsheetId: 'sheet-1',
        startTime: 1704067200000,
      });

      const status = taskManager.getTaskStatus(taskId);

      expect(status).toBeDefined();
      expect(status?.taskId).toBe(taskId);
      expect(status?.status).toBe('pending');
      expect(status?.metadata.operation).toBe('test');
      expect(status?.metadata.spreadsheetId).toBe('sheet-1');
    });

    it('should return undefined for non-existent task', () => {
      const status = taskManager.getTaskStatus('non-existent');
      expect(status).toBeUndefined();
    });

    it('should return immutable status copy', () => {
      const taskId = 'task-123';
      taskManager.registerTask(taskId, {
        operation: 'test',
        startTime: 1704067200000,
      });

      const status1 = taskManager.getTaskStatus(taskId);
      const status2 = taskManager.getTaskStatus(taskId);

      expect(status1).not.toBe(status2); // Different objects
      expect(status1).toEqual(status2); // Same content
    });
  });

  describe('Cleanup', () => {
    it('should cleanup old completed tasks', () => {
      const now = 1704067200000;
      vi.setSystemTime(now);

      const tm = new TaskManager({ taskTTL: 1000 }); // 1 second TTL

      tm.registerTask('task-1', { operation: 'op1', startTime: now });
      tm.completeTask('task-1');

      expect(tm.getTaskStatus('task-1')).toBeDefined();

      // Advance time past TTL
      vi.advanceTimersByTime(2000);
      tm['cleanupCompletedTasks'](); // Call private method for testing

      const status = tm.getTaskStatus('task-1');
      expect(status).toBeUndefined();

      tm.destroy();
    });

    it('should not cleanup active tasks', () => {
      const now = 1704067200000;
      vi.setSystemTime(now);

      const tm = new TaskManager({ taskTTL: 1000 });

      tm.registerTask('task-1', { operation: 'op1', startTime: now });

      // Advance time past TTL but task is still pending
      vi.advanceTimersByTime(2000);
      tm['cleanupCompletedTasks']();

      expect(tm.getTaskStatus('task-1')).toBeDefined();

      tm.destroy();
    });

    it('should cleanup multiple old tasks', () => {
      const now = 1704067200000;
      vi.setSystemTime(now);

      const tm = new TaskManager({ taskTTL: 1000 });

      tm.registerTask('task-1', { operation: 'op1', startTime: now });
      tm.registerTask('task-2', { operation: 'op2', startTime: now });
      tm.registerTask('task-3', { operation: 'op3', startTime: now });

      tm.completeTask('task-1');
      tm.failTask('task-2', 'error');
      tm.cancelTask('task-3');

      vi.advanceTimersByTime(2000);
      const cleaned = tm['cleanupCompletedTasks']();

      expect(cleaned).toBe(3);
      expect(tm.getAllTasks()).toHaveLength(0);

      tm.destroy();
    });

    it('should start and stop cleanup interval', () => {
      taskManager.startCleanup(1000);

      // Verify interval started
      expect(taskManager['cleanupInterval']).not.toBeNull();

      taskManager.stopCleanup();

      // Verify interval stopped
      expect(taskManager['cleanupInterval']).toBeNull();
    });

    it('should run cleanup automatically on interval', () => {
      const now = 1704067200000;
      vi.setSystemTime(now);

      const tm = new TaskManager({ taskTTL: 1000, cleanupIntervalMs: 5000 });

      tm.registerTask('task-1', { operation: 'op1', startTime: now });
      tm.completeTask('task-1');

      tm.startCleanup(5000);

      // Advance past task TTL
      vi.advanceTimersByTime(2000);

      // Task still exists (cleanup hasn't run)
      expect(tm.getTaskStatus('task-1')).toBeDefined();

      // Advance to cleanup interval
      vi.advanceTimersByTime(3000); // Total 5000ms

      // Task should be cleaned up
      expect(tm.getTaskStatus('task-1')).toBeUndefined();

      tm.destroy();
    });

    it('should handle restart of cleanup interval', () => {
      taskManager.startCleanup(1000);
      const interval1 = taskManager['cleanupInterval'];

      taskManager.startCleanup(2000);
      const interval2 = taskManager['cleanupInterval'];

      expect(interval1).not.toBe(interval2);
      expect(taskManager['cleanupInterval']).not.toBeNull();
    });
  });

  describe('Statistics', () => {
    it('should return task statistics', () => {
      taskManager.registerTask('task-1', { operation: 'op1', startTime: 1704067200000 });
      taskManager.registerTask('task-2', { operation: 'op2', startTime: 1704067200000 });
      taskManager.registerTask('task-3', { operation: 'op3', startTime: 1704067200000 });
      taskManager.registerTask('task-4', { operation: 'op4', startTime: 1704067200000 });
      taskManager.registerTask('task-5', { operation: 'op5', startTime: 1704067200000 });

      taskManager.updateTaskProgress('task-2', 50); // pending -> running
      taskManager.completeTask('task-3');
      taskManager.failTask('task-4', 'error');
      taskManager.cancelTask('task-5');

      const stats = taskManager.getStatistics();

      expect(stats.total).toBe(5);
      expect(stats.pending).toBe(1);
      expect(stats.running).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.cancelled).toBe(1);
    });

    it('should return zero statistics for empty manager', () => {
      const stats = taskManager.getStatistics();

      expect(stats.total).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.running).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.cancelled).toBe(0);
    });
  });

  describe('Destroy', () => {
    it('should stop cleanup and clear all tasks', () => {
      taskManager.registerTask('task-1', { operation: 'op1', startTime: 1704067200000 });
      taskManager.registerTask('task-2', { operation: 'op2', startTime: 1704067200000 });

      taskManager.startCleanup();

      expect(taskManager.getAllTasks()).toHaveLength(2);
      expect(taskManager['cleanupInterval']).not.toBeNull();

      taskManager.destroy();

      expect(taskManager.getAllTasks()).toHaveLength(0);
      expect(taskManager['cleanupInterval']).toBeNull();
    });

    it('should be idempotent', () => {
      taskManager.registerTask('task-1', { operation: 'op1', startTime: 1704067200000 });
      taskManager.startCleanup();

      taskManager.destroy();
      expect(() => taskManager.destroy()).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero TTL', () => {
      const now = 1704067200000;
      vi.setSystemTime(now);

      const tm = new TaskManager({ taskTTL: 0 });

      tm.registerTask('task-1', { operation: 'op1', startTime: now });
      tm.completeTask('task-1');

      // With zero TTL, any time elapsed means the task should be cleaned
      vi.advanceTimersByTime(1); // Advance 1ms
      const cleaned = tm['cleanupCompletedTasks']();
      expect(cleaned).toBe(1);

      tm.destroy();
    });

    it('should handle very large TTL', () => {
      const tm = new TaskManager({ taskTTL: Number.MAX_SAFE_INTEGER });

      tm.registerTask('task-1', { operation: 'op1', startTime: 1704067200000 });
      tm.completeTask('task-1');

      vi.advanceTimersByTime(1000000);
      const cleaned = tm['cleanupCompletedTasks']();

      expect(cleaned).toBe(0);
      expect(tm.getTaskStatus('task-1')).toBeDefined();

      tm.destroy();
    });

    it('should handle progress without message', () => {
      const taskId = 'task-123';
      taskManager.registerTask(taskId, {
        operation: 'test',
        startTime: 1704067200000,
      });

      taskManager.updateTaskProgress(taskId, 50);

      const status = taskManager.getTaskStatus(taskId);
      expect(status?.progress).toBe(50);
      expect(status?.progressMessage).toBeUndefined();
    });

    it('should handle completion without result', () => {
      const taskId = 'task-123';
      taskManager.registerTask(taskId, {
        operation: 'test',
        startTime: 1704067200000,
      });

      taskManager.completeTask(taskId);

      const status = taskManager.getTaskStatus(taskId);
      expect(status?.status).toBe('completed');
      expect(status?.result).toBeUndefined();
    });
  });
});
