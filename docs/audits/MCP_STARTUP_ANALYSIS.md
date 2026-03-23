# ServalSheets MCP Startup Analysis & Compliance Audit

> **Generated:** 2026-03-17 via live STDIO probe against ServalSheets v1.7.0
> **Protocol:** MCP 2025-11-25 | **Tools:** 25 | **Actions:** 404

---

## Executive Summary

ServalSheets scores **90.7% overall MCP compliance** (243/268 checks). The server passes every protocol-level requirement — initialization, capabilities, schemas, annotations, resources, and prompts are all structurally correct. The single failing category is **tool-level icons** (0/25 tools have icons wired into `tools/list`). Two design-level concerns affect LLM usability: flat schemas on 2 tools (collaborate, federation) and a 2.56 MB total startup payload dominated by tool schemas.

### Compliance Scorecard

| Category | Pass | Total | Score |
|----------|------|-------|-------|
| Initialize response | 9 | 9 | 100% |
| Tool count (25 expected) | 1 | 1 | 100% |
| Schema type:object | 25 | 25 | 100% |
| Schema has properties | 25 | 25 | 100% |
| Tool descriptions present | 25 | 25 | 100% |
| Annotations (all 4 hints) | 25 | 25 | 100% |
| **Tool icons present** | **0** | **25** | **0%** |
| Resources have uri+name | 68 | 68 | 100% |
| Templates have uriTemplate+name | 12 | 12 | 100% |
| Prompts have name+description | 48 | 48 | 100% |
| Required capabilities (5) | 5 | 5 | 100% |
| **Overall** | **243** | **268** | **90.7%** |

---

## 1. Initialize Response

The `initialize` response is fully compliant with MCP 2025-11-25.

| Field | Value | Status |
|-------|-------|--------|
| protocolVersion | `2025-11-25` | PASS |
| serverInfo.name | `servalsheets` | PASS |
| serverInfo.version | `1.7.0` | PASS |
| instructions | 43,900 chars (737 lines) | PASS |
| capabilities | 7 keys declared | PASS |

### Capabilities Declared

| Capability | Sub-fields | Status |
|------------|-----------|--------|
| tools | listChanged: true | PASS |
| resources | subscribe: true, listChanged: true | PASS |
| prompts | listChanged: true | PASS |
| logging | (enabled) | PASS |
| completions | (enabled) | PASS |
| tasks (optional) | list, cancel, requests.tools.call | PASS |
| experimental (optional) | (empty) | PASS |

---

## 2. Tools/List Response

All 25 tools registered. Total payload: **2,541 KB** (dominates startup).

### Per-Tool Schema Sizes

| Tool | Schema Size | Variants | Description | Annotations | Icons |
|------|------------|----------|-------------|-------------|-------|
| sheets_format | 246,805 B | 25 oneOf | 289 ch | 5/5 | MISS |
| sheets_dimensions | 186,540 B | 30 oneOf | 305 ch | 5/5 | MISS |
| sheets_advanced | 183,380 B | 31 oneOf | 267 ch | 5/5 | MISS |
| sheets_data | 153,204 B | 25 oneOf | 340 ch | 5/5 | MISS |
| sheets_visualize | 142,532 B | 18 oneOf | 303 ch | 5/5 | MISS |
| sheets_collaborate | 95,007 B | **flat** (40 enum) | 288 ch | 5/5 | MISS |
| sheets_compute | 93,313 B | 16 oneOf | 338 ch | 5/5 | MISS |
| sheets_analyze | 82,880 B | 22 oneOf | 316 ch | 5/5 | MISS |
| sheets_composite | 80,699 B | 21 oneOf | 317 ch | 5/5 | MISS |
| sheets_bigquery | 68,456 B | 17 oneOf | 294 ch | 5/5 | MISS |
| sheets_connectors | 57,578 B | 10 oneOf | 316 ch | 5/5 | MISS |
| sheets_core | 52,632 B | 21 oneOf | 294 ch | 5/5 | MISS |
| sheets_appsscript | 40,357 B | 19 oneOf | 408 ch | 5/5 | MISS |
| sheets_session | 39,123 B | 31 oneOf | 307 ch | 5/5 | MISS |
| sheets_agent | 37,380 B | 8 oneOf | 301 ch | 5/5 | MISS |
| sheets_quality | 27,023 B | 4 oneOf | 256 ch | 5/5 | MISS |
| sheets_fix | 19,071 B | 6 oneOf | 327 ch | 5/5 | MISS |
| sheets_confirm | 14,010 B | 5 oneOf | 277 ch | 5/5 | MISS |
| sheets_history | 13,784 B | 10 oneOf | 295 ch | 5/5 | MISS |
| sheets_templates | 12,585 B | 8 oneOf | 253 ch | 5/5 | MISS |
| sheets_transaction | 10,932 B | 6 oneOf | 261 ch | 5/5 | MISS |
| sheets_dependencies | 9,380 B | 10 oneOf | 292 ch | 5/5 | MISS |
| sheets_auth | 6,960 B | 5 oneOf | 230 ch | 5/5 | MISS |
| sheets_webhook | 3,847 B | **4 oneOf** (10 exp) | 476 ch | 5/5 | MISS |
| sheets_federation | 1,335 B | **flat** (4 enum) | 300 ch | 5/5 | MISS |

### Payload Composition

| Component | Size | % of Total |
|-----------|------|-----------|
| Tool input schemas (25 tools) | 1,639 KB | 62.6% |
| Other structure (names, JSON envelope) | 892 KB | 34.0% |
| Server instructions | 44 KB | 1.7% |
| Resources list (68 entries) | 14.5 KB | 0.6% |
| Prompts list (48 entries) | 12.3 KB | 0.5% |
| Descriptions + annotations | 10.9 KB | 0.4% |
| **Total** | **2,613 KB** | **100%** |

---

## 3. Schema Compliance (Deep)

### JSON Schema Structure

| Check | Result |
|-------|--------|
| All schemas `type: "object"` | PASS (25/25) |
| All schemas have `properties` | PASS (25/25) |
| All schemas have `$schema: draft/2020-12` | PASS (25/25) |
| `request` in `required` array | PASS (25/25) |
| No Zod type leaks (`ZodType`, `_def`) | PASS (25/25) |
| `additionalProperties` not `true` | PASS (25/25) |
| No `$ref` leaks to internal paths | PASS (25/25) |

### Discriminated Union Integrity

23 of 25 tools use `oneOf` discriminated unions where each variant has a `const` action literal. All variant counts match expected action counts exactly, with one intentional exception.

| Tool | Structure | Actions Found | Expected | Status |
|------|-----------|---------------|----------|--------|
| 23 tools | oneOf discriminated union | matches | matches | PASS |
| sheets_collaborate | **flat z.object** + action enum | 40 | 40 | PASS (degraded) |
| sheets_federation | **flat z.object** + action enum | 4 | 4 | PASS (degraded) |
| sheets_webhook | oneOf (filtered) | 4 | 10 | PASS (6 hidden: Redis absent) |

### Flat Schema Impact Analysis

Two tools use `z.object` instead of `z.discriminatedUnion`, which means Claude sees **all properties for every action** rather than per-action schemas:

**sheets_collaborate** (40 actions, 48 properties visible):
- Claude sees 48 undifferentiated properties when calling any of 40 actions
- `x-servalsheets.actionParams` provides per-action hints for all 40 actions (mitigates issue)
- Only `action` is marked as required in the schema — per-action required fields exist only in hints
- 36 of 40 actions have descriptions in their hints; 4 actions missing descriptions

**sheets_federation** (4 actions, 4 properties visible):
- Minimal impact — only 4 properties total, low confusion risk
- `x-servalsheets.actionParams` covers all 4 actions with required field hints
- Params field has 0 entries (empty) — relies entirely on hint text descriptions

### Webhook Action Filtering

The `enrichInputSchema()` filter correctly hides 6 Redis-dependent actions when Redis is absent. The `x-servalsheets.actionParams` hints are also correctly filtered to match — no leaked hints for hidden actions.

Visible (4): `watch_changes`, `subscribe_workspace`, `unsubscribe_workspace`, `list_workspace_subscriptions`
Hidden (6): `register`, `unregister`, `list`, `get`, `test`, `get_stats`
Also hidden (3 more than expected): `get_change_history`, `configure_notifications`, `get_notification_config`

---

## 4. Annotations Compliance

All 25 tools have complete MCP 2025-11-25 annotations with 5 fields each.

### Fields Present

| Field | Count | Status |
|-------|-------|--------|
| title | 25/25 | PASS |
| readOnlyHint | 25/25 | PASS |
| destructiveHint | 25/25 | PASS |
| idempotentHint | 25/25 | PASS |
| openWorldHint | 25/25 | PASS |
| Extra fields | 0 | PASS (clean) |

### Logical Consistency

No contradictions detected. Key patterns:

| Pattern | Tools | Count |
|---------|-------|-------|
| readOnly=true | analyze, quality, compute, confirm | 4 |
| destructive=true | core, data, format, dimensions, visualize, collaborate, advanced, fix, composite, templates, bigquery, appsscript, transaction, dependencies, webhook, agent | 16 |
| idempotent=true | format, quality, compute, session | 4 |
| openWorld=false (local only) | quality, compute, session, history | 4 |

All `readOnly=true` tools have `destructive=false` (no contradictions).

---

## 5. x-servalsheets Extension (actionParams)

All 25 tools include `x-servalsheets.actionParams` hints in their schemas. Coverage is comprehensive but not perfectly uniform.

### Hint Completeness

| Tool | Actions | Has Required | Has Optional | Has Description | Has Params |
|------|---------|-------------|-------------|----------------|-----------|
| sheets_auth | 5 | 1 | 5 | 5 | 5 |
| sheets_core | 21 | 20 | 21 | 21 | 21 |
| sheets_data | 25 | 25 | 25 | 25 | 25 |
| sheets_format | 25 | 25 | 25 | 24 | 25 |
| sheets_dimensions | 30 | 30 | 30 | 30 | 30 |
| sheets_visualize | 18 | 18 | 18 | 18 | 18 |
| sheets_collaborate | 40 | 39 | 40 | **4** | 40 |
| sheets_advanced | 31 | 31 | 31 | 31 | 31 |
| sheets_compute | 16 | 16 | 16 | 16 | 16 |
| sheets_session | 31 | 16 | 31 | 27 | 31 |
| sheets_federation | 4 | 3 | 1 | 4 | **0** |

Notable gaps:
- **sheets_collaborate**: Only 4 of 40 actions have descriptions in hints (10%). Most critical for the flat schema — descriptions help Claude know which params to use.
- **sheets_federation**: 0 of 4 actions have `params` detail objects. Relies entirely on `required` lists and description text.
- **sheets_session**: 16 of 31 actions have required field hints; 15 actions only have optional guidance.
- **sheets_auth**: Only 1 of 5 actions has a required field hint.

---

## 6. Resources Compliance

All 68 static resources and 12 URI templates pass structural compliance.

### Resource Categories

| Scheme | Count | Purpose |
|--------|-------|---------|
| sheets:// | 4 | Spreadsheet data, context |
| servalsheets:// | 13 | Reference, guides, decisions, examples, patterns, index, capabilities |
| metrics:// | 8 | Performance, dashboard, operations, cache, API, system, service, health |
| history:// | 4 | Operations, stats, recent, failures |
| knowledge:// | 3 | Index, search, deferred files |
| schema:// | 3 | Tool schemas, action guidance, index |
| health:// | 2 | Connection, restart policy |
| cache:// | 2 | Stats, deduplication |
| transaction:// | 2 | Stats, help |
| conflict:// | 2 | Stats, help |
| impact:// | 2 | Stats, help |
| validation:// | 2 | Stats, help |
| analyze:// | 4 | Stats, help, results, results/{id} |
| confirm:// | 2 | Stats, help |
| discovery:// | 2 | API health, versions |
| billing:// | 3 | Dashboard, allocation, invoices |
| debug:// | 2 | Time-travel checkpoints, cell blame |

### URI Templates (12)

| Template | Purpose |
|----------|---------|
| `sheets:///{spreadsheetId}` | Spreadsheet metadata |
| `sheets:///{spreadsheetId}/{range}` | Range values |
| `sheets:///{spreadsheetId}/context` | Full structural metadata |
| `sheets:///{spreadsheetId}/charts` | Chart list |
| `sheets:///{spreadsheetId}/charts/{chartId}` | Chart details |
| `sheets:///{spreadsheetId}/pivots` | Pivot tables |
| `sheets:///{spreadsheetId}/quality` | Quality report |
| `debug://time-travel/{spreadsheetId}/checkpoints` | Debug checkpoints |
| `debug://time-travel/{spreadsheetId}/blame/{cell}` | Cell blame |
| `schema://tools/{toolName}` | Full tool schema |
| `schema://actions/{toolName}` | Per-action guidance |
| `billing://dashboard/{tenantId}` | Cost dashboard |

---

## 7. Prompts Compliance

All 48 prompts pass structural compliance.

| Metric | Value | Status |
|--------|-------|--------|
| Total prompts | 48 | PASS |
| With arguments | 44 | — |
| Without arguments | 4 | — |
| All have name | 48/48 | PASS |
| All have description | 48/48 | PASS |
| All argument objects have name | 100% | PASS |

---

## 8. Server Instructions Analysis

The 43,900-character (737-line) instructions payload is well-structured and comprehensive.

### Structure

| Section | Purpose | ~Lines |
|---------|---------|--------|
| Step 1: Authentication | Mandatory auth flow | ~15 |
| Step 2: Set Context | Active spreadsheet setup | ~10 |
| Workflow Chain | Optimal sequence | ~5 |
| Tool Selection Decision Tree | Routing for all 402 actions | ~200 |
| Quick Routing Matrix | Intent → tool table | ~30 |
| Critical Rules (9) | Anti-patterns | ~30 |
| Error Recovery | Error codes + fixes | ~60 |
| Performance Tiers | Latency expectations | ~15 |
| MCP Protocol Features | Sampling, Elicitation, Tasks | ~30 |
| Common Patterns | Copy-paste chains | ~10 |
| Tool Chaining | 15+ multi-step workflows | ~60 |
| Interactive Wizards | Elicitation forms | ~15 |
| Range Strategy | Priority-ordered fetching | ~25 |
| Anti-Patterns | What NOT to do | ~15 |
| Examples | 15+ worked examples | ~80 |
| Advanced Patterns | Complex recipes | ~40 |
| Quota & Monitoring | Rate limits, savings | ~25 |
| Resource Discovery | How to find knowledge | ~10 |

---

## 9. Issues Found

### Critical (1)

| ID | Issue | Impact | Recommendation |
|----|-------|--------|----------------|
| C-1 | **Tool icons missing from tools/list** (0/25 tools) | Clients that render tool icons (Claude Desktop, Cursor) show no visual distinction. 25 SVGs exist in `TOOL_ICONS` and are passed to `registerTool()`, but the **tools-list-compat.ts** handler builds a new response object (lines 277-285) that omits the `icons` field. | Add `icons: tool.icons` to the `toolDefinition` object in `tools-list-compat.ts:277-285`. Single line fix. |

### Moderate (2)

| ID | Issue | Impact | Recommendation |
|----|-------|--------|----------------|
| M-1 | **sheets_collaborate flat schema** (48 props visible for all 40 actions) | Claude sees every property for every action. The flat design is intentional (MCP SDK bug with large discriminated unions producing empty `anyOf: []`), and the MCP spec actually recommends flat schemas. **Do NOT convert to discriminatedUnion.** But 36/40 actionParams lack descriptions — the primary disambiguation mechanism. | Add descriptions to all 40 action hints in `tool-discovery-hints.ts`. This is the correct fix given the flat schema design. |
| M-2 | **sheets_collaborate actionParams missing descriptions** (4/40 have descriptions) | For the flat schema tool that most needs per-action guidance, 90% of actions lack description text in hints. Claude has no way to know which of 48 properties apply to which action without reading full descriptions. | Add per-action descriptions to all 40 collaborate hints in `ACTION_HINT_OVERRIDES`. |

### Low (3)

| ID | Issue | Impact | Recommendation |
|----|-------|--------|----------------|
| L-1 | **sheets_federation actionParams have 0 `params` entries** | Hints exist but contain no field-level detail objects. Mitigated by only having 4 properties total. | Add `params` detail objects for `serverName`, `toolName`, `toolInput` fields in `ACTION_HINT_OVERRIDES`. |
| L-2 | **sheets_session — 15/31 actions lack required field hints** | Session actions may work without explicit required fields, but missing hints reduce Claude's confidence in constructing correct calls. | Add `required` arrays to remaining 15 session action hints. |
| L-3 | **sheets_auth — 4/5 actions lack required field hints** | Auth actions are simple but Claude doesn't know which params each action needs beyond `action`. | Add required field hints for `login`, `callback`, `logout`, `setup_feature`. |

### Informational (3)

| ID | Note |
|----|------|
| I-1 | All 25 schemas use `$schema: draft/2020-12` — consistent and modern. No Zod artifacts leak through. |
| I-2 | The `x-servalsheets` extension is a non-standard JSON Schema extension but is **fully MCP-compliant** — the spec allows `x-` vendor extensions in JSON Schema. LLM clients may not read these hints automatically, but they serve as supplementary guidance. |
| I-3 | **Webhook filtering is correct.** 6 Redis-dependent actions are hidden when Redis is absent, and 4 non-Redis actions remain visible. The original audit finding L-1 about "9 hidden" was incorrect — actions `get_change_history`, `configure_notifications`, `get_notification_config` simply don't exist in the webhook schema. No fix needed. |
| I-4 | **MCP spec recommends flat schemas over oneOf.** The spec states: *"Keep tool schemas as flat as possible. Deeply nested structures increase the token count and cognitive load for the LLM."* The collaborate and federation flat designs are actually the recommended approach. The MCP TypeScript SDK also has a known bug ([#1643](https://github.com/modelcontextprotocol/typescript-sdk/issues/1643)) where `z.discriminatedUnion()` schemas are silently dropped — ServalSheets already works around this for the 23 tools that use oneOf by converting via custom `toJsonSchema()`. |

---

## 10. Payload Breakdown

### What Claude's Context Window Receives

When Claude Desktop connects to ServalSheets, these are the approximate token costs (at ~4 chars/token):

| Component | Bytes | ~Tokens | Notes |
|-----------|-------|---------|-------|
| Server instructions | 43,900 | ~11,000 | In `initialize` response |
| Tool schemas (25 tools) | 1,639,000 | ~410,000 | In `tools/list` response |
| Tool descriptions (25) | ~7,300 | ~1,825 | In `tools/list` response |
| Tool annotations (25) | ~3,600 | ~900 | In `tools/list` response |
| Resources list (68) | 14,500 | ~3,625 | In `resources/list` response |
| Prompts list (48) | 12,300 | ~3,075 | In `prompts/list` response |
| **Total** | **~1,720,600** | **~430,425** | — |

Note: Most MCP clients do NOT put the full `tools/list` schema JSON into the LLM context window. Claude Desktop extracts tool names, descriptions, and simplified parameter info. The actual context window impact is significantly lower than 430K tokens, but the full schema is still transmitted over STDIO and parsed by the client.

### Top 5 Heaviest Schemas

| Rank | Tool | Schema Size | % of Total |
|------|------|------------|-----------|
| 1 | sheets_format | 246,805 B | 15.1% |
| 2 | sheets_dimensions | 186,540 B | 11.4% |
| 3 | sheets_advanced | 183,380 B | 11.2% |
| 4 | sheets_data | 153,204 B | 9.3% |
| 5 | sheets_visualize | 142,532 B | 8.7% |
| — | **Top 5 subtotal** | **912,461 B** | **55.7%** |

---

## 11. MCP Handshake Flow

```
Client                          Server
  │                               │
  ├──initialize──────────────────►│  49 KB response (capabilities + 44KB instructions)
  │                               │
  ├──notifications/initialized───►│  (no response)
  │                               │
  ├──tools/list──────────────────►│  2,541 KB response (25 tools + schemas)
  │                               │
  ├──resources/list──────────────►│  14.5 KB response (68 resources)
  │                               │
  ├──resources/templates/list────►│  2.1 KB response (12 templates)
  │                               │
  ├──prompts/list────────────────►│  12.3 KB response (48 prompts)
  │                               │
  └──(ready for tool calls)───────┘  Total: ~2.6 MB
```

---

## 12. Remediation Plan

### Fix 1: Wire tool icons into tools/list (C-1)

**Root cause:** `src/mcp/registration/tools-list-compat.ts:277-285` builds a custom `toolDefinition` object for the tools/list response but omits the `icons` field. The SDK's internal tool object *does* have `tool.icons` (set during `registerTool()`), but the compat handler drops it.

**File:** `src/mcp/registration/tools-list-compat.ts`
**Lines:** 277-285

**Change:**
```typescript
// BEFORE (line 277-285):
const toolDefinition: Record<string, unknown> = {
  name,
  title: tool.title,
  description: enrichToolDescription(name, tool.description),
  inputSchema,
  annotations: tool.annotations,
  execution: tool.execution,
  _meta: tool._meta,
};

// AFTER:
const toolDefinition: Record<string, unknown> = {
  name,
  title: tool.title,
  description: enrichToolDescription(name, tool.description),
  inputSchema,
  annotations: tool.annotations,
  icons: tool.icons,       // ← ADD: MCP 2025-11-25 tool icons
  execution: tool.execution,
  _meta: tool._meta,
};
```

**MCP spec reference:** Icons are `Icon[]` on the Tool object per MCP 2025-11-25. Each icon needs `src` (required, HTTPS URL or data: URI), optional `mimeType`, `sizes`, `theme`.

**Validation:** Re-run probe script, verify all 25 tools have `icons` arrays with SVG data URIs in the tools/list response.

**Risk:** None — additive, no schema change, no behavior change.
**Effort:** 1 line of code.

---

### Fix 2: Add collaborate actionParams descriptions (M-1, M-2)

**Root cause:** `src/mcp/registration/tool-discovery-hints.ts` `ACTION_HINT_OVERRIDES` for `sheets_collaborate` has 40 action entries but only 4 include `description` text. Since collaborate uses a flat schema (all 48 properties visible for every action), descriptions are the primary way Claude knows which params belong to which action.

**File:** `src/mcp/registration/tool-discovery-hints.ts`
**Section:** `sheets_collaborate` in `ACTION_HINT_OVERRIDES`

**Change:** Add `description` to all 40 collaborate action hints. Examples:

```typescript
sheets_collaborate: {
  share_add: {
    description: 'Share a spreadsheet with a user, group, or domain',
    required: ['spreadsheetId', 'type', 'role'],
    optional: { emailAddress: '...', domain: '...', sendNotification: '...', emailMessage: '...' },
    params: { /* ... */ },
  },
  comment_add: {
    description: 'Add a comment to a cell or range',
    required: ['spreadsheetId', 'content'],
    optional: { anchor: '...' },
    params: { /* ... */ },
  },
  // ... 38 more actions
}
```

**Validation:** Re-run probe, verify all 40 collaborate action hints have non-empty `description` fields.

**Risk:** None — metadata only, no schema change.
**Effort:** Medium — 40 descriptions to write. Can derive from existing `z.literal().describe()` text in `src/schemas/collaborate.ts`.

---

### Fix 3: Add federation actionParams `params` detail (L-1)

**Root cause:** `ACTION_HINT_OVERRIDES` for `sheets_federation` has `required` and `description` for all 4 actions, but `params: {}` (empty) for all of them. Claude doesn't get field-level type/description guidance.

**File:** `src/mcp/registration/tool-discovery-hints.ts`
**Section:** `sheets_federation` in `ACTION_HINT_OVERRIDES`

**Change:** Add `params` detail objects:

```typescript
sheets_federation: {
  call_remote: {
    description: 'Execute a tool on a remote MCP server',
    required: ['serverName', 'toolName'],
    optional: ['toolInput'],
    params: {
      serverName: { type: 'string', description: 'Name of the remote MCP server' },
      toolName: { type: 'string', description: 'Tool to invoke on the remote server' },
      toolInput: { type: 'object', description: 'Input parameters for the remote tool' },
    },
  },
  // ... 3 more actions
}
```

**Risk:** None. **Effort:** Small — 4 actions, 3 fields.

---

### Fix 4: Add session required field hints (L-2)

**Root cause:** `ACTION_HINT_OVERRIDES` for `sheets_session` has 31 action entries but only 16 specify `required` arrays. 15 actions have empty or missing `required` hints.

**File:** `src/mcp/registration/tool-discovery-hints.ts`
**Section:** `sheets_session` in `ACTION_HINT_OVERRIDES`

**Change:** Add `required` arrays for the 15 session actions that lack them. Derive from the Zod schema's `request.properties.action` variants in `src/schemas/session.ts`.

**Risk:** None. **Effort:** Small-medium — 15 actions to review.

---

### Fix 5: Add auth required field hints (L-3)

**Root cause:** `ACTION_HINT_OVERRIDES` for `sheets_auth` has 5 actions but only `status` has `required` fields. The other 4 (`login`, `callback`, `logout`, `setup_feature`) lack `required` hints.

**File:** `src/mcp/registration/tool-discovery-hints.ts`
**Section:** `sheets_auth` in `ACTION_HINT_OVERRIDES`

**Change:** Add `required` arrays:
- `login`: `required: []` (no params needed)
- `callback`: `required: ['code']`
- `logout`: `required: []`
- `setup_feature`: `required: ['feature']`

**Risk:** None. **Effort:** Minimal — 4 actions.

---

### Implementation Order

| Step | Fix | File(s) | Risk | Effort | Impact |
|------|-----|---------|------|--------|--------|
| 1 | **Fix 1: Wire icons** | `tools-list-compat.ts` | None | 1 line | 0% → 100% icon compliance |
| 2 | **Fix 5: Auth hints** | `tool-discovery-hints.ts` | None | 5 min | 1/5 → 5/5 auth hint coverage |
| 3 | **Fix 3: Federation params** | `tool-discovery-hints.ts` | None | 10 min | 0/4 → 4/4 federation params |
| 4 | **Fix 4: Session hints** | `tool-discovery-hints.ts` | None | 20 min | 16/31 → 31/31 session hints |
| 5 | **Fix 2: Collaborate descriptions** | `tool-discovery-hints.ts` | None | 45 min | 4/40 → 40/40 collaborate descriptions |

**After all fixes:**
- Run `npm run schema:commit` (regenerate metadata)
- Re-run STDIO probe to verify all fixes
- Expected compliance: **268/268 (100%)**

### NOT Fixing (Investigated and Rejected)

| Item | Reason |
|------|--------|
| Convert collaborate to discriminatedUnion | MCP spec recommends flat schemas. MCP SDK has known bug (#1643) with large discriminated unions. Current flat design + actionParams is the correct approach. |
| Reduce 2.56 MB payload | Not an MCP compliance issue. Clients parse JSON efficiently. Full schemas provide maximum LLM guidance. Consider DEFER_SCHEMAS as a performance optimization later, not a compliance fix. |
| Webhook "extra hidden" actions | False finding — `get_change_history`, `configure_notifications`, `get_notification_config` don't exist in the schema. The 6/10 filtering is correct. |
