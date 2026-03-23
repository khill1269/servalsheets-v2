#!/usr/bin/env node
/**
 * verify-merger-wiring.mjs
 * Verifies RequestMerger is properly wired into CachedSheetsApi.
 * Checks 3 integration points.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = process.cwd();

const cachedApi = readFileSync(resolve(root, 'src/services/cached-sheets-api.ts'), 'utf-8');
const perfInit = readFileSync(resolve(root, 'src/startup/performance-init.ts'), 'utf-8');

const checks = [
  {
    name: 'CachedSheetsApi constructor accepts requestMerger',
    file: 'src/services/cached-sheets-api.ts',
    pass: /requestMerger\??\s*:\s*RequestMerger/.test(cachedApi),
  },
  {
    name: 'CachedSheetsApi.getValues() uses requestMerger',
    file: 'src/services/cached-sheets-api.ts',
    pass: /this\.requestMerger/.test(cachedApi),
  },
  {
    name: 'performance-init.ts passes requestMerger to CachedSheetsApi',
    file: 'src/startup/performance-init.ts',
    pass: /new CachedSheetsApi\([^)]*requestMerger/.test(perfInit) ||
          /CachedSheetsApi.*requestMerger/.test(perfInit),
  },
];

console.log('\n══════════════════════════════════════════════════');
console.log('  RequestMerger Wiring Verification');
console.log('══════════════════════════════════════════════════');

let passed = 0;
for (const check of checks) {
  const status = check.pass ? '✅' : '❌';
  console.log(`  ${status} ${check.name}`);
  console.log(`     File: ${check.file}`);
  if (check.pass) passed++;
}

console.log(`\n  Result: ${passed}/${checks.length} integration points wired`);

if (passed < checks.length) {
  console.log('\n❌ FAIL: RequestMerger not fully wired');
  console.log('  Fix: Add requestMerger parameter to CachedSheetsApi constructor,');
  console.log('  use this.requestMerger in getValues(), pass from performance-init.ts');
  process.exit(1);
}

console.log('\n✅ PASS: RequestMerger fully wired into CachedSheetsApi');
