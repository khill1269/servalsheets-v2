#!/usr/bin/env tsx
/**
 * ServalSheets Knowledge Enrichment — Agent 2
 *
 * Reads probe-results.json, queries the Google Developer Knowledge API for each
 * failed action, cross-references implementation params against official docs,
 * and outputs knowledge-enrichment.json.
 *
 * Usage:
 *   npx tsx scripts/knowledge-enrichment.ts [--verbose] [--all]
 *
 * Options:
 *   --all     Enrich ALL actions (not just failures)
 *   --verbose Show raw API responses
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const OUT_DIR = join(homedir(), '.servalsheets');
const PROBE_FILE = join(OUT_DIR, 'probe-results.json');
const OUT_FILE = join(OUT_DIR, 'knowledge-enrichment.json');

// Google Developer Knowledge API config
const DEV_KNOWLEDGE_URL = 'https://developerknowledge.googleapis.com/mcp';
const API_KEY = process.env.GOOGLE_API_KEY || '';
const RATE_LIMIT_MS = 500; // 120 req/min max, stay conservative

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const ENRICH_ALL = args.includes('--all');

// ── Colors ───────────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};
function log(msg: string) {
  process.stdout.write(msg + '\n');
}

// ── Google Developer Knowledge HTTP MCP Client ───────────────────────────────
interface McpToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

let mcpSessionId: string | null = null;
let mcpRequestId = 1;

async function mcpInit(): Promise<void> {
  const body = {
    jsonrpc: '2.0',
    id: mcpRequestId++,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'servalsheets-enrichment', version: '1.0.0' },
    },
  };

  const res = await fetch(DEV_KNOWLEDGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
    },
    body: JSON.stringify(body),
  });

  const sid = res.headers.get('mcp-session-id');
  if (sid) mcpSessionId = sid;

  // Send initialized notification
  await fetch(DEV_KNOWLEDGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      ...(mcpSessionId ? { 'Mcp-Session-Id': mcpSessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
}

async function searchDocs(query: string): Promise<string[]> {
  const body = {
    jsonrpc: '2.0',
    id: mcpRequestId++,
    method: 'tools/call',
    params: {
      name: 'search_documents',
      arguments: { query },
    },
  };

  const res = await fetch(DEV_KNOWLEDGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      ...(mcpSessionId ? { 'Mcp-Session-Id': mcpSessionId } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Dev Knowledge API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { result?: McpToolResult };
  const result = data?.result;
  if (!result || result.isError) return [];

  return result.content.filter((c) => c.type === 'text' && c.text).map((c) => c.text!);
}

async function _fetchDocs(url: string): Promise<string | null> {
  const body = {
    jsonrpc: '2.0',
    id: mcpRequestId++,
    method: 'tools/call',
    params: {
      name: 'fetch_document',
      arguments: { url },
    },
  };

  try {
    const res = await fetch(DEV_KNOWLEDGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        ...(mcpSessionId ? { 'Mcp-Session-Id': mcpSessionId } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { result?: McpToolResult };
    const result = data?.result;
    if (!result || result.isError) return null;
    return result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .slice(0, 3000);
  } catch {
    return null;
  }
}

// ── Action → Google API mapping ───────────────────────────────────────────────
function buildSearchQuery(tool: string, action: string, error?: string): string {
  // Map MCP tool+action → relevant Google API search terms
  const toolMap: Record<string, string> = {
    sheets_data: 'Google Sheets API spreadsheets.values',
    sheets_core: 'Google Sheets API spreadsheets',
    sheets_format: 'Google Sheets API batchUpdate CellFormat',
    sheets_dimensions: 'Google Sheets API insertDimension deleteDimension',
    sheets_advanced: 'Google Sheets API DeveloperMetadata protectedRanges namedRanges',
    sheets_visualize: 'Google Sheets API addChart EmbeddedChart',
    sheets_collaborate: 'Google Sheets API Google Drive permissions comments revisions',
    sheets_composite: 'Google Sheets API spreadsheets import',
    sheets_analyze: 'Google Sheets API spreadsheets data analysis',
    sheets_fix: 'Google Sheets API data quality cleaning',
    sheets_dependencies: 'Google Sheets API formula dependencies',
    sheets_history: 'Google Sheets API Drive revisions history',
    sheets_compute: 'Google Sheets API statistical computation',
    sheets_quality: 'Google Sheets API data validation',
    sheets_bigquery: 'Google BigQuery API connected sheets',
    sheets_appsscript: 'Google Apps Script API execution',
    sheets_connectors: 'Google Sheets API external data connectors',
    sheets_transaction: 'Google Sheets API batchUpdate atomic operations',
    sheets_session: 'Google Sheets API session context',
    sheets_templates: 'Google Sheets API template',
    sheets_webhook: 'Google Workspace push notifications',
    sheets_agent: 'Google Sheets API automated workflows',
    sheets_federation: 'Google Sheets API cross-spreadsheet',
    sheets_confirm: 'Google Sheets API confirmation',
    sheets_auth: 'Google OAuth2 authentication Sheets API',
  };

  const apiContext = toolMap[tool] ?? `Google ${tool.replace('sheets_', '')} API`;
  const actionTerm = action.replace(/_/g, ' ');

  // Include error context if available
  const errorTerm = error
    ? error
        .replace(/Error|error|failed|Failed/g, '')
        .replace(/\(code \w+\)/g, '')
        .trim()
        .slice(0, 50)
    : '';

  return `${apiContext} ${actionTerm}${errorTerm ? ' ' + errorTerm : ''}`.trim();
}

// ── Param extractor from docs ─────────────────────────────────────────────────
function extractDocInsights(
  tool: string,
  action: string,
  docContent: string[]
): {
  officialParams: string[];
  requiredParams: string[];
  deprecatedPatterns: string[];
  bestPractices: string[];
  rateLimits: string[];
} {
  const combined = docContent.join('\n').toLowerCase();
  const insights = {
    officialParams: [] as string[],
    requiredParams: [] as string[],
    deprecatedPatterns: [] as string[],
    bestPractices: [] as string[],
    rateLimits: [] as string[],
  };

  // Extract params from Sheets API reference patterns
  const paramMatches = combined.matchAll(
    /\b(spreadsheetid|range|values|requestbody|valuesinputoption|majorDimension|fields|pageTtoken|pagesize|filter|sheetid|startindex|endindex|dimension)\b/gi
  );
  for (const match of paramMatches) {
    const param = match[0].toLowerCase();
    if (!insights.officialParams.includes(param)) insights.officialParams.push(param);
  }

  // Extract required markers
  if (combined.includes('required')) {
    const reqMatches = combined.matchAll(/required[:\s]+([a-z_]+)/g);
    for (const match of reqMatches) {
      if (match[1] && !insights.requiredParams.includes(match[1])) {
        insights.requiredParams.push(match[1]);
      }
    }
  }

  // Deprecated patterns
  if (combined.includes('deprecated') || combined.includes('v3')) {
    insights.deprecatedPatterns.push('Uses deprecated v3 pattern — migrate to v4');
  }
  if (combined.includes('batchget') && (action === 'read' || action === 'batch_read')) {
    insights.bestPractices.push(
      'Use spreadsheets.values.batchGet for multiple ranges (single API call)'
    );
  }
  if (combined.includes('field mask') || combined.includes('fields')) {
    insights.bestPractices.push('Use fields parameter to limit response size');
  }
  if (combined.includes('valueinputoption')) {
    insights.bestPractices.push('Always specify valueInputOption (USER_ENTERED or RAW)');
  }

  // Rate limits
  const rateMatches = combined.matchAll(
    /(\d+)\s*(requests?|read|write)[^\n]*(?:per|\/)\s*(minute|second|day)/gi
  );
  for (const match of rateMatches) {
    insights.rateLimits.push(match[0].trim().slice(0, 100));
  }

  return insights;
}

// ── Compare our params vs official ───────────────────────────────────────────
function compareWithKnown(
  tool: string,
  action: string,
  error?: string,
  insights?: ReturnType<typeof extractDocInsights>
): string[] {
  const findings: string[] = [];

  if (!insights) return findings;

  // Check for known common issues
  if (error?.includes('INVALID_ARGUMENT') && insights.requiredParams.length > 0) {
    findings.push(
      `Missing required param. Official required: ${insights.requiredParams.slice(0, 5).join(', ')}`
    );
  }
  if (error?.includes('PERMISSION_DENIED')) {
    findings.push('Insufficient OAuth scope — check required scopes for this API');
  }
  if (error?.includes('NOT_FOUND')) {
    findings.push('Resource not found — spreadsheetId or range may be invalid in test fixture');
  }
  if (error?.includes('UNAUTHENTICATED')) {
    findings.push('Token expired or missing — re-authenticate via sheets_auth.login');
  }
  if (insights.bestPractices.length > 0) {
    findings.push(...insights.bestPractices.map((bp) => `Best practice: ${bp}`));
  }
  if (insights.deprecatedPatterns.length > 0) {
    findings.push(...insights.deprecatedPatterns);
  }

  return findings;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log(
    `\n${C.bold}${C.cyan}ServalSheets Knowledge Enrichment${C.reset}  ${C.dim}Agent 2 of 3${C.reset}`
  );
  log(`${C.dim}${'─'.repeat(60)}${C.reset}\n`);

  if (!existsSync(PROBE_FILE)) {
    log(`${C.red}probe-results.json not found. Run auto-probe first.${C.reset}`);
    process.exit(1);
  }

  const probe = JSON.parse(readFileSync(PROBE_FILE, 'utf8')) as {
    actions: Array<{
      tool: string;
      action: string;
      status: string;
      error?: string;
      errorCode?: string;
    }>;
    flows: Array<{
      name: string;
      status: string;
      steps: Array<{ step: string; status: string; error?: string }>;
    }>;
  };

  // Initialize MCP connection to knowledge server
  log(`${C.blue}Connecting to Google Developer Knowledge API...${C.reset}`);
  try {
    await mcpInit();
    log(`${C.green}✓ Connected${C.reset}`);
  } catch (e) {
    log(`${C.yellow}Warning: MCP init failed, falling back to direct REST search: ${e}${C.reset}`);
  }

  // Determine which actions to enrich
  const toEnrich = ENRICH_ALL
    ? probe.actions
    : probe.actions.filter((a) => a.status === 'fail' || a.status === 'timeout');

  // Also include failed flow steps
  const flowErrors = probe.flows.flatMap((f) =>
    f.steps
      .filter((s) => s.status === 'fail')
      .map((s) => ({
        tool: `flow:${f.name}`,
        action: s.step,
        status: 'fail',
        error: s.error,
      }))
  );

  const allToEnrich = [...toEnrich, ...flowErrors];
  log(
    `Enriching ${allToEnrich.length} actions (${toEnrich.length} action failures + ${flowErrors.length} flow failures)\n`
  );

  interface EnrichmentEntry {
    tool: string;
    action: string;
    status: string;
    error?: string;
    searchQuery: string;
    docSnippets: string[];
    insights: ReturnType<typeof extractDocInsights>;
    findings: string[];
    priority: 'critical' | 'high' | 'medium' | 'low';
    suggestedFix: string;
  }

  const enrichments: EnrichmentEntry[] = [];

  // Also run proactive best-practice queries for all tools (even passing ones)
  const toolBestPracticeQueries: Record<string, string> = {
    sheets_data: 'Google Sheets API v4 values batchGet batchUpdate best practices',
    sheets_format: 'Google Sheets API batchUpdate formatting repeatCell updateCells',
    sheets_dimensions: 'Google Sheets API insertDimension deleteDimension autoResizeDimensions',
    sheets_advanced: 'Google Sheets API DeveloperMetadata protectedRange namedRange',
    sheets_compute: 'Google Sheets API statistical functions aggregation',
    sheets_bigquery: 'Google BigQuery connected sheets import export best practices',
    sheets_appsscript: 'Google Apps Script execution API best practices',
  };

  for (const [tool, query] of Object.entries(toolBestPracticeQueries)) {
    const t = Date.now();
    try {
      const snippets = await searchDocs(query);
      const insights = extractDocInsights(tool, 'general', snippets);
      if (insights.bestPractices.length > 0 || insights.rateLimits.length > 0) {
        enrichments.push({
          tool,
          action: '_general_best_practices',
          status: 'info',
          searchQuery: query,
          docSnippets: snippets.slice(0, 2),
          insights,
          findings: [
            ...insights.bestPractices,
            ...insights.rateLimits.map((r) => `Rate limit: ${r}`),
          ],
          priority: 'low',
          suggestedFix: 'Review best practices for this tool',
        });
      }
      process.stdout.write(
        `  ${C.dim}✓${C.reset}  ${tool} best-practices  ${C.dim}${Date.now() - t}ms${C.reset}\n`
      );
    } catch (e) {
      process.stdout.write(
        `  ${C.yellow}⚠${C.reset}  ${tool} best-practices: ${String(e).slice(0, 60)}\n`
      );
    }
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  log('');

  // Enrich failed/all actions
  for (const entry of allToEnrich) {
    const query = buildSearchQuery(entry.tool, entry.action, entry.error);
    const t = Date.now();

    try {
      const snippets = await searchDocs(query);
      const insights = extractDocInsights(entry.tool, entry.action, snippets);
      const findings = compareWithKnown(entry.tool, entry.action, entry.error, insights);

      // Determine priority
      let priority: EnrichmentEntry['priority'] = 'low';
      if (entry.status === 'fail') {
        if (entry.error?.includes('UNAUTHENTICATED')) priority = 'critical';
        else if (entry.error?.includes('INVALID_ARGUMENT') || entry.error?.includes('PERMISSION'))
          priority = 'high';
        else priority = 'medium';
      }

      // Build suggested fix
      let suggestedFix = 'Check fixture params against official API docs';
      if (entry.error?.includes('UNAUTHENTICATED'))
        suggestedFix = 'Run sheets_auth.login to refresh OAuth token';
      else if (entry.error?.includes('NOT_FOUND'))
        suggestedFix = 'Verify fixture uses valid spreadsheetId and existing range/sheet name';
      else if (entry.error?.includes('INVALID_ARGUMENT'))
        suggestedFix = `Add missing required param. Docs: ${insights.requiredParams.slice(0, 3).join(', ')}`;
      else if (entry.error?.includes('Timeout'))
        suggestedFix =
          'Increase timeout or check if action needs special setup (OAuth, BigQuery project, etc.)';
      else if (findings.length > 0) suggestedFix = findings[0] ?? suggestedFix;

      enrichments.push({
        tool: entry.tool,
        action: entry.action,
        status: entry.status,
        error: entry.error,
        searchQuery: query,
        docSnippets: snippets.slice(0, 3),
        insights,
        findings,
        priority,
        suggestedFix,
      });

      const icon = entry.status === 'fail' ? `${C.red}✗` : `${C.dim}○`;
      process.stdout.write(
        `  ${icon}${C.reset}  ${entry.tool}.${entry.action}  ${C.dim}${Date.now() - t}ms${C.reset}  ${C.dim}${findings.length} findings${C.reset}\n`
      );
      if (VERBOSE && snippets.length > 0) {
        process.stdout.write(`    ${C.dim}${snippets[0]?.slice(0, 200)}${C.reset}\n`);
      }
    } catch (e) {
      process.stdout.write(
        `  ${C.yellow}⚠${C.reset}  ${entry.tool}.${entry.action}  API error: ${String(e).slice(0, 60)}\n`
      );
      enrichments.push({
        tool: entry.tool,
        action: entry.action,
        status: entry.status,
        error: entry.error,
        searchQuery: query,
        docSnippets: [],
        insights: {
          officialParams: [],
          requiredParams: [],
          deprecatedPatterns: [],
          bestPractices: [],
          rateLimits: [],
        },
        findings: ['Could not fetch docs — check API key and network'],
        priority: 'low',
        suggestedFix: 'Manual review needed',
      });
    }

    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  // Summary
  const critical = enrichments.filter((e) => e.priority === 'critical').length;
  const high = enrichments.filter((e) => e.priority === 'high').length;
  const medium = enrichments.filter((e) => e.priority === 'medium').length;
  const withFindings = enrichments.filter((e) => e.findings.length > 0).length;

  log(`\n${C.cyan}${'─'.repeat(60)}${C.reset}`);
  log(`${C.bold}Knowledge Enrichment Complete${C.reset}`);
  log(`  Enriched  : ${enrichments.length}`);
  log(`  With findings: ${withFindings}`);
  log(`  Critical  : ${C.red}${critical}${C.reset}`);
  log(`  High      : ${C.yellow}${high}${C.reset}`);
  log(`  Medium    : ${medium}`);

  mkdirSync(OUT_DIR, { recursive: true });
  const output = {
    timestamp: new Date().toISOString(),
    probeTimestamp: probe.actions[0] ? new Date().toISOString() : null,
    totalEnriched: enrichments.length,
    summary: { critical, high, medium, withFindings },
    enrichments,
  };
  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  log(`\n${C.green}Results written: ${OUT_FILE}${C.reset}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
