#!/usr/bin/env node

/**
 * Fast development build script using esbuild
 * Usage:
 *   node scripts/dev-server.mjs           - Single build
 *   node scripts/dev-server.mjs --watch   - Watch mode with rebuild on save
 */

import esbuild from 'esbuild';
import { readFileSync } from 'fs';
import path from 'path';

const isWatch = process.argv.includes('--watch');

// Get package.json info for banner
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

const options = {
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external: [
    // Node.js built-ins
    'fs',
    'path',
    'http',
    'https',
    'stream',
    'util',
    'events',
    'crypto',
    'zlib',
    'net',
    'tls',
    'buffer',
    'os',
    'readline',
    'worker_threads',
    'perf_hooks',
    // External packages (mark as external to avoid bundling)
    '@modelcontextprotocol/sdk',
    '@serval/core',
    'express',
    'googleapis',
    'google-auth-library',
    'zod',
    'winston',
    'helmet',
    'cors',
    'dotenv',
    'ioredis',
    'node-cron',
    'better-sqlite3',
    'hyperformula',
    'pyodide',
    'jsonwebtoken',
    'lru-cache',
    'p-queue',
    'prom-client',
    'stripe',
    'uuid',
    'open',
    'compression',
    'node-saml',
  ],
  sourcemap: true,
  logLevel: 'info',
  banner: {
    js: `// ServalSheets v${pkg.version} - Fast dev build\n`,
  },
};

async function build() {
  try {
    if (isWatch) {
      console.log('🔍 Starting esbuild in watch mode...');
      const ctx = await esbuild.context(options);
      await ctx.watch();
      console.log('✅ Watch mode active. Press Ctrl+C to stop.');
    } else {
      console.log('🔨 Building with esbuild...');
      await esbuild.build(options);
      console.log('✅ Build complete: dist/server.js');
    }
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();
