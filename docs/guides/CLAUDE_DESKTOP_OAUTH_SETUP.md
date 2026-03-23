---
title: Claude Desktop OAuth Setup (User Experience)
category: guide
last_updated: 2026-01-31
description: This document describes the user experience when installing ServalSheets with OAuth in Claude Desktop.
version: 1.6.0
tags: [oauth, authentication, setup, configuration, sheets]
audience: user
difficulty: intermediate
---

# Claude Desktop OAuth Setup (User Experience)

This document describes the **user experience** when installing ServalSheets with OAuth in Claude Desktop.

---

## What the User Sees

### 1. First Installation

User runs in terminal:

```bash
cd ~/Documents/mcp-servers/servalsheets
./scripts/setup-oauth.sh
```

The script asks for:

1. **Google OAuth Client ID** (from Google Cloud Console)
2. **Google OAuth Client Secret**

Then automatically:

- Creates `.env` file with credentials
- Builds the project
- Starts HTTP server in background
- Updates Claude Desktop config
- Displays authorization link

**Output**:

```
✓ Configuration saved
✓ Project built successfully
✓ HTTP server starting on port 3000
✓ Claude Desktop configured

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Next Steps:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Authorize your Google account by clicking:
   👉 http://localhost:3000/authorize?redirect_uri=http://localhost:3000/callback

2. Restart Claude Desktop (⌘+Q, then reopen)

3. In Claude Desktop, try:
   "List all my Google Sheets"

The first time you use any tool, you'll see a message with
the authorization link. Click it to authorize!
```

---

### 2. First Time Using in Claude Desktop

User opens Claude Desktop and types:

```
"List all my Google Sheets"
```

**Claude Desktop shows**:

```
I need to authorize access to your Google Sheets first.

🔐 Authorization Required

Please authorize ServalSheets to access your Google account:

1. Click this link to authorize:
   http://localhost:3000/authorize?redirect_uri=http://localhost:3000/callback

2. Sign in with your Google account
3. Grant permissions to ServalSheets
4. Come back here and try your request again!

This is a one-time setup. After authorizing, ServalSheets will
remember your credentials and work automatically.
```

---

### 3. User Clicks the Authorization Link

**Browser opens to**:

- Google's OAuth consent screen
- Shows "ServalSheets wants to access your Google Sheets"
- Lists permissions requested

**User clicks "Allow"**

**Browser shows**:

```
✅ Authorization Successful!

You can now close this window and return to Claude Desktop.

Your credentials have been securely saved and encrypted.
ServalSheets is ready to use!
```

---

### 4. Back in Claude Desktop

User types again:

```
"List all my Google Sheets"
```

**Now it works!** Claude responds:

```
Here are your Google Sheets:

1. Budget 2024 (last modified: 2 days ago)
2. Project Planning (last modified: 1 week ago)
3. Sales Data (last modified: 3 days ago)
...

Would you like me to read data from any of these sheets?
```

---

### 5. All Future Uses

From now on, it **just works**! No more authorization needed.

User can:

- Read any of their sheets
- Write data
- Create new sheets
- Format cells
- Add charts
- Everything!

The credentials are:

- ✅ Encrypted and stored securely
- ✅ Auto-refreshed when they expire
- ✅ Only accessible to ServalSheets on your machine

---

## User Perspective: Step-by-Step

### Initial Setup (One-Time)

**Time**: 5 minutes

1. Get OAuth credentials from Google Cloud Console
2. Run `./scripts/setup-oauth.sh`
3. Enter credentials when prompted
4. Click authorization link
5. Sign in with Google
6. Done!

### Daily Use

**Time**: Instant

1. Open Claude Desktop
2. Ask Claude to do things with your sheets
3. It just works!

---

## What Happens Behind the Scenes

### On First Tool Call

```
┌─────────────┐
│ User in     │
│ Claude      │  "List my sheets"
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ ServalSheets    │  Checks: Do we have tokens?
│ HTTP Server     │  Answer: No
└──────┬──────────┘
       │
       ▼ Returns error with authorization URL
┌─────────────────┐
│ Claude Desktop  │  Shows: "Please authorize at [link]"
└─────────────────┘
```

### User Authorizes

```
┌─────────────┐
│ User clicks │
│ auth link   │
└──────┬──────┘
       │
       ▼ Browser opens
┌─────────────────┐
│ Google OAuth    │  User signs in
│ Consent Screen  │  User grants permissions
└──────┬──────────┘
       │
       ▼ Redirects with code
┌─────────────────┐
│ ServalSheets    │  Exchanges code for tokens
│ /callback       │  Encrypts and saves tokens
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ Browser shows   │  "✅ Authorization Successful!"
│ success page    │
└─────────────────┘
```

### Subsequent Calls

```
┌─────────────┐
│ User in     │
│ Claude      │  "Read Sheet1 from [spreadsheet]"
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ ServalSheets    │  Checks: Do we have tokens?
│ HTTP Server     │  Answer: Yes! (auto-refreshed if needed)
└──────┬──────────┘
       │
       ▼ Makes API call
┌─────────────────┐
│ Google Sheets   │  Returns data
│ API             │
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ Claude Desktop  │  Shows: "Here's the data..."
└─────────────────┘
```

---

## Troubleshooting from User Perspective

### "I clicked the auth link but it says 'redirect URI mismatch'"

**Fix**: Make sure you added `http://localhost:3000/callback` as an authorized redirect URI in Google Cloud Console.

1. Go to Google Cloud Console
2. APIs & Services → Credentials
3. Click your OAuth client ID
4. Under "Authorized redirect URIs", add: `http://localhost:3000/callback`
5. Save
6. Try authorization link again

---

### "Claude says 'Server not responding'"

**Fix**: Make sure the HTTP server is running.

```bash
# Check if server is running
curl http://localhost:3000/health

# If not running, start it
npm run start:http
```

Or set up server to auto-start (see below).

---

### "I want to re-authorize with a different Google account"

**Fix**: Revoke current authorization and authorize again.

```bash
# Revoke current tokens
curl -X POST http://localhost:3000/auth/revoke

# Or delete token file
rm ~/.servalsheets/tokens.encrypted
```

Then click the authorization link again in Claude Desktop.

---

## Making HTTP Server Start Automatically

### Option 1: PM2 (Recommended)

```bash
# Install PM2 globally
npm install -g pm2

# Start server
cd ~/Documents/mcp-servers/servalsheets
pm2 start npm --name servalsheets -- run start:http

# Set to start on boot
pm2 startup
pm2 save

# Check status
pm2 status
```

### Option 2: launchd (macOS)

Create `~/Library/LaunchAgents/com.servalsheets.server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.servalsheets.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/YOUR_USERNAME/Documents/mcp-servers/servalsheets/dist/http-server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/YOUR_USERNAME/Documents/mcp-servers/servalsheets</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/servalsheets.out.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/servalsheets.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
</dict>
</plist>
```

Then:

```bash
# Load the service
launchctl load ~/Library/LaunchAgents/com.servalsheets.server.plist

# Check if running
launchctl list | grep servalsheets
```

---

## Security Notes (For Users)

### What gets stored on your computer

1. **`.env` file**: Your OAuth client credentials (ID and secret)
   - Location: Project directory
   - Permissions: Readable only by you

2. **Token file**: Your encrypted Google access tokens
   - Location: `~/.servalsheets/tokens.encrypted`
   - Encryption: AES-256-GCM
   - Permissions: Readable only by you

### What ServalSheets can access

Only the Google Sheets you own or have been shared with you. ServalSheets:

- ✅ Cannot access other users' sheets
- ✅ Cannot access sheets you don't have permission for
- ✅ Uses the same permissions as your Google account
- ✅ Runs entirely on your local machine
- ✅ No data sent to external servers (except Google's API)

### Revoking access

At any time, you can revoke ServalSheets' access:

**Option 1**: Via ServalSheets

```bash
curl -X POST http://localhost:3000/auth/revoke
```

**Option 2**: Via Google Account

1. Go to https://myaccount.google.com/permissions
2. Find "ServalSheets"
3. Click "Remove Access"

---

## Summary

**From the user's perspective, OAuth setup is**:

1. ⚡ **Quick**: 5 minutes one-time setup
2. 🎯 **Simple**: Just click a link and sign in
3. 🔐 **Secure**: Industry-standard OAuth 2.1
4. ✨ **Seamless**: After setup, it just works
5. 🔄 **Automatic**: Tokens refresh automatically

No technical knowledge required - just familiar with signing in to Google!
