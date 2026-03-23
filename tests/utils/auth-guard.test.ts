import { describe, expect, it, vi } from 'vitest';
import { checkAuthAsync } from '../../src/utils/auth-guard.js';
import type { GoogleApiClient } from '../../src/services/google-api.js';

function createGoogleClientMock(overrides?: {
  authType?: 'oauth' | 'service_account' | 'application_default';
  hasAccessToken?: boolean;
  hasRefreshToken?: boolean;
  expiryDate?: number;
  validateResult?: { valid: boolean; error?: string };
}): GoogleApiClient {
  return {
    authType: overrides?.authType ?? 'oauth',
    getTokenStatus: vi.fn().mockReturnValue({
      hasAccessToken: overrides?.hasAccessToken ?? false,
      hasRefreshToken: overrides?.hasRefreshToken ?? false,
      expiryDate: overrides?.expiryDate,
    }),
    validateToken: vi.fn().mockResolvedValue(overrides?.validateResult ?? { valid: true }),
  } as unknown as GoogleApiClient;
}

describe('checkAuthAsync', () => {
  it('returns not configured when no Google client is available', async () => {
    const result = await checkAuthAsync(null);

    expect(result.authenticated).toBe(false);
    expect(result.error?.code).toBe('NOT_CONFIGURED');
  });

  it('treats service account auth as authenticated', async () => {
    const googleClient = createGoogleClientMock({ authType: 'service_account' });

    const result = await checkAuthAsync(googleClient);

    expect(result.authenticated).toBe(true);
  });

  it('returns not authenticated when there are no OAuth tokens', async () => {
    const googleClient = createGoogleClientMock();

    const result = await checkAuthAsync(googleClient);

    expect(result.authenticated).toBe(false);
    expect(result.error?.code).toBe('NOT_AUTHENTICATED');
  });

  it('uses the fast path when the access token is still fresh', async () => {
    const googleClient = createGoogleClientMock({
      hasAccessToken: true,
      expiryDate: Date.now() + 60_000,
    });

    const result = await checkAuthAsync(googleClient);

    expect(result.authenticated).toBe(true);
    expect(googleClient.validateToken).not.toHaveBeenCalled();
  });

  it('flags invalid access tokens when no refresh token exists', async () => {
    const googleClient = createGoogleClientMock({
      hasAccessToken: true,
      hasRefreshToken: false,
      validateResult: { valid: false, error: 'Token has been expired or revoked' },
    });

    const result = await checkAuthAsync(googleClient);

    expect(googleClient.validateToken).toHaveBeenCalledTimes(1);
    expect(result.authenticated).toBe(false);
    expect(result.error?.code).toBe('TOKEN_EXPIRED');
  });

  it('allows refresh-token-backed sessions to proceed even when access token validation fails', async () => {
    const googleClient = createGoogleClientMock({
      hasAccessToken: true,
      hasRefreshToken: true,
      expiryDate: Date.now() - 60_000,
      validateResult: { valid: false, error: 'Token has been expired or revoked' },
    });

    const result = await checkAuthAsync(googleClient);

    expect(googleClient.validateToken).toHaveBeenCalledTimes(1);
    expect(result.authenticated).toBe(true);
  });
});
