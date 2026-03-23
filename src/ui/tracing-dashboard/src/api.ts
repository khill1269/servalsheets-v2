/**
 * API client for ServalSheets tracing endpoints
 */

import type { RequestTrace, TraceStats, TraceSearchFilters } from './types';

const BASE_URL = '/traces';

class TracingAPI {
  async getRecentTraces(limit: number = 100): Promise<RequestTrace[]> {
    const response = await fetch(`${BASE_URL}/recent?limit=${limit}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch recent traces: ${response.statusText}`);
    }
    const data = await response.json();
    return data.traces as RequestTrace[];
  }

  async searchTraces(filters: TraceSearchFilters): Promise<RequestTrace[]> {
    const params = new URLSearchParams();
    if (filters.tool) params.append('tool', filters.tool);
    if (filters.action) params.append('action', filters.action);
    if (filters.errorCode) params.append('errorCode', filters.errorCode);
    if (filters.minDuration !== undefined)
      params.append('minDuration', filters.minDuration.toString());
    if (filters.maxDuration !== undefined)
      params.append('maxDuration', filters.maxDuration.toString());
    if (filters.success !== undefined) params.append('success', filters.success.toString());
    if (filters.startTime !== undefined) params.append('startTime', filters.startTime.toString());
    if (filters.endTime !== undefined) params.append('endTime', filters.endTime.toString());

    const response = await fetch(`${BASE_URL}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to search traces: ${response.statusText}`);
    }
    const data = await response.json();
    return data.traces as RequestTrace[];
  }

  async getSlowestTraces(limit: number = 10): Promise<RequestTrace[]> {
    const response = await fetch(`${BASE_URL}/slow?limit=${limit}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch slowest traces: ${response.statusText}`);
    }
    const data = await response.json();
    return data.traces as RequestTrace[];
  }

  async getErrorTraces(limit?: number): Promise<RequestTrace[]> {
    const url = limit ? `${BASE_URL}/errors?limit=${limit}` : `${BASE_URL}/errors`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch error traces: ${response.statusText}`);
    }
    const data = await response.json();
    return data.traces as RequestTrace[];
  }

  async getStats(): Promise<TraceStats> {
    const response = await fetch(`${BASE_URL}/stats`);
    if (!response.ok) {
      throw new Error(`Failed to fetch trace stats: ${response.statusText}`);
    }
    const data = await response.json();
    return data.stats as TraceStats;
  }

  async getTrace(requestId: string): Promise<RequestTrace> {
    const response = await fetch(`${BASE_URL}/${requestId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch trace: ${response.statusText}`);
    }
    const data = await response.json();
    return data.trace as RequestTrace;
  }

  streamLiveTraces(
    onTrace: (trace: RequestTrace) => void,
    onError?: (error: Error) => void
  ): () => void {
    const eventSource = new EventSource(`${BASE_URL}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const trace = JSON.parse(event.data) as RequestTrace;
        onTrace(trace);
      } catch (error) {
        console.error('Failed to parse trace event:', error);
        onError?.(error as Error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      onError?.(new Error('Connection lost'));
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }
}

export const tracingAPI = new TracingAPI();
