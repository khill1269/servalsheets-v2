/**
 * ServalSheets - LLM API Fallback Service
 *
 * Provides direct LLM API access when MCP sampling is not supported by the client.
 * This enables AI-powered features (suggest_chart, suggest_pivot, explain_analysis, etc.)
 * to work even when Claude Desktop doesn't support MCP sampling.
 *
 * Supported providers:
 * - Anthropic (Claude) - Direct API
 * - OpenAI (GPT-4) - Direct API
 * - Google (Gemini) - Direct API
 * - AWS Bedrock (Claude on Bedrock) - Via AWS SDK with guardrails + inference profiles
 *
 * Configuration via environment variables:
 * - LLM_PROVIDER: 'anthropic' | 'openai' | 'google' | 'bedrock' (default: 'anthropic')
 * - LLM_API_KEY or ANTHROPIC_API_KEY or OPENAI_API_KEY or GOOGLE_API_KEY
 * - LLM_MODEL: Model name (default: claude-sonnet-4-20250514)
 * - BEDROCK_REGION: AWS region for Bedrock (default: us-east-1)
 * - BEDROCK_INFERENCE_PROFILE_ARN: Application inference profile ARN
 * - BEDROCK_GUARDRAIL_ID: Guardrail identifier
 * - BEDROCK_GUARDRAIL_VERSION: Guardrail version (default: '2')
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

export type LLMProvider = 'anthropic' | 'openai' | 'google' | 'bedrock';

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

/**
 * Extended config for Bedrock provider (no API key needed — uses IAM)
 */
export interface BedrockConfig {
  provider: 'bedrock';
  region: string;
  model: string;
  inferenceProfileArn?: string;
  guardrailId?: string;
  guardrailVersion?: string;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get Bedrock-specific configuration from environment
 */
function getBedrockConfig(): BedrockConfig {
  return {
    provider: 'bedrock',
    region: process.env['BEDROCK_REGION'] || process.env['AWS_REGION'] || 'us-east-1',
    model:
      process.env['LLM_MODEL'] ||
      process.env['BEDROCK_MODEL'] ||
      'us.anthropic.claude-sonnet-4-6',
    inferenceProfileArn:
      process.env['BEDROCK_INFERENCE_PROFILE_ARN'] ||
      'arn:aws:bedrock:us-east-1:050752643237:application-inference-profile/4bcokecm5af8',
    guardrailId: process.env['BEDROCK_GUARDRAIL_ID'] || 'rur8hed14y0b',
    guardrailVersion: process.env['BEDROCK_GUARDRAIL_VERSION'] || '2',
  };
}

/**
 * Get LLM fallback configuration from environment
 */
export function getLLMFallbackConfig(): LLMFallbackConfig | BedrockConfig | null {
  // Check for explicit LLM config first
  const provider = (process.env['LLM_PROVIDER'] as LLMProvider) || 'anthropic';

  // Bedrock uses IAM credentials, not API keys
  if (provider === 'bedrock') {
    return getBedrockConfig();
  }

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
  const defaultModels: Record<Exclude<LLMProvider, 'bedrock'>, string> = {
    anthropic: 'claude-sonnet-4-20250514',
    openai: 'gpt-4o',
    google: 'gemini-2.0-flash',
  };

  const model = process.env['LLM_MODEL'] || defaultModels[provider];

  // Base URLs
  const baseUrls: Record<Exclude<LLMProvider, 'bedrock'>, string> = {
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

/**
 * Call AWS Bedrock via @aws-sdk/client-bedrock-runtime
 *
 * Uses Bedrock's Converse API for model-agnostic invocation with:
 * - Application inference profile for routing/cost tracking
 * - Guardrails for content safety enforcement
 * - IAM-based authentication (no API key required)
 *
 * SDK is dynamically imported to keep it optional — only loaded when
 * LLM_PROVIDER=bedrock is configured.
 */
async function callBedrock(
  config: BedrockConfig,
  options: LLMRequestOptions
): Promise<LLMResponse> {
  // Dynamic import — @aws-sdk/client-bedrock-runtime is optional
  let BedrockRuntimeClient: typeof import('@aws-sdk/client-bedrock-runtime').BedrockRuntimeClient;
  let ConverseCommand: typeof import('@aws-sdk/client-bedrock-runtime').ConverseCommand;

  try {
    const sdk = await import('@aws-sdk/client-bedrock-runtime');
    BedrockRuntimeClient = sdk.BedrockRuntimeClient;
    ConverseCommand = sdk.ConverseCommand;
  } catch {
    throw new ConfigError(
      'AWS Bedrock SDK not installed. Run: npm install @aws-sdk/client-bedrock-runtime',
      'BEDROCK_SDK'
    );
  }

  const client = new BedrockRuntimeClient({ region: config.region });

  // Build Converse API messages — system prompt goes in the system param
  const converseMessages = options.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: [{ text: m.content }],
    }));

  // Collect any system messages and merge with explicit systemPrompt
  const inlineSystemMessages = options.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content);

  const systemParts: Array<{ text: string }> = [];
  if (options.systemPrompt) {
    systemParts.push({ text: options.systemPrompt });
  }
  for (const sysMsg of inlineSystemMessages) {
    systemParts.push({ text: sysMsg });
  }

  // Use inference profile ARN as modelId if available, otherwise fall back to model name
  const modelId = config.inferenceProfileArn || config.model;

  // Build the Converse command input
  const commandInput: Record<string, unknown> = {
    modelId,
    messages: converseMessages,
    inferenceConfig: {
      maxTokens: options.maxTokens || 4096,
      temperature: options.temperature,
    },
  };

  if (systemParts.length > 0) {
    commandInput['system'] = systemParts;
  }

  // Attach guardrail configuration if available
  if (config.guardrailId) {
    commandInput['guardrailConfig'] = {
      guardrailIdentifier: config.guardrailId,
      guardrailVersion: config.guardrailVersion || 'DRAFT',
    };
  }

  logger.debug('Calling Bedrock Converse API', {
    component: 'llm-fallback',
    provider: 'bedrock',
    modelId,
    region: config.region,
    guardrailId: config.guardrailId,
    guardrailVersion: config.guardrailVersion,
  });

  try {
    const command = new ConverseCommand(commandInput as ConstructorParameters<typeof ConverseCommand>[0]);
    const response = await client.send(command);

    // Extract text from Converse response
    const outputContent = response.output?.message?.content || [];
    const text = outputContent
      .filter((block: { text?: string }) => block.text !== undefined)
      .map((block: { text?: string }) => block.text!)
      .join('\n');

    // Extract usage metrics
    const usage = response.usage
      ? {
          inputTokens: response.usage.inputTokens || 0,
          outputTokens: response.usage.outputTokens || 0,
        }
      : undefined;

    // Check guardrail action — warn if content was filtered
    if (response.stopReason === 'guardrail_intervened') {
      logger.warn('Bedrock guardrail intervened on response', {
        component: 'llm-fallback',
        provider: 'bedrock',
        guardrailId: config.guardrailId,
      });
    }

    return {
      content: text,
      model: config.model,
      mode: 'fallback',
      provider: 'bedrock',
      usage,
    };
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errName = error instanceof Error ? error.name : 'UnknownError';

    logger.error('Bedrock Converse API request failed', {
      component: 'llm-fallback',
      provider: 'bedrock',
      error: errMsg,
      errorName: errName,
      modelId,
      region: config.region,
    });

    // Map specific Bedrock errors to appropriate ServalSheets errors
    if (errName === 'ThrottlingException' || errName === 'ServiceQuotaExceededException') {
      throw new ServiceError(
        'Bedrock API rate limit exceeded. Please retry after a brief wait.',
        'QUOTA_EXCEEDED',
        'Bedrock',
        true,
        { region: config.region, modelId }
      );
    }

    if (errName === 'AccessDeniedException') {
      throw new ServiceError(
        'Bedrock access denied. Verify IAM role has bedrock:InvokeModel permission.',
        'AUTH_ERROR',
        'Bedrock',
        false,
        { region: config.region, modelId }
      );
    }

    if (errName === 'ModelNotReadyException' || errName === 'ModelTimeoutException') {
      throw new ServiceError(
        'Bedrock model temporarily unavailable. Please try again.',
        'UNAVAILABLE',
        'Bedrock',
        true,
        { region: config.region, modelId }
      );
    }

    if (errName === 'ValidationException') {
      throw new ServiceError(
        `Bedrock request validation failed: ${errMsg}`,
        'VALIDATION_ERROR',
        'Bedrock',
        false,
        { region: config.region, modelId }
      );
    }

    // Generic fallback
    throw new ServiceError(
      `Bedrock AI service error: ${errMsg}`,
      'UNAVAILABLE',
      'Bedrock',
      true,
      { region: config.region, modelId, errorName: errName }
    );
  }
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
      'LLM fallback not configured. Set LLM_PROVIDER=bedrock (uses IAM), or set LLM_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY environment variable.',
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
      response = await callAnthropic(config as LLMFallbackConfig, options);
      break;
    case 'openai':
      response = await callOpenAI(config as LLMFallbackConfig, options);
      break;
    case 'google':
      response = await callGoogle(config as LLMFallbackConfig, options);
      break;
    case 'bedrock':
      response = await callBedrock(config as BedrockConfig, options);
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
