import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const isCI = process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true';
const maxConcurrency = isCI ? 4 : 8;
const maxWorkers = isCI ? 4 : 8;
const minWorkers = isCI ? 1 : 2;

export default defineConfig({
  resolve: {
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
    alias: {
      'node-cron': fileURLToPath(new URL('../mocks/node-cron.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    env: {
      NODE_ENV: 'test',
      OAUTH_AUTO_OPEN_BROWSER: 'false',
      OAUTH_USE_CALLBACK_SERVER: 'false',
      SERVAL_STAGED_REGISTRATION: 'false',
    },
    pool: 'threads',
    maxConcurrency,
    maxWorkers,
    minWorkers,
    benchmark: {
      include: ['tests/audit/performance-profile.bench.ts'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**', '**/tests/benchmarks/**'],
    },
  },
});
