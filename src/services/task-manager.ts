/**
 * TaskManager
 *
 * @purpose Manages async task lifecycle with progress tracking, cancellation, cleanup; higher-level abstraction over MCP task store (SEP-1686)
 * @category Infrastructure
 * @usage Use for long-running operations (bulk updates, analysis); tracks progress, allows cancellation, automatic cleanup after completion
 * @dependencies logger
 * @stateful Yes - maintains active tasks map (taskId → state), progress updates, completion timestamps
 * @singleton Yes - one instance per process to coordinate task lifecycle globally
 *
 * @example
 * const taskMgr = new TaskManager();
 * const taskId = await taskMgr.create({ name: 'Bulk Update', totalSteps: 100 });
 * await taskMgr.updateProgress(taskId, 50, 'Processed 50 rows');
 * await taskMgr.complete(taskId, { updated: 100 });
 * // Auto-cleanup after 1 hour
 */

import { logger as baseLogger } from '../utils/logger.js';
import { NotFoundError, ServiceError } from '../core/errors.js';

/**
 * Task status states
 */
export type ManagedTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Task metadata provided when registering a task
 */
export interface TaskMetadata {
  /** Operation name (e.g., 'spreadsheets.update') */
  operation: string;
  /** Spreadsheet ID if applicable */
  spreadsheetId?: string;
  /** Task start time */
  startTime: number;
  /** Additional metadata */
  [key: string]: unknown;
}

/**
 * Task information managed by TaskManager
 */
export interface ManagedTaskInfo {
  /** Unique task identifier */
  taskId: string;
  /** Current status */
  status: ManagedTaskStatus;
  /** Progress percentage (0-100) */
  progress?: number;
  /** Human-readable progress message */
  progressMessage?: string;
  /** Task result when completed */
  result?: unknown;
  /** Error message when failed */
  error?: string;
  /** Task metadata */
  metadata: TaskMetadata;
  /** Start timestamp */
  startTime: number;
  /** End timestamp (when terminal state reached) */
  endTime?: number;
}

/**
 * Internal task representation
 */
interface Task extends ManagedTaskInfo {
  /** Last update timestamp */
  lastUpdated: number;
}

/**
 * Task manager options
 */
export interface TaskManagerOptions {
  /** How long to keep completed tasks (ms). Default: 1 hour */
  taskTTL?: number;
  /** Maximum concurrent tasks. Default: 100 */
  maxTasks?: number;
  /** Cleanup interval (ms). Default: 60 seconds */
  cleanupIntervalMs?: number;
}

/**
 * TaskManager - Manages async task lifecycle for MCP operations
 *
 * Features:
 * - Task registration and lifecycle tracking
 * - Progress updates with percentage and messages
 * - Task cancellation support
 * - Automatic cleanup of old completed tasks
 * - Concurrent task limit enforcement
 *
 * Usage:
 * ```typescript
 * const taskManager = new TaskManager({ taskTTL: 3600000, maxTasks: 100 });
 *
 * // Register task
 * const taskId = 'task-123';
 * taskManager.registerTask(taskId, {
 *   operation: 'spreadsheets.batchUpdate',
 *   spreadsheetId: 'abc123',
 *   startTime: Date.now(),
 * });
 *
 * // Update progress
 * taskManager.updateTaskProgress(taskId, 50, 'Processing rows...');
 *
 * // Complete task
 * taskManager.completeTask(taskId, { updatedCells: 100 });
 *
 * // Cleanup
 * taskManager.destroy();
 * ```
 */
export class TaskManager {
  private tasks: Map<string, Task>;
  private cleanupInterval: NodeJS.Timeout | null;
  private options: Required<TaskManagerOptions>;

  constructor(options: TaskManagerOptions = {}) {
    this.tasks = new Map();
    this.cleanupInterval = null;

    // Set defaults
    this.options = {
      taskTTL: options.taskTTL ?? 3600000, // 1 hour
      maxTasks: options.maxTasks ?? 100,
      cleanupIntervalMs: options.cleanupIntervalMs ?? 60000, // 60 seconds
    };

    baseLogger.debug('TaskManager initialized', {
      taskTTL: this.options.taskTTL,
      maxTasks: this.options.maxTasks,
    });
  }

  /**
   * Register a new task
   *
   * @param taskId - Unique task identifier
   * @param metadata - Task metadata
   * @throws Error if max tasks limit reached
   */
  registerTask(taskId: string, metadata: TaskMetadata): void {
    // Check if task already exists
    if (this.tasks.has(taskId)) {
      baseLogger.warn('Task already exists, overwriting', { taskId });
    }

    // Enforce max tasks limit (only count active tasks)
    const activeTasks = Array.from(this.tasks.values()).filter(
      (task) => task.status === 'pending' || task.status === 'running'
    );

    if (activeTasks.length >= this.options.maxTasks) {
      throw new ServiceError(
        `Maximum concurrent tasks reached (${this.options.maxTasks}). Please wait for existing tasks to complete or increase the limit.`,
        'QUOTA_EXCEEDED',
        'TaskManager',
        true,
        { maxTasks: this.options.maxTasks, activeTasks: activeTasks.length }
      );
    }

    const now = Date.now();
    const task: Task = {
      taskId,
      status: 'pending',
      metadata,
      startTime: metadata.startTime,
      lastUpdated: now,
    };

    this.tasks.set(taskId, task);

    baseLogger.debug('Task registered', {
      taskId,
      operation: metadata.operation,
      spreadsheetId: metadata.spreadsheetId,
    });
  }

  /**
   * Update task progress
   *
   * Automatically transitions task from 'pending' to 'running' if needed.
   *
   * @param taskId - Task identifier
   * @param progress - Progress percentage (0-100)
   * @param progressMessage - Optional human-readable status message
   * @throws Error if task not found
   */
  updateTaskProgress(taskId: string, progress: number, progressMessage?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new NotFoundError('task', taskId);
    }

    // Validate progress range
    if (progress < 0 || progress > 100) {
      baseLogger.warn('Invalid progress value, clamping', { taskId, progress });
      progress = Math.max(0, Math.min(100, progress));
    }

    // Auto-transition from pending to running
    if (task.status === 'pending') {
      task.status = 'running';
    }

    task.progress = progress;
    task.progressMessage = progressMessage;
    task.lastUpdated = Date.now();

    this.tasks.set(taskId, task);

    baseLogger.debug('Task progress updated', {
      taskId,
      progress,
      message: progressMessage,
    });
  }

  /**
   * Mark task as complete
   *
   * @param taskId - Task identifier
   * @param result - Optional result data
   * @throws Error if task not found
   */
  completeTask(taskId: string, result?: unknown): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new NotFoundError('task', taskId);
    }

    const now = Date.now();
    task.status = 'completed';
    task.result = result;
    task.progress = 100;
    task.endTime = now;
    task.lastUpdated = now;

    this.tasks.set(taskId, task);

    const duration = now - task.startTime;
    baseLogger.info('Task completed', {
      taskId,
      operation: task.metadata.operation,
      duration,
    });
  }

  /**
   * Mark task as failed
   *
   * @param taskId - Task identifier
   * @param error - Error object or message
   * @throws Error if task not found
   */
  failTask(taskId: string, error: Error | string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new NotFoundError('task', taskId);
    }

    const now = Date.now();
    const errorMessage = error instanceof Error ? error.message : error;

    task.status = 'failed';
    task.error = errorMessage;
    task.endTime = now;
    task.lastUpdated = now;

    this.tasks.set(taskId, task);

    const duration = now - task.startTime;
    baseLogger.error('Task failed', {
      taskId,
      operation: task.metadata.operation,
      error: errorMessage,
      duration,
    });
  }

  /**
   * Cancel a task
   *
   * Can only cancel pending or running tasks.
   * Returns true if cancelled, false if already in terminal state.
   *
   * @param taskId - Task identifier
   * @returns true if task was cancelled, false if already completed/failed
   * @throws Error if task not found
   */
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new NotFoundError('task', taskId);
    }

    // Cannot cancel already finished tasks
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      baseLogger.debug('Cannot cancel task in terminal state', {
        taskId,
        status: task.status,
      });
      return false;
    }

    const now = Date.now();
    task.status = 'cancelled';
    task.endTime = now;
    task.lastUpdated = now;

    this.tasks.set(taskId, task);

    const duration = now - task.startTime;
    baseLogger.info('Task cancelled', {
      taskId,
      operation: task.metadata.operation,
      duration,
    });

    return true;
  }

  /**
   * Get task status
   *
   * @param taskId - Task identifier
   * @returns Task status or undefined if not found
   */
  getTaskStatus(taskId: string): ManagedTaskInfo | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      // OK: Explicit empty - typed as optional, task not found
      return undefined;
    }

    // Return a copy to prevent external mutations
    return {
      taskId: task.taskId,
      status: task.status,
      progress: task.progress,
      progressMessage: task.progressMessage,
      result: task.result,
      error: task.error,
      metadata: { ...task.metadata },
      startTime: task.startTime,
      endTime: task.endTime,
    };
  }

  /**
   * List all active tasks
   *
   * Returns tasks that are pending or running (not in terminal state).
   *
   * @returns Array of active task statuses
   */
  listActiveTasks(): ManagedTaskInfo[] {
    const activeTasks: ManagedTaskInfo[] = [];

    for (const task of this.tasks.values()) {
      if (task.status === 'pending' || task.status === 'running') {
        activeTasks.push({
          taskId: task.taskId,
          status: task.status,
          progress: task.progress,
          progressMessage: task.progressMessage,
          result: task.result,
          error: task.error,
          metadata: { ...task.metadata },
          startTime: task.startTime,
          endTime: task.endTime,
        });
      }
    }

    return activeTasks;
  }

  /**
   * Get all tasks (including completed/failed)
   *
   * @returns Array of all task statuses
   */
  getAllTasks(): ManagedTaskInfo[] {
    const allTasks: ManagedTaskInfo[] = [];

    for (const task of this.tasks.values()) {
      allTasks.push({
        taskId: task.taskId,
        status: task.status,
        progress: task.progress,
        progressMessage: task.progressMessage,
        result: task.result,
        error: task.error,
        metadata: { ...task.metadata },
        startTime: task.startTime,
        endTime: task.endTime,
      });
    }

    return allTasks;
  }

  /**
   * Cleanup completed tasks older than TTL
   *
   * Removes tasks in terminal states (completed/failed/cancelled) that have
   * exceeded the configured TTL since their end time.
   *
   * @returns Number of tasks cleaned up
   */
  private cleanupCompletedTasks(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [taskId, task] of this.tasks.entries()) {
      // Only cleanup terminal state tasks
      const isTerminal =
        task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';

      if (isTerminal && task.endTime) {
        const age = now - task.endTime;
        if (age > this.options.taskTTL) {
          this.tasks.delete(taskId);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      baseLogger.debug('Cleaned up completed tasks', { count: cleaned });
    }

    return cleaned;
  }

  /**
   * Start automatic cleanup interval
   *
   * @param intervalMs - Cleanup interval in milliseconds (default: from options)
   */
  startCleanup(intervalMs?: number): void {
    if (this.cleanupInterval) {
      baseLogger.warn('Cleanup already running, stopping previous interval');
      this.stopCleanup();
    }

    const interval = intervalMs ?? this.options.cleanupIntervalMs;

    this.cleanupInterval = setInterval(() => {
      this.cleanupCompletedTasks();
    }, interval);

    baseLogger.info('Task cleanup started', { intervalMs: interval });
  }

  /**
   * Stop automatic cleanup interval
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      baseLogger.info('Task cleanup stopped');
    }
  }

  /**
   * Get task statistics
   *
   * @returns Statistics about tasks by status
   */
  getStatistics(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
  } {
    const stats = {
      total: this.tasks.size,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const task of this.tasks.values()) {
      stats[task.status]++;
    }

    return stats;
  }

  /**
   * Destroy task manager
   *
   * Stops cleanup interval and clears all tasks.
   */
  destroy(): void {
    this.stopCleanup();
    this.tasks.clear();
    baseLogger.info('TaskManager destroyed');
  }
}
