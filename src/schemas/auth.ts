/**
 * Tool 0: sheets_auth
 * Authentication management for OAuth-based usage.
 */

import { z } from 'zod';
import { URL_REGEX } from '../config/google-limits.js';
import { ErrorDetailSchema, ResponseMetaSchema, type ToolAnnotations } from './shared.js';

// Verbosity level for response filtering
const VerbositySchema = z
  .enum(['minimal', 'standard', 'detailed'])
  .optional()
  .default('standard')
  .describe(
    'Response verbosity: minimal (essential info only), standard (balanced), detailed (full metadata)'
  );

const BlockingIssueSchema = z.object({
  code: z.string().min(1).describe('Stable blocking issue code'),
  message: z.string().min(1).describe('Human-readable issue summary'),
  resolution: z.string().optional().describe('Best next step to resolve the issue'),
});

const ReadinessSchema = z.object({
  googleAuth: z.object({
    configured: z.boolean(),
    authenticated: z.boolean(),
    authType: z.string().optional(),
    tokenValid: z.boolean().optional(),
  }),
  elicitation: z.object({
    supported: z.boolean(),
    form: z.boolean(),
    url: z.boolean(),
  }),
  sampling: z.object({
    configured: z.boolean(),
    available: z.boolean(),
    mode: z.enum(['client_sampling', 'llm_fallback', 'unavailable']).optional(),
  }),
  connectors: z.object({
    available: z.number().int().nonnegative(),
    configured: z.number().int().nonnegative(),
    healthy: z.number().int().nonnegative(),
  }),
  webhooks: z.object({
    configured: z.boolean(),
    active: z.boolean(),
  }),
  missingConfig: z.array(z.string()).optional(),
});

// INPUT SCHEMA: Discriminated union (5 actions)
const StatusActionSchema = z.object({
  action: z.literal('status').describe('Check current authentication status'),
  verbosity: VerbositySchema,
});

const LoginActionSchema = z.object({
  action: z.literal('login').describe('Initiate OAuth login flow'),
  scopes: z
    .array(z.string().min(1, 'Scope cannot be empty').max(256, 'Scope URL exceeds 256 characters'))
    .min(1, 'At least one scope required if scopes provided')
    .max(50, 'Cannot request more than 50 scopes')
    .optional()
    .describe('Additional OAuth scopes to request (max 50)'),
  verbosity: VerbositySchema,
});

const CallbackActionSchema = z.object({
  action: z.literal('callback').describe('Handle OAuth callback with authorization code'),
  code: z.string().min(1).describe('Authorization code from Google'),
  state: z
    .string()
    .min(1)
    .optional()
    .describe('OAuth state token from the redirect URL. Include it when available.'),
  verbosity: VerbositySchema,
});

const LogoutActionSchema = z.object({
  action: z.literal('logout').describe('Revoke authentication and clear tokens'),
  verbosity: VerbositySchema,
});

const SetupFeatureActionSchema = z.object({
  action: z
    .literal('setup_feature')
    .describe(
      'Guided wizard to configure optional features: connector API keys (Finnhub, FRED, Alpha Vantage, Polygon, FMP), Anthropic API key for MCP sampling, Redis URL for webhooks, or MCP federation servers. Uses elicitation to collect credentials interactively — no manual config file editing required. Credentials are encrypted and persist across restarts.'
    ),
  feature: z
    .enum(['connectors', 'sampling', 'webhooks', 'federation'])
    .optional()
    .describe(
      'Feature to configure. If omitted the wizard will ask. connectors=data connector API keys, sampling=ANTHROPIC_API_KEY for AI insights, webhooks=REDIS_URL for push notifications, federation=remote MCP servers'
    ),
  connectorId: z
    .enum(['finnhub', 'fred', 'alpha_vantage', 'polygon', 'fmp'])
    .optional()
    .describe(
      'Connector to configure (only when feature=connectors). Wizard will ask if omitted. finnhub=stocks/news free, fred=economic data free, alpha_vantage=stocks/forex/crypto free, polygon=market data, fmp=financials'
    ),
  apiKey: z
    .string()
    .min(1)
    .optional()
    .describe(
      'API key to store directly — skips elicitation. Use this for programmatic setup or when the user already has the key ready.'
    ),
  redisUrl: z
    .string()
    .regex(/^rediss?:\/\//, 'Must be a redis:// or rediss:// URL')
    .optional()
    .describe(
      'Redis connection URL for feature=webhooks — skips elicitation. Format: redis://[:password@]host[:port][/db] or rediss:// for TLS. Free options: Upstash (upstash.com) or Redis Cloud.'
    ),
  verbosity: VerbositySchema,
});

export const SheetsAuthInputSchema = z.object({
  request: z.discriminatedUnion('action', [
    StatusActionSchema,
    LoginActionSchema,
    CallbackActionSchema,
    LogoutActionSchema,
    SetupFeatureActionSchema,
  ]),
});

const AuthResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    action: z.string(),
    authenticated: z.boolean().optional(),
    authType: z.string().optional(),
    authUrl: z.string().regex(URL_REGEX, 'Invalid URL format').optional(),
    message: z.string().optional(),
    instructions: z.array(z.string()).optional(),
    readiness: ReadinessSchema.optional(),
    blockingIssues: z.array(BlockingIssueSchema).optional(),
    recommendedNextAction: z.string().optional(),
    recommendedPrompt: z.string().optional(),
    email: z.string().optional(),
    scopes: z.array(z.string()).optional(),
    hasAccessToken: z.boolean().optional(),
    hasRefreshToken: z.boolean().optional(),
    tokenValid: z
      .boolean()
      .optional()
      .describe(
        'Whether existing tokens are valid (undefined if no tokens, false if invalid, true if valid)'
      ),
    configured: z
      .boolean()
      .optional()
      .describe('Whether the requested optional feature or auth dependency is configured'),
    verified: z
      .boolean()
      .optional()
      .describe('Whether the configured feature was verified with a health or readiness check'),
    nextStep: z.string().optional().describe('Best next step after the current response'),
    fallbackInstructions: z
      .array(z.string())
      .optional()
      .describe('Copy-pastable guidance for clients without elicitation support'),
    _meta: ResponseMetaSchema.optional(),
  }),
  z.object({
    success: z.literal(false),
    error: ErrorDetailSchema,
  }),
]);

export const SheetsAuthOutputSchema = z.object({
  response: AuthResponseSchema,
});

export const SHEETS_AUTH_ANNOTATIONS: ToolAnnotations = {
  title: 'Authentication',
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export type SheetsAuthInput = z.infer<typeof SheetsAuthInputSchema>;
export type SheetsAuthOutput = z.infer<typeof SheetsAuthOutputSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// Type narrowing helpers for handler methods
export type AuthStatusInput = SheetsAuthInput['request'] & { action: 'status' };
export type AuthLoginInput = SheetsAuthInput['request'] & { action: 'login' };
export type AuthCallbackInput = SheetsAuthInput['request'] & {
  action: 'callback';
  code: string;
  state?: string;
};
export type AuthLogoutInput = SheetsAuthInput['request'] & { action: 'logout' };
export type AuthSetupFeatureInput = SheetsAuthInput['request'] & { action: 'setup_feature' };
