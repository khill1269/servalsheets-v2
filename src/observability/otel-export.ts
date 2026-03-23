/**
 * ServalSheets - OpenTelemetry Export Integration
 *
 * Production-grade OTLP exporter that transforms the existing custom tracing
 * into OpenTelemetry format for export to Jaeger, Zipkin, or any OTLP collector.
 *
 * This does NOT replace the existing tracing - it adds export capability.
 *
 * Environment Variables:
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP collector endpoint (default: http://localhost:4318)
 * - OTEL_SERVICE_NAME: Service name (default: servalsheets)
 * - OTEL_SERVICE_VERSION: Service version (auto-detected from package.json)
 * - OTEL_EXPORT_ENABLED: Enable/disable export (default: false)
 * - OTEL_EXPORT_BATCH_SIZE: Spans per batch (default: 100)
 * - OTEL_EXPORT_INTERVAL_MS: Export interval (default: 5000)
 *
 * @see https://opentelemetry.io/docs/specs/otlp/
 */

import { logger } from '../utils/logger.js';
import { VERSION } from '../version.js';
import { getOtlpExportConfig } from '../config/env.js';
import { ServiceError } from '../core/errors.js';
import {
  otlpSpansExportedTotal,
  otlpExportErrorsTotal,
  otlpBufferSizeGauge,
  otlpExportDurationHistogram,
} from './metrics.js';

/**
 * OpenTelemetry span status codes
 */
export enum OtelStatusCode {
  UNSET = 0,
  OK = 1,
  ERROR = 2,
}

/**
 * OpenTelemetry span kind
 */
export enum OtelSpanKind {
  INTERNAL = 0,
  SERVER = 1,
  CLIENT = 2,
  PRODUCER = 3,
  CONSUMER = 4,
}

/**
 * OTLP attribute value types
 */
export type OtelAttributeValue = string | number | boolean | string[] | number[] | boolean[];

/**
 * OTLP span structure
 */
export interface OtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: OtelSpanKind;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Array<{
    key: string;
    value: {
      stringValue?: string;
      intValue?: string;
      boolValue?: boolean;
      arrayValue?: { values: Array<{ stringValue?: string }> };
    };
  }>;
  status: {
    code: OtelStatusCode;
    message?: string;
  };
  events?: Array<{
    name: string;
    timeUnixNano: string;
    attributes?: OtelSpan['attributes'];
  }>;
}

/**
 * OTLP export request structure
 */
export interface OtlpExportRequest {
  resourceSpans: Array<{
    resource: {
      attributes: OtelSpan['attributes'];
    };
    scopeSpans: Array<{
      scope: {
        name: string;
        version: string;
      };
      spans: OtelSpan[];
    }>;
  }>;
}

/**
 * Configuration for OTLP exporter
 */
export interface OtlpExporterConfig {
  endpoint: string;
  serviceName: string;
  serviceVersion: string;
  enabled: boolean;
  batchSize: number;
  exportIntervalMs: number;
  headers?: Record<string, string>;
}

/**
 * Span data from ServalSheets tracing
 */
export interface ServalSpan {
  traceId: string;
  spanId: string;
  parentId?: string;
  name: string;
  kind: 'server' | 'client' | 'internal';
  startTime: number; // microseconds since epoch (Date.now() * 1000)
  endTime: number; // microseconds since epoch
  attributes: Record<string, OtelAttributeValue>;
  status: 'ok' | 'error' | 'unset';
  statusMessage?: string;
  events?: Array<{
    name: string;
    time: number; // microseconds
    attributes?: Record<string, OtelAttributeValue>;
  }>;
}

/**
 * OTLP Exporter for ServalSheets traces
 *
 * Batches spans and exports to OTLP-compatible backends
 */
export class OtlpExporter {
  private config: OtlpExporterConfig;
  private spanBuffer: ServalSpan[] = [];
  private exportTimer?: NodeJS.Timeout;
  private isShuttingDown = false;
  private pendingExports = 0;
  private stats = {
    spansExported: 0,
    exportErrors: 0,
    lastExportTime: 0,
  };

  constructor(config?: Partial<OtlpExporterConfig>) {
    const envConfig = getOtlpExportConfig();
    this.config = {
      endpoint: envConfig.endpoint,
      serviceName: envConfig.serviceName,
      serviceVersion: VERSION,
      enabled: envConfig.enabled,
      batchSize: envConfig.batchSize,
      exportIntervalMs: envConfig.exportIntervalMs,
      ...config,
    };

    if (this.config.enabled) {
      this.startExportTimer();
      logger.info('OTLP exporter initialized', {
        endpoint: this.config.endpoint,
        serviceName: this.config.serviceName,
        batchSize: this.config.batchSize,
        exportIntervalMs: this.config.exportIntervalMs,
      });
    }
  }

  /**
   * Add span to export buffer
   */
  addSpan(span: ServalSpan): void {
    if (!this.config.enabled || this.isShuttingDown) {
      return;
    }

    this.spanBuffer.push(span);

    // Export immediately if buffer is full
    if (this.spanBuffer.length >= this.config.batchSize) {
      void this.export();
    }
  }

  /**
   * Start periodic export timer
   */
  private startExportTimer(): void {
    this.exportTimer = setInterval(() => {
      if (this.spanBuffer.length > 0) {
        void this.export();
      }
    }, this.config.exportIntervalMs);

    // Don't prevent Node from exiting
    this.exportTimer.unref();
  }

  /**
   * Export buffered spans to OTLP endpoint
   */
  async export(): Promise<void> {
    if (this.spanBuffer.length === 0) {
      return;
    }

    // Take current buffer and clear it
    const spans = this.spanBuffer.splice(0, this.config.batchSize);
    this.pendingExports++;

    // Record buffer size metric (Phase 0, Priority 3)
    otlpBufferSizeGauge.set(this.spanBuffer.length);

    const exportStartTime = Date.now();
    try {
      const request = this.buildOtlpRequest(spans);
      const response = await fetch(`${this.config.endpoint}/v1/traces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ServiceError(
          `OTLP export failed: ${response.status} - ${errorText}`,
          'INTERNAL_ERROR',
          'otel-export'
        );
      }

      this.stats.spansExported += spans.length;
      this.stats.lastExportTime = Date.now();

      // Record successful export metrics (Phase 0, Priority 3)
      otlpSpansExportedTotal.inc({ endpoint: this.config.endpoint }, spans.length);
      const exportDuration = (Date.now() - exportStartTime) / 1000;
      otlpExportDurationHistogram.observe({ endpoint: this.config.endpoint }, exportDuration);
    } catch (error) {
      this.stats.exportErrors++;

      // Record error metrics (Phase 0, Priority 3)
      const errorType = error instanceof Error ? error.constructor.name : 'Unknown';
      otlpExportErrorsTotal.inc({ endpoint: this.config.endpoint, error_type: errorType });

      logger.error('OTLP export error', {
        error: error instanceof Error ? error.message : String(error),
        spansLost: spans.length,
      });
      // Don't re-add spans - they're lost (prevent memory growth)
    } finally {
      this.pendingExports--;
    }
  }

  /**
   * Build OTLP export request from ServalSheets spans
   */
  private buildOtlpRequest(spans: ServalSpan[]): OtlpExportRequest {
    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: 'service.name',
                value: { stringValue: this.config.serviceName },
              },
              {
                key: 'service.version',
                value: { stringValue: this.config.serviceVersion },
              },
              {
                key: 'telemetry.sdk.name',
                value: { stringValue: 'servalsheets-tracing' },
              },
              {
                key: 'telemetry.sdk.language',
                value: { stringValue: 'nodejs' },
              },
            ],
          },
          scopeSpans: [
            {
              scope: {
                name: 'servalsheets',
                version: this.config.serviceVersion,
              },
              spans: spans.map((span) => this.convertSpan(span)),
            },
          ],
        },
      ],
    };
  }

  /**
   * Convert ServalSheets span to OTLP format
   */
  private convertSpan(span: ServalSpan): OtelSpan {
    const otelSpan: OtelSpan = {
      traceId: this.padHex(span.traceId, 32),
      spanId: this.padHex(span.spanId, 16),
      name: span.name,
      kind: this.convertKind(span.kind),
      startTimeUnixNano: this.msToNano(span.startTime),
      endTimeUnixNano: this.msToNano(span.endTime),
      attributes: this.convertAttributes(span.attributes),
      status: {
        code: this.convertStatus(span.status),
        message: span.statusMessage,
      },
    };

    if (span.parentId) {
      otelSpan.parentSpanId = this.padHex(span.parentId, 16);
    }

    if (span.events && span.events.length > 0) {
      otelSpan.events = span.events.map((event) => ({
        name: event.name,
        timeUnixNano: this.msToNano(event.time),
        attributes: event.attributes ? this.convertAttributes(event.attributes) : undefined,
      }));
    }

    return otelSpan;
  }

  /**
   * Convert span kind
   */
  private convertKind(kind: ServalSpan['kind']): OtelSpanKind {
    switch (kind) {
      case 'server':
        return OtelSpanKind.SERVER;
      case 'client':
        return OtelSpanKind.CLIENT;
      case 'internal':
        return OtelSpanKind.INTERNAL;
      default:
        return OtelSpanKind.INTERNAL;
    }
  }

  /**
   * Convert status
   */
  private convertStatus(status: ServalSpan['status']): OtelStatusCode {
    switch (status) {
      case 'ok':
        return OtelStatusCode.OK;
      case 'error':
        return OtelStatusCode.ERROR;
      case 'unset':
        return OtelStatusCode.UNSET;
      default:
        return OtelStatusCode.UNSET;
    }
  }

  /**
   * Convert attributes to OTLP format
   */
  private convertAttributes(attrs: Record<string, OtelAttributeValue>): OtelSpan['attributes'] {
    return Object.entries(attrs).map(([key, value]) => {
      if (typeof value === 'string') {
        return { key, value: { stringValue: value } };
      } else if (typeof value === 'number') {
        return { key, value: { intValue: value.toString() } };
      } else if (typeof value === 'boolean') {
        return { key, value: { boolValue: value } };
      } else if (Array.isArray(value)) {
        return {
          key,
          value: {
            arrayValue: {
              values: value.map((v) => ({ stringValue: String(v) })),
            },
          },
        };
      }
      return { key, value: { stringValue: String(value) } };
    });
  }

  /**
   * Convert microseconds to nanoseconds string
   * Input: microseconds (Date.now() * 1000)
   * Output: nanoseconds as string for OTLP
   */
  private msToNano(microseconds: number): string {
    return (BigInt(microseconds) * BigInt(1000)).toString();
  }

  /**
   * Pad hex string to required length
   */
  private padHex(hex: string, length: number): string {
    // Remove any non-hex characters and lowercase
    const clean = hex.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
    // Pad or truncate to required length
    if (clean.length >= length) {
      return clean.substring(0, length);
    }
    return clean.padStart(length, '0');
  }

  /**
   * Get exporter statistics
   */
  getStats(): {
    enabled: boolean;
    spansExported: number;
    exportErrors: number;
    lastExportTime: number;
    bufferSize: number;
    pendingExports: number;
  } {
    return {
      enabled: this.config.enabled,
      ...this.stats,
      bufferSize: this.spanBuffer.length,
      pendingExports: this.pendingExports,
    };
  }

  /**
   * Flush remaining spans and shutdown
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.exportTimer) {
      clearInterval(this.exportTimer);
    }

    // Export remaining spans
    if (this.spanBuffer.length > 0) {
      await this.export();
    }

    // Wait for pending exports
    const maxWait = 5000;
    const start = Date.now();
    while (this.pendingExports > 0 && Date.now() - start < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    logger.info('OTLP exporter shutdown', this.stats);
  }
}

// Singleton instance
let exporterInstance: OtlpExporter | null = null;

/**
 * Get or create the OTLP exporter singleton
 */
export function getOtlpExporter(config?: Partial<OtlpExporterConfig>): OtlpExporter {
  if (!exporterInstance) {
    exporterInstance = new OtlpExporter(config);
  }
  return exporterInstance;
}

/**
 * Hook into ServalSheets tracing to export spans
 *
 * Call this during server initialization to enable OTLP export
 */
export function enableOtlpExport(config?: Partial<OtlpExporterConfig>): {
  exporter: OtlpExporter;
  addSpan: (span: ServalSpan) => void;
} {
  const exporter = getOtlpExporter(config);
  return {
    exporter,
    addSpan: (span: ServalSpan) => exporter.addSpan(span),
  };
}

/**
 * Shutdown OTLP exporter and flush remaining spans
 */
export async function shutdownOtlpExporter(): Promise<void> {
  if (exporterInstance) {
    await exporterInstance.shutdown();
    exporterInstance = null;
  }
}
