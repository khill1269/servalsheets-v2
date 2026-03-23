---
title: Integration Tests - Quick Start
category: development
last_updated: 2026-01-31
description: Get integration tests running in 5 minutes!
version: 1.6.0
tags: [testing, sheets]
---

# Integration Tests - Quick Start

Get integration tests running in 5 minutes!

## Prerequisites

- Google account
- 10 minutes for Google Cloud setup
- Node.js installed

## Steps

### 1. Create Google Cloud Project (2 min)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create new project: "ServalSheets Testing"
3. Enable APIs:
   - Google Sheets API
   - Google Drive API

### 2. Create Service Account (2 min)

1. Go to "APIs & Services" > "Credentials"
2. Create credentials > Service Account
3. Name: `servalsheets-test`
4. Skip roles and user access
5. Click on the service account
6. Go to "Keys" tab
7. "Add Key" > "Create new key" > JSON
8. Download and save the JSON file

### 3. Create Test Spreadsheet (1 min)

1. Go to [sheets.google.com](https://sheets.google.com)
2. Create new spreadsheet
3. Name it "ServalSheets Test Sheet"
4. Note the ID from the URL:

   ```
   https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
   ```

5. Click "Share"
6. Add the service account email from step 2
7. Set permission to "Editor"
8. Uncheck "Notify people"
9. Click "Share"

### 4. Configure Tests (2 min)

```bash
# Copy example config
cp tests/config/test-credentials.example.json tests/config/test-credentials.json

# Edit the file and:
# 1. Replace serviceAccount with contents from downloaded JSON
# 2. Set testSpreadsheet.id to your spreadsheet ID
```

### 5. Run Tests (30 sec)

```bash
TEST_REAL_API=true npm test tests/integration/
```

## Expected Output

```
✅ Running integration tests against spreadsheet: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
   Using service account: servalsheets-test@your-project.iam.gserviceaccount.com

 ✓ tests/integration/values.integration.test.ts (23 tests) 1234ms

 Test Files  1 passed (1)
      Tests  23 passed (23)
```

## Troubleshooting

### "Credentials not found"

- Verify `tests/config/test-credentials.json` exists
- Check JSON is valid: `node -e "require('./tests/config/test-credentials.json')"`

### "Permission denied"

- Ensure spreadsheet is shared with service account
- Verify service account email is correct
- Check "Editor" permission is set

### Still stuck?

See full guides:

- [Integration Test Setup](./INTEGRATION_TEST_SETUP.md) - Detailed setup instructions
- [CI Setup](./CI_SETUP.md) - GitHub Actions configuration
- [Test Helpers](./helpers/README.md) - Using credential loader in tests

## Security Reminder

- `tests/config/test-credentials.json` is git-ignored
- Never commit credentials to version control
- Use separate test projects, not production
