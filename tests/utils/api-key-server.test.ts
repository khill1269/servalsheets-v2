/**
 * ServalSheets — API Key Server Tests
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import net from 'node:net';
import { startApiKeyServer } from '../../src/utils/api-key-server.js';

const canListenLocalhost = await new Promise<boolean>((resolve) => {
  const server = net.createServer();
  server.once('error', () => resolve(false));
  server.listen(0, '127.0.0.1', () => {
    server.close(() => resolve(true));
  });
});

// Helper: make an HTTP request to the test server
function request(options: {
  hostname: string;
  port: number;
  path: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
}): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: options.hostname,
        port: options.port,
        path: options.path,
        method: options.method,
        headers: {
          Host: `localhost:${options.port}`,
          ...options.headers,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }));
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

describe.skipIf(!canListenLocalhost)('startApiKeyServer', () => {
  const opts = {
    provider: 'TestProvider',
    signupUrl: 'https://example.com/signup',
    hint: 'Starts with tp-...',
    timeout: 5000,
  };

  afterEach(() => {
    // nothing to tear down — each test shuts down its own server
  });

  it('starts and returns a url and keyPromise', async () => {
    const handle = await startApiKeyServer(opts);
    expect(handle.url).toMatch(/^http:\/\/localhost:\d+\/setup-key$/);
    expect(handle.keyPromise).toBeInstanceOf(Promise);
    handle.shutdown();
    await expect(handle.keyPromise).rejects.toThrow();
  });

  it('serves the HTML form on GET /setup-key', async () => {
    const handle = await startApiKeyServer(opts);
    const port = parseInt(new URL(handle.url).port, 10);

    const res = await request({ hostname: '127.0.0.1', port, path: '/setup-key', method: 'GET' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('type="password"');
    expect(res.body).toContain('TestProvider');
    expect(res.body).toContain('https://example.com/signup');
    expect(res.body).toContain('Starts with tp-...');

    handle.shutdown();
    await expect(handle.keyPromise).rejects.toThrow();
  });

  it('resolves keyPromise when a valid key is POSTed', async () => {
    const handle = await startApiKeyServer(opts);
    const port = parseInt(new URL(handle.url).port, 10);

    const body = 'apiKey=tp-abc123';
    const res = await request({
      hostname: '127.0.0.1',
      port,
      path: '/setup-key',
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Key saved');

    await expect(handle.keyPromise).resolves.toBe('tp-abc123');
  });

  it('returns 400 when POST body has no apiKey', async () => {
    const handle = await startApiKeyServer(opts);
    const port = parseInt(new URL(handle.url).port, 10);

    const res = await request({
      hostname: '127.0.0.1',
      port,
      path: '/setup-key',
      method: 'POST',
      body: 'apiKey=',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    expect(res.statusCode).toBe(400);
    handle.shutdown();
    await expect(handle.keyPromise).rejects.toThrow();
  });

  it('rejects DNS-rebinding requests (bad Host header)', async () => {
    const handle = await startApiKeyServer(opts);
    const port = parseInt(new URL(handle.url).port, 10);

    const res = await request({
      hostname: '127.0.0.1',
      port,
      path: '/setup-key',
      method: 'GET',
      headers: { Host: 'evil.attacker.com' },
    });

    expect(res.statusCode).toBe(400);
    handle.shutdown();
    await expect(handle.keyPromise).rejects.toThrow();
  });

  it('returns 404 for unknown paths', async () => {
    const handle = await startApiKeyServer(opts);
    const port = parseInt(new URL(handle.url).port, 10);

    const res = await request({
      hostname: '127.0.0.1',
      port,
      path: '/other',
      method: 'GET',
    });

    expect(res.statusCode).toBe(404);
    handle.shutdown();
    await expect(handle.keyPromise).rejects.toThrow();
  });

  it('returns 405 for unsupported methods', async () => {
    const handle = await startApiKeyServer(opts);
    const port = parseInt(new URL(handle.url).port, 10);

    const res = await request({
      hostname: '127.0.0.1',
      port,
      path: '/setup-key',
      method: 'DELETE',
    });

    expect(res.statusCode).toBe(405);
    handle.shutdown();
    await expect(handle.keyPromise).rejects.toThrow();
  });

  it('shutdown() causes keyPromise to reject', async () => {
    const handle = await startApiKeyServer(opts);
    handle.shutdown();
    await expect(handle.keyPromise).rejects.toThrow('API key server shut down');
  });

  it('second POST after key already submitted returns "already saved"', async () => {
    const handle = await startApiKeyServer(opts);
    const port = parseInt(new URL(handle.url).port, 10);

    const body = 'apiKey=tp-first';
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

    await request({ hostname: '127.0.0.1', port, path: '/setup-key', method: 'POST', body, headers });
    await expect(handle.keyPromise).resolves.toBe('tp-first');

    // Second POST — server already closed, expect connection refused or "already saved"
    const second = await request({
      hostname: '127.0.0.1',
      port,
      path: '/setup-key',
      method: 'POST',
      body: 'apiKey=tp-second',
      headers,
    }).catch(() => ({ statusCode: 0, body: '' }));

    // Either connection refused (server closed) or "already saved" response
    expect([0, 200]).toContain(second.statusCode);
  });

  it('escapes HTML in provider name and hint to prevent XSS', async () => {
    const handle = await startApiKeyServer({
      provider: '<script>alert(1)</script>',
      signupUrl: 'https://example.com',
      hint: '" onmouseover="alert(1)',
      timeout: 5000,
    });
    const port = parseInt(new URL(handle.url).port, 10);

    const res = await request({ hostname: '127.0.0.1', port, path: '/setup-key', method: 'GET' });

    expect(res.body).not.toContain('<script>alert(1)</script>');
    expect(res.body).toContain('&lt;script&gt;');
    expect(res.body).not.toContain('" onmouseover=');

    handle.shutdown();
    await expect(handle.keyPromise).rejects.toThrow();
  });
});
