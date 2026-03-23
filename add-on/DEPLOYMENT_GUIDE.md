# ServalSheets Add-on Deployment Guide

**Status:** Phase 1 Complete - Ready for Deployment
**Version:** 1.0.0
**Last Updated:** 2026-02-17

## Prerequisites

- Google Account with Apps Script access
- Node.js and npm installed (for backend server)
- clasp CLI installed: `npm install -g @google/clasp`
- A Google Cloud Console project (for OAuth if needed)

## Quick Start (5 Minutes)

### 1. Deploy Backend Server (Local Testing)

```bash
# Navigate to project root
cd /path/to/servalsheets

# Build the backend
npm run build

# Start test server (OAuth disabled)
node test-addon-endpoint.js
```

Server will start at `http://localhost:3000/mcp`

### 2. Configure Apps Script

```bash
# Login to Google Apps Script
cd add-on/
clasp login

# Create new Apps Script project (first time only)
clasp create --type standalone --title "ServalSheets AI"

# Or link to existing project
cp .clasp.json.example .clasp.json
# Edit .clasp.json and add your scriptId
```

### 3. Deploy to Apps Script

```bash
# Push code to Apps Script
clasp push

# View in browser (optional)
clasp open
```

### 4. Test in Google Sheets

1. Open a Google Sheets document
2. Click **Extensions > Apps Script**
3. Click **Run > onOpen** (first time only)
4. Refresh the Google Sheets page
5. You should see **ServalSheets** menu
6. Click **ServalSheets > Show AI Assistant**
7. Test the 9 quick action buttons

## Features Available

### Quick Actions (9 buttons)

**AI Analysis:**

- 📊 **Analyze** - Comprehensive data analysis
- 🔢 **Formula** - Generate formulas from natural language
- 📈 **Chart** - Create/suggest charts
- 🔍 **Patterns** - Detect data patterns

**Spreadsheet Management:**

- 📋 **Sheets** - List all sheets/tabs with IDs
- ➕ **Add Sheet** - Create new sheet with custom name

**Data Operations:**

- ➕ **Rows** - Insert rows at specified position

**Collaboration:**

- 👥 **Share** - Share spreadsheet with users
- 💬 **Comments** - List all comments

### API Coverage

**19 wrapper functions across 7 tools:**

- sheets_data (read, write)
- sheets_analyze (comprehensive analysis, formulas, patterns)
- sheets_visualize (charts and suggestions)
- sheets_format (formatting)
- sheets_core (spreadsheet/sheet management)
- sheets_dimensions (row/column operations)
- sheets_collaborate (sharing, comments)

## Configuration

### Local Development

In `add-on/Code.gs`, the default configuration uses localhost:

```javascript
const CONFIG = {
  API_URL: 'http://localhost:3000',
  API_KEY_PROPERTY: 'SERVALSHEETS_API_KEY',
  PLAN_PROPERTY: 'SERVALSHEETS_PLAN',
  SESSION_ID_PROPERTY: 'SERVALSHEETS_SESSION_ID',
};
```

### Production Deployment

For production, update the API_URL:

```javascript
const CONFIG = {
  API_URL: 'https://api.servalsheets.com', // Your production URL
  // ... rest unchanged
};
```

## Architecture

### Session Management Flow

```
User Opens Sidebar
    ↓
getSessionId()
    ↓
Session cached? → Yes → Use cached session
    ↓ No
initializeSession()
    ↓
POST /mcp with method: initialize
    ↓
Extract session ID from SSE response
    ↓
Save to UserProperties
    ↓
Return session ID
    ↓
All tool calls include Mcp-Session-Id header
```

### Request Flow

```
User clicks quick action
    ↓
JavaScript handler (e.g., quickAction_listSheets)
    ↓
google.script.run.listSheets()
    ↓
Code.gs: listSheets()
    ↓
callServalSheets('sheets_core', { action: 'list_sheets' })
    ↓
Get session ID from cache
    ↓
POST /mcp with JSON-RPC 2.0 payload
    ↓
Parse MCP response
    ↓
Return to JavaScript handler
    ↓
Display in sidebar UI
```

## Troubleshooting

### Issue: "API key not configured"

**Solution:** Click **ServalSheets > Settings** and enter an API key

Note: For local testing with OAuth disabled, you can use any dummy key like "test-key"

### Issue: "Session not found"

**Symptoms:** Errors about invalid session after initialization

**Solutions:**

1. Clear cached session: Call `clearSession()` from Apps Script console
2. Check server logs for session creation
3. Verify server is running at the configured URL

### Issue: "No ServalSheets menu appears"

**Solutions:**

1. Run `onOpen()` from Apps Script editor
2. Refresh the Google Sheets page
3. Check browser console for errors
4. Verify clasp push succeeded

### Issue: "Server connection failed"

**Solutions:**

1. Verify backend server is running: `lsof -i:3000`
2. Check API_URL in CONFIG matches server address
3. For production: verify CORS settings allow Apps Script origin

## Testing Checklist

### Backend Tests

- [ ] Server starts without errors
- [ ] `/mcp` endpoint responds to POST requests
- [ ] Initialize method creates session
- [ ] Tool calls work with valid session ID

### Add-on Tests

- [ ] Menu appears in Google Sheets
- [ ] Sidebar opens without errors
- [ ] All 9 quick actions display correctly
- [ ] Session initialization succeeds
- [ ] At least one tool call succeeds (e.g., list sheets)

### Integration Tests

- [ ] Analyze button returns AI analysis
- [ ] Formula button generates formulas
- [ ] Chart button creates suggestions
- [ ] Patterns button detects patterns
- [ ] Sheets button lists all tabs
- [ ] Add Sheet creates new tab
- [ ] Rows button inserts rows
- [ ] Share button shares with user
- [ ] Comments button lists comments

## Production Deployment

### Backend Deployment Options

**Option 1: Railway**

```bash
railway login
railway init
railway up
```

**Option 2: Render**

- Connect GitHub repo
- Set build command: `npm run build`
- Set start command: `node dist/cli.js --http --port 3000`

**Option 3: Google Cloud Run**

```bash
gcloud run deploy servalsheets \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

### Add-on Configuration for Production

1. Update `API_URL` in `Code.gs` to production URL
2. Enable OAuth in backend: `enableOAuth: true`
3. Configure OAuth credentials in environment variables
4. Deploy: `clasp push && clasp deploy`
5. Submit to Google Workspace Marketplace (optional)

## Security Considerations

### Local Testing (OAuth Disabled)

- ⚠️ **Never expose test server to internet**
- Use only on localhost
- No real API keys needed
- For development/testing only

### Production (OAuth Enabled)

- ✅ Enable OAuth: `enableOAuth: true`
- ✅ Configure proper OAuth credentials
- ✅ Use HTTPS for all endpoints
- ✅ Set restricted CORS origins
- ✅ Validate all user inputs
- ✅ Store credentials securely
- ✅ Implement rate limiting

## Support & Documentation

**Project Repository:** https://github.com/khill1269/servalsheets

**Documentation:**

- Architecture: See `docs/development/`
- API Reference: See `docs/reference/`
- Troubleshooting: See `docs/guides/`

**Development Files:**

- Source: `add-on/*.gs` and `add-on/*.html`
- Status: `add-on/IMPLEMENTATION_STATUS.md`
- Changes: `add-on/CHANGES.md`

## Next Steps

After successful deployment:

1. **Expand Tool Coverage** - Add remaining 15 tools (optional)
2. **Enhanced UI** - Add more quick actions and features
3. **Error Handling** - Improve error messages and recovery
4. **Performance** - Implement caching and batching
5. **Production** - Deploy to cloud, enable OAuth, submit to marketplace

## Version History

### v1.0.0 (2026-02-17) - Phase 1 Complete

**Features:**

- 19 tool wrapper functions
- 7 tools covered (sheets_data, sheets_analyze, sheets_visualize, sheets_format, sheets_core, sheets_dimensions, sheets_collaborate)
- 9 quick action UI buttons
- Full MCP session management
- Automatic session retry logic

**Files:**

- Code.gs: 727 lines
- Sidebar.html: 573 lines
- Settings.html: 223 lines
- UsageStats.html: 237 lines
- appsscript.json: 32 lines

**Total:** 1,792 lines of add-on code

---

**Ready to deploy!** Start with step 1 above, or jump directly to testing if server is already running.
