import { describe, expect, it } from 'vitest';
import { getTracer, initTracer, withToolSpan, type SpanContext } from '../../src/utils/tracing.js';

describe('withToolSpan parent context propagation', () => {
  it('links tool span to provided parent context', async () => {
    initTracer({ enabled: true, logSpans: false });
    const tracer = getTracer();
    tracer.clearSpans();

    const parent: SpanContext = {
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '89abcdef01234567',
      traceFlags: 1,
    };

    await withToolSpan(
      'sheets_data',
      async () => {
        // no-op
      },
      { 'test.case': 'parent-context' },
      parent
    );

    const spans = tracer.getSpans().filter((span) => span.name === 'tool.sheets_data');
    expect(spans.length).toBeGreaterThan(0);
    const latest = spans[spans.length - 1]!;

    expect(latest.context.traceId).toBe(parent.traceId);
    expect(latest.parentSpanId).toBe(parent.spanId);
    expect(latest.attributes['tool.name']).toBe('sheets_data');
  });
});
