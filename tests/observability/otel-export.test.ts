/**
 * OTLP Exporter Tests
 *
 * Tests for OpenTelemetry OTLP export integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  OtlpExporter,
  getOtlpExporter,
  shutdownOtlpExporter,
} from '../../src/observability/otel-export.js';
import type { ServalSpan } from '../../src/observability/otel-export.js';

describe('OtlpExporter', () => {
  let exporter: OtlpExporter;

  // Mock fetch globally
  const originalFetch = global.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'OK',
    } as Response);
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await shutdownOtlpExporter();
  });

  describe('constructor', () => {
    it('should initialize with default config when disabled', () => {
      exporter = new OtlpExporter({ enabled: false });
      const stats = exporter.getStats();
      expect(stats.enabled).toBe(false);
      expect(stats.bufferSize).toBe(0);
    });

    it('should initialize with custom config when enabled', () => {
      exporter = new OtlpExporter({
        enabled: true,
        serviceName: 'test-service',
        batchSize: 50,
      });
      const stats = exporter.getStats();
      expect(stats.enabled).toBe(true);
    });
  });

  describe('addSpan', () => {
    it('should not buffer spans when disabled', () => {
      exporter = new OtlpExporter({ enabled: false });
      const span: ServalSpan = createTestSpan();
      exporter.addSpan(span);
      const stats = exporter.getStats();
      expect(stats.bufferSize).toBe(0);
    });

    it('should buffer spans when enabled', () => {
      exporter = new OtlpExporter({ enabled: true, exportIntervalMs: 60000 });
      const span = createTestSpan();
      exporter.addSpan(span);
      const stats = exporter.getStats();
      expect(stats.bufferSize).toBe(1);
    });

    it('should auto-flush when batch size reached', async () => {
      exporter = new OtlpExporter({ enabled: true, batchSize: 2, exportIntervalMs: 60000 });

      exporter.addSpan(createTestSpan({ name: 'span1' }));
      expect(exporter.getStats().bufferSize).toBe(1);

      exporter.addSpan(createTestSpan({ name: 'span2' }));

      // Wait for async export to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(exporter.getStats().bufferSize).toBe(0);
    });
  });

  describe('export', () => {
    it('should not export when buffer is empty', async () => {
      exporter = new OtlpExporter({ enabled: true });
      await exporter.export();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should export buffered spans', async () => {
      exporter = new OtlpExporter({ enabled: true, exportIntervalMs: 60000 });
      exporter.addSpan(createTestSpan());
      await exporter.export();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain('/v1/traces');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
    });

    it('should include resource attributes in export', async () => {
      exporter = new OtlpExporter({
        enabled: true,
        serviceName: 'test-service',
        exportIntervalMs: 60000,
      });
      exporter.addSpan(createTestSpan());
      await exporter.export();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const resource = body.resourceSpans[0].resource;
      const attrs = resource.attributes;

      expect(attrs.find((a: { key: string }) => a.key === 'service.name').value.stringValue).toBe(
        'test-service'
      );
      expect(
        attrs.find((a: { key: string }) => a.key === 'telemetry.sdk.name').value.stringValue
      ).toBe('servalsheets-tracing');
    });

    it('should handle export errors gracefully', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      exporter = new OtlpExporter({ enabled: true, exportIntervalMs: 60000 });
      exporter.addSpan(createTestSpan());

      await exporter.export();

      const stats = exporter.getStats();
      expect(stats.exportErrors).toBe(1);
      expect(stats.bufferSize).toBe(0); // Spans are lost on error
    });
  });

  describe('span conversion', () => {
    it('should convert traceId and spanId to correct format', async () => {
      exporter = new OtlpExporter({ enabled: true, exportIntervalMs: 60000 });
      exporter.addSpan(
        createTestSpan({
          traceId: 'abc123',
          spanId: 'def456',
        })
      );
      await exporter.export();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const span = body.resourceSpans[0].scopeSpans[0].spans[0];

      // Should be padded to 32 hex chars for traceId, 16 for spanId
      expect(span.traceId).toHaveLength(32);
      expect(span.spanId).toHaveLength(16);
    });

    it('should convert microseconds to nanoseconds', async () => {
      const startMicros = Date.now() * 1000; // Current time in microseconds
      const endMicros = startMicros + 5000; // 5ms later

      exporter = new OtlpExporter({ enabled: true, exportIntervalMs: 60000 });
      exporter.addSpan(
        createTestSpan({
          startTime: startMicros,
          endTime: endMicros,
        })
      );
      await exporter.export();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const span = body.resourceSpans[0].scopeSpans[0].spans[0];

      // Nanoseconds should be microseconds * 1000
      expect(BigInt(span.startTimeUnixNano)).toBe(BigInt(startMicros) * BigInt(1000));
      expect(BigInt(span.endTimeUnixNano)).toBe(BigInt(endMicros) * BigInt(1000));
    });

    it('should convert span kind correctly', async () => {
      exporter = new OtlpExporter({ enabled: true, exportIntervalMs: 60000 });

      // Test all span kinds
      exporter.addSpan(createTestSpan({ kind: 'server' }));
      exporter.addSpan(createTestSpan({ kind: 'client' }));
      exporter.addSpan(createTestSpan({ kind: 'internal' }));
      await exporter.export();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const spans = body.resourceSpans[0].scopeSpans[0].spans;

      expect(spans[0].kind).toBe(1); // SERVER
      expect(spans[1].kind).toBe(2); // CLIENT
      expect(spans[2].kind).toBe(0); // INTERNAL
    });

    it('should convert status codes correctly', async () => {
      exporter = new OtlpExporter({ enabled: true, exportIntervalMs: 60000 });

      exporter.addSpan(createTestSpan({ status: 'ok' }));
      exporter.addSpan(createTestSpan({ status: 'error' }));
      exporter.addSpan(createTestSpan({ status: 'unset' }));
      await exporter.export();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const spans = body.resourceSpans[0].scopeSpans[0].spans;

      expect(spans[0].status.code).toBe(1); // OK
      expect(spans[1].status.code).toBe(2); // ERROR
      expect(spans[2].status.code).toBe(0); // UNSET
    });

    it('should convert attributes correctly', async () => {
      exporter = new OtlpExporter({ enabled: true, exportIntervalMs: 60000 });
      exporter.addSpan(
        createTestSpan({
          attributes: {
            stringAttr: 'value',
            numberAttr: 42,
            boolAttr: true,
            arrayAttr: ['a', 'b', 'c'],
          },
        })
      );
      await exporter.export();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const attrs = body.resourceSpans[0].scopeSpans[0].spans[0].attributes;

      expect(attrs.find((a: { key: string }) => a.key === 'stringAttr').value.stringValue).toBe(
        'value'
      );
      expect(attrs.find((a: { key: string }) => a.key === 'numberAttr').value.intValue).toBe('42');
      expect(attrs.find((a: { key: string }) => a.key === 'boolAttr').value.boolValue).toBe(true);
      expect(
        attrs.find((a: { key: string }) => a.key === 'arrayAttr').value.arrayValue.values
      ).toHaveLength(3);
    });

    it('should include parent span ID when present', async () => {
      exporter = new OtlpExporter({ enabled: true, exportIntervalMs: 60000 });
      exporter.addSpan(createTestSpan({ parentId: 'abcdef123456' }));
      await exporter.export();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const span = body.resourceSpans[0].scopeSpans[0].spans[0];

      // Should be padded to 16 hex characters
      expect(span.parentSpanId).toBe('0000abcdef123456');
    });

    it('should include events when present', async () => {
      exporter = new OtlpExporter({ enabled: true, exportIntervalMs: 60000 });
      const eventTime = Date.now() * 1000;
      exporter.addSpan(
        createTestSpan({
          events: [
            {
              name: 'test-event',
              time: eventTime,
              attributes: { eventAttr: 'value' },
            },
          ],
        })
      );
      await exporter.export();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const events = body.resourceSpans[0].scopeSpans[0].spans[0].events;

      expect(events).toHaveLength(1);
      expect(events[0].name).toBe('test-event');
      expect(BigInt(events[0].timeUnixNano)).toBe(BigInt(eventTime) * BigInt(1000));
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', () => {
      exporter = new OtlpExporter({ enabled: true, exportIntervalMs: 60000 });
      exporter.addSpan(createTestSpan());
      exporter.addSpan(createTestSpan());

      const stats = exporter.getStats();
      expect(stats.enabled).toBe(true);
      expect(stats.bufferSize).toBe(2);
      expect(stats.spansExported).toBe(0);
      expect(stats.exportErrors).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('should flush remaining spans on shutdown', async () => {
      exporter = new OtlpExporter({ enabled: true, exportIntervalMs: 60000 });
      exporter.addSpan(createTestSpan());
      exporter.addSpan(createTestSpan());

      await exporter.shutdown();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should wait for pending exports', async () => {
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () => resolve({ ok: true, status: 200, text: async () => 'OK' } as Response),
              100
            );
          })
      );

      exporter = new OtlpExporter({ enabled: true, exportIntervalMs: 60000 });
      exporter.addSpan(createTestSpan());

      const exportPromise = exporter.export();
      const shutdownPromise = exporter.shutdown();

      await Promise.all([exportPromise, shutdownPromise]);

      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe('singleton functions', () => {
    it('should return same instance from getOtlpExporter', () => {
      const instance1 = getOtlpExporter({ enabled: true });
      const instance2 = getOtlpExporter();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after shutdown', async () => {
      const instance1 = getOtlpExporter({ enabled: true });
      await shutdownOtlpExporter();
      const instance2 = getOtlpExporter({ enabled: true });
      expect(instance1).not.toBe(instance2);
    });
  });
});

// ==================== Test Helpers ====================

function createTestSpan(overrides: Partial<ServalSpan> = {}): ServalSpan {
  const now = Date.now() * 1000; // microseconds
  return {
    traceId: 'abc123def456',
    spanId: '123456',
    name: 'test-span',
    kind: 'internal',
    startTime: now,
    endTime: now + 1000, // 1ms duration
    attributes: {},
    status: 'ok',
    ...overrides,
  };
}
