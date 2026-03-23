/**
 * AES-256-GCM encryption for agent plan files.
 *
 * Protects plan files written to PLAN_STORAGE_DIR (.serval/plans/) which may
 * contain spreadsheet IDs, cell values, and user data.
 *
 * Format: enc:{iv_hex}:{tag_hex}:{ciphertext_hex}
 * If PLAN_ENCRYPTION_KEY is not set, functions are no-ops (backward compatible).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { getEnv } from '../config/env.js';
import { logger } from './logger.js';
import { ConfigError, DataError } from '../core/errors.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function getKey(): Buffer | null {
  const keyHex = getEnv().PLAN_ENCRYPTION_KEY;
  if (!keyHex) return null;
  if (keyHex.length !== 64) {
    logger.warn('PLAN_ENCRYPTION_KEY must be 64 hex chars (32 bytes); encryption skipped');
    return null;
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt a plan JSON string using AES-256-GCM.
 * Returns the original plaintext if PLAN_ENCRYPTION_KEY is not configured.
 */
export function encryptPlan(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a plan string produced by encryptPlan.
 * If the data does not start with "enc:", it is returned as-is (plaintext / legacy).
 * Throws if the data is encrypted but PLAN_ENCRYPTION_KEY is not configured.
 */
export function decryptPlan(data: string): string {
  if (!data.startsWith('enc:')) return data;

  const key = getKey();
  if (!key) {
    logger.warn('Plan file is encrypted but PLAN_ENCRYPTION_KEY is not set; cannot decrypt');
    throw new ConfigError(
      'Cannot decrypt plan: PLAN_ENCRYPTION_KEY not configured',
      'PLAN_ENCRYPTION_KEY'
    );
  }

  const parts = data.split(':');
  if (parts.length !== 4) throw new DataError('Malformed encrypted plan data');

  const iv = Buffer.from(parts[1]!, 'hex');
  const tag = Buffer.from(parts[2]!, 'hex');
  const ciphertext = Buffer.from(parts[3]!, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}
