/**
 * ServalSheets - Task Store
 *
 * Implementation of MCP task-based execution (SEP-1686)
 * Supports: working → input_required → completed/failed/cancelled
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import type { RedisClientType } from 'redis';
import { logger } from '../utils/logger.js';
import { registerCleanup } from '../utils/resource-cleanup.js';
import { NotFoundError, ServiceError } from './errors.js';

export type TaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  taskId: string;
  status: TaskStatus;
  statusMessage?: string;
  createdAt: string; // ISO 8601
  lastUpdatedAt: string; // ISO 8601
  ttl: number; // milliseconds
  pollInterval?: number; // milliseconds
}

export interface TaskResult {
  result: CallToolResult;
  status: 'completed' | 'failed' | 'cancelled';
}

/**
 * Task store interface for MCP task system
 *
 * MCP Spec Reference: MCP 2025-11-25 Tasks (standard capability, origin: SEP-1686)
 * - Tasks have lifecycle: working → input_required → completed/failed/cancelled
 * - TTL determines retention after creation
 * - Poll interval suggests client polling frequency
 */
export interface TaskStore {
  createTask(options: { ttl?: number }): Promise<Task>;
  getTask(taskId: string): Promise<Task | null>;
  updateTaskStatus(taskId: string, status: TaskStatus, message?: string): Promise<void>;
  storeTaskResult(
    taskId: string,
    status: 'completed' | 'failed' | 'cancelled',
    result: CallToolResult
  ): Promise<void>;
  getTaskResult(taskId: string): Promise<TaskResult | null>;
  deleteTask(taskId: string): Promise<void>;
  cleanupExpiredTasks(): Promise<number>;
  getAllTasks(): Promise<Task[]>;

  /**
   * Cancel a running task
   * @param taskId - Task identifier
   * @param reason - Optional reason for cancellation
   */
  cancelTask(taskId: string, reason?: string): Promise<void>;

  /**
   * Check if task was cancelled
   * @param taskId - Task identifier
   * @returns true if task was cancelled
   */
  isTaskCancelled(taskId: string): Promise<boolean>;

  /**
   * Get cancellation reason if any
   * @param taskId - Task identifier
   * @returns Cancellation reason or null
   */
  getCancellationReason(taskId: string): Promise<string | null>;
}

function createCancelledTaskResult(message: string): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          response: {
            success: false,
            error: {
              code: 'TASK_CANCELLED',
              message,
              retryable: false,
            },
          },
        }),
      },
    ],
    structuredContent: {
      response: {
        success: false,
        error: {
          code: 'TASK_CANCELLED',
          message,
          retryable: false,
        },
      },
    },
  };
}

/**
 * In-memory task store implementation
 *
 * Suitable for:
 * - Single-process deployments
 * - Development/testing
 *
 * For multi-node production:
 * - Implement Redis-backed store
 * - Share task state across instances
 * - Enable horizontal scaling
 */
export class InMemoryTaskStore implements TaskStore {
  private tasks = new Map<string, Task>();
  private results = new Map<string, TaskResult>();
  private cancelledTasks = new Map<string, string>(); // taskId -> reason
  private cleanupInterval: NodeJS.Timeout;

  /** Callback invoked when a task is cancelled (for aborting running operations) */
  public onTaskCancelled?: (taskId: string, reason: string) => void;

  constructor(cleanupIntervalMs: number = 60000) {
    // Cleanup expired tasks periodically
    this.cleanupInterval = setInterval(() => {
      void this.cleanupExpiredTasks();
    }, cleanupIntervalMs);

    // Register cleanup to prevent memory leak
    registerCleanup(
      'InMemoryTaskStore',
      () => {
        clearInterval(this.cleanupInterval);
      },
      'task-cleanup-interval'
    );
  }

  /**
   * Create a new task
   *
   * @param options.ttl - Time to live in milliseconds (default: 1 hour)
   * @returns Task with unique ID and working status
   */
  async createTask(options: { ttl?: number } = {}): Promise<Task> {
    const taskId = `task_${randomUUID()}`;
    const now = new Date().toISOString();
    const ttl = options.ttl ?? 3600000; // Default 1 hour

    const task: Task = {
      taskId,
      status: 'working',
      createdAt: now,
      lastUpdatedAt: now,
      ttl,
      pollInterval: 5000, // Suggest 5 second polling
    };

    this.tasks.set(taskId, task);
    return task;
  }

  /**
   * Get task by ID
   *
   * @param taskId - Task identifier
   * @returns Task or null if not found/expired
   */
  async getTask(taskId: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    // Check if expired
    const expiresAt = new Date(task.createdAt).getTime() + task.ttl;
    if (Date.now() > expiresAt) {
      await this.deleteTask(taskId);
      return null;
    }

    return task;
  }

  /**
   * Update task status and message
   *
   * @param taskId - Task identifier
   * @param status - New status
   * @param message - Optional human-readable status message
   */
  async updateTaskStatus(taskId: string, status: TaskStatus, message?: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new NotFoundError('task', taskId);
    }

    if (status === 'cancelled') {
      const existingReason = this.cancelledTasks.get(taskId);
      this.cancelledTasks.set(
        taskId,
        message || existingReason || task.statusMessage || 'Task cancelled'
      );
    } else if (this.cancelledTasks.has(taskId)) {
      return;
    }

    task.status = status;
    task.statusMessage = message;
    task.lastUpdatedAt = new Date().toISOString();

    this.tasks.set(taskId, task);
  }

  /**
   * Store task result (terminal state)
   *
   * @param taskId - Task identifier
   * @param status - 'completed', 'failed', or 'cancelled'
   * @param result - Tool result to return to client
   */
  async storeTaskResult(
    taskId: string,
    status: 'completed' | 'failed' | 'cancelled',
    result: CallToolResult
  ): Promise<void> {
    const effectiveStatus = this.cancelledTasks.has(taskId) ? 'cancelled' : status;
    const existingResult = this.results.get(taskId);

    // Update task status to terminal state
    await this.updateTaskStatus(taskId, effectiveStatus);

    if (effectiveStatus === 'cancelled' && existingResult?.status === 'cancelled') {
      return;
    }

    // Store result
    this.results.set(taskId, { result, status: effectiveStatus });
  }

  /**
   * Get task result (blocks until terminal status)
   *
   * MCP Spec: tasks/result SHOULD block until terminal status
   * This implementation returns immediately if result exists, null otherwise
   *
   * For true blocking behavior, implement polling in the caller
   *
   * @param taskId - Task identifier
   * @returns Task result or null if not yet available
   */
  async getTaskResult(taskId: string): Promise<TaskResult | null> {
    const existingResult = this.results.get(taskId);
    if (existingResult) {
      return existingResult;
    }

    const cancellationReason = this.cancelledTasks.get(taskId);
    if (cancellationReason) {
      return {
        status: 'cancelled',
        result: createCancelledTaskResult(cancellationReason),
      };
    }

    return null;
  }

  /**
   * Delete task and its result
   *
   * @param taskId - Task identifier
   */
  async deleteTask(taskId: string): Promise<void> {
    this.tasks.delete(taskId);
    this.results.delete(taskId);
    this.cancelledTasks.delete(taskId);
  }

  /**
   * Clean up expired tasks
   *
   * Called automatically on interval, but can be called manually
   *
   * @returns Number of tasks cleaned up
   */
  async cleanupExpiredTasks(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [taskId, task] of this.tasks.entries()) {
      const expiresAt = new Date(task.createdAt).getTime() + task.ttl;
      if (now > expiresAt) {
        await this.deleteTask(taskId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Stop cleanup interval and clear all tasks
   */
  dispose(): void {
    clearInterval(this.cleanupInterval);
    this.tasks.clear();
    this.results.clear();
    this.cancelledTasks.clear();
  }

  /**
   * Get all active tasks (for debugging/monitoring)
   *
   * Returns tasks sorted by creation time (newest first)
   *
   * @returns Array of all non-expired tasks, sorted newest first
   */
  async getAllTasks(): Promise<Task[]> {
    const now = Date.now();
    const activeTasks: Task[] = [];

    for (const task of this.tasks.values()) {
      const expiresAt = new Date(task.createdAt).getTime() + task.ttl;
      if (now <= expiresAt) {
        activeTasks.push(task);
      }
    }

    // Sort by creation time, newest first
    activeTasks.sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      return timeB - timeA;
    });

    return activeTasks;
  }

  /**
   * Get task count by status (for monitoring)
   *
   * @returns Object with count per status
   */
  async getTaskStats(): Promise<Record<TaskStatus, number>> {
    await this.cleanupExpiredTasks();
    const stats: Record<TaskStatus, number> = {
      working: 0,
      input_required: 0,
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
   * Cancel a running task
   *
   * @param taskId - Task identifier
   * @param reason - Optional reason for cancellation
   */
  async cancelTask(taskId: string, reason?: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new NotFoundError('task', taskId);
    }

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Cannot cancel task: already in terminal status '${task.status}'`
      );
    }

    // Mark as cancelled
    this.cancelledTasks.set(taskId, reason || 'Cancelled by client');

    // Update task status
    await this.updateTaskStatus(taskId, 'cancelled');

    if (!this.results.has(taskId)) {
      this.results.set(taskId, {
        status: 'cancelled',
        result: createCancelledTaskResult(reason || 'Cancelled by client'),
      });
    }

    // Notify the server to abort the running operation
    this.onTaskCancelled?.(taskId, reason || 'Cancelled by client');

    logger.warn('Task cancelled', { taskId, reason: reason || 'no reason' });
  }

  /**
   * Check if task was cancelled
   *
   * @param taskId - Task identifier
   * @returns true if task was cancelled
   */
  async isTaskCancelled(taskId: string): Promise<boolean> {
    return this.cancelledTasks.has(taskId);
  }

  /**
   * Get cancellation reason if any
   *
   * @param taskId - Task identifier
   * @returns Cancellation reason or null
   */
  async getCancellationReason(taskId: string): Promise<string | null> {
    return this.cancelledTasks.get(taskId) || null;
  }
}

/**
 * Redis-backed task store for production use
 *
 * Features:
 * - Distributed task state across multiple instances
 * - Automatic TTL-based expiration
 * - Horizontal scaling support
 * - Persistent task history
 *
 * Implementation:
 * - Redis hashes for task metadata (tasks:{taskId})
 * - Redis strings for task results (task_results:{taskId})
 * - Redis TTL for automatic expiration
 * - Redis SCAN for efficient task listing
 */
export class RedisTaskStore implements TaskStore {
  private client: RedisClientType | null = null;
  private connected: boolean = false;
  private keyPrefix: string;

  constructor(
    private redisUrl: string,
    keyPrefix: string = 'servalsheets:task:'
  ) {
    this.keyPrefix = keyPrefix;
  }

  /**
   * Initialize Redis connection (lazy)
   * @throws Error if connection fails
   */
  private async ensureConnected(): Promise<RedisClientType> {
    if (this.connected && this.client) {
      return this.client;
    }

    try {
      // Dynamic import to make Redis optional
      // @ts-ignore - Redis is an optional peer dependency
      const { createClient } = await import('redis');

      this.client = createClient({
        url: this.redisUrl,
      });

      this.client.on('error', (err: Error) => {
        logger.error('Redis task store error', { error: err });
      });

      await this.client.connect();
      this.connected = true;
      logger.info('Redis task store connected');
      return this.client;
    } catch (error) {
      throw new ServiceError(
        `Failed to connect to Redis at ${this.redisUrl}. ` +
          `Make sure Redis is installed (npm install redis) and running. ` +
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        'INTERNAL_ERROR',
        'redis',
        true
      );
    }
  }

  private getTaskKey(taskId: string): string {
    return `${this.keyPrefix}${taskId}`;
  }

  private getResultKey(taskId: string): string {
    return `${this.keyPrefix}result:${taskId}`;
  }

  /**
   * Create a new task
   */
  async createTask(options: { ttl?: number } = {}): Promise<Task> {
    const client = await this.ensureConnected();

    const taskId = `task_${randomUUID()}`;
    const now = new Date().toISOString();
    const ttl = options.ttl ?? 3600000; // Default 1 hour

    const task: Task = {
      taskId,
      status: 'working',
      createdAt: now,
      lastUpdatedAt: now,
      ttl,
      pollInterval: 5000,
    };

    // Store as Redis hash
    const taskKey = this.getTaskKey(taskId);
    await client.hSet(taskKey, {
      taskId,
      status: task.status,
      createdAt: task.createdAt,
      lastUpdatedAt: task.lastUpdatedAt,
      ttl: task.ttl.toString(),
      pollInterval: task.pollInterval?.toString() ?? '5000',
    });

    // Set expiration (convert ms to seconds)
    const ttlSeconds = Math.ceil(ttl / 1000);
    await client.expire(taskKey, ttlSeconds);

    return task;
  }

  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<Task | null> {
    const client = await this.ensureConnected();

    const taskKey = this.getTaskKey(taskId);
    const taskData = await client.hGetAll(taskKey);

    if (!taskData || Object.keys(taskData).length === 0) {
      return null;
    }

    // Parse task data - Redis hash values can be undefined
    const taskIdValue = taskData['taskId'];
    const createdAtValue = taskData['createdAt'];
    const lastUpdatedAtValue = taskData['lastUpdatedAt'];
    const ttlValue = taskData['ttl'];

    if (!taskIdValue || !createdAtValue || !lastUpdatedAtValue || !ttlValue) {
      return null;
    }

    const task: Task = {
      taskId: taskIdValue,
      status: taskData['status'] as TaskStatus,
      statusMessage: taskData['statusMessage'],
      createdAt: createdAtValue,
      lastUpdatedAt: lastUpdatedAtValue,
      ttl: parseInt(ttlValue, 10),
      pollInterval: taskData['pollInterval'] ? parseInt(taskData['pollInterval'], 10) : undefined,
    };

    // Check if expired based on application TTL (handles sub-second TTLs)
    const expiresAt = new Date(task.createdAt).getTime() + task.ttl;
    if (Date.now() > expiresAt) {
      // Clean up the expired task
      await this.deleteTask(taskId);
      return null;
    }

    return task;
  }

  /**
   * Update task status and message
   */
  async updateTaskStatus(taskId: string, status: TaskStatus, message?: string): Promise<void> {
    const client = await this.ensureConnected();

    const taskKey = this.getTaskKey(taskId);

    // Check if task exists
    const exists = await client.exists(taskKey);
    if (!exists) {
      throw new NotFoundError('task', taskId);
    }

    const cancelKey = `${this.keyPrefix}cancelled:${taskId}`;
    const isCancelled = (await client.exists(cancelKey)) === 1;
    if (status === 'cancelled') {
      const ttl = await client.ttl(taskKey);
      const existingReason = await client.get(cancelKey);
      await client.set(
        cancelKey,
        message || existingReason || 'Task cancelled',
        ttl > 0 ? { EX: ttl } : undefined
      );
    } else if (isCancelled) {
      return;
    }

    const now = new Date().toISOString();
    const updates: Record<string, string> = {
      status,
      lastUpdatedAt: now,
    };

    if (message !== undefined) {
      updates['statusMessage'] = message;
    }

    await client.hSet(taskKey, updates);
  }

  /**
   * Store task result (terminal state)
   */
  async storeTaskResult(
    taskId: string,
    status: 'completed' | 'failed' | 'cancelled',
    result: CallToolResult
  ): Promise<void> {
    const client = await this.ensureConnected();
    const cancelKey = `${this.keyPrefix}cancelled:${taskId}`;
    const resultKey = this.getResultKey(taskId);
    const effectiveStatus = ((await client.exists(cancelKey)) === 1 ? 'cancelled' : status) as
      | 'completed'
      | 'failed'
      | 'cancelled';
    const existingResultData = await client.get(resultKey);

    // Update task status
    await this.updateTaskStatus(taskId, effectiveStatus);

    if (effectiveStatus === 'cancelled' && existingResultData) {
      try {
        const existingResult = JSON.parse(existingResultData) as TaskResult;
        if (existingResult.status === 'cancelled') {
          return;
        }
      } catch {
        // Overwrite malformed stored data with the new terminal result.
      }
    }

    // Store result as JSON
    const taskResult: TaskResult = { result, status: effectiveStatus };
    await client.set(resultKey, JSON.stringify(taskResult));

    // Set same expiration as task
    const taskKey = this.getTaskKey(taskId);
    const ttl = await client.ttl(taskKey);
    if (ttl > 0) {
      await client.expire(resultKey, ttl);
    }
  }

  /**
   * Get task result
   */
  async getTaskResult(taskId: string): Promise<TaskResult | null> {
    const client = await this.ensureConnected();

    const resultKey = this.getResultKey(taskId);
    const resultData = await client.get(resultKey);

    if (resultData) {
      try {
        return JSON.parse(resultData) as TaskResult;
      } catch (error) {
        logger.error('Failed to parse Redis task result', { error });
        return null;
      }
    }

    const cancellationReason = await this.getCancellationReason(taskId);
    if (cancellationReason) {
      return {
        status: 'cancelled',
        result: createCancelledTaskResult(cancellationReason),
      };
    }

    return null;
  }

  /**
   * Delete task and its result
   */
  async deleteTask(taskId: string): Promise<void> {
    const client = await this.ensureConnected();

    const taskKey = this.getTaskKey(taskId);
    const resultKey = this.getResultKey(taskId);
    const cancelKey = `${this.keyPrefix}cancelled:${taskId}`;

    await client.del([taskKey, resultKey, cancelKey]);
  }

  /**
   * Clean up expired tasks
   *
   * Note: Redis handles TTL automatically, but this provides
   * explicit cleanup for monitoring purposes
   */
  async cleanupExpiredTasks(): Promise<number> {
    const client = await this.ensureConnected();

    let cleaned = 0;
    let cursor = '0';

    // Use SCAN to iterate over task keys
    do {
      const result = await client.scan(cursor, {
        MATCH: `${this.keyPrefix}*`,
        COUNT: 100,
      });

      cursor = result.cursor;
      const keys = result.keys;

      for (const key of keys) {
        // Skip result keys
        if (key.includes(':result:')) continue;

        // Check if key still exists (may have been expired)
        const exists = await client.exists(key);
        if (!exists) {
          cleaned++;
        }
      }
    } while (cursor !== '0');

    return cleaned;
  }

  /**
   * Get all active tasks
   */
  async getAllTasks(): Promise<Task[]> {
    const client = await this.ensureConnected();

    const tasks: Task[] = [];
    const now = Date.now();
    let cursor = '0';

    // Use SCAN to iterate over task keys
    do {
      const result = await client.scan(cursor, {
        MATCH: `${this.keyPrefix}task_*`,
        COUNT: 100,
      });

      cursor = result.cursor;
      const keys = result.keys;

      for (const key of keys) {
        // Skip result keys
        if (key.includes(':result:')) continue;

        const taskData = await client.hGetAll(key);
        if (taskData && Object.keys(taskData).length > 0) {
          // Redis hash values can be undefined
          const taskIdValue = taskData['taskId'];
          const createdAtValue = taskData['createdAt'];
          const lastUpdatedAtValue = taskData['lastUpdatedAt'];
          const ttlValue = taskData['ttl'];

          if (!taskIdValue || !createdAtValue || !lastUpdatedAtValue || !ttlValue) {
            continue;
          }

          const task: Task = {
            taskId: taskIdValue,
            status: taskData['status'] as TaskStatus,
            statusMessage: taskData['statusMessage'],
            createdAt: createdAtValue,
            lastUpdatedAt: lastUpdatedAtValue,
            ttl: parseInt(ttlValue, 10),
            pollInterval: taskData['pollInterval']
              ? parseInt(taskData['pollInterval'], 10)
              : undefined,
          };

          // Check if expired based on application TTL (handles sub-second TTLs)
          const expiresAt = new Date(task.createdAt).getTime() + task.ttl;
          if (now <= expiresAt) {
            tasks.push(task);
          }
        }
      }
    } while (cursor !== '0');

    // Sort by creation time, newest first
    tasks.sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      return timeB - timeA;
    });

    return tasks;
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.connected && this.client) {
      await this.client.quit();
      this.connected = false;
    }
  }

  /**
   * Get task count by status (for monitoring)
   */
  async getTaskStats(): Promise<Record<TaskStatus, number>> {
    const tasks = await this.getAllTasks();

    const stats: Record<TaskStatus, number> = {
      working: 0,
      input_required: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const task of tasks) {
      stats[task.status]++;
    }

    return stats;
  }

  /**
   * Cancel a running task
   *
   * @param taskId - Task identifier
   * @param reason - Optional reason for cancellation
   */
  async cancelTask(taskId: string, reason?: string): Promise<void> {
    const client = await this.ensureConnected();

    const taskKey = this.getTaskKey(taskId);
    const resultKey = this.getResultKey(taskId);
    const task = await client.hGetAll(taskKey);

    if (!task || Object.keys(task).length === 0) {
      throw new NotFoundError('task', taskId);
    }

    const status = task['status'];
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Cannot cancel task: already in terminal status '${status}'`
      );
    }

    // Store cancellation reason
    const cancelKey = `${this.keyPrefix}cancelled:${taskId}`;
    const ttlValue = task['ttl'];
    const ttlSeconds = ttlValue ? Math.ceil(parseInt(ttlValue, 10) / 1000) : 3600;
    await client.set(cancelKey, reason || 'Cancelled by client', {
      EX: ttlSeconds,
    });

    // Update task status
    await this.updateTaskStatus(taskId, 'cancelled');

    const existingResult = await client.get(resultKey);
    if (!existingResult) {
      const taskResult: TaskResult = {
        status: 'cancelled',
        result: createCancelledTaskResult(reason || 'Cancelled by client'),
      };
      await client.set(resultKey, JSON.stringify(taskResult), {
        EX: ttlSeconds,
      });
    }

    logger.warn('Task cancelled', { taskId, reason: reason || 'no reason' });
  }

  /**
   * Check if task was cancelled
   *
   * @param taskId - Task identifier
   * @returns true if task was cancelled
   */
  async isTaskCancelled(taskId: string): Promise<boolean> {
    const client = await this.ensureConnected();

    const cancelKey = `${this.keyPrefix}cancelled:${taskId}`;
    const reason = await client.get(cancelKey);
    return reason !== null;
  }

  /**
   * Get cancellation reason if any
   *
   * @param taskId - Task identifier
   * @returns Cancellation reason or null
   */
  async getCancellationReason(taskId: string): Promise<string | null> {
    const client = await this.ensureConnected();

    const cancelKey = `${this.keyPrefix}cancelled:${taskId}`;
    return await client.get(cancelKey);
  }
}
