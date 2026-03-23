/**
 * Vitest Configuration for Live API Tests
 *
 * Specialized configuration for running tests against the real Google Sheets API.
 * Use with: npx vitest --config vitest.config.live.ts
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Handle .js imports for .ts files (NodeNext module resolution compatibility)
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // Use both global setup and live-api specific setup
    setupFiles: ['./tests/setup.ts', './tests/live-api/setup.ts'],
    // Only include live API tests
    include: ['tests/live-api/**/*.test.ts', 'tests/live-api/**/*.live.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'tests/.tmp/**'],
    // Environment variables for live testing
    env: {
      NODE_ENV: 'test',
      OAUTH_AUTO_OPEN_BROWSER: 'false',
      // These can be overridden by actual environment
      TEST_REAL_API: process.env.TEST_REAL_API ?? 'false',
      TEST_SPREADSHEET_ID: process.env.TEST_SPREADSHEET_ID ?? '',
      TEST_INFRASTRUCTURE_ENABLED: 'true',
    },
    // Extended timeouts for API calls
    testTimeout: 60000,
    hookTimeout: 60000,
    // Disable parallel execution to respect rate limits
    pool: 'forks',
    maxWorkers: 1,
    // Retry configuration for flaky tests
    retry: 1,
    // Reporter configuration
    reporters: ['verbose'],
    // Bail on first failure in CI
    bail: process.env.CI ? 1 : 0,
    // Coverage configuration (optional for live tests)
    coverage: {
      enabled: false, // Disable coverage for live tests by default
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
    },
    // Sequence configuration
    sequence: {
      // Run tests in a predictable order
      shuffle: false,
    },
  },
});
