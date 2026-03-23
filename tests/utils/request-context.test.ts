import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { register } from 'prom-client';

const originalEnv = { ...process.env };

describe('request-context timeout defaults', () => {
  beforeEach(() => {
    vi.resetModules();
    register.clear();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    register.clear();
    vi.resetModules();
  });

  it('falls back to 30000ms when REQUEST_TIMEOUT_MS is invalid', async () => {
    process.env['REQUEST_TIMEOUT_MS'] = '';
    delete process.env['GOOGLE_API_TIMEOUT_MS'];

    const { createRequestContext } = await import('../../src/utils/request-context.js');
    const context = createRequestContext();

    expect(context.timeoutMs).toBe(30000);
    expect(Number.isFinite(context.deadline)).toBe(true);
  });

  it('falls back to the default timeout when timeoutMs option is NaN', async () => {
    const { createRequestContext } = await import('../../src/utils/request-context.js');
    const context = createRequestContext({ timeoutMs: Number.NaN });

    expect(context.timeoutMs).toBe(30000);
    expect(Number.isFinite(context.deadline)).toBe(true);
  });

  it('preserves nested request senders when provided', async () => {
    const { createRequestContext } = await import('../../src/utils/request-context.js');
    const sendRequest = vi.fn();
    const context = createRequestContext({ sendRequest });

    expect(context.sendRequest).toBe(sendRequest);
  });
});
