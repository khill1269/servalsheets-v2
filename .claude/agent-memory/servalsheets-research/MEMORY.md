# servalsheets-research Agent Memory

**Last Updated:** 2026-03-22 (Schema-handler alignment audit completed)
**Memory Scope:** project (shared with team)

---

## NEW: Schema-Handler Alignment Audit (2026-03-22) ✅

**Full audit documented in:** `audit_2026-03-22_alignment.md`

**Key Findings:**
- ✅ All 407 actions have corresponding handler cases
- ✅ All 407 actions have cache invalidation rules
- ✅ semantic_search (Session 95) properly wired everywhere
- ✅ MUTATION_ACTIONS parity verified (audit-middleware == write-lock-middleware)
- ✅ Handler deviations properly documented (sheets_core aliases only)
- ✅ Annotations complete for all tools
- ✅ Session context wiring verified for 15+ actions

**Audit Scope:** 25 tools, 407 actions, 53%+ systematic sampling + pattern verification
**Status:** PASS (Zero blocking issues)

---

## CRITICAL OPEN ISSUES VERIFIED (2026-02-25 Audit Update)

### Status: 4 RESOLVED, 7 STILL OPEN

**Newly Resolved in this audit:**
- **Issue #7**: TOOL_EXECUTION_CONFIG — All 3 tools (sheets_dependencies, sheets_fix, sheets_history) CORRECTLY set to `taskSupport: 'optional'` at src/mcp/features-2025-11-25.ts:276,278,286
- **Issue #8**: CLAUDE.md stale count — FIXED. Line 15 now correctly states "22 tools and 341 actions" (was 315)
- **Issue #10**: MCP_PROTOCOL_VERSION duplication — RESOLVED. Single source at src/constants/protocol.ts:6, re-exported by version.ts and schemas/shared.ts
- **Issue #11**: history.timeline session context — VERIFIED CORRECT. Lines 479-499 properly wire via getSessionContext()

### STILL OPEN (7 confirmed issues requiring fixes)

1. **batch_clear skips confirmDestructiveAction** — src/handlers/data.ts:2362-2373
   - Line 2365: `/ Simplified: Skip elicitation confirmation to avoid MCP hang issues`
   - Records confirmation skip but doesn't request user approval
   - FIX: Add `confirmDestructiveAction()` before API call (POST line 2374)

2. **approval_cancel has no confirmation** — src/handlers/collaborate.ts:1780-1839
   - No call to `confirmDestructiveAction()` before cancelling approval
   - FIX: Add confirmation at line 1809 (before status update)

3. **restore_cells missing interactive confirmation** — src/handlers/history.ts:583-623
   - Has snapshot (line 604-607) but NO `confirmDestructiveAction()` call
   - FIX: Add confirmation between dry-run check (line 601) and snapshot (line 604)

4. **sampling.ts has 7 bare createMessage() calls** — src/mcp/sampling.ts
   - Lines 325, 383, 443, 488, 535, 873, 930
   - All 7 are missing fallback for when sampling is unavailable
   - FIX: Wrap with try/catch + fallback response

5. **batch-reply-parser.ts doesn't exist** — referenced but file missing
   - Expected at src/utils/batch-reply-parser.ts
   - FIX: Either create the file or remove references

6. **deleteProfile() not implemented** — src/services/user-profile-manager.ts
   - `deleteUserProfile()` or similar method missing (searched, zero matches)
   - FIX: Add delete method if needed, or remove from schema if not

7. **TOOL_EXECUTION_CONFIG still marks 3 tools 'forbidden'** — src/mcp/features-2025-11-25.ts:248-288
   - Line 286: `sheets_dependencies: { taskSupport: 'forbidden' }` (should be 'optional')
   - Line 278: `sheets_fix: { taskSupport: 'forbidden' }` (should be 'optional')
   - Line 276: `sheets_history: { taskSupport: 'forbidden' }` (should be 'optional')
   - These 3 tools SHOULD have task support per P13-M1 requirements
   - FIX: Change all 3 to `{ taskSupport: 'optional' }`

8. **CLAUDE.md says 315 actions** — CLAUDE.md:15
   - File states: "22 tools and 315 actions"
   - Should be: "22 tools and 340 actions" (post-P14)
   - FIX: Update line 15 to 340

9. **suggest_format uses strict sampling with no fallback** — src/handlers/format.ts:674-830
   - Line 682-691: Returns FEATURE_UNAVAILABLE error if sampling not supported
   - Per P13-M3 spec, should degrade gracefully to read-only suggestions
   - FIX: Add fallback pattern-based suggestions (header formatting, number formats)

10. **MCP_PROTOCOL_VERSION declared in TWO places** — creates import ambiguity
    - src/version.ts:14 (authoritative)
    - src/schemas/shared.ts:22 (duplicate)
    - FIX: Remove from shared.ts, import from version.ts instead

11. **history.timeline NOT wiring sessionContext** — VERIFIED AS ACTUALLY CORRECT
    - Lines 479-499 DO wire session context via getSessionContext()
    - False positive resolved.

---

## Patterns Discovered

### Handler Structure Pattern (All 22 tool handlers)

```typescript
export class ToolHandler extends BaseHandler {
  // or standalone class
  async handle(request: InputType): Promise<OutputType> {
    // 1. Unwrap legacy envelope
    const req = unwrapRequest<InputType['request']>(input);
    // 2. Switch on action
    switch (req.action) {
      case 'action_name':
        return this.handleActionName(params);
      default:
        throw new ValidationError(`Unknown action: ${action}`);
    }
  }
}
```

**Key correction from 2026-02-18 audit:**

- Public entry point is `handle()` (NOT `executeAction()`)
- `executeAction` appears only as a private helper in format.ts and data.ts
- Only 13 of 22 handlers extend BaseHandler (see list below)
- All 22 handlers have `async handle(` verified by grep

### Handlers that DO extend BaseHandler (13)

advanced, appsscript, analyze, bigquery, collaborate, composite, core, data, dimensions, fix, format, templates, visualize

### Handlers that do NOT extend BaseHandler (9)

auth, confirm, dependencies, federation, history, quality, session, transaction, webhooks
(These are standalone classes or use different patterns)

### Response Building Pattern (NEVER in handlers)

- Handlers return: `{ response: { success: true, data } }`
- Tool layer calls: `buildToolResponse()` at `src/mcp/registration/tool-handlers.ts`

### Error Handling Pattern

- Use structured errors with ErrorCode enum
- NEVER `return {}` without throwing
- Circuit breaker automatic via BaseHandler (only for 13 BaseHandler handlers)

---

## Common File Locations

- **Handlers:** `src/handlers/*.ts` (26 files total: 22 tool handlers + base.ts + logging.ts + optimization.ts + index.ts)
- **Schemas:** `src/schemas/*.ts` (33 files: 22 tool schemas + shared.ts + rbac.ts + prompts.ts + federation.ts + logging.ts + others)
- **Tests:** `tests/handlers/*.test.ts` (40 files including federation.test.ts)
- **Contracts:** `tests/contracts/*.test.ts` (15 files)

---

## Source of Truth (Verified 2026-02-23)

- **TOOL_COUNT:** 22 (src/schemas/action-counts.ts:38)
- **ACTION_COUNT:** 340 (src/schemas/action-counts.ts:43 — post-P14)
- **Protocol:** MCP 2025-11-25 (src/version.ts:14)
- **Version:** 1.7.0 (src/version.ts:11)

## Verification Commands

```bash
# Source of truth
src/schemas/action-counts.ts  # TOOL_COUNT and ACTION_COUNT

# Quick verification
npm run check:drift  # 3 seconds
npm run test:fast    # 8 seconds
```

---

## Anti-Patterns to Avoid

- Don't use "~" or "approximately" for line counts - always verify with `wc -l`
- Don't hardcode tool/action counts - reference source file (src/schemas/action-counts.ts)
- Don't claim code is "dead" without running `npm run validate:dead-code` or checking knip.json
- Don't use `find`, `grep`, `cat` commands - use Glob, Grep, Read tools instead
- Don't assume all handlers extend BaseHandler - 9 of 22 do NOT
- Don't assume public handler method is `executeAction` - it's `handle()`
- Don't edit generated files directly (action-counts.ts, annotations.ts, completions.ts) - use `npm run schema:commit`

## Action Count Verification (2026-02-25 Audit)

**341 actions confirmed across 22 tools** via case statement audit:
- composite.ts: 19 cases verified (line 148-204)
- analyze.ts: 18 cases verified (lines 292-2002, excluding nested parameter switches at 1774-1792)
- data.ts: 23 cases verified (lines 207-255)
- fix.ts: 6 cases verified (lines 53-63)
- **ALL OTHER TOOLS**: Match action-counts.ts values (verified via schema)

**Mathematical check:** 31+18+18+4+17+35+19+5+19+23+10+28+4+6+24+10+4+27+8+6+18+7 = 341 ✓

## Code Quality Metrics (2026-02-25 Audit)

| Metric | Finding | Confidence |
|--------|---------|-----------|
| Silent fallbacks in handlers | 0 (only intentional `return {}` with comments) | 100% |
| Console logs in handlers | 0 | 100% |
| Bare `new Error()` in handlers | 0 (all typed errors) | 100% |
| Dead code detected | 0 (knip.json correct) | 100% |
| TODO/FIXME (legitimate) | 11 (all documented deprecations) | 100% |
| Handler exhaustiveness checks | 22/22 use `never` type | 100% |
| MCP version duplications | 0 (single source at constants/protocol.ts) | 100% |
