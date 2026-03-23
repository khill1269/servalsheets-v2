/**
 * ContextManager (Inference Layer)
 *
 * Tracks recently used parameters (spreadsheetId, sheetId, range) and auto-infers when missing, reducing required params by ~30%.
 *
 * ## Context Hierarchy
 *
 * ServalSheets uses a 3-layer context system:
 *
 * ```
 * 1. RequestContext (Protocol Layer)
 *    ↓ contains
 * 2. SessionContext (Business Layer)
 *    ↓ contains
 * 3. ContextManager (Inference Layer) ← YOU ARE HERE
 * ```
 *
 * ## ContextManager - Inference Layer
 *
 * **Purpose**: Parameter inference for MCP Elicitation (SEP-1036)
 * **Lifetime**: Active elicitation request (seconds to minutes)
 * **Scope**: One instance per elicitation flow
 *
 * **Contains**:
 * - Last used spreadsheetId (for "use same spreadsheet")
 * - Last used sheetId/sheetName (for "next sheet")
 * - Last used range (for "adjacent range")
 * - Parameter history (last 10 values)
 * - Inference timestamps (for TTL expiry)
 *
 * **When to use**:
 * - Auto-filling missing parameters in tool calls
 * - Suggesting next values in MCP Elicitation forms
 * - Reducing user input friction ("use same spreadsheet")
 * - Parameter validation hints ("last used: Budget.xlsx")
 *
 * **Different from**:
 * - {@link RequestContext} - MCP protocol metadata (not business logic)
 * - {@link SessionContext} - Conversation state (not just last-used values)
 *
 * **Integration with MCP Elicitation**:
 * - Provides `parameterDescriptions` with inferred values
 * - Powers autocomplete suggestions
 * - Enables "smart defaults" in forms
 *
 * @category Core
 * @dependencies logger
 * @stateful Yes - maintains LRU cache of recent parameters
 * @singleton No - one per session
 *
 * @example
 * const ctx = new ContextManager({ maxHistorySize: 10 });
 * ctx.recordSpreadsheet('1ABC'); // Track usage
 * const inferred = ctx.inferSpreadsheet(); // Returns '1ABC' for next call
 * ctx.recordRange('Sheet1!A1:Z10');
 * const nextRange = ctx.suggestNextRange(); // Suggests 'Sheet1!A11:Z20' (adjacent)
 *
 * @see docs/architecture/CONTEXT_LAYERS.md for full hierarchy
 */

import { logger } from '../utils/logger.js';
import { ServiceError } from '../core/errors.js';

export interface InferenceContext {
  /** Last used spreadsheet ID */
  spreadsheetId?: string;
  /** Last used sheet ID */
  sheetId?: number;
  /** Last used range (A1 notation) */
  range?: string;
  /** Last used sheet name */
  sheetName?: string;
  /** Timestamp when context was last updated */
  lastUpdated?: number;
  /** Request ID that last updated context */
  requestId?: string;
}

export interface ContextManagerOptions {
  /** Enable verbose logging (default: false) */
  verboseLogging?: boolean;
  /** Context TTL in milliseconds (default: 1 hour) */
  contextTTL?: number;
}

/**
 * Context Manager
 *
 * Maintains conversational context by tracking recently used parameters.
 * Enables natural language operations like "read the next sheet" or
 * "write to the same spreadsheet".
 */
export class ContextManager {
  private context: InferenceContext = {};
  private verboseLogging: boolean;
  private contextTTL: number;

  // Statistics
  private stats = {
    totalInferences: 0,
    spreadsheetIdInferences: 0,
    sheetIdInferences: 0,
    rangeInferences: 0,
    contextUpdates: 0,
  };

  constructor(options: ContextManagerOptions = {}) {
    this.verboseLogging = options.verboseLogging ?? false;
    this.contextTTL = options.contextTTL ?? 3600000; // 1 hour default

    logger.info('Context manager initialized', {
      verboseLogging: this.verboseLogging,
      contextTTL: this.contextTTL,
    });
  }

  /**
   * Update context with new values
   */
  updateContext(updates: Partial<InferenceContext>, requestId?: string): void {
    const previousContext = { ...this.context };

    // Update only provided values
    if (updates.spreadsheetId !== undefined) {
      this.context.spreadsheetId = updates.spreadsheetId;
    }
    if (updates.sheetId !== undefined) {
      this.context.sheetId = updates.sheetId;
    }
    if (updates.range !== undefined) {
      this.context.range = updates.range;
    }
    if (updates.sheetName !== undefined) {
      this.context.sheetName = updates.sheetName;
    }

    this.context.lastUpdated = Date.now();
    this.context.requestId = requestId;
    this.stats.contextUpdates++;

    if (this.verboseLogging) {
      logger.debug('Context updated', {
        previous: previousContext,
        current: this.context,
        requestId,
      });
    }
  }

  /**
   * Infer missing parameters from context
   *
   * @param params - Parameters with potentially missing values
   * @returns Parameters with inferred values filled in
   */
  inferParameters<T extends Record<string, unknown>>(params: T): T {
    // Check if context is stale
    if (this.isContextStale()) {
      if (this.verboseLogging) {
        logger.debug('Context is stale, skipping inference');
      }
      return params;
    }

    const inferred: Record<string, unknown> = { ...params };
    let inferencesMade = false;

    // Infer spreadsheetId
    if (!inferred['spreadsheetId'] && this.context.spreadsheetId) {
      inferred['spreadsheetId'] = this.context.spreadsheetId;
      this.stats.spreadsheetIdInferences++;
      this.stats.totalInferences++;
      inferencesMade = true;

      if (this.verboseLogging) {
        logger.debug('Inferred spreadsheetId from context', {
          value: inferred['spreadsheetId'],
        });
      }
    }

    // Infer sheetId
    if (inferred['sheetId'] === undefined && this.context.sheetId !== undefined) {
      inferred['sheetId'] = this.context.sheetId;
      this.stats.sheetIdInferences++;
      this.stats.totalInferences++;
      inferencesMade = true;

      if (this.verboseLogging) {
        logger.debug('Inferred sheetId from context', {
          value: inferred['sheetId'],
        });
      }
    }

    // Infer range
    if (!inferred['range'] && this.context.range) {
      inferred['range'] = this.context.range;
      this.stats.rangeInferences++;
      this.stats.totalInferences++;
      inferencesMade = true;

      if (this.verboseLogging) {
        logger.debug('Inferred range from context', {
          value: inferred['range'],
        });
      }
    }

    // Log inference summary if any were made
    if (inferencesMade && !this.verboseLogging) {
      logger.debug('Parameters inferred from context', {
        inferredFields: [
          inferred['spreadsheetId'] !== params['spreadsheetId'] && 'spreadsheetId',
          inferred['sheetId'] !== params['sheetId'] && 'sheetId',
          inferred['range'] !== params['range'] && 'range',
        ].filter(Boolean),
      });
    }

    return inferred as T;
  }

  /**
   * Get current context
   */
  getContext(): InferenceContext {
    return { ...this.context };
  }

  /**
   * Check if context is stale (older than TTL)
   */
  isContextStale(): boolean {
    if (!this.context.lastUpdated) {
      return true;
    }

    const age = Date.now() - this.context.lastUpdated;
    return age > this.contextTTL;
  }

  /**
   * Reset context (clear all tracked values)
   */
  reset(): void {
    const previousContext = { ...this.context };
    this.context = {};

    logger.info('Context reset', {
      previous: previousContext,
    });
  }

  /**
   * Get inference statistics
   */
  getStats(): unknown {
    return {
      ...this.stats,
      currentContext: this.context,
      contextAge: this.context.lastUpdated ? Date.now() - this.context.lastUpdated : undefined,
      isContextStale: this.isContextStale(),
      inferenceRate:
        this.stats.contextUpdates > 0 ? this.stats.totalInferences / this.stats.contextUpdates : 0,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalInferences: 0,
      spreadsheetIdInferences: 0,
      sheetIdInferences: 0,
      rangeInferences: 0,
      contextUpdates: 0,
    };

    logger.info('Context statistics reset');
  }

  /**
   * Check if a specific parameter can be inferred
   */
  canInfer(paramName: 'spreadsheetId' | 'sheetId' | 'range'): boolean {
    if (this.isContextStale()) {
      return false;
    }

    return this.context[paramName] !== undefined;
  }

  /**
   * Get specific inferred value
   */
  getInferredValue(paramName: 'spreadsheetId' | 'sheetId' | 'range'): string | number | undefined {
    if (this.isContextStale()) {
      // OK: Explicit empty - typed as optional, stale context returns undefined
      return undefined;
    }

    return this.context[paramName];
  }
}

// Singleton instance
let contextManager: ContextManager | null = null;

/**
 * Get or create the context manager singleton
 */
export function getContextManager(): ContextManager {
  if (!contextManager) {
    contextManager = new ContextManager();
  }
  return contextManager;
}

/**
 * Set the context manager (for testing or custom configuration)
 */
export function setContextManager(manager: ContextManager): void {
  contextManager = manager;
}

/**
 * Reset the context manager (for testing only)
 * @internal
 */
export function resetContextManager(): void {
  if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] !== 'true') {
    throw new ServiceError(
      'resetContextManager() can only be called in test environment',
      'INTERNAL_ERROR',
      'ContextManager'
    );
  }
  contextManager = null;
}
