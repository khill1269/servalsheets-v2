/**
 * ServalSheets - Workspace Events Service (Phase 4)
 *
 * Google Workspace Events API integration for push notification subscriptions.
 * Provides event-driven change detection via Pub/Sub for Google Workspace resources.
 *
 * Note: The Workspace Events API delivers events via Pub/Sub topics (not HTTP endpoints).
 * The notificationEndpoint field requires a Pub/Sub topic in the format:
 * projects/{project}/topics/{topic}
 *
 * @see https://developers.google.com/workspace/events
 */

import { logger } from '../utils/logger.js';
import { executeWithRetry } from '../utils/retry.js';
import { AuthenticationError, ServiceError } from '../core/errors.js';
import type { GoogleApiClient } from './google-api.js';

interface ActiveSubscription {
  id: string;
  spreadsheetId: string;
  notificationEndpoint: string;
  expireTime: string;
  renewalTimer?: ReturnType<typeof setTimeout>;
  createdAt: string;
}

const WORKSPACE_EVENTS_BASE_URL = 'https://workspaceevents.googleapis.com/v1beta';
const DRIVE_CONTENT_CHANGED_EVENT = 'google.workspace.drive.file.v3.contentChanged';
const SUBSCRIPTION_TTL = '604800s';

export class WorkspaceEventsService {
  private subscriptions = new Map<string, ActiveSubscription>();

  constructor(private googleClient: GoogleApiClient) {}

  private isSubscriptionResourceName(name: string): boolean {
    return name.startsWith('subscriptions/');
  }

  private async getFreshAccessToken(): Promise<string> {
    const credentials = this.googleClient.oauth2.credentials;
    const expiryDate = credentials?.expiry_date as number | undefined;
    const isExpiringSoon = expiryDate !== undefined && expiryDate - Date.now() < 60_000;

    if (isExpiringSoon || !credentials?.access_token) {
      const result = await this.googleClient.oauth2.getAccessToken();
      const token = result?.token ?? credentials?.access_token;
      if (!token) {
        throw new AuthenticationError('Workspace Events API requires an OAuth access token');
      }
      return token;
    }

    return credentials.access_token;
  }

  private async executeWorkspaceEventsRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    return executeWithRetry(async (signal) => {
      const token = await this.getFreshAccessToken();
      const response = await fetch(`${WORKSPACE_EVENTS_BASE_URL}${path}`, {
        ...init,
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
      });

      if (!response.ok) {
        const body = await response.text();
        const error = new Error(
          `Workspace Events API ${response.status}: ${body.substring(0, 200)}`
        ) as Error & {
          response?: { status?: number; data?: string };
        };
        error.response = {
          status: response.status,
          data: body,
        };
        throw error;
      }

      if (response.status === 204) {
        return undefined as T; // OK: 204 No Content — subscription successful
      }

      return (await response.json()) as T;
    });
  }

  /**
   * Create a Workspace Events subscription for a spreadsheet.
   * @param spreadsheetId - Google Sheets file ID to monitor
   * @param pubsubTopic - Pub/Sub topic in format: projects/{project}/topics/{topic}
   */
  async createSubscription(spreadsheetId: string, pubsubTopic: string): Promise<string> {
    try {
      const operationData = await this.executeWorkspaceEventsRequest<{
        name?: string;
        response?: { name?: string };
        metadata?: { subscription?: { name?: string; expireTime?: string } };
      }>('/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          targetResource: `//drive.googleapis.com/files/${spreadsheetId}`,
          eventTypes: [DRIVE_CONTENT_CHANGED_EVENT],
          notificationEndpoint: {
            pubsubTopic,
          },
          payloadOptions: { includeResource: false },
        }),
      });

      const subscriptionId =
        operationData?.response?.name ??
        operationData?.metadata?.subscription?.name ??
        operationData?.name ??
        `ws-sub-${Date.now()}`;
      const expireTime =
        operationData?.metadata?.subscription?.expireTime ??
        new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

      const sub: ActiveSubscription = {
        id: subscriptionId,
        spreadsheetId,
        notificationEndpoint: pubsubTopic,
        expireTime,
        createdAt: new Date().toISOString(),
      };

      this.subscriptions.set(sub.id, sub);
      if (this.isSubscriptionResourceName(sub.id)) {
        this.scheduleRenewal(sub);
      } else {
        logger.warn(
          'Workspace Events subscription create returned operation name without resource',
          {
            spreadsheetId,
            operationName: sub.id,
          }
        );
      }
      logger.info('Workspace Events subscription created', { id: sub.id, spreadsheetId });
      return sub.id;
    } catch (err) {
      throw new ServiceError(
        `Failed to create Workspace Events subscription: ${err instanceof Error ? err.message : String(err)}`,
        'INTERNAL_ERROR',
        'WorkspaceEvents',
        true
      );
    }
  }

  private scheduleRenewal(sub: ActiveSubscription): void {
    const msUntilRenewal = new Date(sub.expireTime).getTime() - Date.now() - 12 * 3600 * 1000;
    if (msUntilRenewal > 0) {
      sub.renewalTimer = setTimeout(() => this.renewSubscription(sub.id), msUntilRenewal);
    }
  }

  async renewSubscription(subscriptionId: string): Promise<void> {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return;
    if (!this.isSubscriptionResourceName(subscriptionId)) {
      logger.warn('Skipping Workspace Events renewal for unresolved operation name', {
        id: subscriptionId,
      });
      return;
    }

    try {
      const patchData = await this.executeWorkspaceEventsRequest<{ expireTime?: string }>(
        `/${subscriptionId}?updateMask=ttl`,
        {
          method: 'PATCH',
          body: JSON.stringify({ ttl: SUBSCRIPTION_TTL }),
        }
      );

      sub.expireTime =
        patchData?.expireTime ?? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      if (sub.renewalTimer) clearTimeout(sub.renewalTimer);
      this.scheduleRenewal(sub);
      logger.info('Workspace Events subscription renewed', { id: subscriptionId });
    } catch (err) {
      logger.warn('Failed to renew Workspace Events subscription', {
        id: subscriptionId,
        error: String(err),
      });
    }
  }

  async deleteSubscription(subscriptionId: string): Promise<void> {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub?.renewalTimer) clearTimeout(sub.renewalTimer);

    if (this.isSubscriptionResourceName(subscriptionId)) {
      try {
        await this.executeWorkspaceEventsRequest<void>(`/${subscriptionId}`, {
          method: 'DELETE',
        });
      } catch {
        // Best effort — remove from local tracking regardless
      }
    }
    this.subscriptions.delete(subscriptionId);
  }

  listSubscriptions(spreadsheetId?: string): ActiveSubscription[] {
    const all = Array.from(this.subscriptions.values());
    return spreadsheetId ? all.filter((s) => s.spreadsheetId === spreadsheetId) : all;
  }
}
