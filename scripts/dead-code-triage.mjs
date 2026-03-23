#!/usr/bin/env node
/**
 * Dead Code Triage
 *
 * Produces an actionable dead-code report by combining ts-prune results with
 * cross-file usage evidence from ripgrep.
 *
 * Outputs:
 * - audit-output/dead-code-triage-YYYY-MM-DD.md
 * - audit-output/dead-code-triage-YYYY-MM-DD.json
 *
 * Flags:
 * - --no-write: Print summary only; do not update audit-output files
 * - --max-likely-dead=N: Fail if likely-dead count exceeds N
 * - --max-wiring-candidates=N: Fail if wiring-candidate count exceeds N
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10);
const OUT_MD = join(ROOT, 'audit-output', `dead-code-triage-${TODAY}.md`);
const OUT_JSON = join(ROOT, 'audit-output', `dead-code-triage-${TODAY}.json`);

function parseArgs(argv) {
  const options = {
    write: true,
    maxLikelyDead: null,
    maxWiringCandidates: null,
  };

  for (const arg of argv) {
    if (arg === '--no-write') {
      options.write = false;
      continue;
    }
    if (arg.startsWith('--max-likely-dead=')) {
      options.maxLikelyDead = Number.parseInt(arg.split('=')[1] ?? '', 10);
      continue;
    }
    if (arg.startsWith('--max-wiring-candidates=')) {
      options.maxWiringCandidates = Number.parseInt(arg.split('=')[1] ?? '', 10);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

const OPTIONS = parseArgs(process.argv.slice(2));

const TS_PRUNE_IGNORE =
  'src/(index|cli|server|http-server|remote-server).ts|src/.*/index.ts|packages/serval-core/dist/.*|.*.test.ts';

const PUBLIC_API_FILES = new Set([
  'src/oauth-provider.ts',
  'src/server.ts',
  'src/http-server.ts',
  'src/utils/webhook-verification.ts',
  'src/security/webhook-signature.ts',
  // createAuditMiddleware is a documented factory API for integrators (used in tests + docs)
  'src/middleware/audit-middleware.ts',
]);

function isPublicApiFile(file) {
  if (PUBLIC_API_FILES.has(file)) return true;
  if (file.startsWith('src/schemas/')) return true; // exported via package "./schemas"
  return false;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf-8',
    ...options,
  });

  // rg exits with 1 when no matches; callers can opt in to accepting this.
  if (result.status !== 0 && !options.allowNonZero) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    const detail = stderr || stdout || `exit code ${result.status}`;
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }

  return result;
}

function parseTsPruneLine(line) {
  // Examples:
  // src/file.ts:123 - symbol
  // src/file.ts:123 - Symbol (used in module)
  const match = line.match(/^(.+):(\d+)\s+-\s+([^\s]+)(?:\s+\(([^)]+)\))?$/);
  if (!match) return null;
  return {
    file: match[1],
    line: Number(match[2]),
    symbol: match[3],
    note: match[4] ?? '',
  };
}

function rgSymbol(symbol) {
  const pattern = `\\b${symbol}\\b`;
  const result = run(
    'rg',
    [
      '-n',
      pattern,
      'src',
      'tests',
      'scripts',
      'docs',
      'packages',
      '-g',
      '*.ts',
      '-g',
      '*.tsx',
      '-g',
      '*.js',
      '-g',
      '*.mjs',
      '-g',
      '*.md',
      '-g',
      '!audit-output/**',
      '-g',
      '!docs/development/DELETED_MODULE_VALUE_MATRIX.md',
      '-g',
      '!docs/PRODUCTION_AUDIT.md',
      '--no-heading',
    ],
    { allowNonZero: true }
  );

  if (!result.stdout) return [];
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const first = line.indexOf(':');
      const second = line.indexOf(':', first + 1);
      if (first === -1 || second === -1) return null;
      return {
        path: line.slice(0, first),
        line: Number(line.slice(first + 1, second)),
      };
    })
    .filter(Boolean);
}

function classifyCandidate(candidate, refs) {
  const externalRefs = refs.filter((ref) => ref.path !== candidate.file);
  const runtimeRefs = externalRefs.filter(
    (ref) => ref.path.startsWith('src/') || ref.path.startsWith('packages/')
  ).length;
  const testRefs = externalRefs.filter((ref) => ref.path.startsWith('tests/')).length;
  const scriptRefs = externalRefs.filter((ref) => ref.path.startsWith('scripts/')).length;
  const docRefs = externalRefs.filter((ref) => ref.path.startsWith('docs/')).length;

  let classification = 'likely_dead';
  if (isPublicApiFile(candidate.file)) {
    classification = 'public_api';
  } else if (candidate.note === 'used in module') {
    classification = 'self_used_noise';
  } else if (runtimeRefs > 0) {
    classification = 'in_use';
  } else if (/^(reset|clear|enable|disable)/.test(candidate.symbol) && testRefs > 0) {
    classification = 'test_hook';
  } else if (scriptRefs > 0) {
    classification = 'script_in_use';
  } else if (testRefs > 0 && scriptRefs === 0 && docRefs === 0) {
    classification = 'test_only';
  } else if (docRefs > 0 || testRefs > 0) {
    classification = 'wiring_candidate';
  }

  return {
    ...candidate,
    refs: {
      externalTotal: externalRefs.length,
      runtimeRefs,
      testRefs,
      scriptRefs,
      docRefs,
    },
    classification,
  };
}

function toMarkdown(results) {
  const summary = {
    total: results.length,
    publicApi: results.filter((r) => r.classification === 'public_api').length,
    inUse: results.filter((r) => r.classification === 'in_use').length,
    selfUsedNoise: results.filter((r) => r.classification === 'self_used_noise').length,
    testHook: results.filter((r) => r.classification === 'test_hook').length,
    scriptInUse: results.filter((r) => r.classification === 'script_in_use').length,
    testOnly: results.filter((r) => r.classification === 'test_only').length,
    wiringCandidate: results.filter((r) => r.classification === 'wiring_candidate').length,
    likelyDead: results.filter((r) => r.classification === 'likely_dead').length,
  };

  const actionable = results
    .filter((r) =>
      ['public_api', 'likely_dead', 'wiring_candidate', 'test_only'].includes(r.classification)
    )
    .sort((a, b) => {
      if (a.classification === b.classification) {
        return a.file.localeCompare(b.file);
      }
      return a.classification.localeCompare(b.classification);
    });

  const lines = [
    '# Dead Code Triage Report',
    '',
    `Date: ${TODAY}`,
    '',
    '## Summary',
    '',
    `- Total candidates: ${summary.total}`,
    `- Public API surface (keep): ${summary.publicApi}`,
    `- In use (keep): ${summary.inUse}`,
    `- Self-used noise (ignore): ${summary.selfUsedNoise}`,
    `- Test hooks (keep): ${summary.testHook}`,
    `- Script/dev tooling references (keep): ${summary.scriptInUse}`,
    `- Test-only exports (review): ${summary.testOnly}`,
    `- Wiring candidates (integrate or retire): ${summary.wiringCandidate}`,
    `- Likely dead (safe-delete candidates): ${summary.likelyDead}`,
    '',
    '## Actionable Candidates',
    '',
    '| Classification | Symbol | Location | Runtime refs | Test refs | Script refs | Doc refs |',
    '|---|---|---|---:|---:|---:|---:|',
  ];

  for (const item of actionable) {
    lines.push(
      `| ${item.classification} | ${item.symbol} | ${item.file}:${item.line} | ${item.refs.runtimeRefs} | ${item.refs.testRefs} | ${item.refs.scriptRefs} | ${item.refs.docRefs} |`
    );
  }

  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push(
    '- `public_api` means symbol is in a package-exported module; remove only with explicit contract review.'
  );
  lines.push(
    '- `in_use` means cross-file runtime references exist; these are not dead and should not be removed.'
  );
  lines.push(
    '- `script_in_use` means used by scripts/CI tooling; do not remove unless the tooling path is retired.'
  );
  lines.push('- `test_hook` are usually reset/clear helpers used by tests.');
  lines.push(
    '- `wiring_candidate` means non-runtime references exist (scripts/docs/tests) with zero runtime wiring.'
  );
  lines.push('- `likely_dead` means no cross-file references outside the declaring module.');
  lines.push('');

  return lines.join('\n');
}

function main() {
  const tsPrune = run('npx', ['ts-prune', '--ignore', TS_PRUNE_IGNORE], { allowNonZero: true });
  const rawLines = (tsPrune.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed = rawLines.map(parseTsPruneLine).filter(Boolean);
  const triaged = parsed.map((candidate) => classifyCandidate(candidate, rgSymbol(candidate.symbol)));

  if (OPTIONS.write) {
    mkdirSync(join(ROOT, 'audit-output'), { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(triaged, null, 2) + '\n');
    writeFileSync(OUT_MD, toMarkdown(triaged) + '\n');
  }

  const likelyDead = triaged.filter((r) => r.classification === 'likely_dead').length;
  const wiring = triaged.filter((r) => r.classification === 'wiring_candidate').length;
  const publicApi = triaged.filter((r) => r.classification === 'public_api').length;
  const inUse = triaged.filter((r) => r.classification === 'in_use').length;
  const scriptInUse = triaged.filter((r) => r.classification === 'script_in_use').length;

  console.log(`Dead code triage complete.`);
  console.log(`- Total candidates: ${triaged.length}`);
  console.log(`- Public API surface: ${publicApi}`);
  console.log(`- In use: ${inUse}`);
  console.log(`- Script/dev tooling: ${scriptInUse}`);
  console.log(`- Wiring candidates: ${wiring}`);
  console.log(`- Likely dead: ${likelyDead}`);
  if (OPTIONS.write) {
    console.log(`- Markdown report: ${OUT_MD}`);
    console.log(`- JSON report: ${OUT_JSON}`);
  } else {
    console.log(`- Report files: skipped (--no-write)`);
  }

  const failures = [];
  if (Number.isInteger(OPTIONS.maxLikelyDead) && likelyDead > OPTIONS.maxLikelyDead) {
    failures.push(`likely-dead count ${likelyDead} exceeds max ${OPTIONS.maxLikelyDead}`);
  }
  if (
    Number.isInteger(OPTIONS.maxWiringCandidates) &&
    wiring > OPTIONS.maxWiringCandidates
  ) {
    failures.push(
      `wiring-candidate count ${wiring} exceeds max ${OPTIONS.maxWiringCandidates}`
    );
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`Dead code triage threshold failed: ${failure}`);
    }
    process.exit(1);
  }
}

main();
