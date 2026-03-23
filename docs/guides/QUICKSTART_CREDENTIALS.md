---
title: 'Quick Start: Get Google Credentials'
category: guide
last_updated: 2026-01-31
description: 'You need Google credentials to test ServalSheets. Here are two options:'
version: 1.6.0
tags: [sheets]
audience: user
difficulty: intermediate
---

# Quick Start: Get Google Credentials

You need Google credentials to test ServalSheets. Here are two options:

## Option 1: OAuth Token (Fastest - 2 minutes)

**Perfect for quick testing!**

1. Go to [Google OAuth Playground](https://developers.google.com/oauthplayground/)

2. Click the ⚙️ gear icon (top right) and check:
   - ☑ "Use your own OAuth credentials" (optional, but recommended)

3. In **Step 1 - Select & authorize APIs**:
   - Scroll down to "Google Sheets API v4"
   - Select:
     - ☑ `https://www.googleapis.com/auth/spreadsheets`
   - Scroll down to "Drive API v3"
   - Select:
     - ☑ `https://www.googleapis.com/auth/drive.file`
   - Click **"Authorize APIs"** button

4. Sign in with your Google account and grant permissions

5. In **Step 2 - Exchange authorization code for tokens**:
   - Click **"Exchange authorization code for tokens"**
   - Copy the **"Access token"** (starts with `ya29.`)

6. Use this token in Claude Desktop config:

   ```json
   {
     "mcpServers": {
       "servalsheets": {
         "command": "node",
         "args": ["/Users/thomascahill/Documents/mcp-servers/servalsheets/dist/cli.js"],
         "env": {
           "GOOGLE_ACCESS_TOKEN": "ya29.PASTE_TOKEN_HERE"
         }
       }
     }
   }
   ```

**Note**: OAuth tokens expire after 1 hour. This is perfect for testing, but for production use a service account.

## Option 2: Service Account (Recommended for Production)

**Takes 5-10 minutes but lasts forever**

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click **"Select a project"** → **"New Project"**
3. Name: `servalsheets-mcp`
4. Click **"Create"**

### Step 2: Enable APIs

1. In the search bar, type "Google Sheets API"
2. Click on it and click **"Enable"**
3. Go back and search "Google Drive API"
4. Click **"Enable"**

### Step 3: Create Service Account

1. In left sidebar: **IAM & Admin** → **Service Accounts**
2. Click **"Create Service Account"**
3. Name: `servalsheets-mcp`
4. Description: `MCP server for Claude Desktop`
5. Click **"Create and Continue"**
6. Skip role assignment (click **"Continue"**)
7. Click **"Done"**

### Step 4: Create Key

1. Click on the service account you just created
2. Go to **"Keys"** tab
3. Click **"Add Key"** → **"Create new key"**
4. Choose **JSON**
5. Click **"Create"**
6. File downloads automatically (e.g., `servalsheets-mcp-xxx.json`)

### Step 5: Save the Key

```bash
# Create config directory
mkdir -p ~/.config/google

# Move the downloaded key
mv ~/Downloads/servalsheets-mcp-*.json ~/.config/google/servalsheets-sa.json

# Secure it
chmod 600 ~/.config/google/servalsheets-sa.json
```

### Step 6: Get Service Account Email

```bash
# Extract the email (you'll need this to share spreadsheets)
cat ~/.config/google/servalsheets-sa.json | grep client_email
```

Should output something like:

```
"client_email": "servalsheets-mcp@your-project.iam.gserviceaccount.com"
```

**Save this email!** You'll need to share your Google Sheets with it.

### Step 7: Use in Claude Desktop

```json
{
  "mcpServers": {
    "servalsheets": {
      "command": "node",
      "args": ["/Users/thomascahill/Documents/mcp-servers/servalsheets/dist/cli.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/Users/thomascahill/.config/google/servalsheets-sa.json"
      }
    }
  }
}
```

## Which Should I Use?

| Factor               | OAuth Token            | Service Account         |
| -------------------- | ---------------------- | ----------------------- |
| **Setup Time**       | 2 minutes              | 10 minutes              |
| **Lifetime**         | 1 hour                 | Forever                 |
| **Best For**         | Quick testing          | Production use          |
| **Sharing Required** | No (uses your account) | Yes (must share sheets) |
| **Recommended**      | Testing today          | Long-term use           |

## Quick Testing Flow

**If you just want to test RIGHT NOW:**

1. Get OAuth token (2 minutes) - Option 1 above
2. Update Claude Desktop config with token
3. Restart Claude Desktop
4. Test with your own spreadsheets (no sharing needed!)

**For production:**

1. Create service account (10 minutes) - Option 2 above
2. Update Claude Desktop config with credentials path
3. Share spreadsheets with service account email
4. Restart Claude Desktop

## Next Steps

After getting credentials:

1. Update `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Restart Claude Desktop (⌘+Q then reopen)
3. Look for 🔨 icon in bottom-right (custom ServalSheets icon may not appear yet)
4. Test: "List sheets in this spreadsheet: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"

## Troubleshooting

### "Access token expired"

- OAuth tokens only last 1 hour
- Generate a new token from OAuth Playground
- Or switch to service account for permanent access

### "Permission denied"

- **For OAuth**: You automatically have access to your own sheets
- **For Service Account**: Must share sheet with service account email
  1. Open sheet in browser
  2. Click "Share"
  3. Add service account email
  4. Grant "Editor" permission

### "APIs not enabled"

- Go to Google Cloud Console
- Enable both:
  - Google Sheets API
  - Google Drive API

## Test Spreadsheet

You can test with this public spreadsheet (no sharing needed):

- ID: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`
- URL: https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
