---
title: ServalSheets Test Account Setup Guide
category: guide
last_updated: 2026-01-31
description: This guide explains how to prepare a test account for Anthropic Directory submission verification.
version: 1.6.0
tags: [testing, setup, configuration, sheets]
audience: user
difficulty: intermediate
---

# ServalSheets Test Account Setup Guide

This guide explains how to prepare a test account for Anthropic Directory submission verification.

## Prerequisites

- Google Cloud Console access
- Google account for testing
- Basic familiarity with Google Sheets API

## Step 1: Create a Test Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project named `servalsheets-test`
3. Enable the following APIs:
   - Google Sheets API
   - Google Drive API

## Step 2: Configure OAuth Consent Screen

1. Navigate to **APIs & Services > OAuth consent screen**
2. Select **External** user type
3. Fill in required fields:
   - App name: `ServalSheets Test`
   - User support email: Your email
   - Developer contact: Your email
4. Add scopes:
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/drive.file`
5. Add test users (your Google account email)

## Step 3: Create OAuth Credentials

1. Navigate to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. Select **Web application**
4. Configure authorized redirect URIs:

   ```
   http://localhost:3000/callback
   http://localhost:6274/oauth/callback
   http://localhost:6274/oauth/callback/debug
   ```

5. Download the JSON credentials file

## Step 4: Create Test Spreadsheets

Create the following test spreadsheets in Google Sheets:

### 1. Basic Test Data (`ServalSheets-Test-Basic`)

| Name  | Age | City        | Score |
| ----- | --- | ----------- | ----- |
| Alice | 30  | New York    | 85    |
| Bob   | 25  | Los Angeles | 92    |
| Carol | 35  | Chicago     | 78    |
| David | 28  | Houston     | 88    |
| Eve   | 32  | Phoenix     | 95    |

### 2. Financial Data (`ServalSheets-Test-Financial`)

| Date       | Category | Amount | Description   |
| ---------- | -------- | ------ | ------------- |
| 2026-01-01 | Revenue  | 10000  | Product Sales |
| 2026-01-02 | Expense  | -2500  | Marketing     |
| 2026-01-03 | Revenue  | 15000  | Service Fees  |
| 2026-01-04 | Expense  | -1000  | Utilities     |
| 2026-01-05 | Revenue  | 8000   | Consulting    |

### 3. Formula Test (`ServalSheets-Test-Formulas`)

| A   | B   | C (Formula) |
| --- | --- | ----------- |
| 10  | 20  | =A1+B1      |
| 30  | 40  | =A2\*B2     |
| 50  | 60  | =SUM(A1:A3) |

### 4. Multi-Sheet Test (`ServalSheets-Test-MultiSheet`)

**Sheet1: Sales**

| Product  | Q1  | Q2  | Q3  | Q4  |
| -------- | --- | --- | --- | --- |
| Widget A | 100 | 120 | 150 | 180 |
| Widget B | 80  | 90  | 110 | 130 |

**Sheet2: Summary**

| Metric   | Value             |
| -------- | ----------------- |
| Total Q1 | =SUM(Sales!B2:B3) |
| Total Q2 | =SUM(Sales!C2:C3) |

## Step 5: Record Spreadsheet IDs

After creating the spreadsheets, record their IDs for testing:

```bash
# Example spreadsheet IDs (replace with actual IDs)
export TEST_SPREADSHEET_BASIC="1ABC...xyz"
export TEST_SPREADSHEET_FINANCIAL="1DEF...xyz"
export TEST_SPREADSHEET_FORMULAS="1GHI...xyz"
export TEST_SPREADSHEET_MULTISHEET="1JKL...xyz"
```

## Step 6: Test All Tool Categories

Use the test spreadsheets to verify each tool category:

### Authentication (`sheets_auth`)

```json
{"action": "status"}
{"action": "login"}
{"action": "logout"}
```

### Core Operations (`sheets_core`)

```json
{"action": "get", "spreadsheetId": "1ABC..."}
{"action": "list_sheets", "spreadsheetId": "1ABC..."}
{"action": "create", "title": "Test Created Sheet"}
```

### Data Operations (`sheets_data`)

```json
{"action": "read", "spreadsheetId": "1ABC...", "range": "Sheet1!A1:D5"}
{"action": "write", "spreadsheetId": "1ABC...", "range": "Sheet1!E1", "values": [["New Column"]]}
{"action": "append", "spreadsheetId": "1ABC...", "range": "Sheet1", "values": [["New", "Row", "Data"]]}
```

### Formatting (`sheets_format`)

```json
{"action": "set_background", "spreadsheetId": "1ABC...", "range": "A1:A5", "color": "#FF0000"}
{"action": "set_format", "spreadsheetId": "1ABC...", "range": "B1:B5", "format": {"bold": true}}
```

### Analysis (`sheets_analyze`)

```json
{"action": "comprehensive", "spreadsheetId": "1ABC..."}
{"action": "analyze_data", "spreadsheetId": "1ABC...", "range": "Sheet1!A1:D10"}
```

### Visualization (`sheets_visualize`)

```json
{"action": "suggest_chart", "spreadsheetId": "1ABC...", "range": "Sheet1!A1:D5"}
{"action": "chart_create", "spreadsheetId": "1ABC...", "range": "Sheet1!A1:D5", "chartType": "BAR"}
```

## Step 7: Document Test Results

Create a test results document with:

1. **Authentication Flow**
   - [ ] OAuth login successful
   - [ ] Token refresh works
   - [ ] Logout clears tokens

2. **Read Operations**
   - [ ] Single cell read
   - [ ] Range read
   - [ ] Batch read multiple ranges
   - [ ] Cross-sheet read

3. **Write Operations**
   - [ ] Single cell write
   - [ ] Range write
   - [ ] Append rows
   - [ ] Batch write

4. **Formatting**
   - [ ] Background colors
   - [ ] Font formatting
   - [ ] Borders
   - [ ] Number formats

5. **Advanced Features**
   - [ ] Chart creation
   - [ ] Pivot tables
   - [ ] Data validation
   - [ ] Conditional formatting

## Sharing Test Access with Anthropic

When submitting to the Anthropic Directory:

1. **Option A: Service Account** (Recommended)
   - Create a service account in Google Cloud
   - Share test spreadsheets with the service account email
   - Provide the service account JSON key file securely

2. **Option B: OAuth Credentials**
   - Provide OAuth client ID and secret
   - Add Anthropic test email to OAuth consent screen test users
   - Document the authentication flow

## Security Notes

- Never commit credentials to version control
- Use separate test project from production
- Revoke test credentials after verification is complete
- Delete test spreadsheets when no longer needed

---

_This guide ensures comprehensive testing coverage for Anthropic Directory submission._
