/**
 * SecurityAgent tests
 *
 * Focuses on SQL-injection detection quality:
 * - flag dynamic SQL passed to execution methods
 * - ignore static SQL with placeholders
 * - ignore unrelated template literals that merely contain SQL keywords
 */

import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { SecurityAgent } from '../../scripts/analysis/agents/security-agent.js';
import type { AnalysisContext } from '../../scripts/analysis/multi-agent-analysis.js';

function createSourceFile(code: string): ts.SourceFile {
  return ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true);
}

function createContext(): AnalysisContext {
  return {
    projectRoot: '/test',
    projectFiles: [],
    testFiles: [],
    dependencies: {},
  };
}

async function analyzeSecurity(code: string, filePath: string = 'src/services/test.ts') {
  const agent = new SecurityAgent();
  const sourceFile = createSourceFile(code);
  const reports = await agent.analyze(filePath, sourceFile, createContext());

  return reports;
}

async function analyzeSqlInjection(code: string, filePath?: string) {
  const reports = await analyzeSecurity(code, filePath);

  return reports.find((report) => report.dimension === 'sqlInjection');
}

describe('SecurityAgent', () => {
  describe('SQL injection detection', () => {
    it('flags interpolated SQL executed directly', async () => {
      const report = await analyzeSqlInjection(`
        function run(db: { prepare: (sql: string) => void }, userId: string) {
          db.prepare(\`SELECT * FROM users WHERE id = \${userId}\`);
        }
      `);

      expect(report).toBeDefined();
      expect(report?.issueCount).toBe(1);
      expect(report?.issues[0]?.message).toContain('dynamic SQL');
    });

    it('flags dynamic SQL assigned to a variable before execution', async () => {
      const report = await analyzeSqlInjection(`
        function run(db: { prepare: (sql: string) => void }, filters: string[]) {
          const whereClause = filters.join(' AND ');
          const sql = \`SELECT * FROM users WHERE \${whereClause}\`;
          db.prepare(sql);
        }
      `);

      expect(report?.issueCount).toBe(1);
      expect(report?.issues[0]?.line).toBe(5);
    });

    it('does not flag static parameterized SQL', async () => {
      const report = await analyzeSqlInjection(`
        function run(db: { prepare: (sql: string) => void }) {
          db.prepare('SELECT * FROM users WHERE id = ?');
        }
      `);

      expect(report?.status).toBe('pass');
      expect(report?.issueCount).toBe(0);
    });

    it('does not flag non-SQL template literals with SQL keywords', async () => {
      const report = await analyzeSqlInjection(`
        function buildMessage(operation: string) {
          throw new Error(\`DELETE failed for \${operation}\`);
        }
      `);

      expect(report?.status).toBe('pass');
      expect(report?.issueCount).toBe(0);
    });
  });

  describe('Input validation scope', () => {
    it('flags missing validation on top-level handlers', async () => {
      const reports = await analyzeSecurity(
        `
          export class ExampleHandler {
            execute(input: unknown) {
              return input;
            }
          }
        `,
        'src/handlers/example.ts'
      );

      const report = reports.find((entry) => entry.dimension === 'inputValidation');
      expect(report?.issueCount).toBe(1);
      expect(report?.status).toBe('fail');
    });

    it('skips nested handler helper modules that are not input boundaries', async () => {
      const reports = await analyzeSecurity(
        `
          export function helper(input: unknown) {
            return input;
          }
        `,
        'src/handlers/helpers/example.ts'
      );

      const report = reports.find((entry) => entry.dimension === 'inputValidation');
      expect(report?.issueCount).toBe(0);
      expect(report?.status).toBe('pass');
    });

    it('treats BaseHandler + unwrapRequest files as framework-validated entrypoints', async () => {
      const reports = await analyzeSecurity(
        `
          import { BaseHandler, unwrapRequest } from './base.js';

          export class ExampleHandler extends BaseHandler<unknown, unknown> {
            async handle(input: unknown) {
              return unwrapRequest(input);
            }
          }
        `,
        'src/handlers/example.ts'
      );

      const report = reports.find((entry) => entry.dimension === 'inputValidation');
      expect(report?.issueCount).toBe(0);
      expect(report?.status).toBe('pass');
    });

    it('skips HTTP wiring files that do not access request input directly', async () => {
      const reports = await analyzeSecurity(
        `
          export function register(app: { use: (value: unknown) => void }, middleware: unknown) {
            app.use(middleware);
          }
        `,
        'src/http-server/graphql-admin.ts'
      );

      const report = reports.find((entry) => entry.dimension === 'inputValidation');
      expect(report?.issueCount).toBe(0);
      expect(report?.status).toBe('pass');
    });

    it('treats request-scoped guards that reject invalid input as manual validation', async () => {
      const reports = await analyzeSecurity(
        `
          export function register(app: {
            post: (
              path: string,
              handler: (req: { get: (name: string) => string | undefined }, res: { status: (code: number) => { json: (body: unknown) => void } }) => void
            ) => void;
          }) {
            app.post('/webhook', (req, res) => {
              const channelId = req.get('x-goog-channel-id');
              if (!channelId) {
                res.status(400).json({ error: 'missing header' });
                return;
              }
            });
          }
        `,
        'src/http-server/routes-webhooks.ts'
      );

      const report = reports.find((entry) => entry.dimension === 'inputValidation');
      expect(report?.issueCount).toBe(0);
      expect(report?.status).toBe('pass');
    });

    it('treats validate helpers called with request data as manual validation', async () => {
      const reports = await analyzeSecurity(
        `
          function validateAssetPath(path: string): string | null {
            return path.startsWith('/ui/tracing/assets/') ? path : null;
          }

          export function register(app: {
            get: (
              path: string,
              handler: (
                req: { path: string },
                res: { status: (code: number) => { send: (body: string) => void } }
              ) => void
            ) => void;
          }) {
            app.get('/ui/tracing/assets/*', (req, res) => {
              const assetPath = validateAssetPath(req.path);
              if (!assetPath) {
                res.status(400).send('invalid path');
                return;
              }
            });
          }
        `,
        'src/http-server-tracing-ui.ts'
      );

      const report = reports.find((entry) => entry.dimension === 'inputValidation');
      expect(report?.issueCount).toBe(0);
      expect(report?.status).toBe('pass');
    });
  });
});
