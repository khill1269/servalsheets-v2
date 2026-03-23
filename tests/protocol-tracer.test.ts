import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ProtocolTracer,
  getProtocolTracer,
  resetProtocolTracer,
} from '../scripts/test-infrastructure/protocol-tracer.js';
import type { ErrorDetail } from '../src/utils/error-factory.js';

describe('ProtocolTracer', () => {
  let tracer: ProtocolTracer;

  beforeEach(() => {
    tracer = new ProtocolTracer({ enabled: true, maxBufferSize: 10 });
  });

  afterEach(() => {
    resetProtocolTracer();
  });

  describe('startTrace', () => {
    it('should create a new trace', () => {
      const traceId = tracer.startTrace('corr-123', 'sheets_data/read', {
        spreadsheetId: 'abc123',
        range: 'Sheet1!A1:B10',
      });

      expect(traceId).toEqual(expect.any(String));
      expect(traceId.length).toBeGreaterThan(0);
      const trace = tracer.getTrace(traceId);
      expect(trace).toBeDefined();
      expect(trace?.correlationId).toBe('corr-123');
      expect(trace?.method).toBe('sheets_data/read');
      expect(trace?.protocol).toBe('mcp');
    });

    it('should support custom protocol type', () => {
      const traceId = tracer.startTrace(
        'corr-123',
        'spreadsheets.values.get',
        { foo: 'bar' },
        {
          protocol: 'google-api',
        }
      );

      const trace = tracer.getTrace(traceId);
      expect(trace?.protocol).toBe('google-api');
    });

    it('should support custom metadata', () => {
      const traceId = tracer.startTrace(
        'corr-123',
        'test',
        {},
        {
          metadata: { toolName: 'sheets_data', action: 'read', spreadsheetId: 'abc123' },
        }
      );

      const trace = tracer.getTrace(traceId);
      expect(trace?.metadata.toolName).toBe('sheets_data');
      expect(trace?.metadata.action).toBe('read');
      expect(trace?.metadata.spreadsheetId).toBe('abc123');
    });

    it('should return empty string when disabled', () => {
      const disabledTracer = new ProtocolTracer({ enabled: false });
      const traceId = disabledTracer.startTrace('corr-123', 'test', {});

      expect(traceId).toBe('');
    });
  });

  describe('completeTrace', () => {
    it('should complete a trace with response', () => {
      const traceId = tracer.startTrace('corr-123', 'test', {});

      tracer.completeTrace(traceId, {
        response: { success: true, data: [1, 2, 3] },
      });

      const trace = tracer.getTrace(traceId);
      expect(trace?.response).toEqual({ success: true, data: [1, 2, 3] });
      expect(trace?.duration).toBeGreaterThanOrEqual(0);
      expect(trace?.error).toBeUndefined();
    });

    it('should complete a trace with error', () => {
      const traceId = tracer.startTrace('corr-123', 'test', {});

      const error: ErrorDetail = {
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded',
        category: 'quota',
        severity: 'high',
        retryable: true,
      };

      tracer.completeTrace(traceId, { error });

      const trace = tracer.getTrace(traceId);
      expect(trace?.error).toEqual(error);
      expect(trace?.response).toBeUndefined();
    });

    it('should merge metadata on completion', () => {
      const traceId = tracer.startTrace(
        'corr-123',
        'test',
        {},
        {
          metadata: { toolName: 'sheets_data' },
        }
      );

      tracer.completeTrace(traceId, {
        response: { success: true },
        metadata: { httpStatus: 200, retryCount: 0 },
      });

      const trace = tracer.getTrace(traceId);
      expect(trace?.metadata.toolName).toBe('sheets_data');
      expect(trace?.metadata.httpStatus).toBe(200);
      expect(trace?.metadata.retryCount).toBe(0);
    });

    it('should handle completing non-existent trace gracefully', () => {
      expect(() => {
        tracer.completeTrace('non-existent', { response: {} });
      }).not.toThrow();
    });
  });

  describe('getTracesForCorrelation', () => {
    it('should return all traces for a correlation ID', () => {
      const corrId = 'corr-batch-123';

      const trace1 = tracer.startTrace(corrId, 'operation1', {});
      const trace2 = tracer.startTrace(corrId, 'operation2', {});
      const trace3 = tracer.startTrace('other-corr', 'operation3', {});

      const traces = tracer.getTracesForCorrelation(corrId);

      expect(traces).toHaveLength(2);
      expect(traces.map((t) => t.traceId).sort()).toEqual([trace1, trace2].sort());
      expect(traces.find((t) => t.traceId === trace3)).toBeUndefined();
    });

    it('should return empty array for unknown correlation ID', () => {
      const traces = tracer.getTracesForCorrelation('unknown');
      expect(traces).toEqual([]);
    });
  });

  describe('circular buffer', () => {
    it('should maintain max buffer size', () => {
      const smallTracer = new ProtocolTracer({ enabled: true, maxBufferSize: 3 });

      const trace1 = smallTracer.startTrace('c1', 'op1', {});
      const trace2 = smallTracer.startTrace('c2', 'op2', {});
      const trace3 = smallTracer.startTrace('c3', 'op3', {});
      const trace4 = smallTracer.startTrace('c4', 'op4', {});

      const allTraces = smallTracer.getAllTraces();
      expect(allTraces).toHaveLength(3);

      // First trace should be evicted
      expect(smallTracer.getTrace(trace1)).toBeUndefined();
      expect(smallTracer.getTrace(trace2)).toBeDefined();
      expect(smallTracer.getTrace(trace3)).toBeDefined();
      expect(smallTracer.getTrace(trace4)).toBeDefined();
    });
  });

  describe('export formats', () => {
    beforeEach(() => {
      const trace1 = tracer.startTrace('corr-1', 'operation1', { input: 'test1' });
      tracer.completeTrace(trace1, { response: { output: 'result1' } });

      const trace2 = tracer.startTrace(
        'corr-2',
        'operation2',
        { input: 'test2' },
        { protocol: 'google-api' }
      );
      tracer.completeTrace(trace2, {
        response: { output: 'result2' },
        metadata: { httpStatus: 200 },
      });
    });

    it('should export as JSON', () => {
      const json = tracer.exportTraces('json');
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toHaveProperty('traceId');
      expect(parsed[0]).toHaveProperty('correlationId');
      expect(parsed[0]).toHaveProperty('method');
    });

    it('should export as JSONL', () => {
      const jsonl = tracer.exportTraces('jsonl');
      const lines = jsonl.split('\n').filter((line) => line.trim());

      expect(lines).toHaveLength(2);

      const parsed1 = JSON.parse(lines[0]!);
      const parsed2 = JSON.parse(lines[1]!);

      expect(parsed1).toHaveProperty('traceId');
      expect(parsed2).toHaveProperty('traceId');
    });

    it('should export as HAR format', () => {
      const har = tracer.exportTraces('har');
      const parsed = JSON.parse(har);

      expect(parsed).toHaveProperty('log');
      expect(parsed.log).toHaveProperty('version', '1.2');
      expect(parsed.log).toHaveProperty('creator');
      expect(parsed.log).toHaveProperty('entries');

      // Only Google API traces should be in HAR
      expect(parsed.log.entries).toHaveLength(1);
      expect(parsed.log.entries[0]).toHaveProperty('request');
      expect(parsed.log.entries[0]).toHaveProperty('response');
      expect(parsed.log.entries[0]).toHaveProperty('timings');
    });

    it('should export specific traces by ID', () => {
      const trace1 = tracer.startTrace('corr-3', 'operation3', {});
      tracer.startTrace('corr-4', 'operation4', {});

      const json = tracer.exportTraces('json', [trace1]);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].traceId).toBe(trace1);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const trace1 = tracer.startTrace('c1', 'mcp-op', {}, { protocol: 'mcp' });
      tracer.completeTrace(trace1, { response: {} });

      const trace2 = tracer.startTrace('c2', 'google-op', {}, { protocol: 'google-api' });
      tracer.completeTrace(trace2, { response: {} });

      const trace3 = tracer.startTrace('c3', 'mcp-op', {}, { protocol: 'mcp' });
      const error: ErrorDetail = {
        code: 'ERROR',
        message: 'Failed',
        category: 'validation',
        severity: 'high',
        retryable: false,
      };
      tracer.completeTrace(trace3, { error });

      const stats = tracer.getStats();

      expect(stats.total).toBe(3);
      expect(stats.byProtocol.mcp).toBe(2);
      expect(stats.byProtocol['google-api']).toBe(1);
      expect(stats.byMethod['mcp-op']).toBe(2);
      expect(stats.byMethod['google-op']).toBe(1);
      expect(stats.errorCount).toBe(1);
      expect(stats.averageDuration).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty traces', () => {
      const emptyTracer = new ProtocolTracer({ enabled: true });
      const stats = emptyTracer.getStats();

      expect(stats.total).toBe(0);
      expect(stats.errorCount).toBe(0);
      expect(stats.averageDuration).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all traces', () => {
      tracer.startTrace('c1', 'op1', {});
      tracer.startTrace('c2', 'op2', {});

      expect(tracer.getAllTraces()).toHaveLength(2);

      tracer.clear();

      expect(tracer.getAllTraces()).toHaveLength(0);
      expect(tracer.getStats().total).toBe(0);
    });
  });

  describe('global tracer', () => {
    afterEach(() => {
      resetProtocolTracer();
      delete process.env.PROTOCOL_TRACE_ENABLED;
      delete process.env.PROTOCOL_TRACE_BUFFER_SIZE;
    });

    it('should create global tracer with environment config', () => {
      process.env.PROTOCOL_TRACE_ENABLED = 'true';
      process.env.PROTOCOL_TRACE_BUFFER_SIZE = '500';

      const globalTracer = getProtocolTracer();

      expect(globalTracer).toBeDefined();
      expect(globalTracer.isEnabled()).toBe(true);
    });

    it('should reuse existing global tracer', () => {
      const tracer1 = getProtocolTracer();
      const tracer2 = getProtocolTracer();

      expect(tracer1).toBe(tracer2);
    });

    it('should reset global tracer', () => {
      const tracer1 = getProtocolTracer();
      resetProtocolTracer();
      const tracer2 = getProtocolTracer();

      expect(tracer1).not.toBe(tracer2);
    });
  });

  describe('disabled tracer', () => {
    it('should not capture traces when disabled', () => {
      const disabledTracer = new ProtocolTracer({ enabled: false });

      const traceId = disabledTracer.startTrace('c1', 'op1', {});

      expect(traceId).toBe('');
      expect(disabledTracer.getAllTraces()).toHaveLength(0);
    });

    it('should not throw when completing disabled traces', () => {
      const disabledTracer = new ProtocolTracer({ enabled: false });

      expect(() => {
        disabledTracer.completeTrace('any-id', { response: {} });
      }).not.toThrow();
    });
  });
});
