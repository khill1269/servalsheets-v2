#!/usr/bin/env npx tsx
/**
 * OAuth Setup Script
 *
 * Run this once to authenticate and store tokens for live API testing.
 *
 * Usage:
 *   npx tsx tests/live-api/setup/oauth-setup.ts /path/to/client_secret.json
 */

import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createServer } from 'http';
import { parse } from 'url';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface OAuthClientCredentials {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
}

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expiry_date: number;
}

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

async function main() {
  const clientSecretPath = process.argv[2];

  if (!clientSecretPath) {
    console.error('Usage: npx tsx tests/live-api/setup/oauth-setup.ts /path/to/client_secret.json');
    process.exit(1);
  }

  if (!existsSync(clientSecretPath)) {
    console.error(`File not found: ${clientSecretPath}`);
    process.exit(1);
  }

  console.log('🔐 ServalSheets OAuth Setup\n');

  // Read client credentials
  const clientCreds: OAuthClientCredentials = JSON.parse(readFileSync(clientSecretPath, 'utf-8'));
  const creds = clientCreds.installed || clientCreds.web;

  if (!creds) {
    console.error('Invalid client credentials file. Expected "installed" or "web" credentials.');
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    'http://localhost:3456/callback'
  );

  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force refresh token generation
  });

  console.log('📋 Opening browser for authentication...\n');
  console.log('If browser does not open, visit this URL:\n');
  console.log(authUrl);
  console.log('\n');

  // Start local server to receive callback
  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = parse(req.url || '', true);

      if (url.pathname === '/callback') {
        const code = url.query.code as string;
        const error = url.query.error as string;

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Authentication Failed</h1><p>${error}</p>`);
          reject(new Error(error));
          server.close();
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head><title>ServalSheets Auth Success</title></head>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>✅ Authentication Successful!</h1>
                <p>You can close this window and return to the terminal.</p>
              </body>
            </html>
          `);
          resolve(code);
          server.close();
          return;
        }
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(3456, () => {
      console.log('🌐 Waiting for authentication callback on http://localhost:3456...\n');

      // Try to open browser
      const start =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'start'
            : 'xdg-open';
      import('child_process').then(({ exec }) => {
        exec(`${start} "${authUrl}"`);
      });
    });

    // Timeout after 5 minutes
    setTimeout(
      () => {
        reject(new Error('Authentication timeout'));
        server.close();
      },
      5 * 60 * 1000
    );
  });

  console.log('🔄 Exchanging code for tokens...\n');

  // Exchange code for tokens
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  if (!tokens.refresh_token) {
    console.error('❌ No refresh token received. You may need to revoke access and try again.');
    console.error('   Visit: https://myaccount.google.com/permissions');
    process.exit(1);
  }

  // Create a test spreadsheet to use for testing
  console.log('📊 Creating test spreadsheet...\n');

  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  const spreadsheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: `SERVAL_TEST_${Date.now()}`,
      },
      sheets: [
        { properties: { title: 'TestData' } },
        { properties: { title: 'Benchmarks' } },
        { properties: { title: 'Formulas' } },
      ],
    },
  });

  const spreadsheetId = spreadsheet.data.spreadsheetId!;
  const spreadsheetUrl = spreadsheet.data.spreadsheetUrl!;

  console.log(`✅ Created test spreadsheet: ${spreadsheetUrl}\n`);

  // Save credentials
  const testCredsPath = resolve(__dirname, '../../config/test-credentials.json');

  const testCredentials = {
    oauth: {
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      redirect_uri: 'http://localhost:3456/callback',
      tokens: tokens as StoredTokens,
    },
    testSpreadsheet: {
      id: spreadsheetId,
      name: `SERVAL_TEST_${Date.now()}`,
      url: spreadsheetUrl,
    },
    testConfig: {
      timeoutMs: 30000,
      retryAttempts: 3,
      cleanupAfterTests: true,
    },
  };

  writeFileSync(testCredsPath, JSON.stringify(testCredentials, null, 2));
  console.log(`✅ Saved credentials to: ${testCredsPath}\n`);

  console.log('🎉 Setup complete! You can now run live API tests:\n');
  console.log('   TEST_REAL_API=true npm run test:live\n');
}

main().catch((error) => {
  console.error('❌ Setup failed:', error.message);
  process.exit(1);
});
