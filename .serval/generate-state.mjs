#!/usr/bin/env node
/**
 * Auto-generates .serval/state.md from live codebase data.
 *
 * Run: node .serval/generate-state.mjs
 *
 * This script computes project state from source files so it's NEVER stale.
 * Designed to run via SessionStart hook or manually.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function safe(fn, fallback = 'unknown') {
  try { return fn(); } catch { return fallback; }
}

function exec(cmd, timeout = 10000) {
  try {
    return execSync(cmd, { cwd: ROOT, timeout, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { return null; }
}

// ─── Gather Facts ───────────────────────────────────────────

// 1. Version info from source files
const actionCountsSrc = safe(() => readFileSync(`${ROOT}/src/schemas/action-counts.ts`, 'utf-8'));
const toolCount = (actionCountsSrc.match(/\w+:\s*\d+/g) || []).length;
const actionCount = (actionCountsSrc.match(/:\s*(\d+)/g) || [])
  .map(m => parseInt(m.replace(/:\s*/, '')))
  .reduce((a, b) => a + b, 0);

const pkgJson = safe(() => JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf-8')), {});
const version = pkgJson.version || 'unknown';

const protocolVersion = safe(() => {
  // MCP_PROTOCOL_VERSION is defined in config/protocol.ts (version.ts only re-exports it)
  const candidates = [
    `${ROOT}/src/config/protocol.ts`,
    `${ROOT}/src/config/protocol.js`,
    `${ROOT}/src/version.ts`,
  ];
  for (const f of candidates) {
    try {
      const src = readFileSync(f, 'utf-8');
      const match = src.match(/MCP_PROTOCOL_VERSION\s*=\s*['"]([^'"]+)['"]/);
      if (match) return match[1];
    } catch { /* skip missing files */ }
  }
  return 'unknown';
});

// 2. Build status (fast check)
const tscResult = exec('npx tsc --noEmit 2>&1 | tail -1');
const buildPasses = tscResult !== null && !tscResult.includes('error');

// 3. Test counts (from last known run, or quick check)
const testFileCount = safe(() => {
  const files = exec('find tests -name "*.test.ts" -o -name "*.bench.ts" | wc -l');
  return files ? files.trim() : 'unknown';
});

// 4. Per-tool action breakdown
const actionBreakdown = safe(() => {
  const lines = actionCountsSrc.match(/\s+(\w+):\s*(\d+)/g) || [];
  return lines.map(l => {
    const m = l.trim().match(/(\w+):\s*(\d+)/);
    return m ? `| ${m[1]} | ${m[2]} |` : null;
  }).filter(Boolean).join('\n');
}, '| (error reading) | - |');

// 5. Git status
const gitBranch = exec('git branch --show-current') || 'unknown';
const gitLastCommit = exec('git log --oneline -1') || 'unknown';
const gitDirty = exec('git status --porcelain | wc -l');
const uncommittedFiles = gitDirty && parseInt(gitDirty) > 0 ? `${gitDirty} uncommitted files` : 'clean';

// 6. Monorepo status
const hasServalCore = existsSync(`${ROOT}/packages/serval-core/package.json`);
const servalCoreVersion = hasServalCore
  ? safe(() => JSON.parse(readFileSync(`${ROOT}/packages/serval-core/package.json`, 'utf-8')).version)
  : 'not extracted yet';

// 7. Adapter layer
const hasAdapterDir = existsSync(`${ROOT}/src/adapters`);
const adapterFiles = hasAdapterDir
  ? safe(() => readdirSync(`${ROOT}/src/adapters`).filter(f => f.endsWith('.ts')).join(', '))
  : 'none';

// 8. Key file sizes (quick health check)
const fileSizes = [
  'src/server.ts',
  'src/http-server.ts',
  'src/handlers/base.ts',
  'src/schemas/action-counts.ts',
].map(f => {
  const lines = exec(`wc -l "${ROOT}/${f}" 2>/dev/null | awk '{print $1}'`);
  return `| ${f} | ${lines || '?'} lines |`;
}).join('\n');

// 9. Known issues detection
const knownIssues = [];

// Check for stale .agent-context
if (existsSync(`${ROOT}/.agent-context/metadata.json`)) {
  const meta = safe(() => JSON.parse(readFileSync(`${ROOT}/.agent-context/metadata.json`, 'utf-8')), {});
  if (meta.toolCount !== toolCount || meta.actionCount !== actionCount) {
    knownIssues.push(`- .agent-context/metadata.json is STALE (says ${meta.toolCount}/${meta.actionCount}, actual ${toolCount}/${actionCount})`);
  }
}

// Check PROJECT_STATUS.md staleness (compare against computed values)
if (existsSync(`${ROOT}/docs/development/PROJECT_STATUS.md`)) {
  const status = safe(() => readFileSync(`${ROOT}/docs/development/PROJECT_STATUS.md`, 'utf-8'), '');
  const hasCorrectTools = status.includes(`| Tools      | ${toolCount}`);
  const hasCorrectActions = status.includes(`| Actions    | ${actionCount}`);
  const hasCorrectVersion = status.includes(`| Version    | ${version}`);
  if (!hasCorrectTools || !hasCorrectActions || !hasCorrectVersion) {
    knownIssues.push(`- docs/development/PROJECT_STATUS.md may have stale counts (expected ${toolCount}/${actionCount}/${version})`);
  }
}

// Check drift script (fixed in Session 12; 15s timeout is generous)
const driftResult = exec('timeout 15 npm run check:drift 2>&1', 20000);
if (driftResult === null || driftResult.includes('timeout')) {
  knownIssues.push('- npm run check:drift hangs/times out');
}

// Check README.md staleness
if (existsSync(`${ROOT}/README.md`)) {
  const readme = safe(() => readFileSync(`${ROOT}/README.md`, 'utf-8'), '');
  if (!readme.includes(`${actionCount} Actions`) && !readme.includes(`${actionCount} actions`)) {
    knownIssues.push(`- README.md has stale action count (expected ${actionCount})`);
  }
}

// Check SOURCE_OF_TRUTH.md staleness
if (existsSync(`${ROOT}/docs/development/SOURCE_OF_TRUTH.md`)) {
  const sot = safe(() => readFileSync(`${ROOT}/docs/development/SOURCE_OF_TRUTH.md`, 'utf-8'), '');
  if (!sot.includes(`${actionCount}`) || sot.includes('299')) {
    knownIssues.push(`- docs/development/SOURCE_OF_TRUTH.md has stale action count (expected ${actionCount})`);
  }
}

// Check stale agent-memory files
const agentMemoryDir = `${ROOT}/.claude/agent-memory`;
if (existsSync(agentMemoryDir)) {
  const memFiles = safe(() => readdirSync(agentMemoryDir, { recursive: true }).filter(f => String(f).endsWith('MEMORY.md')), []);
  for (const mf of memFiles) {
    const content = safe(() => readFileSync(`${agentMemoryDir}/${mf}`, 'utf-8'), '');
    // Check for hardcoded wrong counts
    const wrongCounts = content.match(/(?:TOOL_COUNT|ACTION_COUNT)\s*=\s*(\d+)/g) || [];
    for (const wc of wrongCounts) {
      const num = parseInt(wc.match(/(\d+)/)[1]);
      if (num !== toolCount && num !== actionCount) {
        knownIssues.push(`- .claude/agent-memory/${mf} has stale count: ${wc} (actual: ${toolCount} tools, ${actionCount} actions)`);
        break; // One warning per file is enough
      }
    }
  }
}

// 10. Feature flags (from src/config/env.ts)
const featureFlags = safe(() => {
  const envSrc = readFileSync(`${ROOT}/src/config/env.ts`, 'utf-8');
  const flagRegex = /\b(ENABLE_\w+):\s*z\.coerce\.boolean\(\)\.default\((true|false)\)/g;
  const flags = [];
  let match;
  while ((match = flagRegex.exec(envSrc)) !== null) {
    flags.push({ name: match[1], defaultValue: match[2] });
  }
  return flags;
}, []);

const featureFlagTable = featureFlags.length > 0
  ? featureFlags.map(f => `| ${f.name} | ${f.defaultValue === 'true' ? '✅ ON' : '❌ OFF'} |`).join('\n')
  : '| (none found) | - |';

// 11. Quick test health (run test:fast with timeout, capture summary)
const testHealth = safe(() => {
  const result = exec('npx vitest run --reporter=verbose 2>&1 | tail -3', 30000);
  if (!result) return { status: 'unknown', summary: 'Could not run tests (timeout or error)' };
  const passMatch = result.match(/(\d+)\s+passed/);
  const failMatch = result.match(/(\d+)\s+failed/);
  const skipMatch = result.match(/(\d+)\s+skipped/);
  const passed = passMatch ? parseInt(passMatch[1]) : 0;
  const failed = failMatch ? parseInt(failMatch[1]) : 0;
  const skipped = skipMatch ? parseInt(skipMatch[1]) : 0;
  const status = failed > 0 ? '❌ FAILING' : passed > 0 ? '✅ PASSING' : '⚠️ UNKNOWN';
  return { status, summary: `${passed} passed, ${failed} failed, ${skipped} skipped`, raw: result };
}, { status: '⚠️ SKIPPED', summary: 'Test run skipped (timeout)', raw: '' });

// 12. Audit infrastructure status
const auditFiles = [
  'tests/audit/action-coverage-fixtures.ts',
  'tests/audit/action-coverage.test.ts',
  'tests/audit/performance-profile.bench.ts',
  'tests/audit/memory-leaks.test.ts',
  'scripts/generate-health-snapshot.ts',
  'scripts/audit-gate.sh',
];
const auditStatus = auditFiles.map(f => {
  const exists = existsSync(`${ROOT}/${f}`);
  return `| ${f} | ${exists ? '✅' : '❌'} |`;
}).join('\n');

// ─── Generate Markdown ──────────────────────────────────────

const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC');

const md = `# ServalSheets Live State

> Auto-generated by \`.serval/generate-state.mjs\` — DO NOT EDIT MANUALLY
> Generated: ${now}

## Version

| Metric | Value | Source |
|--------|-------|--------|
| Tools | ${toolCount} | src/schemas/action-counts.ts |
| Actions | ${actionCount} | src/schemas/action-counts.ts |
| Package Version | ${version} | package.json |
| Protocol | ${protocolVersion} | src/version.ts |
| TypeScript | ${buildPasses ? '✅ compiles' : '❌ errors'} | tsc --noEmit |

## Git

| Metric | Value |
|--------|-------|
| Branch | ${gitBranch} |
| Last Commit | ${gitLastCommit} |
| Working Tree | ${uncommittedFiles} |

## Tool Inventory

| Tool | Actions |
|------|---------|
${actionBreakdown}

## Monorepo

| Component | Status |
|-----------|--------|
| serval-core | ${hasServalCore ? `v${servalCoreVersion}` : 'not extracted'} |
| Adapter layer | ${hasAdapterDir ? adapterFiles : 'not created'} |

## Key Files

| File | Size |
|------|------|
${fileSizes}

## Test Health

| Metric | Value |
|--------|-------|
| Status | ${testHealth.status} |
| Summary | ${testHealth.summary} |

## Feature Flags (defaults from src/config/env.ts)

| Flag | Default |
|------|---------|
${featureFlagTable}

## Test Infrastructure

| File | Exists |
|------|--------|
${auditStatus}
| Test files | ${testFileCount} total |

## Audit Commands
\`\`\`bash
npm run audit:coverage   # 315-action coverage test
npm run audit:perf       # Performance benchmarks
npm run audit:memory     # Memory leak detection
npm run audit:gate       # CI gate (7 checks)
npm run audit:snapshot   # Full health report
npm run audit:full       # All of the above
\`\`\`

## Known Issues
${knownIssues.length > 0 ? knownIssues.join('\n') : '- None detected ✅'}

## Verification Commands
\`\`\`bash
npm run verify:safe      # Safe verification (skips lint — use when ESLint OOMs)
npm run verify           # Full verification (typecheck + lint + test + drift)
npm run schema:commit    # After schema changes
npm run test:fast        # Quick test suite
npm run gates            # Full gate pipeline (G0-G5)
\`\`\`
`;

writeFileSync(`${ROOT}/.serval/state.md`, md);
console.log(`✅ .serval/state.md generated (${md.split('\n').length} lines)`);
