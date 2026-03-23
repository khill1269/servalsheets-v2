# Code Review Orchestrator Memory

## Confirmed Patterns

### Handler Inheritance Split (confirmed 2026-02-17)

- 12 of 22 handlers extend BaseHandler: advanced, appsscript, bigquery, collaborate, composite, core, data, dimensions, fix, format, templates, visualize
- 10 handlers do NOT extend BaseHandler: analyze, auth, confirm, dependencies, federation, history, quality, session, transaction, webhooks
- This is intentional for handlers that don't require Google API calls (auth, transaction, history), but creates inconsistency
- Non-BaseHandler handlers each re-implement: applyVerbosityFilter, error handling, requireAuth patterns

### v1-compat Inversion Bug (confirmed 2026-02-17)

- File: `src/versioning/v1-compat.ts:15-17`
- `ACTION_MAPPINGS_V2_TO_V1` is built by inverting V1_TO_V2, but the map has many-to-one (hide_sheet, show_sheet, rename_sheet all map to update_sheet)
- Result: only ONE of those v1 actions survives in the inverse map (last-write wins = rename_sheet → update_sheet)
- `getV1ActionName('update_sheet')` returns `'rename_sheet'` instead of being meaningfully ambiguous

### Retry Logic / 401 Bug (confirmed 2026-02-17)

- File: `src/utils/retry.ts:216`
- RETRYABLE_STATUS includes 401, and isRetryableError returns true for messages containing 'unauthorized'
- Test `should NOT retry on 401 unauthorized` times out because the 401+unauthorized error IS retried
- Test file: `tests/utils/retry.test.ts:191`

### process.env Direct Access in Source (confirmed 2026-02-17)

- `src/handlers/auth.ts:225-226` — OAUTH_USE_CALLBACK_SERVER, OAUTH_AUTO_OPEN_BROWSER not in env.ts
- `src/handlers/helpers/validation-helpers.ts:19` — ENABLE_AGGRESSIVE_FIELD_MASKS read directly (but IS in env.ts)
- `src/utils/retry.ts:25-31` — GOOGLE_API_TIMEOUT_MS, GOOGLE_API_MAX_RETRIES etc. read directly (not in env.ts)

### ESLint Warnings (confirmed 2026-02-17)

- 61 total warnings (0 errors)
- ~58 warnings in `src/cli/replay.ts` (console.log acceptable for CLI tool)
- 1 warning in `src/graphql/server.ts:18` (missing return type)
- 1 warning in `src/middleware/schema-version.ts:40` (unnecessary eslint-disable)
- The CLI console.log warnings are explicitly allowed per eslint.config.js:141-145

### Silent Fallback Check Findings

- Most `return undefined` hits are in service/utility files (not handlers) and are legitimate
- Real problematic ones: `src/utils/action-intelligence.ts:85` returns `{}` without logging

### Test Failures (4 failing in test:fast)

- `tests/utils/retry.test.ts` — 401 unauthorized retry logic bug (times out)
- `tests/utils/enhanced-errors-resources.test.ts` — RATE_LIMIT error missing resources field

### Data Schema vs Handler Alignment

- data schema has 19 actions (check:drift says 19), handler switch has 19 cases + undocumented aliases in default branch
- detect_spill_ranges IS in both schema and handler (confirmed)
- Aliases in default branch (set_note, add_hyperlink, merge, unmerge) not in schema - acceptable per handler-deviations pattern

### DI Container Usage

- Container class is implemented but handlers are NOT wired through it
- Handlers are instantiated directly in tool-handlers.ts via createHandlers()
- The container exists as infrastructure but has no registrations in production code
