/**
 * Simple in-memory EventStore for Streamable HTTP resumability.
 *
 * This is a bounded, TTL-based store intended for production-safe defaults.
 * For larger deployments, replace with a persistent store.
 */

import { randomUUID } from 'crypto';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type {
  EventStore,
  EventId,
  StreamId,
} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { RedisClientType } from 'redis';
import { logger } from '../utils/logger.js';
import { ConfigError, ServiceError } from '../core/errors.js';

type StoredEvent = {
  streamId: StreamId;
  message: JSONRPCMessage;
  createdAt: number;
};

type RedisEventStoreOptions = {
  keyPrefix?: string;
  ttlMs?: number;
  maxEvents?: number;
  streamId?: StreamId;
};

export class InMemoryEventStore implements EventStore {
  private events = new Map<EventId, StoredEvent>();
  private order: EventId[] = [];
  private maxEvents: number;
  private ttlMs: number;

  constructor(options?: { maxEvents?: number; ttlMs?: number }) {
    this.maxEvents = Math.max(1, options?.maxEvents ?? 5000);
    this.ttlMs = Math.max(1000, options?.ttlMs ?? 5 * 60 * 1000);
  }

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    this.prune();
    const eventId = `${streamId}_${Date.now()}_${randomUUID()}`;
    this.events.set(eventId, {
      streamId,
      message,
      createdAt: Date.now(),
    });
    this.order.push(eventId);
    this.enforceMax();
    return eventId;
  }

  async getStreamIdForEventId(eventId: EventId): Promise<StreamId | undefined> {
    return this.events.get(eventId)?.streamId;
  }

  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> }
  ): Promise<StreamId> {
    this.prune();
    const lastIndex = this.order.indexOf(lastEventId);
    if (lastIndex === -1) {
      // ISSUE-146: Log expired/unknown cursor so operators can observe reconnect frequency.
      // Returning '' signals the MCP client to re-initialize from current state.
      logger.warn('event_store_cursor_expired', {
        eventId: lastEventId,
        storeSize: this.order.length,
        hint: 'Client must re-initialize; cursor was evicted from FIFO buffer or is unknown',
      });
      return '';
    }

    const streamId = this.events.get(lastEventId)?.streamId;
    if (!streamId) {
      return '';
    }

    for (let i = lastIndex + 1; i < this.order.length; i += 1) {
      const eventId = this.order[i];
      if (!eventId) {
        continue;
      }
      const event = this.events.get(eventId);
      if (!event || event.streamId !== streamId) {
        continue;
      }
      await send(eventId, event.message);
    }

    return streamId;
  }

  clear(): void {
    this.events.clear();
    this.order = [];
  }

  private prune(): void {
    const cutoff = Date.now() - this.ttlMs;
    const expired = [];
    for (const [eventId, event] of this.events.entries()) {
      if (event.createdAt < cutoff) {
        expired.push(eventId);
      }
    }
    if (expired.length > 0) {
      for (const eventId of expired) {
        this.events.delete(eventId);
      }
      this.order = this.order.filter((eventId) => this.events.has(eventId));
    }
    this.enforceMax();
  }

  private enforceMax(): void {
    if (this.order.length <= this.maxEvents) {
      return;
    }
    const overflow = this.order.length - this.maxEvents;
    const toDelete = this.order.splice(0, overflow);
    for (const eventId of toDelete) {
      this.events.delete(eventId);
    }
  }
}

export class RedisEventStore implements EventStore {
  private static client: RedisClientType | null = null;
  private static connected = false;
  private static connecting: Promise<void> | null = null;
  private static redisUrl: string | null = null;

  private keyPrefix: string;
  private ttlMs: number;
  private maxEvents: number;
  private streamIds = new Set<StreamId>();

  constructor(
    private redisUrl: string,
    options?: RedisEventStoreOptions
  ) {
    this.keyPrefix = options?.keyPrefix ?? 'servalsheets:mcp:';
    this.ttlMs = Math.max(1000, options?.ttlMs ?? 5 * 60 * 1000);
    this.maxEvents = Math.max(1, options?.maxEvents ?? 5000);
    if (options?.streamId) {
      this.streamIds.add(options.streamId);
    }
  }

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    await this.ensureConnected();
    this.streamIds.add(streamId);

    const sequenceKey = this.getSequenceKey(streamId);
    const sequence = await RedisEventStore.client!.incr(sequenceKey);
    const eventId = `${streamId}:${sequence}`;
    const eventKey = this.getEventKey(streamId, sequence);
    const eventsKey = this.getEventsKey(streamId);
    const ttlSeconds = Math.max(1, Math.ceil(this.ttlMs / 1000));

    const pipeline = RedisEventStore.client!.multi();
    pipeline.set(eventKey, JSON.stringify(message), { PX: this.ttlMs });
    pipeline.zAdd(eventsKey, [{ score: sequence, value: eventId }]);
    pipeline.expire(eventsKey, ttlSeconds);
    pipeline.expire(sequenceKey, ttlSeconds);
    await pipeline.exec();

    await this.trimIfNeeded(streamId);
    return eventId;
  }

  async getStreamIdForEventId(eventId: EventId): Promise<StreamId | undefined> {
    const parsed = this.parseEventId(eventId);
    if (!parsed) {
      return undefined;
    }
    await this.ensureConnected();
    const exists = await RedisEventStore.client!.exists(
      this.getEventKey(parsed.streamId, parsed.sequence)
    );
    return exists ? parsed.streamId : undefined;
  }

  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> }
  ): Promise<StreamId> {
    const parsed = this.parseEventId(lastEventId);
    if (!parsed) {
      // ISSUE-146: Malformed event ID — log and signal client to re-initialize
      logger.warn('event_store_cursor_malformed', {
        eventId: lastEventId,
        hint: 'Event ID could not be parsed; client must re-initialize',
      });
      return '';
    }

    await this.ensureConnected();

    const eventsKey = this.getEventsKey(parsed.streamId);
    const lastScore = await RedisEventStore.client!.zScore(eventsKey, lastEventId);
    if (lastScore === null) {
      // ISSUE-146: Cursor evicted from Redis (TTL expired) — log so operators can tune TTL
      logger.warn('event_store_cursor_expired', {
        eventId: lastEventId,
        streamId: parsed.streamId,
        hint: 'Cursor evicted from Redis; client must re-initialize. Consider increasing event TTL.',
      });
      return '';
    }

    const eventKey = this.getEventKey(parsed.streamId, parsed.sequence);
    const lastExists = await RedisEventStore.client!.exists(eventKey);
    if (!lastExists) {
      // ISSUE-146: Event data evicted even though score exists (TTL skew) — log for diagnostics
      logger.warn('event_store_event_data_missing', {
        eventId: lastEventId,
        streamId: parsed.streamId,
        hint: 'Event score exists but event data is missing; possible TTL skew between score and data',
      });
      return '';
    }

    const minScore = `(${lastScore}`;
    const eventIds = await RedisEventStore.client!.zRangeByScore(eventsKey, minScore, '+inf');
    if (!eventIds.length) {
      return parsed.streamId;
    }

    const entries: Array<{ eventId: EventId; eventKey: string }> = [];
    for (const eventId of eventIds) {
      const entry = this.parseEventId(eventId);
      if (!entry || entry.streamId !== parsed.streamId) {
        continue;
      }
      entries.push({ eventId, eventKey: this.getEventKey(entry.streamId, entry.sequence) });
    }

    if (entries.length === 0) {
      return parsed.streamId;
    }

    const payloads = await RedisEventStore.client!.mGet(entries.map((entry) => entry.eventKey));
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!entry) {
        continue;
      }
      const payload = payloads[i];
      if (!payload) {
        continue;
      }
      try {
        const message = JSON.parse(payload) as JSONRPCMessage;
        await send(entry.eventId, message);
      } catch (error) {
        logger.warn('Failed to replay event from Redis', { eventId: entry.eventId, error });
      }
    }

    return parsed.streamId;
  }

  async clear(): Promise<void> {
    if (this.streamIds.size === 0 && !RedisEventStore.connected) {
      return;
    }

    await this.ensureConnected();
    const streamIds = [...this.streamIds];
    for (const streamId of streamIds) {
      await this.deleteStream(streamId);
      this.streamIds.delete(streamId);
    }
  }

  private async ensureConnected(): Promise<void> {
    if (RedisEventStore.connected) {
      return;
    }

    if (RedisEventStore.redisUrl && RedisEventStore.redisUrl !== this.redisUrl) {
      throw new ConfigError('RedisEventStore configured with multiple Redis URLs.', 'REDIS_URL');
    }

    if (!RedisEventStore.connecting) {
      RedisEventStore.redisUrl = this.redisUrl;
      RedisEventStore.connecting = (async () => {
        try {
          // Dynamic import to make Redis optional
          // @ts-ignore - Redis is an optional peer dependency
          const { createClient } = await import('redis');

          const client = createClient({ url: this.redisUrl });
          client.on('error', (err: Error) => {
            logger.error('Redis event store error', { error: err });
          });
          await client.connect();

          RedisEventStore.client = client as RedisClientType;
          RedisEventStore.connected = true;
          logger.info('Redis event store connected');
        } catch (error) {
          RedisEventStore.connecting = null;
          throw new ServiceError(
            `Failed to connect to Redis at ${this.redisUrl}. ` +
              `Make sure Redis is installed (npm install redis) and running. ` +
              `Error: ${error instanceof Error ? error.message : String(error)}`,
            'INTERNAL_ERROR',
            'redis',
            true
          );
        }
      })();
    }

    await RedisEventStore.connecting;
  }

  private getEventsKey(streamId: StreamId): string {
    return `${this.keyPrefix}${streamId}:events`;
  }

  private getSequenceKey(streamId: StreamId): string {
    return `${this.keyPrefix}${streamId}:seq`;
  }

  private getEventKey(streamId: StreamId, sequence: number): string {
    return `${this.keyPrefix}${streamId}:event:${sequence}`;
  }

  private parseEventId(eventId: EventId): { streamId: StreamId; sequence: number } | null {
    const [streamId, sequenceText] = eventId.split(':');
    const sequence = Number(sequenceText);
    if (!streamId || !Number.isFinite(sequence)) {
      return null;
    }
    return { streamId, sequence };
  }

  private async trimIfNeeded(streamId: StreamId): Promise<void> {
    if (this.maxEvents <= 0) {
      return;
    }

    const eventsKey = this.getEventsKey(streamId);
    const count = await RedisEventStore.client!.zCard(eventsKey);
    if (count <= this.maxEvents) {
      return;
    }

    const overflow = count - this.maxEvents;
    const toRemove = await RedisEventStore.client!.zRange(eventsKey, 0, overflow - 1);
    if (!toRemove.length) {
      return;
    }

    const pipeline = RedisEventStore.client!.multi();
    pipeline.zRemRangeByRank(eventsKey, 0, overflow - 1);
    for (const eventId of toRemove) {
      const parsed = this.parseEventId(eventId);
      if (!parsed) {
        continue;
      }
      pipeline.del(this.getEventKey(parsed.streamId, parsed.sequence));
    }
    await pipeline.exec();
  }

  private async deleteStream(streamId: StreamId): Promise<void> {
    const client = RedisEventStore.client;
    if (!client) {
      throw new ServiceError('Redis client not connected', 'INTERNAL_ERROR', 'redis');
    }

    const eventsKey = this.getEventsKey(streamId);
    const eventIds = (await client.zRange(eventsKey, 0, -1)) as string[];
    const pipeline = client.multi();

    if (eventIds.length > 0) {
      const eventKeys = eventIds
        .map((eventId: string) => this.parseEventId(eventId))
        .filter((entry): entry is { streamId: StreamId; sequence: number } => Boolean(entry))
        .map((entry) => this.getEventKey(entry.streamId, entry.sequence));
      if (eventKeys.length > 0) {
        // Use array spread - pipeline.del accepts variadic arguments
        pipeline.del(eventKeys as [string, ...string[]]);
      }
    }

    pipeline.del(eventsKey);
    pipeline.del(this.getSequenceKey(streamId));
    await pipeline.exec();
  }
}
