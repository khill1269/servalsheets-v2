/**
 * ServalSheets - API Key Server
 *
 * Temporary localhost HTTP server for secure API key collection.
 * Key is submitted directly to localhost — never transits through the MCP client.
 * Mirrors oauth-callback-server.ts pattern.
 */

import http from 'http';
import { AddressInfo } from 'net';
import { logger } from './logger.js';

export interface ApiKeyServerOptions {
  provider: string;
  signupUrl: string;
  hint: string;
  timeout?: number;
}

export interface ApiKeyServerHandle {
  /** Resolves with the submitted API key, or rejects on timeout. */
  keyPromise: Promise<string>;
  /** The URL to open in the browser (points to the local form). */
  url: string;
  /** Force-close the server (called on decline/cancel). */
  shutdown: () => void;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Start a temporary localhost HTTP server that serves a password input form.
 * Returns immediately once the server is bound; the caller awaits `keyPromise`
 * to get the key after the user submits the form.
 */
export async function startApiKeyServer(options: ApiKeyServerOptions): Promise<ApiKeyServerHandle> {
  const { provider, signupUrl, hint, timeout = 120000 } = options;

  return new Promise((resolveHandle, rejectHandle) => {
    let resolved = false;
    let resolveKey: (key: string) => void;
    let rejectKey: (err: Error) => void;

    const keyPromise = new Promise<string>((res, rej) => {
      resolveKey = res;
      rejectKey = rej;
    });

    // Allowed Host header values — only localhost / loopback accepted (DNS-rebinding protection)
    // Port is added after binding since we use a random port.
    const allowedHosts = new Set(['localhost', '127.0.0.1']);

    const server = http.createServer((req, res) => {
      // DNS-rebinding protection
      const requestHost = (req.headers.host ?? '').replace(/:\d+$/, '');
      if (!allowedHosts.has(requestHost)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad Request: invalid Host header');
        return;
      }

      const url = new URL(req.url ?? '/', `http://localhost`);

      if (url.pathname !== '/setup-key') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>404</h1></body></html>');
        return;
      }

      // GET — serve the form
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ServalSheets — ${escapeHtml(provider)} API Key Setup</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 520px; margin: 80px auto; padding: 20px; }
    h1  { font-size: 1.4rem; margin-bottom: 4px; }
    .sub { color: #666; font-size: 0.9rem; margin-bottom: 24px; }
    label { display: block; font-weight: 600; margin-bottom: 6px; }
    input[type=password] {
      width: 100%; padding: 10px 12px; font-size: 1rem;
      border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box;
    }
    .hint { color: #888; font-size: 0.82rem; margin: 6px 0 20px; }
    button {
      background: #1a73e8; color: #fff; border: none;
      padding: 10px 24px; font-size: 1rem; border-radius: 6px; cursor: pointer;
    }
    button:hover { background: #1558b0; }
    .signup { margin-top: 28px; font-size: 0.9rem; color: #444; }
    .signup a { color: #1a73e8; }
  </style>
</head>
<body>
  <h1>Enter your ${escapeHtml(provider)} API key</h1>
  <p class="sub">The key will be encrypted and stored locally. It never leaves your machine.</p>
  <form method="POST" action="/setup-key" autocomplete="off">
    <label for="k">API Key</label>
    <input type="password" id="k" name="apiKey" required autofocus
           placeholder="${escapeHtml(hint)}">
    <p class="hint">${escapeHtml(hint)}</p>
    <button type="submit">Save key</button>
  </form>
  <p class="signup">Don't have a key yet?
    <a href="${escapeHtml(signupUrl)}" target="_blank" rel="noopener">Get one at ${escapeHtml(provider)} →</a>
  </p>
</body>
</html>`);
        return;
      }

      // POST — receive the key
      if (req.method === 'POST') {
        if (resolved) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body><h1>Already saved</h1></body></html>');
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
          if (body.length > 4096) req.destroy(); // guard against large payloads
        });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          const apiKey = params.get('apiKey')?.trim() ?? '';

          if (!apiKey) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html><html><body>
              <h1>Missing key</h1>
              <p>Please go back and enter your API key.</p>
            </body></html>`);
            return;
          }

          resolved = true;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ServalSheets — Key Saved</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 520px; margin: 80px auto; padding: 20px; text-align: center; }
    h1 { color: #2e7d32; }
    .box { background: #e8f5e9; border: 1px solid #2e7d32; padding: 16px; border-radius: 6px; margin: 20px 0; }
    .info { color: #666; font-size: 0.9rem; margin-top: 24px; }
  </style>
  <script>setTimeout(() => window.close(), 3000);</script>
</head>
<body>
  <h1>✅ Key saved</h1>
  <div class="box"><strong>${escapeHtml(provider)}</strong> is now configured in ServalSheets.</div>
  <p class="info">You can close this window and return to Claude.</p>
</body>
</html>`);

          server.close();
          resolveKey(apiKey);
        });
        return;
      }

      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
    });

    server.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        rejectHandle(new Error(`Failed to start api-key server: ${err.message}`));
      }
    });

    // Bind to a random available port
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      const url = `http://localhost:${port}/setup-key`;

      // Now we know the port — add it to the allowedHosts set
      allowedHosts.add(`localhost:${port}`);
      allowedHosts.add(`127.0.0.1:${port}`);

      logger.info(`API key server listening on ${url}`);

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          server.close();
          rejectKey(new Error(`API key entry timed out after ${timeout}ms`));
        }
      }, timeout);

      server.on('close', () => clearTimeout(timeoutId));

      const shutdown = (): void => {
        if (!resolved) {
          resolved = true;
          server.close();
          rejectKey(new Error('API key server shut down'));
        }
      };

      resolveHandle({ keyPromise, url, shutdown });
    });
  });
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface OAuthCredentialsServerOptions {
  provider: string;
  timeout?: number;
}

export interface OAuthCredentialsServerHandle {
  credentialsPromise: Promise<OAuthCredentials>;
  url: string;
  shutdown: () => void;
}

/**
 * Start a temporary localhost HTTP server that serves a multi-field OAuth credentials form.
 * Credentials are submitted directly to localhost — they never transit through the MCP client.
 */
export async function startOAuthCredentialsServer(
  options: OAuthCredentialsServerOptions
): Promise<OAuthCredentialsServerHandle> {
  const { provider, timeout = 120000 } = options;

  return new Promise((resolveHandle, rejectHandle) => {
    let resolved = false;
    let resolveCredentials: (creds: OAuthCredentials) => void;
    let rejectCredentials: (err: Error) => void;

    const credentialsPromise = new Promise<OAuthCredentials>((res, rej) => {
      resolveCredentials = res;
      rejectCredentials = rej;
    });

    const allowedHosts = new Set(['localhost', '127.0.0.1']);

    const server = http.createServer((req, res) => {
      const requestHost = (req.headers.host ?? '').replace(/:\d+$/, '');
      if (!allowedHosts.has(requestHost)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad Request: invalid Host header');
        return;
      }

      const url = new URL(req.url ?? '/', `http://localhost`);

      if (url.pathname !== '/setup-oauth') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>404</h1></body></html>');
        return;
      }

      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ServalSheets — ${escapeHtml(provider)} OAuth Setup</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 520px; margin: 60px auto; padding: 20px; }
    h1  { font-size: 1.4rem; margin-bottom: 4px; }
    .sub { color: #666; font-size: 0.9rem; margin-bottom: 24px; }
    label { display: block; font-weight: 600; margin-bottom: 6px; margin-top: 16px; }
    .optional { font-weight: 400; color: #888; font-size: 0.85rem; }
    input[type=text], input[type=password] {
      width: 100%; padding: 10px 12px; font-size: 1rem;
      border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box;
    }
    button {
      margin-top: 24px; background: #1a73e8; color: #fff; border: none;
      padding: 10px 24px; font-size: 1rem; border-radius: 6px; cursor: pointer;
    }
    button:hover { background: #1558b0; }
  </style>
</head>
<body>
  <h1>Configure ${escapeHtml(provider)} OAuth</h1>
  <p class="sub">Credentials are stored locally and never leave your machine.</p>
  <form method="POST" action="/setup-oauth" autocomplete="off">
    <label for="cid">Client ID</label>
    <input type="text" id="cid" name="clientId" required autofocus>
    <label for="cs">Client Secret</label>
    <input type="password" id="cs" name="clientSecret" required>
    <label for="at">Access Token <span class="optional">(optional)</span></label>
    <input type="text" id="at" name="accessToken">
    <label for="rt">Refresh Token <span class="optional">(optional)</span></label>
    <input type="text" id="rt" name="refreshToken">
    <button type="submit">Save credentials</button>
  </form>
</body>
</html>`);
        return;
      }

      if (req.method === 'POST') {
        if (resolved) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body><h1>Already saved</h1></body></html>');
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
          if (body.length > 8192) req.destroy();
        });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          const clientId = params.get('clientId')?.trim() ?? '';
          const clientSecret = params.get('clientSecret')?.trim() ?? '';
          const accessToken = params.get('accessToken')?.trim() || undefined;
          const refreshToken = params.get('refreshToken')?.trim() || undefined;

          if (!clientId || !clientSecret) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html><html><body>
              <h1>Missing required fields</h1>
              <p>Client ID and Client Secret are required.</p>
            </body></html>`);
            return;
          }

          resolved = true;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ServalSheets — Saved</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 520px; margin: 80px auto; padding: 20px; text-align: center; }
    h1 { color: #2e7d32; }
  </style>
  <script>setTimeout(() => window.close(), 3000);</script>
</head>
<body>
  <h1>✅ Credentials saved</h1>
  <p>${escapeHtml(provider)} OAuth is now configured in ServalSheets.</p>
  <p style="color:#666;font-size:.9rem">You can close this window and return to Claude.</p>
</body>
</html>`);

          server.close();
          resolveCredentials({ clientId, clientSecret, accessToken, refreshToken });
        });
        return;
      }

      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
    });

    server.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        rejectHandle(new Error(`Failed to start oauth-credentials server: ${err.message}`));
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      const url = `http://localhost:${port}/setup-oauth`;

      allowedHosts.add(`localhost:${port}`);
      allowedHosts.add(`127.0.0.1:${port}`);

      logger.info(`OAuth credentials server listening on ${url}`);

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          server.close();
          rejectCredentials(new Error(`OAuth credentials entry timed out after ${timeout}ms`));
        }
      }, timeout);

      server.on('close', () => clearTimeout(timeoutId));

      const shutdown = (): void => {
        if (!resolved) {
          resolved = true;
          server.close();
          rejectCredentials(new Error('OAuth credentials server shut down'));
        }
      };

      resolveHandle({ credentialsPromise, url, shutdown });
    });
  });
}
