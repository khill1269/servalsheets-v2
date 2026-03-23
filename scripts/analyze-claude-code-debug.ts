#!/usr/bin/env tsx
/**
 * Analyze Claude Code debug logs and extract recurring issues.
 *
 * Outputs:
 * - .agent-context/recurring-issues.json
 * - .agent-context/learning-memory.md
 */

import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

type Severity = 'critical' | 'high' | 'medium' | 'low';

interface IssueRule {
  id: string;
  title: string;
  severity: Severity;
  test: (message: string) => boolean;
  recommendation: string;
  prevention: string;
}

interface IssueSample {
  file: string;
  line: number;
  timestamp: string;
  message: string;
}

interface IssueAggregate {
  id: string;
  title: string;
  severity: Severity;
  occurrences: number;
  files: Set<string>;
  firstSeen?: string;
  lastSeen?: string;
  samples: IssueSample[];
  recommendation: string;
  prevention: string;
}

interface AnalysisStats {
  filesScanned: number;
  linesScanned: number;
  timestampedLines: number;
  errorLines: number;
  warnLines: number;
}

interface Options {
  debugDir: string;
  maxFiles: number;
  maxLinesPerFile: number;
  outputJson: string;
  outputMemory: string;
}

const DEFAULT_OPTIONS: Options = {
  debugDir: path.join(homedir(), '.claude', 'debug'),
  maxFiles: 120,
  maxLinesPerFile: 0,
  outputJson: '.agent-context/recurring-issues.json',
  outputMemory: '.agent-context/learning-memory.md',
};

const ISSUE_RULES: IssueRule[] = [
  {
    id: 'missing_remote_settings',
    title: 'Missing ~/.claude/remote-settings.json',
    severity: 'medium',
    test: (message) => message.includes('remote-settings.json') && message.includes('enoent'),
    recommendation:
      "Create the file once to remove repeated startup ENOENT noise: `mkdir -p ~/.claude && [ -f ~/.claude/remote-settings.json ] || echo '{}' > ~/.claude/remote-settings.json`.",
    prevention: 'Keep ~/.claude/remote-settings.json present even if remote settings are unused.',
  },
  {
    id: 'telemetry_export_failures',
    title: 'Telemetry export/network failures',
    severity: 'low',
    test: (message) =>
      message.includes('failed to export') ||
      message.includes('1p event logging') ||
      message.includes('otel diag error') ||
      message.includes('metrics export failed'),
    recommendation:
      'If telemetry is not needed, disable it in Claude env (CLAUDE_CODE_ENABLE_TELEMETRY=0) to reduce error spam and retries.',
    prevention:
      'Use telemetry only when your network path can reach the telemetry endpoint reliably.',
  },
  {
    id: 'ide_not_connected',
    title: 'IDE MCP not connected',
    severity: 'medium',
    test: (message) => message.includes('mcp server "ide"') && message.includes('not connected'),
    recommendation:
      'Disable the IDE MCP server when running in terminal-only mode, or reconnect the editor integration before diagnostics calls.',
    prevention:
      'Avoid agent flows that assume IDE tools are available unless editor MCP is connected.',
  },
  {
    id: 'read_directory_error',
    title: 'Read tool used on a directory (EISDIR)',
    severity: 'high',
    test: (message) => message.includes('eisdir: illegal operation on a directory'),
    recommendation:
      'Add path-type checks before Read operations and use Glob first to confirm file targets.',
    prevention:
      'Never call Read on repository roots or directories; resolve file paths explicitly first.',
  },
  {
    id: 'file_not_found',
    title: 'Read/Edit target file not found',
    severity: 'high',
    test: (message) => message.includes('file does not exist'),
    recommendation:
      'Use Glob/rg to resolve exact paths before opening files, especially after refactors.',
    prevention: 'Always verify file existence before Read/Edit/Write calls.',
  },
  {
    id: 'read_token_exceeded',
    title: 'Read token budget exceeded',
    severity: 'high',
    test: (message) => message.includes('maxfilereadtokenexceedederror'),
    recommendation:
      'Use paginated reads (offset/limit) or narrower ranges when reading large files.',
    prevention: 'Avoid full-file reads on large sources; chunk by section.',
  },
  {
    id: 'mcp_request_timeout',
    title: 'MCP request timeout',
    severity: 'high',
    test: (message) =>
      message.includes('mcp error -32001') ||
      (message.includes('request timed out') && message.includes('mcp')),
    recommendation:
      'Increase timeout budgets for long actions and avoid parallel heavy operations against the same MCP server.',
    prevention:
      'Split heavy workflows into smaller requests and monitor MCP health before retries.',
  },
  {
    id: 'mcp_connection_closed',
    title: 'MCP connection closed/interrupted',
    severity: 'high',
    test: (message) =>
      message.includes('mcp connection closed') ||
      message.includes('previous connection is closed') ||
      message.includes('socket closed'),
    recommendation:
      'Stabilize server lifecycle (single start, clean shutdown) and avoid frequent restarts during active requests.',
    prevention: 'Keep the MCP process persistent during sessions instead of restarting mid-task.',
  },
  {
    id: 'tool_unavailable',
    title: 'Tool unavailable in current context',
    severity: 'medium',
    test: (message) =>
      message.includes('is not available') ||
      message.includes('tool not available') ||
      message.includes('cannot use tool'),
    recommendation: 'Tighten agent instructions so tool lists match environment capabilities.',
    prevention: 'Validate tool availability early in the task before planning.',
  },
];

function parseArgs(argv: string[]): Options {
  const options = { ...DEFAULT_OPTIONS };

  for (const arg of argv) {
    if (arg.startsWith('--debug-dir=')) {
      options.debugDir = arg.slice('--debug-dir='.length);
    } else if (arg.startsWith('--max-files=')) {
      options.maxFiles = Number(arg.slice('--max-files='.length)) || DEFAULT_OPTIONS.maxFiles;
    } else if (arg.startsWith('--max-lines-per-file=')) {
      options.maxLinesPerFile = Number(arg.slice('--max-lines-per-file='.length)) || 0;
    } else if (arg.startsWith('--output-json=')) {
      options.outputJson = arg.slice('--output-json='.length);
    } else if (arg.startsWith('--output-memory=')) {
      options.outputMemory = arg.slice('--output-memory='.length);
    }
  }

  return options;
}

function parseTimestampedLine(
  line: string
): { timestamp: string; level: string; message: string } | null {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)\s+\[([A-Z]+)\]\s+(.*)$/);
  if (!match) return null;

  return {
    timestamp: match[1],
    level: match[2],
    message: match[3],
  };
}

function normalizeMessage(message: string): string {
  return message.toLowerCase();
}

function ensureIssue(aggregates: Map<string, IssueAggregate>, rule: IssueRule): IssueAggregate {
  const existing = aggregates.get(rule.id);
  if (existing) return existing;

  const created: IssueAggregate = {
    id: rule.id,
    title: rule.title,
    severity: rule.severity,
    occurrences: 0,
    files: new Set<string>(),
    samples: [],
    recommendation: rule.recommendation,
    prevention: rule.prevention,
  };
  aggregates.set(rule.id, created);
  return created;
}

function keepEarliest(current: string | undefined, candidate: string): string {
  if (!current) return candidate;
  return candidate < current ? candidate : current;
}

function keepLatest(current: string | undefined, candidate: string): string {
  if (!current) return candidate;
  return candidate > current ? candidate : current;
}

async function collectLogFiles(debugDir: string, maxFiles: number): Promise<string[]> {
  const entries = await readdir(debugDir);
  const files = entries.filter((name) => name.endsWith('.txt'));

  const withStat = await Promise.all(
    files.map(async (name) => {
      const filePath = path.join(debugDir, name);
      const st = await stat(filePath);
      return { filePath, mtimeMs: st.mtimeMs };
    })
  );

  withStat.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return withStat.slice(0, maxFiles).map((entry) => entry.filePath);
}

async function analyzeFile(
  filePath: string,
  aggregates: Map<string, IssueAggregate>,
  stats: AnalysisStats,
  maxLinesPerFile: number
): Promise<void> {
  const fileName = path.basename(filePath);
  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  for await (const line of rl) {
    lineNo += 1;
    stats.linesScanned += 1;

    if (maxLinesPerFile > 0 && lineNo > maxLinesPerFile) {
      break;
    }

    const parsed = parseTimestampedLine(line);
    if (!parsed) continue;

    stats.timestampedLines += 1;
    if (parsed.level === 'ERROR') stats.errorLines += 1;
    if (parsed.level === 'WARN') stats.warnLines += 1;

    const normalized = normalizeMessage(parsed.message);
    const matchingRule = ISSUE_RULES.find((rule) => rule.test(normalized));
    if (!matchingRule) continue;

    const issue = ensureIssue(aggregates, matchingRule);
    issue.occurrences += 1;
    issue.files.add(fileName);
    issue.firstSeen = keepEarliest(issue.firstSeen, parsed.timestamp);
    issue.lastSeen = keepLatest(issue.lastSeen, parsed.timestamp);

    if (issue.samples.length < 4) {
      issue.samples.push({
        file: fileName,
        line: lineNo,
        timestamp: parsed.timestamp,
        message: parsed.message.slice(0, 320),
      });
    }
  }
}

function sortIssues(aggregates: Map<string, IssueAggregate>): IssueAggregate[] {
  return [...aggregates.values()].sort((a, b) => b.occurrences - a.occurrences);
}

function formatIssueLine(issue: IssueAggregate): string {
  return `- ${issue.title}: ${issue.occurrences} occurrences (${issue.severity})`;
}

function buildMemoryMarkdown(
  issues: IssueAggregate[],
  stats: AnalysisStats,
  options: Options
): string {
  const generatedAt = new Date().toISOString();
  const top = issues.slice(0, 8);
  const preventionLines = Array.from(new Set(top.map((issue) => issue.prevention)));
  const recommendations = top.map((issue) => `${issue.title}: ${issue.recommendation}`);

  const lines: string[] = [];
  lines.push('# Claude Debug Learning Memory');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push(`Debug directory: ${options.debugDir}`);
  lines.push(`Files scanned: ${stats.filesScanned}`);
  lines.push(`Timestamped log lines: ${stats.timestampedLines}`);
  lines.push(`Error lines: ${stats.errorLines}`);
  lines.push(`Warn lines: ${stats.warnLines}`);
  lines.push('');
  lines.push('## Recurring Issues');

  if (top.length === 0) {
    lines.push('- No recurring issues detected in scanned files.');
  } else {
    for (const issue of top) {
      lines.push(formatIssueLine(issue));
    }
  }

  lines.push('');
  lines.push('## Priority Fixes');
  if (recommendations.length === 0) {
    lines.push('- None.');
  } else {
    for (const recommendation of recommendations) {
      lines.push(`- ${recommendation}`);
    }
  }

  lines.push('');
  lines.push('## Guardrails For Agents');
  lines.push('- Resolve file paths via Glob/rg before Read/Edit.');
  lines.push('- Never Read directory paths.');
  lines.push('- Use offset/limit chunked reads for large files.');
  for (const prevention of preventionLines) {
    lines.push(`- ${prevention}`);
  }

  lines.push('');
  lines.push('## Regeneration Commands');
  lines.push('- `npm run claude:logs`');
  lines.push('- `npm run claude:learn`');
  lines.push('');
  lines.push(
    'This file is generated from runtime logs and is designed to be consumed by agent prompts/instructions.'
  );

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const stats: AnalysisStats = {
    filesScanned: 0,
    linesScanned: 0,
    timestampedLines: 0,
    errorLines: 0,
    warnLines: 0,
  };
  const aggregates = new Map<string, IssueAggregate>();

  const files = await collectLogFiles(options.debugDir, options.maxFiles);
  stats.filesScanned = files.length;

  for (const filePath of files) {
    await analyzeFile(filePath, aggregates, stats, options.maxLinesPerFile);
  }

  const issues = sortIssues(aggregates);
  const jsonOutput = {
    generatedAt: new Date().toISOString(),
    debugDir: options.debugDir,
    options: {
      maxFiles: options.maxFiles,
      maxLinesPerFile: options.maxLinesPerFile,
    },
    stats: {
      ...stats,
    },
    recurringIssues: issues.map((issue) => ({
      ...issue,
      files: [...issue.files].sort(),
    })),
  };

  await mkdir(path.dirname(options.outputJson), { recursive: true });
  await mkdir(path.dirname(options.outputMemory), { recursive: true });
  await writeFile(options.outputJson, JSON.stringify(jsonOutput, null, 2), 'utf8');

  const memoryMarkdown = buildMemoryMarkdown(issues, stats, options);
  await writeFile(options.outputMemory, memoryMarkdown, 'utf8');

  const top = issues.slice(0, 5);
  console.log(
    `Scanned ${stats.filesScanned} debug files (${stats.timestampedLines} timestamped lines).`
  );
  console.log(`Detected ${issues.length} recurring issue categories.`);
  if (top.length > 0) {
    console.log('Top recurring issues:');
    for (const issue of top) {
      console.log(`  - ${issue.title}: ${issue.occurrences}`);
    }
  }
  console.log(`Wrote ${options.outputJson}`);
  console.log(`Wrote ${options.outputMemory}`);
}

main().catch((error) => {
  console.error('Failed to analyze Claude debug logs.');
  console.error(error);
  process.exit(1);
});
