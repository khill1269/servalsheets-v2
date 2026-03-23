/**
 * ServalSheets - Webhook Schemas
 *
 * Schemas for webhook registration, management, and delivery.
 * Supports Google Sheets push notifications via Watch API.
 *
 * @category Schemas
 */

import { z } from 'zod';
import { ErrorDetailSchema } from './shared.js';

/**
 * Webhook actions
 */
export const WebhookActionsSchema = z.enum([
  'register',
  'unregister',
  'list',
  'get',
  'test',
  'get_stats',
  'watch_changes',
  'subscribe_workspace',
  'unsubscribe_workspace',
  'list_workspace_subscriptions',
]);

/**
 * Webhook event types (Google Sheets changes)
 */
export const WebhookEventTypeSchema = z.enum([
  'sheet.update', // Any change to spreadsheet
  'sheet.create', // New sheet created
  'sheet.delete', // Sheet deleted
  'sheet.rename', // Sheet renamed
  'cell.update', // Cell values changed
  'format.update', // Formatting changed
  'all', // All events
]);

/**
 * Webhook registration input
 */
export const WebhookRegisterInputSchema = z.object({
  action: z.literal('register').describe('Register a webhook to receive change notifications'),
  spreadsheetId: z
    .string()
    .min(1, 'Spreadsheet ID required')
    .describe(
      'Spreadsheet ID from the Google Sheets URL — the long alphanumeric string between /d/ and /edit. ' +
        'Example: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"'
    ),
  webhookUrl: z
    .string()
    .url('Must be a valid HTTPS URL')
    .startsWith('https://')
    .describe(
      'HTTPS endpoint that receives webhook POST payloads when events fire. ' +
        'Must be HTTPS (HTTP is rejected for security). Must be publicly reachable by Google. ' +
        'Example: "https://your-server.example.com/webhooks/sheets"'
    ),
  eventTypes: z
    .array(WebhookEventTypeSchema)
    .min(1, 'At least one event type required')
    .describe(
      'List of event types to subscribe to. Available: ' +
        '"sheet.update" (any change), "sheet.create" (new sheet), "sheet.delete" (sheet removed), ' +
        '"sheet.rename" (sheet renamed), "cell.update" (cell values changed), ' +
        '"format.update" (formatting changed), "all" (all events). ' +
        'Example: ["cell.update", "sheet.create"]'
    ),
  secret: z
    .string()
    .min(16, 'Secret must be at least 16 characters')
    .optional()
    .describe(
      'Shared secret for HMAC-SHA256 signature verification of incoming webhook payloads. ' +
        'When set, each delivery includes an X-Serval-Signature header computed as ' +
        'HMAC-SHA256(secret, payload). Your endpoint should verify this to prevent spoofing. ' +
        'Auto-generated (and returned once) if not provided. Min 16 characters. ' +
        'Example: "my-webhook-secret-key-min-16-chars"'
    ),
  expirationMs: z
    .number()
    .int()
    .positive()
    .max(86400000) // 1 day max (Drive API files.watch limit)
    .optional()
    .default(43200000) // 12 hours default (safe buffer before 1-day limit)
    .describe(
      'How long the webhook channel stays active in milliseconds. ' +
        'Maximum: 86400000 (1 day, enforced by Google Drive files.watch API). ' +
        'Default: 43200000 (12 hours — provides a safe buffer before the 1-day limit). ' +
        'You must re-register after expiration. Example: 86400000 for maximum lifetime.'
    ),
});

/**
 * Webhook unregister input
 */
export const WebhookUnregisterInputSchema = z.object({
  action: z.literal('unregister').describe('Unregister an existing webhook'),
  webhookId: z.string().min(1, 'Webhook ID required'),
});

/**
 * Webhook list input
 */
export const WebhookListInputSchema = z.object({
  action: z.literal('list').describe('List all registered webhooks'),
  spreadsheetId: z.string().optional().describe('Filter by spreadsheet ID'),
  active: z.boolean().optional().describe('Filter by active status'),
});

/**
 * Webhook get input
 */
export const WebhookGetInputSchema = z.object({
  action: z.literal('get').describe('Get details of a specific webhook'),
  webhookId: z.string().min(1, 'Webhook ID required'),
});

/**
 * Webhook test input (sends test payload)
 */
export const WebhookTestInputSchema = z.object({
  action: z.literal('test').describe('Send a test payload to a webhook endpoint'),
  webhookId: z.string().min(1, 'Webhook ID required'),
});

/**
 * Webhook stats input
 */
export const WebhookStatsInputSchema = z.object({
  action: z.literal('get_stats').describe('Get delivery statistics for webhooks'),
  webhookId: z.string().optional().describe('Get stats for specific webhook'),
});

/**
 * Watch changes input — uses Google Drive files.watch to receive push notifications
 * when a spreadsheet file changes. More reliable than polling for changes.
 */
export const WebhookWatchChangesInputSchema = z.object({
  action: z
    .literal('watch_changes')
    .describe(
      'Set up Google Drive push notifications for a spreadsheet using files.watch API — notifies your endpoint when the file changes'
    ),
  spreadsheetId: z.string().min(1, 'Spreadsheet ID required'),
  webhookUrl: z.string().url('Must be a valid HTTPS URL').startsWith('https://'),
  channelId: z
    .string()
    .min(1)
    .optional()
    .describe('Custom channel ID (auto-generated if not provided)'),
  expirationMs: z
    .number()
    .int()
    .positive()
    .max(86400000)
    .optional()
    .default(43200000)
    .describe('Channel expiration in milliseconds (max 1 day per Drive API limit)'),
});

/**
 * Workspace Events subscribe input — uses Google Workspace Events API via Pub/Sub
 * Note: Workspace Events API delivers via Pub/Sub, not HTTP endpoints directly.
 */
export const WebhookSubscribeWorkspaceInputSchema = z.object({
  action: z.literal('subscribe_workspace'),
  spreadsheetId: z.string().min(1),
  notificationEndpoint: z
    .string()
    .min(1)
    .describe(
      'Pub/Sub topic to receive Workspace Events (format: projects/{project}/topics/{topic})'
    ),
});

/**
 * Workspace Events unsubscribe input
 */
export const WebhookUnsubscribeWorkspaceInputSchema = z.object({
  action: z.literal('unsubscribe_workspace'),
  subscriptionId: z.string().min(1).describe('Subscription ID returned by subscribe_workspace'),
});

/**
 * Workspace Events list subscriptions input
 */
export const WebhookListWorkspaceSubscriptionsInputSchema = z.object({
  action: z.literal('list_workspace_subscriptions'),
  spreadsheetId: z
    .string()
    .optional()
    .describe('Filter by spreadsheet ID (omit for all subscriptions)'),
});

/**
 * Webhook request (discriminated union)
 */
const WebhookRequestSchema = z.discriminatedUnion('action', [
  WebhookRegisterInputSchema,
  WebhookUnregisterInputSchema,
  WebhookListInputSchema,
  WebhookGetInputSchema,
  WebhookTestInputSchema,
  WebhookStatsInputSchema,
  WebhookWatchChangesInputSchema,
  WebhookSubscribeWorkspaceInputSchema,
  WebhookUnsubscribeWorkspaceInputSchema,
  WebhookListWorkspaceSubscriptionsInputSchema,
]);

/**
 * Webhook input (wrapped for MCP compatibility)
 *
 * Uses the standard { request: ... } pattern that other tools use.
 * This ensures the schema matches the MCP SDK's expected input format.
 */
export const SheetsWebhookInputSchema = z.object({
  request: WebhookRequestSchema,
});

/**
 * Webhook registration response
 */
export const WebhookRegisterResponseSchema = z.object({
  webhookId: z.string(),
  spreadsheetId: z.string(),
  webhookUrl: z.string(),
  eventTypes: z.array(WebhookEventTypeSchema),
  resourceId: z.string().describe('Google Watch API resource ID'),
  channelId: z.string().describe('Google Watch API channel ID'),
  expiresAt: z.string().describe('ISO 8601 timestamp'),
  active: z.boolean(),
  secret: z.string().optional().describe('Webhook secret (only returned on registration)'),
});

/**
 * Webhook info
 */
export const WebhookInfoSchema = z.object({
  webhookId: z.string(),
  spreadsheetId: z.string(),
  webhookUrl: z.string(),
  eventTypes: z.array(WebhookEventTypeSchema),
  resourceId: z.string(),
  channelId: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  active: z.boolean(),
  deliveryCount: z.number().int(),
  failureCount: z.number().int(),
  lastDelivery: z.string().optional(),
  lastFailure: z.string().optional(),
  avgDeliveryTimeMs: z.number().optional().describe('Average delivery time in milliseconds'),
  p95DeliveryTimeMs: z
    .number()
    .optional()
    .describe('95th percentile delivery time in milliseconds'),
  p99DeliveryTimeMs: z
    .number()
    .optional()
    .describe('99th percentile delivery time in milliseconds'),
});

/**
 * Webhook payload structure
 * (Phase 4.2A - Fine-Grained Event Filtering)
 */
export const WebhookPayloadSchema = z.object({
  channelId: z.string(),
  resourceId: z.string(),
  resourceState: z.string(),
  spreadsheetId: z.string(),
  messageNumber: z.string().optional(),
  timestamp: z.string(),
  changeDetails: z
    .object({
      sheetsAdded: z.array(z.string()).optional().describe('Array of sheet titles that were added'),
      sheetsRemoved: z
        .array(z.string())
        .optional()
        .describe('Array of sheet titles that were removed'),
      sheetsRenamed: z
        .array(z.object({ from: z.string(), to: z.string() }))
        .optional()
        .describe('Array of sheets that were renamed'),
      cellRanges: z.array(z.string()).optional().describe('Array of A1 ranges where cells changed'),
    })
    .optional()
    .describe('Detailed breakdown of changes detected by DiffEngine'),
});

/**
 * Webhook delivery attempt
 */
export const WebhookDeliverySchema = z.object({
  deliveryId: z.string(),
  webhookId: z.string(),
  timestamp: z.string(),
  eventType: WebhookEventTypeSchema,
  payload: z.record(
    z.string(),
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.any()),
      z.record(z.string(), z.any()),
    ])
  ),
  status: z.enum(['pending', 'success', 'failed', 'retrying']),
  statusCode: z.number().int().optional(),
  error: z.string().optional(),
  attemptCount: z.number().int(),
  nextRetryAt: z.string().optional(),
});

/**
 * Webhook stats
 */
export const WebhookStatsSchema = z.object({
  totalWebhooks: z.number().int(),
  activeWebhooks: z.number().int(),
  totalDeliveries: z.number().int(),
  successfulDeliveries: z.number().int(),
  failedDeliveries: z.number().int(),
  pendingDeliveries: z.number().int(),
  averageDeliveryTimeMs: z.number(),
  webhookStats: z
    .array(
      z.object({
        webhookId: z.string(),
        deliveryCount: z.number().int(),
        successRate: z.number(),
        averageLatencyMs: z.number(),
      })
    )
    .optional(),
});

/**
 * Webhook output response
 */
const WebhookResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    data: z.union([
      WebhookRegisterResponseSchema,
      z.object({ success: z.boolean(), message: z.string() }),
      z.object({ webhooks: z.array(WebhookInfoSchema) }),
      z.object({ webhook: WebhookInfoSchema }),
      z.object({ delivery: WebhookDeliverySchema }),
      WebhookStatsSchema,
      z.object({
        success: z.boolean(),
        message: z.string(),
        channelId: z.string(),
        resourceId: z.string(),
        expiration: z.string(),
        spreadsheetId: z.string(),
        webhookUrl: z.string(),
      }),
    ]),
  }),
  z.object({
    success: z.literal(false),
    error: ErrorDetailSchema,
  }),
]);

export const SheetsWebhookOutputSchema = z.object({
  response: WebhookResponseSchema,
});

/**
 * Tool annotations for sheets_webhook
 */
export const SHEETS_WEBHOOK_ANNOTATIONS = {
  title: 'Webhook Management',
  readOnlyHint: false,
  destructiveHint: true, // unregister permanently removes webhook
  idempotentHint: false,
  openWorldHint: true,
};

// Type exports
export type WebhookActions = z.infer<typeof WebhookActionsSchema>;
export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;
export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
export type SheetsWebhookInput = z.infer<typeof SheetsWebhookInputSchema>;
export type WebhookRegisterInput = z.infer<typeof WebhookRegisterInputSchema>;
export type WebhookUnregisterInput = z.infer<typeof WebhookUnregisterInputSchema>;
export type WebhookListInput = z.infer<typeof WebhookListInputSchema>;
export type WebhookGetInput = z.infer<typeof WebhookGetInputSchema>;
export type WebhookTestInput = z.infer<typeof WebhookTestInputSchema>;
export type WebhookStatsInput = z.infer<typeof WebhookStatsInputSchema>;
export type WebhookWatchChangesInput = z.infer<typeof WebhookWatchChangesInputSchema>;
export type WebhookSubscribeWorkspaceInput = z.infer<typeof WebhookSubscribeWorkspaceInputSchema>;
export type WebhookUnsubscribeWorkspaceInput = z.infer<
  typeof WebhookUnsubscribeWorkspaceInputSchema
>;
export type WebhookListWorkspaceSubscriptionsInput = z.infer<
  typeof WebhookListWorkspaceSubscriptionsInputSchema
>;
export type WebhookRegisterResponse = z.infer<typeof WebhookRegisterResponseSchema>;
export type WebhookInfo = z.infer<typeof WebhookInfoSchema>;
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;
export type WebhookStats = z.infer<typeof WebhookStatsSchema>;
export type SheetsWebhookOutput = z.infer<typeof SheetsWebhookOutputSchema>;
