import { describe, it, expect } from 'vitest';
import { resolveCostTrackingTenantId } from '../../src/utils/tenant-identification.js';

describe('resolveCostTrackingTenantId', () => {
  it('prefers explicit tenant id header', () => {
    const tenantId = resolveCostTrackingTenantId({
      headers: {
        'x-tenant-id': 'tenant-acme',
        'x-api-key': 'sk-abc123',
      },
    });

    expect(tenantId).toBe('tenant-acme');
  });

  it('uses deterministic API key fingerprint when tenant header is absent', () => {
    const first = resolveCostTrackingTenantId({
      headers: { 'x-api-key': 'sk-live-123' },
    });
    const second = resolveCostTrackingTenantId({
      headers: { 'x-api-key': 'sk-live-123' },
    });

    expect(first).toBe(second);
    expect(first.startsWith('api_')).toBe(true);
  });

  it('falls back to default when no identifying headers are present', () => {
    const tenantId = resolveCostTrackingTenantId();
    expect(tenantId).toBe('default');
  });
});

