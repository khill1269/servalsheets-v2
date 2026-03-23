/**
 * Resource Cleanup Registry - Phase 1: Memory Leak Detection
 *
 * Centralized registry for tracking and cleaning up resources (timers, connections, etc.)
 * to prevent memory leaks during server shutdown.
 *
 * Usage:
 * ```typescript
 * const intervalId = setInterval(() => { ... }, 1000);
 * registerCleanup('myService', () => clearInterval(intervalId));
 *
 * // On shutdown:
 * await cleanupAllResources();
 * ```
 */

import { logger as baseLogger } from './logger.js';

interface CleanupFunction {
  name: string;
  cleanup: () => void | Promise<void>;
  registeredAt: number;
}

/**
 * Global registry of cleanup functions
 */
const cleanupRegistry: Map<string, CleanupFunction[]> = new Map();

/**
 * Register a cleanup function for a service
 *
 * @param serviceName - Name of the service/component
 * @param cleanup - Function to call on cleanup
 * @param resourceName - Optional name for the resource (e.g., "cache-cleanup-interval")
 */
export function registerCleanup(
  serviceName: string,
  cleanup: () => void | Promise<void>,
  resourceName?: string
): void {
  const name = resourceName || 'anonymous';

  if (!cleanupRegistry.has(serviceName)) {
    cleanupRegistry.set(serviceName, []);
  }

  cleanupRegistry.get(serviceName)!.push({
    name,
    cleanup,
    registeredAt: Date.now(),
  });

  if (baseLogger?.debug) {
    baseLogger.debug('Resource cleanup registered', {
      service: serviceName,
      resource: name,
    });
  }
}

/**
 * Unregister all cleanup functions for a service
 *
 * @param serviceName - Name of the service/component
 */
export function unregisterCleanup(serviceName: string): void {
  cleanupRegistry.delete(serviceName);
  if (baseLogger?.debug) {
    baseLogger.debug('Resource cleanup unregistered', { service: serviceName });
  }
}

/**
 * Clean up all registered resources
 *
 * Calls all cleanup functions in reverse registration order (LIFO)
 * to ensure proper dependency cleanup.
 *
 * @returns Cleanup summary with success/failure counts
 */
export async function cleanupAllResources(): Promise<{
  total: number;
  successful: number;
  failed: number;
  errors: Array<{ service: string; resource: string; error: string }>;
}> {
  const startTime = Date.now();
  const errors: Array<{ service: string; resource: string; error: string }> = [];
  let total = 0;
  let successful = 0;

  if (baseLogger?.info) {
    baseLogger.info('Starting resource cleanup', {
      services: cleanupRegistry.size,
    });
  }

  // Get all services and reverse for LIFO cleanup
  const services = Array.from(cleanupRegistry.entries()).reverse();

  for (const [serviceName, cleanupFns] of services) {
    // Process each service's cleanups in reverse order
    const reversedFns = [...cleanupFns].reverse();

    for (const fn of reversedFns) {
      total++;

      try {
        if (baseLogger?.debug) {
          baseLogger.debug('Cleaning up resource', {
            service: serviceName,
            resource: fn.name,
          });
        }

        const result = fn.cleanup();
        if (result instanceof Promise) {
          await result;
        }

        successful++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push({
          service: serviceName,
          resource: fn.name,
          error: errorMsg,
        });

        if (baseLogger?.error) {
          baseLogger.error('Resource cleanup failed', {
            service: serviceName,
            resource: fn.name,
            error: errorMsg,
          });
        }
      }
    }
  }

  const duration = Date.now() - startTime;

  if (baseLogger?.info) {
    baseLogger.info('Resource cleanup complete', {
      total,
      successful,
      failed: errors.length,
      duration: `${duration}ms`,
    });
  }

  return {
    total,
    successful,
    failed: errors.length,
    errors,
  };
}

/**
 * Get cleanup statistics for monitoring
 */
export function getCleanupStats(): {
  services: number;
  totalResources: number;
  resourcesByService: Record<string, number>;
} {
  const resourcesByService: Record<string, number> = {};
  let totalResources = 0;

  for (const [service, cleanups] of cleanupRegistry.entries()) {
    resourcesByService[service] = cleanups.length;
    totalResources += cleanups.length;
  }

  return {
    services: cleanupRegistry.size,
    totalResources,
    resourcesByService,
  };
}

/**
 * Reset the cleanup registry (for testing)
 */
export function resetCleanupRegistry(): void {
  cleanupRegistry.clear();
}
