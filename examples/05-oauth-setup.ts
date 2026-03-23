#!/usr/bin/env node
/**
 * ServalSheets Example 5: OAuth Authentication Setup (TypeScript)
 *
 * This example demonstrates how to set up OAuth 2.0 authentication for
 * user-facing applications that need to access Google Sheets on behalf of users.
 *
 * Features demonstrated:
 * - OAuth 2.0 authorization flow
 * - Token management (access + refresh tokens)
 * - Token storage and persistence
 * - Automatic token refresh
 * - Secure credential handling
 * - Full type safety with TypeScript
 *
 * Prerequisites:
 * - Node.js 22+
 * - npm install servalsheets googleapis @types/node open
 * - Google Cloud Project with OAuth credentials
 * - OAuth client ID and client secret
 *
 * Setup:
 * 1. Go to https://console.cloud.google.com
 * 2. Create or select a project
 * 3. Enable Google Sheets API
 * 4. Create OAuth 2.0 credentials (Desktop app or Web app)
 * 5. Download client secret JSON
 * 6. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables
 */

import { google, sheets_v4 } from 'googleapis';
import { OAuth2Client, Credentials } from 'google-auth-library';
import http from 'http';
import url from 'url';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// Types
// ============================================================================

interface TokenInfo {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  scope?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

const TOKEN_PATH = path.join(os.homedir(), '.servalsheets', 'tokens.json');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
];

// ============================================================================
// OAuth Client Setup
// ============================================================================

function createOAuth2Client(): OAuth2Client {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      'OAuth credentials not found. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.\n\n' +
        'To get credentials:\n' +
        '1. Go to https://console.cloud.google.com\n' +
        '2. Create/select a project\n' +
        '3. Enable Google Sheets API\n' +
        '4. Create OAuth 2.0 Client ID\n' +
        '5. Download credentials'
    );
  }

  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

// ============================================================================
// Authorization Flow
// ============================================================================

function getAuthUrl(oauth2Client: OAuth2Client): string {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

function startAuthServer(oauth2Client: OAuth2Client): Promise<Credentials> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (req.url && req.url.indexOf('/oauth2callback') > -1) {
          const qs = new url.URL(req.url, REDIRECT_URI).searchParams;
          const code = qs.get('code');

          if (!code) {
            throw new Error('No authorization code received');
          }

          console.log('\n✓ Received authorization code');

          const { tokens } = await oauth2Client.getToken(code);
          oauth2Client.setCredentials(tokens);

          console.log('✓ Tokens obtained successfully');

          res.end(`
            <!DOCTYPE html>
            <html>
              <head><title>Authorization Successful</title></head>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #4CAF50;">✓ Authorization Successful!</h1>
                <p>You can close this window and return to the terminal.</p>
              </body>
            </html>
          `);

          server.close();
          resolve(tokens);
        }
      } catch (err) {
        res.end('Error during authorization. Check terminal for details.');
        server.close();
        reject(err);
      }
    });

    server.listen(3000, () => {
      console.log('\n✓ Authorization server started on http://localhost:3000');
    });

    setTimeout(
      () => {
        server.close();
        reject(new Error('Authorization timeout'));
      },
      5 * 60 * 1000
    );
  });
}

async function authorize(oauth2Client: OAuth2Client): Promise<OAuth2Client> {
  console.log('\n[OAUTH] Starting authorization flow...');

  const existingTokens = await loadTokens();
  if (existingTokens) {
    console.log('✓ Found existing tokens');
    oauth2Client.setCredentials(existingTokens);

    try {
      await oauth2Client.getAccessToken();
      console.log('✓ Tokens are valid');
      return oauth2Client;
    } catch (error) {
      console.log('⚠ Tokens expired or invalid, re-authorizing...');
    }
  }

  const authUrl = getAuthUrl(oauth2Client);

  console.log('\n📋 Please authorize this application:');
  console.log('\n  ' + authUrl);
  console.log('\nOpening browser automatically...');

  const open = (await import('open')).default;
  try {
    await open(authUrl);
  } catch (error) {
    console.log('\n⚠ Could not open browser automatically');
  }

  console.log('\nWaiting for authorization...');
  const tokens = await startAuthServer(oauth2Client);

  await saveTokens(tokens);
  console.log('✓ Tokens saved to', TOKEN_PATH);

  return oauth2Client;
}

// ============================================================================
// Token Storage
// ============================================================================

async function loadTokens(): Promise<Credentials | null> {
  try {
    const data = await fs.readFile(TOKEN_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function saveTokens(tokens: Credentials): Promise<void> {
  const dir = path.dirname(TOKEN_PATH);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));

  if (process.platform !== 'win32') {
    await fs.chmod(TOKEN_PATH, 0o600);
  }
}

// ============================================================================
// Main Example
// ============================================================================

async function main(): Promise<void> {
  console.log('=== ServalSheets Example: OAuth Setup (TypeScript) ===\n');

  try {
    const oauth2Client = createOAuth2Client();
    console.log('✓ OAuth2 client created');

    await authorize(oauth2Client);

    const sheets = google.sheets({ version: 'v4', auth: oauth2Client as any });

    console.log('\n[TEST] Testing authenticated API access...');
    const response = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    console.log('✓ Successfully accessed spreadsheet');
    console.log(`  Title: ${response.data.properties?.title}`);
    console.log(`  Sheets: ${response.data.sheets?.length}`);

    console.log('\n=== Example Complete ===');
    console.log('\nKey Takeaways:');
    console.log('  1. OAuth 2.0 allows applications to access user data securely');
    console.log('  2. Refresh tokens enable long-term access without re-authorization');
    console.log('  3. Tokens should be stored securely (encrypted in production)');
    console.log('  4. TypeScript provides type safety for OAuth flow and tokens');
  } catch (error) {
    console.error('\n=== Example Failed ===');
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
