/**
 * Dependency Injection Container
 *
 * @purpose Manage service lifecycle, dependencies, and initialization for 74+ services
 * @category Core Infrastructure
 * @usage Centralized service management with lazy initialization and proper dependency resolution
 */

import { logger } from '../utils/logger.js';
import { NotFoundError, ServiceError, ConfigError } from '../core/errors.js';

export type ServiceLifecycle = 'singleton' | 'transient' | 'scoped';

export interface ServiceDefinition<T = unknown> {
  lifecycle: ServiceLifecycle;
  factory: (container: Container) => T | Promise<T>;
  dependencies?: string[];
}

export interface ContainerMetrics {
  totalRegistered: number;
  singletonsCached: number;
  resolutionCount: number;
  failedResolutions: number;
  avgResolutionTimeMs: number;
}

/**
 * Dependency Injection Container
 * Manages service lifecycle with lazy initialization and dependency resolution
 */
export class Container {
  private definitions = new Map<string, ServiceDefinition>();
  private singletons = new Map<string, unknown>();
  private resolving = new Set<string>();
  private resolutionTimes: number[] = [];
  private metrics: ContainerMetrics = {
    totalRegistered: 0,
    singletonsCached: 0,
    resolutionCount: 0,
    failedResolutions: 0,
    avgResolutionTimeMs: 0,
  };

  /**
   * Register a service with the container
   */
  register<T>(name: string, definition: ServiceDefinition<T>): void {
    if (this.definitions.has(name)) {
      throw new ServiceError(`Service "${name}" is already registered`, 'INTERNAL_ERROR', name);
    }

    this.definitions.set(name, definition as ServiceDefinition);
    this.metrics.totalRegistered++;

    logger.debug('Service registered', {
      service: name,
      lifecycle: definition.lifecycle,
      hasDependencies: (definition.dependencies?.length ?? 0) > 0,
    });
  }

  /**
   * Resolve a service by name
   */
  async resolve<T>(name: string): Promise<T> {
    const startTime = performance.now();

    try {
      const result = await this.resolveInternal<T>(name);

      const duration = performance.now() - startTime;
      this.resolutionTimes.push(duration);
      this.metrics.resolutionCount++;
      this.updateAvgResolutionTime();

      return result;
    } catch (error) {
      this.metrics.failedResolutions++;
      throw error;
    }
  }

  /**
   * Internal resolution logic
   */
  private async resolveInternal<T>(name: string): Promise<T> {
    // Check for circular dependencies
    if (this.resolving.has(name)) {
      const chain = Array.from(this.resolving).join(' -> ');
      throw new ServiceError(
        `Circular dependency detected: ${chain} -> ${name}`,
        'INTERNAL_ERROR',
        name
      );
    }

    const definition = this.definitions.get(name);
    if (!definition) {
      throw new NotFoundError('service', name);
    }

    // Return cached singleton
    if (definition.lifecycle === 'singleton' && this.singletons.has(name)) {
      return this.singletons.get(name) as T;
    }

    // Mark as resolving
    this.resolving.add(name);

    try {
      // Resolve dependencies first
      const dependencies = definition.dependencies ?? [];
      await Promise.all(dependencies.map((dep) => this.resolve(dep)));

      // Call factory
      const instance = await definition.factory(this);

      // Cache singleton
      if (definition.lifecycle === 'singleton') {
        this.singletons.set(name, instance);
        this.metrics.singletonsCached++;
      }

      logger.debug('Service resolved', {
        service: name,
        lifecycle: definition.lifecycle,
        cached: definition.lifecycle === 'singleton',
      });

      return instance as T;
    } finally {
      this.resolving.delete(name);
    }
  }

  /**
   * Validate all service dependencies
   */
  validateDependencies(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const visit = (serviceName: string, path: string[] = []): void => {
      if (recursionStack.has(serviceName)) {
        errors.push(`Circular dependency: ${[...path, serviceName].join(' -> ')}`);
        return;
      }

      if (visited.has(serviceName)) {
        return;
      }

      const definition = this.definitions.get(serviceName);
      if (!definition) {
        errors.push(`Service "${serviceName}" is not registered`);
        return;
      }

      visited.add(serviceName);
      recursionStack.add(serviceName);

      for (const dep of definition.dependencies ?? []) {
        if (!this.definitions.has(dep)) {
          errors.push(`Service "${serviceName}" depends on unregistered service "${dep}"`);
        } else {
          visit(dep, [...path, serviceName]);
        }
      }

      recursionStack.delete(serviceName);
    };

    for (const serviceName of this.definitions.keys()) {
      visit(serviceName);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if a service is registered
   */
  has(name: string): boolean {
    return this.definitions.has(name);
  }

  /**
   * Get all registered service names
   */
  getServiceNames(): string[] {
    return Array.from(this.definitions.keys());
  }

  /**
   * Get container metrics
   */
  getMetrics(): ContainerMetrics {
    return { ...this.metrics };
  }

  /**
   * Clear all services (for testing)
   */
  clear(): void {
    this.definitions.clear();
    this.singletons.clear();
    this.resolving.clear();
    this.resolutionTimes = [];
    this.metrics = {
      totalRegistered: 0,
      singletonsCached: 0,
      resolutionCount: 0,
      failedResolutions: 0,
      avgResolutionTimeMs: 0,
    };
  }

  /**
   * Update average resolution time
   */
  private updateAvgResolutionTime(): void {
    if (this.resolutionTimes.length === 0) {
      this.metrics.avgResolutionTimeMs = 0;
      return;
    }

    const sum = this.resolutionTimes.reduce((a, b) => a + b, 0);
    this.metrics.avgResolutionTimeMs = sum / this.resolutionTimes.length;

    // Keep only last 100 measurements
    if (this.resolutionTimes.length > 100) {
      this.resolutionTimes = this.resolutionTimes.slice(-100);
    }
  }

  /**
   * Initialize all singleton services eagerly
   */
  async initializeAll(): Promise<void> {
    logger.info('Initializing all singleton services');

    const validation = this.validateDependencies();
    if (!validation.valid) {
      throw new ConfigError(
        `Dependency validation failed:\n${validation.errors.join('\n')}`,
        'service-dependencies'
      );
    }

    const singletons = Array.from(this.definitions.entries())
      .filter(([_, def]) => def.lifecycle === 'singleton')
      .map(([name]) => name);

    await Promise.all(singletons.map((name) => this.resolve(name)));

    logger.info('All singleton services initialized', {
      count: this.metrics.singletonsCached,
    });
  }
}

/**
 * Global container instance
 */
let globalContainer: Container | null = null;

/**
 * Get the global container (singleton)
 */
export function getContainer(): Container {
  if (!globalContainer) {
    globalContainer = new Container();
  }
  return globalContainer;
}

/**
 * Reset the global container (for testing)
 */
export function resetContainer(): void {
  globalContainer = null;
}
