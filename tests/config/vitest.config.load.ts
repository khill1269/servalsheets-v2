/**
 * Vitest Configuration - Load Testing
 *
 * Specialized configuration for load/stress testing with:
 * - Extended timeouts (tests can run 60+ minutes)
 * - Thread pool optimization for concurrent operations
 * - Resource monitoring
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Load tests require extended timeouts
    testTimeout: 90 * 60 * 1000, // 90 minutes (allows for 60 min sustained + overhead)
    hookTimeout: 60 * 1000, // 60 seconds for setup/teardown

    // Run tests sequentially to avoid resource contention
    pool: 'threads',
    maxWorkers: 1, // Run one test at a time for accurate metrics

    // Include only load test files
    include: ['tests/load/**/*.test.ts'],

    // Reporters
    reporters: ['verbose'],

    // Retry configuration (no retries for load tests - want accurate failure data)
    retry: 0,

    // Coverage not applicable for load tests
    coverage: {
      enabled: false,
    },

    // Environment
    environment: 'node',

    // Global setup/teardown
    globalSetup: [],
    globalTeardown: [],

    // Disable watch mode for load tests
    watch: false,

    // Isolation - each load test is self-contained
    isolate: true,

    // Bail on first failure (optional - can comment out for full run)
    // bail: 1,
  },
});
