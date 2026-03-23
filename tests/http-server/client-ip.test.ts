import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractTrustedClientIp } from '../../src/http-server/client-ip.js';
import { createSessionSecurityContext } from '../../src/http-server/transport-helpers.js';
import { logger } from '../../src/utils/logger.js';

function makeRequest(params: {
  trustProxy: boolean;
  reqIp?: string;
  socketIp?: string;
  forwardedFor?: string;
  method?: string;
  path?: string;
}): Request {
  const { trustProxy, reqIp, socketIp, forwardedFor, method = 'POST', path = '/mcp' } = params;

  return {
    ip: reqIp,
    method,
    path,
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    socket: { remoteAddress: socketIp },
    app: {
      get(key: string) {
        return key === 'trust proxy' ? trustProxy : undefined;
      },
    },
  } as unknown as Request;
}

describe('extractTrustedClientIp', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores x-forwarded-for when trust proxy is disabled', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const req = makeRequest({
      trustProxy: false,
      reqIp: '::ffff:127.0.0.1',
      socketIp: '::ffff:127.0.0.1',
      forwardedFor: '203.0.113.5, 203.0.113.9',
    });

    expect(extractTrustedClientIp(req)).toBe('127.0.0.1');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the first forwarded client IP when trust proxy is enabled', () => {
    const req = makeRequest({
      trustProxy: true,
      reqIp: '203.0.113.5',
      socketIp: '::ffff:10.0.0.8',
      forwardedFor: '203.0.113.5, 203.0.113.9',
    });

    expect(extractTrustedClientIp(req)).toBe('203.0.113.5');
  });

  it('preserves bare IPv6 addresses from forwarded headers', () => {
    const req = makeRequest({
      trustProxy: true,
      reqIp: '2001:db8::1',
      socketIp: '::ffff:10.0.0.8',
      forwardedFor: '2001:db8::1, 203.0.113.9',
    });

    expect(extractTrustedClientIp(req)).toBe('2001:db8::1');
  });
});

describe('createSessionSecurityContext', () => {
  it('uses the normalized trusted client IP', () => {
    const req = makeRequest({
      trustProxy: false,
      socketIp: '::ffff:10.0.0.8',
    });

    const context = createSessionSecurityContext(req, 'token-123');
    expect(context.ipAddress).toBe('10.0.0.8');
    expect(context.userAgent).toBe('unknown');
    expect(context.tokenHash).toHaveLength(16);
  });
});
