import type { GoogleApiClientOptions } from '../services/google-api.js';
import { getDefaultTokenStorePath, sanitizeTokenStorePath } from './auth-paths.js';

interface ResolveGoogleApiOptionsOverrides {
  serviceAccountKeyPath?: string;
  accessToken?: string;
}

export function resolveGoogleApiOptionsFromEnv(
  overrides: ResolveGoogleApiOptionsOverrides = {}
): GoogleApiClientOptions | undefined {
  const serviceAccountKeyPath =
    overrides.serviceAccountKeyPath ?? process.env['GOOGLE_APPLICATION_CREDENTIALS'];
  const accessToken = overrides.accessToken ?? process.env['GOOGLE_ACCESS_TOKEN'];
  const clientId = process.env['GOOGLE_CLIENT_ID'] ?? process.env['OAUTH_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'] ?? process.env['OAUTH_CLIENT_SECRET'];
  const redirectUri = process.env['GOOGLE_REDIRECT_URI'] ?? process.env['OAUTH_REDIRECT_URI'];
  const tokenStoreKey = process.env['ENCRYPTION_KEY'];
  const rawTokenStorePath =
    process.env['GOOGLE_TOKEN_STORE_PATH'] ??
    (tokenStoreKey ? getDefaultTokenStorePath() : undefined);
  const tokenStorePath = rawTokenStorePath ? sanitizeTokenStorePath(rawTokenStorePath) : undefined;

  const sharedGoogleOptions = {
    tokenStorePath,
    tokenStoreKey,
  };

  if (serviceAccountKeyPath) {
    return {
      serviceAccountKeyPath,
      ...sharedGoogleOptions,
    };
  }

  if (accessToken) {
    return {
      accessToken,
      ...sharedGoogleOptions,
    };
  }

  if (clientId && clientSecret) {
    return {
      credentials: { clientId, clientSecret, redirectUri },
      ...sharedGoogleOptions,
    };
  }

  return undefined; // OK: no OAuth config available
}
