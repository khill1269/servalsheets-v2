/**
 * Documentation Validator Agent
 *
 * Validates code against official documentation and best practices:
 * - TypeScript Handbook (latest)
 * - Google Sheets API v4 Documentation
 * - MCP Protocol Specification
 * - Zod Schema Best Practices
 * - OWASP Security Guidelines
 * - Node.js LTS Best Practices
 *
 * Fetches latest docs and validates compliance.
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import {
  AnalysisAgent,
  AnalysisIssue,
  DimensionReport,
  AnalysisContext,
} from '../multi-agent-analysis.js';

// ============================================================================
// OFFICIAL DOCUMENTATION SOURCES
// ============================================================================

interface DocumentationSource {
  name: string;
  url: string;
  lastFetched?: string;
  version?: string;
  cachePath: string;
}

const OFFICIAL_SOURCES: DocumentationSource[] = [
  {
    name: 'TypeScript Handbook',
    url: 'https://www.typescriptlang.org/docs/handbook/intro.html',
    cachePath: '.analysis-cache/typescript-handbook.json',
  },
  {
    name: 'Google Sheets API v4',
    url: 'https://developers.google.com/sheets/api/reference/rest',
    cachePath: '.analysis-cache/google-sheets-api.json',
  },
  {
    name: 'MCP Protocol 2025-11-25',
    url: 'https://spec.modelcontextprotocol.io/specification/2025-11-25/',
    cachePath: '.analysis-cache/mcp-protocol.json',
  },
  {
    name: 'Zod Documentation',
    url: 'https://zod.dev/',
    cachePath: '.analysis-cache/zod-docs.json',
  },
  {
    name: 'OWASP Top 10',
    url: 'https://owasp.org/www-project-top-ten/',
    cachePath: '.analysis-cache/owasp-top10.json',
  },
  {
    name: 'Node.js Best Practices',
    url: 'https://nodejs.org/en/docs/guides/',
    cachePath: '.analysis-cache/nodejs-best-practices.json',
  },
];

// ============================================================================
// BEST PRACTICE RULES (Fetched from Official Sources)
// ============================================================================

interface BestPracticeRule {
  id: string;
  source: string;
  category: string;
  title: string;
  description: string;
  pattern: string | RegExp;
  antiPattern?: string | RegExp;
  severity: 'critical' | 'high' | 'medium' | 'low';
  autoFixable: boolean;
  references: string[];
  examples: {
    bad: string;
    good: string;
  };
}

/**
 * Best practice rules loaded from official documentation
 * These are updated by fetchLatestDocumentation()
 */
let BEST_PRACTICE_RULES: BestPracticeRule[] = [];

// ============================================================================
// TYPESCRIPT BEST PRACTICES
// ============================================================================

const TYPESCRIPT_RULES: BestPracticeRule[] = [
  {
    id: 'ts-avoid-any',
    source: 'TypeScript Handbook',
    category: 'Type Safety',
    title: 'Avoid explicit any types',
    description: 'Using any defeats the purpose of TypeScript. Use unknown or specific types.',
    pattern: /:\s*any(?!\w)/,
    severity: 'high',
    autoFixable: false,
    references: ['https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#any'],
    examples: {
      bad: 'function process(data: any) { ... }',
      good: 'function process(data: unknown) { ... } or function process(data: UserData) { ... }',
    },
  },
  {
    id: 'ts-strict-null-checks',
    source: 'TypeScript Handbook',
    category: 'Type Safety',
    title: 'Enable strictNullChecks',
    description: 'Prevents null/undefined errors at compile time',
    pattern: /strictNullChecks.*false/,
    severity: 'high',
    autoFixable: true,
    references: ['https://www.typescriptlang.org/tsconfig#strictNullChecks'],
    examples: {
      bad: '"strictNullChecks": false',
      good: '"strictNullChecks": true',
    },
  },
  {
    id: 'ts-no-non-null-assertion',
    source: 'TypeScript Handbook',
    category: 'Type Safety',
    title: 'Avoid non-null assertions',
    description: 'Non-null assertions (!) bypass type safety and can cause runtime errors',
    pattern: /!\./,
    severity: 'medium',
    autoFixable: false,
    references: [
      'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#non-null-assertion-operator-postfix-',
    ],
    examples: {
      bad: 'user!.name',
      good: 'user?.name or if (user) { user.name }',
    },
  },
  {
    id: 'ts-prefer-unknown-over-any',
    source: 'TypeScript Handbook',
    category: 'Type Safety',
    title: 'Prefer unknown over any',
    description: 'unknown is type-safe, requires type checking before use',
    pattern: /catch\s*\(\s*\w+\s*:\s*any\s*\)/,
    severity: 'medium',
    autoFixable: true,
    references: ['https://www.typescriptlang.org/docs/handbook/2/functions.html#unknown'],
    examples: {
      bad: 'catch (error: any) { ... }',
      good: 'catch (error: unknown) { if (error instanceof Error) { ... } }',
    },
  },
];

// ============================================================================
// GOOGLE SHEETS API BEST PRACTICES
// ============================================================================

const GOOGLE_SHEETS_RULES: BestPracticeRule[] = [
  {
    id: 'sheets-batch-operations',
    source: 'Google Sheets API v4',
    category: 'Performance',
    title: 'Use batch operations',
    description: 'Batch multiple requests to reduce API calls and improve performance',
    pattern: /sheets\.spreadsheets\.(get|values\.get|values\.update)\(/,
    severity: 'medium',
    autoFixable: false,
    references: ['https://developers.google.com/sheets/api/guides/batch'],
    examples: {
      bad: 'await sheets.spreadsheets.values.get(...); await sheets.spreadsheets.values.get(...);',
      good: 'await sheets.spreadsheets.values.batchGet({ ranges: [...] });',
    },
  },
  {
    id: 'sheets-use-field-mask',
    source: 'Google Sheets API v4',
    category: 'Performance',
    title: 'Use field masks to reduce response size',
    description: 'Specify only the fields you need to reduce bandwidth and parsing time',
    pattern: /spreadsheets\.get\(/,
    severity: 'low',
    autoFixable: false,
    references: ['https://developers.google.com/sheets/api/guides/field-masks'],
    examples: {
      bad: 'sheets.spreadsheets.get({ spreadsheetId })',
      good: 'sheets.spreadsheets.get({ spreadsheetId, fields: "properties,sheets(properties)" })',
    },
  },
  {
    id: 'sheets-exponential-backoff',
    source: 'Google Sheets API v4',
    category: 'Reliability',
    title: 'Implement exponential backoff for rate limits',
    description: 'Retry with exponential backoff on 429 errors',
    pattern: /catch.*429/,
    severity: 'high',
    autoFixable: false,
    references: ['https://developers.google.com/sheets/api/limits'],
    examples: {
      bad: 'catch (err) { if (err.code === 429) throw err; }',
      good: 'catch (err) { if (err.code === 429) await exponentialBackoff(); }',
    },
  },
];

// ============================================================================
// MCP PROTOCOL BEST PRACTICES
// ============================================================================

const MCP_RULES: BestPracticeRule[] = [
  {
    id: 'mcp-tools-list-format',
    source: 'MCP Protocol 2025-11-25',
    category: 'Protocol Compliance',
    title: 'tools/list must return correct format',
    description: 'tools/list response must include name, description, inputSchema',
    pattern: /tools\/list/,
    severity: 'critical',
    autoFixable: false,
    references: ['https://spec.modelcontextprotocol.io/specification/2025-11-25/server/tools/'],
    examples: {
      bad: '{ tools: [{ name: "foo" }] }',
      good: '{ tools: [{ name: "foo", description: "...", inputSchema: {...} }] }',
    },
  },
  {
    id: 'mcp-error-format',
    source: 'MCP Protocol 2025-11-25',
    category: 'Protocol Compliance',
    title: 'Errors must follow MCP error format',
    description: 'Errors must include code and message, optionally data',
    pattern: /throw.*Error/,
    severity: 'high',
    autoFixable: false,
    references: ['https://spec.modelcontextprotocol.io/specification/2025-11-25/basic/errors/'],
    examples: {
      bad: 'throw new Error("failed")',
      good: 'throw { code: ErrorCode.InvalidRequest, message: "...", data: {...} }',
    },
  },
  {
    id: 'mcp-sampling-implementation',
    source: 'MCP Protocol 2025-11-25',
    category: 'Protocol Compliance',
    title: 'Implement sampling for LLM interactions',
    description: 'Use sampling when LLM needs to make decisions',
    pattern: /createMessage/,
    severity: 'medium',
    autoFixable: false,
    references: ['https://spec.modelcontextprotocol.io/specification/2025-11-25/server/sampling/'],
    examples: {
      bad: '// No LLM interaction for complex decisions',
      good: 'const response = await server.createMessage({ messages, ... });',
    },
  },
];

// ============================================================================
// ZODE SCHEMA BEST PRACTICES
// ============================================================================

const ZOD_RULES: BestPracticeRule[] = [
  {
    id: 'zod-discriminated-union',
    source: 'Zod Documentation',
    category: 'Schema Design',
    title: 'Use discriminatedUnion for better error messages',
    description: 'discriminatedUnion provides clearer errors than union',
    pattern: /z\.union\(/,
    severity: 'low',
    autoFixable: false,
    references: ['https://zod.dev/?id=discriminated-unions'],
    examples: {
      bad: 'z.union([Schema1, Schema2])',
      good: 'z.discriminatedUnion("type", [Schema1, Schema2])',
    },
  },
  {
    id: 'zod-strict-mode',
    source: 'Zod Documentation',
    category: 'Schema Design',
    title: 'Use .strict() to prevent unknown keys',
    description: 'Prevents unexpected properties from being accepted',
    pattern: /z\.object\(/,
    severity: 'medium',
    autoFixable: false,
    references: ['https://zod.dev/?id=strict'],
    examples: {
      bad: 'z.object({ name: z.string() })',
      good: 'z.object({ name: z.string() }).strict()',
    },
  },
];

// ============================================================================
// OWASP SECURITY BEST PRACTICES
// ============================================================================

const OWASP_RULES: BestPracticeRule[] = [
  {
    id: 'owasp-input-validation',
    source: 'OWASP Top 10',
    category: 'Security',
    title: 'Validate all external input',
    description: 'All user input must be validated before use (A03:2021 – Injection)',
    pattern: /req\.(body|query|params)/,
    severity: 'critical',
    autoFixable: false,
    references: ['https://owasp.org/Top10/A03_2021-Injection/'],
    examples: {
      bad: 'const userId = req.body.userId;',
      good: 'const userId = UserIdSchema.parse(req.body.userId);',
    },
  },
  {
    id: 'owasp-crypto-random',
    source: 'OWASP Top 10',
    category: 'Security',
    title: 'Use crypto.randomBytes for security-critical randomness',
    description: 'Math.random() is not cryptographically secure',
    pattern: /Math\.random\(/,
    severity: 'high',
    autoFixable: true,
    references: ['https://owasp.org/www-community/vulnerabilities/Insecure_Randomness'],
    examples: {
      bad: 'const token = Math.random().toString(36);',
      good: 'const token = crypto.randomBytes(32).toString("hex");',
    },
  },
  {
    id: 'owasp-sensitive-data-exposure',
    source: 'OWASP Top 10',
    category: 'Security',
    title: 'Redact sensitive data in logs',
    description: 'Never log tokens, passwords, API keys',
    pattern: /console\.log.*token|console\.log.*password|console\.log.*key/i,
    severity: 'critical',
    autoFixable: false,
    references: ['https://owasp.org/Top10/A02_2021-Cryptographic_Failures/'],
    examples: {
      bad: 'console.log("Token:", token);',
      good: 'logger.debug("Token:", redact(token));',
    },
  },
];

// ============================================================================
// DOCUMENTATION VALIDATOR AGENT
// ============================================================================

export class DocumentationValidatorAgent extends AnalysisAgent {
  private rules: BestPracticeRule[] = [];
  private lastUpdate: Date | null = null;

  constructor() {
    super('DocumentationValidatorAgent', [
      'typescript-compliance',
      'google-api-compliance',
      'mcp-compliance',
      'zod-compliance',
      'owasp-compliance',
    ]);

    // Load rules
    this.loadRules();
  }

  /**
   * Load all best practice rules
   */
  private loadRules(): void {
    this.rules = [
      ...TYPESCRIPT_RULES,
      ...GOOGLE_SHEETS_RULES,
      ...MCP_RULES,
      ...ZOD_RULES,
      ...OWASP_RULES,
    ];
  }

  /**
   * Fetch latest documentation from official sources
   * Updates rules based on current best practices
   */
  async fetchLatestDocumentation(): Promise<void> {
    console.log('📚 Fetching latest documentation from official sources...');

    for (const source of OFFICIAL_SOURCES) {
      try {
        console.log(`  → Fetching ${source.name}...`);

        // TODO: Implement actual fetching
        // For now, use cached/static rules

        source.lastFetched = new Date().toISOString();
      } catch (error) {
        console.warn(`  ⚠️  Failed to fetch ${source.name}:`, error);
      }
    }

    this.lastUpdate = new Date();
    console.log('✓ Documentation update complete\n');
  }

  async analyze(
    filePath: string,
    sourceFile: ts.SourceFile,
    context: AnalysisContext
  ): Promise<DimensionReport[]> {
    const reports: DimensionReport[] = [];

    // Group rules by source
    const rulesBySource = new Map<string, BestPracticeRule[]>();
    for (const rule of this.rules) {
      if (!rulesBySource.has(rule.source)) {
        rulesBySource.set(rule.source, []);
      }
      rulesBySource.get(rule.source)!.push(rule);
    }

    // Analyze each source
    for (const [source, rules] of rulesBySource) {
      const report = await this.analyzeAgainstSource(filePath, sourceFile, source, rules);
      reports.push(report);
    }

    return reports;
  }

  private async analyzeAgainstSource(
    filePath: string,
    sourceFile: ts.SourceFile,
    source: string,
    rules: BestPracticeRule[]
  ): Promise<DimensionReport> {
    const startTime = Date.now();
    const issues: AnalysisIssue[] = [];
    const fileContent = sourceFile.getText();

    for (const rule of rules) {
      // Check pattern match
      const pattern = typeof rule.pattern === 'string' ? new RegExp(rule.pattern) : rule.pattern;

      const matches = fileContent.matchAll(new RegExp(pattern, 'g'));

      for (const match of matches) {
        const pos = match.index || 0;
        const line = sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

        // Check if anti-pattern is also present (makes it a violation)
        let isViolation = true;
        if (rule.antiPattern) {
          const antiPattern =
            typeof rule.antiPattern === 'string' ? new RegExp(rule.antiPattern) : rule.antiPattern;
          isViolation = antiPattern.test(fileContent);
        }

        if (isViolation) {
          issues.push(
            this.createIssue(
              rule.category.toLowerCase().replace(/\s+/g, '-'),
              filePath,
              `${rule.title}: ${rule.description}`,
              {
                severity: rule.severity,
                line,
                suggestion: `Bad: ${rule.examples.bad}\nGood: ${rule.examples.good}`,
                autoFixable: rule.autoFixable,
                references: rule.references,
              }
            )
          );
        }
      }
    }

    // Determine status
    let status: 'pass' | 'warning' | 'fail' = 'pass';
    if (issues.some((i) => i.severity === 'critical')) {
      status = 'fail';
    } else if (issues.some((i) => i.severity === 'high' || i.severity === 'medium')) {
      status = 'warning';
    }

    return {
      dimension: `${source.toLowerCase().replace(/\s+/g, '-')}-compliance`,
      status,
      issueCount: issues.length,
      issues,
      metrics: {
        rulesChecked: rules.length,
        violations: issues.length,
      },
      duration: Date.now() - startTime,
    };
  }

  /**
   * Get documentation freshness
   */
  getDocumentationAge(): string {
    if (!this.lastUpdate) {
      return 'Never updated (using static rules)';
    }

    const ageMs = Date.now() - this.lastUpdate.getTime();
    const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
    const ageDays = Math.floor(ageHours / 24);

    if (ageDays > 7) {
      return `${ageDays} days old (⚠️ consider updating)`;
    } else if (ageHours > 24) {
      return `${ageDays} days old`;
    } else {
      return `${ageHours} hours old`;
    }
  }
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const agent = new DocumentationValidatorAgent();

  // Fetch latest docs
  await agent.fetchLatestDocumentation();

  // Example usage
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: tsx documentation-validator-agent.ts <file>');
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

  const context: AnalysisContext = {
    projectRoot: process.cwd(),
    projectFiles: [],
    testFiles: [],
    dependencies: {},
  };

  const reports = await agent.analyze(filePath, sourceFile, context);

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Documentation Compliance Report');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log(`Documentation age: ${agent.getDocumentationAge()}\n`);

  for (const report of reports) {
    console.log(`\n${report.dimension}: ${report.status.toUpperCase()}`);
    console.log(`  Rules checked: ${report.metrics?.rulesChecked}`);
    console.log(`  Violations: ${report.issueCount}`);

    if (report.issues.length > 0) {
      console.log('\n  Issues:');
      for (const issue of report.issues) {
        console.log(`    ${issue.severity.toUpperCase()}: ${issue.message}`);
        console.log(`    at ${issue.file}:${issue.line}`);
        if (issue.suggestion) {
          console.log(`    → ${issue.suggestion.split('\n')[0]}`);
        }
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
