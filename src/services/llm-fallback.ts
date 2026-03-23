/**
 * ServalSheets - LLM API Fallback Service
 *
 * Provides direct LLM API access when MCP sampling is not supported by the client.
 * This enables AI-powered features (suggest_chart, suggest_pivot, explain_analysis, etc.)
 * to work even when Claude Desktop doesn't support MCP sampling.
 *
 * Supported providers:
 * - Anthropic (Claude)
 * - OpenAI (GPT-4)
 * - Google (Gemini)
 *
 * Configuration via environment variables:
 * - LLM_PROVIDER: 'anthropic' | 'openai' | 'google' (default: 'anthropic')
 * - LLM_API_KEY or ANTHROPIC_API_KEY or OPENAI_API_KEY or GOOGLE_API_KEY
 * - LLM_MODEL: Model name (default: claude-sonnet-4-20250514)
 *
 * @module services/llm-fallback
 */

import { logger } from '../utils/logger.js';
import { assertSamplingConsent, withSamplingTimeout } from '../mcp/sampling.js';
import { ServiceError, ConfigError } from '../core/errors.js';
import { recordRequestLlmProvenance } from '../utils/request-context.js';

// ============================================================================
// Types
// ============================================================================

export type LLMProvider = 'anthropic' | 'openai' | 'google';

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMRequestOptions {
  messages: LLMMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  mode: 'sampling' | 'fallback';
  provider: LLMProvider | 'mcp';
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMFallbackConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get LLM fallback configuration from environment
 */
export function getLLMFallbackConfig(): LLMFallbackConfig | null {
  // Check for explicit LLM config first
  const provider = (process.env['LLM_PROVIDER'] as LLMProvider) || 'anthropic';

  // Try to find API key in order of precedence
  const apiKey =
    process.env['LLM_API_KEY'] ||
    process.env['ANTHROPIC_API_KEY'] ||
    process.env['OPENAI_API_KEY'] ||
    process.env['GOOGLE_API_KEY'];

  if (!apiKey) {
    return null;
  }

  // Default models per provider
  const defaultModels: Record<LLMProvider, string> = {
    anthropic: 'claude-sonnet-4-20250514',
    openai: 'gpt-4o',
    google: 'gemini-2.0-flash',
  };

  const model = process.env['LLM_MODEL'] || defaultModels[provider];

  // Base URLs
  const baseUrls: Record<LLMProvider, string> = {
    anthropic: 'https://api.anthropic.com',
    openai: 'https://api.openai.com',
    google: 'https://generativelanguage.googleapis.com',
  };

  return {
    provider,
    apiKey,
    model,
    baseUrl: process.env['LLM_BASE_URL'] || baseUrls[provider],
  };
}

/**
 * Check if LLM fallback is available
 */
export function isLLMFallbackAvailable(): boolean {
  return getLLMFallbackConfig() !== null;
}

// ============================================================================
// Provider Implementations
// ============================================================================

/**
 * Call Anthropic Claude API
 */
async function callAnthropic(
  config: LLMFallbackConfig,
  options: LLMRequestOptions
): Promise<LLMResponse> {
  const messages = options.messages.map((m) => ({
    role: m.role === 'system' ? 'user' : m.role,
    content: m.content,
  }));

  const response = await fetch(`${config.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: options.maxTokens || 4096,
      system: options.systemPrompt,
      messages,
      temperature: options.temperature,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error('Anthropic API request failed', { status: response.status, error: errorBody });
    throw new ServiceError(
      `AI analysis service temporarily unavailable (status ${response.status}). Please try again.`,
      'UNAVAILABLE',
      'Anthropic',
      true
    );
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
    model: string;
    usage: { input_tokens: number; output_tokens: number };
  };

  return {
    content: data.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n'),
    model: data.model,
    mode: 'fallback',
    provider: config.provider,
    usage: {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
    },
  };
}

/**
 * Call OpenAI API
 */
async function callOpenAI(
  config: LLMFallbackConfig,
  options: LLMRequestOptions
): Promise<LLMResponse> {
  const messages: Array<{ role: string; content: string }> = [];

  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }

  messages.push(
    ...options.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))
  );

  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: options.maxTokens || 4096,
      messages,
      temperature: options.temperature,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error('OpenAI API request failed', { status: response.status, error: errorBody });
    throw new ServiceError(
      `AI analysis service temporarily unavailable (status ${response.status}). Please try again.`,
      'UNAVAILABLE',
      'OpenAI',
      true
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: data.choices[0]?.message?.content || '',
    model: data.model,
    mode: 'fallback',
    provider: config.provider,
    usage: {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
    },
  };
}

/**
 * Call Google Gemini API
 */
async function callGoogle(
  config: LLMFallbackConfig,
  options: LLMRequestOptions
): Promise<LLMResponse> {
  const contents = options.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const response = await fetch(
    `${config.baseUrl}/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents,
        systemInstruction: options.systemPrompt
          ? { parts: [{ text: options.systemPrompt }] }
          : undefined,
        generationConfig: {
          maxOutputTokens: options.maxTokens || 4096,
          temperature: options.temperature,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error('Google Gemini API request failed', { status: response.status, error: errorBody });
    throw new ServiceError(
      `AI analysis service temporarily unavailable (status ${response.status}). Please try again.`,
      'UNAVAILABLE',
      'GoogleGemini',
      true
    );
  }

  const data = (await response.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  };

  return {
    content: data.candidates[0]?.content?.parts?.map((p) => p.text).join('\n') || '',
    model: config.model,
    mode: 'fallback',
    provider: config.provider,
    usage: data.usageMetadata
      ? {
          inputTokens: data.usageMetadata.promptTokenCount,
          outputTokens: data.usageMetadata.candidatesTokenCount,
        }
      : undefined,
  };
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Create a message using the LLM fallback
 *
 * @example
 * const response = await createLLMMessage({
 *   systemPrompt: 'You are a spreadsheet expert.',
 *   messages: [{ role: 'user', content: 'Suggest a chart for this data...' }],
 *   maxTokens: 1000,
 * });
 */
export async function createLLMMessage(options: LLMRequestOptions): Promise<LLMResponse> {
  const config = getLLMFallbackConfig();

  if (!config) {
    throw new ConfigError(
      'LLM fallback not configured. Set LLM_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY environment variable.',
      'LLM_API_KEY'
    );
  }

  logger.debug('Using LLM fallback', {
    component: 'llm-fallback',
    provider: config.provider,
    model: config.model,
  });

  let response: LLMResponse;
  switch (config.provider) {
    case 'anthropic':
      response = await callAnthropic(config, options);
      break;
    case 'openai':
      response = await callOpenAI(config, options);
      break;
    case 'google':
      response = await callGoogle(config, options);
      break;
    default:
      throw new ConfigError(
        `Unsupported LLM provider: ${(config as { provider: string }).provider}`,
        'LLM_PROVIDER'
      );
  }

  recordRequestLlmProvenance({
    aiMode: response.mode,
    aiProvider: response.provider,
    aiModelUsed: response.model,
  });

  return response;
}

/**
 * Create a message using either MCP sampling or LLM fallback
 *
 * @param server - MCP server instance (for sampling)
 * @param options - LLM request options
 * @returns Response from either MCP sampling or LLM fallback
 */
export async function createMessageWithFallback(
  server: {
    getClientCapabilities?: () => unknown;
    createMessage?: (params: unknown) => Promise<unknown>;
  } | null,
  options: LLMRequestOptions
): Promise<LLMResponse> {
  // Check if MCP sampling is available
  const clientCapabilities = server?.getClientCapabilities?.() as
    | { sampling?: unknown }
    | undefined;

  if (clientCapabilities?.sampling && server?.createMessage) {
    logger.debug('Using MCP sampling', { component: 'llm-fallback' });

    // Use MCP sampling
    await assertSamplingConsent();

    const result = (await withSamplingTimeout(() =>
      server.createMessage!({
        messages: options.messages.map((m) => ({
          role: m.role,
          content: { type: 'text', text: m.content },
        })),
        systemPrompt: options.systemPrompt,
        maxTokens: options.maxTokens || 4096,
      })
    )) as {
      content: Array<{ type: string; text: string }> | { type: string; text: string };
      model?: string;
    };

    const content = Array.isArray(result.content)
      ? result.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n')
      : result.content.type === 'text'
        ? result.content.text
        : '';

    const response: LLMResponse = {
      content,
      model: result.model || 'mcp-sampling',
      mode: 'sampling',
      provider: 'mcp',
    };
    recordRequestLlmProvenance({
      aiMode: response.mode,
      aiProvider: response.provider,
      aiModelUsed: response.model,
    });
    return response;
  }

  // Fall back to direct LLM API
  logger.debug('MCP sampling not available, using LLM fallback', { component: 'llm-fallback' });
  return createLLMMessage(options);
}
