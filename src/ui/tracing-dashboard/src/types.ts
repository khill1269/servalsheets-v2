/**
 * Types for ServalSheets tracing dashboard
 * Based on src/services/trace-aggregator.ts
 */

export interface TraceSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: 'server' | 'client' | 'internal' | 'producer' | 'consumer';
  startTime: number;
  endTime: number;
  duration: number;
  attributes: Record<string, string | number | boolean | undefined>;
  status: 'ok' | 'error' | 'unset';
  statusMessage?: string;
  events?: Array<{
    name: string;
    timestamp: number;
    attributes?: Record<string, string | number | boolean | undefined>;
  }>;
}

export interface RequestTrace {
  requestId: string;
  traceId: string;
  timestamp: number;
  duration: number;
  tool: string;
  action: string;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  spans: TraceSpan[];
  metadata?: Record<string, unknown>;
}

export interface TraceStats {
  totalTraces: number;
  successCount: number;
  errorCount: number;
  averageDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;
  byTool: Record<
    string,
    {
      count: number;
      averageDuration: number;
      errorRate: number;
    }
  >;
  byError: Record<string, number>;
}

export interface TraceSearchFilters {
  tool?: string;
  action?: string;
  errorCode?: string;
  minDuration?: number;
  maxDuration?: number;
  success?: boolean;
  startTime?: number;
  endTime?: number;
}

// D3 Flame Graph data format
export interface FlameGraphNode {
  name: string;
  value: number;
  children?: FlameGraphNode[];
  tooltip?: string;
  color?: string;
}
