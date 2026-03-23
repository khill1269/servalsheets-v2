import { STAGED_REGISTRATION } from '../config/constants.js';
import { ConfigError } from '../core/errors.js';
import { logger } from '../utils/logger.js';
import {
  ACTIVE_TOOL_DEFINITIONS,
  TOOL_DEFINITIONS,
  getLazyToolDefinitions,
} from './registration/tool-definitions.js';
import { TOOL_ACTIONS } from './completions.js';

export interface ToolCatalogDiagnostics {
  totalToolCount: number;
  activeToolCount: number;
  lazyToolCount: number;
  totalActionCount: number;
  configuredActionCount: number;
  stagedRegistration: boolean;
}

function countActions(toolNames: readonly string[]): number {
  return toolNames.reduce((sum, toolName) => sum + (TOOL_ACTIONS[toolName]?.length ?? 0), 0);
}

export function getConfiguredToolNames(): string[] {
  return ACTIVE_TOOL_DEFINITIONS.map((tool) => tool.name);
}

export function getConfiguredToolCount(): number {
  return getConfiguredToolNames().length;
}

export function getConfiguredActionCount(): number {
  return countActions(getConfiguredToolNames());
}

export function getToolCatalogDiagnostics(): ToolCatalogDiagnostics {
  const configuredToolNames = getConfiguredToolNames();
  const lazyToolNames = getLazyToolDefinitions().map((tool) => tool.name);

  return {
    totalToolCount: TOOL_DEFINITIONS.length,
    activeToolCount: configuredToolNames.length,
    lazyToolCount: lazyToolNames.length,
    totalActionCount: countActions(TOOL_DEFINITIONS.map((tool) => tool.name)),
    configuredActionCount: countActions(configuredToolNames),
    stagedRegistration: STAGED_REGISTRATION,
  };
}

export function validateToolCatalogConfiguration(): ToolCatalogDiagnostics {
  const diagnostics = getToolCatalogDiagnostics();
  const hasLazyLoadedTools = diagnostics.lazyToolCount > 0;
  const countsMatch =
    diagnostics.totalToolCount === diagnostics.activeToolCount &&
    diagnostics.totalActionCount === diagnostics.configuredActionCount;

  if (!countsMatch && !diagnostics.stagedRegistration && !hasLazyLoadedTools) {
    throw new ConfigError(
      `Tool catalog mismatch: ${diagnostics.activeToolCount}/${diagnostics.totalToolCount} tools and ` +
        `${diagnostics.configuredActionCount}/${diagnostics.totalActionCount} actions are configured ` +
        'without staged registration or lazy loading enabled.',
      'TOOL_CATALOG'
    );
  }

  if (!countsMatch || diagnostics.stagedRegistration) {
    logger.info('Tool catalog configuration resolved', diagnostics);
  }

  return diagnostics;
}
