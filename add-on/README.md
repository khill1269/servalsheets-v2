# ServalSheets Google Workspace Add-on

AI-powered Google Sheets assistant that runs inside Google Sheets, powered by the ServalSheets MCP server.

## Architecture

```
┌─────────────────────────────────────────┐
│   Google Sheets (Browser)              │
│   ┌─────────────────────────────────┐   │
│   │  Add-on UI (Sidebar.html)       │   │
│   │  - Chat interface               │   │
│   │  - Quick actions                │   │
│   └──────────┬──────────────────────┘   │
│              │ google.script.run        │
│   ┌──────────▼──────────────────────┐   │
│   │  Apps Script (Code.gs)          │   │
│   │  - API calls                    │   │
│   │  - Authentication               │   │
│   └──────────┬──────────────────────┘   │
└──────────────┼──────────────────────────┘
               │ HTTP/HTTPS
               │
    ┌──────────▼──────────────────────┐
    │  ServalSheets MCP Server        │
    │  (localhost:3000 or production) │
    │  - 25 tools, 407 actions        │
    │  - Billing integration          │
    └─────────────────────────────────┘
```

## Files

| File              | Purpose                             |
| ----------------- | ----------------------------------- |
| `appsscript.json` | Add-on manifest and OAuth scopes    |
| `Code.gs`         | Server-side Apps Script (API calls) |
| `Sidebar.html`    | Main chat interface UI              |
| `Settings.html`   | API key configuration dialog        |
| `UsageStats.html` | Usage statistics dialog             |

## Prerequisites

1. **Google Account** - For Apps Script development
2. **Node.js 18+** - For running ServalSheets server
3. **clasp** - Google's CLI for Apps Script

   ```bash
   npm install -g @google/clasp
   ```

## Setup Instructions

### Step 1: Start ServalSheets Server Locally

```bash
# In the servalsheets repository root
cd /path/to/servalsheets

# Install dependencies (if not already done)
npm install

# Build the server
npm run build

# Start HTTP server
npm run start:http
```

Server should start on `http://localhost:3000`

### Step 2: Install clasp and Login

```bash
# Install clasp globally
npm install -g @google/clasp

# Login to Google
clasp login
```

This will open a browser for Google authentication.

### Step 3: Create Apps Script Project

```bash
# From the add-on/ directory
cd add-on

# Create new standalone Apps Script project
clasp create --type standalone --title "ServalSheets AI"
```

This creates a `.clasp.json` file with your script ID.

### Step 4: Push Code to Apps Script

```bash
# Push all files to Apps Script
clasp push

# Or use watch mode for development
clasp push --watch
```

### Step 5: Open in Apps Script Editor

```bash
# Open the project in browser
clasp open
```

Or visit: https://script.google.com/home/projects/{YOUR_SCRIPT_ID}

### Step 6: Test in Google Sheets

1. Open any Google Sheets document
2. In the Apps Script editor, click **Run** > **Test as add-on**
3. Select a test document or create new one
4. Click **Test**

The add-on will appear in the sidebar!

## Configuration

### API Key (Optional for Local Testing)

For local testing without billing, you can skip the API key. The server will work directly.

For production:

1. Get API key from https://servalsheets.com
2. In Sheets: **ServalSheets > Settings**
3. Enter your API key
4. Click **Save Settings**

### Changing API URL

To switch between local and production:

1. **For local testing** (default):
   - In `Code.gs`, line 10: `API_URL: 'http://localhost:3000'`

2. **For production**:
   - In `Code.gs`, line 10: `API_URL: 'https://api.servalsheets.com'`

Push changes:

```bash
clasp push
```

## Testing Locally

### 1. Test Connection

1. Open Google Sheets
2. **ServalSheets > Settings**
3. Click **Test Connection**
4. Should see: "Connected to ServalSheets API successfully!"

If it fails, check:

- Is server running? (`curl http://localhost:3000/health`)
- Is API URL correct in Code.gs?
- Are there firewall issues?

### 2. Test Chat Interface

1. Open **ServalSheets > Show AI Assistant**
2. Try quick actions:
   - 📊 **Analyze** - Analyzes selected data
   - 🔢 **Formula** - Generates formulas
   - 📈 **Chart** - Suggests visualizations
   - 🔍 **Patterns** - Detects patterns

### 3. Test with Real Data

Create a test spreadsheet:

```
A1: Name    B1: Sales   C1: Region
A2: Alice   B2: 1000    C2: East
A3: Bob     B3: 1500    C3: West
A4: Carol   B4: 2000    C4: East
```

Select A1:C4 and ask:

- "What's the total sales?"
- "Which region has higher sales?"
- "Create a chart showing sales by person"

## Available Actions

The add-on exposes these MCP tools:

| Tool             | Actions                                          | Example              |
| ---------------- | ------------------------------------------------ | -------------------- |
| sheets_data      | read, write, append, batch_read, find_replace    | "Read the data"      |
| sheets_analyze   | comprehensive, detect_patterns, generate_formula | "Analyze this data"  |
| sheets_visualize | chart_create, suggest_chart, pivot_create        | "Create a chart"     |
| sheets_format    | set_format, set_background, set_borders          | "Format as currency" |
| sheets_core      | get, list_sheets, add_sheet                      | "List all sheets"    |

Full tool list: 25 tools with 407 actions (see [../README.md](../README.md))

## Development Workflow

### Making Changes

```bash
# 1. Edit files locally (Code.gs, Sidebar.html, etc.)

# 2. Push to Apps Script
clasp push

# 3. Refresh Google Sheets to see changes
# (Sometimes requires reopening the sidebar)
```

### Viewing Logs

```bash
# View Apps Script execution logs
clasp logs

# Or in browser:
# Apps Script Editor > Executions
```

### Debugging

1. **In Apps Script Editor**:
   - Set breakpoints in Code.gs
   - Click **Debug** > **Run function**

2. **In Browser Console** (for HTML files):
   - Right-click sidebar > **Inspect**
   - Check Console for JavaScript errors

## Common Issues

### "Failed to connect to ServalSheets API"

**Cause**: Server not running or wrong URL

**Fix**:

```bash
# Check if server is running
curl http://localhost:3000/health

# Should return: {"status":"ok"}

# Start server if not running
npm run start:http
```

### "API key not configured"

**Cause**: No API key set (only needed for production)

**Fix**: For local testing, ignore this. For production, add API key in Settings.

### "Network error" or CORS issues

**Cause**: Apps Script can't reach localhost (Apps Script runs on Google servers)

**Fix**: Apps Script **CAN** access localhost! But if you still see this:

1. Check firewall settings
2. Try using ngrok to expose localhost:

   ```bash
   ngrok http 3000
   # Use the ngrok URL in Code.gs
   ```

### Changes not appearing

**Fix**:

```bash
# Force push
clasp push --force

# Clear Apps Script cache
# In Sheets: Close sidebar, reopen spreadsheet
```

## Publishing to Google Workspace Marketplace

### Prerequisites

1. **OAuth Consent Screen** configured in Google Cloud Console
2. **Privacy Policy** URL
3. **Terms of Service** URL
4. **Support Email**

### Steps

1. **Prepare for Submission**:

   ```bash
   # Test thoroughly in multiple documents
   # Prepare screenshots (1280x800 px)
   # Write detailed description
   ```

2. **Deploy as Web App**:

   ```bash
   # In Apps Script Editor
   # Deploy > New deployment > Add-on
   ```

3. **Submit to Marketplace**:
   - Visit: https://console.cloud.google.com/marketplace
   - Click **Publish** > **Google Workspace Marketplace**
   - Fill out listing details
   - Submit for review (7-14 days)

4. **Update Production URL**:

   ```javascript
   // In Code.gs, change:
   API_URL: 'https://api.servalsheets.com';
   ```

## Pricing Tiers (With Billing Integration)

When billing is integrated, the add-on will enforce these limits:

| Plan           | Operations/Month | BigQuery | Apps Script | Price  |
| -------------- | ---------------- | -------- | ----------- | ------ |
| **Free**       | 1,000            | ❌       | ❌          | $0     |
| **Pro**        | 50,000           | ❌       | ❌          | $29/mo |
| **Team**       | 200,000          | ✅       | ✅          | $99/mo |
| **Enterprise** | Unlimited        | ✅       | ✅          | Custom |

See [../src/billing/plans.ts](../src/billing/plans.ts) for full feature matrix.

## Next Steps

### Phase 1: Test Locally ✅ (You are here)

- [x] Set up add-on structure
- [x] Test with local server
- [ ] Verify all quick actions work
- [ ] Test error handling (quota exceeded, network errors)

### Phase 2: Integrate Billing (Later)

- [ ] Fix billing code TypeScript errors
- [ ] Add billing middleware to MCP handlers
- [ ] Set up Supabase database
- [ ] Test quota enforcement

### Phase 3: Deploy to Production

- [ ] Deploy MCP server to cloud (Render, Railway, or GCP)
- [ ] Update API_URL in Code.gs
- [ ] Configure OAuth consent screen
- [ ] Submit to Workspace Marketplace

## Support

- **Issues**: https://github.com/khill1269/servalsheets/issues
- **Docs**: https://github.com/khill1269/servalsheets
- **Email**: support@servalsheets.com (when production-ready)

## License

Same as ServalSheets - MIT License

---

Built with ❤️ using [ServalSheets MCP](https://github.com/khill1269/servalsheets)
