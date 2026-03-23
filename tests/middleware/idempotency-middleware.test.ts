/**
 * Idempotency Middleware Tests
 *
 * Tests withIdempotency wrapper and wrapToolMapWithIdempotency.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../src/services/idempotency-manager.js', () => ({
  idempotencyManager: {
    isIdempotent: vi.fn(),
    getCachedResult: vi.fn(),
    storeResult: vi.fn(),
  },
}));

vi.mock('../../src/utils/idempotency-key-generator.js', () => ({
  generateRequestFingerprint: vi.fn().mockReturnValue('fingerprint-123'),
  generateIdempotencyKey: vi.fn().mockReturnValue('key-abc-123-generated'),
}));

vi.mock('../../src/utils/request-context.js', () => ({
  getRequestContext: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  withIdempotency,
  wrapToolMapWithIdempotency,
} from '../../src/middleware/idempotency-middleware.js';
import { idempotencyManager } from '../../src/services/idempotency-manager.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('withIdempotency', () => {
  it('should pass through idempotent operations without caching', async () => {
    vi.mocked(idempotencyManager.isIdempotent).mockReturnValue(true);
    const handler = vi.fn().mockResolvedValue({ success: true });

    const wrapped = withIdempotency('sheets_data', handler);
    const result = await wrapped({ action: 'read_range', spreadsheetId: '123' });

    expect(result).toEqual({ success: true });
    expect(handler).toHaveBeenCalledOnce();
    expect(idempotencyManager.storeResult).not.toHaveBeenCalled();
  });

  it('should execute and cache non-idempotent operations', async () => {
    vi.mocked(idempotencyManager.isIdempotent).mockReturnValue(false);
    vi.mocked(idempotencyManager.getCachedResult).mockReturnValue(undefined);
    const handler = vi.fn().mockResolvedValue({ written: 10 });

    const wrapped = withIdempotency('sheets_data', handler);
    const result = await wrapped({ action: 'write_range', spreadsheetId: '123' });

    expect(result).toEqual({ written: 10 });
    expect(handler).toHaveBeenCalledOnce();
    expect(idempotencyManager.storeResult).toHaveBeenCalledWith(
      'key-abc-123-generated',
      'sheets_data',
      'write_range',
      'fingerprint-123',
      { written: 10 }
    );
  });

  it('should return cached result on duplicate request', async () => {
    vi.mocked(idempotencyManager.isIdempotent).mockReturnValue(false);
    vi.mocked(idempotencyManager.getCachedResult).mockReturnValue({ written: 10 });
    const handler = vi.fn();

    const wrapped = withIdempotency('sheets_data', handler);
    const result = await wrapped({ action: 'write_range', spreadsheetId: '123' });

    expect(result).toEqual({ written: 10 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should cache errors for non-idempotent operations', async () => {
    vi.mocked(idempotencyManager.isIdempotent).mockReturnValue(false);
    vi.mocked(idempotencyManager.getCachedResult).mockReturnValue(undefined);
    const handler = vi.fn().mockRejectedValue(new Error('API failure'));

    const wrapped = withIdempotency('sheets_data', handler);
    await expect(wrapped({ action: 'write_range' })).rejects.toThrow('API failure');

    expect(idempotencyManager.storeResult).toHaveBeenCalledWith(
      'key-abc-123-generated',
      'sheets_data',
      'write_range',
      'fingerprint-123',
      expect.objectContaining({ error: 'API failure' })
    );
  });

  it('should pass through when no action is found', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });

    const wrapped = withIdempotency('sheets_data', handler);
    const result = await wrapped({ noAction: true });

    expect(result).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledOnce();
    expect(idempotencyManager.isIdempotent).not.toHaveBeenCalled();
  });

  it('should extract action from the canonical request envelope', async () => {
    vi.mocked(idempotencyManager.isIdempotent).mockReturnValue(true);
    const handler = vi.fn().mockResolvedValue({ ok: true });

    const wrapped = withIdempotency('sheets_data', handler);
    await wrapped({ request: { action: 'read_range' } });

    expect(idempotencyManager.isIdempotent).toHaveBeenCalledWith('sheets_data', 'read_range');
  });
});

describe('wrapToolMapWithIdempotency', () => {
  it('should wrap all handlers in the map', async () => {
    vi.mocked(idempotencyManager.isIdempotent).mockReturnValue(true);
    const handler1 = vi.fn().mockResolvedValue('r1');
    const handler2 = vi.fn().mockResolvedValue('r2');

    const map = { sheets_data: handler1, sheets_core: handler2 };
    const wrapped = wrapToolMapWithIdempotency(map);

    expect(Object.keys(wrapped)).toEqual(['sheets_data', 'sheets_core']);

    const r1 = await wrapped['sheets_data']!({ action: 'read' });
    const r2 = await wrapped['sheets_core']!({ action: 'get' });

    expect(r1).toBe('r1');
    expect(r2).toBe('r2');
  });

  it('should return empty map for empty input', () => {
    const wrapped = wrapToolMapWithIdempotency({});
    expect(Object.keys(wrapped)).toHaveLength(0);
  });
});
