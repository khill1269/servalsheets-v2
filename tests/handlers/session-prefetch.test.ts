import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prefetchOnOpen = vi.fn();

vi.mock('../../src/services/prefetching-system.js', () => ({
  getPrefetchingSystem: vi.fn(() => ({
    prefetchOnOpen,
  })),
}));

import { SessionHandler } from '../../src/handlers/session.js';
import { resetSessionContext } from '../../src/services/session-context.js';

describe('SessionHandler prefetch warmup', () => {
  beforeEach(() => {
    resetSessionContext();
    prefetchOnOpen.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetSessionContext();
    vi.clearAllMocks();
  });

  it('triggers prefetchOnOpen when set_active succeeds', async () => {
    const handler = new SessionHandler();

    const result = await handler.handle({
      action: 'set_active',
      spreadsheetId: 'prefetch-sheet-001',
      title: 'Prefetch Sheet',
      sheetNames: ['Sheet1'],
    });

    expect(result.response.success).toBe(true);
    expect(prefetchOnOpen).toHaveBeenCalledWith('prefetch-sheet-001');
  });
});
