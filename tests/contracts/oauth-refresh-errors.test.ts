/**
 * OAuth refresh-token error surface contract.
 *
 * Verifies refresh-token failures return explicit errors (no silent success).
 */

import { describe, it, expect, vi } from 'vitest';

// Mock env module before imports
vi.mock('../../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env.js')>();
  return {
    ...actual,
    env: {
      OAUTH_MAX_TOKEN_TTL: 1800,
      LOG_LEVEL: 'error',
    },
  };
});

import { OAuthProvider } from '../../src/oauth-provider.js';
import { InMemorySessionStore } from '../../src/storage/session-store.js';

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

function createMockResponse(): MockResponse {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  } as MockResponse;
  return res;
}

describe('OAuth refresh token errors', () => {
  it('returns invalid_grant for missing refresh token', async () => {
    const oauthProvider = new OAuthProvider({
      issuer: 'https://test.servalsheets.example.com',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      jwtSecret: 'jwt-secret',
      stateSecret: 'state-secret',
      allowedRedirectUris: ['https://example.com/callback'],
      sessionStore: new InMemorySessionStore(),
    });

    const res = createMockResponse();
    await (
      oauthProvider as unknown as {
        handleRefreshToken: (token: string, res: MockResponse) => Promise<void>;
      }
    ).handleRefreshToken('missing-refresh-token', res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      error: 'invalid_grant',
    });

    oauthProvider.destroy();
  });
});
