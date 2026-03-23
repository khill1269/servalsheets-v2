const ALLOWED_WORKER_SCRIPT_BASENAMES = new Set(['analysis-worker.js', 'formula-parser-worker.js']);

export function assertAllowedWorkerScriptPath(scriptPath: string): void {
  const basename = scriptPath.replace(/\\/g, '/').split('/').at(-1) ?? '';
  if (scriptPath.includes('..') || !ALLOWED_WORKER_SCRIPT_BASENAMES.has(basename)) {
    throw new Error(`Worker script not on allowlist: ${scriptPath}`);
  }
}
