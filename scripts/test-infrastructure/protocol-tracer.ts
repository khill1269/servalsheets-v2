/**
 * Protocol tracer for MCP and Google API request/response flows used in test infrastructure.
 */

import { randomUUID } from 'crypto';
import type { ErrorDetail } from '../../src/schemas/shared.js';

type TraceProtocol = 'mcp' | 'google-api';
type TraceFormat = 'json' | 'jsonl' | 'har';

export interface ProtocolTrace {
  traceId: string;
  correlationId: string;
  method: string;
  protocol: TraceProtocol;
  request: unknown;
  response?: unknown;
  error?: ErrorDetail;
  duration?: number;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface ProtocolTracerOptions {
  enabled?: boolean;
  maxBufferSize?: number;
}

interface StartTraceOptions {
  protocol?: TraceProtocol;
  metadata?: Record<string, unknown>;
}

interface CompleteTraceInput {
  response?: unknown;
  error?: ErrorDetail;
  metadata?: Record<string, unknown>;
}

interface ProtocolTraceStats {
  total: number;
  byProtocol: Record<string, number>;
  byMethod: Record<string, number>;
  errorCount: number;
  averageDuration: number;
}

const DEFAULT_MAX_BUFFER = 1000;

export class ProtocolTracer {
  private readonly enabled: boolean;
  private readonly maxBufferSize: number;
  private readonly traces = new Map<string, ProtocolTrace>();
  private readonly startTimes = new Map<string, number>();

  constructor(options: ProtocolTracerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.maxBufferSize = Math.max(1, options.maxBufferSize ?? DEFAULT_MAX_BUFFER);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  startTrace(
    correlationId: string,
    method: string,
    request: unknown,
    options: StartTraceOptions = {}
  ): string {
    if (!this.enabled) {
      return '';
    }

    const traceId = randomUUID();
    const protocol = options.protocol ?? 'mcp';

    this.ensureBufferCapacity();
    this.startTimes.set(traceId, Date.now());
    this.traces.set(traceId, {
      traceId,
      correlationId,
      method,
      protocol,
      request,
      timestamp: new Date().toISOString(),
      metadata: { ...(options.metadata ?? {}) },
    });

    return traceId;
  }

  completeTrace(traceId: string, completion: CompleteTraceInput): void {
    if (!this.enabled) {
      return;
    }

    const trace = this.traces.get(traceId);
    if (!trace) {
      return;
    }

    if (completion.response !== undefined) {
      trace.response = completion.response;
    }
    if (completion.error !== undefined) {
      trace.error = completion.error;
    }
    if (completion.metadata) {
      trace.metadata = { ...trace.metadata, ...completion.metadata };
    }

    const startedAt = this.startTimes.get(traceId);
    if (startedAt !== undefined) {
      trace.duration = Date.now() - startedAt;
      this.startTimes.delete(traceId);
    }
  }

  getTrace(traceId: string): ProtocolTrace | undefined {
    return this.traces.get(traceId);
  }

  getAllTraces(): ProtocolTrace[] {
    return Array.from(this.traces.values());
  }

  getTracesForCorrelation(correlationId: string): ProtocolTrace[] {
    return this.getAllTraces().filter((trace) => trace.correlationId === correlationId);
  }

  exportTraces(format: TraceFormat = 'json', traceIds?: string[]): string {
    const traces = this.selectTraces(traceIds);

    if (format === 'json') {
      return JSON.stringify(traces, null, 2);
    }

    if (format === 'jsonl') {
      return traces.map((trace) => JSON.stringify(trace)).join('\n');
    }

    return JSON.stringify(this.toHar(traces), null, 2);
  }

  getStats(): ProtocolTraceStats {
    const traces = this.getAllTraces();
    const byProtocol: Record<string, number> = { mcp: 0, 'google-api': 0 };
    const byMethod: Record<string, number> = {};
    let errorCount = 0;
    let durationTotal = 0;

    for (const trace of traces) {
      byProtocol[trace.protocol] = (byProtocol[trace.protocol] ?? 0) + 1;
      byMethod[trace.method] = (byMethod[trace.method] ?? 0) + 1;

      if (trace.error) {
        errorCount += 1;
      }
      if (typeof trace.duration === 'number') {
        durationTotal += trace.duration;
      }
    }

    return {
      total: traces.length,
      byProtocol,
      byMethod,
      errorCount,
      averageDuration: traces.length > 0 ? durationTotal / traces.length : 0,
    };
  }

  clear(): void {
    this.traces.clear();
    this.startTimes.clear();
  }

  private ensureBufferCapacity(): void {
    if (this.traces.size < this.maxBufferSize) {
      return;
    }

    const oldest = this.traces.keys().next().value;
    if (typeof oldest === 'string') {
      this.traces.delete(oldest);
      this.startTimes.delete(oldest);
    }
  }

  private selectTraces(traceIds?: string[]): ProtocolTrace[] {
    if (!traceIds || traceIds.length === 0) {
      return this.getAllTraces();
    }

    const idSet = new Set(traceIds);
    return this.getAllTraces().filter((trace) => idSet.has(trace.traceId));
  }

  private toHar(traces: ProtocolTrace[]): unknown {
    const entries = traces
      .filter((trace) => trace.protocol === 'google-api')
      .map((trace) => {
        const payload = trace.response ?? trace.error ?? {};

        return {
          startedDateTime: trace.timestamp,
          time: trace.duration ?? 0,
          request: {
            method: 'POST',
            url: trace.method,
            httpVersion: 'HTTP/2',
            headers: [],
            queryString: [],
            cookies: [],
            headersSize: -1,
            bodySize: -1,
          },
          response: {
            status: trace.error ? 500 : 200,
            statusText: trace.error ? 'Error' : 'OK',
            httpVersion: 'HTTP/2',
            headers: [],
            cookies: [],
            content: {
              size: JSON.stringify(payload).length,
              mimeType: 'application/json',
              text: JSON.stringify(payload),
            },
            redirectURL: '',
            headersSize: -1,
            bodySize: -1,
          },
          cache: {},
          timings: {
            send: 0,
            wait: trace.duration ?? 0,
            receive: 0,
          },
        };
      });

    return {
      log: {
        version: '1.2',
        creator: {
          name: 'ServalSheets ProtocolTracer',
          version: '1.0.0',
        },
        entries,
      },
    };
  }
}

let globalTracer: ProtocolTracer | null = null;

export function getProtocolTracer(): ProtocolTracer {
  if (globalTracer) {
    return globalTracer;
  }

  const enabled = process.env['PROTOCOL_TRACE_ENABLED'] === 'true';
  const parsedBuffer = Number.parseInt(process.env['PROTOCOL_TRACE_BUFFER_SIZE'] ?? '', 10);
  const maxBufferSize =
    Number.isFinite(parsedBuffer) && parsedBuffer > 0 ? parsedBuffer : DEFAULT_MAX_BUFFER;

  globalTracer = new ProtocolTracer({ enabled, maxBufferSize });
  return globalTracer;
}

export function resetProtocolTracer(): void {
  globalTracer = null;
}
