import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceEventsService } from '../../src/services/workspace-events.js';

const makeMockClient = () =>
  ({
    oauth2: {
      credentials: { access_token: 'test-token', expiry_date: Date.now() + 3600_000 },
      getAccessToken: vi.fn().mockResolvedValue({ token: 'test-token' }),
    },
  }) as never;

describe('WorkspaceEventsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-09T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('prefers the subscription resource name from operation.response.name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            name: 'operations/123',
            response: { name: 'subscriptions/abc' },
            metadata: {
              subscription: {
                name: 'subscriptions/fallback',
                expireTime: '2026-03-16T12:00:00.000Z',
              },
            },
          }),
      })
    );

    const service = new WorkspaceEventsService(makeMockClient());
    const subscriptionId = await service.createSubscription(
      'spreadsheet-123',
      'projects/demo/topics/workspace-events'
    );

    expect(subscriptionId).toBe('subscriptions/abc');
    expect(service.listSubscriptions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'subscriptions/abc',
          spreadsheetId: 'spreadsheet-123',
        }),
      ])
    );
  });

  it('falls back to metadata.subscription.name when operation.response.name is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            name: 'operations/456',
            metadata: {
              subscription: {
                name: 'subscriptions/from-metadata',
                expireTime: '2026-03-16T12:00:00.000Z',
              },
            },
          }),
      })
    );

    const service = new WorkspaceEventsService(makeMockClient());
    const subscriptionId = await service.createSubscription(
      'spreadsheet-456',
      'projects/demo/topics/workspace-events'
    );

    expect(subscriptionId).toBe('subscriptions/from-metadata');
  });
});
