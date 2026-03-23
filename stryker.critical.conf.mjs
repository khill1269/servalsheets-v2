// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: 'npm',
  testRunner: 'vitest',
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  reporters: ['clear-text', 'progress'],
  timeoutMS: 30000,
  concurrency: 2,
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },
  // Critical security + safety paths only
  mutate: [
    'src/security/saml-provider.ts',
    'src/oauth-provider.ts',
    'src/middleware/mutation-safety-middleware.ts',
    'src/middleware/write-lock-middleware.ts',
    'src/middleware/rate-limit-middleware.ts',
    'src/utils/retry.ts',
    'src/utils/circuit-breaker.ts',
    'src/workers/python-worker.ts',
    'src/workers/duckdb-worker.ts',
  ],
  ignorePatterns: [
    'dist',
    'node_modules',
    'src/generated/**',
    'tests/**',
    'scripts/**',
    'docs/**',
  ],
};

export default config;
