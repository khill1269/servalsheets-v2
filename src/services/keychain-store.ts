/**
 * KeychainTokenStore
 *
 * @purpose Secure token storage using OS-native keychain/credential manager
 * @category Infrastructure
 * @usage Use for production deployments where OS keychain is available; auto-falls back to encrypted file store
 * @dependencies keytar (optional), security CLI (macOS), node:child_process
 * @stateful Yes - stores tokens in OS keychain with service name 'servalsheets'
 *
 * Supported platforms:
 * - macOS: Keychain Access via `security` CLI
 * - Windows: Windows Credential Manager (requires keytar)
 * - Linux: libsecret / Secret Service (requires keytar)
 *
 * @example
 * const store = await KeychainTokenStore.create();
 * await store.save({ access_token: '...', refresh_token: '...' });
 * const tokens = await store.load();
 * await store.clear(); // Removes from keychain
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { TokenStore, StoredTokens } from './token-store.js';
import { createChildLogger } from '../utils/logger.js';
import { ValidationError, ServiceError, ConfigError } from '../core/errors.js';

const execFileAsync = promisify(execFile);
const log = createChildLogger({ service: 'keychain-store' });

const SERVICE_NAME = 'servalsheets';
const ACCOUNT_NAME = 'oauth-tokens';

/**
 * Validate keychain service/account names to prevent unexpected CLI behavior.
 * While execFile doesn't use a shell (safe from injection), the security CLI
 * may interpret certain characters in arguments.
 */
const SAFE_KEYCHAIN_NAME = /^[a-zA-Z0-9\-_.]+$/;

function validateKeychainName(name: string, field: string): void {
  if (!SAFE_KEYCHAIN_NAME.test(name)) {
    throw new ValidationError(
      `Invalid ${field}: must contain only alphanumeric characters, hyphens, underscores, and dots`,
      field
    );
  }
}

/**
 * Keytar interface for type safety (keytar is an optional dependency)
 */
interface KeytarInterface {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

/**
 * Check if keytar is available (optional dependency)
 */
async function tryLoadKeytar(): Promise<KeytarInterface | null> {
  try {
    // Dynamic import for optional dependency
    // Using string variable to prevent bundlers from trying to resolve it
    const moduleName = 'keytar';
    const keytar = (await import(moduleName)) as KeytarInterface;
    return keytar;
  } catch {
    return null;
  }
}

/**
 * macOS-specific keychain operations using security CLI
 */
class MacOSKeychain {
  private static async exec(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('/usr/bin/security', args);
      return stdout;
    } catch (error) {
      // Security CLI returns non-zero for "not found"
      if ((error as NodeJS.ErrnoException & { code: number }).code === 44) {
        return '';
      }
      throw error;
    }
  }

  static async get(service: string, account: string): Promise<string | null> {
    validateKeychainName(service, 'service');
    validateKeychainName(account, 'account');
    try {
      const result = await this.exec([
        'find-generic-password',
        '-s',
        service,
        '-a',
        account,
        '-w', // Output password only
      ]);
      return result.trim() || null;
    } catch {
      return null;
    }
  }

  static async set(service: string, account: string, password: string): Promise<void> {
    validateKeychainName(service, 'service');
    validateKeychainName(account, 'account');
    // Delete existing entry first (ignore errors)
    try {
      await this.exec(['delete-generic-password', '-s', service, '-a', account]);
    } catch {
      // Ignore - may not exist
    }

    // Add new entry
    await this.exec([
      'add-generic-password',
      '-s',
      service,
      '-a',
      account,
      '-w',
      password,
      '-U', // Update if exists
    ]);
  }

  static async delete(service: string, account: string): Promise<void> {
    validateKeychainName(service, 'service');
    validateKeychainName(account, 'account');
    try {
      await this.exec(['delete-generic-password', '-s', service, '-a', account]);
    } catch {
      // Ignore - may not exist
    }
  }
}

export class KeychainTokenStore implements TokenStore {
  private keytar: KeytarInterface | null = null;
  private platform: NodeJS.Platform;

  private constructor() {
    this.platform = process.platform;
  }

  /**
   * Create a KeychainTokenStore with platform detection
   */
  static async create(): Promise<KeychainTokenStore> {
    const store = new KeychainTokenStore();

    // Try to load keytar for Windows/Linux support
    if (store.platform !== 'darwin') {
      store.keytar = await tryLoadKeytar();
      if (!store.keytar) {
        log.warn(
          'keytar not available - keychain storage disabled on this platform. ' +
            'Install keytar for Windows/Linux keychain support: npm install keytar'
        );
      }
    }

    return store;
  }

  /**
   * Check if keychain storage is available on this platform
   */
  isAvailable(): boolean {
    if (this.platform === 'darwin') {
      return true; // macOS always has security CLI
    }
    return this.keytar !== null;
  }

  async load(): Promise<StoredTokens | null> {
    try {
      let data: string | null = null;

      if (this.platform === 'darwin') {
        data = await MacOSKeychain.get(SERVICE_NAME, ACCOUNT_NAME);
      } else if (this.keytar) {
        data = await this.keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      } else {
        log.debug('Keychain not available on this platform');
        return null;
      }

      if (!data) {
        return null;
      }

      return JSON.parse(data) as StoredTokens;
    } catch (error) {
      log.error('Failed to load tokens from keychain', { error });
      return null;
    }
  }

  async save(tokens: StoredTokens): Promise<void> {
    const data = JSON.stringify(tokens);

    try {
      if (this.platform === 'darwin') {
        await MacOSKeychain.set(SERVICE_NAME, ACCOUNT_NAME, data);
        log.info('Tokens saved to macOS Keychain');
      } else if (this.keytar) {
        await this.keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, data);
        log.info('Tokens saved to system credential store');
      } else {
        throw new ServiceError(
          'Keychain storage not available on this platform',
          'SERVICE_NOT_INITIALIZED',
          'KeychainTokenStore'
        );
      }
    } catch (error) {
      log.error('Failed to save tokens to keychain', { error });
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      if (this.platform === 'darwin') {
        await MacOSKeychain.delete(SERVICE_NAME, ACCOUNT_NAME);
        log.info('Tokens cleared from macOS Keychain');
      } else if (this.keytar) {
        await this.keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
        log.info('Tokens cleared from system credential store');
      }
    } catch (error) {
      log.error('Failed to clear tokens from keychain', { error });
      // Don't throw - clearing may fail if tokens don't exist
    }
  }
}

/**
 * Hybrid token store that uses keychain when available, falls back to encrypted file
 */
export class HybridTokenStore implements TokenStore {
  private keychainStore: KeychainTokenStore | null = null;
  private fileStore: TokenStore | null = null;

  private constructor(keychainStore: KeychainTokenStore | null, fileStore: TokenStore | null) {
    this.keychainStore = keychainStore;
    this.fileStore = fileStore;
  }

  /**
   * Create a HybridTokenStore that prefers keychain but falls back to file store
   */
  static async create(fileStorePath: string, encryptionKey: string): Promise<HybridTokenStore> {
    let keychainStore: KeychainTokenStore | null = null;
    let fileStore: TokenStore | null = null;

    // Try to initialize keychain store
    try {
      keychainStore = await KeychainTokenStore.create();
      if (!keychainStore.isAvailable()) {
        keychainStore = null;
      }
    } catch (error) {
      log.debug('Keychain store not available, using file store', { error });
    }

    // Always initialize file store as fallback
    if (encryptionKey && encryptionKey.length === 64) {
      const { EncryptedFileTokenStore } = await import('./token-store.js');
      fileStore = new EncryptedFileTokenStore(fileStorePath, encryptionKey);
    }

    if (!keychainStore && !fileStore) {
      throw new ConfigError(
        'No token storage available. Either enable keychain or provide ENCRYPTION_KEY.',
        'ENCRYPTION_KEY'
      );
    }

    return new HybridTokenStore(keychainStore, fileStore);
  }

  /**
   * Returns which storage backend is being used
   */
  getStorageType(): 'keychain' | 'file' | 'none' {
    if (this.keychainStore?.isAvailable()) return 'keychain';
    if (this.fileStore) return 'file';
    return 'none';
  }

  async load(): Promise<StoredTokens | null> {
    // Try keychain first
    if (this.keychainStore?.isAvailable()) {
      const tokens = await this.keychainStore.load();
      if (tokens) {
        log.debug('Loaded tokens from keychain');
        return tokens;
      }
    }

    // Fall back to file store
    if (this.fileStore) {
      const tokens = await this.fileStore.load();
      if (tokens) {
        log.debug('Loaded tokens from encrypted file');
        return tokens;
      }
    }

    return null;
  }

  async save(tokens: StoredTokens): Promise<void> {
    // Save to keychain if available
    if (this.keychainStore?.isAvailable()) {
      await this.keychainStore.save(tokens);
      log.debug('Saved tokens to keychain');
      return;
    }

    // Fall back to file store
    if (this.fileStore) {
      await this.fileStore.save(tokens);
      log.debug('Saved tokens to encrypted file');
      return;
    }

    throw new ServiceError(
      'No token storage available',
      'SERVICE_NOT_INITIALIZED',
      'HybridTokenStore'
    );
  }

  async clear(): Promise<void> {
    // Clear from both stores
    const errors: Error[] = [];

    if (this.keychainStore?.isAvailable()) {
      try {
        await this.keychainStore.clear();
      } catch (error) {
        errors.push(error as Error);
      }
    }

    if (this.fileStore) {
      try {
        await this.fileStore.clear();
      } catch (error) {
        errors.push(error as Error);
      }
    }

    if (errors.length > 0) {
      log.warn('Some token stores failed to clear', { errors: errors.map((e) => e.message) });
    }
  }

  /**
   * Migrate tokens from file store to keychain
   * Call this when upgrading from file-based to keychain storage
   */
  async migrateToKeychain(): Promise<boolean> {
    if (!this.keychainStore?.isAvailable()) {
      log.warn('Cannot migrate - keychain not available');
      return false;
    }

    if (!this.fileStore) {
      log.debug('No file store to migrate from');
      return false;
    }

    try {
      const tokens = await this.fileStore.load();
      if (!tokens) {
        log.debug('No tokens in file store to migrate');
        return false;
      }

      await this.keychainStore.save(tokens);
      await this.fileStore.clear();
      log.info('Successfully migrated tokens from file to keychain');
      return true;
    } catch (error) {
      log.error('Failed to migrate tokens to keychain', { error });
      return false;
    }
  }
}
