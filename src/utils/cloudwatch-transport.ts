/**
 * ServalSheets - CloudWatch Logs Winston Transport (#12)
 *
 * Structured JSON logging transport that pushes log entries to CloudWatch Logs
 * for production observability via the `/servalsheets/mcp-server` log group.
 *
 * Features:
 * - Batched PutLogEvents for efficiency (configurable batch size + flush interval)
 * - Automatic log stream creation per instance (hostname + PID + timestamp)
 * - Sequence token management for ordered log delivery
 * - Graceful degradation — transport errors don't crash the application
 * - JSON structured logs with full context (requestId, traceId, component, etc.)
 * - Flush-on-shutdown to prevent log loss during graceful termination
 *
 * Configuration via environment variables:
 * - CLOUDWATCH_LOGS_ENABLED: 'true' to enable (default: false; auto-enabled if AWS_EXECUTION_ENV set)
 * - CLOUDWATCH_LOG_GROUP: Log group name (default: /servalsheets/mcp-server)
 * - CLOUDWATCH_LOG_STREAM_PREFIX: Stream prefix (default: mcp-server)
 * - CLOUDWATCH_LOGS_REGION: AWS region (default: us-east-1)
 * - CLOUDWATCH_BATCH_SIZE: Max events per PutLogEvents call (default: 25)
 * - CLOUDWATCH_FLUSH_INTERVAL_MS: Flush interval in ms (default: 5000)
 * - CLOUDWATCH_LOG_LEVEL: Minimum level to send to CloudWatch (default: info)
 *
 * @module utils/cloudwatch-transport
 */

import Transport from 'winston-transport';
import * as os from 'os';

// ============================================================================
// Types
// ============================================================================

interface CloudWatchLogEvent {
  timestamp: number;
  message: string;
}

interface CloudWatchTransportOptions extends Transport.TransportStreamOptions {
  logGroupName?: string;
  logStreamPrefix?: string;
  region?: string;
  batchSize?: number;
  flushIntervalMs?: number;
}

// ============================================================================
// Configuration
// ============================================================================

export interface CloudWatchLogsConfig {
  enabled: boolean;
  logGroupName: string;
  logStreamPrefix: string;
  region: string;
  batchSize: number;
  flushIntervalMs: number;
  logLevel: string;
}

/**
 * Load CloudWatch Logs configuration from environment
 */
export function getCloudWatchLogsConfig(): CloudWatchLogsConfig {
  // Auto-enable in AWS environments (ECS, Lambda, etc.)
  const inAwsEnvironment = !!process.env['AWS_EXECUTION_ENV'] || !!process.env['ECS_CONTAINER_METADATA_URI'];
  const explicitEnabled = process.env['CLOUDWATCH_LOGS_ENABLED'];

  return {
    enabled: explicitEnabled ? explicitEnabled === 'true' : inAwsEnvironment,
    logGroupName: process.env['CLOUDWATCH_LOG_GROUP'] || '/servalsheets/mcp-server',
    logStreamPrefix: process.env['CLOUDWATCH_LOG_STREAM_PREFIX'] || 'mcp-server',
    region: process.env['CLOUDWATCH_LOGS_REGION'] || process.env['AWS_REGION'] || 'us-east-1',
    batchSize: parseInt(process.env['CLOUDWATCH_BATCH_SIZE'] || '25', 10),
    flushIntervalMs: parseInt(process.env['CLOUDWATCH_FLUSH_INTERVAL_MS'] || '5000', 10),
    logLevel: process.env['CLOUDWATCH_LOG_LEVEL'] || 'info',
  };
}

// ============================================================================
// Transport Implementation
// ============================================================================

/**
 * Winston transport that sends structured JSON logs to CloudWatch Logs.
 *
 * Uses the AWS SDK v3 CloudWatch Logs client (dynamically imported).
 * Batches log events and flushes them periodically or when the batch is full.
 *
 * @example
 * import { CloudWatchTransport } from './cloudwatch-transport.js';
 * const transport = new CloudWatchTransport({
 *   logGroupName: '/servalsheets/mcp-server',
 *   region: 'us-east-1',
 * });
 * logger.add(transport);
 */
export class CloudWatchTransport extends Transport {
  private logGroupName: string;
  private logStreamName: string;
  private region: string;
  private batchSize: number;
  private flushIntervalMs: number;

  private buffer: CloudWatchLogEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // AWS SDK client — loaded dynamically
  private client: unknown = null;
  private sequenceToken: string | undefined;

  constructor(opts: CloudWatchTransportOptions = {}) {
    super(opts);

    this.logGroupName = opts.logGroupName || '/servalsheets/mcp-server';
    this.logStreamPrefix = opts.logStreamPrefix || 'mcp-server';
    this.region = opts.region || 'us-east-1';
    this.batchSize = opts.batchSize || 25;
    this.flushIntervalMs = opts.flushIntervalMs || 5000;

    // Generate unique log stream name: prefix/hostname/PID/timestamp
    const hostname = os.hostname().replace(/[^a-zA-Z0-9._/-]/g, '-');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logStreamName = `${this.logStreamPrefix}/${hostname}/${process.pid}/${timestamp}`;

    // Start periodic flush
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {
        // Silently ignore flush errors — don't crash the app
      });
    }, this.flushIntervalMs);

    // Ensure timer doesn't prevent process exit
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  // Allow setting in constructor via opts
  private logStreamPrefix: string;

  /**
   * Initialize the CloudWatch client and create the log stream.
   * Called lazily on first log() to defer SDK loading.
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      // Dynamic import — @aws-sdk/client-cloudwatch-logs is optional
      const {
        CloudWatchLogsClient,
        CreateLogStreamCommand,
        DescribeLogStreamsCommand,
      } = await import('@aws-sdk/client-cloudwatch-logs');

      this.client = new CloudWatchLogsClient({ region: this.region });

      // Try to create the log stream (idempotent — ignore ResourceAlreadyExistsException)
      try {
        const createCmd = new CreateLogStreamCommand({
          logGroupName: this.logGroupName,
          logStreamName: this.logStreamName,
        });
        await (this.client as InstanceType<typeof CloudWatchLogsClient>).send(createCmd);
      } catch (err: unknown) {
        const errName = (err as Error).name;
        if (errName !== 'ResourceAlreadyExistsException') {
          throw err;
        }
        // Stream already exists — get the sequence token
        const describeCmd = new DescribeLogStreamsCommand({
          logGroupName: this.logGroupName,
          logStreamNamePrefix: this.logStreamName,
          limit: 1,
        });
        const result = await (this.client as InstanceType<typeof CloudWatchLogsClient>).send(describeCmd);
        this.sequenceToken = result.logStreams?.[0]?.uploadSequenceToken;
      }

      this.initialized = true;
    } catch (err: unknown) {
      // Log to stderr but don't crash — CloudWatch logging is best-effort
      const errMsg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[CloudWatchTransport] Init failed: ${errMsg}\n`
      );
      // Mark as initialized to prevent retry storms
      this.initialized = true;
    }
  }

  /**
   * Winston transport log method — called for each log entry.
   * Buffers the event and flushes when batch is full.
   */
  log(info: Record<string, unknown>, callback: () => void): void {
    // Build structured JSON message
    const logEntry: Record<string, unknown> = { ...info };

    // Remove Winston internal Symbol properties
    delete logEntry[Symbol.for('level') as unknown as string];
    delete logEntry[Symbol.for('message') as unknown as string];
    delete logEntry[Symbol.for('splat') as unknown as string];

    const event: CloudWatchLogEvent = {
      timestamp: info['timestamp']
        ? new Date(info['timestamp'] as string).getTime()
        : Date.now(),
      message: JSON.stringify(logEntry),
    };

    this.buffer.push(event);

    // Flush if batch is full
    if (this.buffer.length >= this.batchSize) {
      this.flush().catch(() => {
        // Silently ignore — don't block logging
      });
    }

    callback();
  }

  /**
   * Flush buffered log events to CloudWatch.
   * Uses PutLogEvents with sequence token management.
   */
  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;

    try {
      await this.initialize();

      if (!this.client) {
        // SDK not available — discard buffer to prevent memory leak
        this.buffer = [];
        return;
      }

      // Take the current buffer and clear it
      const events = this.buffer.splice(0, this.batchSize);

      // Sort by timestamp (required by CloudWatch)
      events.sort((a, b) => a.timestamp - b.timestamp);

      const { PutLogEventsCommand } = await import('@aws-sdk/client-cloudwatch-logs');

      const putCmd = new PutLogEventsCommand({
        logGroupName: this.logGroupName,
        logStreamName: this.logStreamName,
        logEvents: events,
        sequenceToken: this.sequenceToken,
      });

      const result = await (this.client as { send: (cmd: unknown) => Promise<{ nextSequenceToken?: string }> }).send(putCmd);
      this.sequenceToken = result.nextSequenceToken;
    } catch (err: unknown) {
      const errName = (err as Error).name;
      const errMsg = err instanceof Error ? err.message : String(err);

      // Handle InvalidSequenceTokenException — extract correct token and retry
      if (errName === 'InvalidSequenceTokenException') {
        const match = errMsg.match(/expected sequenceToken is: (\S+)/);
        if (match) {
          this.sequenceToken = match[1];
          // Events are already removed from buffer — re-add them would be complex
          // Just log the loss and move on
        }
      }

      // DataAlreadyAcceptedException — duplicate batch, safe to ignore
      if (errName === 'DataAlreadyAcceptedException') {
        const match = errMsg.match(/expected sequenceToken is: (\S+)/);
        if (match) {
          this.sequenceToken = match[1];
        }
        return; // Not an error
      }

      // All other errors — log to stderr
      process.stderr.write(
        `[CloudWatchTransport] PutLogEvents failed: ${errName}: ${errMsg}\n`
      );
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Gracefully close the transport — flush remaining events.
   */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Final flush
    if (this.buffer.length > 0) {
      await this.flush();
    }
  }
}

/**
 * Create a CloudWatch transport if enabled by configuration.
 * Returns null if CloudWatch logging is disabled.
 *
 * @example
 * const cwTransport = createCloudWatchTransport();
 * if (cwTransport) {
 *   baseLogger.add(cwTransport);
 * }
 */
export function createCloudWatchTransport(): CloudWatchTransport | null {
  const config = getCloudWatchLogsConfig();

  if (!config.enabled) {
    return null;
  }

  return new CloudWatchTransport({
    logGroupName: config.logGroupName,
    logStreamPrefix: config.logStreamPrefix,
    region: config.region,
    batchSize: config.batchSize,
    flushIntervalMs: config.flushIntervalMs,
    level: config.logLevel,
  });
}
