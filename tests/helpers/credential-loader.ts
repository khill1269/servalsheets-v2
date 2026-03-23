/**
 * Integration Test Credential Loader
 *
 * Loads Google service account credentials for integration tests.
 * Supports both configuration file and environment variables.
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServiceAccountCredentials {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

export interface OAuthCredentials {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  tokens: {
    access_token: string;
    refresh_token: string;
    scope: string;
    token_type: string;
    expiry_date: number;
  };
}

export interface TestCredentials {
  serviceAccount?: ServiceAccountCredentials;
  oauth?: OAuthCredentials;
  testSpreadsheet: {
    id: string;
    name?: string;
    url?: string;
  };
  testConfig?: {
    timeoutMs?: number;
    retryAttempts?: number;
    cleanupAfterTests?: boolean;
  };
}

/**
 * Check if integration tests should run
 */
export function shouldRunIntegrationTests(): boolean {
  return process.env['TEST_REAL_API'] === 'true';
}

/**
 * Load test credentials from file or environment variables
 *
 * Priority order:
 * 1. Environment variable GOOGLE_TEST_CREDENTIALS_PATH
 * 2. tests/config/test-credentials.json
 * 3. Path specified in GOOGLE_APPLICATION_CREDENTIALS
 */
export async function loadTestCredentials(): Promise<TestCredentials | null> {
  // Check if we should even try to load credentials
  if (!shouldRunIntegrationTests()) {
    return null;
  }

  try {
    // Try loading from explicit test credentials path
    const explicitPath = process.env['GOOGLE_TEST_CREDENTIALS_PATH'];
    if (explicitPath && existsSync(explicitPath)) {
      const content = await readFile(explicitPath, 'utf-8');
      return JSON.parse(content);
    }

    // Try loading from default test config location
    const defaultConfigPath = resolve(__dirname, '../config/test-credentials.json');
    if (existsSync(defaultConfigPath)) {
      const content = await readFile(defaultConfigPath, 'utf-8');
      return JSON.parse(content);
    }

    // Try loading from GOOGLE_APPLICATION_CREDENTIALS as fallback
    const googleCredsPath = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
    if (googleCredsPath && existsSync(googleCredsPath)) {
      const serviceAccount = JSON.parse(await readFile(googleCredsPath, 'utf-8'));
      const spreadsheetId = process.env['TEST_SPREADSHEET_ID'];

      if (!spreadsheetId) {
        console.warn('⚠️  GOOGLE_APPLICATION_CREDENTIALS found but TEST_SPREADSHEET_ID is not set');
        return null;
      }

      return {
        serviceAccount,
        testSpreadsheet: {
          id: spreadsheetId,
          name: 'Test Spreadsheet',
        },
      };
    }

    // No credentials found
    return null;
  } catch (error) {
    console.error('❌ Error loading test credentials:', error);
    return null;
  }
}

/**
 * Get helpful error message when credentials are missing
 */
export function getMissingCredentialsMessage(): string {
  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Integration Test Credentials Not Found

  To run integration tests, you need to set up Google Sheets API credentials.

  Quick Setup:

  1. Copy the example configuration:
     cp tests/config/test-credentials.example.json tests/config/test-credentials.json

  2. Follow the setup guide:
     cat tests/INTEGRATION_TEST_SETUP.md

  3. Run tests with:
     TEST_REAL_API=true npm test

  Environment Variables (Alternative):

    export GOOGLE_TEST_CREDENTIALS_PATH=/path/to/credentials.json
    export TEST_SPREADSHEET_ID=your-spreadsheet-id
    export TEST_REAL_API=true

  For detailed instructions, see: tests/INTEGRATION_TEST_SETUP.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
}

/**
 * Validate that credentials have all required fields
 */
export function validateCredentials(creds: TestCredentials): boolean {
  // Must have either service account or OAuth credentials
  if (!creds.serviceAccount && !creds.oauth) {
    console.error('❌ Missing credentials: need either serviceAccount or oauth');
    return false;
  }

  if (creds.serviceAccount) {
    const requiredFields = ['type', 'project_id', 'private_key', 'client_email'];

    for (const field of requiredFields) {
      if (!creds.serviceAccount[field as keyof typeof creds.serviceAccount]) {
        console.error(`❌ Missing required field in serviceAccount: ${field}`);
        return false;
      }
    }
  }

  if (creds.oauth) {
    if (!creds.oauth.client_id || !creds.oauth.client_secret) {
      console.error('❌ Missing client_id or client_secret in oauth credentials');
      return false;
    }
    if (!creds.oauth.tokens?.refresh_token) {
      console.error('❌ Missing refresh_token in oauth credentials');
      return false;
    }
  }

  if (!creds.testSpreadsheet?.id) {
    console.error('❌ Missing testSpreadsheet.id in credentials');
    return false;
  }

  return true;
}

/**
 * Helper to skip tests gracefully with a helpful message
 */
export async function checkCredentialsOrSkip(): Promise<TestCredentials> {
  const credentials = await loadTestCredentials();

  if (!credentials) {
    console.log(getMissingCredentialsMessage());
    throw new Error(
      'Integration test credentials not configured. See message above for setup instructions.'
    );
  }

  if (!validateCredentials(credentials)) {
    throw new Error('Invalid credentials configuration. Check the error messages above.');
  }

  return credentials;
}
