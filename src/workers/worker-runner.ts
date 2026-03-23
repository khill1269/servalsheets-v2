/**
 * ServalSheets - Worker Thread Runner
 *
 * Generic worker thread entry point that dynamically loads
 * and executes worker scripts for different task types.
 *
 * @module workers/worker-runner
 */

import { parentPort, workerData } from 'worker_threads';
import { pathToFileURL } from 'url';
import { ConfigError, ValidationError } from '../core/errors.js';
import { assertAllowedWorkerScriptPath } from './allowed-worker-scripts.js';

interface WorkerMessage {
  taskId: string;
  taskType: string;
  scriptPath: string;
  data: unknown;
}

if (!parentPort) {
  throw new ConfigError('Must run as worker thread', 'WORKER_MODE');
}

const workerId = workerData?.workerId ?? 'unknown';

// Listen for tasks from main thread
parentPort.on('message', async (message: WorkerMessage) => {
  const { taskId, taskType: _taskType, scriptPath, data } = message;

  try {
    // Defense-in-depth: reject path traversal and enforce basename allowlist
    assertAllowedWorkerScriptPath(scriptPath);

    // Dynamically import worker script
    const scriptUrl = pathToFileURL(scriptPath).href;
    const workerModule = await import(scriptUrl);

    if (typeof workerModule.execute !== 'function') {
      throw new ValidationError(
        'Worker script must export execute function',
        'scriptPath',
        undefined,
        { value: scriptPath }
      );
    }

    // Execute task
    const result = await workerModule.execute(data);

    // Send success result
    parentPort!.postMessage({
      taskId,
      success: true,
      result,
    });
  } catch (error) {
    // Send error result
    parentPort!.postMessage({
      taskId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  process.stderr.write(`Worker ${workerId} uncaught exception: ${error}\n`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`Worker ${workerId} unhandled rejection: ${reason}\n`);
  process.exit(1);
});
