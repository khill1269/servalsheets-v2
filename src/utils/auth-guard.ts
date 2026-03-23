/**
 * ServalSheets - Auth Guard
 *
 * Provides authentication checking and clear error messages for LLMs.
 * This module ensures that when auth fails, the error message clearly
 * instructs the LLM how to proceed with the OAuth flow.
 */

import type { GoogleApiClient } from '../services/google-api.js';

export interface AuthGuardResult {
  authenticated: boolean;
  error?: AuthGuardError;
}

export interface AuthGuardError {
  code: 'NOT_AUTHENTICATED' | 'NOT_CONFIGURED' | 'TOKEN_EXPIRED';
  message: string;
  resolution: string;
  resolutionSteps: string[];
  nextTool: {
    name: 'sheets_auth';
    action: 'status' | 'login';
  };
}

/**
 * Check authentication status and return clear instructions if not authenticated
 *
 * This function is designed to produce error messages that clearly instruct
 * the LLM how to proceed with authentication.
 */
export function checkAuth(googleClient: GoogleApiClient | null): AuthGuardResult {
  if (!googleClient) {
    return {
      authenticated: false,
      error: {
        code: 'NOT_CONFIGURED',
        message: 'Google API client not initialized. Authentication required.',
        resolution: 'You must authenticate before using this tool.',
        resolutionSteps: [
          '1. Call sheets_auth with action: "status" to check auth state',
          '2. If not authenticated, call sheets_auth with action: "login"',
          '3. Present the authUrl to the user and wait for the code',
          '4. Call sheets_auth with action: "callback" and the code',
          '5. Then retry your original request',
        ],
        nextTool: {
          name: 'sheets_auth',
          action: 'status',
        },
      },
    };
  }

  // Service accounts and application default credentials are always authenticated
  // They use automatic credential management and don't need OAuth tokens
  const authType = googleClient.authType;
  if (authType === 'service_account' || authType === 'application_default') {
    return { authenticated: true };
  }

  const tokenStatus = googleClient.getTokenStatus();
  const hasValidAuth = tokenStatus.hasAccessToken || tokenStatus.hasRefreshToken;

  if (!hasValidAuth) {
    return {
      authenticated: false,
      error: {
        code: 'NOT_AUTHENTICATED',
        message: 'Not authenticated with Google. OAuth flow required.',
        resolution: 'Complete the OAuth authentication flow first.',
        resolutionSteps: [
          '1. Call sheets_auth with action: "login" to get an OAuth URL',
          '2. Present the authUrl to the user as a clickable link',
          '3. Instruct user to sign in and authorize the application',
          '4. User will receive an authorization code after approval',
          '5. Call sheets_auth with action: "callback" and the code',
          '6. Once authenticated, retry your original request',
        ],
        nextTool: {
          name: 'sheets_auth',
          action: 'login',
        },
      },
    };
  }

  // Check for token expiry (if we have expiry info)
  if (tokenStatus.expiryDate && tokenStatus.expiryDate < Date.now()) {
    // Token might be expired, but we have a refresh token so it should auto-refresh
    // Only flag as expired if we don't have a refresh token
    if (!tokenStatus.hasRefreshToken) {
      return {
        authenticated: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Access token has expired and no refresh token is available.',
          resolution: 'Re-authenticate to get a new token.',
          resolutionSteps: [
            '1. Call sheets_auth with action: "login" to start fresh OAuth flow',
            '2. Present the authUrl to the user',
            '3. Complete the OAuth flow to get new tokens',
            '4. Then retry your original request',
          ],
          nextTool: {
            name: 'sheets_auth',
            action: 'login',
          },
        },
      };
    }
  }

  return { authenticated: true };
}

/**
 * Async version of checkAuth that also validates the token via the API when needed.
 *
 * Fast path: if access token is fresh (expiryDate > now + buffer), skip validation.
 * Slow path: call validateToken() for expired/missing-expiry tokens.
 * - If invalid + no refresh token: TOKEN_EXPIRED
 * - If invalid + has refresh token: still authenticated (will auto-refresh)
 */
export async function checkAuthAsync(
  googleClient: GoogleApiClient | null
): Promise<AuthGuardResult> {
  if (!googleClient) {
    return {
      authenticated: false,
      error: {
        code: 'NOT_CONFIGURED',
        message: 'Google API client not initialized. Authentication required.',
        resolution: 'You must authenticate before using this tool.',
        resolutionSteps: [
          '1. Call sheets_auth with action: "status" to check auth state',
          '2. If not authenticated, call sheets_auth with action: "login"',
          '3. Present the authUrl to the user and wait for the code',
          '4. Call sheets_auth with action: "callback" and the code',
          '5. Then retry your original request',
        ],
        nextTool: { name: 'sheets_auth', action: 'status' },
      },
    };
  }

  const authType = googleClient.authType;
  if (authType === 'service_account' || authType === 'application_default') {
    return { authenticated: true };
  }

  const tokenStatus = googleClient.getTokenStatus();
  const hasValidAuth = tokenStatus.hasAccessToken || tokenStatus.hasRefreshToken;

  if (!hasValidAuth) {
    return {
      authenticated: false,
      error: {
        code: 'NOT_AUTHENTICATED',
        message: 'Not authenticated with Google. OAuth flow required.',
        resolution: 'Complete the OAuth authentication flow first.',
        resolutionSteps: [
          '1. Call sheets_auth with action: "login" to get an OAuth URL',
          '2. Present the authUrl to the user as a clickable link',
          '3. Instruct user to sign in and authorize the application',
          '4. User will receive an authorization code after approval',
          '5. Call sheets_auth with action: "callback" and the code',
          '6. Once authenticated, retry your original request',
        ],
        nextTool: { name: 'sheets_auth', action: 'login' },
      },
    };
  }

  // Fast path: token is fresh
  if (tokenStatus.hasAccessToken && tokenStatus.expiryDate && tokenStatus.expiryDate > Date.now()) {
    return { authenticated: true };
  }

  // Slow path: validate token via API
  const validation = await googleClient.validateToken();
  if (!validation.valid) {
    if (!tokenStatus.hasRefreshToken) {
      return {
        authenticated: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Access token has expired and no refresh token is available.',
          resolution: 'Re-authenticate to get a new token.',
          resolutionSteps: [
            '1. Call sheets_auth with action: "login" to start fresh OAuth flow',
            '2. Present the authUrl to the user',
            '3. Complete the OAuth flow to get new tokens',
            '4. Then retry your original request',
          ],
          nextTool: { name: 'sheets_auth', action: 'login' },
        },
      };
    }
    // Has refresh token — will auto-refresh on next API call
    return { authenticated: true };
  }

  return { authenticated: true };
}

/**
 * Build a standardized auth error response for tool handlers
 *
 * This creates a response object that follows the ServalSheets response schema
 * and includes clear instructions for the LLM.
 */
export function buildAuthErrorResponse(error: AuthGuardError): {
  response: {
    success: false;
    error: {
      code: string;
      message: string;
      retryable: boolean;
      resolution: string;
      resolutionSteps: string[];
      suggestedNextStep: {
        tool: string;
        action: string;
        description: string;
      };
    };
  };
} {
  return {
    response: {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        retryable: true, // Auth errors are retryable after authentication
        resolution: error.resolution,
        resolutionSteps: error.resolutionSteps,
        suggestedNextStep: {
          tool: error.nextTool.name,
          action: error.nextTool.action,
          description: `Call ${error.nextTool.name} with action: "${error.nextTool.action}" to proceed with authentication`,
        },
      },
    },
  };
}

/**
 * Require authentication - throws a clear error if not authenticated
 *
 * Use this in tool handlers that require authentication.
 */
export function requireAuth(
  googleClient: GoogleApiClient | null
): asserts googleClient is GoogleApiClient {
  const result = checkAuth(googleClient);

  if (!result.authenticated) {
    const error = result.error!;
    throw new AuthRequiredError(error);
  }
}

/**
 * Custom error class for auth failures
 *
 * This error carries structured data that can be used to build
 * informative error responses for the LLM.
 */
export class AuthRequiredError extends Error {
  public readonly code: string;
  public readonly resolution: string;
  public readonly resolutionSteps: string[];
  public readonly nextTool: { name: string; action: string };

  constructor(error: AuthGuardError) {
    super(error.message);
    this.name = 'AuthRequiredError';
    this.code = error.code;
    this.resolution = error.resolution;
    this.resolutionSteps = error.resolutionSteps;
    this.nextTool = error.nextTool;
  }

  toResponse(): unknown {
    return buildAuthErrorResponse({
      code: this.code as AuthGuardError['code'],
      message: this.message,
      resolution: this.resolution,
      resolutionSteps: this.resolutionSteps,
      nextTool: this.nextTool as AuthGuardError['nextTool'],
    });
  }
}

/**
 * Google auth error patterns that indicate authentication is required
 */
const GOOGLE_AUTH_ERROR_PATTERNS = [
  'No access, refresh token',
  'invalid_grant',
  'Token has been expired or revoked',
  'Invalid Credentials',
  'Request had invalid authentication credentials',
  'The request does not have valid authentication credentials',
  'invalid_client',
  'unauthorized_client',
  'access_denied',
  'Login Required',
  'authError',
];

/**
 * Check if an error is a Google authentication error
 *
 * This function examines error messages and codes to determine if the error
 * is related to authentication/authorization issues with Google APIs.
 */
export function isGoogleAuthError(error: unknown): boolean {
  if (!error) return false;

  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error);

  return GOOGLE_AUTH_ERROR_PATTERNS.some((pattern) =>
    errorMessage.toLowerCase().includes(pattern.toLowerCase())
  );
}

/**
 * Convert a Google auth error to a standardized auth error response
 *
 * This ensures that when Google APIs fail due to auth issues, the LLM
 * receives clear instructions on how to proceed with authentication.
 */
export function convertGoogleAuthError(error: unknown): {
  response: {
    success: false;
    error: {
      code: string;
      message: string;
      retryable: boolean;
      resolution: string;
      resolutionSteps: string[];
      suggestedNextStep: {
        tool: string;
        action: string;
        description: string;
      };
    };
  };
} {
  const errorMessage = error instanceof Error ? error.message : String(error);

  return {
    response: {
      success: false,
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: `Google API authentication failed: ${errorMessage}`,
        retryable: true,
        resolution: 'Your authentication has expired or is invalid. You need to re-authenticate.',
        resolutionSteps: [
          '1. Call sheets_auth with action: "status" to check current auth state',
          '2. If not authenticated, call sheets_auth with action: "login"',
          '3. Present the authUrl to the user as a clickable link',
          '4. Wait for the user to complete OAuth and provide the authorization code',
          '5. Call sheets_auth with action: "callback" and the code',
          '6. Once authenticated, retry your original request',
        ],
        suggestedNextStep: {
          tool: 'sheets_auth',
          action: 'status',
          description:
            'Call sheets_auth with action: "status" to check authentication state and get instructions',
        },
      },
    },
  };
}
