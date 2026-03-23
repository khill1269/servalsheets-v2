/**
 * ServalSheets - Tool Stage Manager
 *
 * Manages stage-based dynamic tool registration.
 *
 * When SERVAL_STAGED_REGISTRATION=true, tools are registered in 3 stages:
 * - Stage 1 (bootstrap): Auth, core, session, analyze, confirm — immediate
 * - Stage 2 (active): Data, format, dimensions, history, quality, fix — after spreadsheet active
 * - Stage 3 (full): All remaining tools — on demand
 *
 * When disabled (default), all tools are registered at once (backwards-compatible).
 *
 * Stage transitions emit notifications/tools/list_changed so the LLM discovers new tools.
 *
 * Design: Singleton class with explicit lifecycle (initialize → advance → advance).
 * No auto-advancement — callers trigger stage changes via advanceToStage().
 */

// ToolAnnotations imported for type-only usage in future extensions
import { STAGED_REGISTRATION, getToolStage, type ToolStage } from '../../config/constants.js';
import { logger } from '../../utils/logger.js';
import { resourceNotifications } from '../../resources/notifications.js';
import type { ToolDefinition } from './tool-definitions.js';
import { clearDiscoveryHintCache } from './tool-discovery-hints.js';

// ============================================================================
// Types
// ============================================================================

export interface StageTransition {
  fromStage: ToolStage;
  toStage: ToolStage;
  newTools: string[];
  totalRegistered: number;
  timestamp: string;
}

export type ToolRegistrationCallback = (tools: readonly ToolDefinition[]) => void;

// ============================================================================
// Stage Manager
// ============================================================================

export class ToolStageManager {
  private _currentStage: ToolStage = 1;
  private _registeredTools: Set<string> = new Set();
  private _allDefinitions: readonly ToolDefinition[] = [];
  private _registrationCallback: ToolRegistrationCallback | null = null;
  private _transitions: StageTransition[] = [];
  private _enabled: boolean;

  constructor() {
    this._enabled = STAGED_REGISTRATION;
  }

  /**
   * Initialize the stage manager with all tool definitions and a registration callback.
   *
   * The callback is invoked with newly-available tools when a stage advances.
   * It should register them with the MCP server.
   *
   * @param definitions - All available tool definitions
   * @param registerCallback - Called with new tools to register on stage advance
   */
  initialize(
    definitions: readonly ToolDefinition[],
    registerCallback: ToolRegistrationCallback
  ): void {
    this._allDefinitions = definitions;
    this._registrationCallback = registerCallback;
    this._currentStage = 1;
    this._registeredTools.clear();
    this._transitions = [];
  }

  /**
   * Whether staged registration is enabled.
   * When false, all tools should be registered at once.
   */
  get enabled(): boolean {
    return this._enabled;
  }

  /**
   * Current stage (1, 2, or 3).
   */
  get currentStage(): ToolStage {
    return this._currentStage;
  }

  /**
   * Set of currently registered tool names.
   */
  get registeredTools(): ReadonlySet<string> {
    return this._registeredTools;
  }

  /**
   * History of stage transitions.
   */
  get transitions(): readonly StageTransition[] {
    return this._transitions;
  }

  /**
   * Get tool definitions for the initial registration.
   *
   * If staging is enabled, returns only Stage 1 tools.
   * If disabled, returns all tools (backwards-compatible).
   */
  getInitialTools(): readonly ToolDefinition[] {
    if (!this._enabled) {
      return this._allDefinitions;
    }
    return this._allDefinitions.filter((t) => getToolStage(t.name) === 1);
  }

  /**
   * Mark tools as registered (called after initial registration).
   */
  markRegistered(toolNames: readonly string[]): void {
    for (const name of toolNames) {
      this._registeredTools.add(name);
    }
  }

  /**
   * Advance to a target stage, registering all tools up to and including that stage.
   *
   * If already at or past the target stage, this is a no-op.
   * Emits notifications/tools/list_changed for each stage transition.
   *
   * @param targetStage - Stage to advance to (2 or 3)
   * @returns Tools that were newly registered, or empty array if no change
   */
  advanceToStage(targetStage: ToolStage): readonly ToolDefinition[] {
    if (!this._enabled) {
      return []; // Intent-based guard: staging disabled, no action needed
    }
    if (targetStage <= this._currentStage) {
      return []; // Intent-based guard: already at or past target stage
    }

    const newTools: ToolDefinition[] = [];

    // Register tools for each stage between current+1 and target
    for (let stage = (this._currentStage + 1) as ToolStage; stage <= targetStage; stage++) {
      const stageTools = this._allDefinitions.filter(
        (t) => getToolStage(t.name) === stage && !this._registeredTools.has(t.name)
      );

      if (stageTools.length > 0) {
        // Register via callback
        if (this._registrationCallback) {
          this._registrationCallback(stageTools);
        }

        // Track registration
        for (const tool of stageTools) {
          this._registeredTools.add(tool.name);
        }
        newTools.push(...stageTools);

        logger.info('Tool stage advanced', {
          stage,
          newTools: stageTools.map((t) => t.name),
          totalRegistered: this._registeredTools.size,
        });
      }
    }

    // Record transition
    const fromStage = this._currentStage;
    this._currentStage = targetStage;
    this._transitions.push({
      fromStage,
      toStage: targetStage,
      newTools: newTools.map((t) => t.name),
      totalRegistered: this._registeredTools.size,
      timestamp: new Date().toISOString(),
    });

    // Notify LLM of new tools
    if (newTools.length > 0) {
      clearDiscoveryHintCache();
      resourceNotifications.syncToolList([...this._registeredTools], {
        emitOnFirstSet: true,
        reason: `stage ${targetStage} tools registered: ${newTools.map((t) => t.name).join(', ')}`,
      });
    }

    return newTools;
  }

  /**
   * Check if a specific tool is registered.
   */
  isToolRegistered(toolName: string): boolean {
    if (!this._enabled) return true; // All tools registered when staging disabled
    return this._registeredTools.has(toolName);
  }

  /**
   * Get the stage needed to use a specific tool.
   * Returns null if the tool is already registered.
   */
  getRequiredStage(toolName: string): ToolStage | null {
    if (!this._enabled || this._registeredTools.has(toolName)) {
      return null; // Intent-based guard: tool available
    }
    return getToolStage(toolName);
  }

  /**
   * Ensure a tool is available by advancing stages if needed.
   * Returns true if the tool is now available, false if it was already available.
   */
  ensureToolAvailable(toolName: string): boolean {
    if (!this._enabled || this._registeredTools.has(toolName)) {
      return false; // Intent-based guard: already available
    }

    const requiredStage = getToolStage(toolName);
    if (requiredStage <= this._currentStage) {
      return false; // Intent-based guard: stage already active but tool not in definitions
    }

    this.advanceToStage(requiredStage);
    return true;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const toolStageManager = new ToolStageManager();
