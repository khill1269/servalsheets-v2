#!/usr/bin/env tsx
/**
 * ServalSheets Live Monitor
 * Tails the Claude Desktop MCP log, parses tool calls, surfaces real-time stats.
 *
 * Usage:
 *   npx tsx scripts/live-monitor.ts [--verbose] [--slow <ms>] [--export] [--stats]
 */

import { existsSync, statSync, createReadStream, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const STATS_ONLY = args.includes('--stats');
const EXPORT = args.includes('--export');
const slowIdx = args.indexOf('--slow');
const SLOW_MS = slowIdx !== -1 ? parseInt(args[slowIdx + 1] ?? '2000', 10) : 2000;

// ─── Log file ────────────────────────────────────────────────────────────────
const LOG_CANDIDATES = [
  join(homedir(), 'Library/Logs/Claude/mcp-server-servalsheets.log'),
  join(homedir(), 'Library/Logs/Claude/mcp-server-ServalSheets.log'),
  join(homedir(), 'Library/Logs/Claude/mcp-server-servalsheets-new.log'),
];
const LOG_FILE = LOG_CANDIDATES.find(existsSync) ?? LOG_CANDIDATES[0]!;

// ─── Colors ──────────────────────────────────────────────────────────────────
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

// ─── State ───────────────────────────────────────────────────────────────────
interface PendingCall {
  id: number | string;
  tool: string;
  action?: string;
  startTime: number;
}
interface CallRecord {
  tool: string;
  action?: string;
  durationMs: number;
  success: boolean;
  error?: string;
  timestamp: string;
}

const pending = new Map<number | string, PendingCall>();
const calls: CallRecord[] = [];
const errorCounts: Record<string, number> = {};
const toolCounts: Record<string, number> = {};
const slowCalls: CallRecord[] = [];
let startTime = Date.now();

function ts(): string {
  return new Date().toLocaleTimeString();
}
function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function parseLogLine(line: string): { level: string; json: unknown } | null {
  const m = line.match(/^\S+\s+\[servalsheets\]\s+\[(\w+)\]\s+(.*)/s);
  if (!m) return null;
  const level = m[1]!;
  const rest = m[2]!;
  const jsonStart = rest.indexOf('{');
  if (jsonStart === -1) return { level, json: rest };
  try {
    const jsonStr = rest.slice(jsonStart);
    let depth = 0,
      end = -1;
    for (let i = 0; i < jsonStr.length; i++) {
      if (jsonStr[i] === '{') depth++;
      else if (jsonStr[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    return { level, json: JSON.parse(end !== -1 ? jsonStr.slice(0, end + 1) : jsonStr) };
  } catch {
    return { level, json: null };
  }
}

function handleMcpMessage(msg: Record<string, unknown>): void {
  const method = msg['method'] as string | undefined;
  const id = msg['id'] as number | string | undefined;
  const result = msg['result'] as Record<string, unknown> | undefined;
  const error = msg['error'] as Record<string, unknown> | undefined;
  const params = msg['params'] as Record<string, unknown> | undefined;

  if (method === 'tools/call' && id !== undefined) {
    const toolName = (params?.['name'] as string) ?? 'unknown';
    const toolArgs = params?.['arguments'] as Record<string, unknown> | undefined;
    const reqObj = toolArgs?.['request'] as Record<string, unknown> | undefined;
    const action = (toolArgs?.['action'] as string) ?? (reqObj?.['action'] as string);
    pending.set(id, { id, tool: toolName, action, startTime: Date.now() });
    if (!STATS_ONLY) {
      process.stdout.write(
        `${C.dim}${ts()}${C.reset} ${C.cyan}→${C.reset} ${C.bold}${toolName}${C.reset}${action ? `.${action}` : ''}\n`
      );
    }
    return;
  }

  if (!method && id !== undefined && (result !== undefined || error !== undefined)) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    const durationMs = Date.now() - p.startTime;
    const success = error === undefined;
    const errMsg = error
      ? String((error as Record<string, unknown>)['message'] ?? 'unknown')
      : undefined;
    const rec: CallRecord = {
      tool: p.tool,
      action: p.action,
      durationMs,
      success,
      error: errMsg,
      timestamp: new Date().toISOString(),
    };
    calls.push(rec);
    const key = p.action ? `${p.tool}.${p.action}` : p.tool;
    toolCounts[key] = (toolCounts[key] ?? 0) + 1;
    if (!success) {
      errorCounts[errMsg ?? 'unknown'] = (errorCounts[errMsg ?? 'unknown'] ?? 0) + 1;
    }
    const slow = durationMs >= SLOW_MS;
    if (slow) slowCalls.push(rec);
    if (!STATS_ONLY) {
      const icon = !success ? `${C.red}✗` : slow ? `${C.yellow}⚡` : `${C.green}✓`;
      process.stdout.write(
        `${C.dim}${ts()}${C.reset} ${icon}${C.reset} ${C.bold}${p.tool}${C.reset}${p.action ? `.${p.action}` : ''} ${slow ? C.yellow : C.dim}${fmt(durationMs)}${C.reset}${errMsg ? ` ${C.red}[${errMsg.slice(0, 80)}]${C.reset}` : ''}\n`
      );
      if (VERBOSE && result)
        process.stdout.write(`  ${C.dim}${JSON.stringify(result).slice(0, 200)}${C.reset}\n`);
    }
  }
}

function handleLogLine(level: string, line: string, jsonObj: unknown): void {
  if (typeof jsonObj === 'object' && jsonObj !== null) {
    handleMcpMessage(jsonObj as Record<string, unknown>);
    return;
  }
  if (level === 'error' && !STATS_ONLY) {
    process.stdout.write(
      `${C.dim}${ts()}${C.reset} ${C.red}[ERR]${C.reset} ${line.slice(0, 200)}\n`
    );
  } else if (level === 'warn' && VERBOSE && !STATS_ONLY) {
    process.stdout.write(
      `${C.dim}${ts()}${C.reset} ${C.yellow}[WRN]${C.reset} ${line.slice(0, 200)}\n`
    );
  } else if (level === 'debug' && VERBOSE && !STATS_ONLY) {
    process.stdout.write(`${C.dim}${ts()} [DBG] ${line.slice(0, 160)}${C.reset}\n`);
  }
}

function printStats(): void {
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const total = calls.length;
  const succeeded = calls.filter((c) => c.success).length;
  const avgMs = total > 0 ? Math.round(calls.reduce((s, c) => s + c.durationMs, 0) / total) : 0;
  const sorted = [...calls].sort((a, b) => a.durationMs - b.durationMs);
  const p95 = sorted[Math.floor(sorted.length * 0.95)]?.durationMs ?? 0;

  process.stdout.write(`\n${C.cyan}${'─'.repeat(60)}${C.reset}\n`);
  process.stdout.write(`${C.bold}ServalSheets Monitor — ${elapsed}s session${C.reset}\n`);
  process.stdout.write(`${C.cyan}${'─'.repeat(60)}${C.reset}\n`);
  process.stdout.write(`  Tool calls : ${total}  (${succeeded} ok, ${total - succeeded} errors)\n`);
  process.stdout.write(`  Avg latency: ${fmt(avgMs)}   p95: ${fmt(p95)}\n`);
  process.stdout.write(`  Slow (>${SLOW_MS}ms): ${slowCalls.length}\n`);

  if (Object.keys(toolCounts).length) {
    process.stdout.write(`\n${C.bold}Top actions:${C.reset}\n`);
    Object.entries(toolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([k, v]) => process.stdout.write(`  ${String(v).padStart(4)}x  ${k}\n`));
  }
  if (slowCalls.length) {
    process.stdout.write(`\n${C.yellow}Slow calls (>${SLOW_MS}ms):${C.reset}\n`);
    slowCalls
      .slice(-10)
      .forEach((c) =>
        process.stdout.write(
          `  ${fmt(c.durationMs).padStart(6)}  ${c.tool}${c.action ? '.' + c.action : ''}\n`
        )
      );
  }
  if (Object.keys(errorCounts).length) {
    process.stdout.write(`\n${C.red}Errors:${C.reset}\n`);
    Object.entries(errorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([msg, n]) => process.stdout.write(`  ${n}x  ${msg}\n`));
  }
  if (EXPORT && calls.length > 0) {
    const dir = join(homedir(), '.servalsheets');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `monitor-report-${Date.now()}.json`);
    writeFileSync(
      path,
      JSON.stringify({ elapsed, calls, toolCounts, slowCalls, errorCounts }, null, 2)
    );
    process.stdout.write(`\n${C.green}Report saved: ${path}${C.reset}\n`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
if (!existsSync(LOG_FILE)) {
  process.stderr.write(`Log file not found: ${LOG_FILE}\nMake sure Claude Desktop is running.\n`);
  process.exit(1);
}

process.stdout.write(
  `${C.cyan}ServalSheets Live Monitor${C.reset}  ${C.dim}${LOG_FILE}${C.reset}\n`
);
process.stdout.write(`${C.dim}slow=${SLOW_MS}ms  verbose=${VERBOSE}  export=${EXPORT}${C.reset}\n`);
process.stdout.write(`${C.dim}Ctrl+C for summary report${C.reset}\n`);
process.stdout.write(`${C.cyan}${'─'.repeat(60)}${C.reset}\n\n`);

// Start at EOF — only tail new lines
let lastPos = (() => {
  try {
    return statSync(LOG_FILE).size;
  } catch {
    return 0;
  }
})();

function readNewLines(): void {
  try {
    const current = statSync(LOG_FILE).size;
    if (current <= lastPos) return;
    const stream = createReadStream(LOG_FILE, { start: lastPos, end: current - 1 });
    lastPos = current;
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      const parsed = parseLogLine(line);
      if (parsed) handleLogLine(parsed.level, line, parsed.json);
    });
  } catch {
    /* file not ready yet */
  }
}

// Poll every 250ms
const poll = setInterval(readNewLines, 250);
// Keep alive explicitly
poll.unref(); // Don't block exit — but we also register SIGINT below which keeps process alive

// Heartbeat every 30s in stats-only mode
if (STATS_ONLY) {
  const hb = setInterval(() => {
    const total = calls.length;
    const errs = total - calls.filter((c) => c.success).length;
    const avgMs = total > 0 ? Math.round(calls.reduce((s, c) => s + c.durationMs, 0) / total) : 0;
    process.stdout.write(
      `\r${C.dim}${ts()}${C.reset}  calls=${total}  errors=${errs}  avg=${fmt(avgMs)}  slow=${slowCalls.length}     `
    );
  }, 1000);
  hb.unref();
}

// One-time metrics endpoint check
setTimeout(() => {
  const req = request(
    { hostname: '127.0.0.1', port: 9090, path: '/health', method: 'HEAD', timeout: 500 },
    (res) => {
      if (res.statusCode === 200)
        process.stdout.write(
          `${C.green}Prometheus metrics: http://127.0.0.1:9090/metrics${C.reset}\n`
        );
    }
  );
  req.on('error', () => {});
  req.end();
}, 1000);

// Keep process alive via a dummy timer that we'll clear on exit
const keepAlive = setInterval(() => {
  /* heartbeat */
}, 60_000);

process.on('SIGINT', () => {
  clearInterval(poll);
  clearInterval(keepAlive);
  printStats();
  process.exit(0);
});
process.on('SIGTERM', () => {
  clearInterval(poll);
  clearInterval(keepAlive);
  printStats();
  process.exit(0);
});
