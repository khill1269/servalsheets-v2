/**
 * ServalSheets v4 - Token Store Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EncryptedFileTokenStore } from '../../src/services/token-store.js';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

const tmpDir = path.join(process.cwd(), 'tests', '.tmp');
const tokenFile = path.join(tmpDir, 'tokens.enc');

describe('EncryptedFileTokenStore', () => {
  let key: string;

  beforeEach(async () => {
    key = randomBytes(32).toString('hex');
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.unlink(tokenFile);
    } catch {
      // Ignore missing file
    }
  });

  it('round-trips tokens', async () => {
    const store = new EncryptedFileTokenStore(tokenFile, key);
    const tokens = {
      access_token: 'access',
      refresh_token: 'refresh',
      expiry_date: 1704067200000 + 1000,
      scope: 'scope',
    };

    await store.save(tokens);
    const loaded = await store.load();

    expect(loaded).toEqual(tokens);
  });

  it('clears stored tokens', async () => {
    const store = new EncryptedFileTokenStore(tokenFile, key);
    await store.save({ access_token: 'access' });
    await store.clear();

    const loaded = await store.load();
    expect(loaded).toBeNull();
  });
});
