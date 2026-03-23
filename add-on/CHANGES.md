# Add-on Changes

## Session 80 — Schema Alignment + History/UI Corrections (2026-03-15)

- Corrected add-on wrapper drift for `sheets_history`, `sheets_agent`, `sheets_compute`, `sheets_connectors`, and `sheets_federation` so requests now match the live 402-action schemas instead of stale aliases
- Fixed history semantics in the sidebar: per-row action is now `Revert to Here` via `sheets_history.revert_to`, while `undoLastOperations()` loops over real `sheets_history.undo`
- Added `executeToolAction()` helper so structured sidebar actions can inject active-sheet context when needed
- Sidebar now renders structured `dataQualityWarnings` with expandable details and executable Fix buttons, per-field `_truncated` chips, proper `warning`/`system` labels, and a `📊 Build Dashboard` quick action
- Updated add-on docs to 402 actions and extended doc-count validation coverage to include `add-on/README.md`

## Session 79 — Full Tool Coverage + Rich Suggestions UI (2026-03-15)

**4 missing tools now fully wrapped (sheets_agent, sheets_compute, sheets_connectors, sheets_federation):**

- `sheets_agent`: `runAgentPlan`, `executeAgentPlan`, `executeAgentStep`, `getAgentStatus`, `rollbackAgentPlan`, `listAgentPlans`, `resumeAgentPlan` — autonomous goal-driven plan execution from sidebar
- `sheets_compute`: `computeAggregate`, `computeStatistics`, `computeRegression`, `computeForecast`, `computeSqlQuery`, `computeSqlJoin`, `evaluateExpression`, `explainFormula`, `batchCompute` — statistics, SQL, ML from sidebar
- `sheets_connectors`: `listConnectors`, `queryConnector`, `subscribeConnector`, `configureConnector`, `connectorStatus` — live market data (Finnhub, FRED, etc.)
- `sheets_federation`: `listFederatedServers`, `callRemoteMcp`, `validateFederationConnection`, `getFederatedServerTools` — remote MCP server calls

**High-value action gap wrappers added:**

- `sheets_history`: `redoOperation`, `revertTo`, `restoreCells`
- `sheets_analyze`: `scoutSpreadsheet`, `autoEnhance`, `analyzeFormulas`
- `sheets_session`: `saveCheckpoint`, `loadCheckpoint`, `getSessionAlerts`
- `sheets_composite`: `deduplicateSheet`, `setupSheet`, `publishReport`, `createDataPipeline`
- `sheets_transaction`: `queueTransaction`, `getTransactionStatus`

**Sidebar.html enhancements:**

- 4 new quick action buttons: 💡 Smart Suggestions, 🤖 Run Agent, 📉 Compute, 🌐 Live Data
- Rich suggestion cards: `suggest_next_actions` responses now render as clickable cards with confidence %, Apply button per suggestion (`renderSuggestionsPanel`, `applySuggestionCard`, `addMessageHtml`)
- New client-side handlers: `quickAction_suggestNext`, `quickAction_runAgent`, `quickAction_compute`, `quickAction_liveData`

**appsscript.json scope update:**

- `spreadsheets.currentonly` → `spreadsheets` (enables cross-spreadsheet operations)
- Added `drive.readonly` (enables revision history for `getTimeline`, `diffRevisions`)

---

## Session 75 + 58 — MCP Elicitation Fixes & Response Intelligence (2026-03-14)

**Session 75 — MCP 2025-11-25 Elicitation spec compliance:**

- Fixed `ElicitationServer` interface: `createElicitationCompletionNotifier` returns notifier fn (not direct Promise)
- Fixed OAuth flows (`handleLogin`, `handleCallback`) to call the notifier correctly
- API key collection moved off elicitation form-mode to localhost browser form (`api-key-server.ts`) — satisfies MUST NOT constraint
- Removed dead export `initiateVerificationFlow` (was never called)

**Session 58 — Response Intelligence (+8 actions, 391→399):**

- `dataQualityWarnings` injected into every read/write response via `applyResponseIntelligence()`
- `_truncated: true` flag added to compacted responses (`response-compactor.ts`)
- New actions: `build_dashboard` (sheets_composite), `build_dependent_dropdown` (sheets_format), `suggest_next_actions` / `auto_enhance` (sheets_analyze), `model_scenario` / `compare_scenarios` / `create_scenario_sheet` (sheets_dependencies), `generate_sheet` / `preview_generation` (sheets_composite)
- Add-on wrappers updated to expose these actions

---

# Add-on Changes - Phase 1.1 Complete

## Summary

Fixed API endpoint integration between Google Workspace add-on and ServalSheets MCP server. **Verified no impact on Claude Desktop.**

## Changes Made

### 1. Fixed API Endpoint URL

**File:** `add-on/Code.gs` line 118

```diff
- const url = `${CONFIG.API_URL}/api/v1/mcp/call-tool`;
+ const url = `${CONFIG.API_URL}/mcp`;
```

**Why:** The `/api/v1/mcp/call-tool` endpoint doesn't exist. The actual endpoint is `/mcp`.

### 2. Updated to JSON-RPC 2.0 Format

**File:** `add-on/Code.gs` lines 119-130

**Before:**

```javascript
const payload = {
  name: tool,
  arguments: { request },
};
```

**After:**

```javascript
const payload = {
  jsonrpc: '2.0',
  id: Date.now(),
  method: 'tools/call',
  params: {
    name: tool,
    arguments: { request },
  },
};
```

**Why:** The `/mcp` endpoint expects JSON-RPC 2.0 protocol, not simple REST.

### 3. Added Required Accept Headers

**File:** `add-on/Code.gs` line 129

```javascript
headers: {
  'Authorization': `Bearer ${apiKey}`,
  'X-MCP-Client': 'workspace-addon/1.0.0',
  'Accept': 'application/json, text/event-stream'  // New
}
```

**Why:** MCP protocol requires these headers for content negotiation.

### 4. Updated Response Parsing

**File:** `add-on/Code.gs` lines 73-89

**Before:**

```javascript
if (result.content && result.content[0]) {
  // Parse MCP content
}
```

**After:**

```javascript
if (result.result && result.result.content && result.result.content[0]) {
  // Parse JSON-RPC 2.0 envelope
  const content = result.result.content[0];
  // ...
}
```

**Why:** JSON-RPC wraps the MCP response in a `result` field.

## Verification

### ✅ No Impact on Claude Desktop

**Confirmed through code analysis:**

1. **Different Transports:**
   - Claude Desktop: STDIO (`node dist/cli.js --stdio`)
   - Add-on: HTTP (`node dist/cli.js --http --port 3000`)

2. **Independent Processes:**
   - Claude Desktop runs as separate process
   - HTTP server runs independently
   - No shared state between them

3. **Isolated Sessions:**
   - Each HTTP connection gets unique session ID
   - Each session has its own MCP server instance
   - OAuth tokens isolated per user

**Evidence from source code:**

- [src/http-server.ts:1772](src/http-server.ts#L1772): `const newSessionId = randomUUID()`
- [src/http-server.ts:1800](src/http-server.ts#L1800): `const { mcpServer, taskStore } = await createMcpServerInstance(googleToken)`
- [src/cli.ts:252-268](src/cli.ts#L252-268): Conditional startup (STDIO vs HTTP)

### 🧪 Testing Performed

1. **HTTP Server Test:**

   ```bash
   node test-addon-endpoint.js
   # ✅ Server started on port 3000
   ```

2. **MCP Initialize Test:**

   ```bash
   curl -X POST http://localhost:3000/mcp \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize",...}'
   # ✅ Response: { protocolVersion: "2025-11-25", capabilities: {...} }
   ```

3. **Claude Desktop Verification:**
   - ✅ Runs on STDIO (not affected by HTTP server)
   - ✅ Uses separate process
   - ✅ No shared sessions

## Files Modified

1. `add-on/Code.gs` - Updated API integration (lines 104-198)

2. `add-on/IMPLEMENTATION_STATUS.md` - Created status tracking

3. `test-addon-endpoint.js` - Created test server script

## Next Steps

### Immediate (Phase 1.2)

1. **Expand Tool Wrappers** (8 → 22 tools)
   - Add sheets_core (5 functions)
   - Add sheets_dimensions (3 functions)
   - Add sheets_collaborate (3 functions)
   - Estimate: 2-3 days

2. **Update Sidebar UI**
   - Add 6 more quick actions
   - Estimate: 1 day

3. **Test Integration**
   - Deploy to test spreadsheet
   - Verify all tool calls work
   - Test error handling
   - Estimate: 1 day

### Future Phases

- **Phase 2:** Billing integration (optional)
- **Phase 3:** Advanced features (context, batch, history)
- **Phase 4:** Production deployment (OAuth, marketplace)
- **Phase 5:** Polish (testing, optimization)

## Deployment Instructions

### Local Testing

1. **Start test server:**

   ```bash
   npm run build
   node test-addon-endpoint.js
   ```

2. **Update Code.gs config:**

   ```javascript
   API_URL: 'http://localhost:3000';
   ```

3. **Deploy to Apps Script:**

   ```bash
   cd add-on/
   clasp push
   ```

4. **Test in Google Sheets:**
   - Open spreadsheet
   - ServalSheets > Show AI Assistant
   - Try quick actions

### Production Deployment

1. **Deploy backend:**

   ```bash
   # Deploy to cloud (Railway, Render, GCP)
   ```

2. **Enable OAuth:**
   - Set environment variables (OAUTH_CLIENT_ID, JWT_SECRET, etc.)
   - Update http-server config

3. **Update Code.gs:**

   ```javascript
   API_URL: 'https://api.servalsheets.com';
   ```

4. **Deploy add-on:**

   ```bash
   clasp push
   clasp deploy --description "Production v1.0.0"
   ```

## Known Issues

### Fixed

- ✅ Wrong API endpoint (`/api/v1/mcp/call-tool` → `/mcp`)
- ✅ Missing JSON-RPC 2.0 format
- ✅ Missing Accept headers
- ✅ Response parsing for JSON-RPC envelope

### Remaining

- ⚠️ Only 8/22 tools wrapped
- ⚠️ No batching layer for quota efficiency
- ⚠️ No environment detection (hardcoded localhost)
- ⚠️ No session management (each call creates new session)

## Performance Notes

- Each `callServalSheets()` = 1 URL Fetch quota unit
- Apps Script limits: 20,000 calls/day (consumer), 100,000/day (Workspace)
- **Recommendation:** Implement batching in Phase 1.4

## Security Notes

- Test server runs without OAuth (local only)
- Production requires proper OAuth setup
- API keys stored in UserProperties (encrypted by Google)
- Session tokens ephemeral (no persistence)

---

**Status:** Phase 1.1 ✅ Complete
**Next:** Phase 1.2 Tool Wrapper Expansion
**Estimated Time to MVP:** 4-5 days
