import type { Request } from 'express';
import { logger } from '../utils/logger.js';

function coerceHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function firstForwardedIp(value: string | string[] | undefined): string | undefined {
  return coerceHeaderValue(value)?.split(',')[0]?.trim();
}

export function normalizeClientIp(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  let ip = raw.trim();
  if (!ip) {
    return undefined;
  }

  // Handle bracketed IPv6 host:port forms like [2001:db8::1]:1234.
  if (ip.startsWith('[')) {
    const closingBracket = ip.indexOf(']');
    if (closingBracket > 1) {
      ip = ip.slice(1, closingBracket);
    }
  }

  // Strip ports from IPv4 host:port forms without touching bare IPv6 addresses.
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) {
    ip = ip.replace(/:\d+$/, '');
  }

  if (ip.startsWith('::ffff:')) {
    ip = ip.slice('::ffff:'.length);
  }

  return ip;
}

export function extractTrustedClientIp(req: Request, fallback = '127.0.0.1'): string {
  const trustProxy = Boolean(req.app.get('trust proxy'));
  const forwardedFor = req.headers['x-forwarded-for'];

  if (!trustProxy && forwardedFor) {
    logger.warn('Ignoring x-forwarded-for header because trust proxy is disabled', {
      method: req.method,
      path: req.path,
    });
  }

  const candidates = trustProxy
    ? [req.ip, firstForwardedIp(forwardedFor), req.socket.remoteAddress]
    : [req.socket.remoteAddress, req.ip];

  for (const candidate of candidates) {
    const normalized = normalizeClientIp(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return fallback;
}
