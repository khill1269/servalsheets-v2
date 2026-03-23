/**
 * OpenTelemetry-Compatible Tracing
 *
 * Lightweight distributed tracing for observability.
 *
 * Features:
 * - Span creation for tool execution, API calls, operations
 * - Context propagation across async boundaries
 * - Automatic error recording
 * - Optional console logging for debugging
 * - Memory-efficient (max spans kept in memory)
 *
 * Environment Variables:
 * - OTEL_ENABLED: 'true' to enable tracing (default: 'false')
 * - OTEL_LOG_SPANS: 'true' to log spans to console (default: 'false')
 */

import { logger } from './logger.js';
import { getEnv } from '../config/env.js';

// ==================== Types ====================

export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';
export type SpanStatus = 'ok' | 'error' | 'unset';

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: SpanAttributes;
}

export interface Span {
  name: string;
  kind: SpanKind;
  startTime: number;
  endTime?: number;
  attributes: SpanAttributes;
  status: SpanStatus;
  statusMessage?: string;
  parentSpanId?: string;
  context: SpanContext;
  events: SpanEvent[];
}

export interface TracerOptions {
  serviceName?: string;
  enabled?: boolean;
  logSpans?: boolean;
}

// ==================== Utility Functions ====================

/**
 * Generate a random hex ID
 */
function generateId(length: number): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Generate a trace ID (32 hex chars)
 */
function generateTraceId(): string {
  return generateId(32);
}

/**
 * Generate a span ID (16 hex chars)
 */
function generateSpanId(): string {
  return generateId(16);
}

/**
 * Get high-resolution timestamp in microseconds
 */
function getTimestamp(): number {
  return Date.now() * 1000;
}

// ==================== Span Implementation ====================

class SpanImpl implements Span {
  name: string;
  kind: SpanKind;
  startTime: number;
  endTime?: number;
  attributes: SpanAttributes;
  status: SpanStatus = 'unset';
  statusMessage?: string;
  parentSpanId?: string;
  context: SpanContext;
  events: SpanEvent[] = [];

  private tracer: TracerImpl;
  private ended = false;

  constructor(
    tracer: TracerImpl,
    name: string,
    kind: SpanKind,
    parentContext?: SpanContext,
    attributes?: SpanAttributes
  ) {
    this.tracer = tracer;
    this.name = name;
    this.kind = kind;
    this.startTime = getTimestamp();
    this.attributes = attributes || {};
    this.parentSpanId = parentContext?.spanId;
    this.context = {
      traceId: parentContext?.traceId || generateTraceId(),
      spanId: generateSpanId(),
      traceFlags: 1, // sampled
    };
  }

  setAttribute(key: string, value: string | number | boolean | undefined): this {
    if (!this.ended) {
      this.attributes[key] = value;
    }
    return this;
  }

  setAttributes(attributes: SpanAttributes): this {
    if (!this.ended) {
      Object.assign(this.attributes, attributes);
    }
    return this;
  }

  addEvent(name: string, attributes?: SpanAttributes): this {
    if (!this.ended) {
      this.events.push({
        name,
        timestamp: getTimestamp(),
        attributes,
      });
    }
    return this;
  }

  setStatus(status: SpanStatus, message?: string): this {
    if (!this.ended) {
      this.status = status;
      this.statusMessage = message;
    }
    return this;
  }

  recordException(error: Error): this {
    if (!this.ended) {
      this.addEvent('exception', {
        'exception.type': error.name,
        'exception.message': error.message,
        'exception.stacktrace': error.stack,
      });
      this.setStatus('error', error.message);
    }
    return this;
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.endTime = getTimestamp();
    this.tracer.onSpanEnd(this);
  }
}

// ==================== Tracer Implementation ====================

/**
 * Maximum number of spans to keep in memory for getSpans()
 * Prevents unbounded memory growth during long-running sessions
 */
const MAX_SPANS_IN_MEMORY = 1000;

class TracerImpl {
  private serviceName: string;
  private enabled: boolean;
  private logSpans: boolean;
  private spans: Span[] = [];
  private currentSpan: SpanImpl | undefined;

  constructor(options: TracerOptions = {}) {
    const env = getEnv();
    this.serviceName = options.serviceName || 'servalsheets';
    this.enabled = options.enabled ?? env.OTEL_ENABLED;
    this.logSpans = options.logSpans ?? env.OTEL_LOG_SPANS;

    if (this.enabled) {
      logger.info('OpenTelemetry tracing enabled', {
        serviceName: this.serviceName,
        logSpans: this.logSpans,
      });
    }
  }

  /**
   * Check if tracing is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get the service name
   */
  getServiceName(): string {
    return this.serviceName;
  }

  /**
   * Start a new span
   */
  startSpan(
    name: string,
    options: {
      kind?: SpanKind;
      attributes?: SpanAttributes;
      parent?: SpanContext;
    } = {}
  ): SpanImpl {
    const span = new SpanImpl(
      this,
      name,
      options.kind || 'internal',
      options.parent || this.currentSpan?.context,
      options.attributes
    );

    if (this.enabled) {
      this.currentSpan = span;
    }

    return span;
  }

  /**
   * Get the current active span
   */
  getCurrentSpan(): SpanImpl | undefined {
    return this.currentSpan;
  }

  /**
   * Execute a function within a span
   */
  async withSpan<T>(
    name: string,
    fn: (span: SpanImpl) => Promise<T>,
    options: {
      kind?: SpanKind;
      attributes?: SpanAttributes;
      parent?: SpanContext;
    } = {}
  ): Promise<T> {
    if (!this.enabled) {
      // Create a no-op span when disabled
      const noopSpan = new SpanImpl(this, name, 'internal');
      return fn(noopSpan);
    }

    const span = this.startSpan(name, options);
    try {
      const result = await fn(span);
      span.setStatus('ok');
      return result;
    } catch (error) {
      if (error instanceof Error) {
        span.recordException(error);
      } else {
        span.setStatus('error', String(error));
      }
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Execute a synchronous function within a span
   */
  withSpanSync<T>(
    name: string,
    fn: (span: SpanImpl) => T,
    options: {
      kind?: SpanKind;
      attributes?: SpanAttributes;
      parent?: SpanContext;
    } = {}
  ): T {
    if (!this.enabled) {
      const noopSpan = new SpanImpl(this, name, 'internal');
      return fn(noopSpan);
    }

    const span = this.startSpan(name, options);
    try {
      const result = fn(span);
      span.setStatus('ok');
      return result;
    } catch (error) {
      if (error instanceof Error) {
        span.recordException(error);
      } else {
        span.setStatus('error', String(error));
      }
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Called when a span ends
   */
  onSpanEnd(span: Span): void {
    if (!this.enabled) return;

    // Add to spans array with limit to prevent unbounded memory growth
    this.spans.push(span);
    if (this.spans.length > MAX_SPANS_IN_MEMORY) {
      // Remove oldest spans (FIFO)
      this.spans.splice(0, this.spans.length - MAX_SPANS_IN_MEMORY);
    }

    // Export to OTLP if enabled
    this.exportToOtlp(span);

    // Log span if configured
    if (this.logSpans) {
      const duration = span.endTime ? (span.endTime - span.startTime) / 1000 : 0;
      logger.debug(`SPAN: ${span.name}`, {
        traceId: span.context.traceId,
        spanId: span.context.spanId,
        parentSpanId: span.parentSpanId,
        duration: `${duration.toFixed(2)}ms`,
        status: span.status,
        attributes: span.attributes,
      });
    }
  }

  /**
   * Export span to OTLP collector if enabled
   */
  private exportToOtlp(span: Span): void {
    // Lazy import to avoid circular dependencies
    void (async () => {
      try {
        const { getOtlpExporter } = await import('../observability/otel-export.js');
        const exporter = getOtlpExporter();

        // Convert to ServalSpan format
        exporter.addSpan({
          traceId: span.context.traceId,
          spanId: span.context.spanId,
          parentId: span.parentSpanId,
          name: span.name,
          kind: span.kind as 'server' | 'client' | 'internal',
          startTime: span.startTime,
          endTime: span.endTime ?? span.startTime,
          attributes: span.attributes as Record<string, string | number | boolean>,
          status: span.status,
          statusMessage: span.statusMessage,
          events: span.events.map((e) => ({
            name: e.name,
            time: e.timestamp,
            attributes: e.attributes as Record<string, string | number | boolean> | undefined,
          })),
        });
      } catch {
        // Silently ignore OTLP export errors - tracing should never break the app
      }
    })();
  }

  /**
   * Get all recorded spans (for testing/debugging)
   */
  getSpans(): Span[] {
    return [...this.spans];
  }

  /**
   * Get span statistics
   */
  getStats(): {
    totalSpans: number;
    spansByKind: Record<SpanKind, number>;
    spansByStatus: Record<SpanStatus, number>;
    averageDuration: number;
  } {
    const stats = {
      totalSpans: this.spans.length,
      spansByKind: {
        internal: 0,
        server: 0,
        client: 0,
        producer: 0,
        consumer: 0,
      } as Record<SpanKind, number>,
      spansByStatus: {
        ok: 0,
        error: 0,
        unset: 0,
      } as Record<SpanStatus, number>,
      averageDuration: 0,
    };

    let totalDuration = 0;
    for (const span of this.spans) {
      stats.spansByKind[span.kind]++;
      stats.spansByStatus[span.status]++;
      if (span.endTime) {
        totalDuration += (span.endTime - span.startTime) / 1000;
      }
    }

    if (this.spans.length > 0) {
      stats.averageDuration = totalDuration / this.spans.length;
    }

    return stats;
  }

  /**
   * Clear recorded spans (for testing)
   */
  clearSpans(): void {
    this.spans = [];
  }

  /**
   * Shutdown the tracer
   */
  async shutdown(): Promise<void> {
    // Currently no async cleanup needed
    // Could add export buffer flushing here in the future
  }
}

// ==================== Global Tracer Instance ====================

let globalTracer: TracerImpl | undefined;

/**
 * Get the global tracer instance
 */
export function getTracer(): TracerImpl {
  if (!globalTracer) {
    globalTracer = new TracerImpl();
  }
  return globalTracer;
}

/**
 * Initialize the tracer with options
 */
export function initTracer(options?: TracerOptions): TracerImpl {
  globalTracer = new TracerImpl(options);
  return globalTracer;
}

/**
 * Shutdown the tracer
 */
export async function shutdownTracer(): Promise<void> {
  if (globalTracer) {
    await globalTracer.shutdown();
  }
}

// ==================== Convenience Functions ====================

/**
 * Start a span for tool execution
 */
export function startToolSpan(toolName: string, attributes?: SpanAttributes): SpanImpl {
  return getTracer().startSpan(`tool.${toolName}`, {
    kind: 'server',
    attributes: {
      'tool.name': toolName,
      ...attributes,
    },
  });
}

/**
 * Start a span for API calls
 */
export function startApiSpan(
  method: string,
  endpoint: string,
  attributes?: SpanAttributes
): SpanImpl {
  return getTracer().startSpan(`api.${method}`, {
    kind: 'client',
    attributes: {
      'http.method': method,
      'http.url': endpoint,
      ...attributes,
    },
  });
}

/**
 * Start a span for operations
 */
export function startOperationSpan(operation: string, attributes?: SpanAttributes): SpanImpl {
  return getTracer().startSpan(operation, {
    kind: 'internal',
    attributes,
  });
}

/**
 * Execute a function within a tool span
 */
export async function withToolSpan<T>(
  toolName: string,
  fn: (span: SpanImpl) => Promise<T>,
  attributes?: SpanAttributes,
  parent?: SpanContext
): Promise<T> {
  return getTracer().withSpan(`tool.${toolName}`, fn, {
    kind: 'server',
    attributes: {
      'tool.name': toolName,
      ...attributes,
    },
    parent,
  });
}

/**
 * Execute a function within an API span
 */
export async function withApiSpan<T>(
  method: string,
  endpoint: string,
  fn: (span: SpanImpl) => Promise<T>,
  attributes?: SpanAttributes
): Promise<T> {
  return getTracer().withSpan(`api.${method}`, fn, {
    kind: 'client',
    attributes: {
      'http.method': method,
      'http.url': endpoint,
      ...attributes,
    },
  });
}

/**
 * Execute a function within an operation span
 */
export async function withOperationSpan<T>(
  operation: string,
  fn: (span: SpanImpl) => Promise<T>,
  attributes?: SpanAttributes
): Promise<T> {
  return getTracer().withSpan(operation, fn, {
    kind: 'internal',
    attributes,
  });
}

// Export types
export type { SpanImpl as SpanInstance };
