import type { Express, Request, Response } from 'express';
import { env } from '../config/env.js';
import type { DiffResult } from '../schemas/shared.js';
import type { WebhookEventType, WebhookPayload } from '../schemas/webhook.js';
import { getWebhookManager, getWebhookQueue } from '../services/index.js';
import { logger } from '../utils/logger.js';

/**
 * Helper function to categorize changes into webhook event types
 * (Phase 4.2A - Fine-Grained Event Filtering)
 */
function categorizeChanges(diff: DiffResult): WebhookEventType[] {
  const eventTypes = new Set<WebhookEventType>();

  // Check for sheet-level changes
  if (diff.sheetChanges) {
    if (diff.sheetChanges.sheetsAdded.length > 0) {
      eventTypes.add('sheet.create');
    }
    if (diff.sheetChanges.sheetsRemoved.length > 0) {
      eventTypes.add('sheet.delete');
    }
    if (diff.sheetChanges.sheetsRenamed.length > 0) {
      eventTypes.add('sheet.rename');
    }
  }

  // Check for cell changes (tier-specific)
  if (diff.tier === 'SAMPLE' && diff.samples) {
    const hasChanges =
      diff.samples.firstRows.length > 0 ||
      diff.samples.lastRows.length > 0 ||
      diff.samples.randomRows.length > 0;
    if (hasChanges) {
      eventTypes.add('cell.update');
    }
  } else if (diff.tier === 'FULL' && diff.changes) {
    if (diff.changes.length > 0) {
      // Check if changes include format changes
      const hasFormatChanges = diff.changes.some((c) => c.type === 'format');
      if (hasFormatChanges) {
        eventTypes.add('format.update');
      }
      eventTypes.add('cell.update');
    }
  }

  // Fallback to generic sheet.update if no specific events detected
  if (eventTypes.size === 0) {
    eventTypes.add('sheet.update');
  }

  return Array.from(eventTypes);
}

export function registerHttpWebhookRoutes(app: Express): void {
  // =====================================================================
  // Phase 1: Webhook Drive API Callback Endpoint
  // =====================================================================

  /**
   * POST /webhook/drive-callback
   *
   * Receives push notifications from Google Drive API watch channels.
   * Validates X-Goog headers, enqueues events for async delivery.
   *
   * Drive API headers:
   * - X-Goog-Channel-ID: Unique channel identifier
   * - X-Goog-Resource-State: Event type (sync, update, trash, etc.)
   * - X-Goog-Resource-ID: Resource identifier from watch response
   * - X-Goog-Channel-Token: Webhook ID for correlation
   * - X-Goog-Message-Number: Monotonic counter for this channel
   */
  app.post('/webhook/drive-callback', async (req: Request, res: Response) => {
    try {
      const channelId = req.get('x-goog-channel-id');
      const resourceState = req.get('x-goog-resource-state');
      const resourceId = req.get('x-goog-resource-id');
      const channelToken = req.get('x-goog-channel-token');
      const messageNumberStr = req.get('x-goog-message-number');

      // Validate required headers
      if (!channelId || !resourceState || !resourceId || !channelToken || !messageNumberStr) {
        logger.warn('Invalid Drive webhook callback: missing headers', {
          headers: req.headers,
        });
        res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing required webhook headers',
          },
        });
        return;
      }

      const messageNumber = parseInt(messageNumberStr, 10);
      if (isNaN(messageNumber)) {
        logger.warn('Invalid Drive webhook callback: invalid message number', {
          messageNumber: messageNumberStr,
        });
        res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid message number',
          },
        });
        return;
      }

      // Handle sync event (initial verification)
      if (resourceState === 'sync') {
        logger.info('Drive webhook sync event acknowledged', { channelId });
        res.status(200).send('OK');
        return;
      }

      // Get webhook record
      const webhookManager = getWebhookManager();
      if (!webhookManager) {
        logger.error('Webhook manager not initialized');
        res.status(503).json({
          error: {
            code: 'SERVICE_NOT_INITIALIZED',
            message: 'Webhook manager not available',
          },
        });
        return;
      }

      const webhook = await webhookManager.get(channelToken);
      if (!webhook) {
        logger.warn('Webhook not found for callback', { webhookId: channelToken });
        res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Webhook not found',
          },
        });
        return;
      }

      // Validate channelId and resourceId match stored values (security check against spoofing)
      if (webhook.channelId !== channelId || webhook.resourceId !== resourceId) {
        logger.warn('Webhook validation failed - ID mismatch', {
          webhookId: channelToken,
          headerChannelId: channelId,
          storedChannelId: webhook.channelId,
          headerResourceId: resourceId,
          storedResourceId: webhook.resourceId,
        });
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Unauthorized webhook - ID mismatch',
          },
        });
        return;
      }

      logger.info('Webhook validation passed', {
        webhookId: channelToken,
        channelId,
        resourceId,
      });

      // Phase 4.2A: Use DiffEngine to detect and categorize changes
      let detectedEventTypes: WebhookEventType[] = [];
      let changeDetails: WebhookPayload['changeDetails'] = undefined;

      try {
        // Capture current state
        const currentState = await webhookManager.diffEngine.captureState(webhook.spreadsheetId, {
          tier: 'SAMPLE', // Use SAMPLE tier for balance between accuracy and performance
        });

        // Try to get cached previous state
        const previousState = await webhookManager.getCachedState(webhook.spreadsheetId);

        if (previousState) {
          // Compare states to detect specific changes
          const diff = await webhookManager.diffEngine.compareStates(previousState, currentState);

          // Categorize changes into event types
          detectedEventTypes = categorizeChanges(diff);

          // Build changeDetails for webhook payload
          const cellRanges: string[] = [];

          // Extract cell ranges based on diff tier
          if (diff.tier === 'FULL' && diff.changes && diff.changes.length > 0) {
            // For FULL tier, collect first few changed cells (already in A1 notation)
            const cells = diff.changes.slice(0, 10).map((c) => c.cell);
            if (cells.length > 0) {
              cellRanges.push(cells.join(', '));
            }
          } else if (diff.tier === 'SAMPLE' && diff.samples) {
            // For SAMPLE tier, note that changes were detected via sampling
            const totalSamples =
              diff.samples.firstRows.length +
              diff.samples.lastRows.length +
              diff.samples.randomRows.length;
            if (totalSamples > 0) {
              cellRanges.push(`${totalSamples} cells changed (detected via sampling)`);
            }
          }

          if (diff.sheetChanges) {
            changeDetails = {
              sheetsAdded: diff.sheetChanges.sheetsAdded.map((s) => s.title),
              sheetsRemoved: diff.sheetChanges.sheetsRemoved.map((s) => s.title),
              sheetsRenamed: diff.sheetChanges.sheetsRenamed.map((s) => ({
                from: s.oldTitle,
                to: s.newTitle,
              })),
              cellRanges,
            };
          }

          logger.info('Drive webhook changes detected', {
            webhookId: webhook.webhookId,
            spreadsheetId: webhook.spreadsheetId,
            detectedEventTypes,
            changeDetails,
          });
        } else {
          // No previous state - use fallback event type from Drive notification
          const eventTypeMap: Record<string, 'sheet.update' | 'sheet.delete'> = {
            update: 'sheet.update',
            trash: 'sheet.delete',
          };
          detectedEventTypes = [eventTypeMap[resourceState] || 'sheet.update'];

          logger.info('Drive webhook no previous state - using fallback', {
            webhookId: webhook.webhookId,
            spreadsheetId: webhook.spreadsheetId,
            resourceState,
            eventType: detectedEventTypes[0],
          });
        }

        // Cache current state for future comparisons
        await webhookManager.cacheState(webhook.spreadsheetId, currentState);
      } catch (diffError) {
        // Fallback to simple event mapping if diff fails
        logger.warn('Failed to detect changes via DiffEngine - using fallback', {
          webhookId: webhook.webhookId,
          spreadsheetId: webhook.spreadsheetId,
          error: diffError instanceof Error ? diffError.message : String(diffError),
        });

        const eventTypeMap: Record<string, 'sheet.update' | 'sheet.delete'> = {
          update: 'sheet.update',
          trash: 'sheet.delete',
        };
        detectedEventTypes = [eventTypeMap[resourceState] || 'sheet.update'];
      }

      // Filter detected events by webhook subscription
      const matchedEventTypes = detectedEventTypes.filter(
        (eventType) => webhook.eventTypes.includes(eventType) || webhook.eventTypes.includes('all')
      );

      // Skip delivery if no matched events
      if (matchedEventTypes.length === 0) {
        logger.info('Drive webhook events filtered out - no matching subscriptions', {
          webhookId: webhook.webhookId,
          spreadsheetId: webhook.spreadsheetId,
          detected: detectedEventTypes,
          subscribed: webhook.eventTypes,
        });

        res.status(200).send('OK');
        return;
      }

      // Enqueue events for async delivery
      const webhookQueue = getWebhookQueue();
      if (!webhookQueue) {
        logger.error('Webhook queue not initialized');
        res.status(503).json({
          error: {
            code: 'SERVICE_NOT_INITIALIZED',
            message: 'Webhook queue not available',
          },
        });
        return;
      }

      // Enqueue each matched event type separately
      for (const eventType of matchedEventTypes) {
        await webhookQueue.enqueue({
          webhookId: webhook.webhookId,
          webhookUrl: webhook.webhookUrl,
          eventType,
          payload: {
            channelId,
            resourceId,
            resourceState,
            spreadsheetId: webhook.spreadsheetId,
            messageNumber,
            timestamp: new Date().toISOString(),
            changeDetails,
          },
          secret: undefined, // Secret not exposed in WebhookInfo for security
          maxAttempts: env.WEBHOOK_MAX_ATTEMPTS,
          scheduledAt: Date.now(),
        });
      }

      // Phase 4.2A: Record event stats for filtering efficiency tracking
      await webhookManager.recordEventStats(
        webhook.webhookId,
        detectedEventTypes,
        matchedEventTypes
      );

      logger.info('Drive webhook events enqueued', {
        webhookId: webhook.webhookId,
        spreadsheetId: webhook.spreadsheetId,
        eventTypes: matchedEventTypes,
        filteredOut: detectedEventTypes.length - matchedEventTypes.length,
      });

      // Respond immediately (async delivery)
      res.status(200).send('OK');
    } catch (error) {
      logger.error('Drive webhook callback error', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to process webhook callback',
        },
      });
    }
  });

  // Workspace Events push notification endpoint (Phase 4)
  app.post('/webhook/workspace-events', (req: Request, res: Response) => {
    const event = req.body as Record<string, unknown>;
    const eventId =
      (event['id'] as string | undefined) ?? (event['messageId'] as string | undefined);
    logger.info('Received Workspace Events push notification', { eventId });

    // Acknowledge immediately and process asynchronously.
    res.status(200).json({ received: true });

    void (async () => {
      try {
        const webhookManager = getWebhookManager();
        await webhookManager.handleWorkspaceEvent(event);
      } catch (error) {
        logger.warn('Workspace event processing skipped', {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });

  // SERVAL() formula callback endpoint (Phase 5)
  app.post('/api/serval-formula', async (req: Request, res: Response) => {
    try {
      const body = JSON.stringify(req.body);
      const spreadsheetId = req.headers['x-serval-spreadsheetid'] as string;
      const signature = req.headers['x-serval-signature'] as string;

      if (!spreadsheetId || !signature) {
        res.status(401).json({ error: 'Missing authentication headers' });
        return;
      }

      const {
        validateHmacSignature,
        validateRequestTimestamp,
        checkAndRecordReplay,
        checkRateLimit,
        processBatchFormula,
      } = await import('../services/formula-callback.js');

      const batchRequest = req.body as {
        requests?: unknown;
        spreadsheetId?: unknown;
        timestamp?: unknown;
      };

      if (
        !batchRequest ||
        !Array.isArray(batchRequest.requests) ||
        typeof batchRequest.spreadsheetId !== 'string' ||
        typeof batchRequest.timestamp !== 'number'
      ) {
        res.status(400).json({ error: 'Invalid request payload' });
        return;
      }

      if (batchRequest.spreadsheetId !== spreadsheetId) {
        res.status(403).json({ error: 'Spreadsheet header mismatch' });
        return;
      }

      if (!validateRequestTimestamp(batchRequest.timestamp)) {
        res.status(401).json({ error: 'Stale or invalid request timestamp' });
        return;
      }

      if (!validateHmacSignature(body, spreadsheetId, signature)) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      if (!checkAndRecordReplay(spreadsheetId, signature)) {
        res.status(409).json({ error: 'Replay request rejected' });
        return;
      }

      if (!checkRateLimit(spreadsheetId)) {
        res.status(429).json({ error: 'Rate limit exceeded' });
        return;
      }

      const results = await processBatchFormula(
        batchRequest as Parameters<typeof processBatchFormula>[0]
      );
      res.status(200).json({ results });
    } catch (err) {
      logger.error('SERVAL formula callback error', { error: String(err) });
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}
