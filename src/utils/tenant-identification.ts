/**
 * Resolve a stable tenant identifier for attribution systems (cost/quota/audit aggregation).
 *
 * Priority:
 * 1) Explicit tenant header (`x-tenant-id`, `tenant-id`, `x-servalsheets-tenant-id`)
 * 2) API key fingerprint (`x-api-key`) for deterministic tenant bucketing when explicit tenant is absent
 * 3) Fallback tenant id (`default`)
 */

import { createHash } from 'crypto';

type HeaderValue = string | string[] | undefined;

function getHeaderValue(
  headers: Record<string, HeaderValue> | undefined,
  names: string[]
): string | undefined {
  if (!headers) return undefined;

  for (const name of names) {
    const value = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(value)) {
      const first = value[0]?.trim();
      if (first) return first;
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }

  return undefined; // OK: Explicit empty - no matching tenant-identifying header was provided
}

function fingerprintApiKey(apiKey: string): string {
  const hash = createHash('sha256').update(apiKey).digest('hex');
  return `api_${hash.slice(0, 12)}`;
}

export function resolveCostTrackingTenantId(options?: {
  headers?: Record<string, HeaderValue>;
  fallbackTenantId?: string;
}): string {
  const fallback = options?.fallbackTenantId?.trim() || 'default';
  const headers = options?.headers;

  const explicitTenantId = getHeaderValue(headers, [
    'x-tenant-id',
    'tenant-id',
    'x-servalsheets-tenant-id',
  ]);
  if (explicitTenantId) {
    return explicitTenantId;
  }

  const apiKey = getHeaderValue(headers, ['x-api-key']);
  if (apiKey) {
    return fingerprintApiKey(apiKey);
  }

  return fallback;
}
