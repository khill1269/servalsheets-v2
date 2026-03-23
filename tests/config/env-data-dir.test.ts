import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvForTest, validateEnv } from '../../src/config/env.js';

const originalEnv = { ...process.env };

describe('env DATA_DIR durability policy', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvForTest();
  });

  it('allows the default temporary DATA_DIR outside production', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'development',
    };

    const env = validateEnv();
    expect(env.DATA_DIR).toBe('/tmp/servalsheets');
  });

  it('rejects temporary DATA_DIR in production', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      DATA_DIR: '/tmp/servalsheets',
    };

    expect(() => validateEnv()).toThrow(/DATA_DIR must point to persistent storage in production/i);
  });

  it('rejects temporary profile storage in production', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      DATA_DIR: '/var/lib/servalsheets',
    };

    expect(() => validateEnv()).toThrow(
      /PROFILE_STORAGE_DIR must point to persistent storage in production/i
    );
  });

  it('rejects temporary checkpoint storage when checkpoints are enabled in production', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      DATA_DIR: '/var/lib/servalsheets',
      PROFILE_STORAGE_DIR: '/var/lib/servalsheets-profiles',
      ENABLE_CHECKPOINTS: 'true',
      CHECKPOINT_DIR: '/tmp/servalsheets-checkpoints',
    };

    expect(() => validateEnv()).toThrow(
      /CHECKPOINT_DIR must point to persistent storage when checkpoints are enabled in production/i
    );
  });

  it('accepts a persistent DATA_DIR in production', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      DATA_DIR: '/var/lib/servalsheets',
      PROFILE_STORAGE_DIR: '/var/lib/servalsheets-profiles',
    };

    expect(validateEnv().DATA_DIR).toBe('/var/lib/servalsheets');
  });
});
