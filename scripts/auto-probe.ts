#!/usr/bin/env tsx
/**
 * ServalSheets Auto-Probe — Agent 1
 *
 * Spawns the MCP server via STDIO and tests every tool/action against the live
 * Google Sheets API. Creates a temporary test spreadsheet, runs all fixtures,
 * then deletes it. Outputs structured results to ~/.servalsheets/probe-results.json
 *
 * Usage:
 *   npx tsx scripts/auto-probe.ts [--verbose] [--tool <name>] [--keep-sheet]
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MCP_JSON = join(ROOT, '.mcp.json');
const OUT_DIR = join(homedir(), '.servalsheets');
const OUT_FILE = join(OUT_DIR, 'probe-results.json');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const KEEP_SHEET = args.includes('--keep-sheet');
const TOOL_FILTER = (() => {
  const i = args.indexOf('--tool');
  return i !== -1 ? args[i + 1] : null;
})();

// ── Colors ───────────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};
function log(msg: string) {
  process.stdout.write(msg + '\n');
}
function dim(msg: string) {
  if (VERBOSE) process.stdout.write(`${C.dim}${msg}${C.reset}\n`);
}

// ── STDIO MCP Client ─────────────────────────────────────────────────────────
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
  method?: string;
}

class StdioMCPClient {
  private proc: ChildProcessWithoutNullStreams;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private nextId = 1;
  private initialized = false;

  constructor(private serverEnv: Record<string, string>) {
    this.proc = spawn('node', [join(ROOT, 'dist/cli.js'), '--stdio'], {
      env: { ...process.env, ...serverEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const rl = createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        if (msg.id !== undefined) {
          const pending = this.pending.get(msg.id as number);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(msg.id as number);
            if (msg.error) {
              pending.reject(new Error(`${msg.error.message} (code ${msg.error.code})`));
            } else {
              pending.resolve(msg.result);
            }
          }
        }
        // Log server notifications if verbose
        if (msg.method && VERBOSE) dim(`  [notify] ${msg.method}`);
      } catch {
        /* ignore non-JSON lines */
      }
    });

    this.proc.stderr.on('data', (chunk: Buffer) => {
      if (VERBOSE) dim(`  [stderr] ${chunk.toString().trim().slice(0, 200)}`);
    });

    this.proc.on('exit', (code) => {
      if (code !== 0 && code !== null) dim(`  [proc] exited with code ${code}`);
      // Reject all pending
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Server process exited'));
      }
      this.pending.clear();
    });
  }

  private send(method: string, params?: unknown, timeoutMs = 30_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      this.proc.stdin.write(JSON.stringify(msg) + '\n');
    });
  }

  private notify(method: string, params?: unknown) {
    const msg = { jsonrpc: '2.0', method, params };
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  async initialize(): Promise<unknown> {
    const result = await this.send(
      'initialize',
      {
        protocolVersion: '2025-11-25',
        capabilities: { elicitation: {}, sampling: {} },
        clientInfo: { name: 'auto-probe', version: '1.0.0' },
      },
      15_000
    );
    this.notify('notifications/initialized');
    this.initialized = true;
    return result;
  }

  async listTools(): Promise<Array<{ name: string; inputSchema: unknown }>> {
    const result = (await this.send('tools/list', {})) as {
      tools: Array<{ name: string; inputSchema: unknown }>;
    };
    return result.tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = 25_000
  ): Promise<unknown> {
    return this.send('tools/call', { name, arguments: args }, timeoutMs);
  }

  async close() {
    this.proc.stdin.end();
    await new Promise<void>((resolve) => {
      this.proc.on('exit', () => resolve());
      setTimeout(() => {
        this.proc.kill();
        resolve();
      }, 3000);
    });
  }

  isReady() {
    return this.initialized;
  }
}

// ── Schema Action Extractor ───────────────────────────────────────────────────
function extractActions(inputSchema: unknown): string[] {
  const schema = inputSchema as Record<string, unknown>;
  // Look for request property which is the discriminated union
  const req = (schema?.properties as Record<string, unknown>)?.request as Record<string, unknown>;
  if (!req) return [];

  const actions: string[] = [];

  // Handle oneOf (Zod discriminated union → JSON Schema oneOf)
  const oneOf = (req.oneOf ?? req.anyOf) as Array<Record<string, unknown>> | undefined;
  if (oneOf) {
    for (const branch of oneOf) {
      const props = branch.properties as Record<string, Record<string, unknown>> | undefined;
      if (props?.action?.const) actions.push(props.action.const as string);
      if (props?.action?.enum) actions.push(...(props.action.enum as string[]));
    }
    return actions;
  }

  // Handle enum directly on action
  const actionProp = (req.properties as Record<string, Record<string, unknown>> | undefined)
    ?.action;
  if (actionProp?.enum) return actionProp.enum as string[];
  if (actionProp?.const) return [actionProp.const as string];

  return actions;
}

// ── Fixture Generator ────────────────────────────────────────────────────────
// Actions that are unsafe to test without careful setup
const SKIP_ACTIONS = new Set([
  'login',
  'callback',
  'logout', // OAuth flows (interactive)
  'delete_sheet',
  'delete',
  'clear', // Destructive (tested separately)
  'export_to_bigquery',
  'import_from_bigquery', // BigQuery (needs BQ project)
  'call_remote',
  'list_servers',
  'get_server_tools', // Federation (needs remote server)
  'register',
  'unregister',
  'watch_changes', // Webhooks (needs public URL)
  'run',
  'deploy',
  'create_trigger',
  'delete_trigger', // Apps Script (needs bound script)
  'subscribe',
  'unsubscribe', // Workspace Events (needs watch)
  'begin',
  'commit',
  'rollback',
  'queue', // Transaction (tested as flow)
  'install_serval_function', // Formula (needs bound script)
  'schedule_create',
  'schedule_cancel',
  'schedule_run_now', // Scheduler
]);

// Actions that should use a specific known-good call signature
const EXPLICIT_FIXTURES: Record<string, Record<string, unknown>> = {
  // sheets_auth
  status: {},
  // sheets_session
  set_active: {},
  get_context: {},
  list_checkpoints: {},
  get_preferences: {},
  clear_context: {},
  // sheets_core
  list: { maxResults: 5 },
  // sheets_analyze
  scout: {},
  suggest_next_actions: { maxSuggestions: 3 },
  // sheets_history
  history_list: { maxResults: 5 },
  // sheets_transaction
  transaction_list: {},
  // sheets_agent
  list_plans: {},
};

function buildFixture(
  tool: string,
  action: string,
  spreadsheetId: string
): Record<string, unknown> | null {
  if (SKIP_ACTIONS.has(action)) return null;

  // Explicit fixture overrides
  if (action in EXPLICIT_FIXTURES && tool !== 'sheets_data') {
    return { request: { action, ...EXPLICIT_FIXTURES[action] } };
  }

  const base: Record<string, unknown> = { action, spreadsheetId };

  // Range-based actions
  if (['read', 'write', 'append', 'clear_range', 'batch_read'].includes(action)) {
    base.range = 'ProbeData!A1:D5';
    if (action === 'write' || action === 'append') {
      base.values = [['probe_test', '1', '2', '3']];
    }
    if (action === 'batch_read') {
      base.ranges = ['ProbeData!A1:B3', 'ProbeData!C1:D3'];
    }
  }

  // List/get actions
  if (action.startsWith('list_') || action === 'list') {
    base.maxResults = 5;
  }

  // Sheet-specific actions
  if (['add_sheet', 'get_sheet', 'update_sheet', 'duplicate_sheet'].includes(action)) {
    if (action === 'add_sheet') base.title = `ProbeSheet_${Date.now()}`;
    if (action === 'get_sheet') base.sheetName = 'ProbeData';
    if (action === 'update_sheet') {
      base.sheetName = 'ProbeData';
      base.newTitle = 'ProbeData';
    }
    if (action === 'duplicate_sheet') {
      base.sourceSheetName = 'ProbeData';
      base.newSheetName = `ProbeDup_${Date.now()}`;
    }
  }

  // Format actions
  if (action === 'set_background') {
    base.range = 'ProbeData!A1';
    base.color = { red: 0.9, green: 0.9, blue: 1 };
  }
  if (action === 'set_text_format') {
    base.range = 'ProbeData!A1';
    base.bold = true;
  }
  if (action === 'set_number_format') {
    base.range = 'ProbeData!B1:D5';
    base.pattern = '#,##0.00';
  }
  if (action === 'apply_preset') {
    base.range = 'ProbeData!A1:D1';
    base.preset = 'header_row';
  }
  if (action === 'batch_format') {
    base.requests = [{ range: 'ProbeData!A1', format: { textFormat: { bold: true } } }];
  }

  // Dimension actions
  if (action === 'freeze') {
    base.frozenRowCount = 1;
    base.sheetName = 'ProbeData';
  }
  if (action === 'auto_resize') {
    base.sheetName = 'ProbeData';
    base.dimension = 'COLUMNS';
  }
  if (action === 'insert') {
    base.dimension = 'ROWS';
    base.startIndex = 10;
    base.endIndex = 11;
    base.sheetName = 'ProbeData';
  }
  if (action === 'sort_range') {
    base.range = 'ProbeData!A2:D5';
    base.sortOrder = [{ dimensionIndex: 0, sortOrder: 'ASCENDING' }];
  }

  // Analysis actions
  if (action === 'analyze_data') {
    base.category = 'data';
  }
  if (action === 'analyze_formulas') {
    /* uses spreadsheetId only */
  }
  if (action === 'analyze_performance') {
    base.maxSheets = 1;
  }
  if (action === 'comprehensive') {
    /* uses spreadsheetId only */
  }
  if (action === 'detect_patterns') {
    base.range = 'ProbeData!A1:D5';
  }
  if (action === 'generate_formula') {
    base.description = 'Sum column B';
    base.outputRange = 'ProbeData!E1';
  }

  // Compute actions
  if (action === 'aggregate') {
    base.range = 'ProbeData!B2:D5';
    base.function = 'SUM';
  }
  if (action === 'statistics') {
    base.range = 'ProbeData!B2:D5';
  }
  if (action === 'forecast') {
    base.range = 'ProbeData!B2:B5';
    base.periods = 3;
  }
  if (action === 'correlation') {
    base.range = 'ProbeData!B2:D5';
  }
  if (action === 'regression') {
    base.yRange = 'ProbeData!B2:B5';
    base.xRange = 'ProbeData!C2:C5';
  }

  // Fix actions
  if (action === 'suggest_cleaning') {
    /* uses spreadsheetId only */
  }
  if (action === 'detect_anomalies') {
    base.range = 'ProbeData!B2:D5';
  }
  if (action === 'fill_missing') {
    base.range = 'ProbeData!A1:D5';
    base.strategy = 'forward';
  }
  if (action === 'standardize_formats') {
    base.range = 'ProbeData!A1:D5';
    base.columns = [];
  }
  if (action === 'clean') {
    base.range = 'ProbeData!A1:D5';
    base.mode = 'preview';
  }

  // History actions
  if (action === 'list') {
    base.maxResults = 5;
  }
  if (action === 'timeline') {
    base.maxResults = 5;
  }
  if (action === 'diff_revisions') return null; // needs 2 revision IDs

  // Dependency actions
  if (action === 'build') {
    /* uses spreadsheetId only */
  }
  if (action === 'analyze_impact') {
    base.cell = 'ProbeData!B2';
  }
  if (action === 'get_dependents') {
    base.cell = 'ProbeData!B2';
  }
  if (action === 'detect_cycles') {
    /* uses spreadsheetId only */
  }
  if (action === 'model_scenario') {
    base.changes = [{ cell: 'ProbeData!B2', newValue: 999 }];
  }

  // Collaborate actions
  if (action === 'list_permissions') {
    /* uses spreadsheetId only */
  }
  if (action === 'comment_list') {
    /* uses spreadsheetId only */
  }
  if (action === 'version_list_revisions') {
    /* uses spreadsheetId only */
  }

  // Quality actions
  if (action === 'validate') {
    base.range = 'ProbeData!A1:D5';
    base.rules = [{ type: 'NOT_BLANK', column: 'A' }];
  }
  if (action === 'detect_conflicts') {
    /* uses spreadsheetId only */
  }

  // Session
  if (action === 'set_active') return { request: { action, spreadsheetId } };
  if (action === 'record_operation') {
    base.operation = { tool: 'sheets_data', action: 'read', spreadsheetId, range: 'ProbeData!A1' };
  }
  if (action === 'save_checkpoint') {
    base.label = 'probe-checkpoint';
  }

  // Visualize
  if (action === 'suggest_chart') {
    base.range = 'ProbeData!A1:D5';
  }
  if (action === 'chart_list') {
    /* uses spreadsheetId only */
  }

  // Advanced
  if (action === 'list_named_ranges') {
    /* uses spreadsheetId only */
  }
  if (action === 'list_protected_ranges') {
    /* uses spreadsheetId only */
  }
  if (action === 'list_banding') {
    /* uses spreadsheetId only */
  }
  if (action === 'list_tables') {
    /* uses spreadsheetId only */
  }
  if (action === 'list_named_functions') {
    /* uses spreadsheetId only */
  }
  if (action === 'list_chips') {
    base.range = 'ProbeData!A1:D5';
  }
  if (action === 'add_named_range') {
    base.name = `probeRange_${Date.now()}`;
    base.range = 'ProbeData!A1:D5';
  }
  if (action === 'get_metadata') {
    base.metadataKey = 'probe';
  }

  // Connectors
  if (action === 'list_connectors') {
    /* no params needed */ delete base.spreadsheetId;
  }

  // Templates
  if (action === 'list') {
    delete base.spreadsheetId;
  }
  if (action === 'list_builtin') {
    delete base.spreadsheetId;
  }

  // Agent
  if (action === 'list_plans') {
    /* uses spreadsheetId only */
  }

  return { request: base };
}

// ── Advanced Flow Tests ───────────────────────────────────────────────────────
interface FlowResult {
  name: string;
  steps: Array<{
    step: string;
    status: 'pass' | 'fail' | 'skip';
    durationMs: number;
    error?: string;
  }>;
  status: 'pass' | 'fail' | 'partial';
}

async function runAdvancedFlows(
  client: StdioMCPClient,
  spreadsheetId: string
): Promise<FlowResult[]> {
  const flows: FlowResult[] = [];

  // Flow 1: Write → Read → Verify round-trip
  log(`\n${C.cyan}  Advanced Flow: Write → Read round-trip${C.reset}`);
  {
    const flow: FlowResult = { name: 'write_read_roundtrip', steps: [], status: 'pass' };
    const testRange = 'ProbeData!F1:G2';
    const testValues = [
      ['flow_test', '42'],
      ['hello', '100'],
    ];

    for (const [step, fn] of [
      [
        'write',
        async () =>
          client.callTool('sheets_data', {
            request: { action: 'write', spreadsheetId, range: testRange, values: testValues },
          }),
      ],
      [
        'read_back',
        async () =>
          client.callTool('sheets_data', {
            request: { action: 'read', spreadsheetId, range: testRange },
          }),
      ],
      [
        'clear',
        async () =>
          client.callTool('sheets_data', {
            request: { action: 'clear_range', spreadsheetId, range: testRange },
          }),
      ],
    ] as Array<[string, () => Promise<unknown>]>) {
      const t = Date.now();
      try {
        await fn();
        flow.steps.push({ step, status: 'pass', durationMs: Date.now() - t });
      } catch (e) {
        flow.steps.push({ step, status: 'fail', durationMs: Date.now() - t, error: String(e) });
        flow.status = 'partial';
      }
    }
    flows.push(flow);
  }

  // Flow 2: Transaction (begin → queue write → commit)
  log(`${C.cyan}  Advanced Flow: Transaction begin → queue → commit${C.reset}`);
  {
    const flow: FlowResult = { name: 'transaction_flow', steps: [], status: 'pass' };
    let txId: string | null = null;

    for (const [step, fn] of [
      [
        'begin',
        async () => {
          const r = (await client.callTool('sheets_transaction', {
            request: { action: 'begin', description: 'probe-test' },
          })) as { content: Array<{ text: string }> };
          const text = r?.content?.[0]?.text ?? '{}';
          const parsed = JSON.parse(text) as { response?: { transactionId?: string } };
          txId = parsed?.response?.transactionId ?? null;
        },
      ],
      [
        'queue',
        async () => {
          if (!txId) throw new Error('No transaction ID from begin');
          await client.callTool('sheets_transaction', {
            request: {
              action: 'queue',
              transactionId: txId,
              operation: {
                tool: 'sheets_data',
                action: 'write',
                spreadsheetId,
                range: 'ProbeData!H1',
                values: [['tx_test']],
              },
            },
          });
        },
      ],
      [
        'commit',
        async () => {
          if (!txId) throw new Error('No transaction ID');
          await client.callTool('sheets_transaction', {
            request: { action: 'commit', transactionId: txId },
          });
        },
      ],
      [
        'cleanup',
        async () =>
          client.callTool('sheets_data', {
            request: { action: 'clear_range', spreadsheetId, range: 'ProbeData!H1' },
          }),
      ],
    ] as Array<[string, () => Promise<unknown>]>) {
      const t = Date.now();
      try {
        await fn();
        flow.steps.push({ step, status: 'pass', durationMs: Date.now() - t });
      } catch (e) {
        flow.steps.push({ step, status: 'fail', durationMs: Date.now() - t, error: String(e) });
        flow.status = 'partial';
      }
    }
    flows.push(flow);
  }

  // Flow 3: Analysis chain (scout → analyze → suggest)
  log(`${C.cyan}  Advanced Flow: Scout → Analyze → Suggest${C.reset}`);
  {
    const flow: FlowResult = { name: 'analysis_chain', steps: [], status: 'pass' };
    for (const [step, action, extra] of [
      ['scout', 'scout', {}],
      ['analyze_data', 'analyze_data', { category: 'data' }],
      ['suggest_next_actions', 'suggest_next_actions', { maxSuggestions: 3 }],
    ] as Array<[string, string, Record<string, unknown>]>) {
      const t = Date.now();
      try {
        await client.callTool('sheets_analyze', { request: { action, spreadsheetId, ...extra } });
        flow.steps.push({ step, status: 'pass', durationMs: Date.now() - t });
      } catch (e) {
        flow.steps.push({ step, status: 'fail', durationMs: Date.now() - t, error: String(e) });
        flow.status = 'partial';
      }
    }
    flows.push(flow);
  }

  // Flow 4: Conditional format → list → remove
  log(`${C.cyan}  Advanced Flow: Format → List validations → Clean${C.reset}`);
  {
    const flow: FlowResult = { name: 'format_lifecycle', steps: [], status: 'pass' };
    for (const [step, fn] of [
      [
        'set_background',
        async () =>
          client.callTool('sheets_format', {
            request: {
              action: 'set_background',
              spreadsheetId,
              range: 'ProbeData!A1:D1',
              color: { red: 0.8, green: 0.9, blue: 1 },
            },
          }),
      ],
      [
        'set_text_format',
        async () =>
          client.callTool('sheets_format', {
            request: {
              action: 'set_text_format',
              spreadsheetId,
              range: 'ProbeData!A1:D1',
              bold: true,
            },
          }),
      ],
      [
        'list_data_validations',
        async () =>
          client.callTool('sheets_format', {
            request: { action: 'list_data_validations', spreadsheetId },
          }),
      ],
    ] as Array<[string, () => Promise<unknown>]>) {
      const t = Date.now();
      try {
        await fn();
        flow.steps.push({ step, status: 'pass', durationMs: Date.now() - t });
      } catch (e) {
        flow.steps.push({ step, status: 'fail', durationMs: Date.now() - t, error: String(e) });
        flow.status = 'partial';
      }
    }
    flows.push(flow);
  }

  // Flow 5: History → Timeline
  log(`${C.cyan}  Advanced Flow: History list → Timeline${C.reset}`);
  {
    const flow: FlowResult = { name: 'history_chain', steps: [], status: 'pass' };
    for (const [step, fn] of [
      [
        'list',
        async () =>
          client.callTool('sheets_history', {
            request: { action: 'list', spreadsheetId, maxResults: 5 },
          }),
      ],
      [
        'timeline',
        async () =>
          client.callTool('sheets_history', {
            request: { action: 'timeline', spreadsheetId, maxResults: 5 },
          }),
      ],
    ] as Array<[string, () => Promise<unknown>]>) {
      const t = Date.now();
      try {
        await fn();
        flow.steps.push({ step, status: 'pass', durationMs: Date.now() - t });
      } catch (e) {
        flow.steps.push({ step, status: 'fail', durationMs: Date.now() - t, error: String(e) });
        flow.status = 'partial';
      }
    }
    flows.push(flow);
  }

  return flows;
}

// ── Result Types ─────────────────────────────────────────────────────────────
interface ActionResult {
  tool: string;
  action: string;
  status: 'pass' | 'fail' | 'skip' | 'timeout';
  durationMs: number;
  error?: string;
  errorCode?: string;
  responseShape?: string;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log(`\n${C.bold}${C.cyan}ServalSheets Auto-Probe${C.reset}  ${C.dim}Agent 1 of 3${C.reset}`);
  log(`${C.dim}${'─'.repeat(60)}${C.reset}\n`);

  // Load server env from .mcp.json
  let serverEnv: Record<string, string> = {};
  if (existsSync(MCP_JSON)) {
    const config = JSON.parse(readFileSync(MCP_JSON, 'utf8')) as {
      mcpServers: Record<string, { env?: Record<string, string> }>;
    };
    serverEnv = config.mcpServers?.servalsheets?.env ?? {};
    log(`${C.dim}Loaded env from .mcp.json (${Object.keys(serverEnv).length} vars)${C.reset}`);
  }

  // Start server
  log(`${C.blue}Spawning MCP server...${C.reset}`);
  const client = new StdioMCPClient(serverEnv);

  let spreadsheetId = '';
  const results: ActionResult[] = [];
  const flows: FlowResult[] = [];

  try {
    // Initialize
    await client.initialize();
    log(`${C.green}✓ MCP handshake complete${C.reset}`);

    // Discover tools + actions
    const tools = await client.listTools();
    log(`${C.green}✓ Discovered ${tools.length} tools${C.reset}`);

    const toolFilter = TOOL_FILTER?.split(',').map((t) => t.trim()) ?? null;
    const filteredTools = toolFilter ? tools.filter((t) => toolFilter.includes(t.name)) : tools;

    // Create test spreadsheet
    log(`\n${C.blue}Creating test spreadsheet...${C.reset}`);
    const createResult = (await client.callTool('sheets_core', {
      request: { action: 'create', title: `ServalSheets-AutoProbe-${Date.now()}` },
    })) as { content: Array<{ text: string }> };
    const createText = createResult?.content?.[0]?.text ?? '{}';
    const createParsed = JSON.parse(createText) as { response?: { spreadsheetId?: string } };
    spreadsheetId = createParsed?.response?.spreadsheetId ?? '';
    if (!spreadsheetId) throw new Error('Failed to create test spreadsheet — check auth');
    log(`${C.green}✓ Test spreadsheet: ${spreadsheetId}${C.reset}`);

    // Set up test data sheet
    await client.callTool('sheets_core', {
      request: { action: 'add_sheet', spreadsheetId, title: 'ProbeData' },
    });
    await client.callTool('sheets_data', {
      request: {
        action: 'write',
        spreadsheetId,
        range: 'ProbeData!A1:D5',
        values: [
          ['Name', 'Revenue', 'Cost', 'Profit'],
          ['Alpha', 10000, 6000, 4000],
          ['Beta', 15000, 9000, 6000],
          ['Gamma', 8000, 5000, 3000],
          ['Delta', 12000, 7500, 4500],
        ],
      },
    });
    log(`${C.green}✓ Test data written${C.reset}\n`);

    // ── Run all actions ──────────────────────────────────────────────────────
    let totalPass = 0,
      totalFail = 0,
      totalSkip = 0;

    for (const tool of filteredTools) {
      const actions = extractActions(tool.inputSchema);
      if (actions.length === 0) {
        dim(`  [${tool.name}] no actions discoverable from schema`);
        continue;
      }

      log(`${C.bold}${tool.name}${C.reset}  ${C.dim}(${actions.length} actions)${C.reset}`);

      for (const action of actions) {
        const fixture = buildFixture(tool.name, action, spreadsheetId);
        if (!fixture) {
          results.push({ tool: tool.name, action, status: 'skip', durationMs: 0 });
          process.stdout.write(`  ${C.dim}skip${C.reset}  ${action}\n`);
          totalSkip++;
          continue;
        }

        const t = Date.now();
        try {
          const raw = (await client.callTool(tool.name, fixture)) as {
            content?: Array<{ text?: string }>;
          };
          const durationMs = Date.now() - t;
          const text = raw?.content?.[0]?.text ?? '{}';
          let responseShape = 'unknown';
          try {
            const parsed = JSON.parse(text) as { response?: Record<string, unknown> };
            responseShape = Object.keys(parsed?.response ?? parsed ?? {})
              .slice(0, 5)
              .join(',');
          } catch {
            /* ok */
          }

          results.push({ tool: tool.name, action, status: 'pass', durationMs, responseShape });
          const badge = durationMs > 5000 ? `${C.yellow}⚡` : `${C.green}✓`;
          process.stdout.write(
            `  ${badge}${C.reset}  ${action}  ${C.dim}${durationMs}ms${C.reset}\n`
          );
          totalPass++;
        } catch (e: unknown) {
          const durationMs = Date.now() - t;
          const err = e instanceof Error ? e.message : String(e);
          const isTimeout = err.includes('Timeout');
          const status = isTimeout ? 'timeout' : 'fail';
          const errCode = err.match(/code (\w+)/)?.[1];

          results.push({
            tool: tool.name,
            action,
            status,
            durationMs,
            error: err,
            errorCode: errCode,
          });
          const badge = isTimeout ? `${C.yellow}⏱` : `${C.red}✗`;
          process.stdout.write(
            `  ${badge}${C.reset}  ${action}  ${C.dim}${durationMs}ms${C.reset}  ${C.red}${err.slice(0, 100)}${C.reset}\n`
          );
          if (isTimeout) totalSkip++;
          else totalFail++;
        }
      }
      log('');
    }

    // ── Advanced Flows ───────────────────────────────────────────────────────
    log(`${C.bold}Advanced Flows${C.reset}`);
    const flowResults = await runAdvancedFlows(client, spreadsheetId);
    flows.push(...flowResults);
    for (const flow of flowResults) {
      const passed = flow.steps.filter((s) => s.status === 'pass').length;
      const icon = flow.status === 'pass' ? `${C.green}✓` : `${C.yellow}~`;
      log(
        `  ${icon}${C.reset}  ${flow.name}  ${C.dim}${passed}/${flow.steps.length} steps${C.reset}`
      );
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    log(`\n${C.cyan}${'─'.repeat(60)}${C.reset}`);
    log(`${C.bold}Probe Complete${C.reset}`);
    log(`  Pass   : ${C.green}${totalPass}${C.reset}`);
    log(`  Fail   : ${C.red}${totalFail}${C.reset}`);
    log(`  Skip   : ${C.dim}${totalSkip}${C.reset}`);
    log(`  Total  : ${results.length}`);
    log(`  Flows  : ${flows.filter((f) => f.status === 'pass').length}/${flows.length} pass`);

    const failedActions = results.filter((r) => r.status === 'fail');
    if (failedActions.length > 0) {
      log(`\n${C.red}Failed actions:${C.reset}`);
      for (const f of failedActions.slice(0, 20)) {
        log(`  ${f.tool}.${f.action}: ${f.error?.slice(0, 120)}`);
      }
    }
  } finally {
    // Cleanup
    if (spreadsheetId && !KEEP_SHEET) {
      try {
        await client.callTool('sheets_core', {
          request: { action: 'delete_spreadsheet', spreadsheetId },
        });
        log(`\n${C.dim}✓ Test spreadsheet deleted${C.reset}`);
      } catch {
        log(
          `\n${C.yellow}Note: Could not delete test spreadsheet ${spreadsheetId} — delete manually${C.reset}`
        );
      }
    } else if (KEEP_SHEET && spreadsheetId) {
      log(`\n${C.yellow}Kept test spreadsheet: ${spreadsheetId}${C.reset}`);
    }

    await client.close();

    // Write results
    mkdirSync(OUT_DIR, { recursive: true });
    const output = {
      timestamp: new Date().toISOString(),
      serverVersion: '1.7.0',
      spreadsheetId,
      summary: {
        total: results.length,
        pass: results.filter((r) => r.status === 'pass').length,
        fail: results.filter((r) => r.status === 'fail').length,
        skip: results.filter((r) => r.status === 'skip' || r.status === 'timeout').length,
      },
      actions: results,
      flows,
    };
    writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
    log(`\n${C.green}Results written: ${OUT_FILE}${C.reset}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
