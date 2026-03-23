---
title: MCP 2025-11-25 Compliance Checklist
category: general
last_updated: 2026-03-15
description: Verified MCP 2025-11-25 compliance checklist for ServalSheets, refreshed from the March 15, 2026 coordinator audit.
version: 1.7.0
tags: [mcp, compliance]
---

# MCP 2025-11-25 Compliance Checklist

This checklist is the verified output of the March 15, 2026 coordinator audit. It replaces older hand-maintained counts and status summaries with runtime-backed values and direct test evidence.

## Audit Baseline

- Normative source set: [docs/review/MCP_PROTOCOL_SOURCE_MANIFEST.md](../review/MCP_PROTOCOL_SOURCE_MANIFEST.md)
- Coordinator dossier: [docs/review/MCP_PROTOCOL_COORDINATOR_AUDIT.md](../review/MCP_PROTOCOL_COORDINATOR_AUDIT.md)
- Runtime snapshot validated on 2026-03-15: **25 tools, 407 actions, 48 prompts, 50 resources**
- Requested protocol target: **MCP 2025-11-25**
- Official MCP landing page on 2026-03-15 advertised **2025-06-18** as the latest published revision, so this checklist is intentionally pinned to **2025-11-25** rather than “current MCP”.

## Status Summary

| Area                                            | Status      | Evidence                                                                                                                                                                         |
| ----------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture and initialize flow                | ✅ Verified | `src/server.ts`, `src/mcp/features-2025-11-25.ts`, `tests/compliance/mcp-2025-11-25.test.ts`, `tests/contracts/mcp-protocol.test.ts`                                             |
| Tools and structured outputs                    | ✅ Verified | `src/mcp/registration/tool-definitions.ts`, `src/mcp/registration/tool-handlers.ts`, `tests/compliance/mcp-features.test.ts`, `tests/compliance/response-format-jsonrpc.test.ts` |
| Tasks and cancellation                          | ✅ Verified | `src/server.ts`, `src/core/task-store.ts`, `tests/integration/task-endpoints.test.ts`, `tests/mcp/tool-task-cancellation.test.ts`                                                |
| Resources and resource templates                | ✅ Verified | `src/mcp/registration/resource-registration.ts`, `src/server-runtime/resource-registration.ts`, `tests/server-runtime/resource-registration.test.ts`                             |
| Prompts                                         | ✅ Verified | `src/mcp/registration/prompt-registration.ts`, `tests/mcp/prompt-args-compat.test.ts`, `tests/integration/mcp-capability-workflow.test.ts`                                       |
| Completion                                      | ✅ Verified | `src/mcp/completions.ts`, `tests/integration/tool-mode-registration.test.ts`, `tests/integration/prompt-completion.test.ts`                                                      |
| Logging                                         | ✅ Verified | `src/server-runtime/control-plane-registration.ts`, `src/server-runtime/logging-bridge.ts`, `tests/compliance/logging-notifications.test.ts`                                     |
| HTTP/STDIO transport and auth security          | ✅ Verified | `src/http-server/routes-transport.ts`, `src/http-server/middleware.ts`, `tests/contracts/mcp-http-transport-auth-security.test.ts`, `tests/integration/http-transport.test.ts`   |
| Pagination                                      | ⚠️ Partial  | Cursor/task pagination is verified in specific surfaces; not every list surface has dedicated cursor handling.                                                                   |
| Resource subscriptions and update notifications | ✅ Verified | Runtime discovery advertises `subscriptions: true`; session-scoped subscribe/unsubscribe handlers and per-resource update notifications are wired and covered.                   |

## Verified Runtime Surface

| Surface                     | Verified Value   | How Verified                                                              |
| --------------------------- | ---------------- | ------------------------------------------------------------------------- |
| Tools                       | 25               | `TOOL_COUNT`, `TOOL_DEFINITIONS.length`, runtime `listTools()`            |
| Actions                     | 404              | `ACTION_COUNT`, `TOOL_ACTIONS`, metadata consistency tests                |
| Prompts                     | 48               | `getPromptsCatalogCount()`, runtime `listPrompts()`                       |
| Resources                   | 48               | runtime `listResources()` via `createServalSheetsTestHarness()`           |
| Tool icons                  | 25 tools covered | `Object.keys(TOOL_ICONS).length`, `tests/compliance/mcp-features.test.ts` |
| Task-support optional tools | 17               | `TOOL_EXECUTION_CONFIG`                                                   |

## Checklist

### 1. Core MCP Surface

| Requirement                                             | Status | Repo Surface                                                              | Test Evidence                                                                                             | Notes                                            |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `initialize` uses protocol version `2025-11-25`         | ✅     | `src/version.ts`, `src/server.ts`                                         | `tests/compliance/mcp-2025-11-25.test.ts`                                                                 | Server/runtime pinned to 2025-11-25.             |
| Server instructions are emitted during initialization   | ✅     | `src/mcp/features-2025-11-25.ts`                                          | `tests/compliance/mcp-features.test.ts`                                                                   | Counts are runtime-derived.                      |
| Tool list returns current tool catalog with JSON Schema | ✅     | `src/mcp/registration/tools-list-compat.ts`                               | `tests/integration/mcp-tools-list.test.ts`, `tests/contracts/schema-registration.test.ts`                 | Compatibility handler strips Zod artifacts.      |
| Tool results include `content` and `structuredContent`  | ✅     | `src/mcp/registration/tool-handlers.ts`                                   | `tests/compliance/response-format-jsonrpc.test.ts`                                                        | `isError` is set only for retryable/error flows. |
| Prompts are listed and retrievable                      | ✅     | `src/mcp/registration/prompt-registration.ts`                             | `tests/mcp/prompt-args-compat.test.ts`, `tests/integration/mcp-capability-workflow.test.ts`               | 48 prompts at runtime.                           |
| Resources are listed and readable                       | ✅     | `src/mcp/registration/resource-registration.ts`, `src/resources/*.ts`     | `tests/server-runtime/resource-registration.test.ts`, `tests/integration/mcp-capability-workflow.test.ts` | 49 resources at runtime.                         |
| Completion works for resource refs                      | ✅     | `src/mcp/completions.ts`, `src/mcp/registration/resource-registration.ts` | `tests/integration/tool-mode-registration.test.ts`, `tests/mcp/tool-registry-completions.test.ts`         | Tool/action/range completions verified.          |
| Completion works for prompt refs                        | ✅     | `src/mcp/registration/prompt-registration.ts`, `src/schemas/prompts.ts`   | `tests/integration/prompt-completion.test.ts`                                                             | Direct coverage added during this audit.         |

### 2. Tasks, Sampling, and Elicitation

| Requirement                                                    | Status | Repo Surface                                                                 | Test Evidence                                                                                                               | Notes                                                              |
| -------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Task capability is declared and wired                          | ✅     | `src/mcp/features-2025-11-25.ts`, `src/server.ts`                            | `tests/integration/task-endpoints.test.ts`                                                                                  | Task lifecycle fully covered.                                      |
| `tasks/get`, `tasks/list`, `tasks/result`, `tasks/cancel` work | ✅     | `src/core/task-store.ts`, `src/server-runtime/control-plane-registration.ts` | `tests/integration/task-endpoints.test.ts`, `tests/mcp/tool-task-cancellation.test.ts`                                      | Cursor pagination verified for `tasks/list`.                       |
| Task cancellation propagates abort signals                     | ✅     | `src/server.ts`, `src/server-runtime/control-plane-registration.ts`          | `tests/mcp/tool-task-cancellation.test.ts`, `tests/mcp/task-watchdog-config.test.ts`                                        | Watchdog timeout also covered.                                     |
| Sampling is treated as a client capability                     | ✅     | `src/mcp/sampling.ts`, `src/handlers/analyze.ts`                             | `tests/integration/http-transport.test.ts`, `tests/unit/llm-fallback-consent.test.ts`                                       | Server initiates sampling requests when client advertises support. |
| Elicitation is treated as a client capability                  | ✅     | `src/mcp/elicitation.ts`, `src/handlers/confirm.ts`                          | `tests/integration/http-transport.test.ts`, `tests/mcp/elicitation-schema-compat.test.ts`, `tests/handlers/confirm.test.ts` | Form and URL flows covered.                                        |

### 3. Logging and Notifications

| Requirement                                                                 | Status | Repo Surface                                                                                                        | Test Evidence                                                                                                                                           | Notes                                                                                                                          |
| --------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `logging/setLevel` is registered                                            | ✅     | `src/server-runtime/control-plane-registration.ts`, `src/handlers/logging.ts`                                       | `tests/compliance/logging-notifications.test.ts`, `tests/handlers/logging.test.ts`                                                                      | Works across in-memory and HTTP flows.                                                                                         |
| `notifications/message` forwarding works                                    | ✅     | `src/server-runtime/logging-bridge.ts`                                                                              | `tests/compliance/logging-notifications.test.ts`                                                                                                        | Redaction and rate limiting included.                                                                                          |
| `notifications/tools/list_changed` works for staged/runtime tool changes    | ✅     | `src/resources/notifications.ts`, `src/mcp/registration/tool-stage-manager.ts`                                      | `tests/features/realtime-notifications.test.ts`                                                                                                         | Driven by actual tool-set change, not unconditional noise.                                                                     |
| `notifications/resources/list_changed` works                                | ✅     | `src/resources/notifications.ts`                                                                                    | `tests/features/realtime-notifications.test.ts`                                                                                                         | Debounced.                                                                                                                     |
| `notifications/resources/updated` and `resources/subscribe` are fully wired | ✅     | `src/server/well-known.ts`, `src/resources/notifications.ts`, `src/mcp/registration/tool-execution-side-effects.ts` | `tests/features/realtime-notifications.test.ts`, `tests/contracts/mcp-http-transport-auth-security.test.ts`, `tests/integration/http-transport.test.ts` | Session-scoped subscribe/unsubscribe handlers, exact resource updates, and spreadsheet-scoped subtree updates are implemented. |

### 4. Transport and Discovery

| Requirement                                                       | Status | Repo Surface                                                           | Test Evidence                                                                                          | Notes                                                   |
| ----------------------------------------------------------------- | ------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| STDIO transport works                                             | ✅     | `src/server.ts`                                                        | `tests/contracts/mcp-protocol.test.ts`, runtime smoke paths                                            | Default CLI transport.                                  |
| Streamable HTTP works                                             | ✅     | `src/http-server/routes-transport.ts`                                  | `tests/integration/http-transport.test.ts`, `tests/contracts/mcp-http-transport-auth-security.test.ts` | Main HTTP transport.                                    |
| Legacy SSE is explicitly deprecated/optional                      | ✅     | `src/http-server/routes-transport.ts`                                  | `tests/contracts/mcp-http-transport-auth-security.test.ts`                                             | Not treated as primary transport.                       |
| `MCP-Protocol-Version` header handling is enforced for HTTP flows | ✅     | `src/http-server/middleware.ts`, `src/http-server/routes-transport.ts` | `tests/contracts/mcp-http-transport-auth-security.test.ts`                                             | Initialize leniency and follow-on strictness covered.   |
| Session binding and hijack protection exist                       | ✅     | `src/http-server/transport-helpers.ts`                                 | `tests/contracts/mcp-http-transport-auth-security.test.ts`                                             | Security context comparison enforced.                   |
| OAuth AS metadata and protected resource metadata exist           | ✅     | `src/server/well-known.ts`                                             | `tests/server/well-known.test.ts`, `tests/contracts/mcp-http-transport-auth-security.test.ts`          | RFC 8414 and RFC 9728 style endpoints present.          |
| Server card and discovery metadata are runtime-derived            | ✅     | `src/server/well-known.ts`                                             | `tests/mcp-server-card.test.ts`                                                                        | Counts now sourced from code, not hand-maintained docs. |

### 5. Protocol-Adjacent Safety Controls

| Requirement                                        | Status | Repo Surface                                   | Test Evidence                                                                         | Notes                                            |
| -------------------------------------------------- | ------ | ---------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Idempotency wrapping protects non-idempotent calls | ✅     | `src/middleware/idempotency-middleware.ts`     | `tests/middleware/idempotency-middleware.test.ts`                                     | Request-context aware.                           |
| Mutation safety blocks dangerous formulas          | ✅     | `src/middleware/mutation-safety-middleware.ts` | `tests/middleware/mutation-safety-middleware.test.ts`                                 | Centralized payload scanner.                     |
| Tenant isolation exists                            | ✅     | `src/middleware/tenant-isolation.ts`           | `tests/middleware/tenant-isolation-middleware.test.ts`                                | HTTP boundary isolation.                         |
| Write-lock protection exists                       | ✅     | `src/middleware/write-lock-middleware.ts`      | `tests/middleware/write-lock-middleware.test.ts`                                      | Concurrency guard.                               |
| Audit middleware exists and is non-blocking        | ✅     | `src/middleware/audit-middleware.ts`           | `tests/compliance/audit-logging.test.ts`, `tests/middleware/audit-middleware.test.ts` | Tool calls remain resilient if audit sink fails. |
| Response redaction exists                          | ✅     | `src/middleware/redaction.ts`                  | `tests/unit/redact.test.ts`                                                           | Protects logs and HTTP error responses.          |

## Open Follow-Ups

These items remain open after the checklist refresh and are tracked in `docs/remediation/issue-tracker.csv`.

| Severity | Follow-up                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Medium   | Align ancillary docs and simulator documentation outside this checklist with the runtime resource-subscription surface and current tool counts.                            |
| Medium   | Decide whether release/discovery materials should keep advertising 2025-11-25 as a pinned target revision or prepare an upgrade path to the latest published MCP revision. |

## Verification Commands

```bash
# Primary audit suites
npx vitest run \
  tests/compliance/mcp-features.test.ts \
  tests/compliance/mcp-2025-11-25.test.ts \
  tests/compliance/logging-notifications.test.ts \
  tests/contracts/mcp-protocol.test.ts \
  tests/contracts/mcp-http-transport-auth-security.test.ts \
  tests/integration/tool-mode-registration.test.ts \
  tests/integration/mcp-capability-workflow.test.ts \
  tests/integration/task-endpoints.test.ts \
  tests/integration/prompt-completion.test.ts \
  tests/mcp/prompt-args-compat.test.ts \
  tests/mcp/tool-registry-completions.test.ts \
  tests/mcp-server-card.test.ts \
  tests/middleware/idempotency-middleware.test.ts \
  tests/middleware/mutation-safety-middleware.test.ts \
  tests/middleware/tenant-isolation-middleware.test.ts \
  tests/middleware/write-lock-middleware.test.ts \
  tests/contracts/mcp-audit-docs.test.ts
```
