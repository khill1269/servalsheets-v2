/**
 * =SERVAL() HTTP API Routes
 *
 * POST /api/formula-eval — Accepts a natural language prompt and optional
 * spreadsheet context, returns a Google Sheets formula via MCP Sampling.
 *
 * Designed to be called from the =SERVAL() Apps Script custom function
 * deployed to user spreadsheets.
 */

import type { Request, Response, Router } from 'express';
import { logger } from '../utils/logger.js';

export interface FormulaEvalDeps {
  /** The MCP sampling server for formula generation */
  samplingServer: {
    createMessage: (params: {
      messages: Array<{ role: string; content: { type: string; text: string } }>;
      systemPrompt: string;
      maxTokens: number;
      modelPreferences?: { hints?: Array<{ name: string }> };
      temperature?: number;
    }) => Promise<{ content: { type: string; text?: string } }>;
    getClientCapabilities: () => { sampling?: Record<string, unknown> } | undefined;
  } | null;
}

interface FormulaEvalRequest {
  prompt: string;
  context?: string;
  spreadsheetId?: string;
  headers?: string[];
  sampleData?: unknown[][];
}

const FORMULA_SYSTEM_PROMPT = `You are a Google Sheets formula expert. Generate precise, efficient formulas.

Rules:
- Return ONLY the formula (starting with =), no explanation
- Use structured references when headers are provided
- Prefer XLOOKUP over VLOOKUP, FILTER over complex array formulas
- Avoid volatile functions (NOW, TODAY, RAND) unless explicitly requested
- Use named ranges when context suggests them

If the request is ambiguous, generate the most common interpretation.`;

/**
 * Register the =SERVAL() API routes on an Express app/router.
 */
export function registerApiRoutes(
  router: Router,
  deps: FormulaEvalDeps
): void {
  router.post('/api/formula-eval', async (req: Request, res: Response) => {
    try {
      const body = req.body as FormulaEvalRequest | undefined;

      if (!body?.prompt || typeof body.prompt !== 'string') {
        res.status(400).json({
          error: { code: 'INVALID_REQUEST', message: 'Missing required field: prompt' },
        });
        return;
      }

      if (!deps.samplingServer) {
        res.status(503).json({
          error: {
            code: 'SAMPLING_UNAVAILABLE',
            message: 'MCP Sampling server is not configured. Set ANTHROPIC_API_KEY.',
          },
        });
        return;
      }

      // Build prompt with optional context
      let userPrompt = `Generate a Google Sheets formula for: ${body.prompt}`;
      if (body.context) {
        userPrompt += `\n\nAdditional context: ${body.context}`;
      }
      if (body.headers?.length) {
        userPrompt += `\n\nColumn headers: ${body.headers.join(', ')}`;
      }
      if (body.sampleData?.length) {
        const preview = body.sampleData
          .slice(0, 5)
          .map((row) => (Array.isArray(row) ? row.join('\t') : String(row)))
          .join('\n');
        userPrompt += `\n\nSample data:\n${preview}`;
      }

      const isComplex =
        body.prompt.length > 80 || /QUERY|ARRAYFORMULA|pivot|complex/i.test(body.prompt);

      const result = await deps.samplingServer.createMessage({
        messages: [{ role: 'user', content: { type: 'text', text: userPrompt } }],
        systemPrompt: FORMULA_SYSTEM_PROMPT,
        maxTokens: 500,
        modelPreferences: {
          hints: [{ name: isComplex ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001' }],
        },
        temperature: 0.1,
      });

      let formula =
        result.content.type === 'text' && result.content.text ? result.content.text.trim() : '';

      // Clean up common formatting issues
      formula = formula.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '');
      formula = formula.replace(/^=+/, '=');
      if (formula && !formula.startsWith('=')) {
        formula = '=' + formula;
      }

      logger.info('Formula generated via /api/formula-eval', {
        promptLength: body.prompt.length,
        formulaLength: formula.length,
        spreadsheetId: body.spreadsheetId,
      });

      res.json({
        formula,
        model: isComplex ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001',
        cached: false,
      });
    } catch (err) {
      logger.error('Formula evaluation failed', { error: err });
      res.status(500).json({
        error: {
          code: 'FORMULA_EVAL_FAILED',
          message: err instanceof Error ? err.message : 'Formula evaluation failed',
        },
      });
    }
  });
}
