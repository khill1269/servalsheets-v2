---
title: Integration Test Setup Guide
category: development
last_updated: 2026-01-31
description: This guide explains how to set up and run integration tests for ServalSheets that connect to the real Google Sheets API.
version: 1.6.0
tags: [testing, setup, configuration, sheets]
---

# Integration Test Setup Guide

This guide explains how to set up and run integration tests for ServalSheets that connect to the real Google Sheets API.

## Overview

ServalSheets has 23 integration tests that verify real API interactions. These tests are skipped by default because they require:

- A Google Cloud project with the Sheets API enabled
- A service account with credentials
- A test spreadsheet shared with the service account

## Prerequisites

- A Google account
- Node.js and npm installed
- Access to Google Cloud Console

## Step-by-Step Setup

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" at the top
3. Click "New Project"
4. Enter a project name (e.g., "ServalSheets Testing")
5. Click "Create"
6. Wait for the project to be created and select it

### 2. Enable Google Sheets API

1. In your project, go to "APIs & Services" > "Library"
2. Search for "Google Sheets API"
3. Click on it and click "Enable"
4. Also enable "Google Drive API" (needed for some operations)

### 3. Create a Service Account

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "Service Account"
3. Enter details:
   - **Service account name**: `servalsheets-test`
   - **Service account ID**: `servalsheets-test` (auto-filled)
   - **Description**: "Service account for ServalSheets integration tests"
4. Click "Create and Continue"
5. Skip role assignment (click "Continue")
6. Skip user access (click "Done")

### 4. Generate Service Account Credentials

1. In the credentials list, click on your new service account email
2. Go to the "Keys" tab
3. Click "Add Key" > "Create new key"
4. Choose "JSON" format
5. Click "Create"
6. A JSON file will be downloaded to your computer
7. **IMPORTANT**: Keep this file secure! It contains sensitive credentials.

### 5. Create a Test Spreadsheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Create a new spreadsheet
3. Name it "ServalSheets Test Sheet" (or any name you prefer)
4. Note the spreadsheet ID from the URL:

   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
   ```

5. Create a sheet named "IntegrationTest" (or the tests will create it)

### 6. Share Spreadsheet with Service Account

1. In your test spreadsheet, click "Share"
2. Copy the service account email from the JSON file (looks like `servalsheets-test@your-project.iam.gserviceaccount.com`)
3. Paste it into the "Add people and groups" field
4. Set permission to "Editor"
5. Uncheck "Notify people" (service accounts don't need notifications)
6. Click "Share"

### 7. Configure Test Credentials

You have two options for configuring credentials:

#### Option A: Using Configuration File (Recommended for Local Development)

1. Copy the example configuration:

   ```bash
   cp tests/config/test-credentials.example.json tests/config/test-credentials.json
   ```

2. Open `tests/config/test-credentials.json` in your editor

3. Replace the `serviceAccount` section with the contents from your downloaded JSON file

4. Update the `testSpreadsheet` section:

   ```json
   {
     "testSpreadsheet": {
       "id": "your-actual-spreadsheet-id",
       "name": "ServalSheets Test Sheet",
       "url": "https://docs.google.com/spreadsheets/d/your-actual-spreadsheet-id"
     }
   }
   ```

5. Save the file

#### Option B: Using Environment Variables (Recommended for CI/CD)

Set these environment variables:

```bash
export GOOGLE_TEST_CREDENTIALS_PATH="/path/to/your/credentials.json"
export TEST_SPREADSHEET_ID="your-spreadsheet-id"
export TEST_REAL_API="true"
```

Or create a `.env.test` file:

```bash
GOOGLE_TEST_CREDENTIALS_PATH=/path/to/your/credentials.json
TEST_SPREADSHEET_ID=your-spreadsheet-id
TEST_REAL_API=true
```

### 8. Run Integration Tests

Run the integration tests with:

```bash
# Using npm script (will automatically load config)
npm run test:integration

# Or manually with environment variable
TEST_REAL_API=true npm test tests/integration/
```

## Configuration Options

The test configuration file supports these options:

```json
{
  "serviceAccount": {
    // Full service account JSON from Google Cloud
  },
  "testSpreadsheet": {
    "id": "spreadsheet-id", // Required: The ID of your test spreadsheet
    "name": "Display Name", // Optional: Human-readable name
    "url": "full-url" // Optional: Full URL for reference
  },
  "testConfig": {
    "timeoutMs": 30000, // Optional: Test timeout in milliseconds
    "retryAttempts": 3, // Optional: Number of retry attempts for flaky API calls
    "cleanupAfterTests": true // Optional: Clean up test data after running
  }
}
```

## Troubleshooting

### Tests are still skipped

- Ensure `TEST_REAL_API=true` is set
- Check that credentials file exists and is valid JSON
- Verify `TEST_SPREADSHEET_ID` is set

### "Permission denied" errors

- Verify the spreadsheet is shared with the service account email
- Ensure the service account has "Editor" permission
- Check that both Sheets API and Drive API are enabled

### "Spreadsheet not found" errors

- Verify the spreadsheet ID is correct
- Ensure the spreadsheet exists and hasn't been deleted
- Check that it's shared with the service account

### Authentication errors

- Verify the service account JSON is complete and valid
- Ensure the private key includes the BEGIN/END lines
- Check that the service account hasn't been deleted or disabled

### Rate limiting errors

- Google Sheets API has rate limits (100 requests per 100 seconds per user)
- Integration tests may hit these limits with parallel execution
- Consider running tests sequentially: `npm test -- --no-threads`

## Security Best Practices

1. **Never commit credentials**: The `.gitignore` is configured to exclude credential files
2. **Use separate test projects**: Don't use production service accounts for testing
3. **Rotate keys regularly**: Generate new service account keys periodically
4. **Limit permissions**: Only grant necessary API access
5. **Monitor usage**: Check Google Cloud Console for unexpected API usage

## What the Tests Cover

The integration tests verify:

- Reading values from ranges
- Writing and updating cell values
- Appending rows
- Clearing ranges
- Batch operations
- Find and replace
- Error handling with real API responses
- Safety rails (effect scope, dry-run mode)
- Value rendering options (formatted, unformatted, formula)

## Additional Resources

- [Google Sheets API Documentation](https://developers.google.com/sheets/api)
- [Service Account Authentication](https://cloud.google.com/iam/docs/service-accounts)
- [Google API Client Library](https://github.com/googleapis/google-api-nodejs-client)

## Need Help?

If you encounter issues:

1. Check the troubleshooting section above
2. Review test output for specific error messages
3. Verify your Google Cloud project setup
4. Ensure all APIs are enabled
5. Check service account permissions
