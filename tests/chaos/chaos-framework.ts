/**
 * Chaos Engineering Test Framework
 *
 * Provides fault injection capabilities to verify system resilience:
 * - Network faults (latency, packet loss, disconnects)
 * - Resource exhaustion (memory, CPU, file descriptors)
 * - Cascading failures (dependency failures)
 * - Random operation failures
 *
 * @category Testing
 * @example
 * const chaos = new ChaosEngine();
 * chaos.injectNetworkLatency(500, 1000); // 500-1000ms latency
 * await chaos.execute(async () => {
 *   // Test operations under chaos
 * });
 * chaos.reset(); // Remove all chaos
 */

import { EventEmitter } from 'events';
import type { GoogleApiClient } from '../../src/services/google-api.js';
import type { CircuitBreaker } from '../../src/utils/circuit-breaker.js';
import { logger } from '../../src/utils/logger.js';

export interface ChaosConfig {
  /** Probability (0-1) of fault occurring */
  probability?: number;
  /** Duration in ms to maintain chaos */
  durationMs?: number;
  /** Delay before injecting chaos */
  delayMs?: number;
}

export interface NetworkFaultConfig extends ChaosConfig {
  /** Latency range in ms */
  latencyMin?: number;
  latencyMax?: number;
  /** Packet loss probability (0-1) */
  packetLoss?: number;
  /** Disconnect probability (0-1) */
  disconnectProbability?: number;
}

export interface ResourceExhaustionConfig extends ChaosConfig {
  /** Memory pressure (0-1, 0=none, 1=extreme) */
  memoryPressure?: number;
  /** CPU load (0-1, 0=none, 1=100% CPU) */
  cpuLoad?: number;
  /** File descriptor limit */
  fdLimit?: number;
}

export interface CascadingFailureConfig extends ChaosConfig {
  /** Initial failure probability */
  initialProbability?: number;
  /** Probability increase per failure */
  escalationRate?: number;
  /** Maximum failure probability */
  maxProbability?: number;
}

export type ChaosEventType =
  | 'network_latency'
  | 'network_disconnect'
  | 'memory_pressure'
  | 'cpu_load'
  | 'api_failure'
  | 'circuit_open'
  | 'resource_exhaustion';

export interface ChaosEvent {
  type: ChaosEventType;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Chaos Engine - Orchestrates fault injection
 */
export class ChaosEngine extends EventEmitter {
  private activeFaults: Map<string, NodeJS.Timeout> = new Map();
  private events: ChaosEvent[] = [];
  private originalFetch?: typeof globalThis.fetch;
  private networkLatency?: { min: number; max: number };
  private packetLossRate = 0;
  private disconnectRate = 0;
  private memoryAllocations: ArrayBuffer[] = [];
  private cpuLoadInterval?: NodeJS.Timeout;
  private cascadingFailureRate = 0;
  private consecutiveFailures = 0;

  /**
   * Inject network latency into HTTP requests
   */
  injectNetworkLatency(minMs: number, maxMs: number, config: ChaosConfig = {}): void {
    const probability = config.probability ?? 1.0;

    this.networkLatency = { min: minMs, max: maxMs };

    logger.info('Chaos: Network latency injected', {
      minMs,
      maxMs,
      probability,
    });

    this.recordEvent('network_latency', { minMs, maxMs, probability });

    if (config.durationMs) {
      this.scheduleReset('latency', config.durationMs);
    }
  }

  /**
   * Inject packet loss into network requests
   */
  injectPacketLoss(probability: number, config: ChaosConfig = {}): void {
    this.packetLossRate = Math.max(0, Math.min(1, probability));

    logger.info('Chaos: Packet loss injected', {
      probability: this.packetLossRate,
    });

    if (config.durationMs) {
      this.scheduleReset('packet_loss', config.durationMs);
    }
  }

  /**
   * Inject random disconnects
   */
  injectDisconnects(probability: number, config: ChaosConfig = {}): void {
    this.disconnectRate = Math.max(0, Math.min(1, probability));

    logger.info('Chaos: Disconnects injected', {
      probability: this.disconnectRate,
    });

    this.recordEvent('network_disconnect', { probability: this.disconnectRate });

    if (config.durationMs) {
      this.scheduleReset('disconnect', config.durationMs);
    }
  }

  /**
   * Simulate memory pressure by allocating memory
   */
  injectMemoryPressure(sizeMb: number, config: ChaosConfig = {}): void {
    const sizeBytes = sizeMb * 1024 * 1024;
    const buffer = new ArrayBuffer(sizeBytes);
    this.memoryAllocations.push(buffer);

    logger.info('Chaos: Memory pressure injected', {
      sizeMb,
      totalAllocatedMb: this.memoryAllocations.reduce(
        (sum, buf) => sum + buf.byteLength / 1024 / 1024,
        0
      ),
    });

    this.recordEvent('memory_pressure', { sizeMb });

    if (config.durationMs) {
      this.scheduleReset('memory', config.durationMs);
    }
  }

  /**
   * Simulate CPU load
   */
  injectCpuLoad(intensity: number, config: ChaosConfig = {}): void {
    if (this.cpuLoadInterval) {
      clearInterval(this.cpuLoadInterval);
    }

    const workMs = Math.floor(intensity * 100); // 0-100ms of busy work per 100ms
    const sleepMs = 100 - workMs;

    this.cpuLoadInterval = setInterval(() => {
      const start = Date.now();
      while (Date.now() - start < workMs) {
        // Busy work
        Math.random() * Math.random();
      }
    }, sleepMs + workMs);

    logger.info('Chaos: CPU load injected', {
      intensity,
      workMs,
    });

    this.recordEvent('cpu_load', { intensity });

    if (config.durationMs) {
      this.scheduleReset('cpu', config.durationMs);
    }
  }

  /**
   * Inject cascading failures - failures increase probability of more failures
   */
  injectCascadingFailures(config: CascadingFailureConfig = {}): void {
    this.cascadingFailureRate = config.initialProbability ?? 0.1;

    logger.info('Chaos: Cascading failures enabled', {
      initialProbability: this.cascadingFailureRate,
      escalationRate: config.escalationRate ?? 0.1,
      maxProbability: config.maxProbability ?? 0.9,
    });

    if (config.durationMs) {
      this.scheduleReset('cascading', config.durationMs);
    }
  }

  /**
   * Wrap Google API client with chaos
   */
  wrapGoogleApiClient(client: GoogleApiClient): GoogleApiClient {
    const originalSheets = client.sheets;
    const originalDrive = client.drive;

    // Wrap sheets API
    Object.defineProperty(client, 'sheets', {
      get: () => {
        return this.wrapApiClient(originalSheets);
      },
    });

    // Wrap drive API
    Object.defineProperty(client, 'drive', {
      get: () => {
        return this.wrapApiClient(originalDrive);
      },
    });

    return client;
  }

  /**
   * Wrap API client methods with chaos
   */
  private wrapApiClient<T extends object>(api: T): T {
    return new Proxy(api, {
      get: (target, prop) => {
        const value = Reflect.get(target, prop);

        if (typeof value === 'object' && value !== null) {
          return this.wrapApiClient(value);
        }

        if (typeof value === 'function') {
          return async (...args: unknown[]) => {
            // Apply chaos before request
            await this.applyNetworkChaos();
            await this.applyCascadingFailureChaos();

            try {
              const result = await value.apply(target, args);
              this.consecutiveFailures = 0; // Reset on success
              return result;
            } catch (error) {
              this.consecutiveFailures++;
              this.escalateCascadingFailures();
              throw error;
            }
          };
        }

        return value;
      },
    });
  }

  /**
   * Apply network chaos effects
   */
  private async applyNetworkChaos(): Promise<void> {
    // Simulate disconnect
    if (Math.random() < this.disconnectRate) {
      this.recordEvent('network_disconnect', { source: 'chaos' });
      throw new Error('ERR_HTTP2_GOAWAY_SESSION');
    }

    // Simulate packet loss
    if (Math.random() < this.packetLossRate) {
      throw new Error('ECONNRESET');
    }

    // Simulate latency
    if (this.networkLatency) {
      const delay =
        this.networkLatency.min +
        Math.random() * (this.networkLatency.max - this.networkLatency.min);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  /**
   * Apply cascading failure chaos
   */
  private async applyCascadingFailureChaos(): Promise<void> {
    if (Math.random() < this.cascadingFailureRate) {
      this.recordEvent('api_failure', {
        cascading: true,
        consecutiveFailures: this.consecutiveFailures,
      });
      throw new Error('API temporarily unavailable (cascading failure)');
    }
  }

  /**
   * Escalate cascading failure rate after failures
   */
  private escalateCascadingFailures(): void {
    if (this.cascadingFailureRate > 0) {
      this.cascadingFailureRate = Math.min(
        0.9,
        this.cascadingFailureRate + 0.1 * this.consecutiveFailures
      );

      logger.warn('Chaos: Cascading failure rate escalated', {
        newRate: this.cascadingFailureRate,
        consecutiveFailures: this.consecutiveFailures,
      });
    }
  }

  /**
   * Wrap circuit breaker with monitoring
   */
  wrapCircuitBreaker(breaker: CircuitBreaker): CircuitBreaker {
    const originalExecute = breaker.execute.bind(breaker);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    breaker.execute = async (operation: any, fallback?: any) => {
      try {
        return await originalExecute(operation, fallback);
      } finally {
        const stats = breaker.getStats();
        if (stats.state === 'open') {
          this.recordEvent('circuit_open', { stats });
        }
      }
    };

    return breaker;
  }

  /**
   * Execute operation under chaos
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      logger.debug('Chaos execution failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Schedule automatic reset after duration
   */
  private scheduleReset(type: string, durationMs: number): void {
    const existingTimeout = this.activeFaults.get(type);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      this.resetFault(type);
    }, durationMs);

    this.activeFaults.set(type, timeout);
  }

  /**
   * Reset specific fault
   */
  private resetFault(type: string): void {
    switch (type) {
      case 'latency':
        this.networkLatency = undefined;
        break;
      case 'packet_loss':
        this.packetLossRate = 0;
        break;
      case 'disconnect':
        this.disconnectRate = 0;
        break;
      case 'memory':
        this.memoryAllocations = [];
        break;
      case 'cpu':
        if (this.cpuLoadInterval) {
          clearInterval(this.cpuLoadInterval);
          this.cpuLoadInterval = undefined;
        }
        break;
      case 'cascading':
        this.cascadingFailureRate = 0;
        this.consecutiveFailures = 0;
        break;
    }

    this.activeFaults.delete(type);
    logger.info('Chaos: Fault reset', { type });
  }

  /**
   * Reset all chaos to normal operation
   */
  reset(): void {
    // Clear all scheduled resets
    for (const timeout of this.activeFaults.values()) {
      clearTimeout(timeout);
    }
    this.activeFaults.clear();

    // Reset all chaos effects
    this.networkLatency = undefined;
    this.packetLossRate = 0;
    this.disconnectRate = 0;
    this.memoryAllocations = [];
    this.cascadingFailureRate = 0;
    this.consecutiveFailures = 0;

    if (this.cpuLoadInterval) {
      clearInterval(this.cpuLoadInterval);
      this.cpuLoadInterval = undefined;
    }

    if (this.originalFetch) {
      globalThis.fetch = this.originalFetch;
      this.originalFetch = undefined;
    }

    logger.info('Chaos: All faults reset');
  }

  /**
   * Record chaos event
   */
  private recordEvent(type: ChaosEventType, metadata?: Record<string, unknown>): void {
    const event: ChaosEvent = {
      type,
      timestamp: Date.now(),
      metadata,
    };
    this.events.push(event);
    this.emit('chaos_event', event);
  }

  /**
   * Get all recorded events
   */
  getEvents(): ChaosEvent[] {
    return [...this.events];
  }

  /**
   * Get events by type
   */
  getEventsByType(type: ChaosEventType): ChaosEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /**
   * Clear event history
   */
  clearEvents(): void {
    this.events = [];
  }

  /**
   * Get chaos statistics
   */
  getStats(): {
    totalEvents: number;
    eventsByType: Record<ChaosEventType, number>;
    consecutiveFailures: number;
    cascadingFailureRate: number;
    memoryAllocatedMb: number;
  } {
    const eventsByType = {} as Record<ChaosEventType, number>;

    for (const event of this.events) {
      eventsByType[event.type] = (eventsByType[event.type] ?? 0) + 1;
    }

    return {
      totalEvents: this.events.length,
      eventsByType,
      consecutiveFailures: this.consecutiveFailures,
      cascadingFailureRate: this.cascadingFailureRate,
      memoryAllocatedMb: this.memoryAllocations.reduce(
        (sum, buf) => sum + buf.byteLength / 1024 / 1024,
        0
      ),
    };
  }
}

/**
 * Create a chaos engine instance
 */
export function createChaosEngine(): ChaosEngine {
  return new ChaosEngine();
}

/**
 * Helper to verify graceful degradation
 */
export function assertGracefulDegradation(
  operation: () => Promise<unknown>,
  maxRetries: number
): {
  succeeded: boolean;
  retries: number;
  duration: number;
  error?: Error;
} {
  let retries = 0;
  let succeeded = false;
  let error: Error | undefined;
  const start = Date.now();

  const attempt = async (): Promise<void> => {
    try {
      await operation();
      succeeded = true;
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      retries++;
      if (retries < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, retries)));
        await attempt();
      }
    }
  };

  return {
    succeeded,
    retries,
    duration: Date.now() - start,
    error,
  };
}

/**
 * Verify circuit breaker behavior under chaos
 */
export async function verifyChaosCircuitBreaker(
  breaker: CircuitBreaker,
  chaosOperation: () => Promise<void>,
  expectedTransitions: Array<'closed' | 'open' | 'half_open'>
): Promise<boolean> {
  const transitions: Array<'closed' | 'open' | 'half_open'> = [];
  let lastState = breaker.getState();

  for (let i = 0; i < 10; i++) {
    try {
      await chaosOperation();
    } catch {
      // Expected during chaos
    }

    const currentState = breaker.getState();
    if (currentState !== lastState) {
      transitions.push(currentState);
      lastState = currentState;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Verify expected transitions occurred
  return expectedTransitions.every((expected, i) => transitions[i] === expected);
}
