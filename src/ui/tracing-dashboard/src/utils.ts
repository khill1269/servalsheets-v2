/**
 * Utility functions for tracing dashboard
 */

import type { RequestTrace, TraceSpan, FlameGraphNode } from './types';

export function formatDuration(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(0)}μs`;
  }
  if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function getStatusColor(success: boolean): string {
  return success ? '#10b981' : '#ef4444';
}

export function getSpanStatusColor(status: 'ok' | 'error' | 'unset'): string {
  switch (status) {
    case 'ok':
      return '#10b981';
    case 'error':
      return '#ef4444';
    case 'unset':
      return '#6b7280';
  }
}

export function traceToFlameGraph(trace: RequestTrace): FlameGraphNode {
  const spanMap = new Map<string, TraceSpan>();
  const childrenMap = new Map<string, TraceSpan[]>();

  for (const span of trace.spans) {
    spanMap.set(span.spanId, span);

    if (span.parentSpanId) {
      const siblings = childrenMap.get(span.parentSpanId) || [];
      siblings.push(span);
      childrenMap.set(span.parentSpanId, siblings);
    }
  }

  const rootSpans = trace.spans.filter((s) => !s.parentSpanId);

  function buildNode(span: TraceSpan): FlameGraphNode {
    const children = childrenMap.get(span.spanId) || [];
    const childNodes = children.map(buildNode);

    return {
      name: span.name,
      value: span.duration,
      children: childNodes.length > 0 ? childNodes : undefined,
      tooltip: `${span.name}\nDuration: ${formatDuration(span.duration)}\nStatus: ${span.status}`,
      color: getSpanStatusColor(span.status),
    };
  }

  const rootNodes = rootSpans.map(buildNode);

  return {
    name: `${trace.tool}.${trace.action}`,
    value: trace.duration,
    children: rootNodes,
    tooltip: `${trace.tool}.${trace.action}\nTotal: ${formatDuration(trace.duration)}`,
    color: getStatusColor(trace.success),
  };
}

export function exportTracesAsJSON(traces: RequestTrace[], filename: string = 'traces.json'): void {
  const json = JSON.stringify(traces, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
