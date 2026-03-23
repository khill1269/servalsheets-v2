/**
 * ServalSheets - Optional Bundle OAuth Credentials
 *
 * ServalSheets can be packaged with bundle-provided desktop OAuth credentials,
 * but the source tree does not ship a usable default client secret. Self-hosted
 * and development deployments should provide OAUTH_CLIENT_ID and
 * OAUTH_CLIENT_SECRET explicitly, or inject both values during packaging.
 *
 * Per Google's documentation for "Desktop application" (installed app)
 * OAuth clients, the client_id and client_secret are not treated as
 * confidential in the same way as a web-app secret. The security model
 * relies on PKCE (which ServalSheets enforces via oauth-provider.ts).
 *
 * @see https://developers.google.com/identity/protocols/oauth2/native-app
 * @see https://developers.google.com/identity/protocols/oauth2/native-app#creatingcred
 */

/**
 * Optional bundle-supplied ServalSheets OAuth credentials.
 *
 * IMPORTANT: The source repository intentionally leaves the default client
 * secret unusable. Packaged releases that want bundled credentials must inject
 * both values during build/distribution. Otherwise operators should set
 * OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET in the runtime environment.
 */
export const EMBEDDED_OAUTH = {
  clientId:
    process.env['OAUTH_CLIENT_ID'] ??
    // cspell:disable-next-line -- random OAuth client ID characters
    '928247231183-7unv94dc4rs3vo3tmib9tkcu5mkd8sd1.apps.googleusercontent.com',
  clientSecret: process.env['OAUTH_CLIENT_SECRET'] ?? 'REPLACE_WITH_REAL_OAUTH_CLIENT_SECRET',
  redirectUri: process.env['OAUTH_REDIRECT_URI'] ?? 'http://localhost:3000/callback',
};

/**
 * Warn when the current installation does not include a usable bundled OAuth
 * client. Production deployments should provide explicit credentials.
 */
export function warnIfDefaultCredentialsInHttpMode(): void {
  if (isEmbeddedOAuthConfigured()) return;

  const isHttpMode = process.env['MCP_HTTP_MODE'] === 'true' || process.env['PORT'] !== undefined;
  if (isHttpMode) {
    console.warn(
      '[ServalSheets] WARNING: No bundled OAuth client secret is configured for this installation. ' +
        'Set OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET in your environment before using HTTP mode in production.'
    );
  } else {
    console.warn(
      '[ServalSheets] INFO: This installation does not include bundled OAuth credentials. ' +
        'Set OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET, or install a packaged build that injects both values.'
    );
  }
}

/**
 * Check whether this installation currently has a usable OAuth client pair,
 * either from the environment or from packaging-time injected bundle values.
 */
export function isEmbeddedOAuthConfigured(): boolean {
  return (
    !EMBEDDED_OAUTH.clientId.startsWith('REPLACE_WITH_') &&
    !EMBEDDED_OAUTH.clientSecret.startsWith('REPLACE_WITH_') &&
    EMBEDDED_OAUTH.clientId.length > 0 &&
    EMBEDDED_OAUTH.clientSecret.length > 0
  );
}
