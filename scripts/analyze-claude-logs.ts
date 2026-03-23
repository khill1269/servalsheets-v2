#!/usr/bin/env tsx
/**
 * Claude Desktop Log Analysis for ServalSheets
 *
 * Analyzes Claude Desktop logs to identify patterns where Claude makes mistakes
 * and generates recommendations for improving AI instructions.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import * as path from 'node:path';
import { homedir } from 'node:os';

// ============================================================================
// Types
// ============================================================================

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  [key: string]: unknown;
}

interface ToolCall {
  timestamp: Date;
  requestId?: string;
  traceId?: string;
  toolName?: string;
  action?: string;
  params?: Record<string, unknown>;
  error?: ErrorDetail;
  success?: boolean;
  rawEntry: LogEntry;
}

interface ErrorDetail {
  code?: string;
  message?: string;
  details?: unknown;
}

interface Session {
  sessionId: string;
  startTime: Date;
  endTime: Date;
  entries: ToolCall[];
  errors: ToolCall[];
}

interface Pattern {
  category: 'wrong_tool' | 'validation_error' | 'inefficient' | 'auth_issue';
  severity: 'high' | 'medium' | 'low';
  occurrences: number;
  sessions: string[];
  examples: ToolCall[];
  description: string;
  rootCause: string;
  suggestedFix: {
    file: string;
    lineRange?: string;
    before?: string;
    after?: string;
  };
}

// ============================================================================
// Configuration
// ============================================================================

const LOG_FILES = [
  path.join(homedir(), 'Library/Logs/Claude/mcp-server-servalsheets.log'),
  path.join(homedir(), 'Library/Logs/Claude/mcp-server-servalsheets-new.log'),
];

const SESSION_GAP_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Log Parsing
// ============================================================================

async function parseLogFile(filePath: string): Promise<ToolCall[]> {
  const entries: ToolCall[] = [];
  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  console.log(`\n📖 Parsing log file: ${path.basename(filePath)}`);
  let lineCount = 0;

  for await (const line of rl) {
    lineCount++;
    if (!line.trim()) continue;

    try {
      // Try to parse as JSON
      const entry = JSON.parse(line) as LogEntry;

      // Extract tool call information
      if (isToolCallEntry(entry)) {
        entries.push(extractToolCall(entry));
      }
    } catch (e) {
      // Not JSON, might be plain text log
      if (line.includes('Error:') || line.includes('ERROR') || line.includes('WARN')) {
        // Extract error from text format
        const toolCall = extractToolCallFromText(line);
        if (toolCall) {
          entries.push(toolCall);
        }
      }
    }
  }

  console.log(`   Parsed ${lineCount} lines, found ${entries.length} tool call entries`);
  return entries;
}

function isToolCallEntry(entry: LogEntry): boolean {
  // Check if this is a tool call or error entry
  const msg = entry.message?.toLowerCase() || '';
  const hasToolInfo =
    msg.includes('tool') ||
    msg.includes('sheets_') ||
    msg.includes('error') ||
    msg.includes('validation') ||
    entry.level === 'error';

  return hasToolInfo;
}

function extractToolCall(entry: LogEntry): ToolCall {
  const toolCall: ToolCall = {
    timestamp: new Date(entry.timestamp || Date.now()),
    requestId: entry.requestId as string,
    traceId: entry.traceId as string,
    rawEntry: entry,
  };

  // Extract tool name and action
  const msg = entry.message || '';
  const toolMatch = msg.match(/sheets_(\w+)/);
  if (toolMatch) {
    toolCall.toolName = `sheets_${toolMatch[1]}`;
  }

  const actionMatch = msg.match(/action[:\s]+"?(\w+)"?/i);
  if (actionMatch) {
    toolCall.action = actionMatch[1];
  }

  // Extract error information
  if (entry.level === 'error' || msg.includes('error') || msg.includes('fail')) {
    toolCall.error = {
      code: (entry.code as string) || extractErrorCode(msg),
      message: msg,
      details: entry,
    };
    toolCall.success = false;
  } else if (msg.includes('success')) {
    toolCall.success = true;
  }

  // Extract params if available
  if (entry.params || entry.arguments) {
    toolCall.params = (entry.params || entry.arguments) as Record<string, unknown>;
  }

  return toolCall;
}

function extractToolCallFromText(line: string): ToolCall | null {
  // Extract from text format logs
  const timestampMatch = line.match(/\[([\d-:TZ.]+)\]/);
  const toolMatch = line.match(/sheets_(\w+)/);

  if (!toolMatch) return null;

  return {
    timestamp: timestampMatch ? new Date(timestampMatch[1]) : new Date(),
    toolName: `sheets_${toolMatch[1]}`,
    rawEntry: { timestamp: '', level: 'info', message: line },
  };
}

function extractErrorCode(message: string): string | undefined {
  const codeMatch = message.match(/\b([A-Z_]{3,})\b/);
  return codeMatch?.[1];
}

// ============================================================================
// Session Grouping
// ============================================================================

function groupIntoSessions(entries: ToolCall[]): Session[] {
  if (entries.length === 0) return [];

  // Sort by timestamp
  const sorted = [...entries].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const sessions: Session[] = [];
  let currentSession: Session = {
    sessionId: `session-1`,
    startTime: sorted[0].timestamp,
    endTime: sorted[0].timestamp,
    entries: [sorted[0]],
    errors: sorted[0].error ? [sorted[0]] : [],
  };

  for (let i = 1; i < sorted.length; i++) {
    const entry = sorted[i];
    const prevEntry = sorted[i - 1];
    const gap = entry.timestamp.getTime() - prevEntry.timestamp.getTime();

    if (gap > SESSION_GAP_MS) {
      // New session
      sessions.push(currentSession);
      currentSession = {
        sessionId: `session-${sessions.length + 1}`,
        startTime: entry.timestamp,
        endTime: entry.timestamp,
        entries: [entry],
        errors: entry.error ? [entry] : [],
      };
    } else {
      // Same session
      currentSession.entries.push(entry);
      currentSession.endTime = entry.timestamp;
      if (entry.error) {
        currentSession.errors.push(entry);
      }
    }
  }

  sessions.push(currentSession);
  return sessions;
}

// ============================================================================
// Pattern Detection
// ============================================================================

function detectWrongToolSelection(sessions: Session[]): Pattern[] {
  const patterns: Pattern[] = [];

  for (const session of sessions) {
    // Detect: Multiple sequential reads (should use batch_read)
    const sequentialReads = detectSequentialReads(session);
    if (sequentialReads.length >= 3) {
      patterns.push({
        category: 'wrong_tool',
        severity: 'high',
        occurrences: sequentialReads.length,
        sessions: [session.sessionId],
        examples: sequentialReads.slice(0, 3),
        description: `Used ${sequentialReads.length} sequential sheets_data.read calls instead of batch_read`,
        rootCause: 'Batch operation guidance not prominent enough in tool description',
        suggestedFix: {
          file: 'src/schemas/descriptions.ts',
          lineRange: '58-62',
        },
      });
    }

    // Detect: Using write instead of append
    const writeForAppend = detectWriteInsteadOfAppend(session);
    if (writeForAppend) {
      patterns.push({
        category: 'wrong_tool',
        severity: 'medium',
        occurrences: 1,
        sessions: [session.sessionId],
        examples: [writeForAppend],
        description: 'Used sheets_data.write to add rows instead of append',
        rootCause: 'append vs write guidance not clear in decision guide',
        suggestedFix: {
          file: 'src/schemas/descriptions.ts',
          lineRange: '59',
        },
      });
    }
  }

  return patterns;
}

function detectRepeatedValidationErrors(sessions: Session[]): Pattern[] {
  const patterns: Pattern[] = [];

  for (const session of sessions) {
    const errorCounts = new Map<string, ToolCall[]>();

    for (const entry of session.errors) {
      const code = entry.error?.code;
      if (code && (code.includes('VALIDATION') || code.includes('INVALID'))) {
        if (!errorCounts.has(code)) {
          errorCounts.set(code, []);
        }
        errorCounts.get(code)!.push(entry);
      }
    }

    // Find repeated errors
    for (const [code, occurrences] of errorCounts) {
      if (occurrences.length >= 2) {
        patterns.push({
          category: 'validation_error',
          severity: 'high',
          occurrences: occurrences.length,
          sessions: [session.sessionId],
          examples: occurrences.slice(0, 3),
          description: `Repeated ${code} error ${occurrences.length} times in session`,
          rootCause: 'Error message or validation guidance unclear',
          suggestedFix: {
            file: 'src/schemas/descriptions.ts',
          },
        });
      }
    }

    // Detect range format errors specifically
    const rangeErrors = session.errors.filter(
      (e) =>
        e.error?.message?.toLowerCase().includes('range') ||
        e.error?.message?.toLowerCase().includes('a1')
    );
    if (rangeErrors.length >= 2) {
      patterns.push({
        category: 'validation_error',
        severity: 'high',
        occurrences: rangeErrors.length,
        sessions: [session.sessionId],
        examples: rangeErrors.slice(0, 3),
        description: `Range format validation errors (${rangeErrors.length} times)`,
        rootCause: 'Range format requirement not prominent enough',
        suggestedFix: {
          file: 'src/schemas/descriptions.ts',
          lineRange: '72-73',
        },
      });
    }
  }

  return patterns;
}

function detectInefficientPatterns(sessions: Session[]): Pattern[] {
  const patterns: Pattern[] = [];

  for (const session of sessions) {
    // Detect individual format calls (should batch)
    const formatCalls = session.entries.filter(
      (e) => e.toolName === 'sheets_format' && !e.action?.includes('batch')
    );

    if (formatCalls.length >= 3) {
      // Check if within 1 minute
      const timeSpan =
        formatCalls[formatCalls.length - 1].timestamp.getTime() -
        formatCalls[0].timestamp.getTime();
      if (timeSpan < 60000) {
        patterns.push({
          category: 'inefficient',
          severity: 'medium',
          occurrences: formatCalls.length,
          sessions: [session.sessionId],
          examples: formatCalls.slice(0, 3),
          description: `${formatCalls.length} individual format calls instead of batch_format`,
          rootCause: 'batch_format benefits not emphasized enough',
          suggestedFix: {
            file: 'src/schemas/descriptions.ts',
          },
        });
      }
    }

    // Detect no use of sheets_analyze before operations
    const hasAnalyze = session.entries.some((e) => e.toolName === 'sheets_analyze');
    const hasDataOps = session.entries.some(
      (e) => e.toolName === 'sheets_data' && e.action !== 'read'
    );
    if (!hasAnalyze && hasDataOps) {
      patterns.push({
        category: 'inefficient',
        severity: 'low',
        occurrences: 1,
        sessions: [session.sessionId],
        examples: [],
        description: 'Started data operations without sheets_analyze first',
        rootCause: 'Workflow chain guidance not followed',
        suggestedFix: {
          file: 'src/mcp/features-2025-11-25.ts',
          lineRange: '387-417',
        },
      });
    }
  }

  return patterns;
}

function detectAuthIssues(sessions: Session[]): Pattern[] {
  const patterns: Pattern[] = [];

  for (const session of sessions) {
    const authErrors = session.errors.filter(
      (e) =>
        e.error?.code?.includes('AUTH') ||
        e.error?.code?.includes('PERMISSION') ||
        e.error?.message?.toLowerCase().includes('permission') ||
        e.error?.message?.toLowerCase().includes('unauthorized')
    );

    if (authErrors.length > 0) {
      // Check if auth was checked first
      const authCheck = session.entries.find((e) => e.toolName === 'sheets_auth');
      if (!authCheck) {
        patterns.push({
          category: 'auth_issue',
          severity: 'high',
          occurrences: authErrors.length,
          sessions: [session.sessionId],
          examples: authErrors.slice(0, 2),
          description: 'Auth/permission errors without prior auth check',
          rootCause: 'Prerequisite workflow not enforced',
          suggestedFix: {
            file: 'src/mcp/features-2025-11-25.ts',
            lineRange: '360-373',
          },
        });
      } else {
        patterns.push({
          category: 'auth_issue',
          severity: 'medium',
          occurrences: authErrors.length,
          sessions: [session.sessionId],
          examples: authErrors.slice(0, 2),
          description: 'Permission errors despite auth check',
          rootCause: 'Permission checking guidance unclear',
          suggestedFix: {
            file: 'src/utils/error-factory.ts',
          },
        });
      }
    }
  }

  return patterns;
}

// Helper detection functions
function detectSequentialReads(session: Session): ToolCall[] {
  const reads: ToolCall[] = [];
  const timeWindow = 60000; // 1 minute

  for (let i = 0; i < session.entries.length; i++) {
    const entry = session.entries[i];
    if (entry.toolName === 'sheets_data' && entry.action === 'read') {
      // Check if there are more reads within time window
      const subsequentReads = [entry];
      for (let j = i + 1; j < session.entries.length; j++) {
        const next = session.entries[j];
        if (next.timestamp.getTime() - entry.timestamp.getTime() > timeWindow) break;
        if (next.toolName === 'sheets_data' && next.action === 'read') {
          subsequentReads.push(next);
        }
      }
      if (subsequentReads.length >= 3) {
        return subsequentReads;
      }
    }
  }

  return reads;
}

function detectWriteInsteadOfAppend(session: Session): ToolCall | null {
  // Look for patterns suggesting append would be better
  for (const entry of session.entries) {
    if (entry.toolName === 'sheets_data' && entry.action === 'write') {
      // Check if error suggests it should be append
      if (
        entry.error?.message?.toLowerCase().includes('append') ||
        entry.error?.message?.toLowerCase().includes('add row')
      ) {
        return entry;
      }
    }
  }
  return null;
}

// ============================================================================
// Analysis and Report Generation
// ============================================================================

function analyzePatterns(patterns: Pattern[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('📊 PATTERN ANALYSIS SUMMARY');
  console.log('='.repeat(80));

  const byCategory = {
    wrong_tool: patterns.filter((p) => p.category === 'wrong_tool'),
    validation_error: patterns.filter((p) => p.category === 'validation_error'),
    inefficient: patterns.filter((p) => p.category === 'inefficient'),
    auth_issue: patterns.filter((p) => p.category === 'auth_issue'),
  };

  console.log(`\n🔧 Wrong Tool Selection: ${byCategory.wrong_tool.length} patterns`);
  console.log(`❌ Validation Errors: ${byCategory.validation_error.length} patterns`);
  console.log(`⚡ Inefficient Patterns: ${byCategory.inefficient.length} patterns`);
  console.log(`🔒 Auth/Permission Issues: ${byCategory.auth_issue.length} patterns`);

  console.log(`\n📈 Total Patterns Detected: ${patterns.length}`);

  const highSeverity = patterns.filter((p) => p.severity === 'high').length;
  const mediumSeverity = patterns.filter((p) => p.severity === 'medium').length;
  const lowSeverity = patterns.filter((p) => p.severity === 'low').length;

  console.log(`\n🚨 High Severity: ${highSeverity}`);
  console.log(`⚠️  Medium Severity: ${mediumSeverity}`);
  console.log(`ℹ️  Low Severity: ${lowSeverity}`);

  // Top patterns by occurrence
  const sorted = [...patterns].sort((a, b) => b.occurrences - a.occurrences);
  console.log(`\n📋 Top 5 Most Common Patterns:`);
  sorted.slice(0, 5).forEach((p, i) => {
    console.log(`${i + 1}. [${p.category}] ${p.description} (${p.occurrences} occurrences)`);
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('🔍 ServalSheets Claude Desktop Log Analysis');
  console.log('==========================================\n');

  // Phase 1: Extract and parse logs
  console.log('Phase 1: Extracting logs...');
  const allEntries: ToolCall[] = [];

  for (const logFile of LOG_FILES) {
    try {
      const entries = await parseLogFile(logFile);
      allEntries.push(...entries);
    } catch (error) {
      console.error(`Failed to parse ${logFile}:`, error);
    }
  }

  console.log(`\n✅ Total entries extracted: ${allEntries.length}`);

  // Phase 2: Group into sessions
  console.log('\nPhase 2: Grouping into sessions...');
  const sessions = groupIntoSessions(allEntries);
  console.log(`✅ Found ${sessions.length} conversation sessions`);

  const totalErrors = sessions.reduce((sum, s) => sum + s.errors.length, 0);
  console.log(`   Total errors across all sessions: ${totalErrors}`);

  // Phase 3: Detect patterns
  console.log('\nPhase 3: Detecting patterns...');
  const allPatterns: Pattern[] = [
    ...detectWrongToolSelection(sessions),
    ...detectRepeatedValidationErrors(sessions),
    ...detectInefficientPatterns(sessions),
    ...detectAuthIssues(sessions),
  ];

  console.log(`✅ Detected ${allPatterns.length} patterns`);

  // Phase 4: Analyze and report
  analyzePatterns(allPatterns);

  console.log('\n' + '='.repeat(80));
  console.log('✅ Analysis complete! Detailed report generation next...');
  console.log('='.repeat(80));
}

main().catch(console.error);
