/**
 * Circuit Breaker Registry
 *
 * Global registry for tracking all circuit breakers in the application.
 * Allows endpoints to expose circuit breaker metrics for monitoring.
 */

import type { ICircuitBreaker } from '../utils/circuit-breaker.js';
import { logger } from '../utils/logger.js';

interface CircuitBreakerEntry {
  name: string;
  breaker: ICircuitBreaker;
  description?: string;
}

class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreakerEntry> = new Map();

  /**
   * Register a circuit breaker
   */
  register(name: string, breaker: ICircuitBreaker, description?: string): void {
    this.breakers.set(name, { name, breaker, description });
    logger.debug('Circuit breaker registered', { name, description });
  }

  /**
   * Unregister a circuit breaker
   */
  unregister(name: string): void {
    this.breakers.delete(name);
    logger.debug('Circuit breaker unregistered', { name });
  }

  /**
   * Get all registered circuit breakers
   */
  getAll(): CircuitBreakerEntry[] {
    return Array.from(this.breakers.values());
  }

  /**
   * Get a specific circuit breaker by name
   */
  get(name: string): CircuitBreakerEntry | undefined {
    return this.breakers.get(name);
  }

  /**
   * Get statistics for all circuit breakers
   */
  getAllStats(): Record<string, unknown> {
    const stats: Record<string, unknown> = {};
    for (const [name, entry] of this.breakers) {
      stats[name] = entry.breaker.getStats();
    }
    return stats;
  }

  /**
   * Clear all registered circuit breakers (for testing)
   */
  clear(): void {
    this.breakers.clear();
  }
}

// Global singleton instance
const registry = new CircuitBreakerRegistry();

export { registry as circuitBreakerRegistry, type CircuitBreakerEntry };
