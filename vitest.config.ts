import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const isCI = process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true';
const maxConcurrency = isCI ? 4 : 8;
const maxWorkers = isCI ? 4 : 8;
const minWorkers = isCI ? 1 : 2;

export default defineConfig({
  resolve: {
    // Handle .js imports for .ts files (NodeNext module resolution compatibility)
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
    alias: {
      // node-cron emits sourcemap noise in test runs; use a deterministic test mock.
      'node-cron': fileURLToPath(new URL('./tests/mocks/node-cron.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Ensure tests don't run in production mode
    env: {
      NODE_ENV: 'test',
      OAUTH_AUTO_OPEN_BROWSER: 'false',
      OAUTH_USE_CALLBACK_SERVER: 'false',
      SERVAL_STAGED_REGISTRATION: 'false',
    },
    // Parallel execution with thread pool (increased for P2-2 optimization)
    pool: 'threads',
    // switch to 'forks' if OOM in low-memory environments (~3GB heap needed)
    maxConcurrency,
    maxWorkers,
    minWorkers,
    // Test sharding support for parallel execution
    // Use: npm run test:shard 1/4 to run 1st quarter of tests
    // Use: npm run test:unit to run unit tests only
    include: ['tests/**/*.test.ts'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'tests/.tmp/**',
      'tests/manual/**',
      'tests/examples/**',
      'tests/fixtures/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/index.ts', // Re-export files
        'src/cli.ts', // CLI entry point
        'src/http-server.ts', // HTTP server entry point (integration tested separately)
        'src/remote-server.ts', // Remote server entry point
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
      include: ['src/**/*.ts'],
    },
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
