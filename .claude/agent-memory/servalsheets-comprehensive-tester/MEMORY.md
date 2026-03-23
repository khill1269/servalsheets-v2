# ServalSheets Comprehensive Tester - Agent Memory

## Key Findings (2026-02-18)

### Action Count Discrepancy
- **Actual count:** 22 tools, 315 actions (from `src/schemas/action-counts.ts`)
- **CLAUDE.md claims:** 305 actions
- **Capabilities resource says:** 305 actions, version 1.6.0
- **Package.json says:** version 1.7.0
- 6 tools have mismatched counts between MCP description and schema
- 9 actions missing from MCP tool enum definitions (invisible to Claude Code)

### Auth Gate Architecture
- ALL 21 non-auth tools gated at `src/server.ts:728` via `checkAuth()`
- Auth gate happens AFTER schema validation (Zod catches invalid actions first)
- Auth gate happens BEFORE handler-level parameter validation
- Local-only tools (session, history, confirm, transaction) are needlessly gated
- OAuth callback server on port 3000, 120s timeout, falls through to manual flow

### Error Handling Patterns
- Zod validation errors use `INTERNAL_ERROR` code instead of `INVALID_PARAMS`
- Zod errors are returned as raw JSON arrays in message string
- Invalid OAuth callback code returns "invalid_client" (misleading - should be "invalid_code")
- Auth error responses have well-structured resolution steps with `suggestedNextStep`

### Test Results (2026-02-18)
- 6680 total tests: 6019 pass, 28 fail, 633 skipped (99.5% pass rate)
- 12 failing test files, categorized:
  - 3 contract tests: Import `src/mcp/registration.js` which was deleted
  - 3 compliance tests: Server instructions decision tree coverage
  - 2 compliance tests: Response truncation hints
  - 1 chaos test: Token refresh exhaustion
  - 1 SDK test: Action count extraction
  - 1 util test: Webhook handler case count (expects 6, got 7)
  - 5 google-api service tests: Mock setup issue (`google.docs is not a function`)
  - 1 cache invalidation test: Missing invalidation rules for new actions

### MCP Resources
- 68 MCP resources registered
- Resources work even when not authenticated
- Schema resources provide complete input/output schema definitions
- Metrics dashboard tracks tool usage, cache, API efficiency

### Performance Baseline
- Server uptime: stable over 100+ minutes
- Memory usage: ~201MB (stable)
- Cache: 57% hit rate (schema-validation namespace)
- Fast test suite: 3.96s (81 files, 2112 tests)
- Full test suite: 13.48s (278 files, 6680 tests)

## Files to Reference
- Auth guard: `src/utils/auth-guard.ts`
- Auth gate in server: `src/server.ts:728`
- Action counts: `src/schemas/action-counts.ts`
- Tool completions: `src/mcp/completions.ts`
- Metadata generator: `scripts/generate-metadata.ts`
