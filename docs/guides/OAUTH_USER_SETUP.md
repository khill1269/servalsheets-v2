---
title: OAuth User Authentication Setup
category: guide
last_updated: 2026-01-31
description: This guide sets up ServalSheets to prompt you for Google login instead of using a service account.
version: 1.6.0
tags: [oauth, authentication, setup, configuration, sheets]
audience: user
difficulty: intermediate
---

# OAuth User Authentication Setup

This guide sets up ServalSheets to **prompt you for Google login** instead of using a service account.

---

## Quick Setup (5 minutes)

### Step 1: Create Google OAuth Credentials

1. **Go to Google Cloud Console**: https://console.cloud.google.com
2. **Create or Select a Project**
3. **Enable Google Sheets API**:
   - Navigation Menu → APIs & Services → Library
   - Search "Google Sheets API"
   - Click "Enable"

4. **Configure OAuth Consent Screen**:
   - APIs & Services → OAuth consent screen
   - Choose "External" (for personal use)
   - Click "Create"
   - Fill in:
     - App name: `ServalSheets`
     - User support email: Your email
     - Developer contact: Your email
   - Click "Save and Continue"
   - **Scopes**: Click "Add or Remove Scopes"
     - Add: `https://www.googleapis.com/auth/spreadsheets`
     - Add: `https://www.googleapis.com/auth/drive.file`
   - Click "Save and Continue"
   - **Test users**: Add your email address
   - Click "Save and Continue"

5. **Create OAuth Client ID**:
   - APIs & Services → Credentials
   - Click "Create Credentials" → "OAuth client ID"
   - Application type: **Web application**
   - Name: `ServalSheets Local`
   - **Authorized redirect URIs**: Click "Add URI"
     - Add: `http://localhost:3000/callback`
   - Click "Create"
   - **IMPORTANT**: Copy the Client ID and Client Secret

---

### Step 2: Configure ServalSheets

Create a `.env` file in the project directory:

```bash
cd /Users/thomascahill/Documents/mcp-servers/servalsheets
cat > .env << 'EOF'
# Google OAuth Configuration
OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
OAUTH_CLIENT_SECRET=your-client-secret
OAUTH_REDIRECT_URI=http://localhost:3000/callback

# Server Configuration
HTTP_PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Session Configuration
SESSION_SECRET=$(openssl rand -hex 32)

# Allowed Redirect URIs (comma-separated)
ALLOWED_REDIRECT_URIS=http://localhost:3000/callback
EOF
```

**Replace** `your-client-id` and `your-client-secret` with values from Step 1.

---

### Step 3: Start the Server

```bash
npm run start:http
```

You should see:

```
ServalSheets HTTP Server starting...
OAuth provider initialized
Server listening on http://localhost:3000
Authorization URL: http://localhost:3000/authorize
```

---

### Step 4: Authorize Your Account

**Option A: Browser Authorization (Easiest)**

1. Open in your browser:

   ```
   http://localhost:3000/authorize?redirect_uri=http://localhost:3000/callback
   ```

2. You'll be redirected to Google's login page
3. Sign in with your Google account
4. Grant permissions to ServalSheets
5. You'll be redirected back and see: "Authorization successful!"

**Your tokens are now saved** and the server is ready to use!

**Option B: Command Line Authorization**

```bash
# Open the authorization URL
open "http://localhost:3000/authorize?redirect_uri=http://localhost:3000/callback"

# Follow the prompts in your browser
```

---

### Step 5: Update Claude Desktop Configuration

Edit Claude Desktop config:

```bash
nano ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

Change from stdio to HTTP transport:

```json
{
  "mcpServers": {
    "servalsheets": {
      "url": "http://localhost:3000",
      "transport": {
        "type": "http"
      }
    }
  }
}
```

**Or use the automated script**:

```bash
./scripts/setup-oauth.sh
```

---

### Step 6: Restart Claude Desktop

```bash
# Quit Claude Desktop completely
killall Claude

# Reopen from Applications
open -a Claude
```

Look for the 🔨 icon in the bottom-right corner (custom ServalSheets icon may not appear yet)!

---

## Testing

### Test 1: Check Server Health

```bash
curl http://localhost:3000/health
```

Expected: `{"status":"ok","version":"1.1.0"}`

### Test 2: Check Authorization Status

```bash
curl http://localhost:3000/auth/status
```

Expected: `{"authenticated":true,"email":"your@email.com"}`

### Test 3: Use in Claude Desktop

In Claude Desktop, try:

```
"List all my Google Sheets"
```

Or:

```
"Read the first 10 rows from this spreadsheet: [spreadsheet-url]"
```

---

## How It Works

### Authorization Flow

1. **First time**: You're prompted to log in with Google
2. **Tokens saved**: Access and refresh tokens stored encrypted locally
3. **Automatic refresh**: Tokens renewed automatically when expired
4. **Works with your sheets**: Access any sheet you own or have access to

### Token Storage

- Location: `~/.servalsheets/tokens.encrypted`
- Encryption: AES-256-GCM
- Encryption key: Stored in `SESSION_SECRET` environment variable
- Auto-refresh: Yes

### Security

- ✅ OAuth 2.1 compliant
- ✅ State parameter (CSRF protection)
- ✅ Encrypted token storage
- ✅ Automatic token refresh
- ✅ Local-only (no external servers)

---

## Troubleshooting

### "Redirect URI mismatch"

- Ensure redirect URI in Google Console exactly matches: `http://localhost:3000/callback`
- Check `.env` file has correct `OAUTH_REDIRECT_URI`

### "Access blocked: This app's request is invalid"

- You need to add your email as a test user in OAuth consent screen
- Or publish the app (not recommended for personal use)

### "Server not responding"

- Check server is running: `curl http://localhost:3000/health`
- Check port 3000 isn't in use: `lsof -i :3000`
- Check logs in terminal where you ran `npm run start:http`

### "Tokens expired" or "401 Unauthorized"

- Re-authorize: Visit `http://localhost:3000/authorize?redirect_uri=http://localhost:3000/callback`
- Check `SESSION_SECRET` hasn't changed in `.env`

### Claude Desktop not connecting

- Verify config file: `cat ~/Library/Application\ Support/Claude/claude_desktop_config.json`
- Ensure server is running on port 3000
- Check Claude Desktop logs: `~/Library/Logs/Claude/`

---

## Advantages Over Service Account

| Feature             | OAuth (User Auth)         | Service Account             |
| ------------------- | ------------------------- | --------------------------- |
| **Setup**           | Browser login             | Download JSON, share sheets |
| **Access**          | Your sheets automatically | Must share each sheet       |
| **Permissions**     | Same as your account      | Limited to shared sheets    |
| **User Experience** | Familiar Google login     | Technical setup             |
| **Token Refresh**   | Automatic                 | N/A                         |
| **Revocation**      | Google Account settings   | Delete JSON file            |

---

## Running in Production

For production deployment, see [PRODUCTION_DEPLOYMENT_GUIDE.md](./PRODUCTION_DEPLOYMENT_GUIDE.md).

Key differences:

- Use HTTPS with valid SSL certificate
- Update redirect URI to production domain
- Set `NODE_ENV=production`
- Use secure session secret management
- Enable rate limiting
- Set up monitoring

---

## Commands Reference

```bash
# Start HTTP server
npm run start:http

# Start with custom port
HTTP_PORT=8080 npm run start:http

# Check if authorized
curl http://localhost:3000/auth/status

# Authorize (open in browser)
open "http://localhost:3000/authorize?redirect_uri=http://localhost:3000/callback"

# Revoke tokens
curl -X POST http://localhost:3000/auth/revoke

# Check server health
curl http://localhost:3000/health
```

---

## Next Steps

Once authorized:

1. ✅ Access any of your Google Sheets
2. ✅ Read and write data
3. ✅ Create new sheets
4. ✅ Format and style cells
5. ✅ Add charts and comments
6. ✅ Use semantic queries

**No need to share sheets** - you have full access to everything in your Google Drive!

---

**Need Help?**

- Check logs: Terminal where server is running
- Server logs: `~/Library/Logs/Claude/mcp-server-servalsheets.log`
- Troubleshooting: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
