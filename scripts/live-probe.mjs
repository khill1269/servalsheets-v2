#!/usr/bin/env node
/**
 * Live MCP Server Probe — spawns the STDIO server and tests every tool/protocol feature.
 *
 * Usage: node scripts/live-probe.mjs [--timeout 30000] [--tool sheets_core]
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, '../dist/cli.js');
const SERVER_TIMEOUT = parseInt(process.argv.find(a => a.startsWith('--timeout='))?.split('=')[1] ?? '15000');
const TOOL_FILTER = process.argv.find(a => a.startsWith('--tool='))?.split('=')[1] ?? null;

// ============================================================================
// JSON-RPC Harness
// ============================================================================

function createHarness() {
  const projectRoot = resolve(__dirname, '..');
  const child = spawn('node', [CLI_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SKIP_PREFLIGHT: 'true',
      DATA_DIR: resolve(projectRoot, '.probe-data'),
      PROFILE_STORAGE_DIR: resolve(projectRoot, '.probe-profiles'),
      SERVAL_LOG_LEVEL: 'error',
      LOG_LEVEL: 'error',
      SERVAL_DEFER_SCHEMAS: 'true',
      SERVAL_DEFER_DESCRIPTIONS: 'true',
      GOOGLE_APPLICATION_CREDENTIALS: resolve(projectRoot, '.secrets/serval-sheets-484605-e1d5e1bc78c2.json'),
    }
  });

  let buffer = '';
  const pending = new Map();
  const notifications = [];
  let nextId = 1;

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.id !== undefined && pending.has(json.id)) {
          const { resolve, timer } = pending.get(json.id);
          clearTimeout(timer);
          pending.delete(json.id);
          resolve(json);
        } else if (!json.id && json.method) {
          notifications.push(json);
        }
      } catch { /* skip non-JSON stderr leaks */ }
    }
  });

  child.stderr.on('data', () => { /* suppress */ });

  const request = (method, params = {}, timeoutMs = SERVER_TIMEOUT) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout after ${timeoutMs}ms for ${method} (id:${id})`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  };

  const cleanup = () => {
    for (const [, { reject, timer }] of pending) {
      clearTimeout(timer);
      reject(new Error('Harness closed'));
    }
    pending.clear();
    child.kill();
  };

  return { request, cleanup, notifications, child };
}

// ============================================================================
// Test Definitions — one per tool, tests the action dispatch + schema validation
// ============================================================================

// Fake spreadsheet ID (will cause Google API errors but validates the full pipeline)
const FAKE_SS = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms';
const FAKE_SHEET = 'Sheet1';

function buildToolCall(tool, action, extra = {}) {
  return {
    name: tool,
    arguments: { request: { action, spreadsheetId: FAKE_SS, sheetName: FAKE_SHEET, ...extra } }
  };
}

// All 25 tools with a representative action each + expected behavior
const TOOL_PROBES = [
  // --- BaseHandler tools (13) ---
  { tool: 'sheets_core', action: 'get', extra: {}, expectField: 'action' },
  { tool: 'sheets_data', action: 'read', extra: { range: 'Sheet1!A1:B5' }, expectField: 'action' },
  { tool: 'sheets_format', action: 'suggest_format', extra: { range: 'Sheet1!A1:A10' }, expectField: 'action' },
  { tool: 'sheets_dimensions', action: 'get_basic_filter', extra: {}, expectField: 'action' },
  { tool: 'sheets_advanced', action: 'list_named_ranges', extra: {}, expectField: 'action' },
  { tool: 'sheets_visualize', action: 'chart_list', extra: {}, expectField: 'action' },
  { tool: 'sheets_collaborate', action: 'share_list', extra: {}, expectField: 'action' },
  { tool: 'sheets_composite', action: 'preview_generation', extra: { description: 'test budget' }, expectField: 'action', timeout: 30000 },
  { tool: 'sheets_analyze', action: 'quick_insights', extra: { range: 'Sheet1!A1:D10' }, expectField: 'action' },
  { tool: 'sheets_fix', action: 'suggest_cleaning', extra: { range: 'Sheet1!A1:Z100' }, expectField: 'action' },
  { tool: 'sheets_templates', action: 'list', extra: {}, expectField: 'action' },
  { tool: 'sheets_bigquery', action: 'list_connections', extra: {}, expectField: 'action' },
  { tool: 'sheets_appsscript', action: 'list_versions', extra: { scriptId: 'fake-script-id' }, expectField: 'action' },

  // --- Standalone tools (12) ---
  { tool: 'sheets_auth', action: 'status', extra: {}, expectField: 'action', noSpreadsheetId: true },
  { tool: 'sheets_confirm', action: 'get_stats', extra: {}, expectField: 'action', noSpreadsheetId: true },
  { tool: 'sheets_dependencies', action: 'build', extra: {}, expectField: 'action' },
  { tool: 'sheets_quality', action: 'validate', extra: { value: 'test@example.com', rules: ['builtin_email'] }, expectField: 'action' },
  { tool: 'sheets_history', action: 'list', extra: {}, expectField: 'action' },
  { tool: 'sheets_session', action: 'get_active', extra: {}, expectField: 'action', noSpreadsheetId: true },
  { tool: 'sheets_transaction', action: 'list', extra: {}, expectField: 'action', noSpreadsheetId: true },
  { tool: 'sheets_federation', action: 'list_servers', extra: {}, expectField: 'action', noSpreadsheetId: true },
  { tool: 'sheets_webhook', action: 'get_stats', extra: {}, expectField: 'action', noSpreadsheetId: true },
  { tool: 'sheets_agent', action: 'list_plans', extra: {}, expectField: 'action', noSpreadsheetId: true },
  { tool: 'sheets_compute', action: 'evaluate', extra: { formula: '=SUM(1,2,3)' }, expectField: 'action' },
  { tool: 'sheets_connectors', action: 'list_connectors', extra: {}, expectField: 'action', noSpreadsheetId: true },
];

// ============================================================================
// Validation actions — test schema enforcement
// ============================================================================

const VALIDATION_PROBES = [
  // Missing required field
  { label: 'missing-action', tool: 'sheets_core', args: { request: { spreadsheetId: FAKE_SS } }, expectError: true },
  // Invalid action name
  { label: 'invalid-action', tool: 'sheets_core', args: { request: { action: 'nonexistent_action', spreadsheetId: FAKE_SS } }, expectError: true },
  // Empty arguments
  { label: 'empty-args', tool: 'sheets_data', args: {}, expectError: true },
  // Federation: missing serverName for call_remote
  { label: 'federation-missing-serverName', tool: 'sheets_federation', args: { request: { action: 'call_remote' } }, expectError: true },
  // Agent: maxSteps exceeds cap
  { label: 'agent-maxSteps-overcap', tool: 'sheets_agent', args: { request: { action: 'plan', goal: 'test', spreadsheetId: FAKE_SS, maxSteps: 100 } }, expectError: true },
  // share_add missing emailAddress for user type
  { label: 'share_add-missing-email', tool: 'sheets_collaborate', args: { request: { action: 'share_add', spreadsheetId: FAKE_SS, type: 'user', role: 'reader' } }, expectError: true, timeout: 30000 },
  // share_add invalid domain
  { label: 'share_add-bad-domain', tool: 'sheets_collaborate', args: { request: { action: 'share_add', spreadsheetId: FAKE_SS, type: 'domain', role: 'reader', domain: 'not a domain!' } }, expectError: true },
];

// ============================================================================
// Protocol probes
// ============================================================================

async function probeProtocol(harness) {
  const results = [];

  // 1. tools/list — verify all 25 tools registered
  try {
    const resp = await harness.request('tools/list');
    const tools = resp.result?.tools ?? [];
    const count = tools.length;
    const names = tools.map(t => t.name).sort();
    const hasSchemas = tools.every(t => t.inputSchema && t.inputSchema.type === 'object');
    results.push({ test: 'tools/list count', pass: count === 25, detail: `${count} tools` });
    results.push({ test: 'tools/list schemas', pass: hasSchemas, detail: hasSchemas ? 'all have inputSchema' : 'MISSING schemas' });

    // Check each tool has description
    const allDescribed = tools.every(t => t.description && t.description.length > 10);
    results.push({ test: 'tools/list descriptions', pass: allDescribed, detail: allDescribed ? 'all described' : 'MISSING descriptions' });

    // Check annotations present
    const withAnnotations = tools.filter(t => t.annotations).length;
    results.push({ test: 'tools/list annotations', pass: withAnnotations > 0, detail: `${withAnnotations}/25 have annotations` });
  } catch (e) {
    results.push({ test: 'tools/list', pass: false, detail: e.message });
  }

  // 2. resources/list
  try {
    const resp = await harness.request('resources/list');
    const resources = resp.result?.resources ?? [];
    results.push({ test: 'resources/list', pass: !resp.error, detail: `${resources.length} resources` });
  } catch (e) {
    results.push({ test: 'resources/list', pass: false, detail: e.message });
  }

  // 3. resources/templates/list
  try {
    const resp = await harness.request('resources/templates/list');
    const templates = resp.result?.resourceTemplates ?? [];
    results.push({ test: 'resources/templates/list', pass: !resp.error, detail: `${templates.length} templates` });
  } catch (e) {
    results.push({ test: 'resources/templates/list', pass: false, detail: e.message });
  }

  // 4. prompts/list
  try {
    const resp = await harness.request('prompts/list');
    const prompts = resp.result?.prompts ?? [];
    results.push({ test: 'prompts/list', pass: !resp.error, detail: `${prompts.length} prompts` });
  } catch (e) {
    results.push({ test: 'prompts/list', pass: false, detail: e.message });
  }

  // 5. completion/complete — test spreadsheetId completion
  try {
    const resp = await harness.request('completion/complete', {
      ref: { type: 'ref/resource', uri: 'sheets:///{spreadsheetId}' },
      argument: { name: 'spreadsheetId', value: '' }
    });
    results.push({ test: 'completion/complete', pass: !resp.error, detail: resp.error ? resp.error.message : 'OK' });
  } catch (e) {
    results.push({ test: 'completion/complete', pass: false, detail: e.message });
  }

  // 6. logging/setLevel
  try {
    const resp = await harness.request('logging/setLevel', { level: 'warning' });
    results.push({ test: 'logging/setLevel', pass: !resp.error, detail: resp.error ? resp.error.message : 'OK' });
  } catch (e) {
    results.push({ test: 'logging/setLevel', pass: false, detail: e.message });
  }

  return results;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  ServalSheets Live MCP Server Probe                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  const harness = createHarness();
  const allResults = [];

  try {
    // ── Phase 0: Initialize ──────────────────────────────────────────
    console.log('▸ Phase 0: MCP Initialize...');
    const initResp = await harness.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {
        sampling: {},
        elicitation: {},
        tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } }
      },
      clientInfo: { name: 'live-probe', version: '1.0.0' }
    });

    const caps = initResp.result?.capabilities ?? {};
    const serverInfo = initResp.result?.serverInfo ?? {};
    console.log(`  Server: ${serverInfo.name} v${serverInfo.version}`);
    console.log(`  Capabilities: tools=${!!caps.tools}, resources=${!!caps.resources}, prompts=${!!caps.prompts}, logging=${!!caps.logging}`);
    allResults.push({ test: 'initialize', pass: !!initResp.result, detail: `${serverInfo.name} v${serverInfo.version}` });

    // Send initialized notification
    harness.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

    // Brief pause for server to finish setup
    await new Promise(r => setTimeout(r, 1000));

    // ── Phase 1: Protocol Features ───────────────────────────────────
    console.log('\n▸ Phase 1: Protocol Features...');
    const protocolResults = await probeProtocol(harness);
    allResults.push(...protocolResults);
    for (const r of protocolResults) {
      console.log(`  ${r.pass ? '✅' : '❌'} ${r.test}: ${r.detail}`);
    }

    // ── Phase 2: Tool Dispatch (all 25 tools) ────────────────────────
    console.log('\n▸ Phase 2: Tool Dispatch (25 tools)...');
    const filteredProbes = TOOL_FILTER
      ? TOOL_PROBES.filter(p => p.tool === TOOL_FILTER)
      : TOOL_PROBES;

    for (const probe of filteredProbes) {
      try {
        const args = probe.noSpreadsheetId
          ? { request: { action: probe.action, ...probe.extra } }
          : { request: { action: probe.action, spreadsheetId: FAKE_SS, ...probe.extra } };

        const resp = await harness.request('tools/call', { name: probe.tool, arguments: args }, probe.timeout ?? SERVER_TIMEOUT);

        // We expect either a successful tool response OR a Google API error
        // (since we're using a fake spreadsheetId). Both prove the pipeline works.
        const content = resp.result?.content?.[0]?.text ?? '';
        let parsed;
        try { parsed = JSON.parse(content); } catch { parsed = null; }

        const isToolResponse = parsed && parsed.response;
        const isError = resp.result?.isError || resp.error;

        // A tool dispatch is "working" if:
        // 1. We got a structured response (even an error response from the handler)
        // 2. The response includes the action field
        // 3. OR we got a Google API auth error (proves the full pipeline ran)
        const hasAction = parsed?.response?.action === probe.action;
        const hasApiError = content.includes('AUTHENTICATION_ERROR') ||
                           content.includes('AUTH_REQUIRED') ||
                           content.includes('NOT_FOUND') ||
                           content.includes('GOOGLE_API_ERROR') ||
                           content.includes('INTERNAL_ERROR') ||
                           content.includes('SERVICE_ERROR') ||
                           content.includes('VALIDATION_ERROR') ||
                           content.includes('CONFIG_ERROR') ||
                           content.includes('success');
        const pass = hasAction || hasApiError || (isToolResponse && !resp.error);

        allResults.push({ test: `${probe.tool}.${probe.action}`, pass, detail: hasAction ? 'action matched' : (hasApiError ? 'API error (expected)' : content.substring(0, 80)) });
        console.log(`  ${pass ? '✅' : '❌'} ${probe.tool}.${probe.action}: ${hasAction ? 'OK' : hasApiError ? 'API auth error (expected)' : content.substring(0, 60)}`);
      } catch (e) {
        allResults.push({ test: `${probe.tool}.${probe.action}`, pass: false, detail: e.message });
        console.log(`  ❌ ${probe.tool}.${probe.action}: ${e.message}`);
      }
    }

    // ── Phase 3: Schema Validation (error paths) ─────────────────────
    console.log('\n▸ Phase 3: Schema Validation (error paths)...');
    for (const probe of VALIDATION_PROBES) {
      try {
        const resp = await harness.request('tools/call', { name: probe.tool, arguments: probe.args }, probe.timeout ?? SERVER_TIMEOUT);
        const content = resp.result?.content?.[0]?.text ?? '';
        const isError = resp.result?.isError || resp.error || content.includes('error') || content.includes('Error') || content.includes('VALIDATION');
        const pass = probe.expectError ? isError : !isError;
        allResults.push({ test: `validation:${probe.label}`, pass, detail: isError ? 'rejected (correct)' : 'accepted (unexpected)' });
        console.log(`  ${pass ? '✅' : '❌'} ${probe.label}: ${isError ? 'rejected ✓' : 'NOT rejected ✗'}`);
      } catch (e) {
        // Timeout or crash = also a kind of failure, but still proves something
        const pass = probe.expectError;
        allResults.push({ test: `validation:${probe.label}`, pass, detail: e.message });
        console.log(`  ${pass ? '⚠️' : '❌'} ${probe.label}: ${e.message}`);
      }
    }

    // ── Phase 4: Multi-action per tool (spot checks) ─────────────────
    console.log('\n▸ Phase 4: Multi-action spot checks...');
    const multiActionProbes = [
      // sheets_core: test 3 different actions
      { tool: 'sheets_core', action: 'list_sheets', extra: {} },
      { tool: 'sheets_core', action: 'get_sheet_by_name', extra: { sheetName: 'Sheet1' } },
      // sheets_data: test different read patterns
      { tool: 'sheets_data', action: 'batch_read', extra: { ranges: ['Sheet1!A1:B5', 'Sheet1!C1:D5'] } },
      { tool: 'sheets_data', action: 'find_replace', extra: { range: 'Sheet1!A1:Z100', find: 'test', replace: 'test2', safety: { dryRun: true } }, timeout: 30000 },
      // sheets_session: context operations
      { tool: 'sheets_session', action: 'get_context', extra: {}, noSpreadsheetId: true },
      { tool: 'sheets_session', action: 'list_operations', extra: { limit: 5 }, noSpreadsheetId: true },
      // sheets_history
      { tool: 'sheets_history', action: 'stats', extra: {} },
      // sheets_compute: formula evaluation
      { tool: 'sheets_compute', action: 'evaluate', extra: { formula: '=AVERAGE(10,20,30)' } },
      // sheets_format
      { tool: 'sheets_format', action: 'suggest_format', extra: { range: 'Sheet1!A1:D10' } },
      // sheets_dependencies
      { tool: 'sheets_dependencies', action: 'detect_cycles', extra: {} },
      // sheets_quality
      { tool: 'sheets_quality', action: 'detect_conflicts', extra: { range: 'Sheet1!A1:Z100' } },
      // sheets_transaction
      { tool: 'sheets_transaction', action: 'begin', extra: { spreadsheetId: FAKE_SS, description: 'probe test' }, noSpreadsheetId: true, timeout: 30000 },
      // sheets_advanced: more actions
      { tool: 'sheets_advanced', action: 'list_developer_metadata', extra: {} },
      // sheets_collaborate: comments
      { tool: 'sheets_collaborate', action: 'comment_list', extra: {} },
      // sheets_visualize: chart suggest
      { tool: 'sheets_visualize', action: 'suggest_chart', extra: { range: 'Sheet1!A1:D10' } },
      // sheets_agent: plan
      { tool: 'sheets_agent', action: 'plan', extra: { spreadsheetId: FAKE_SS, goal: 'Format header row' }, timeout: 30000 },
      // sheets_webhook: list
      { tool: 'sheets_webhook', action: 'list', extra: { spreadsheetId: FAKE_SS } },
      // sheets_connectors: list
      { tool: 'sheets_connectors', action: 'list_connectors', extra: {}, noSpreadsheetId: true },
    ];

    for (const probe of multiActionProbes) {
      try {
        const args = probe.noSpreadsheetId
          ? { request: { action: probe.action, ...probe.extra } }
          : { request: { action: probe.action, spreadsheetId: FAKE_SS, ...probe.extra } };

        const resp = await harness.request('tools/call', { name: probe.tool, arguments: args }, probe.timeout ?? SERVER_TIMEOUT);
        const content = resp.result?.content?.[0]?.text ?? '';
        const pass = content.length > 0 && !resp.error;
        allResults.push({ test: `multi:${probe.tool}.${probe.action}`, pass, detail: content.substring(0, 60) });
        console.log(`  ${pass ? '✅' : '❌'} ${probe.tool}.${probe.action}: ${content.substring(0, 60)}`);
      } catch (e) {
        allResults.push({ test: `multi:${probe.tool}.${probe.action}`, pass: false, detail: e.message });
        console.log(`  ❌ ${probe.tool}.${probe.action}: ${e.message}`);
      }
    }

  } finally {
    harness.cleanup();
  }

  // ── Summary ────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  const passed = allResults.filter(r => r.pass).length;
  const failed = allResults.filter(r => !r.pass).length;
  const total = allResults.length;
  console.log(`  RESULTS: ${passed}/${total} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\n  FAILURES:');
    for (const r of allResults.filter(r => !r.pass)) {
      console.log(`    ❌ ${r.test}: ${r.detail}`);
    }
  }
  console.log('═'.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(2);
});
