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
      'node-cron': fileURLToPath(new URL('./tests/mocks/node-cron.ts', import.meta.url)),
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
    exclude: [
      'node_modules/**',
      'dist/**',
      'tests/.tmp/**',
      'tests/manual/**',
      'tests/examples/**',
    ],
    testTimeout: 15000,
    hookTimeout: 30000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'tests/unit/**/*.test.ts',
            'tests/schemas/**/*.test.ts',
            'tests/utils/**/*.test.ts',
            'tests/core/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'handlers',
          include: ['tests/handlers/**/*.test.ts'],
          exclude: ['tests/handlers/**/*.snapshot.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts', 'tests/server/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'contracts',
          include: ['tests/contracts/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'compliance',
          include: ['tests/compliance/**/*.test.ts'],
        },
      },
    ],
  },
});
