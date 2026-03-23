/**
 * Pipeline dispatch registry.
 *
 * A tiny singleton that decouples the pipeline executor from the tool-handler
 * map without creating circular imports between tool-handlers.ts ↔ session.ts.
 *
 * Flow:
 *   createToolHandlerMap()  →  registerPipelineDispatch(fn)     (synchronous)
 *   SessionHandler.handle() →  getPipelineDispatch()             (lazy, safe)
 */

import type { ToolDispatch } from './pipeline-executor.js';

let _dispatch: ToolDispatch | null = null;

/** Called once by createToolHandlerMap() after the handler map is built. */
export function registerPipelineDispatch(dispatch: ToolDispatch): void {
  _dispatch = dispatch;
}

/** Returns the registered dispatch function, or null if not yet registered. */
export function getPipelineDispatch(): ToolDispatch | null {
  return _dispatch;
}
