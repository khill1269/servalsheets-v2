---
name: review
description: Run a comprehensive multi-perspective code review on staged or recent changes. Covers TypeScript types, MCP compliance, Google API best practices, security, and test coverage.
disable-model-invocation: true
---

Use the `code-review-orchestrator` agent to review the current changes.

The reviewer will check in a single pass:
1. TypeScript strict mode compliance
2. MCP 2025-11-25 protocol compliance (response format, error codes, tool registration)
3. Google API best practices (field masks, retry, circuit breaker, batching)
4. Security (OAuth handling, input validation, no credential exposure)
5. Test coverage (are new code paths covered?)
6. ServalSheets patterns (BaseHandler vs standalone, response format, safety rails)

Output: pass/fail per category with specific file:line references for any issues.
