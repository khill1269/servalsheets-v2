/**
 * ServalSheets - Worker Thread Pool
 *
 * Offloads CPU-intensive operations to worker threads to:
 * - Prevent event loop blocking
 * - Improve responsiveness
 * - Increase CPU utilization
 *
 * Target operations:
 * - Formula parsing (regex-heavy)
 * - Formula dependency analysis (graph traversal)
 * - Data compression (gzip/brotli)
 * - Large dataset analysis
 *
 * @module services/worker-pool
 */

import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { cpus } from 'os';
import { logger } from '../utils/logger.js';
import { ServiceError, ValidationError } from '../core/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Worker task with unique ID
 */
interface WorkerTask<T = unknown, R = unknown> {
  id: string;
  type: string;
  data: T;
  resolve: (value: R) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
}

/**
 * Worker thread wrapper
 */
interface WorkerThread {
  worker: Worker;
  busy: boolean;
  taskCount: number;
  errors: number;
  lastUsed: number;
}

/**
 * Worker pool configuration
 */
export interface WorkerPoolOptions {
  /** Number of workers (default: CPU count - 1, min 1) */
  poolSize?: number;
  /** Task timeout in milliseconds (default: 30000) */
  taskTimeout?: number;
  /** Worker idle timeout before termination (default: 60000) */
  workerIdleTimeout?: number;
  /** Maximum tasks per worker before restart (default: 1000) */
  maxTasksPerWorker?: number;
}

/**
 * Worker thread pool for CPU-intensive operations
 *
 * Features:
 * - Round-robin task distribution
 * - Automatic worker restart on errors
 * - Task timeout protection
 * - Worker health monitoring
 * - Graceful shutdown
 *
 * @example
 * ```typescript
 * const pool = new WorkerPool({
 *   poolSize: 4,
 *   taskTimeout: 10000
 * });
 *
 * const result = await pool.execute('parse-formula', {
 *   formula: '=SUM(A1:B10)'
 * });
 *
 * await pool.shutdown();
 * ```
 */
export class WorkerPool extends EventEmitter {
  private workers: WorkerThread[] = [];
  private queue: Array<WorkerTask<unknown, unknown>> = [];
  private workerScripts = new Map<string, string>();
  private nextWorkerId = 0;
  private taskCounter = 0;
  private shutdownPromise: Promise<void> | null = null;

  private readonly poolSize: number;
  private readonly taskTimeout: number;
  private readonly workerIdleTimeout: number;
  private readonly maxTasksPerWorker: number;

  constructor(options: WorkerPoolOptions = {}) {
    super();

    // Use CPU count - 1, minimum 1, maximum 8
    const cpuCount = cpus().length;
    this.poolSize = Math.max(1, Math.min(options.poolSize ?? cpuCount - 1, 8));
    this.taskTimeout = options.taskTimeout ?? 30000;
    this.workerIdleTimeout = options.workerIdleTimeout ?? 60000;
    this.maxTasksPerWorker = options.maxTasksPerWorker ?? 1000;

    logger.info('Worker pool initialized', {
      poolSize: this.poolSize,
      taskTimeout: this.taskTimeout,
      workerIdleTimeout: this.workerIdleTimeout,
    });
  }

  /**
   * Register a worker script for a task type
   *
   * @param taskType - Task type identifier
   * @param scriptPath - Absolute path to worker script
   */
  registerWorker(taskType: string, scriptPath: string): void {
    this.workerScripts.set(taskType, scriptPath);
    logger.debug('Worker script registered', { taskType, scriptPath });
  }

  /**
   * Execute a task on a worker thread
   *
   * @param taskType - Task type (must be registered)
   * @param data - Task input data
   * @returns Promise resolving to task result
   */
  async execute<T, R>(taskType: string, data: T): Promise<R> {
    if (this.shutdownPromise) {
      throw new ServiceError('Worker pool is shutting down', 'INTERNAL_ERROR', 'WorkerPool');
    }

    const scriptPath = this.workerScripts.get(taskType);
    if (!scriptPath) {
      throw new ValidationError(`No worker registered for task type: ${taskType}`, 'taskType');
    }

    return new Promise<R>((resolve, reject) => {
      const taskId = `${taskType}-${++this.taskCounter}`;
      const task: WorkerTask<T, R> = {
        id: taskId,
        type: taskType,
        data,
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      // Set timeout
      task.timeout = setTimeout(() => {
        this.handleTaskTimeout(task);
      }, this.taskTimeout);

      // Try to assign to available worker
      const worker = this.getAvailableWorker();
      if (worker) {
        this.assignTask(worker, task, scriptPath);
      } else {
        // Queue task if all workers busy
        this.queue.push(task as unknown as WorkerTask<unknown, unknown>);
        logger.debug('Task queued - all workers busy', {
          taskId,
          taskType,
          queueSize: this.queue.length,
        });
      }
    });
  }

  /**
   * Get an available worker or create one if pool not full
   */
  private getAvailableWorker(): WorkerThread | null {
    // Find idle worker
    const idleWorker = this.workers.find((w) => !w.busy);
    if (idleWorker) {
      return idleWorker;
    }

    // Create new worker if pool not full
    if (this.workers.length < this.poolSize) {
      return this.createWorker();
    }

    return null;
  }

  /**
   * Create a new worker thread
   */
  private createWorker(): WorkerThread {
    const workerId = this.nextWorkerId++;
    const worker = new Worker(resolve(__dirname, '../workers/worker-runner.js'), {
      workerData: { workerId },
    });

    const workerThread: WorkerThread = {
      worker,
      busy: false,
      taskCount: 0,
      errors: 0,
      lastUsed: Date.now(),
    };

    // Handle worker messages
    worker.on('message', (message) => {
      this.handleWorkerMessage(workerThread, message);
    });

    // Handle worker errors
    worker.on('error', (error: unknown) => {
      this.handleWorkerError(workerThread, error as Error);
    });

    // Handle worker exit
    worker.on('exit', (code) => {
      this.handleWorkerExit(workerThread, code);
    });

    this.workers.push(workerThread);

    logger.debug('Worker created', {
      workerId,
      totalWorkers: this.workers.length,
    });

    return workerThread;
  }

  /**
   * Assign a task to a worker
   */
  private assignTask<T, R>(
    workerThread: WorkerThread,
    task: WorkerTask<T, R>,
    scriptPath: string
  ): void {
    workerThread.busy = true;
    workerThread.taskCount++;
    workerThread.lastUsed = Date.now();

    // Send task to worker
    workerThread.worker.postMessage({
      taskId: task.id,
      taskType: task.type,
      scriptPath,
      data: task.data,
    });

    // Store task reference for response matching
    (workerThread.worker as Worker & { currentTask?: WorkerTask<unknown, unknown> }).currentTask =
      task as unknown as WorkerTask<unknown, unknown>;

    logger.debug('Task assigned to worker', {
      taskId: task.id,
      taskType: task.type,
    });
  }

  /**
   * Handle message from worker
   */
  private handleWorkerMessage(
    workerThread: WorkerThread,
    message: { taskId: string; success: boolean; result?: unknown; error?: string }
  ): void {
    const task = (workerThread.worker as Worker & { currentTask?: WorkerTask<unknown, unknown> })
      .currentTask;

    if (!task) {
      logger.warn('Received message from worker without current task', message);
      return;
    }

    // Clear timeout
    if (task.timeout) {
      clearTimeout(task.timeout);
    }

    // Resolve or reject task
    if (message.success) {
      task.resolve(message.result);
    } else {
      task.reject(new Error(message.error || 'Worker task failed'));
    }

    // Clear current task
    delete (workerThread.worker as Worker & { currentTask?: WorkerTask<unknown, unknown> })
      .currentTask;

    // Mark worker as available
    workerThread.busy = false;

    // Process queued task if any
    const nextTask = this.queue.shift();
    if (nextTask) {
      const scriptPath = this.workerScripts.get(nextTask.type);
      if (scriptPath) {
        this.assignTask(workerThread, nextTask, scriptPath);
      }
    }

    // Check if worker should be restarted (too many tasks)
    if (workerThread.taskCount >= this.maxTasksPerWorker) {
      logger.info('Worker restart - max tasks reached', {
        taskCount: workerThread.taskCount,
        maxTasks: this.maxTasksPerWorker,
      });
      this.restartWorker(workerThread);
    }
  }

  /**
   * Handle worker error
   */
  private handleWorkerError(workerThread: WorkerThread, error: Error): void {
    logger.error('Worker error', { error: error.message });

    workerThread.errors++;

    const task = (workerThread.worker as Worker & { currentTask?: WorkerTask<unknown, unknown> })
      .currentTask;

    if (task) {
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      task.reject(error);
      delete (workerThread.worker as Worker & { currentTask?: WorkerTask<unknown, unknown> })
        .currentTask;
    }

    // Restart worker on error
    this.restartWorker(workerThread);
  }

  /**
   * Handle worker exit
   */
  private handleWorkerExit(workerThread: WorkerThread, code: number): void {
    logger.info('Worker exited', { code });

    const index = this.workers.indexOf(workerThread);
    if (index >= 0) {
      this.workers.splice(index, 1);
    }

    // Create replacement worker if not shutting down
    if (!this.shutdownPromise && this.workers.length < this.poolSize) {
      this.createWorker();
    }
  }

  /**
   * Restart a worker thread
   */
  private async restartWorker(workerThread: WorkerThread): Promise<void> {
    const index = this.workers.indexOf(workerThread);
    if (index >= 0) {
      this.workers.splice(index, 1);
    }

    await workerThread.worker.terminate();

    if (!this.shutdownPromise) {
      this.createWorker();
    }
  }

  /**
   * Handle task timeout
   */
  private handleTaskTimeout<T, R>(task: WorkerTask<T, R>): void {
    logger.warn('Task timeout', {
      taskId: task.id,
      taskType: task.type,
      timeout: this.taskTimeout,
    });

    task.reject(new Error(`Task timeout after ${this.taskTimeout}ms`));

    // Find and restart worker handling this task
    for (const workerThread of this.workers) {
      const currentTask = (
        workerThread.worker as Worker & { currentTask?: WorkerTask<unknown, unknown> }
      ).currentTask;
      if (currentTask?.id === task.id) {
        this.restartWorker(workerThread);
        break;
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    poolSize: number;
    activeWorkers: number;
    busyWorkers: number;
    queueSize: number;
    totalTasks: number;
    totalErrors: number;
  } {
    const busyWorkers = this.workers.filter((w) => w.busy).length;
    const totalTasks = this.workers.reduce((sum, w) => sum + w.taskCount, 0);
    const totalErrors = this.workers.reduce((sum, w) => sum + w.errors, 0);

    return {
      poolSize: this.poolSize,
      activeWorkers: this.workers.length,
      busyWorkers,
      queueSize: this.queue.length,
      totalTasks,
      totalErrors,
    };
  }

  /**
   * Gracefully shutdown worker pool
   *
   * Waits for active tasks to complete, then terminates all workers.
   */
  async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    logger.info('Worker pool shutdown initiated');

    this.shutdownPromise = (async () => {
      // Wait for all active tasks to complete
      const maxWait = 10000; // 10 seconds
      const startTime = Date.now();

      while (this.workers.some((w) => w.busy)) {
        if (Date.now() - startTime > maxWait) {
          logger.warn('Worker pool shutdown timeout - terminating busy workers');
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Terminate all workers
      await Promise.all(this.workers.map((w) => w.worker.terminate()));

      this.workers = [];
      this.queue = [];

      logger.info('Worker pool shutdown complete');
    })();

    return this.shutdownPromise;
  }
}

/**
 * Global worker pool instance
 */
let globalPool: WorkerPool | null = null;

/**
 * Get or create global worker pool
 */
export function getWorkerPool(options?: WorkerPoolOptions): WorkerPool {
  if (!globalPool) {
    globalPool = new WorkerPool(options);
  }
  return globalPool;
}

/**
 * Shutdown global worker pool
 */
export async function shutdownWorkerPool(): Promise<void> {
  if (globalPool) {
    await globalPool.shutdown();
    globalPool = null;
  }
}
