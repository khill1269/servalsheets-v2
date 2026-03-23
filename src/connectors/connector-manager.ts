/**
 * ServalSheets - Connector Manager
 *
 * Central orchestration layer for all data connectors.
 * Handles registration, auth, quota tracking, caching, and subscriptions.
 */

import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { ConfigError, NotFoundError, ServiceError, ValidationError } from '../core/errors.js';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  SpreadsheetConnector,
  ConnectorCredentials,
  ConnectorRegistryEntry,
  HealthStatus,
  DataResult,
  QueryParams,
  Subscription,
  RefreshSchedule,
  TransformSpec,
  DataEndpoint,
  DataSchema,
} from './types.js';
import { FinnhubConnector } from './finnhub.js';
import { FredConnector } from './fred.js';
import { AlphaVantageConnector } from './alpha-vantage.js';
import { FmpConnector } from './fmp.js';
import { PolygonConnector } from './polygon.js';
import { GmailConnector } from './gmail-connector.js';
import { DriveConnector } from './drive-connector.js';
import { DocsConnector } from './docs-connector.js';
import { GenericRestConnector } from './rest-generic.js';
import { SecEdgarConnector } from './sec-edgar-connector.js';
import { WorldBankConnector } from './world-bank-connector.js';
import { OpenFigiConnector } from './openfigi-connector.js';

// ============================================================================
// Persistent Configuration Store
// ============================================================================

const CONNECTOR_CONFIG_DIR =
  process.env['CONNECTOR_CONFIG_DIR'] || path.join(process.cwd(), '.serval', 'connectors');

interface EncryptedConfigRecord {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

function getSaltFile(configDir: string = CONNECTOR_CONFIG_DIR): string {
  return path.join(configDir, '.salt');
}

function getOrCreateSalt(configDir: string = CONNECTOR_CONFIG_DIR): Buffer {
  const saltFile = getSaltFile(configDir);
  try {
    return fs.readFileSync(saltFile);
  } catch {
    const salt = randomBytes(32);
    try {
      fs.mkdirSync(path.dirname(saltFile), { recursive: true });
      fs.writeFileSync(saltFile, salt, { flag: 'wx', mode: 0o600 });
      return salt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return fs.readFileSync(saltFile);
      }
      // If we can't persist the salt, use it for this session only
    }
    return salt;
  }
}

function deriveKey(configDir: string = CONNECTOR_CONFIG_DIR): Buffer | null {
  const password = process.env['CONNECTOR_ENCRYPTION_KEY'];
  if (!password) return null;
  const salt = getOrCreateSalt(configDir);
  // OWASP-recommended scrypt parameters: N=131072 (2^17), r=8, p=1
  // Node.js defaults (N=16384) are insufficient for credential encryption.
  // Explicit maxmem is required for these stronger parameters; Node's default limit is too low.
  return scryptSync(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
}

function encryptConfig(plaintext: string, configDir: string = CONNECTOR_CONFIG_DIR): string {
  const key = deriveKey(configDir);
  if (!key) {
    throw new ConfigError(
      'Cannot save connector credentials: CONNECTOR_ENCRYPTION_KEY is not set. ' +
        'Set this environment variable to enable encrypted credential storage.',
      'CONNECTOR_ENCRYPTION_KEY'
    );
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();

  const record: EncryptedConfigRecord = {
    version: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
  return JSON.stringify(record);
}

function decryptConfig(content: string, configDir: string = CONNECTOR_CONFIG_DIR): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as Record<string, unknown>)['version'] !== 1 ||
    !(parsed as Record<string, unknown>)['ciphertext']
  ) {
    // Content is not encrypted — log a security warning if it looks like credentials JSON
    const keys = Object.keys(parsed as object);
    if (keys.some((k) => ['apiKey', 'token', 'secret', 'password', 'credentials'].includes(k))) {
      logger.warn(
        '[SECURITY] Connector config loaded from plaintext storage — re-save with CONNECTOR_ENCRYPTION_KEY set'
      );
    }
    return content;
  }

  const key = deriveKey(configDir);
  if (!key) {
    logger.warn(
      '[SECURITY] Encrypted connector config found but CONNECTOR_ENCRYPTION_KEY is not set — cannot decrypt'
    );
    return content;
  }

  const record = parsed as EncryptedConfigRecord;
  const iv = Buffer.from(record.iv, 'base64');
  const tag = Buffer.from(record.tag, 'base64');
  const ciphertext = Buffer.from(record.ciphertext, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

interface PersistedConnectorConfig {
  connectorId: string;
  credentials: ConnectorCredentials;
  configuredAt: string;
}

interface PersistedSubscription {
  id: string;
  connectorId: string;
  endpoint: string;
  params: QueryParams;
  schedule: RefreshSchedule;
  destination: { spreadsheetId: string; range: string };
  createdAt: string;
}

class ConnectorConfigStore {
  private configDir: string;

  constructor(configDir: string = CONNECTOR_CONFIG_DIR) {
    this.configDir = configDir;
  }

  async saveConfig(connectorId: string, credentials: ConnectorCredentials): Promise<void> {
    try {
      await fs.promises.mkdir(this.configDir, { recursive: true });
      const config: PersistedConnectorConfig = {
        connectorId,
        credentials,
        configuredAt: new Date().toISOString(),
      };
      const filePath = path.join(this.configDir, `${connectorId}.json`);
      const content = encryptConfig(JSON.stringify(config, null, 2), this.configDir);
      await fs.promises.writeFile(filePath, content, { encoding: 'utf-8', mode: 0o600 });
      logger.info('Connector config persisted', { connectorId });
    } catch (err) {
      logger.warn('Failed to persist connector config', {
        connectorId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async loadAll(): Promise<PersistedConnectorConfig[]> {
    try {
      await fs.promises.mkdir(this.configDir, { recursive: true });
      const files = await fs.promises.readdir(this.configDir);
      const configs: PersistedConnectorConfig[] = [];
      for (const file of files) {
        if (!file.endsWith('.json') || file.startsWith('sub_')) continue;
        try {
          const raw = await fs.promises.readFile(path.join(this.configDir, file), 'utf-8');
          const content = decryptConfig(raw, this.configDir);
          configs.push(JSON.parse(content) as PersistedConnectorConfig);
        } catch {
          // Skip corrupted config files
        }
      }
      return configs;
    } catch {
      return [];
    }
  }

  async deleteConfig(connectorId: string): Promise<void> {
    try {
      const filePath = path.join(this.configDir, `${connectorId}.json`);
      await fs.promises.unlink(filePath);
    } catch {
      // File may not exist — OK
    }
  }
}

class SubscriptionConfigStore {
  private configDir: string;

  constructor(configDir: string = CONNECTOR_CONFIG_DIR) {
    this.configDir = configDir;
  }

  async saveSubscription(sub: Subscription): Promise<void> {
    try {
      await fs.promises.mkdir(this.configDir, { recursive: true });
      const persisted: PersistedSubscription = {
        id: sub.id,
        connectorId: sub.connectorId,
        endpoint: sub.endpoint,
        params: sub.params,
        schedule: sub.schedule,
        destination: sub.destination,
        createdAt: new Date().toISOString(),
      };
      const filePath = path.join(this.configDir, `${sub.id}.json`);
      await fs.promises.writeFile(filePath, JSON.stringify(persisted, null, 2), 'utf-8');
      logger.info('Subscription persisted', { subscriptionId: sub.id });
    } catch (err) {
      logger.warn('Failed to persist subscription', {
        subscriptionId: sub.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async loadAll(): Promise<PersistedSubscription[]> {
    try {
      await fs.promises.mkdir(this.configDir, { recursive: true });
      const files = await fs.promises.readdir(this.configDir);
      const subscriptions: PersistedSubscription[] = [];
      for (const file of files) {
        if (!file.endsWith('.json') || !file.startsWith('sub_')) continue;
        try {
          const content = await fs.promises.readFile(path.join(this.configDir, file), 'utf-8');
          subscriptions.push(JSON.parse(content));
        } catch {
          // Skip corrupted subscription files
        }
      }
      return subscriptions;
    } catch {
      return [];
    }
  }

  async deleteSubscription(subscriptionId: string): Promise<void> {
    try {
      const filePath = path.join(this.configDir, `${subscriptionId}.json`);
      await fs.promises.unlink(filePath);
    } catch {
      // File may not exist — OK
    }
  }
}

// ============================================================================
// Quota Manager (token bucket per connector)
// ============================================================================

interface QuotaBucket {
  tokens: number;
  maxTokens: number;
  refillRate: number; // tokens per second
  lastRefill: number; // timestamp
}

class QuotaManager {
  private buckets = new Map<string, QuotaBucket>();

  configure(connectorId: string, requestsPerMinute: number): void {
    this.buckets.set(connectorId, {
      tokens: requestsPerMinute,
      maxTokens: requestsPerMinute,
      refillRate: requestsPerMinute / 60,
      lastRefill: Date.now(),
    });
  }

  tryConsume(connectorId: string): boolean {
    const bucket = this.buckets.get(connectorId);
    if (!bucket) return true; // No quota configured — allow

    // Refill tokens based on elapsed time
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  getUsage(connectorId: string): { used: number; limit: number } {
    const bucket = this.buckets.get(connectorId);
    if (!bucket) return { used: 0, limit: 0 };
    return {
      used: Math.round(bucket.maxTokens - bucket.tokens),
      limit: bucket.maxTokens,
    };
  }
}

// ============================================================================
// Cache Layer (TTL-based)
// ============================================================================

interface CacheEntry {
  data: DataResult;
  expiresAt: number;
}

class ConnectorCache {
  private cache = new Map<string, CacheEntry>();
  private defaultTtlMs = 30_000; // 30 seconds default
  private maxEntries = 500;

  get(key: string): DataResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: DataResult, ttlMs?: number): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  buildKey(connectorId: string, endpoint: string, params: QueryParams): string {
    const paramStr = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return `${connectorId}:${endpoint}:${paramStr}`;
  }

  clear(connectorId?: string): void {
    if (!connectorId) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${connectorId}:`)) {
        this.cache.delete(key);
      }
    }
  }
}

// ============================================================================
// Subscription Engine (with persistence)
// ============================================================================

class SubscriptionEngine {
  private subscriptions = new Map<string, Subscription>();
  private timers = new Map<
    string,
    ReturnType<typeof setInterval> | ReturnType<typeof cron.schedule>
  >();
  private nextId = 1;
  private configStore: SubscriptionConfigStore;

  constructor(configDir?: string) {
    this.configStore = new SubscriptionConfigStore(configDir);
  }

  add(
    connectorId: string,
    endpoint: string,
    params: QueryParams,
    schedule: RefreshSchedule,
    destination: { spreadsheetId: string; range: string },
    refreshCallback: (sub: Subscription) => Promise<void>
  ): Subscription {
    const id = `sub_${this.nextId++}`;
    const sub: Subscription = {
      id,
      connectorId,
      endpoint,
      params,
      schedule,
      destination,
      status: 'active',
    };
    this.subscriptions.set(id, sub);

    // Set up timer — use node-cron for custom cron expressions, setInterval for fixed intervals
    const runRefresh = async (): Promise<void> => {
      try {
        await refreshCallback(sub);
        sub.lastRefresh = new Date().toISOString();
        sub.status = 'active';
        sub.errorMessage = undefined;
      } catch (err) {
        sub.status = 'error';
        sub.errorMessage = err instanceof Error ? err.message : String(err);
      }
    };

    let timer: ReturnType<typeof setInterval> | ReturnType<typeof cron.schedule>;
    if (schedule.interval === 'custom' && schedule.customCronExpression) {
      if (!cron.validate(schedule.customCronExpression)) {
        throw new ValidationError(
          `Invalid cron expression: "${schedule.customCronExpression}". ` +
            'Use standard 5-field cron format (e.g., "0 */6 * * *" for every 6 hours).',
          'customCronExpression',
          '0 */6 * * *'
        );
      }
      timer = cron.schedule(schedule.customCronExpression, runRefresh, {
        timezone: schedule.timezone ?? 'UTC',
      });
      // nextRefresh is approximate for cron schedules; use 1-hour lookahead
      sub.nextRefresh = new Date(Date.now() + 3_600_000).toISOString();
    } else {
      const intervalMs = this.scheduleToMs(schedule);
      timer = setInterval(runRefresh, intervalMs);
      sub.nextRefresh = new Date(Date.now() + intervalMs).toISOString();
    }
    this.timers.set(id, timer);

    // Persist to disk
    this.persistSubscription(sub);

    return sub;
  }

  remove(subscriptionId: string): boolean {
    const timer = this.timers.get(subscriptionId);
    if (timer) {
      // node-cron tasks have a .stop() method; setInterval timers use clearInterval
      if (typeof (timer as { stop?: () => void }).stop === 'function') {
        (timer as { stop: () => void }).stop();
      } else {
        clearInterval(timer as ReturnType<typeof setInterval>);
      }
      this.timers.delete(subscriptionId);
    }
    const removed = this.subscriptions.delete(subscriptionId);
    if (removed) {
      this.removePersistedSubscription(subscriptionId);
    }
    return removed;
  }

  list(): Subscription[] {
    return [...this.subscriptions.values()];
  }

  private scheduleToMs(schedule: RefreshSchedule): number {
    switch (schedule.interval) {
      case 'hourly':
        return 3_600_000;
      case 'daily':
        return 86_400_000;
      case 'weekly':
        return 604_800_000;
      case 'custom':
        // custom schedules use cron.schedule() in the caller; this path is unreachable
        // but retained for type exhaustiveness
        return 3_600_000;
    }
  }

  private persistSubscription(sub: Subscription): void {
    this.configStore.saveSubscription(sub).catch((err) => {
      logger.warn('Failed to persist subscription', {
        subscriptionId: sub.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private removePersistedSubscription(subscriptionId: string): void {
    this.configStore.deleteSubscription(subscriptionId).catch((err) => {
      logger.warn('Failed to delete persisted subscription', {
        subscriptionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async loadPersistedSubscriptions(): Promise<PersistedSubscription[]> {
    return this.configStore.loadAll();
  }

  async initFromDisk(
    refreshCallback: (sub: Subscription) => Promise<void>
  ): Promise<{ restored: number }> {
    try {
      const persisted = await this.loadPersistedSubscriptions();
      let restored = 0;

      for (const persistedSub of persisted) {
        try {
          // Recreate subscription without incrementing nextId
          const sub: Subscription = {
            id: persistedSub.id,
            connectorId: persistedSub.connectorId,
            endpoint: persistedSub.endpoint,
            params: persistedSub.params,
            schedule: persistedSub.schedule,
            destination: persistedSub.destination,
            status: 'active',
          };

          this.subscriptions.set(sub.id, sub);

          // Re-establish timer
          const intervalMs = this.scheduleToMs(persistedSub.schedule);
          const timer = setInterval(async () => {
            try {
              await refreshCallback(sub);
              sub.lastRefresh = new Date().toISOString();
              sub.status = 'active';
              sub.errorMessage = undefined;
            } catch (err) {
              sub.status = 'error';
              sub.errorMessage = err instanceof Error ? err.message : String(err);
            }
          }, intervalMs);
          this.timers.set(sub.id, timer);

          sub.nextRefresh = new Date(Date.now() + intervalMs).toISOString();

          // Update nextId to prevent collisions
          const idNum = parseInt(sub.id.substring(4), 10);
          if (!isNaN(idNum)) {
            this.nextId = Math.max(this.nextId, idNum + 1);
          }

          restored++;
          logger.info('Subscription restored from disk', { subscriptionId: sub.id });
        } catch (err) {
          logger.warn('Failed to restore subscription', {
            subscriptionId: persistedSub.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return { restored };
    } catch (err) {
      logger.warn('Failed to load persisted subscriptions', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { restored: 0 };
    }
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      if (typeof (timer as { stop?: () => void }).stop === 'function') {
        (timer as { stop: () => void }).stop();
      } else {
        clearInterval(timer as ReturnType<typeof setInterval>);
      }
    }
    this.timers.clear();
    // NOTE: Do NOT clear subscriptions — they persist on disk
  }
}

// ============================================================================
// Transform Engine
// ============================================================================

/**
 * Safe numeric expression evaluator (no eval).
 * Supports +, -, *, /, parentheses, and numeric literals.
 */
function safeEvaluateExpression(expr: string): number | null {
  // Remove whitespace
  const cleaned = expr.replace(/\s+/g, '');
  // Only allow digits, operators, decimal points, parentheses
  if (!/^[\d+\-*/.()]+$/.test(cleaned)) return null;
  try {
    // Use Function constructor for arithmetic only (safer than eval, no variable access)

    const result = new Function(`return (${cleaned})`)();
    return typeof result === 'number' && isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

function applyTransform(data: DataResult, transform: TransformSpec): DataResult {
  let { headers, rows } = data;

  // Filter
  if (transform.filter && transform.filter.length > 0) {
    for (const f of transform.filter) {
      const colIdx = headers.indexOf(f.column);
      if (colIdx === -1) continue;
      rows = rows.filter((row) => {
        const val = row[colIdx];
        switch (f.operator) {
          case 'eq':
            return val === f.value;
          case 'neq':
            return val !== f.value;
          case 'gt':
            return typeof val === 'number' && val > Number(f.value);
          case 'lt':
            return typeof val === 'number' && val < Number(f.value);
          case 'gte':
            return typeof val === 'number' && val >= Number(f.value);
          case 'lte':
            return typeof val === 'number' && val <= Number(f.value);
          case 'contains':
            return String(val).includes(String(f.value));
          case 'starts_with':
            return String(val).startsWith(String(f.value));
          default:
            return true;
        }
      });
    }
  }

  // Sort
  if (transform.sort && transform.sort.length > 0) {
    for (const s of [...transform.sort].reverse()) {
      const colIdx = headers.indexOf(s.column);
      if (colIdx === -1) continue;
      rows.sort((a, b) => {
        const av = a[colIdx];
        const bv = b[colIdx];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp = av < bv ? -1 : 1;
        return s.direction === 'desc' ? -cmp : cmp;
      });
    }
  }

  // Column selection
  if (transform.columns && transform.columns.length > 0) {
    const indices = transform.columns.map((c) => headers.indexOf(c)).filter((i) => i !== -1);
    headers = indices.map((i) => headers[i]!);
    rows = rows.map((row) => indices.map((i) => row[i] ?? null));
  }

  // Limit
  if (transform.limit && transform.limit > 0) {
    rows = rows.slice(0, transform.limit);
  }

  // Aggregate V2 (group-by with aggregation functions)
  if (transform.aggregateV2) {
    const { groupBy, operations } = transform.aggregateV2;
    const groupIdx = headers.indexOf(groupBy);
    if (groupIdx !== -1) {
      const groups = new Map<string, (string | number | boolean | null)[][]>();
      for (const row of rows) {
        const key = String(row[groupIdx] ?? '');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      }

      const aggHeaders = [groupBy];
      const aggRows: (string | number | boolean | null)[][] = [];

      for (const op of operations) {
        aggHeaders.push(`${op.function}_${op.column}`);
      }

      for (const [key, groupRows] of groups) {
        const aggRow: (string | number | boolean | null)[] = [key];
        for (const op of operations) {
          const colIdx = headers.indexOf(op.column);
          if (colIdx === -1) {
            aggRow.push(null);
            continue;
          }
          const values = groupRows
            .map((r) => r[colIdx])
            .filter((v) => v !== null && v !== undefined);
          const nums = values.map(Number).filter((n) => !isNaN(n));

          switch (op.function) {
            case 'sum':
              aggRow.push(nums.reduce((a, b) => a + b, 0));
              break;
            case 'avg':
              aggRow.push(nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null);
              break;
            case 'count':
              aggRow.push(values.length);
              break;
            case 'min':
              aggRow.push(nums.length > 0 ? Math.min(...nums) : null);
              break;
            case 'max':
              aggRow.push(nums.length > 0 ? Math.max(...nums) : null);
              break;
            default:
              aggRow.push(null);
          }
        }
        aggRows.push(aggRow);
      }

      headers = aggHeaders;
      rows = aggRows;
    }
  }

  // Calculate (computed columns from expressions)
  if (transform.calculate && transform.calculate.length > 0) {
    for (const calc of transform.calculate) {
      headers = [...headers, calc.as];
      rows = rows.map((row) => {
        const ctx: Record<string, string | number | boolean | null> = {};
        for (let i = 0; i < headers.length - 1; i++) {
          ctx[headers[i]!] = row[i] ?? null;
        }
        let result: string | number | boolean | null = null;
        try {
          // Support simple arithmetic: column references and operators
          let expr = calc.expression;
          for (const [col, val] of Object.entries(ctx)) {
            expr = expr.replace(
              new RegExp(`\\b${col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'),
              String(val ?? 0)
            );
          }
          // Safe numeric evaluation (no eval)
          result = safeEvaluateExpression(expr);
        } catch {
          result = null;
        }
        return [...row, result];
      });
    }
  }

  // Pivot (reshape long → wide format)
  if (transform.pivot) {
    const { rowKey, pivotColumn, valueColumn } = transform.pivot;
    const rowIdx = headers.indexOf(rowKey);
    const pivotIdx = headers.indexOf(pivotColumn);
    const valIdx = headers.indexOf(valueColumn);

    if (rowIdx !== -1 && pivotIdx !== -1 && valIdx !== -1) {
      // Collect unique pivot values for column headers
      const pivotValues = [...new Set(rows.map((r) => String(r[pivotIdx] ?? '')))].sort();
      const pivotHeaders = [rowKey, ...pivotValues];

      // Group by row key
      const pivotMap = new Map<string, Map<string, string | number | boolean | null>>();
      for (const row of rows) {
        const rk = String(row[rowIdx] ?? '');
        const pk = String(row[pivotIdx] ?? '');
        if (!pivotMap.has(rk)) pivotMap.set(rk, new Map());
        pivotMap.get(rk)!.set(pk, row[valIdx] ?? null);
      }

      const pivotRows: (string | number | boolean | null)[][] = [];
      for (const [rk, values] of pivotMap) {
        const pivotRow: (string | number | boolean | null)[] = [rk];
        for (const pv of pivotValues) {
          pivotRow.push(values.get(pv) ?? null);
        }
        pivotRows.push(pivotRow);
      }

      headers = pivotHeaders;
      rows = pivotRows;
    }
  }

  // Deduplicate (remove duplicate rows based on a single column)
  if (transform.deduplicate) {
    const dedupeCol = transform.deduplicate.column;
    const colIdx = headers.indexOf(dedupeCol);
    if (colIdx !== -1) {
      const seen = new Set<string>();
      rows = rows.filter((row) => {
        const key = String(row[colIdx] ?? '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  }

  return {
    ...data,
    headers,
    rows,
    metadata: { ...data.metadata, rowCount: rows.length },
  };
}

// ============================================================================
// Connector Manager
// ============================================================================

/** Injectable sheet-write callback so ConnectorManager stays decoupled from the Sheets API. */
export type SheetWriterFn = (
  spreadsheetId: string,
  range: string,
  values: (string | number | boolean | null)[][]
) => Promise<void>;

export class ConnectorManager {
  private registry = new Map<string, ConnectorRegistryEntry>();
  private quotaManager = new QuotaManager();
  private cache = new ConnectorCache();
  private subscriptionEngine: SubscriptionEngine;
  private configStore: ConnectorConfigStore;
  private sheetWriter: SheetWriterFn | null = null;

  constructor(configDir?: string) {
    this.subscriptionEngine = new SubscriptionEngine(configDir);
    this.configStore = new ConnectorConfigStore(configDir);
  }

  /**
   * Inject a Sheets write function so subscription refresh callbacks can
   * persist results to the destination spreadsheet.
   * Call this once at server startup after the Google API client is ready.
   */
  setSheetWriter(fn: SheetWriterFn): void {
    this.sheetWriter = fn;
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  register(connector: SpreadsheetConnector): void {
    this.registry.set(connector.id, {
      connector,
      configured: connector.isConfigured(),
    });

    const limits = connector.getRateLimits();
    this.quotaManager.configure(connector.id, limits.requestsPerMinute);

    logger.info('Connector registered', { id: connector.id, name: connector.name });
  }

  hasConnector(connectorId: string): boolean {
    return this.registry.has(connectorId);
  }

  // ---------------------------------------------------------------------------
  // Actions (map to sheets_connectors actions)
  // ---------------------------------------------------------------------------

  listConnectors(): {
    connectors: {
      id: string;
      name: string;
      description: string;
      authType: string;
      configured: boolean;
      healthy?: boolean;
    }[];
  } {
    const connectors = [...this.registry.values()].map((entry) => ({
      id: entry.connector.id,
      name: entry.connector.name,
      description: entry.connector.description,
      authType: entry.connector.authType,
      configured: entry.configured,
      healthy: entry.lastHealthCheck?.healthy,
    }));
    return { connectors };
  }

  async configure(
    connectorId: string,
    credentials: ConnectorCredentials
  ): Promise<{ success: boolean; message: string }> {
    const entry = this.registry.get(connectorId);
    if (!entry) {
      return {
        success: false,
        message: `Connector '${connectorId}' not found. Use list_connectors to see available connectors.`,
      };
    }

    try {
      await entry.connector.configure(credentials);
      entry.configured = true;

      // Persist configuration to disk
      await this.configStore.saveConfig(connectorId, credentials);

      // Verify with health check
      const health = await entry.connector.healthCheck();
      entry.lastHealthCheck = health;

      return {
        success: health.healthy,
        message: health.healthy
          ? `Connector '${connectorId}' configured and verified (latency: ${health.latencyMs}ms)`
          : `Connector '${connectorId}' configured but health check failed: ${health.message}`,
      };
    } catch (err) {
      entry.configured = false;
      return {
        success: false,
        message: `Failed to configure '${connectorId}': ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async query(
    connectorId: string,
    endpoint: string,
    params: QueryParams,
    transform?: TransformSpec,
    useCache = true
  ): Promise<DataResult> {
    const entry = this.registry.get(connectorId);
    if (!entry) {
      throw new NotFoundError('connector', connectorId);
    }
    if (!entry.configured) {
      throw new ConfigError(
        `Connector '${connectorId}' is not configured. Use configure action first.`,
        connectorId
      );
    }

    // Check cache
    const cacheKey = this.cache.buildKey(connectorId, endpoint, params);
    if (useCache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        logger.debug('Connector cache hit', { connectorId, endpoint });
        const result = { ...cached, metadata: { ...cached.metadata, cached: true } };
        return transform ? applyTransform(result, transform) : result;
      }
    }

    // Check quota
    if (!this.quotaManager.tryConsume(connectorId)) {
      throw new ServiceError(
        `Rate limit exceeded for '${connectorId}'. Try again later.`,
        'QUOTA_EXCEEDED',
        connectorId,
        true
      );
    }

    // Execute query
    const result = await entry.connector.query(endpoint, params);

    // Cache result
    this.cache.set(cacheKey, result);

    // Apply transform
    return transform ? applyTransform(result, transform) : result;
  }

  async batchQuery(
    queries: {
      connectorId: string;
      endpoint: string;
      params: QueryParams;
      transform?: TransformSpec;
    }[]
  ): Promise<{ results: (DataResult | { error: string })[] }> {
    const results = await Promise.allSettled(
      queries.map((q) => this.query(q.connectorId, q.endpoint, q.params, q.transform))
    );

    return {
      results: results.map((r) =>
        r.status === 'fulfilled' ? r.value : { error: r.reason?.message ?? 'Unknown error' }
      ),
    };
  }

  subscribe(
    connectorId: string,
    endpoint: string,
    params: QueryParams,
    schedule: RefreshSchedule,
    destination: { spreadsheetId: string; range: string }
  ): Subscription {
    const entry = this.registry.get(connectorId);
    if (!entry) throw new NotFoundError('connector', connectorId);
    if (!entry.configured)
      throw new ConfigError(`Connector '${connectorId}' is not configured`, connectorId);

    return this.subscriptionEngine.add(
      connectorId,
      endpoint,
      params,
      schedule,
      destination,
      async (_sub) => {
        const result = await this.query(connectorId, endpoint, params, undefined, false);
        if (this.sheetWriter) {
          const values: (string | number | boolean | null)[][] = [result.headers, ...result.rows];
          await this.sheetWriter(destination.spreadsheetId, destination.range, values);
          logger.info('Subscription refresh wrote data to sheet', {
            connectorId,
            rows: result.rows.length,
            destination: destination.range,
          });
        } else {
          logger.warn('Subscription refresh: no sheet writer configured — data not persisted', {
            connectorId,
            rows: result.rows.length,
          });
        }
      }
    );
  }

  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptionEngine.remove(subscriptionId);
  }

  listSubscriptions(): Subscription[] {
    return this.subscriptionEngine.list();
  }

  async status(connectorId: string): Promise<{
    id: string;
    name: string;
    configured: boolean;
    health: HealthStatus | null;
    quota: { used: number; limit: number };
  }> {
    const entry = this.registry.get(connectorId);
    if (!entry) throw new NotFoundError('connector', connectorId);

    let health: HealthStatus | null = null;
    if (entry.configured) {
      try {
        health = await entry.connector.healthCheck();
        entry.lastHealthCheck = health;
      } catch {
        health = {
          healthy: false,
          latencyMs: 0,
          message: 'Health check failed',
          lastChecked: new Date().toISOString(),
        };
      }
    }

    return {
      id: entry.connector.id,
      name: entry.connector.name,
      configured: entry.configured,
      health,
      quota: this.quotaManager.getUsage(connectorId),
    };
  }

  async discover(connectorId: string): Promise<{ endpoints: DataEndpoint[] }> {
    const entry = this.registry.get(connectorId);
    if (!entry) throw new NotFoundError('connector', connectorId);
    if (!entry.configured)
      throw new ConfigError(`Connector '${connectorId}' is not configured`, connectorId);

    const endpoints = await entry.connector.listEndpoints();
    return { endpoints };
  }

  async getEndpointSchema(connectorId: string, endpoint: string): Promise<DataSchema> {
    const entry = this.registry.get(connectorId);
    if (!entry) throw new NotFoundError('connector', connectorId);
    return entry.connector.getSchema(endpoint);
  }

  // ---------------------------------------------------------------------------
  // Persistence & Lifecycle
  // ---------------------------------------------------------------------------

  async restorePersistedConfigs(): Promise<number> {
    try {
      const configs = await this.configStore.loadAll();
      let restored = 0;

      for (const config of configs) {
        const entry = this.registry.get(config.connectorId);
        if (!entry) {
          logger.warn('Persisted config references non-existent connector', {
            connectorId: config.connectorId,
          });
          continue;
        }

        try {
          await entry.connector.configure(config.credentials);
          entry.configured = true;
          restored++;
          logger.info('Connector configuration restored', { connectorId: config.connectorId });
        } catch (err) {
          logger.warn('Failed to restore connector configuration', {
            connectorId: config.connectorId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return restored;
    } catch (err) {
      logger.warn('Failed to load persisted configurations', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  async initialize(): Promise<void> {
    logger.info('Initializing ConnectorManager persistence layer');

    // Restore persisted connector configurations
    const configsRestored = await this.restorePersistedConfigs();
    logger.info('Connector configurations restored', { count: configsRestored });

    // Restore persisted subscriptions
    const refreshCallback = async (sub: Subscription): Promise<void> => {
      const result = await this.query(sub.connectorId, sub.endpoint, sub.params, undefined, false);
      if (this.sheetWriter && sub.destination) {
        const values: (string | number | boolean | null)[][] = [result.headers, ...result.rows];
        await this.sheetWriter(sub.destination.spreadsheetId, sub.destination.range, values);
        logger.info('Restored subscription refresh wrote data to sheet', {
          connectorId: sub.connectorId,
          rows: result.rows.length,
          destination: sub.destination.range,
        });
      }
    };

    const subsResult = await this.subscriptionEngine.initFromDisk(refreshCallback);
    logger.info('Subscriptions restored', { count: subsResult.restored });
  }

  async dispose(): Promise<void> {
    // Dispose subscriptions (stops timers but does NOT delete persisted state)
    this.subscriptionEngine.dispose();
    this.cache.clear();

    // Dispose connectors
    for (const entry of this.registry.values()) {
      try {
        await entry.connector.dispose();
      } catch {
        // Intent-based guard: best-effort cleanup
      }
    }
    this.registry.clear();

    logger.info('ConnectorManager disposed (persisted configs and subscriptions retained)');
  }
}

// Export singleton
export const connectorManager = new ConnectorManager();

let builtinsInitialized = false;

function createDefaultRestConnector(): GenericRestConnector {
  return new GenericRestConnector({
    id: 'public_json',
    name: 'Public JSON API',
    description: 'Generic REST/JSON connector for open APIs (no auth)',
    baseUrl: 'https://httpbin.org',
    auth: { type: 'none' },
    rateLimit: {
      requestsPerMinute: 60,
      requestsPerDay: 10_000,
    },
    endpoints: [
      {
        id: 'get',
        name: 'GET Echo',
        description: 'Echo GET request parameters and headers back as JSON',
        category: 'demo',
        method: 'GET',
        path: '/get',
        params: [
          {
            name: 'key',
            type: 'string',
            required: false,
            description: 'Any query parameter to include in echo response',
            in: 'query',
            example: 'value',
          },
        ],
      },
      {
        id: 'json',
        name: 'JSON Slide Show',
        description: 'Returns a sample JSON response with a slide show structure',
        category: 'demo',
        method: 'GET',
        path: '/json',
        params: [],
      },
    ],
  });
}

export function registerBuiltinConnectors(manager: ConnectorManager = connectorManager): {
  registered: number;
  total: number;
} {
  const builtins: SpreadsheetConnector[] = [
    new FinnhubConnector(),
    new FredConnector(),
    new AlphaVantageConnector(),
    new FmpConnector(),
    new PolygonConnector(),
    new GmailConnector(),
    new DriveConnector(),
    new DocsConnector(),
    new SecEdgarConnector(),
    new WorldBankConnector(),
    new OpenFigiConnector(),
    createDefaultRestConnector(),
  ];

  let registered = 0;
  for (const connector of builtins) {
    if (!manager.hasConnector(connector.id)) {
      manager.register(connector);
      registered++;
    }
  }

  return { registered, total: builtins.length };
}

export function initializeBuiltinConnectors(): void {
  if (builtinsInitialized) {
    return;
  }
  registerBuiltinConnectors(connectorManager);
  builtinsInitialized = true;
}

initializeBuiltinConnectors();

// Re-export transform for testing
export { applyTransform };
