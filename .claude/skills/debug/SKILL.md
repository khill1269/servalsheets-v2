---
name: debug
description: Trace a ServalSheets failure through the 4-layer pipeline to find the exact origin. Use when tests fail unexpectedly, behavior doesn't match schema, or a specific error needs root cause analysis.
disable-model-invocation: true
argument-hint: "[error message or failing test name]"
---

Use the `debug-tracer` agent to trace this failure: $ARGUMENTS

The tracer will:
1. Identify which layer the failure is in (MCP/validation → handler → service → Google API)
2. Trace the exact execution path from entrypoint to failure
3. Compare against similar working code
4. Propose a minimal fix with the exact file:line to change

If no error is provided, ask the user to paste the error message or failing test output.

The 4-layer pipeline: MCP Request → `tool-handlers.ts` → `handlers/*.ts` → `google-api.ts`
