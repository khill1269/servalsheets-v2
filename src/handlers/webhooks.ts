/**
 * ServalSheets - Webhook Handler
 *
 * Handles sheets_webhook MCP tool for webhook management.
 *
 * Actions:
 * - register: Register new webhook
 * - unregister: Remove webhook
 * - list: List webhooks
 * - get: Get webhook details
 * - test: Send test delivery
 * - get_stats: Get webhook statistics
 * - watch_changes: Set up Google Drive files.watch push notifications
 *
 * @category Handlers
 */

import { ErrorCodes } from './error-codes.js';
import {
  getWebhookManager,
  isWebhookRedisConfigured,
  validateWebhookUrl,
  WEBHOOK_DURABILITY_MODE,
} from '../services/webhook-manager.js';
import { getWebhookQueue } from '../services/webhook-queue.js';
import { WorkspaceEventsService } from '../services/workspace-events.js';
import type {
  SheetsWebhookInput,
  SheetsWebhookOutput,
  WebhookEventType,
} from '../schemas/webhook.js';
import { logger } from '../utils/logger.js';
import { resourceNotifications } from '../resources/notifications.js';
import type { drive_v3 } from 'googleapis';
import { randomUUID } from 'crypto';
import { mapStandaloneError } from './helpers/error-mapping.js';
import { ServiceError } from '../core/errors.js';
import { recordWebhookId } from '../mcp/completions.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { getApiSpecificCircuitBreakerConfig } from '../config/env.js';
import { circuitBreakerRegistry } from '../services/circuit-breaker-registry.js';

const REDIS_REQUIRED_WEBHOOK_ACTIONS = new Set([
  'register',
  'unregister',
  'list',
  'get',
  'test',
  'get_stats',
]);

/**
 * Webhook handler
 */
export class WebhookHandler {
  private driveApi?: drive_v3.Drive;
  private deliveryCircuitBreaker: CircuitBreaker;
  private workspaceEventsService?: WorkspaceEventsService;

  constructor(options?: {
    driveApi?: drive_v3.Drive;
    workspaceEventsService?: WorkspaceEventsService;
  }) {
    this.driveApi = options?.driveApi;
    this.workspaceEventsService = options?.workspaceEventsService;

    // 16-S4: Initialize circuit breaker for webhook delivery operations
    const deliveryConfig = getApiSpecificCircuitBreakerConfig('webhook_delivery');
    this.deliveryCircuitBreaker = new CircuitBreaker({
      failureThreshold: deliveryConfig.failureThreshold,
      successThreshold: deliveryConfig.successThreshold,
      timeout: deliveryConfig.timeout,
      name: 'webhook-delivery',
    });

    // Register fallback strategy for delivery circuit breaker
    this.deliveryCircuitBreaker.registerFallback({
      name: 'webhook-delivery-unavailable-fallback',
      priority: 1,
      shouldUse: () => true,
      execute: async () => {
        throw new ServiceError(
          'Webhook delivery service temporarily unavailable due to repeated delivery failures',
          'UNAVAILABLE',
          'webhook-delivery',
          true,
          { resetTimeMs: 30000, reason: 'repeated_delivery_failures' }
        );
      },
    });

    // Register with global registry
    circuitBreakerRegistry.register('webhook-delivery', this.deliveryCircuitBreaker);
  }

  private createErrorDetail(
    error: unknown,
    fallbackMessage: string,
    action: string
  ): Extract<SheetsWebhookOutput['response'], { success: false }>['error'] {
    const message = error instanceof Error ? error.message : String(error);
    const lowerMessage = message.toLowerCase();
    const isRedisConfigError =
      lowerMessage.includes('redis required') ||
      (lowerMessage.includes('redis') &&
        (lowerMessage.includes('not initialized') ||
          lowerMessage.includes('not configured') ||
          lowerMessage.includes('not available')));

    if (isRedisConfigError) {
      return {
        code: ErrorCodes.CONFIG_ERROR,
        message: 'Redis required: Redis backend is required for sheets_webhook operations',
        details: {
          action,
          dependency: 'redis',
          durabilityMode: WEBHOOK_DURABILITY_MODE,
          originalError: message,
        },
        retryable: false,
        resolution:
          'Configure a reachable Redis instance, then retry webhook registration, listing, or delivery tests.',
        resolutionSteps: [
          '1. Set REDIS_URL (or equivalent Redis connection env vars)',
          '2. Ensure Redis is reachable from this ServalSheets process',
          '3. Restart ServalSheets so webhook services initialize with Redis',
          '4. Retry the webhook operation',
        ],
      };
    }

    return {
      code: ErrorCodes.INTERNAL_ERROR,
      message: message || fallbackMessage,
      details: { action, error: String(error) },
      retryable: false,
    };
  }

  private createRedisUnavailableError(
    action: string
  ): Extract<SheetsWebhookOutput['response'], { success: false }>['error'] {
    return {
      code: ErrorCodes.CONFIG_ERROR,
      message: `Redis required: ${action} depends on the Redis-backed webhook store`,
      details: {
        action,
        dependency: 'redis',
        durabilityMode: WEBHOOK_DURABILITY_MODE,
      },
      retryable: false,
      resolution:
        'Configure a reachable Redis instance before using Redis-backed sheets_webhook actions.',
      resolutionSteps: [
        '1. Set REDIS_URL (or equivalent Redis connection env vars)',
        '2. Ensure Redis is reachable from this ServalSheets process',
        '3. Restart ServalSheets so webhook services initialize with Redis',
        '4. Retry register, list, get, test, get_stats, or unregister',
      ],
    };
  }

  /**
   * Handle sheets_webhook tool calls
   */
  async handle(input: SheetsWebhookInput): Promise<SheetsWebhookOutput> {
    const req = input.request;
    try {
      if (REDIS_REQUIRED_WEBHOOK_ACTIONS.has(req.action) && !isWebhookRedisConfigured()) {
        return {
          response: {
            success: false,
            error: this.createRedisUnavailableError(req.action),
          },
        };
      }

      switch (req.action) {
        case 'register':
          return { response: await this.handleRegister(req) };

        case 'unregister':
          return { response: await this.handleUnregister(req) };

        case 'list':
          return { response: await this.handleList(req) };

        case 'get':
          return { response: await this.handleGet(req) };

        case 'test':
          return { response: await this.handleTest(req) };

        case 'get_stats':
          return { response: await this.handleGetStats(req) };

        case 'watch_changes':
          return {
            response: await this.handleWatchChanges(
              req as import('../schemas/webhook.js').WebhookWatchChangesInput
            ),
          };

        case 'subscribe_workspace': {
          if (!this.workspaceEventsService) {
            return {
              response: {
                success: false as const,
                error: {
                  code: ErrorCodes.NOT_FOUND,
                  message: 'Workspace Events service not available',
                  retryable: false,
                },
              },
            };
          }
          const subId = await this.workspaceEventsService.createSubscription(
            req.spreadsheetId,
            req.notificationEndpoint
          );
          return {
            response: {
              success: true as const,
              data: {
                success: true,
                message: `Subscription created: ${subId}`,
                subscriptionId: subId,
              } as unknown as import('../schemas/webhook.js').WebhookRegisterResponse,
            },
          };
        }

        case 'unsubscribe_workspace': {
          if (!this.workspaceEventsService) {
            return {
              response: {
                success: false as const,
                error: {
                  code: ErrorCodes.NOT_FOUND,
                  message: 'Workspace Events service not available',
                  retryable: false,
                },
              },
            };
          }
          await this.workspaceEventsService.deleteSubscription(req.subscriptionId);
          return {
            response: {
              success: true as const,
              data: {
                success: true,
                message: `Subscription deleted: ${req.subscriptionId}`,
              } as unknown as import('../schemas/webhook.js').WebhookRegisterResponse,
            },
          };
        }

        case 'list_workspace_subscriptions': {
          if (!this.workspaceEventsService) {
            return {
              response: {
                success: false as const,
                error: {
                  code: ErrorCodes.NOT_FOUND,
                  message: 'Workspace Events service not available',
                  retryable: false,
                },
              },
            };
          }
          const subs = this.workspaceEventsService.listSubscriptions(req.spreadsheetId);
          return {
            response: {
              success: true as const,
              data: {
                subscriptions: subs,
              } as unknown as import('../schemas/webhook.js').WebhookRegisterResponse,
            },
          };
        }

        default: {
          const _exhaustiveCheck: never = req;
          return {
            response: {
              success: false,
              error: {
                code: ErrorCodes.INVALID_PARAMS,
                message: `Unknown action: ${(_exhaustiveCheck as { action: string }).action}`,
                retryable: false,
                suggestedFix:
                  "Check parameter format - ranges use A1 notation like 'Sheet1!A1:D10'",
              },
            },
          };
        }
      }
    } catch (error) {
      logger.error('Webhook handler error', {
        action: req.action,
        error,
      });

      // 16-S4/16-S5: Use structured error mapping for top-level catch
      const mapped = mapStandaloneError(error);
      return {
        response: {
          success: false,
          error: mapped,
        },
      };
    }
  }

  /**
   * Register webhook
   */
  private async handleRegister(
    input: Extract<SheetsWebhookInput['request'], { action: 'register' }>
  ): Promise<SheetsWebhookOutput['response']> {
    try {
      const manager = getWebhookManager();

      // ISSUE-140: Reject duplicate URL registration to prevent double event delivery
      try {
        const existingWebhooks = await manager.list(input.spreadsheetId, true);
        const duplicate = existingWebhooks.find((w) => w.webhookUrl === input.webhookUrl);
        if (duplicate) {
          return {
            success: false,
            error: {
              code: ErrorCodes.FAILED_PRECONDITION,
              message: `A webhook with URL "${input.webhookUrl}" is already registered for this spreadsheet (existing ID: ${duplicate.webhookId}). Unregister the existing webhook first or use a different URL.`,
              retryable: false,
            },
          };
        }
      } catch {
        // Non-blocking: if duplicate check fails (e.g. Redis unavailable), proceed with registration
      }

      const result = await manager.register(input);

      // Notify MCP clients that webhook was registered (Feature 1: Real-Time Notifications)
      resourceNotifications.notifyResourceListChanged('webhook registered');

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: this.createErrorDetail(error, 'Failed to register webhook', input.action),
      };
    }
  }

  /**
   * Unregister webhook
   */
  private async handleUnregister(
    input: Extract<SheetsWebhookInput['request'], { action: 'unregister' }>
  ): Promise<SheetsWebhookOutput['response']> {
    try {
      const manager = getWebhookManager();
      const result = await manager.unregister(input.webhookId);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: this.createErrorDetail(error, 'Failed to unregister webhook', input.action),
      };
    }
  }

  /**
   * List webhooks
   */
  private async handleList(
    input: Extract<SheetsWebhookInput['request'], { action: 'list' }>
  ): Promise<SheetsWebhookOutput['response']> {
    try {
      const manager = getWebhookManager();
      const webhooks = await manager.list(input.spreadsheetId, input.active);

      // Wire completions: cache webhook IDs for argument autocompletion (ISSUE-062)
      for (const wh of webhooks) {
        if (wh.webhookId) recordWebhookId(wh.webhookId);
      }

      return {
        success: true,
        data: { webhooks },
      };
    } catch (error) {
      return {
        success: false,
        error: this.createErrorDetail(error, 'Failed to list webhooks', input.action),
      };
    }
  }

  /**
   * Get webhook details
   */
  private async handleGet(
    input: Extract<SheetsWebhookInput['request'], { action: 'get' }>
  ): Promise<SheetsWebhookOutput['response']> {
    try {
      const manager = getWebhookManager();
      const webhook = await manager.get(input.webhookId);

      if (!webhook) {
        return {
          success: false,
          error: {
            code: ErrorCodes.NOT_FOUND,
            message: `Webhook ${input.webhookId} not found`,
            retryable: false,
            suggestedFix: 'Verify the spreadsheet ID is correct and the spreadsheet exists',
          },
        };
      }

      return {
        success: true,
        data: { webhook },
      };
    } catch (error) {
      return {
        success: false,
        error: this.createErrorDetail(error, 'Failed to get webhook', input.action),
      };
    }
  }

  /**
   * Send test webhook delivery
   * 16-S4: Wrapped with circuit breaker protection
   */
  private async handleTest(
    input: Extract<SheetsWebhookInput['request'], { action: 'test' }>
  ): Promise<SheetsWebhookOutput['response']> {
    try {
      const manager = getWebhookManager();
      const webhook = await manager.get(input.webhookId);

      if (!webhook) {
        return {
          success: false,
          error: {
            code: ErrorCodes.NOT_FOUND,
            message: `Webhook ${input.webhookId} not found`,
            retryable: false,
            suggestedFix: 'Verify the spreadsheet ID is correct and the spreadsheet exists',
          },
        };
      }

      // 16-S4: Wrap webhook delivery with circuit breaker
      const queue = await this.deliveryCircuitBreaker.execute(async () => {
        return getWebhookQueue();
      });

      // Enqueue test delivery
      const deliveryId = await queue.enqueue({
        webhookId: webhook.webhookId,
        webhookUrl: webhook.webhookUrl,
        eventType: 'all' as WebhookEventType,
        payload: {
          test: true,
          message: 'Test webhook delivery',
          timestamp: new Date().toISOString(),
        },
        maxAttempts: 1, // Don't retry test deliveries
        scheduledAt: Date.now(),
      });

      return {
        success: true,
        data: {
          delivery: {
            deliveryId,
            webhookId: webhook.webhookId,
            timestamp: new Date().toISOString(),
            eventType: 'all' as WebhookEventType,
            payload: {
              test: true,
              message: 'Test webhook delivery',
            },
            status: 'pending' as const,
            attemptCount: 0,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: this.createErrorDetail(error, 'Failed to send test webhook', input.action),
      };
    }
  }

  /**
   * Get webhook statistics
   */
  private async handleGetStats(
    input: Extract<SheetsWebhookInput['request'], { action: 'get_stats' }>
  ): Promise<SheetsWebhookOutput['response']> {
    try {
      const manager = getWebhookManager();
      const queue = getWebhookQueue();

      // Get queue stats
      const queueStats = await queue.getStats();

      // Get webhook stats
      const webhooks = input.webhookId
        ? [await manager.get(input.webhookId)].filter(Boolean)
        : await manager.list();

      const totalDeliveries = webhooks.reduce((sum, w) => sum + (w?.deliveryCount || 0), 0);
      const totalFailures = webhooks.reduce((sum, w) => sum + (w?.failureCount || 0), 0);
      const activeWebhooks = webhooks.filter((w) => w?.active).length;

      // Phase 4.2A: Get event type breakdown for specific webhook
      let eventTypeBreakdown;
      if (input.webhookId) {
        const eventStats = await manager.getEventStats(input.webhookId);
        if (eventStats) {
          eventTypeBreakdown = Object.entries(eventStats).map(([eventType, counts]) => ({
            eventType,
            detectedCount: counts.detected,
            deliveredCount: counts.delivered,
            filteringEfficiency:
              counts.detected > 0
                ? ((counts.detected - counts.delivered) / counts.detected) * 100
                : 0,
          }));
        }
      }

      const stats = {
        totalWebhooks: webhooks.length,
        activeWebhooks,
        totalDeliveries,
        successfulDeliveries: totalDeliveries - totalFailures,
        failedDeliveries: totalFailures,
        pendingDeliveries: queueStats.pendingCount,
        averageDeliveryTimeMs: 0, // Would need to track delivery times
        eventTypeBreakdown, // Phase 4.2A: Event type stats (only for specific webhook)
        webhookStats: input.webhookId
          ? undefined
          : webhooks.map((w) => ({
              webhookId: w?.webhookId || '',
              deliveryCount: w?.deliveryCount || 0,
              successRate:
                (w?.deliveryCount || 0) > 0
                  ? ((w?.deliveryCount || 0) - (w?.failureCount || 0)) / (w?.deliveryCount || 0)
                  : 0,
              averageLatencyMs: 0,
            })),
      };

      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      return {
        success: false,
        error: this.createErrorDetail(error, 'Failed to get webhook stats', input.action),
      };
    }
  }

  /**
   * Watch changes via Google Drive files.watch API.
   * Sets up push notifications when a spreadsheet file changes.
   * This is a native Google API feature (not custom webhooks).
   */
  private async handleWatchChanges(
    input: import('../schemas/webhook.js').WebhookWatchChangesInput
  ): Promise<SheetsWebhookOutput['response']> {
    if (!this.driveApi) {
      return {
        success: false,
        error: {
          code: ErrorCodes.CONFIG_ERROR,
          message: 'Drive API client not available. watch_changes requires Drive API access.',
          retryable: false,
          resolution: 'Ensure the server is initialized with Drive API scopes.',
        },
      };
    }

    try {
      const channelId = input.channelId ?? `servalsheets-${randomUUID()}`;
      const expiration = Date.now() + (input.expirationMs ?? 43200000);

      // SEC-5: SSRF protection — validate URL before passing to Drive API
      await validateWebhookUrl(input.webhookUrl);

      const response = await this.driveApi.files.watch({
        fileId: input.spreadsheetId,
        requestBody: {
          id: channelId,
          type: 'web_hook',
          address: input.webhookUrl,
          expiration: String(expiration),
          token: channelId, // Required: echoed as X-Goog-Channel-Token header in callbacks
        },
      });

      const resourceId = response.data.resourceId ?? '';
      await getWebhookManager()?.storeWatchChannel(
        channelId,
        resourceId,
        input.spreadsheetId,
        input.webhookUrl,
        expiration
      );

      logger.info('Drive files.watch channel created', {
        channelId,
        spreadsheetId: input.spreadsheetId,
        resourceId: response.data.resourceId,
        expiration: new Date(expiration).toISOString(),
      });

      return {
        success: true,
        data: {
          success: true,
          message: 'Drive files.watch channel created successfully',
          channelId,
          resourceId: response.data.resourceId ?? '',
          expiration: new Date(expiration).toISOString(),
          spreadsheetId: input.spreadsheetId,
          webhookUrl: input.webhookUrl,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: this.createErrorDetail(
          error,
          'Failed to create Drive watch channel',
          'watch_changes'
        ),
      };
    }
  }
}

/**
 * Create webhook handler
 */
export function createWebhookHandler(options?: {
  driveApi?: drive_v3.Drive;
  workspaceEventsService?: WorkspaceEventsService;
}): WebhookHandler {
  return new WebhookHandler(options);
}
