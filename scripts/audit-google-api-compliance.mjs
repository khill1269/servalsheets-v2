#!/usr/bin/env node
/**
 * audit-google-api-compliance.mjs
 *
 * Google API compliance audit against Discovery API schemas.
 * Checks method name validity, required params, OAuth scopes, field mask paths,
 * pagination completeness, batch consolidation, and deprecated usage.
 *
 * Usage:
 *   node scripts/audit-google-api-compliance.mjs [--offline-ok] [--strict] [--force-refresh] [--update-snapshots]
 *
 * Exit codes:
 *   0  — no errors (or --offline-ok with no cache)
 *   1  — error findings found
 *   2  — discovery fetch failed and no cache available
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(ROOT, '.discovery-cache');
const SNAPSHOT_DIR = join(CACHE_DIR, 'snapshots');
const OUTPUT_FILE = join(ROOT, '.serval', 'google-api-compliance.json');

// ─── CLI Flags ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const OFFLINE_OK = args.includes('--offline-ok');
const STRICT = args.includes('--strict');
const FORCE_REFRESH = args.includes('--force-refresh');
const UPDATE_SNAPSHOTS = args.includes('--update-snapshots');

// ─── ANSI Colors ───────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const C = {
  red: isTTY ? '\x1b[31m' : '',
  green: isTTY ? '\x1b[32m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  blue: isTTY ? '\x1b[34m' : '',
  cyan: isTTY ? '\x1b[36m' : '',
  bold: isTTY ? '\x1b[1m' : '',
  reset: isTTY ? '\x1b[0m' : '',
  dim: isTTY ? '\x1b[2m' : '',
};

// ─── Discovery API definitions ─────────────────────────────────────────────

const APIS = [
  { name: 'sheets', version: 'v4', url: 'https://sheets.googleapis.com/$discovery/rest?version=v4' },
  { name: 'drive', version: 'v3', url: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest' },
  { name: 'bigquery', version: 'v2', url: 'https://www.googleapis.com/discovery/v1/apis/bigquery/v2/rest' },
  { name: 'script', version: 'v1', url: 'https://www.googleapis.com/discovery/v1/apis/script/v1/rest' },
];

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── Phase 1: Fetch + cache discovery docs ─────────────────────────────────

async function fetchDiscoveryDoc(api) {
  const cacheFile = join(CACHE_DIR, `google-api-${api.name}-${api.version}.json`);

  if (!FORCE_REFRESH && existsSync(cacheFile)) {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
    if (cached.fetchedAt && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      const ageDays = Math.round((Date.now() - cached.fetchedAt) / 86400000);
      console.log(`  ${C.dim}[cache hit ${ageDays}d old]${C.reset} ${api.name} ${api.version}`);
      return cached.schema;
    }
  }

  if (!existsSync(cacheFile) && OFFLINE_OK) {
    return null;
  }

  console.log(`  ${C.cyan}[fetching]${C.reset} ${api.name} ${api.version} ...`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const resp = await fetch(api.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ServalSheets/1.0 (compliance-audit)' },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    }

    const schema = await resp.json();
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify({ fetchedAt: Date.now(), schema }, null, 2));
    console.log(`  ${C.green}[cached]${C.reset} ${api.name} ${api.version}`);
    return schema;
  } catch (err) {
    clearTimeout(timeout);
    throw new Error(`Failed to fetch ${api.name} discovery doc: ${err.message}`);
  }
}

// ─── Phase 2: Build flat method inventory ──────────────────────────────────

function buildMethodInventory(apiName, schema) {
  const inventory = new Map();

  function walkResources(resources, prefix) {
    for (const [resourceName, resource] of Object.entries(resources || {})) {
      const resourcePath = prefix ? `${prefix}.${resourceName}` : resourceName;

      for (const [methodName, method] of Object.entries(resource.methods || {})) {
        const methodId = `${apiName}.${resourcePath}.${methodName}`;
        const requiredParams = [];
        const pathParams = [];

        for (const [paramName, param] of Object.entries(method.parameters || {})) {
          if (param.required) requiredParams.push(paramName);
          if (param.location === 'path') pathParams.push(paramName);
        }

        inventory.set(methodId, {
          id: method.id,
          scopes: method.scopes || [],
          requiredParams,
          pathParams,
          deprecated: method.deprecated === true,
          httpMethod: method.httpMethod,
          responseRef: method.response?.$ref,
        });
      }

      walkResources(resource.resources, resourcePath);
    }
  }

  walkResources(schema.resources, '');
  return inventory;
}

// ─── Phase 3: Scan call sites in src/ ─────────────────────────────────────

const CALL_PATTERNS = [
  { pattern: 'sheetsApi\\.spreadsheets\\.(values\\.)?\\w+\\s*\\(', api: 'sheets' },
  { pattern: 'driveApi\\.(files|revisions|permissions|comments)\\.(\\w+)\\s*\\(', api: 'drive' },
  { pattern: 'bigqueryApi\\.(datasets|tables|jobs|tabledata)\\.(\\w+)\\s*\\(', api: 'bigquery' },
  { pattern: 'scriptApi\\.(projects|deployments|processes)\\.(\\w+)\\s*\\(', api: 'script' },
];

function scanCallSites() {
  const sites = [];
  const srcDir = join(ROOT, 'src');

  for (const { pattern, api } of CALL_PATTERNS) {
    let output;
    try {
      output = execSync(
        `grep -rn --include="*.ts" -E "${pattern}" "${srcDir}"`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch {
      continue; // grep exits 1 when no matches
    }

    for (const line of output.trim().split('\n')) {
      if (!line) continue;
      // Skip lines with audit-ignore annotation
      if (line.includes('// audit-ignore')) continue;

      const match = line.match(/^(.+):(\d+):(.+)$/);
      if (!match) continue;

      const [, file, lineNum, snippet] = match;
      const relFile = file.replace(ROOT + '/', '');

      // Extract method path from snippet
      const methodMatch = snippet.match(
        /(?:sheetsApi|driveApi|bigqueryApi|scriptApi)\.([\w.]+)\s*\(/
      );
      if (!methodMatch) continue;

      const rawPath = methodMatch[1];
      const methodId = `${api}.${rawPath}`;

      sites.push({
        file: relFile,
        line: parseInt(lineNum, 10),
        methodPath: methodId,
        snippet: snippet.trim(),
        api,
      });
    }
  }

  return sites;
}

// ─── Phase 4: Checks ───────────────────────────────────────────────────────

function runChecks(inventories, callSites, allSchemas, scopeConfig) {
  const findings = [];

  function addFinding(severity, checkId, file, line, methodPath, message, detail, suggestedFix) {
    findings.push({ severity, checkId, file, line, methodPath, message, detail, suggestedFix });
  }

  // C1: Method name validity
  for (const site of callSites) {
    if (!inventories.has(site.methodPath)) {
      // Check if it's a known alias or variant
      const base = site.methodPath;
      const alternatives = [...inventories.keys()].filter((k) =>
        k.startsWith(site.api + '.') && k.endsWith('.' + base.split('.').pop())
      );
      addFinding(
        'error', 'C1',
        site.file, site.line, site.methodPath,
        `Method '${site.methodPath}' not found in Discovery API inventory`,
        `Snippet: ${site.snippet}`,
        alternatives.length > 0 ? `Possible matches: ${alternatives.slice(0, 3).join(', ')}` : undefined
      );
    }
  }

  // C2: Required params (downgrade to info if dynamic args)
  for (const site of callSites) {
    const method = inventories.get(site.methodPath);
    if (!method) continue;

    const hasDynamicArgs = site.snippet.includes('...') || site.snippet.includes('params');
    if (hasDynamicArgs) continue;

    for (const required of method.requiredParams) {
      if (!site.snippet.includes(required)) {
        addFinding(
          'info', 'C2',
          site.file, site.line, site.methodPath,
          `Required param '${required}' may be missing at call site`,
          `Snippet: ${site.snippet}`,
          `Add '${required}' to the API call parameters`
        );
      }
    }
  }

  // C3: OAuth scope accuracy — check that required scopes are declared
  if (scopeConfig) {
    const declaredScopes = new Set([
      ...scopeConfig.FULL_ACCESS_SCOPES,
      ...scopeConfig.STANDARD_SCOPES,
    ]);

    for (const [methodId, method] of inventories) {
      for (const scope of method.scopes) {
        // Only check scopes for methods we actually call
        const called = callSites.some((s) => s.methodPath === methodId);
        if (!called) continue;

        if (!declaredScopes.has(scope)) {
          addFinding(
            'error', 'C3',
            'src/config/oauth-scopes.ts', 0, methodId,
            `Scope '${scope}' required by '${methodId}' is not in FULL_ACCESS_SCOPES or STANDARD_SCOPES`,
            `Method requires: ${method.scopes.join(', ')}`,
            `Add '${scope}' to the appropriate scope array in src/config/oauth-scopes.ts`
          );
        }
      }
    }

    // C3b: Unused declared scopes
    for (const scope of scopeConfig.FULL_ACCESS_SCOPES) {
      const isUsed = [...inventories.values()].some((m) => m.scopes.includes(scope));
      if (!isUsed) {
        addFinding(
          'warning', 'C3b',
          'src/config/oauth-scopes.ts', 0, '',
          `Scope '${scope}' in FULL_ACCESS_SCOPES matches no inventory method`,
          'This scope may be for a resource API (Drive Activity, Labels) not covered by discovery docs',
          undefined
        );
      }
    }
  }

  // C4: Field mask paths — check segments resolve in Sheets schema
  const sheetsSchema = allSchemas.get('sheets');
  if (sheetsSchema) {
    const spreadsheetSchema = sheetsSchema.schemas?.['Spreadsheet'];
    if (spreadsheetSchema) {
      const fieldMasksFile = join(ROOT, 'src', 'constants', 'field-masks.ts');
      if (existsSync(fieldMasksFile)) {
        const content = readFileSync(fieldMasksFile, 'utf8');
        const maskMatches = content.matchAll(/:\s*'([^']+)'/g);
        for (const [, mask] of maskMatches) {
          const topSegments = mask.split(',').map((s) => s.trim().split('(')[0].split('/')[0]);
          for (const seg of topSegments) {
            if (!seg) continue;
            const fieldName = seg.trim();
            if (fieldName && spreadsheetSchema.properties && !spreadsheetSchema.properties[fieldName]) {
              // Allow known aliases
              const knownAliases = ['spreadsheetId', 'properties', 'sheets', 'namedRanges',
                'developerMetadata', 'spreadsheetUrl'];
              if (!knownAliases.includes(fieldName)) {
                addFinding(
                  'warning', 'C4',
                  'src/config/field-masks.ts', 0, '',
                  `Field mask segment '${fieldName}' not found in Spreadsheet schema`,
                  `Full mask: ${mask}`,
                  undefined
                );
              }
            }
          }
        }
      }
    }
  }

  // C5: Pagination completeness — paginated list methods lacking nextPageToken handling
  const PAGINATED_METHODS = [
    'sheets.spreadsheets.values.batchGet',
    'drive.files.list', 'drive.revisions.list', 'drive.permissions.list',
    'bigquery.tables.list', 'bigquery.datasets.list', 'bigquery.jobs.list',
    'script.processes.list',
  ];

  const sourceFiles = new Map();
  for (const site of callSites) {
    if (!PAGINATED_METHODS.some((m) => site.methodPath.includes(m.split('.').pop()))) continue;
    if (!sourceFiles.has(site.file)) {
      const fullPath = join(ROOT, site.file);
      if (existsSync(fullPath)) {
        sourceFiles.set(site.file, readFileSync(fullPath, 'utf8').split('\n'));
      }
    }

    const lines = sourceFiles.get(site.file);
    if (!lines) continue;

    const start = Math.max(0, site.line - 25);
    const end = Math.min(lines.length, site.line + 25);
    const window = lines.slice(start, end).join('\n');

    if (!window.includes('nextPageToken') && !window.includes('pageToken')) {
      addFinding(
        'warning', 'C5',
        site.file, site.line, site.methodPath,
        `Paginated method '${site.methodPath}' lacks nextPageToken handling nearby (50-line window)`,
        'List methods may return incomplete results without pagination',
        'Add nextPageToken loop: while (pageToken) { ...; pageToken = response.nextPageToken; }'
      );
    }
  }

  // C6: Batch consolidation — 3+ consecutive values.update in same file
  const updatesByFile = new Map();
  for (const site of callSites) {
    if (!site.methodPath.endsWith('.values.update') && !site.snippet.includes('values.update')) continue;
    const list = updatesByFile.get(site.file) || [];
    list.push(site.line);
    updatesByFile.set(site.file, list);
  }

  for (const [file, lines] of updatesByFile) {
    lines.sort((a, b) => a - b);
    for (let i = 0; i <= lines.length - 3; i++) {
      if (lines[i + 2] - lines[i] <= 50) {
        addFinding(
          'info', 'C6',
          file, lines[i], 'sheets.spreadsheets.values.update',
          `3+ consecutive values.update calls in same file within 50 lines`,
          `Lines: ${lines.slice(i, i + 3).join(', ')}`,
          'Consider using spreadsheets.values.batchUpdate to consolidate into a single API call'
        );
        break; // Only report once per file
      }
    }
  }

  // C7: Deprecated detection
  for (const site of callSites) {
    const method = inventories.get(site.methodPath);
    if (method?.deprecated) {
      addFinding(
        'warning', 'C7',
        site.file, site.line, site.methodPath,
        `Method '${site.methodPath}' is marked as deprecated in the Discovery API`,
        `Snippet: ${site.snippet}`,
        'Check the Google API documentation for the replacement method'
      );
    }
  }

  return findings;
}

// ─── Phase 5: Output ───────────────────────────────────────────────────────

function printFindings(findings, inventoryAvailable) {
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const infos = findings.filter((f) => f.severity === 'info');

  const severityColor = { error: C.red, warning: C.yellow, info: C.blue };
  const severityIcon = { error: '✗', warning: '⚠', info: 'ℹ' };

  for (const severity of ['error', 'warning', 'info']) {
    const group = findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;

    console.log(`\n${severityColor[severity]}${C.bold}${severity.toUpperCase()} (${group.length})${C.reset}`);
    for (const f of group) {
      const loc = f.file ? `${f.file}:${f.line}` : 'config';
      console.log(`  ${severityColor[severity]}${severityIcon[severity]}${C.reset} [${f.checkId}] ${f.message}`);
      console.log(`    ${C.dim}${loc}${C.reset}`);
      if (f.suggestedFix) {
        console.log(`    ${C.green}→ ${f.suggestedFix}${C.reset}`);
      }
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  if (!inventoryAvailable) {
    console.log(`${C.yellow}SKIPPED${C.reset} — Discovery docs unavailable (offline mode)`);
    console.log('Run without --offline-ok to fetch live discovery docs');
  } else {
    console.log(
      `${errors.length > 0 ? C.red : C.green}${errors.length} error(s)${C.reset}  ` +
      `${C.yellow}${warnings.length} warning(s)${C.reset}  ` +
      `${C.blue}${infos.length} info${C.reset}`
    );
  }
}

function writeOutput(findings, discoveryAge, inventoryAvailable) {
  const summary = {
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
    infos: findings.filter((f) => f.severity === 'info').length,
  };

  const output = {
    generatedAt: new Date().toISOString(),
    discoveryAge,
    inventoryAvailable,
    summary,
    findings,
  };

  mkdirSync(join(ROOT, '.serval'), { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${C.bold}Google API Compliance Audit${C.reset}`);
  console.log('═'.repeat(50));

  // Phase 1: Fetch discovery docs
  console.log(`\n${C.bold}Phase 1:${C.reset} Discovery docs`);
  const schemas = new Map();
  const discoveryAge = {};
  let inventoryAvailable = true;
  let fetchFailed = false;

  for (const api of APIS) {
    try {
      const schema = await fetchDiscoveryDoc(api);
      if (schema === null) {
        console.log(`  ${C.yellow}[skipped]${C.reset} ${api.name} ${api.version} (no cache, offline-ok)`);
        inventoryAvailable = false;
      } else {
        schemas.set(api.name, schema);
        const cacheFile = join(CACHE_DIR, `google-api-${api.name}-${api.version}.json`);
        const cached = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : null;
        discoveryAge[api.name] = cached?.fetchedAt
          ? `${Math.round((Date.now() - cached.fetchedAt) / 86400000)}d`
          : 'fresh';
      }
    } catch (err) {
      console.error(`  ${C.red}[failed]${C.reset} ${api.name}: ${err.message}`);
      fetchFailed = true;
      inventoryAvailable = false;
    }
  }

  if (fetchFailed && schemas.size === 0) {
    if (OFFLINE_OK) {
      console.log(`\n${C.yellow}SKIPPED${C.reset} — all discovery fetches failed, offline-ok mode`);
      writeOutput([], discoveryAge, false);
      process.exit(0);
    }
    process.exit(2);
  }

  // Phase 2: Build method inventory
  console.log(`\n${C.bold}Phase 2:${C.reset} Building method inventory`);
  const inventories = new Map();

  for (const [apiName, schema] of schemas) {
    const inv = buildMethodInventory(apiName, schema);
    for (const [k, v] of inv) inventories.set(k, v);
    console.log(`  ${C.green}✓${C.reset} ${apiName}: ${inv.size} methods`);
  }

  // Write snapshots if requested
  if (UPDATE_SNAPSHOTS) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    for (const [apiName, schema] of schemas) {
      const api = APIS.find((a) => a.name === apiName);
      const snapshotFile = join(SNAPSHOT_DIR, `${apiName}-${api.version}.snapshot.json`);
      const inv = buildMethodInventory(apiName, schema);
      writeFileSync(snapshotFile, JSON.stringify({
        generatedAt: new Date().toISOString(),
        api: apiName,
        version: api.version,
        batchPath: schema.batchPath,
        authScopes: Object.keys(schema.auth?.oauth2?.scopes || {}),
        methodCount: inv.size,
        methods: Object.fromEntries(inv),
        topLevelSchemas: Object.keys(schema.schemas || {}),
      }, null, 2));
      console.log(`  ${C.cyan}[snapshot]${C.reset} wrote ${snapshotFile}`);
    }
  }

  // Phase 3: Scan call sites
  console.log(`\n${C.bold}Phase 3:${C.reset} Scanning src/ for API call sites`);
  let callSites = [];

  if (inventoryAvailable) {
    callSites = scanCallSites();
    console.log(`  Found ${callSites.length} call sites`);
  } else {
    console.log(`  ${C.yellow}Skipped${C.reset} (no inventory available)`);
  }

  // Phase 4: Run checks
  console.log(`\n${C.bold}Phase 4:${C.reset} Running compliance checks`);

  // Load scope config for C3 check
  let scopeConfig = null;
  try {
    const scopeFile = join(ROOT, 'src', 'config', 'oauth-scopes.ts');
    if (existsSync(scopeFile)) {
      const content = readFileSync(scopeFile, 'utf8');
      const extractArray = (varName) => {
        const match = content.match(new RegExp(`${varName}\\s*=\\s*\\[([^\\]]+)\\]`, 's'));
        if (!match) return [];
        return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      };
      scopeConfig = {
        FULL_ACCESS_SCOPES: extractArray('FULL_ACCESS_SCOPES'),
        STANDARD_SCOPES: extractArray('STANDARD_SCOPES'),
      };
    }
  } catch { /* ignore */ }

  const findings = inventoryAvailable
    ? runChecks(inventories, callSites, schemas, scopeConfig)
    : [];

  if (STRICT) {
    for (const f of findings) {
      if (f.severity === 'warning') f.severity = 'error';
    }
  }

  // Phase 5: Output
  console.log(`\n${C.bold}Phase 5:${C.reset} Results`);
  printFindings(findings, inventoryAvailable);
  writeOutput(findings, discoveryAge, inventoryAvailable);
  console.log(`\n${C.dim}Report: .serval/google-api-compliance.json${C.reset}`);

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${C.red}Fatal error:${C.reset}`, err.message);
  process.exit(2);
});
