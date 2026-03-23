/**
 * Vitest Configuration - Chaos Engineering
 *
 * Specialized configuration for chaos/resilience testing with:
 * - Extended timeouts for failure scenarios
 * - Sequential execution for accurate failure injection
 * - Resource monitoring
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Chaos tests require extended timeouts for failure scenarios
    testTimeout: 2 * 60 * 1000, // 2 minutes per test
    hookTimeout: 60 * 1000, // 60 seconds for setup/teardown

    // Run tests sequentially to avoid interference
    pool: 'threads',
    maxWorkers: 1, // One test at a time for controlled chaos

    // Include only chaos test files
    include: ['tests/chaos/**/*.test.ts'],

    // Reporters
    reporters: ['verbose'],

    // Retry configuration (allow 1 retry for transient failures)
    retry: 1,

    // Coverage not applicable for chaos tests
    coverage: {
      enabled: false,
    },

    // Environment
    environment: 'node',

    // Disable watch mode for chaos tests
    watch: false,

    // Isolation - each chaos test is self-contained
    isolate: true,
  },
});
