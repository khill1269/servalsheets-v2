/**
 * Excel Online Backend Smoke Tests (P3-3)
 *
 * Verifies that ExcelOnlineBackend initializes correctly and reports
 * the expected platform identifier. Does not call any Graph API methods
 * since the backend is a scaffold pending Microsoft Graph credentials.
 */

import { describe, it, expect, vi } from 'vitest';
import { ExcelOnlineBackend } from '../../src/adapters/excel-online-backend.js';
import type { GraphClient } from '../../src/adapters/excel-online-backend.js';

function createMockGraphClient(): GraphClient {
  return {
    api: vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue({}),
      post: vi.fn().mockResolvedValue({}),
      patch: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      select: vi.fn().mockReturnThis(),
      top: vi.fn().mockReturnThis(),
      orderby: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    }),
  } as unknown as GraphClient;
}

describe('ExcelOnlineBackend', () => {
  beforeEach(() => {
    process.env['ENABLE_EXPERIMENTAL_BACKENDS'] = 'true';
  });

  afterEach(() => {
    delete process.env['ENABLE_EXPERIMENTAL_BACKENDS'];
  });

  it('should initialize without errors', async () => {
    const backend = new ExcelOnlineBackend({ client: createMockGraphClient() });
    await expect(backend.initialize()).resolves.toBeUndefined();
  });

  it('should report excel-online as platform', () => {
    const backend = new ExcelOnlineBackend({ client: createMockGraphClient() });
    expect(backend.platform).toBe('excel-online');
  });

  it('should accept custom drivePrefix', () => {
    const backend = new ExcelOnlineBackend({
      client: createMockGraphClient(),
      drivePrefix: '/drives/custom/items/',
    });
    // Platform should still be correct
    expect(backend.platform).toBe('excel-online');
  });
});
