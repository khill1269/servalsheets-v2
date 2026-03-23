/**
 * Python Engine — Pyodide WASM bridge for server-side Python compute.
 *
 * Execution isolation policy:
 * - Every request runs in a fresh Worker thread with a fresh Pyodide runtime.
 * - No request shares Python globals or interpreter state with another request.
 * - Warmup uses the same worker path so startup preloading cannot diverge from
 *   the runtime execution path.
 *
 * Usage:
 *   const result = await runPythonSafe('1 + 1', {}, 10000);
 */

import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Non-blocking background preload — call from server startup to warm the
 * worker execution path before the first user request arrives.
 */
export function preloadPyodide(): void {
  void runPythonSafe('1 + 1', {}, 30000).catch((err: unknown) => {
    logger.warn('Pyodide preload failed — Python compute will be unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

// ============================================================================
// Safe execution
// ============================================================================

export interface PythonRunResult {
  output: string;
  result: unknown;
  executionMs: number;
}

/**
 * Run Python code in an isolated Worker thread with true timeout enforcement.
 *
 * Each call spawns a fresh Pyodide instance in a Worker thread, preventing
 * global state pollution and enabling true timeout via worker.terminate().
 *
 * @param code - Python source to execute
 * @param globals - Variables to inject into the Python namespace before execution
 * @param timeoutMs - Hard wall-clock timeout (default 60 s)
 */
export async function runPythonSafe(
  code: string,
  globals: Record<string, unknown> = {},
  timeoutMs = 60000
): Promise<PythonRunResult> {
  const workerPath = join(__dirname, 'python-worker.js');

  return new Promise<PythonRunResult>((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: { code, globals, timeoutMs },
    });

    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`Python execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    worker.on(
      'message',
      (msg: {
        success: boolean;
        output?: string;
        result?: unknown;
        executionMs?: number;
        error?: string;
      }) => {
        clearTimeout(timer);
        if (msg.success) {
          resolve({
            output: msg.output ?? '',
            result: msg.result,
            executionMs: msg.executionMs ?? 0,
          });
        } else {
          reject(new Error(msg.error ?? 'Python execution failed'));
        }
      }
    );

    worker.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
