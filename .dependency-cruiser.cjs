/**
 * Dependency Cruiser Configuration
 *
 * Enforces architectural boundaries and detects:
 * - Circular dependencies
 * - Orphaned files
 * - Layer violations (handlers → services → schemas)
 *
 * Run: npx depcruise --config .dependency-cruiser.js --output-type err src/
 * Visualize: npx depcruise --config .dependency-cruiser.js --output-type dot src/ | dot -T svg > architecture.svg
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies create tight coupling and maintenance issues',
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Orphaned files are not imported anywhere and may be dead code',
      from: {
        orphan: true,
        pathNot: [
          '^(tests|scripts|docs)',
          '\\.test\\.ts$',
          '\\.spec\\.ts$',
          '^src/cli\\.ts$',
          '^src/server\\.ts$',
          '^src/http-server\\.ts$',
          '^src/remote-server\\.ts$',
          // Dynamic worker entrypoints loaded by file path at runtime
          '^src/workers/(worker-runner|formula-parser-worker|analysis-worker)\\.ts$',
          // DuckDB worker loaded via new URL('./duckdb-worker.js', import.meta.url) — not a static import
          '^src/services/duckdb-worker\\.ts$',
          // Test/tooling modules intentionally imported from tests/scripts only
          '^src/utils/(schema-inspection|infrastructure|ast-schema-parser)\\.ts$',
          '^src/services/confirmation-policy\\.ts$',
          '^src/schemas/handler-deviations\\.ts$',
          '^src/middleware/schema-version\\.ts$',
          '^src/mcp/response-builder\\.ts$',
          // Static asset served by admin routes (not module-imported)
          '^src/admin/dashboard\\.js$',
        ],
      },
      to: {},
    },
    {
      name: 'no-handler-to-handler',
      severity: 'error',
      comment:
        'Handlers must not import peer handlers. Thin-dispatch handler submodules and shared handler utilities are allowed.',
      from: {
        path: '^src/handlers',
        pathNot: '^src/handlers/index\\.ts$', // Allow index.ts to import all handlers (barrel export)
      },
      to: {
        path: '^src/handlers',
        pathNot: [
          '^src/handlers/base\\.ts$',
          '^src/handlers/error-codes\\.ts$',
          '^src/handlers/helpers/',
          '^src/handlers/[a-z-]+-actions/',
          '^src/handlers/dimensions-filter-helpers\\.ts$',
        ],
      },
    },
    {
      name: 'no-service-to-handler',
      severity: 'error',
      comment: 'Services must not import handlers (dependency inversion violation)',
      from: {
        path: '^src/services',
      },
      to: {
        path: '^src/handlers',
      },
    },
    {
      name: 'handlers-only-import-allowed-layers',
      severity: 'error',
      comment: 'Handlers can only import from allowed layers (not entry points)',
      from: {
        path: '^src/handlers',
        pathNot: '^src/handlers/index\\.ts$', // Allow index.ts to import all handlers
      },
      to: {
        path: '^src/',
        pathNot: [
          '^src/(services|schemas|utils|types|config|observability|errors|constants|core|mcp|security|analysis|resources)',
          '^src/handlers/',
          '^src/connectors/', // handlers/connectors.ts + handlers/auth.ts import connectors layer (type imports + dynamic import)
        ],
      },
    },
    {
      name: 'services-only-import-allowed-layers',
      severity: 'error',
      comment:
        'Services can only import from allowed layers; specific shared analysis/sampling modules are permitted.',
      from: {
        path: '^src/services',
      },
      to: {
        path: '^src/',
        pathNot: [
          '^src/(services|schemas|utils|types|config|observability|errors|constants|core|security|resources)',
          '^src/analysis/scout\\.ts$',
          '^src/analysis/workbook-semantics\\.ts$', // understanding-store.ts uses SemanticIndex type
          '^src/analysis/formula-helpers\\.ts$',    // sheet-generator.ts + sampling-analysis.ts (dynamic import)
          '^src/mcp/sampling\\.ts$',
        ],
      },
    },
    {
      name: 'schemas-are-leaf-layer',
      severity: 'error',
      comment: 'Schemas should be leaf nodes (only import utils, types, config, mcp/completions)',
      from: {
        path: '^src/schemas',
      },
      to: {
        path: '^src/',
        pathNot: [
          '^src/(schemas|utils|types|constants|config)',
          '^src/mcp/completions\\.ts$', // Allow importing TOOL_ACTIONS for completions
        ],
      },
    },
    {
      name: 'no-test-imports-in-src',
      severity: 'error',
      comment: 'Source code must not import test files',
      from: {
        path: '^src',
        pathNot: '\\.test\\.ts$',
      },
      to: {
        path: '\\.test\\.ts$',
      },
    },
  ],
  options: {
    // Only check TypeScript files in src/
    doNotFollow: {
      path: ['node_modules', 'dist', 'coverage', '\\.d\\.ts$'],
    },
    includeOnly: '^src/',

    // TypeScript/Node.js configuration
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },

    // Enhanced reporting
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },

    // Report options
    reporterOptions: {
      dot: {
        collapsePattern: '^node_modules/[^/]+',
        theme: {
          graph: {
            splines: 'ortho',
            rankdir: 'TB',
          },
          modules: [
            {
              criteria: { source: '^src/handlers' },
              attributes: { fillcolor: '#ffcccc', style: 'filled' },
            },
            {
              criteria: { source: '^src/services' },
              attributes: { fillcolor: '#ccffcc', style: 'filled' },
            },
            {
              criteria: { source: '^src/schemas' },
              attributes: { fillcolor: '#ccccff', style: 'filled' },
            },
            {
              criteria: { source: '^src/mcp' },
              attributes: { fillcolor: '#ffffcc', style: 'filled' },
            },
          ],
        },
      },
    },
  },
};
