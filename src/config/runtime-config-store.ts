/**
 * ServalSheets - Runtime Config Store
 *
 * Stores server-level keys (Anthropic, Redis, federation) that can be set
 * via sheets_auth.setup_feature without editing claude-desktop-config.json
 * or restarting Claude Desktop.
 *
 * Keys are encrypted at rest using AES-256-GCM + scrypt (same strength as
 * connector-manager.ts). Applied to process.env on load so all existing
 * env-var reads (llm-fallback.ts, webhook-manager.ts, etc.) continue to work
 * without modification.
 *
 * Store: $SERVAL_RUNTIME_CONFIG_PATH or $DATA_DIR/.serval/runtime-keys.json
 *        (falls back to .serval/runtime-keys.json under the current working directory)
 * Encryption: CONNECTOR_ENCRYPTION_KEY || ENCRYPTION_KEY (falls back gracefully)
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function resolveRuntimeConfigPath(): string {
  const explicitPath = process.env['SERVAL_RUNTIME_CONFIG_PATH'];
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  const dataDir = process.env['DATA_DIR'];
  if (dataDir && dataDir.trim().length > 0) {
    return path.join(path.resolve(dataDir), '.serval', 'runtime-keys.json');
  }

  return path.join(process.cwd(), '.serval', 'runtime-keys.json');
}

function shouldAutoApplyRuntimeConfig(): boolean {
  if (process.env['SERVAL_DISABLE_RUNTIME_ENV_AUTOLOAD'] === 'true') {
    return false;
  }

  return process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] !== 'true';
}

// ---------------------------------------------------------------------------
// Encryption (AES-256-GCM + scrypt, per-record random salt)
// ---------------------------------------------------------------------------

interface EncryptedRecord {
  version: 1;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

function getEncryptionPassword(): string | undefined {
  return process.env['CONNECTOR_ENCRYPTION_KEY'] ?? process.env['ENCRYPTION_KEY'];
}

function deriveKey(password: string, salt: Buffer): Buffer {
  // OWASP-recommended scrypt parameters (matches connector-manager.ts)
  return scryptSync(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
}

function encryptRecord(plaintext: string): string {
  const password = getEncryptionPassword();
  if (!password) {
    // No encryption key — store plaintext with a warning comment marker
    logger.warn(
      '[SECURITY] Runtime config stored without encryption. ' +
        'Set CONNECTOR_ENCRYPTION_KEY or ENCRYPTION_KEY to enable encryption.'
    );
    return JSON.stringify({ version: 1, plaintext });
  }
  const salt = randomBytes(32);
  const key = deriveKey(password, salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  const record: EncryptedRecord = {
    version: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  return JSON.stringify(record);
}

function decryptRecord(content: string): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return content;
  }

  // Plaintext fallback (no CONNECTOR_ENCRYPTION_KEY at save time)
  if (parsed['plaintext'] !== undefined) {
    return parsed['plaintext'] as string;
  }

  if (parsed['version'] !== 1 || !parsed['ciphertext'] || !parsed['salt']) {
    return content;
  }

  const password = getEncryptionPassword();
  if (!password) {
    logger.warn(
      '[SECURITY] Encrypted runtime config found but no encryption key available — cannot decrypt'
    );
    return content;
  }

  const salt = Buffer.from(parsed['salt'] as string, 'base64');
  const key = deriveKey(password, salt);
  const iv = Buffer.from(parsed['iv'] as string, 'base64');
  const tag = Buffer.from(parsed['tag'] as string, 'base64');
  const ciphertext = Buffer.from(parsed['ciphertext'] as string, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class RuntimeConfigStore {
  private configPath: string;

  constructor(configPath: string = resolveRuntimeConfigPath()) {
    this.configPath = configPath;
  }

  getPath(): string {
    return this.configPath;
  }

  /** Persist a single key-value pair. Merges with existing entries. */
  async save(key: string, value: string): Promise<void> {
    const current = await this.loadAll();
    current[key] = value;
    const dir = path.dirname(this.configPath);
    await fs.promises.mkdir(dir, { recursive: true });
    const content = encryptRecord(JSON.stringify(current));
    await fs.promises.writeFile(this.configPath, content, { encoding: 'utf-8', mode: 0o600 });
    logger.info('Runtime config key saved', { key });
  }

  /** Load all key-value pairs from disk. Returns {} if file doesn't exist. */
  async loadAll(): Promise<Record<string, string>> {
    try {
      const raw = await fs.promises.readFile(this.configPath, 'utf-8');
      const plaintext = decryptRecord(raw);
      return JSON.parse(plaintext) as Record<string, string>;
    } catch (err) {
      // OK: Explicit empty — config file may not exist on first run
      logger.debug('Runtime config not yet initialized (first run)', {
        path: this.configPath,
        reason: err instanceof Error ? err.message : String(err),
      });
      return {};
    }
  }

  /**
   * Apply all stored keys to process.env for the current process.
   * Only sets keys that are not already defined in the environment
   * (env var in claude-desktop-config.json always wins).
   *
   * Returns the list of keys that were applied.
   */
  async applyToEnv(): Promise<string[]> {
    const applied: string[] = [];
    try {
      const config = await this.loadAll();
      for (const [key, value] of Object.entries(config)) {
        if (value && !process.env[key]) {
          process.env[key] = value;
          applied.push(key);
        }
      }
      if (applied.length > 0) {
        logger.info('Runtime config applied from runtime config store', {
          keys: applied,
          count: applied.length,
          path: this.configPath,
        });
      }
    } catch (err) {
      // Silently skip — no runtime config file is a normal state
      logger.debug('No runtime config file found', {
        path: this.configPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return applied;
  }

  /** Delete a stored key. */
  async delete(key: string): Promise<void> {
    const current = await this.loadAll();
    if (key in current) {
      delete current[key];
      const dir = path.dirname(this.configPath);
      await fs.promises.mkdir(dir, { recursive: true });
      const content = encryptRecord(JSON.stringify(current));
      await fs.promises.writeFile(this.configPath, content, { encoding: 'utf-8', mode: 0o600 });
      logger.info('Runtime config key deleted', { key });
    }
  }

  /** List which keys are currently stored (values redacted). */
  async listKeys(): Promise<string[]> {
    const config = await this.loadAll();
    return Object.keys(config);
  }
}

// ---------------------------------------------------------------------------
// Singleton + auto-apply on module load
// ---------------------------------------------------------------------------

export const runtimeConfigStore = new RuntimeConfigStore(resolveRuntimeConfigPath());

// Apply persisted keys to process.env immediately when this module is imported.
// This ensures that by the time any handler reads process.env['ANTHROPIC_API_KEY'],
// REDIS_URL, or MCP_FEDERATION_SERVERS, the runtime-saved values are already present.
if (shouldAutoApplyRuntimeConfig()) {
  void runtimeConfigStore.applyToEnv();
}
