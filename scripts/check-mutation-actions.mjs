#!/usr/bin/env node
/**
 * CI Check: Mutation Action Alignment
 *
 * Validates that MUTATION_ACTIONS and FORCE_WRITE_ACTIONS in the
 * write-lock middleware are consistent with:
 *   1. MUTATION_ACTIONS in audit-middleware (must be identical)
 *   2. Cache invalidation graph (mutations must have invalidation rules)
 *
 * Usage: node scripts/check-mutation-actions.mjs
 * Exit code 0 = aligned, 1 = misaligned (CI gate failure)
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Parse sets from source files (AST-free: regex over source text)
// ---------------------------------------------------------------------------

function extractSetEntries(filePath, setName) {
  const src = readFileSync(resolve(ROOT, filePath), 'utf8');
  // Match: export const SET_NAME = new Set<...>([\n  'entry1',\n  'entry2',\n]);
  const re = new RegExp(
    `export\\s+const\\s+${setName}\\s*=\\s*new\\s+Set[^(]*\\(\\[([\\s\\S]*?)\\]\\)`,
    'm'
  );
  const match = src.match(re);
  if (!match) {
    console.error(`  ❌ Could not find ${setName} in ${filePath}`);
    process.exit(1);
  }
  const entries = [];
  for (const m of match[1].matchAll(/'([^']+)'/g)) {
    entries.push(m[1]);
  }
  return new Set(entries);
}

function extractCacheInvalidationMutations(filePath) {
  const src = readFileSync(resolve(ROOT, filePath), 'utf8');
  const mutations = new Set();
  // Match: rules['tool.action'] = { invalidates: ['something'] };
  // Skip lines where invalidates is empty []
  const re = /rules\['([^']+)'\]\s*=\s*\{\s*invalidates:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const key = m[1];       // e.g. 'sheets_data.write'
    const deps = m[2].trim(); // e.g. "'values:*'" or ""
    if (deps.length > 0) {
      // This action has cache invalidation = it's a mutation
      const action = key.split('.')[1];
      if (action) mutations.add(action);
    }
  }
  return mutations;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('═══════════════════════════════════════════════════════');
console.log('  Mutation Action Alignment Check');
console.log('═══════════════════════════════════════════════════════\n');

const writeLockMutations = extractSetEntries(
  'src/middleware/write-lock-middleware.ts',
  'MUTATION_ACTIONS'
);
const writeLockForce = extractSetEntries(
  'src/middleware/write-lock-middleware.ts',
  'FORCE_WRITE_ACTIONS'
);
const auditMutations = extractSetEntries(
  'src/middleware/audit-middleware.ts',
  'MUTATION_ACTIONS'
);

console.log(`  Write-lock MUTATION_ACTIONS:  ${writeLockMutations.size} entries`);
console.log(`  Write-lock FORCE_WRITE:       ${writeLockForce.size} entries`);
console.log(`  Audit MUTATION_ACTIONS:        ${auditMutations.size} entries`);

let failures = 0;

// Check 1: write-lock and audit sets must be identical
const inWriteNotAudit = [...writeLockMutations].filter((a) => !auditMutations.has(a));
const inAuditNotWrite = [...auditMutations].filter((a) => !writeLockMutations.has(a));

if (inWriteNotAudit.length > 0 || inAuditNotWrite.length > 0) {
  console.log('\n❌ Check 1: write-lock ↔ audit MUTATION_ACTIONS mismatch');
  if (inWriteNotAudit.length > 0) {
    console.log(`   In write-lock but NOT audit: ${inWriteNotAudit.join(', ')}`);
  }
  if (inAuditNotWrite.length > 0) {
    console.log(`   In audit but NOT write-lock: ${inAuditNotWrite.join(', ')}`);
  }
  failures++;
} else {
  console.log('\n✅ Check 1: write-lock ↔ audit MUTATION_ACTIONS are identical');
}

// Check 2: no overlap between MUTATION_ACTIONS and FORCE_WRITE_ACTIONS
const overlap = [...writeLockMutations].filter((a) => writeLockForce.has(a));
if (overlap.length > 0) {
  console.log(`\n❌ Check 2: overlap between MUTATION_ACTIONS and FORCE_WRITE: ${overlap.join(', ')}`);
  failures++;
} else {
  console.log('✅ Check 2: no overlap between MUTATION_ACTIONS and FORCE_WRITE_ACTIONS');
}

// Check 3: cache invalidation graph covers all declared mutations
const cacheMutations = extractCacheInvalidationMutations(
  'src/services/cache-invalidation-graph.ts'
);
console.log(`\n  Cache invalidation mutations: ${cacheMutations.size} entries`);

const allDeclared = new Set([...writeLockMutations, ...writeLockForce]);
const missingCacheRules = [...allDeclared].filter((a) => !cacheMutations.has(a));
// Filter out actions that are mutations but don't touch spreadsheet data directly
// (e.g. transaction management, webhook ops, auth ops)
const exemptActions = new Set([
  'begin', 'queue', 'commit', 'rollback', 'abort', 'status',  // transaction
  'register', 'unregister', 'test',                             // webhook
  'login', 'logout', 'callback',                                // auth
  'configure', 'setup_feature',                                  // connectors
  'plan', 'execute', 'execute_step',                            // agent
  'undo', 'redo', 'revert_to',                                   // history
  'set_active', 'set_context',                                   // session
]);
const genuinelyMissing = missingCacheRules.filter((a) => !exemptActions.has(a));

if (genuinelyMissing.length > 0) {
  console.log(`\n⚠️  Check 3: ${genuinelyMissing.length} mutation(s) missing cache invalidation rules:`);
  for (const a of genuinelyMissing.sort()) {
    console.log(`   - ${a}`);
  }
  // Warning only — not all mutations need cache rules (e.g. create in new spreadsheet)
} else {
  console.log('✅ Check 3: all non-exempt mutations have cache invalidation rules');
}

console.log('\n═══════════════════════════════════════════════════════');
if (failures > 0) {
  console.log(`  ❌ ${failures} CHECK(S) FAILED`);
  console.log('═══════════════════════════════════════════════════════');
  process.exit(1);
} else {
  console.log('  ✅ ALL CHECKS PASSED');
  console.log('═══════════════════════════════════════════════════════');
}
