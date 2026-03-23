/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  reporters: ['html', 'clear-text', 'progress'],
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
  },
  coverageAnalysis: 'perTest',
  // Minimal: only validate error handling and schema parsing
  mutate: [
    'src/core/errors.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
  ],
  thresholds: {
    high: 60,
    low: 40,
    break: 0,
  },
  timeoutMS: 60000,
  concurrency: 2,
  disableTypeChecks: true,
  ignorePatterns: ['node_modules', 'dist', 'coverage', 'benchmark'],
};
