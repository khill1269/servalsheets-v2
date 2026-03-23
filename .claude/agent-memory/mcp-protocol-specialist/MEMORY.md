# MCP Protocol Specialist Memory

## Deep Compliance Audit (2026-02-25) -- MCP 2025-11-25

**Overall: 16/17 COMPLIANT, 1 WARNING (non-fatal error suppression)**

### Key File Locations

- Protocol version: `src/constants/protocol.ts:6` (MCP_PROTOCOL_VERSION = '2025-11-25')
- Version re-export: `src/version.ts:15` (re-exports from constants/protocol.ts)
- Server capabilities: `src/mcp/features-2025-11-25.ts:315-348`
- Tool registration: `src/server.ts:429-543` (22 tools via registerTool/registerToolTask)
- Tool definitions: `src/mcp/registration/tool-definitions.ts` (all 22 tool schemas + annotations)
- Response builder: `src/mcp/registration/tool-handlers.ts:626-821` (buildToolResponse)
- Input normalization: `src/mcp/registration/tool-handlers.ts:862-895` (normalizeToolArgs)
- Annotations (centralized): `src/schemas/annotations.ts:15-173` (all 22 tools, 5 fields each)
- Action annotations: `src/schemas/annotations.ts:191-692` (per-action intelligence)
- Action counts: `src/schemas/action-counts.ts` (22 tools, 341 actions)
- Sampling: `src/mcp/sampling.ts` (createMessage with withSamplingTimeout, GDPR consent gate)
- Completions: `src/mcp/completions.ts` (TOOL_ACTIONS, aliases, spreadsheet cache)
- Prompts: `src/mcp/registration/prompt-registration.ts` (38+ prompts)
- Resources: `src/mcp/registration/resource-registration.ts` (3 URI templates + 30+ extras)
- Icons: `src/mcp/features-2025-11-25.ts:76-231` (all 22 tools, SVG base64 data URIs)
- Server instructions: `src/mcp/features-2025-11-25.ts:366-709` (~700 lines LLM context)
- Task execution config: `src/mcp/features-2025-11-25.ts:248-288` (per-tool taskSupport)
- Non-fatal error codes: `src/mcp/registration/tool-handlers.ts:130-144`

### Compliance Matrix

| Feature | Status | Evidence |
|---------|--------|----------|
| Protocol Version | COMPLIANT | constants/protocol.ts:6 = '2025-11-25' |
| Tool Definition | COMPLIANT | 22 tools, snake_case, inputSchema+outputSchema+annotations |
| Tool Naming (SEP-986) | COMPLIANT | /^sheets_[a-z]+$/ regex validated by tests |
| Tool Annotations | COMPLIANT | All 5 fields (title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint) |
| CallToolResult format | COMPLIANT | content[TextContent] + structuredContent + isError |
| Error handling | WARNING | Non-fatal error suppression (isError=undefined for recoverable errors) |
| Resources | COMPLIANT | 3 URI templates, ReadResourceResult format |
| Prompts | COMPLIANT | 38+ prompts, GetPromptResult format |
| Sampling (SEP-1577) | COMPLIANT | Client capability check, advisory model hints, GDPR consent |
| Elicitation (SEP-1036) | COMPLIANT | 4 wizard flows, graceful degradation |
| Tasks (SEP-1686) | COMPLIANT | list+cancel+requests.tools.call in capabilities |
| Logging | COMPLIANT | logging/{} in capabilities, setLevel handler |
| Completions | COMPLIANT | values/total/hasMore in CompleteResult |
| Icons (SEP-973) | COMPLIANT | 22 tool icons, SVG data URIs, sizes field |
| Server Instructions | COMPLIANT | LLM context in initialize response |
| STDIO Transport | COMPLIANT | StdioServerTransport |
| HTTP/SSE Transport | COMPLIANT | SSE + StreamableHTTPServerTransport |

### Known Deviation: Non-Fatal Error Suppression

**File:** `tool-handlers.ts:130-144, 720-727`
**Severity:** WARNING (not BLOCKER)
**Description:** `buildToolResponse()` returns `isError: undefined` for error codes in `NON_FATAL_TOOL_ERROR_CODES` set. Strict spec interpretation says `isError` should be `true` for any failed tool execution.
**Affected codes:** VALIDATION_ERROR, INVALID_PARAMS, NOT_FOUND, PRECONDITION_FAILED, PERMISSION_DENIED, INCREMENTAL_SCOPE_REQUIRED, ELICITATION_UNAVAILABLE, CONFIG_ERROR, FEATURE_UNAVAILABLE, AUTHENTICATION_REQUIRED, NOT_AUTHENTICATED, NOT_CONFIGURED, TOKEN_EXPIRED
**Mitigation:** `_meta.nonFatalError: true` marker added to response
**Rationale:** Deliberate UX choice to prevent LLMs from treating recoverable errors as hard failures

### Advisory Note: toolChoice Format

- `sampling.ts:822` uses `toolChoice: { mode: 'auto' }` in agentic builder
- Spec says `{ type: 'auto' }` -- only affects the agentic builder helper, not normal sampling calls

### Architecture Patterns (Confirmed)

1. **Dual annotation sources**: Per-schema (SHEETS_*_ANNOTATIONS in tool-definitions.ts) and centralized (TOOL_ANNOTATIONS in annotations.ts). These may intentionally diverge.
2. **Legacy envelope normalization**: normalizeToolArgs() at tool-handlers.ts:862-895 wraps flat args in `{ request: {} }` for backward compatibility
3. **Output validation is advisory**: validateOutputSchema() at tool-handlers.ts:562-611 logs warnings but never blocks responses
4. **Response size management**: >100KB stored as temp resource with preview, >10MB same pattern (token budget)
5. **Sampling consent gate**: GDPR `assertSamplingConsent()` called before every createMessage()

---
**Last Updated:** 2026-02-25 | **Audit Scope:** 11 source files, 2 test files
