import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Response } from 'express';
import {
  validateSpreadsheetAccess,
  type TenantRequest,
} from '../../src/middleware/tenant-isolation.js';
import { tenantContextService } from '../../src/services/tenant-context.js';

function createMockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe('tenant-isolation middleware', () => {
  const originalIsolation = process.env['ENABLE_TENANT_ISOLATION'];
  const originalUnmappedOverride = process.env['TENANT_ALLOW_UNMAPPED_SPREADSHEET_ACCESS'];

  afterEach(() => {
    if (originalIsolation === undefined) {
      delete process.env['ENABLE_TENANT_ISOLATION'];
    } else {
      process.env['ENABLE_TENANT_ISOLATION'] = originalIsolation;
    }

    if (originalUnmappedOverride === undefined) {
      delete process.env['TENANT_ALLOW_UNMAPPED_SPREADSHEET_ACCESS'];
    } else {
      process.env['TENANT_ALLOW_UNMAPPED_SPREADSHEET_ACCESS'] = originalUnmappedOverride;
    }
  });

  it('returns 403 when tenant accesses an unauthorized spreadsheet', async () => {
    process.env['ENABLE_TENANT_ISOLATION'] = 'true';
    delete process.env['TENANT_ALLOW_UNMAPPED_SPREADSHEET_ACCESS'];

    const tenantA = await tenantContextService.createTenant('Tenant A');
    const tenantB = await tenantContextService.createTenant('Tenant B');
    tenantContextService.grantSpreadsheetAccess(tenantA.metadata.tenantId, 'sheet-a');
    tenantContextService.grantSpreadsheetAccess(tenantB.metadata.tenantId, 'sheet-b');

    const tenantContext = await tenantContextService.extractTenantContext(tenantA.apiKey);
    expect(tenantContext).not.toBeNull();

    const req = {
      tenantContext: tenantContext!,
      body: {
        params: {
          arguments: {
            request: {
              spreadsheetId: 'sheet-b',
            },
          },
        },
      },
      params: {},
      query: {},
      path: '/mcp',
    } as unknown as TenantRequest;
    const res = createMockResponse();
    const next = vi.fn();

    await validateSpreadsheetAccess()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows request when spreadsheet mapping is authorized', async () => {
    process.env['ENABLE_TENANT_ISOLATION'] = 'true';
    delete process.env['TENANT_ALLOW_UNMAPPED_SPREADSHEET_ACCESS'];

    const tenant = await tenantContextService.createTenant('Tenant A');
    tenantContextService.grantSpreadsheetAccess(tenant.metadata.tenantId, 'sheet-allowed');

    const tenantContext = await tenantContextService.extractTenantContext(tenant.apiKey);
    expect(tenantContext).not.toBeNull();

    const req = {
      tenantContext: tenantContext!,
      body: {
        request: {
          spreadsheetId: 'sheet-allowed',
        },
      },
      params: {},
      query: {},
      path: '/mcp',
    } as unknown as TenantRequest;
    const res = createMockResponse();
    const next = vi.fn();

    await validateSpreadsheetAccess()(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
