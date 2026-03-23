# ServalSheets — Full Codebase Audit Report

> **Generated:** 2026-03-22 | **Scope:** Complete file mapping, architecture trace, AI-readability analysis, restructuring proposals
> **Project:** ServalSheets MCP Server | **Version:** 1.7.0 | **Protocol:** MCP 2025-11-25
> **Scale:** 25 tools, 407 actions, 810 source files, 409,181 lines of TypeScript

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Project Statistics](#2-project-statistics)
3. [Complete Directory Map](#3-complete-directory-map)
4. [File Type Inventory](#4-file-type-inventory)
5. [Architecture Trace](#5-architecture-trace)
6. [Largest Files Inventory](#6-largest-files-inventory)
7. [AI-Readability Findings](#7-ai-readability-findings)
8. [Best Practices Comparison](#8-best-practices-comparison)
9. [Restructuring Proposals](#9-restructuring-proposals)
10. [Prioritized Action Plan](#10-prioritized-action-plan)

---

## 1. Executive Summary

ServalSheets is a production-grade MCP server for Google Sheets with 25 registered tools dispatching 404 discrete actions. The codebase spans 810 TypeScript source files (409K LoC), 525 test files (196K LoC), 125+ scripts, and 250+ documentation pages. It implements the full MCP 2025-11-25 specification including Sampling, Elicitation, Tasks, Completions, and Streamable HTTP.

**Overall Assessment: B+ (Strong foundation, structural debt in file sizes and directory organization)**

**Strengths:**
- Discriminated union schema pattern (excellent for type safety + AI parsing)
- Comprehensive test infrastructure (2,742 tests across 13 test categories)
- Strong safety rails (snapshot + confirmation + circuit breaker on all mutations)
- Well-documented architecture with living session notes spanning 100 sessions
- Registry/manifest patterns for tool discovery

**Critical Issues:**
- 18 "god files" exceeding 1,500 lines (5 exceed 2,000 lines)
- 32 subdirectories under src/ (excessive surface area)
- 4 overlapping server-related directories
- 64 imports in server.ts (orchestration bottleneck)
- 86 files at project root (config sprawl)
- Generated and hand-written schemas mixed in same directory

---

## 2. Project Statistics

### Code Volume

| Metric | Value |
|--------|-------|
| Total files (excl. node_modules/.git/dist) | 10,351 |
| TypeScript source files (src/) | 810 |
| TypeScript test files (tests/) | 525 |
| Source lines of code | 409,181 |
| Test lines of code | 195,942 |
| Code-to-test ratio | 2.1:1 |
| Scripts | 125+ |
| Documentation pages | 250+ |
| CI/CD workflows | 37 |

### Directory Sizes

| Directory | Size | Files |
|-----------|------|-------|
| src/ | 83 MB | 810 |
| tests/ | 16 MB | 525 |
| docs/ | 30 MB | 250+ |
| scripts/ | 1.7 MB | 125+ |
| .github/ | — | 37 workflows |

### File Type Breakdown (Top 15)

| Extension | Count | Description |
|-----------|-------|-------------|
| .ts | 5,600 | TypeScript source + tests + scripts |
| .md | 1,415 | Documentation (Markdown) |
| .html | 1,083 | Reports, dashboards, UI |
| .json | 754 | Configuration, manifests, fixtures |
| .yml/.yaml | 306 | CI/CD workflows, config |
| .sh | 276 | Shell scripts |
| .log | 212 | Build/test logs |
| .mjs | 137 | ES module scripts |
| .css | 54 | Stylesheets (UI dashboard) |
| .tsx | 40 | React components (tracing UI) |
| .js | 49 | JavaScript (legacy/config) |
| .py | 20 | Python scripts (workers) |
| .svg | 16 | Icons, diagrams |
| .docx | 16 | Word documents |
| .sql | 5 | Database schemas |

---

## 3. Complete Directory Map

### Root Level

```
servalsheets/
├── src/                          # 810 files, 409K LoC — Main source code
├── tests/                        # 525 files, 196K LoC — Test suites (13 categories)
├── scripts/                      # 125+ files — Build, validation, analysis scripts
├── docs/                         # 250+ files — VitePress documentation site
├── packages/
│   └── serval-core/              # Monorepo: backend abstraction layer
├── tools/                        # 5 companion MCP servers
│   ├── gcloud-console-server/    # Google Cloud integration
│   ├── test-intelligence-server/ # Test intelligence service
│   ├── intelligence-server/      # Main intelligence service
│   └── sampling-server/          # AI sampling service
├── .claude/                      # Claude agent config + memory
├── .serval/                      # Runtime state + session notes
├── .github/                      # CI/CD (37 workflows) + templates
├── dist/                         # Compiled output (65 subdirs)
├── coverage/                     # Test coverage reports
├── node_modules/                 # Dependencies (819 packages)
└── [86 root-level config/doc files]
```

### src/ — Complete Subdirectory Map (32 directories)

```
src/
├── adapters/                 # 5 files — Backend abstraction (Google, Excel, Notion, Airtable)
│   ├── google-sheets-backend.ts    (509 lines) — ACTIVE: Wired in server.ts
│   ├── excel-online-backend.ts     (607 lines) — Scaffold (P3)
│   ├── notion-backend.ts           (924 lines) — Scaffold (P3)
│   ├── airtable-backend.ts         (924 lines) — Scaffold (P3)
│   └── index.ts
│
├── admin/                    # Admin routes and configuration management
│
├── analysis/                 # 20 files — Spreadsheet analysis engine
│   ├── comprehensive.ts            (2,079 lines) — Full 43-category analysis
│   ├── formula-helpers.ts          (1,361 lines) — Formula parsing + validation
│   ├── suggestion-engine.ts        (1,103 lines) — Smart suggestion generation
│   ├── confidence-scorer.ts        (966 lines) — Analysis quality scoring
│   ├── flow-orchestrator.ts        (959 lines) — Multi-step analysis pipelines
│   ├── action-generator.ts         (705 lines) — Findings → executable params
│   ├── planner.ts                  (683 lines) — Analysis execution planning
│   ├── scout.ts                    — Quick preliminary scan
│   ├── router.ts                   — Fast vs. AI path routing
│   ├── structure-helpers.ts        — Sheet structure analysis
│   ├── tiered-retrieval.ts         — 4-level smart data loading
│   ├── formula-parser.ts           — Google Sheets formula AST
│   ├── dependency-graph.ts         — Formula dependency graph
│   ├── impact-analyzer.ts          — Recalculation impact analysis
│   ├── understanding-store.ts      — Analysis result caching
│   ├── streaming.ts                — Streaming export support
│   ├── conversational-helpers.ts   — NL query support
│   └── prompts/                    — AI prompt templates
│       └── sheet-generation.ts
│
├── auth/                     # SAML 2.0 provider
│   └── saml-provider.ts           — SSO/SAML service provider
│
├── cli/                      # CLI interface utilities
│   └── auth-setup.ts              — Interactive auth flow
│
├── config/                   # 10 files — Configuration management
│   ├── env.ts                      (1,081 lines) — Centralized env validation (Zod)
│   ├── constants.ts                — Application constants
│   ├── oauth-scopes.ts             — OAuth scope definitions
│   ├── google-limits.ts            — API rate limit constants
│   ├── field-masks.ts              — Aggressive field mask configs
│   ├── embedded-oauth.ts           — Embedded OAuth credentials
│   └── federation-config.ts        — Federation server config
│
├── connectors/               # 10 files — External data source connectors
│   ├── connector-manager.ts        (1,285 lines) — Connector registry + lifecycle
│   ├── finnhub-connector.ts        — Stock market data
│   ├── fred-connector.ts           — Federal Reserve economic data
│   ├── alpha-vantage-connector.ts  — Financial market data
│   ├── polygon-connector.ts        — Market data API
│   ├── fmp-connector.ts            — Financial modeling prep
│   ├── rest-generic.ts             — Generic REST connector
│   ├── mcp-bridge.ts               — MCP protocol bridge
│   ├── types.ts                    — Connector type definitions
│   └── index.ts
│
├── constants/                # Server constants + protocol definitions
│   └── protocol.ts                — MCP protocol version
│
├── core/                     # 12 files — Core infrastructure
│   ├── batch-compiler.ts           (1,152 lines) — Intent → batchUpdate compilation
│   ├── request-builder.ts          (1,667 lines) — Google API request construction
│   ├── diff-engine.ts              (938 lines) — 3-tier diffing (metadata/sample/full)
│   ├── task-store.ts               (915 lines) — Task persistence (memory + Redis)
│   ├── range-resolver.ts           — A1 notation parsing + normalization
│   ├── rate-limiter.ts             — Request rate limiting
│   ├── policy-enforcer.ts          — Access policy enforcement
│   ├── errors.ts                   — Core error types
│   └── intent/                     — Intent system types
│
├── di/                       # Dependency injection container
│   └── container.ts
│
├── generated/                # Auto-generated files
│   └── manifest.json               — Server manifest (regenerated by schema:commit)
│
├── graphql/                  # GraphQL API layer
│   └── resolvers.ts
│
├── handlers/                 # 25 tool handlers + 40+ action submodules
│   │
│   │  ── BaseHandler Subclasses (13 tools) ──
│   ├── base.ts                     (1,639 lines) — Abstract base with 20+ shared methods
│   ├── core.ts                     (775 lines)   — sheets_core: CRUD operations
│   ├── data.ts                     (366 lines)   — sheets_data: Cell read/write
│   ├── format.ts                   (894 lines)   — sheets_format: Styling via BatchCompiler
│   ├── dimensions.ts               (2,146 lines) — sheets_dimensions: Rows/columns
│   ├── advanced.ts                 (393 lines)   — sheets_advanced: Named ranges, protection
│   ├── visualize.ts                (335 lines)   — sheets_visualize: Charts + Sampling
│   ├── collaborate.ts              (652 lines)   — sheets_collaborate: Sharing via Drive API
│   ├── composite.ts                (995 lines)   — sheets_composite: Import/export/dedup
│   ├── analyze.ts                  (1,196 lines) — sheets_analyze: AI analysis + scout
│   ├── fix.ts                      (1,252 lines) — sheets_fix: Data cleaning
│   ├── templates.ts                (803 lines)   — sheets_templates: Reusable templates
│   ├── bigquery.ts                 (1,937 lines) — sheets_bigquery: BigQuery integration
│   ├── appsscript.ts              (1,664 lines) — sheets_appsscript: Automation
│   │
│   │  ── Standalone Handlers (12 tools) ──
│   ├── auth.ts                     (1,604 lines) — sheets_auth: OAuth + SAML
│   ├── confirm.ts                  (475 lines)   — sheets_confirm: Elicitation
│   ├── dependencies.ts             (1,161 lines) — sheets_dependencies: Impact analysis
│   ├── quality.ts                  (666 lines)   — sheets_quality: Validation
│   ├── history.ts                  (796 lines)   — sheets_history: Operations + undo
│   ├── session.ts                  (935 lines)   — sheets_session: Context continuity
│   ├── transaction.ts              (401 lines)   — sheets_transaction: ACID operations
│   ├── federation.ts               (409 lines)   — sheets_federation: Remote MCP
│   ├── webhooks.ts                 (670 lines)   — sheets_webhook: Event notifications
│   ├── agent.ts                    (375 lines)   — sheets_agent: Plan/execute/rollback
│   ├── compute.ts                  (1,765 lines) — sheets_compute: Stats + regression
│   ├── connectors.ts               (871 lines)   — sheets_connectors: External APIs
│   │
│   │  ── Action Submodules ──
│   ├── analyze-actions/            (17 files) — Scout, comprehensive, NL query, semantic search
│   ├── data-actions/               (11 files) — Read, write, batch, auto-fill, cross-sheet
│   ├── composite-actions/          (6 files)  — Generate, import, export, pipeline
│   ├── collaborate-actions/        (5 files)  — Share, comment, protect, version
│   ├── core-actions/               (6 files)  — Create, duplicate, list, metadata
│   ├── dimensions-actions/         (4 files)  — Insert, resize, freeze, sort
│   ├── format-actions/             (6 files)  — Conditional, number, merge, theme
│   ├── visualize-actions/          (3 files)  — Charts, sparklines, EmbeddedObject
│   ├── advanced-actions/           (7 files)  — Named ranges, banding, slicers
│   └── helpers/                    (6 files)  — Error mapping, verbosity, shared utils
│
├── http-server/              # 7 files — HTTP/SSE transport layer
│   ├── routes-transport.ts         (779 lines) — HTTP transport routes
│   ├── routes-observability.ts     (764 lines) — Health + metrics endpoints
│   ├── middleware.ts               — HTTP middleware stack
│   ├── graphql-admin.ts            — GraphQL admin routes
│   ├── routes-webhooks.ts          — Webhook endpoints
│   ├── client-ip.ts                — IP extraction
│   └── transport-helpers.ts
│
├── knowledge/                # Knowledge base modules
│   ├── formulas/                   — Formula reference library
│   ├── api/                        — API limits + quotas documentation
│   ├── masterclass/                — User guides
│   └── limits/                     — Rate limiting documentation
│
├── mcp/                      # 25+ files — MCP protocol implementation
│   ├── sampling.ts                 (1,838 lines) — SEP-1577: AI analysis integration
│   ├── elicitation.ts              (1,273 lines) — SEP-1036: Interactive forms + wizards
│   ├── completions.ts              (1,387 lines) — Tool discovery + autocompletion
│   ├── features-2025-11-25.ts      (1,046 lines) — Server instructions + tool icons
│   ├── response-builder.ts         (827 lines)   — MCP response envelope construction
│   ├── event-store.ts              — Streamable HTTP event store
│   ├── tool-availability.ts        — Conditional tool registration
│   ├── registration/               # Tool + resource + prompt registration
│   │   ├── tool-handlers.ts        (1,912 lines) — Request pipeline: normalize → validate → dispatch
│   │   ├── prompt-registration.ts  (5,180 lines) — 48 guided workflow prompts
│   │   ├── tool-discovery-hints.ts (2,219 lines) — LLM action discovery hints
│   │   ├── resource-registration.ts — MCP resource templates
│   │   ├── schema-helpers.ts       — Schema wrapping utilities
│   │   ├── tool-definitions.ts     — 25 tool discriminated unions
│   │   ├── tool-registration.ts    — Auto-registration with MCP server
│   │   ├── tool-arg-normalization.ts — Envelope wrapping for legacy
│   │   ├── tool-call-preflight.ts  — Pre-execution validation
│   │   ├── tool-call-execution.ts  — Error handling + side effects
│   │   ├── tool-response.ts        — Response envelope
│   │   ├── response-intelligence.ts — _meta.aiMode injection
│   │   ├── response-hints-engine.ts — CoT hints layer
│   │   └── tool-output-sanitization.ts — Secret redaction
│   └── [additional protocol files]
│
├── middleware/               # 10 files — Request middleware pipeline
│   ├── audit-middleware.ts         — Operation logging + MUTATION_ACTIONS tracking
│   ├── mutation-safety-middleware.ts — Write-lock verification
│   ├── rbac-middleware.ts          — Role-based access control
│   ├── rate-limit-middleware.ts    — Sliding window rate limiting
│   ├── idempotency-middleware.ts   — Request deduplication
│   ├── write-lock-middleware.ts    — Exclusive write access per sheet
│   ├── tenant-isolation.ts         — Multi-tenant context separation
│   ├── redaction.ts                — Secret redaction in logs
│   └── schema-version.ts          — Protocol version negotiation
│
├── observability/            # Metrics + tracing
│   ├── metrics.ts                  (980 lines) — Prometheus metrics exporter
│   └── tracing.ts                  — OpenTelemetry integration
│
├── resources/                # 38+ files — MCP resource implementations
│   ├── patterns.ts                 (1,181 lines) — Spreadsheet patterns library
│   ├── examples.ts                 (1,013 lines) — Usage examples
│   ├── knowledge-search.ts         (670 lines) — Knowledge base search
│   └── [35+ resource modules by category]
│
├── schemas/                  # 38 files — Zod validation schemas (407 actions)
│   │  ── Generated (by npm run schema:commit) ──
│   ├── annotations.ts              (10,591 lines) — ⚠️ AUTO-GENERATED: Action annotations
│   ├── action-metadata.ts          (2,901 lines) — ⚠️ AUTO-GENERATED: Action docs
│   ├── action-counts.ts            (46 lines)    — ⚠️ AUTO-GENERATED: TOOL_COUNT/ACTION_COUNT
│   ├── descriptions.ts             (1,178 lines) — ⚠️ AUTO-GENERATED: Tool descriptions
│   ├── descriptions-minimal.ts     — ⚠️ AUTO-GENERATED: Compact descriptions
│   │
│   │  ── Hand-Written (one per tool + shared) ──
│   ├── shared.ts                   (1,813 lines) — Common types: Safety, Error, Range, etc.
│   ├── analyze.ts                  (2,379 lines) — sheets_analyze: 23 actions
│   ├── composite.ts                (1,697 lines) — sheets_composite: 21 actions
│   ├── data.ts                     (1,265 lines) — sheets_data: 25 actions
│   ├── format.ts                   (1,265 lines) — sheets_format: 25 actions
│   ├── collaborate.ts              (1,076 lines) — sheets_collaborate: 41 actions
│   ├── dimensions.ts               (1,030 lines) — sheets_dimensions: 30 actions
│   ├── session.ts                  — sheets_session: 31 actions
│   ├── advanced.ts                 — sheets_advanced: 31 actions
│   ├── compute.ts                  — sheets_compute: 16 actions
│   ├── core.ts                     — sheets_core: 21 actions
│   ├── appsscript.ts              — sheets_appsscript: 19 actions
│   ├── bigquery.ts                 — sheets_bigquery: 17 actions
│   ├── visualize.ts                — sheets_visualize: 18 actions
│   ├── history.ts                  — sheets_history: 10 actions
│   ├── dependencies.ts             — sheets_dependencies: 10 actions
│   ├── connectors.ts               — sheets_connectors: 10 actions
│   ├── webhook.ts                  — sheets_webhook: 10 actions
│   ├── agent.ts                    — sheets_agent: 8 actions
│   ├── templates.ts                — sheets_templates: 8 actions
│   ├── fix.ts                      — sheets_fix: 6 actions
│   ├── transaction.ts              — sheets_transaction: 6 actions
│   ├── auth.ts                     — sheets_auth: 5 actions
│   ├── confirm.ts                  — sheets_confirm: 5 actions
│   ├── quality.ts                  — sheets_quality: 4 actions
│   ├── federation.ts               — sheets_federation: 4 actions
│   ├── rbac.ts                     — Role-based access types
│   ├── handler-deviations.ts       — Schema-handler misalignment exemptions
│   ├── prompts.ts                  — Guided workflow types
│   └── index.ts                    — Re-exports + TOOL_COUNT/ACTION_COUNT
│
├── security/                 # 5 files — Security infrastructure
│   ├── incremental-scope.ts        (2,051 lines) — OAuth scope management
│   ├── tool-hash-registry.ts       — Tool integrity checks
│   ├── webhook-signature.ts        — Webhook HMAC verification
│   └── resource-indicators.ts      — Resource access indicators
│
├── server/                   # Server health + well-known endpoints
├── server-runtime/           # Server runtime utilities
├── server-utils/             # Server utility functions
│
├── services/                 # 111 files — Business logic services
│   │  ── Core Google API Services ──
│   ├── google-api.ts               (1,966 lines) — Retry + circuit breaker + HTTP/2
│   ├── cached-sheets-api.ts        — ETag-based caching (80-100x reduction)
│   ├── batching-system.ts          (1,041 lines) — Intent → batchUpdate compilation
│   ├── parallel-executor.ts        — Concurrent range fetching (40% faster)
│   ├── request-merger.ts           — Overlapping range deduplication
│   │
│   │  ── Domain Services ──
│   ├── transaction-manager.ts      (2,139 lines) — ACID transactions + WAL
│   ├── session-context.ts          (1,676 lines) — Active spreadsheet + preferences
│   ├── cleaning-engine.ts          — 10 cleaning rules + 16 format converters
│   ├── conflict-detector.ts        — Concurrent modification detection
│   ├── impact-analyzer.ts          — Dependency-aware impact prediction
│   ├── validation-engine.ts        — Type validators (email, phone, URL)
│   ├── formula-evaluator.ts        — HyperFormula v3.2.0 integration
│   ├── semantic-search.ts          — Voyage AI vector search
│   ├── understanding-store.ts      — Analysis result caching
│   ├── sheet-generator.ts          — AI-powered sheet creation
│   ├── federated-mcp-client.ts     — Remote MCP server calls
│   ├── webhook-manager.ts          — Event notifications (Redis-backed)
│   ├── cache-invalidation-graph.ts — Mutation cascade tracking
│   ├── history-service.ts          — Operation tracking + undo
│   ├── snapshot-service.ts         — Backup/restore for undo
│   ├── cross-spreadsheet.ts        — Cross-sheet read/query/write/compare
│   ├── compute-engine.ts           — Stats, regression, forecasting
│   ├── audit-logger.ts             — Operation audit trail
│   │
│   │  ── Agent Subsystem ──
│   ├── agent/
│   │   ├── plan-executor.ts        (995 lines) — Plan execution engine
│   │   ├── plan-compiler.ts        — Plan compilation from templates/AI
│   │   ├── plan-store.ts           — In-memory plan persistence
│   │   ├── templates.ts            — Workflow templates
│   │   ├── sampling.ts             — MCP Sampling utilities
│   │   ├── checkpoints.ts          — Plan checkpoints + rollback
│   │   └── types.ts                — Agent type definitions
│   │
│   │  ── Infrastructure Services ──
│   ├── agent-engine.ts             (75 lines) — Thin re-export facade
│   ├── transaction-wal.ts          — Write-ahead log manager
│   ├── task-manager.ts             — Background job scheduling
│   ├── metrics-exporter.ts         — Prometheus metrics
│   └── [70+ additional service files]
│
├── startup/                  # 5 files — Startup lifecycle
│   ├── lifecycle.ts                (644 lines) — Boot sequence orchestration
│   ├── preflight-validation.ts     — Pre-start validation checks
│   ├── performance-init.ts         — Performance optimization init
│   └── restart-policy.ts           — Auto-restart configuration
│
├── storage/                  # Session + persistence storage
├── types/                    # 8 files — TypeScript type definitions
├── ui/                       # Tracing dashboard (React + Vite)
├── utils/                    # 90+ files — Utility modules
│   ├── error-factory.ts            (1,069 lines) — Typed error constructors
│   ├── enhanced-errors.ts          (921 lines) — Error enrichment
│   ├── cache-manager.ts            (792 lines) — LRU cache coordination
│   ├── response-compactor.ts       (741 lines) — Response size optimization
│   ├── logger.ts                   — Winston structured logging
│   ├── retry.ts                    — Exponential backoff + deadlines
│   ├── circuit-breaker.ts          — Per-API circuit breakers
│   ├── schema-cache.ts             — Cached Zod validation (90% hit)
│   ├── heap-watchdog.ts            — Memory usage monitoring
│   ├── request-context.ts          — Async context for timeouts
│   └── [80+ additional utility files]
│
├── versioning/               # Schema versioning + migration
├── workers/                  # Web worker implementations
│
│  ── Root-Level Source Files ──
├── server.ts                       (1,570 lines) — Main MCP server entry point
├── http-server.ts                  (1,005 lines) — HTTP/SSE transport entry point
├── oauth-provider.ts               (1,266 lines) — OAuth 2.0 provider
└── index.ts                        — Package entry point
```

### tests/ — Complete Structure (66 directories, 525 files)

```
tests/
├── adapters/          — Backend adapter tests (Excel, Google Sheets, Notion, Airtable)
├── admin/             — Admin route tests
├── analysis/          — Analysis engine tests (recommender, auto-fixer, orchestrator)
├── audit/             — Audit infrastructure (coverage, performance, memory leaks)
├── auth/              — Authentication + SAML tests
├── benchmarks/        — Performance benchmarks
├── chaos/             — Chaos testing (fault injection)
├── cli/               — CLI interaction tests
├── compliance/        — Compliance + audit logging tests
├── config/            — Configuration validation tests
├── connectors/        — External connector tests
├── contracts/         — Contract tests (schema guarantees, cross-maps, error codes)
├── core/              — Core infrastructure tests (batch compiler, diff engine)
├── di/                — Dependency injection tests
├── e2e/               — End-to-end workflow tests + MCP client simulator
├── edge-cases/        — Edge case regression tests
├── examples/          — Example usage tests
├── features/          — Feature-specific tests
├── fixtures/          — Test data + fixture factories
├── graphql/           — GraphQL resolver tests
├── handlers/          — Handler-specific tests (all 25 tools)
├── helpers/           — Test helper utilities
├── http-server/       — HTTP transport tests
├── integration/       — Integration tests (transport, staged registration)
├── live-api/          — Live Google API tests (auth, tools, guards, stress)
├── llm-compatibility/ — LLM compatibility tests
├── load/              — Load testing suites
├── manual/            — Manual testing guides
├── mcp/               — MCP protocol compliance tests
├── middleware/         — Middleware pipeline tests
├── mocks/             — Mock factories + data generators
├── observability/     — Observability + metrics tests
├── packages/          — Monorepo package tests (serval-core)
├── property/          — Property-based testing
├── regression/        — Regression prevention tests
├── replay/            — Recording + replay tests
├── resources/         — MCP resource tests
├── safety/            — Safety + security tests
├── schemas/           — Schema validation tests
├── sdks/              — SDK compatibility tests
├── security/          — Security audit tests
├── server/            — Server lifecycle tests
├── server-runtime/    — Runtime behavior tests
├── server-utils/      — Utility tests
├── services/          — Service layer tests
├── simulation/        — Multi-category simulation tests (11 categories)
├── snapshots/         — Snapshot comparison tests
├── startup/           — Startup sequence tests
├── storage/           — Storage layer tests
├── unit/              — Granular unit tests
└── utils/             — Utility function tests
```

### scripts/ — Categories (125+ files)

```
scripts/
├── Analysis & Agents
│   ├── multi-agent-analysis.mjs      — Parallel analysis orchestrator
│   ├── code-quality-agent.mjs        — Code quality scanner
│   ├── consistency-agent.mjs         — Codebase consistency checker
│   ├── security-agent.mjs            — Security vulnerability scanner
│   ├── type-safety-agent.mjs         — Type safety analyzer
│   └── auto-fixer.mjs                — Automated fix application
│
├── Validation & Checks
│   ├── check-metadata-drift.sh       — Metadata sync validation
│   ├── check-action-coverage.mjs     — 404-action coverage verification
│   ├── check-schema-handler-alignment.mjs — Schema ↔ handler parity
│   ├── check-mutation-actions.mjs    — Audit ↔ safety middleware parity
│   ├── check-hardcoded-counts.mjs    — No magic numbers
│   ├── check-silent-fallbacks.mjs    — No silent {} returns
│   ├── check-integration-wiring.mjs  — End-to-end wiring verification
│   └── check-doc-freshness.mjs       — Documentation date validation
│
├── Generation & Build
│   ├── generate-metadata.ts          — Schema → annotations + counts
│   ├── generate-health-snapshot.ts   — Full health report
│   ├── generate-sdks.mjs            — Client SDK generation
│   └── generate-state.mjs            — Live state.md generation
│
├── Testing
│   ├── run-live-tests.mjs            — Live API test runner
│   ├── run-chaos-tests.mjs           — Chaos test orchestrator
│   ├── run-load-tests.mjs            — Load test runner
│   └── [manual test guides]
│
├── Release & Deployment
│   ├── release-audit.mjs             — Pre-release audit
│   ├── verify-release-readiness.sh   — Release gate checks
│   └── [Docker/deployment scripts]
│
└── Reporting
    ├── coverage-badge.mjs             — Coverage badge generation
    ├── audit-gate.sh                  — CI gate (7 checks)
    └── [dashboard generators]
```

### Root-Level Files (86 files)

```
Configuration (28):
  package.json, package-lock.json, turbo.json
  tsconfig.json, tsconfig.build.json, tsconfig.eslint.json, tsconfig.production.json
  vitest.config.ts, vitest.gates.config.ts
  eslint.config.js, .prettierrc.json, .editorconfig
  .cspell.json, .markdownlint.json, .markdownlint-baseline.json
  .dependency-cruiser.cjs, knip.json, .syncpackrc.json
  docker-compose.yml, Dockerfile
  stryker.critical.conf.mjs, stryker.minimal.conf.mjs
  .mcp.json, .mcp.json.example, .actionlint.yaml
  typedoc.json, openapi.json, openapi.yaml

Documentation (14):
  README.md (77KB), CLAUDE.md (11KB), TASKS.md (48KB)
  CHANGELOG.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md
  SECURITY.md, PRIVACY.md, AUDIT_REPORT.md
  AQUI-VR_v3.2_Framework.md, PROJECT_SNAPSHOT.md
  MCP_STARTUP_ANALYSIS.md, ServalSheets_GitHub_Audit.md
  servalsheets-mega-prompt.md

Generated/Build (12):
  server.json, manifest.json, .tsbuildinfo
  servalsheets.mcpb
  CONTRACT_TEST_REPORT.txt
  benchmark_report.xlsx, benchmark_dashboard.html
  AI_Spreadsheet_Comparison_2026.xlsx
  ServalSheets_vs_Competitors_Functionality_2026.xlsx
  [additional HTML reports]

Examples (6):
  .env, .env.example, .env.production.example
  credentials.json.example
  claude-desktop-config.json, claude_desktop_config.example.json

Git/CI (3):
  .gitignore, .gitattributes, .editorconfig
```

---

## 4. File Type Inventory

### TypeScript Source Files by Directory

| Directory | Files | Lines | Avg Lines/File | Largest File |
|-----------|-------|-------|----------------|-------------|
| schemas/ | 38 | ~28,000 | 737 | annotations.ts (10,591) |
| handlers/ | 43 | ~26,000 | 605 | dimensions.ts (2,146) |
| services/ | 111 | ~45,000 | 405 | transaction-manager.ts (2,139) |
| mcp/ | 25+ | ~20,000 | 800 | tool-handlers.ts (1,912) |
| analysis/ | 20 | ~15,000 | 750 | comprehensive.ts (2,079) |
| utils/ | 90+ | ~18,000 | 200 | error-factory.ts (1,069) |
| core/ | 12 | ~9,000 | 750 | request-builder.ts (1,667) |
| resources/ | 38+ | ~8,000 | 211 | patterns.ts (1,181) |
| connectors/ | 10 | ~4,000 | 400 | connector-manager.ts (1,285) |
| config/ | 10 | ~3,000 | 300 | env.ts (1,081) |
| middleware/ | 10 | ~4,000 | 400 | — |
| security/ | 5 | ~4,000 | 800 | incremental-scope.ts (2,051) |
| http-server/ | 7 | ~3,500 | 500 | routes-transport.ts (779) |

### Tool Action Distribution

| Tool | Actions | Schema File | Handler File |
|------|---------|-------------|-------------|
| sheets_collaborate | 41 | collaborate.ts (1,076 L) | collaborate.ts (652 L) |
| sheets_session | 31 | session.ts | session.ts (935 L) |
| sheets_advanced | 31 | advanced.ts | advanced.ts (393 L) |
| sheets_dimensions | 30 | dimensions.ts (1,030 L) | dimensions.ts (2,146 L) |
| sheets_data | 25 | data.ts (1,265 L) | data.ts (366 L) |
| sheets_format | 25 | format.ts (1,265 L) | format.ts (894 L) |
| sheets_analyze | 23 | analyze.ts (2,379 L) | analyze.ts (1,196 L) |
| sheets_composite | 21 | composite.ts (1,697 L) | composite.ts (995 L) |
| sheets_core | 21 | core.ts | core.ts (775 L) |
| sheets_appsscript | 19 | appsscript.ts | appsscript.ts (1,664 L) |
| sheets_visualize | 18 | visualize.ts | visualize.ts (335 L) |
| sheets_bigquery | 17 | bigquery.ts | bigquery.ts (1,937 L) |
| sheets_compute | 16 | compute.ts | compute.ts (1,765 L) |
| sheets_dependencies | 10 | dependencies.ts | dependencies.ts (1,161 L) |
| sheets_history | 10 | history.ts | history.ts (796 L) |
| sheets_connectors | 10 | connectors.ts | connectors.ts (871 L) |
| sheets_webhook | 10 | webhook.ts | webhooks.ts (670 L) |
| sheets_agent | 8 | agent.ts | agent.ts (375 L) |
| sheets_templates | 8 | templates.ts | templates.ts (803 L) |
| sheets_fix | 6 | fix.ts | fix.ts (1,252 L) |
| sheets_transaction | 6 | transaction.ts | transaction.ts (401 L) |
| sheets_auth | 5 | auth.ts | auth.ts (1,604 L) |
| sheets_confirm | 5 | confirm.ts | confirm.ts (475 L) |
| sheets_quality | 4 | quality.ts | quality.ts (666 L) |
| sheets_federation | 4 | federation.ts | federation.ts (409 L) |

---

## 5. Architecture Trace

### Request Pipeline (every MCP tool call)

```
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT (Claude Desktop / API)                                    │
└──────────────────┬──────────────────────────────────────────────┘
                   │ MCP tools/call
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ TRANSPORT LAYER                                                  │
│  STDIO: src/server.ts → StdioServerTransport                    │
│  HTTP:  src/http-server.ts → Express + SSEServerTransport        │
│  Streamable HTTP: src/mcp/event-store.ts → InMemoryEventStore    │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ MIDDLEWARE PIPELINE (src/middleware/)                             │
│  1. tenant-isolation.ts    → Multi-tenant context                │
│  2. rate-limit-middleware   → Sliding window throttle             │
│  3. rbac-middleware         → Role-based access check             │
│  4. idempotency-middleware  → Request dedup (Idempotency-Key)     │
│  5. audit-middleware        → Operation logging                   │
│  6. mutation-safety         → Write-lock verification             │
│  7. redaction               → Secret scrubbing in logs            │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ TOOL DISPATCH (src/mcp/registration/tool-handlers.ts)            │
│                                                                  │
│  normalizeToolArgs()  → Wrap in { request: { action, ... } }     │
│  parseWithCache()     → Zod validation (90% cache hit, 5-10ms)   │
│  createToolCallHandler() → Map tool name → handler instance       │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ HANDLER LAYER (src/handlers/)                                    │
│                                                                  │
│  BaseHandler Path (13 tools):                                    │
│    handler.executeAction(validatedInput)                         │
│    → action switch → private handle{ActionName}()                │
│    → confirmDestructiveAction() [if mutation]                     │
│    → createSnapshotIfNeeded() [if mutation]                       │
│    → return this.success(action, data, isMutation)                │
│                                                                  │
│  Standalone Path (12 tools):                                     │
│    handler.handle(validatedInput)                                │
│    → action switch → inline logic or private method               │
│    → return { response: { success, action, ...data } }            │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ SERVICE LAYER (src/services/)                                    │
│                                                                  │
│  Google API:   executeWithRetry() → circuit breaker → HTTP/2     │
│  Caching:      CachedSheetsApi → ETag + LRU (5-min TTL)          │
│  Batching:     BatchCompiler → 100 ops/batchUpdate                │
│  Parallel:     ParallelExecutor → 20 concurrent requests          │
│  Merging:      RequestMerger → overlapping range dedup            │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ RESPONSE PIPELINE                                                │
│                                                                  │
│  buildToolResponse()         → MCP CallToolResult envelope        │
│  validateOutputSchema()      → Advisory shape check               │
│  response-intelligence.ts    → Inject _meta.aiMode                │
│  tool-output-sanitization.ts → Redact secrets                     │
│  response-hints-engine.ts    → CoT hints for LLM                  │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT receives MCP CallToolResult                               │
└─────────────────────────────────────────────────────────────────┘
```

### MCP Protocol Feature Map

| Feature | Status | Implementation | Key File(s) |
|---------|--------|---------------|-------------|
| STDIO Transport | Active | McpServer + StdioServerTransport | server.ts |
| HTTP/SSE | Active | Express + SSEServerTransport | http-server.ts |
| Streamable HTTP | Active | InMemoryEventStore + cursor replay | mcp/event-store.ts |
| 25 Tools | Active | Discriminated union schemas | schemas/*.ts |
| 404 Actions | Active | Handler dispatch via switch | handlers/*.ts |
| Resources (68) | Active | URI templates + knowledge | resources/*.ts |
| Prompts (48) | Active | Guided workflows | mcp/registration/prompt-registration.ts |
| Sampling (SEP-1577) | Active | AI analysis on 5 actions | mcp/sampling.ts |
| Elicitation (SEP-1036) | Active | 4 interactive wizards | mcp/elicitation.ts |
| Tasks (SEP-1686) | Active | 9 task-augmented tools | core/task-store.ts |
| Completions | Active | spreadsheetId + range autocomplete | mcp/completions.ts |
| Icons (SEP-973) | Active | SVG for all 25 tools | mcp/features-2025-11-25.ts |
| Server Instructions | Active | LLM context block | mcp/features-2025-11-25.ts |

### Safety Rail Chain (all destructive operations)

```
1. confirmDestructiveAction()   → MCP Elicitation (SEP-1036)
   ↓ user approves
2. createSnapshotIfNeeded()     → Backup for rollback
   ↓
3. Google API mutation           → executeWithRetry() + circuit breaker
   ↓
4. Record in history             → historyService.record()
   ↓
5. Invalidate cache              → cacheInvalidationGraph.invalidate()
   ↓
6. Return success response       → buildToolResponse()
```

---

## 6. Largest Files Inventory

### Critical: Files Exceeding 2,000 Lines

| File | Lines | Category | Description | Decomposition Priority |
|------|-------|----------|-------------|----------------------|
| schemas/annotations.ts | 10,591 | Generated | Action annotations for MCP completions | N/A (auto-generated) |
| mcp/registration/prompt-registration.ts | 5,180 | Hand-written | 48 guided workflow prompts | HIGH — Split by domain |
| schemas/action-metadata.ts | 2,901 | Generated | Action documentation | N/A (auto-generated) |
| schemas/analyze.ts | 2,379 | Hand-written | 23 analyze action schemas | MEDIUM — Large but cohesive |
| mcp/registration/tool-discovery-hints.ts | 2,219 | Hand-written | LLM action discovery hints | MEDIUM — Split by tool |
| handlers/dimensions.ts | 2,146 | Hand-written | 30 dimension actions | HIGH — Decompose to submodules |
| services/transaction-manager.ts | 2,139 | Hand-written | ACID transactions + WAL | MEDIUM — WAL already extracted |
| analysis/comprehensive.ts | 2,079 | Hand-written | 43-category analysis | HIGH — Split by category |
| security/incremental-scope.ts | 2,051 | Hand-written | OAuth scope management | LOW — Cohesive domain |

### Warning: Files 1,500–2,000 Lines

| File | Lines | Description |
|------|-------|-------------|
| services/google-api.ts | 1,966 | Core API client with retry + circuit breaker |
| handlers/bigquery.ts | 1,937 | BigQuery integration (17 actions) |
| mcp/registration/tool-handlers.ts | 1,912 | Request pipeline orchestration |
| mcp/sampling.ts | 1,838 | MCP Sampling protocol |
| schemas/shared.ts | 1,813 | Common type definitions |
| handlers/compute.ts | 1,764 | Stats + regression + forecasting |
| schemas/composite.ts | 1,697 | 21 composite action schemas |
| services/session-context.ts | 1,676 | Active spreadsheet + preferences |
| core/request-builder.ts | 1,667 | Google API request construction |
| handlers/appsscript.ts | 1,664 | Apps Script automation |
| handlers/base.ts | 1,639 | Abstract base handler (20+ methods) |
| handlers/auth.ts | 1,604 | OAuth + SAML authentication |
| server.ts | 1,570 | Main MCP server entry point |

---

## 7. AI-Readability Findings

### Finding 1: God File Problem (CRITICAL)

**18 files exceed 1,500 lines; 9 files exceed 2,000 lines.** An AI agent (including Claude) analyzing this codebase cannot load a single handler + its schema + its services in one context window without truncation.

**Impact:** When asked "how does sheets_data.write work?", an AI must load:
- handlers/data.ts (366 lines)
- handlers/data-actions/read-write.ts (1,222 lines)
- handlers/base.ts (1,639 lines)
- schemas/data.ts (1,265 lines)
- services/cached-sheets-api.ts (varies)

Total: ~4,500+ lines just to trace one action.

**Recommendation:** Enforce a 1,200-line hard limit. Decompose the 9 files >2,000 lines using the action-submodule pattern already established in `handlers/*-actions/`.

### Finding 2: 32 Source Directories (HIGH)

The `src/` directory has 32 immediate subdirectories. This creates excessive cognitive overhead for both humans and AI agents.

**Overlapping concerns:**
- `src/server/` + `src/server-runtime/` + `src/server-utils/` + `src/http-server/` (4 server dirs)
- `src/auth/` + `src/security/` (unclear boundary)
- `src/core/` + `src/constants/` + `src/config/` (infrastructure scattered)

**Recommendation:** Consolidate to 15-18 directories by merging overlapping directories.

### Finding 3: Barrel File Anti-Pattern (HIGH)

9 barrel files (index.ts) totaling 981 lines of pure re-exports:
- `handlers/index.ts` (294 lines, 40+ exports)
- `services/index.ts` (111 lines, 36 exports)
- `resources/index.ts` (103 lines)

**Impact:** Barrel files hide the dependency graph, increase circular dependency risk, and slow down TypeScript compilation. Atlassian found that removing barrel files improved build times by 75%.

**Recommendation:** Remove application-level barrel files. Use direct imports (`from '../services/google-api'` instead of `from '../services'`).

### Finding 4: server.ts Orchestration Bottleneck (CRITICAL)

`server.ts` (1,570 lines) imports from 64 different modules across 8+ layers. It handles initialization, tool registration, request dispatch, and cleanup in a single file.

**Impact:** Any change to the server requires understanding all 64 dependencies. AI cannot reason about the startup sequence without loading the full file.

**Recommendation:** Extract into `src/startup/` modules:
- `server-init.ts` — Service initialization
- `server-registration.ts` — Tool/resource/prompt registration
- `server-dispatch.ts` — Request handling
- `server-lifecycle.ts` — Graceful shutdown

### Finding 5: Tests Not Co-Located (MEDIUM)

All 525 test files live in a separate `tests/` tree that doesn't mirror the `src/` structure. The test directory has 60+ subdirectories vs. src's 32, with categories like `chaos/`, `simulation/`, `compliance/` that have no src/ counterpart.

**Impact:** Finding the test for `src/handlers/dimensions.ts` requires searching across `tests/handlers/`, `tests/integration/`, `tests/simulation/`, and `tests/contracts/`.

**Recommendation:** Co-locate unit tests with source (e.g., `src/handlers/dimensions.test.ts`). Keep integration/e2e/chaos tests in the `tests/` tree.

### Finding 6: Generated + Hand-Written Files Mixed (MEDIUM)

`src/schemas/` contains both auto-generated files (annotations.ts at 10,591 lines, action-metadata.ts at 2,901 lines) and hand-written schemas. Only the `// AUTO-GENERATED` comment distinguishes them.

**Impact:** AI may attempt to edit generated files, causing regeneration conflicts. CLAUDE.md warns about this, but the file structure doesn't enforce it.

**Recommendation:** Move all generated files to `src/generated/schemas/` with a clear README. Keep only hand-written schemas in `src/schemas/`.

### Finding 7: Root-Level File Sprawl (MEDIUM)

86 files at the project root, including 28 config files, 14 markdown docs, 12 generated files, and 6 example files.

**Impact:** `ls` at root shows 86 items — most tools and AI agents struggle with this density. Configuration for 7 different tools (TypeScript, ESLint, Prettier, Stryker, Vitest, Knip, CSpell) is scattered.

**Recommendation:** Move non-essential root docs to `docs/` and group multi-file configs where possible.

### Finding 8: Handler Inheritance Depth (HIGH)

`BaseHandler` (1,639 lines) provides 20+ methods that all 13 subclasses inherit. The inheritance chain hides actual code flow — understanding `AnalyzeHandler.handleSuggestNextActions()` requires tracing through 4 files and 4,500+ lines.

**Recommendation:** Consider extracting cross-cutting concerns (snapshot, confirmation, progress) into composable mixins or middleware rather than base class inheritance.

### AI-Readability Score Summary

| Category | Score | Key Issue |
|----------|-------|-----------|
| File sizes | C | 18 god files (>1500 lines) |
| Directory structure | C+ | 32 dirs, 4 overlapping server dirs |
| Naming consistency | B | Some inconsistency (auth/ vs security/) |
| Type safety | A | Strict mode, discriminated unions, typed errors |
| Documentation | A | Living architecture docs, session notes |
| Test coverage | A- | 2,742 tests, 13 categories |
| Discoverability | B+ | Registry patterns, but barrel files obscure |
| Modularity | B- | Good services, but handlers too large |
| **Overall** | **B+** | **Strong foundation, structural debt** |

---

## 8. Best Practices Comparison

### Industry Standards vs. Current State

| Practice | Industry Standard | ServalSheets Current | Gap |
|----------|-------------------|---------------------|-----|
| Max file size | 500-1,200 lines | 18 files >1,500 lines | Decompose top 9 |
| Directory depth | 3-4 levels | Up to 5 levels (handlers/data-actions/) | Flatten 1 level |
| src/ subdirectories | 12-18 for 800-file project | 32 subdirectories | Consolidate to ~18 |
| Barrel files | Avoid in app code | 9 barrel files (981 lines) | Remove or minimize |
| Test co-location | Unit tests beside source | All tests in /tests/ | Co-locate unit tests |
| Generated files | Separate directory | Mixed with hand-written | Move to src/generated/ |
| Root files | <30 files | 86 files | Move docs, group configs |
| Entry point size | <500 lines | server.ts: 1,570 lines | Extract modules |
| Config files | Grouped by tool | Scattered at root | Group in config/ |
| Feature organization | Vertical slices | Horizontal layers | Hybrid possible |

### AI-Specific Best Practices (from research)

| Pattern | Benefit for AI | Current Status | Recommendation |
|---------|---------------|----------------|----------------|
| Vertical slice architecture | AI loads 1 feature = 1-3 files | Horizontal layers require 4-6 files | Add feature manifests |
| File names describe purpose | AI navigates by name | Good (handler names match tools) | Standardize *-actions/ naming |
| Self-documenting directories | AI infers purpose from structure | 32 dirs is too many | Consolidate with READMEs |
| Registry/manifest files | AI discovers tools in 1 read | Good (action-counts.ts, completions.ts) | Add TOOL_MANIFEST.ts |
| Max 1200 lines/file | AI loads full file in context | 18 files exceed this | Enforce with linting |
| Generated file markers | AI avoids editing generated code | Comments only | Move to src/generated/ |
| Discriminated unions | AI parses schema once = all actions | Excellent (already using) | No change needed |
| Typed errors | AI understands error flows | Good (typed, but ~100 generic remains) | Complete error typing |

---

## 9. Restructuring Proposals

### Proposal A: Consolidation Sprint (Effort: 2-3 days, Low Risk)

Reduce directory count and clean up structural debt without changing any logic.

**Changes:**

1. **Merge server directories** (4 → 1):
   ```
   BEFORE:                          AFTER:
   src/server/                      src/server/
   src/server-runtime/                ├── health.ts
   src/server-utils/                  ├── runtime.ts
   src/http-server/                   ├── utils.ts
                                      ├── http/
                                      │   ├── routes-transport.ts
                                      │   ├── routes-observability.ts
                                      │   └── middleware.ts
                                      └── well-known.ts
   ```

2. **Merge auth + security** (2 → 1):
   ```
   BEFORE:                          AFTER:
   src/auth/                        src/security/
   src/security/                      ├── saml-provider.ts
                                      ├── incremental-scope.ts
                                      ├── tool-hash-registry.ts
                                      └── webhook-signature.ts
   ```

3. **Merge core + constants** (2 → 1):
   ```
   BEFORE:                          AFTER:
   src/core/                        src/core/
   src/constants/                     ├── protocol.ts (was constants/)
                                      ├── batch-compiler.ts
                                      ├── request-builder.ts
                                      └── ...
   ```

4. **Move generated schemas**:
   ```
   BEFORE:                          AFTER:
   src/schemas/annotations.ts       src/generated/
   src/schemas/action-metadata.ts     ├── annotations.ts
   src/schemas/action-counts.ts       ├── action-metadata.ts
   src/schemas/descriptions.ts        ├── action-counts.ts
   src/generated/manifest.json        ├── descriptions.ts
                                      └── manifest.json
   src/schemas/ (hand-written only)
   ```

**Result:** 32 directories → ~22 directories. Cleaner separation of concerns.

### Proposal B: Handler Decomposition (Effort: 3-5 days, Medium Risk)

Split the 5 largest handlers using the already-established `*-actions/` pattern.

**Target files:**

| Handler | Current Lines | Proposed Split |
|---------|--------------|----------------|
| dimensions.ts | 2,146 | 4 files × ~500 lines (insert, resize, freeze, sort) |
| bigquery.ts | 1,937 | 3 files × ~650 lines (query, import, export) |
| compute.ts | 1,765 | 3 files × ~600 lines (stats, regression, forecast) |
| appsscript.ts | 1,664 | 3 files × ~550 lines (run, deploy, manage) |
| fix.ts | 1,252 | 2 files × ~625 lines (clean, standardize) |

**Pattern (already proven):**
```typescript
// src/handlers/dimensions.ts (200 lines — dispatch only)
import { handleInsertRows } from './dimensions-actions/insert.js';
import { handleResizeColumns } from './dimensions-actions/resize.js';

class SheetsDimensionsHandler extends BaseHandler {
  async executeAction(input) {
    switch (input.request.action) {
      case 'insert_rows': return handleInsertRows(this, input);
      case 'resize_columns': return handleResizeColumns(this, input);
      // ...
    }
  }
}
```

### Proposal C: AI Discovery Layer (Effort: 1 day, No Risk)

Add manifest files that let AI agents understand the codebase in a single file read.

**New file: `src/TOOL_MANIFEST.ts`**
```typescript
/**
 * Central registry of all 25 tools.
 * AI agents: Read this file FIRST to understand the codebase.
 */
export const TOOL_MANIFEST = {
  sheets_data: {
    description: 'Cell read/write, batch operations, cross-sheet federation',
    actions: 25,
    handler: 'src/handlers/data.ts',
    schema: 'src/schemas/data.ts',
    services: ['cached-sheets-api', 'parallel-executor', 'cross-spreadsheet'],
    hasSubmodules: true,
    submoduleDir: 'src/handlers/data-actions/',
  },
  // ... all 25 tools
} as const;
```

**New file: `src/ARCHITECTURE_MAP.ts`**
```typescript
/**
 * Machine-readable architecture map.
 * Maps every directory to its purpose and key files.
 */
export const ARCHITECTURE_MAP = {
  'src/handlers': {
    purpose: 'MCP tool handlers — one file per tool, action submodules for large tools',
    entryPattern: '{tool}.ts',
    keyFiles: ['base.ts'],
    dependsOn: ['src/services', 'src/schemas', 'src/mcp'],
  },
  // ... all directories
} as const;
```

### Proposal D: Feature-Slice Hybrid (Effort: 1-2 weeks, High Risk)

Reorganize around features rather than layers. This is the most impactful but highest-risk change.

```
src/
├── features/                      # One directory per tool
│   ├── sheets-data/
│   │   ├── handler.ts             # Main handler
│   │   ├── schema.ts              # Zod schema
│   │   ├── actions/               # Action implementations
│   │   │   ├── read.ts
│   │   │   ├── write.ts
│   │   │   └── batch.ts
│   │   ├── services/              # Tool-specific services
│   │   │   └── cross-spreadsheet.ts
│   │   └── handler.test.ts        # Co-located test
│   ├── sheets-analyze/
│   │   ├── handler.ts
│   │   ├── schema.ts
│   │   ├── actions/
│   │   └── services/
│   │       ├── suggestion-engine.ts
│   │       └── comprehensive.ts
│   └── [23 more tools]
│
├── shared/                        # Cross-feature infrastructure
│   ├── services/                  # Shared services
│   │   ├── google-api.ts
│   │   ├── cached-sheets-api.ts
│   │   └── batching-system.ts
│   ├── middleware/
│   ├── utils/
│   ├── types/
│   └── config/
│
├── mcp/                           # MCP protocol layer (unchanged)
├── generated/                     # All auto-generated files
└── server.ts                      # Entry point (slimmed to ~500 lines)
```

**Trade-offs:**
- Pro: AI can load one feature in 3-4 files total
- Pro: Adding a new tool = adding one directory
- Con: Major refactoring effort with high regression risk
- Con: Shared services still need cross-feature access

---

## 10. Prioritized Action Plan

### Phase 1: Quick Wins (1-2 days, no logic changes)

| # | Action | Files | Risk | Impact |
|---|--------|-------|------|--------|
| 1 | Create `src/TOOL_MANIFEST.ts` | 1 new | None | AI discovers all tools in 1 read |
| 2 | Move generated schemas to `src/generated/` | 5 moved | Low | Prevents accidental edits |
| 3 | Add `// @generated` markers to all auto-gen files | 5 edited | None | AI skips generated files |
| 4 | Create directory READMEs for top 10 src/ dirs | 10 new | None | Self-documenting structure |
| 5 | Add file-size linting rule (warn >1000, error >2000) | 1 config | None | Prevents future god files |

### Phase 2: Consolidation (2-3 days, low risk)

| # | Action | Dirs Affected | Risk | Impact |
|---|--------|---------------|------|--------|
| 6 | Merge server/ + server-runtime/ + server-utils/ | 3 → 1 | Low | -2 root dirs |
| 7 | Merge auth/ into security/ | 2 → 1 | Low | -1 root dir |
| 8 | Merge constants/ into core/ | 2 → 1 | Low | -1 root dir |
| 9 | Move root docs to docs/ (keep README, CLAUDE.md, CHANGELOG) | ~8 moved | None | Cleaner root |
| 10 | Remove barrel files from handlers/ and services/ | 2 deleted | Medium | Explicit imports |

### Phase 3: Handler Decomposition (3-5 days, medium risk)

| # | Action | Lines Saved | Risk | Impact |
|---|--------|-------------|------|--------|
| 11 | Split dimensions.ts (2,146) → 4 submodules | -1,650 | Medium | Largest handler fixed |
| 12 | Split bigquery.ts (1,937) → 3 submodules | -1,300 | Medium | Second largest fixed |
| 13 | Split compute.ts (1,765) → 3 submodules | -1,150 | Medium | Third largest fixed |
| 14 | Split appsscript.ts (1,664) → 3 submodules | -1,100 | Medium | Fourth largest fixed |
| 15 | Split prompt-registration.ts (5,180) → by domain | -4,000 | Medium | Largest MCP file fixed |

### Phase 4: Advanced Restructuring (1-2 weeks, higher risk)

| # | Action | Description | Risk |
|---|--------|-------------|------|
| 16 | Extract server.ts init/dispatch/lifecycle | 1,570 → 3 × 500 lines | Medium |
| 17 | Co-locate unit tests with source | Move ~200 tests to src/ | High |
| 18 | Feature-slice pilot (sheets_data only) | Prove pattern on 1 tool | Medium |
| 19 | Remove BaseHandler inheritance → composition | 13 handlers refactored | High |
| 20 | Plugin architecture for future tools | Enable F7-F12 features | High |

### Expected Outcomes

After Phase 1-3 completion:

| Metric | Before | After |
|--------|--------|-------|
| src/ subdirectories | 32 | ~22 |
| Files >2,000 lines | 9 | 3 (generated only) |
| Files >1,500 lines | 18 | ~8 |
| Root-level files | 86 | ~50 |
| Barrel file re-exports | 981 lines | ~200 lines |
| AI context needed for 1 action | 4,500+ lines | ~2,000 lines |
| Tool discoverability | Read 3+ files | Read 1 manifest file |

---

## Appendix A: Key Configuration Files

| File | Purpose | Lines |
|------|---------|-------|
| package.json | Dependencies, scripts, workspaces | ~300 |
| tsconfig.json | TypeScript strict config (ES2022, NodeNext) | ~30 |
| tsconfig.build.json | Build-specific overrides | ~15 |
| vitest.config.ts | Test runner configuration | ~50 |
| eslint.config.js | Linting rules | ~100 |
| .dependency-cruiser.cjs | Architecture boundary enforcement | ~200 |
| knip.json | Dead code detection config | ~30 |
| turbo.json | Monorepo pipeline config | ~20 |
| docker-compose.yml | Container orchestration | ~50 |
| .mcp.json | MCP server registration for Claude Desktop | ~30 |

## Appendix B: CI/CD Workflows (37 total)

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| ci.yml | Push/PR | Main pipeline: typecheck + lint + test + drift |
| test-gates.yml | PR | Quality gates (G0-G5) |
| coverage.yml | Push to main | Coverage tracking + badge |
| audit-106.yml | Manual | Comprehensive audit pipeline |
| release-audit.yml | Pre-release | Release readiness checks |
| docs.yml | Push to docs/ | VitePress documentation build |
| publish.yml | Tag | NPM package publishing |
| docker.yml | Push to main | Docker image build |
| security.yml | Schedule | Dependency vulnerability scan |
| scorecards.yml | Schedule | OpenSSF Scorecard |

## Appendix C: Monorepo Package (serval-core)

```
packages/serval-core/
├── src/
│   ├── interfaces/
│   │   └── backend.ts      (417 lines) — SpreadsheetBackend interface
│   ├── errors/              — Shared error types
│   ├── exporters/           — Data export utilities
│   ├── history/             — History tracking primitives
│   ├── observability/       — Shared metrics
│   ├── safety/              — Safety rail primitives
│   ├── types/               — Shared type definitions
│   └── utils/               — Shared utilities
├── dist/                    — Compiled output
└── package.json             — v0.1.0
```

---

*Report generated by full codebase crawl using 6 parallel analysis agents. All file counts and line numbers verified against the live repository on branch `remediation/phase-1`.*
