/**
 * ServalSheets - OAuth Callback Server
 *
 * Temporary HTTP server for capturing OAuth callbacks in STDIO mode.
 * Starts on-demand, captures the authorization code, and auto-closes.
 */

import http from 'http';
import { URL } from 'url';
import { logger } from './logger.js';

export interface CallbackServerOptions {
  port?: number;
  host?: string;
  timeout?: number;
}

export interface CallbackResult {
  code?: string;
  error?: string;
  state?: string;
}

/**
 * Start a temporary HTTP server to capture OAuth callback
 * Returns the authorization code when received
 */
export async function startCallbackServer(
  options: CallbackServerOptions = {}
): Promise<CallbackResult> {
  const port = options.port ?? 3000;
  const host = options.host ?? 'localhost';
  const timeout = options.timeout ?? 120000; // 2 minutes default

  return new Promise((resolve, reject) => {
    let resolved = false;
    // Allowed Host header values — only localhost / loopback accepted
    const allowedHosts = new Set([
      `localhost:${port}`,
      `127.0.0.1:${port}`,
      `[::1]:${port}`,
      'localhost',
      '127.0.0.1',
    ]);

    const server = http.createServer((req, res) => {
      if (resolved) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Already processed</h1></body></html>');
        return;
      }

      // DNS-rebinding protection: reject requests with unexpected Host headers
      const requestHost = req.headers.host ?? '';
      if (!allowedHosts.has(requestHost)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad Request: invalid Host header');
        return;
      }

      // Parse the callback URL
      const reqUrl = new URL(req.url || '/', `http://${host}:${port}`);

      // Only handle /callback path
      if (reqUrl.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>404 - Not Found</h1></body></html>');
        return;
      }

      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');
      const state = reqUrl.searchParams.get('state');

      resolved = true;

      if (error) {
        // OAuth error
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <head>
              <title>Authentication Failed</title>
              <style>
                body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
                h1 { color: #d32f2f; }
                .error { background: #ffebee; border: 1px solid #d32f2f; padding: 15px; border-radius: 4px; margin: 20px 0; }
                .code { background: #f5f5f5; padding: 10px; border-radius: 4px; font-family: monospace; }
              </style>
            </head>
            <body>
              <h1>❌ Authentication Failed</h1>
              <div class="error">
                <strong>Error:</strong> ${error}
              </div>
              <p>You can close this window and try again.</p>
            </body>
          </html>
        `);

        server.close();
        resolve({ error, state: state || undefined });
        return;
      }

      if (code) {
        // Success!
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <head>
              <title>Authentication Successful</title>
              <style>
                body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
                h1 { color: #2e7d32; }
                .success { background: #e8f5e9; border: 1px solid #2e7d32; padding: 15px; border-radius: 4px; margin: 20px 0; }
                .info { color: #666; font-size: 14px; margin-top: 20px; }
              </style>
            </head>
            <body>
              <h1>✅ Authentication Successful!</h1>
              <div class="success">
                <p><strong>You're all set!</strong></p>
                <p>ServalSheets can now access your Google Sheets.</p>
              </div>
              <p class="info">You can close this window and return to Claude.</p>
              <script>
                // Auto-close after 3 seconds
                setTimeout(() => {
                  window.close();
                }, 3000);
              </script>
            </body>
          </html>
        `);

        server.close();
        resolve({ code, state: state || undefined });
        return;
      }

      // No code or error
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <head>
            <title>Invalid Callback</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
              h1 { color: #f57c00; }
            </style>
          </head>
          <body>
            <h1>⚠️ Invalid Callback</h1>
            <p>No authorization code received.</p>
            <p>Please close this window and try again.</p>
          </body>
        </html>
      `);

      server.close();
      resolve({ error: 'no_code' });
    });

    // Handle server errors
    server.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Failed to start callback server: ${err.message}`));
      }
    });

    // Start the server
    server.listen(port, host, () => {
      logger.info(`OAuth callback server listening on http://${host}:${port}/callback`);
    });

    // Timeout after specified duration
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        server.close();
        reject(new Error(`OAuth callback timed out after ${timeout}ms`));
      }
    }, timeout);

    // Clean up timeout when server closes
    server.on('close', () => {
      clearTimeout(timeoutId);
    });
  });
}

/**
 * Extract port from redirect URI
 */
export function extractPortFromRedirectUri(redirectUri: string): number {
  try {
    const url = new URL(redirectUri);
    const port = parseInt(url.port, 10);
    return port || 3000;
  } catch {
    return 3000;
  }
}
