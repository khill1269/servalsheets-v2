/**
 * ServalSheets - Restart Policy Health Resource
 *
 * Exposes restart policy state for monitoring server stability and restart loops.
 * Provides visibility into consecutive failures, backoff delays, and restart timing.
 *
 * URI Pattern: health://restart
 *
 * @module resources/restart-health-resource
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getRestartState, formatBackoffDelay } from '../startup/restart-policy.js';
import { logger } from '../utils/logger.js';
import { createInvalidResourceUriError } from '../utils/mcp-errors.js';
import {
  restartConsecutiveFailuresGauge,
  restartBackoffDelaySeconds,
  restartUptimeSeconds,
} from '../observability/metrics.js';

// Restart policy configuration
const MIN_BACKOFF_MS = parseInt(process.env['MIN_RESTART_BACKOFF_MS'] || '1000', 10);
const MAX_BACKOFF_MS = parseInt(process.env['MAX_RESTART_BACKOFF_MS'] || '60000', 10);
const SUCCESS_THRESHOLD_MS = parseInt(process.env['SUCCESS_THRESHOLD_MS'] || '30000', 10);

/**
 * Calculate backoff delay (same formula as restart-policy.ts)
 */
function calculateBackoff(consecutiveFailures: number): number {
  if (consecutiveFailures === 0) {
    return 0;
  }
  const backoff = MIN_BACKOFF_MS * Math.pow(2, consecutiveFailures - 1);
  return Math.min(backoff, MAX_BACKOFF_MS);
}

/**
 * Get current restart policy state
 *
 * @returns JSON string with restart policy data
 */
export async function getRestartHealthData(): Promise<string> {
  const state = await getRestartState();
  const backoffDelayMs = calculateBackoff(state.consecutiveFailures);
  const now = Date.now();

  // Calculate uptime (time since last successful start)
  const uptimeSeconds = state.lastSuccessfulStart
    ? Math.floor((now - state.lastSuccessfulStart) / 1000)
    : 0;

  // Calculate total restarts (approximation based on consecutive failures)
  const totalRestarts = state.consecutiveFailures;

  // Determine health status
  const isHealthy = state.consecutiveFailures === 0;
  const isInBackoff = backoffDelayMs > 0 && now - state.lastStartAttempt < backoffDelayMs;

  // Update Prometheus metrics (Phase 0, Priority 4)
  restartConsecutiveFailuresGauge.set(state.consecutiveFailures);
  restartBackoffDelaySeconds.set(backoffDelayMs / 1000);
  restartUptimeSeconds.set(uptimeSeconds);

  const healthData = {
    $id: 'health://restart',
    title: 'Server Restart Policy Health',
    description: 'Restart policy state and backoff monitoring',
    timestamp: new Date().toISOString(),
    status: {
      isHealthy,
      isInBackoff,
      consecutiveFailures: state.consecutiveFailures,
    },
    timing: {
      lastStartAttemptTimestamp: state.lastStartAttempt
        ? new Date(state.lastStartAttempt).toISOString()
        : null,
      lastSuccessfulStartTimestamp: state.lastSuccessfulStart
        ? new Date(state.lastSuccessfulStart).toISOString()
        : null,
      uptimeSeconds,
      totalRestarts,
    },
    backoff: {
      currentDelayMs: backoffDelayMs,
      currentDelayFormatted: formatBackoffDelay(backoffDelayMs),
      nextRestartAllowedTimestamp: isInBackoff
        ? new Date(state.lastStartAttempt + backoffDelayMs).toISOString()
        : 'immediate',
    },
    policy: {
      baseDelayMs: MIN_BACKOFF_MS,
      maxDelayMs: MAX_BACKOFF_MS,
      successThresholdMs: SUCCESS_THRESHOLD_MS,
      formula: 'min(baseDelay * 2^(failures-1), maxDelay)',
      stateFile: '~/.servalsheets/restart-state.json',
    },
    interpretation: {
      healthy: 'No consecutive failures, normal operation',
      backoff: 'Exponential backoff active due to recent failures - preventing rapid restart loops',
      failures: 'Consecutive failures detected - server may be experiencing persistent issues',
    },
  };

  return JSON.stringify(healthData);
}

/**
 * Read restart policy health resource by URI
 *
 * @param uri - Resource URI (health://restart)
 * @returns Resource contents
 */
export async function readRestartHealthResource(
  uri: string
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  // Only accept exact URI match
  if (uri !== 'health://restart') {
    throw createInvalidResourceUriError(uri, 'health://restart');
  }

  const text = await getRestartHealthData();

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text,
      },
    ],
  };
}

/**
 * Register restart policy health resource with the MCP server
 *
 * Registers resource for restart policy monitoring:
 * - health://restart - Current restart policy state and backoff status
 *
 * Claude can read this resource to diagnose restart loops,
 * check server stability, and understand backoff timing.
 *
 * @param server - McpServer instance
 */
export function registerRestartHealthResource(server: McpServer): void {
  try {
    server.registerResource(
      'Restart Policy Health',
      'health://restart',
      {
        description:
          'Server restart policy state and backoff monitoring. Tracks consecutive failures, exponential backoff delays, and restart timing to prevent rapid restart loops.',
        mimeType: 'application/json',
      },
      async (uri) => readRestartHealthResource(typeof uri === 'string' ? uri : String(uri))
    );

    logger.info('Restart policy health resource registered', {
      component: 'resources/restart-health',
      uri: 'health://restart',
    });
  } catch (error) {
    logger.error('Failed to register restart policy health resource', {
      component: 'resources/restart-health',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
