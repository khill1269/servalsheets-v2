/**
 * Pluggable Secrets Management
 *
 * Provides a pluggable interface for retrieving secrets from various backends:
 * - Environment variables (default)
 * - HashiCorp Vault
 * - AWS Secrets Manager (fully implemented with TTL cache)
 * - Multiple providers chained together (CompositeSecretsProvider)
 *
 * Usage:
 *   const provider = createSecretsProvider();
 *   const apiKey = await provider.getSecret('ANTHROPIC_API_KEY');
 *
 * Backends are selected via SECRETS_PROVIDER env var:
 *   - 'env' (default): read from process.env
 *   - 'vault': HashiCorp Vault
 *   - 'aws': AWS Secrets Manager
 *   - 'composite': chain multiple providers
 */

import { logger } from '../utils/logger.js';

/**
 * Pluggable interface for secrets providers
 */
export interface SecretsProvider {
  /**
   * Retrieve a secret by key
   * @param key Secret key/name (e.g., 'ANTHROPIC_API_KEY')
   * @returns The secret value, or undefined if not found
   */
  getSecret(key: string): Promise<string | undefined>;

  /**
   * Check if a secret exists
   * @param key Secret key/name
   * @returns true if the secret exists and is accessible
   */
  hasSecret(key: string): Promise<boolean>;
}

/**
 * EnvSecretsProvider: reads secrets from process.env
 * This is the default and simplest implementation.
 */
export class EnvSecretsProvider implements SecretsProvider {
  constructor(private env: NodeJS.ProcessEnv = process.env) {}

  async getSecret(key: string): Promise<string | undefined> {
    const value = this.env[key];
    return value !== undefined ? value : undefined;
  }

  async hasSecret(key: string): Promise<boolean> {
    return key in this.env;
  }
}

/**
 * VaultSecretsProvider: placeholder for HashiCorp Vault integration
 * TODO: Implement full Vault client logic
 */
export class VaultSecretsProvider implements SecretsProvider {
  private readonly vaultUrl: string;
  private readonly vaultToken: string;
  private readonly vaultNamespace: string | undefined;

  constructor(vaultUrl: string, vaultToken: string, vaultNamespace?: string) {
    this.vaultUrl = vaultUrl;
    this.vaultToken = vaultToken;
    this.vaultNamespace = vaultNamespace;
  }

  async getSecret(key: string): Promise<string | undefined> {
    logger.warn('VaultSecretsProvider.getSecret() not yet implemented', { key, vaultUrl: this.vaultUrl, namespace: this.vaultNamespace, hasToken: !!this.vaultToken });
    return undefined;
  }

  async hasSecret(key: string): Promise<boolean> {
    logger.warn('VaultSecretsProvider.hasSecret() not yet implemented', { key });
    return false;
  }
}

/**
 * Cache entry for AWS Secrets Manager
 */
interface SecretCacheEntry {
  value: Record<string, string>;
  expiresAt: number;
}

/**
 * AwsSecretsManagerProvider: fully implemented AWS Secrets Manager integration
 *
 * Features:
 * - Reads secrets by prefix (e.g., 'servalsheets/bedrock-config')
 * - Parses JSON secret values into key-value pairs
 * - TTL-based caching to minimize API calls (default: 5 minutes)
 * - Automatic cache invalidation on expiry
 * - Graceful degradation if @aws-sdk/client-secrets-manager not installed
 *
 * Secret format: Secrets are stored as JSON objects in AWS Secrets Manager.
 * When getSecret('KEY') is called, the provider:
 * 1. Fetches all secrets matching the configured prefix
 * 2. Parses each secret's JSON value
 * 3. Looks up the requested key across all parsed secrets
 *
 * Example:
 *   Secret 'servalsheets/bedrock-config' contains:
 *     { "BEDROCK_GUARDRAIL_ID": "rur8hed14y0b", "LLM_MODEL": "us.anthropic.claude-sonnet-4-6" }
 *   provider.getSecret('BEDROCK_GUARDRAIL_ID') → 'rur8hed14y0b'
 */
export class AwsSecretsManagerProvider implements SecretsProvider {
  private readonly region: string;
  private readonly secretPrefix: string;
  private readonly cacheTtlMs: number;
  private cache: Map<string, SecretCacheEntry> = new Map();
  private client: unknown | null = null;
  private clientInitialized = false;

  constructor(
    region: string,
    secretPrefix: string = 'servalsheets/',
    cacheTtlMs: number = 5 * 60 * 1000 // 5 minutes
  ) {
    this.region = region;
    this.secretPrefix = secretPrefix;
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Lazily initialize the AWS SDK client
   * Uses dynamic import to handle optional dependency gracefully
   */
  private async getClient(): Promise<{
    send: (command: unknown) => Promise<unknown>;
  } | null> {
    if (this.clientInitialized) {
      return this.client as { send: (command: unknown) => Promise<unknown> } | null;
    }

    try {
      // @ts-ignore - optional dependency
      const { SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager');
      this.client = new SecretsManagerClient({ region: this.region });
      this.clientInitialized = true;
      logger.info('AWS Secrets Manager client initialized', { region: this.region });
      return this.client as { send: (command: unknown) => Promise<unknown> };
    } catch {
      logger.warn('AWS Secrets Manager SDK not available — install @aws-sdk/client-secrets-manager', {
        region: this.region,
      });
      this.clientInitialized = true;
      this.client = null;
      return null;
    }
  }

  /**
   * Fetch a single secret from AWS Secrets Manager
   */
  private async fetchSecret(secretName: string): Promise<Record<string, string> | null> {
    // Check cache first
    const cached = this.cache.get(secretName);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const client = await this.getClient();
    if (!client) return null;

    try {
      // @ts-ignore - optional dependency
      const { GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
      const command = new GetSecretValueCommand({ SecretId: secretName });
      const response = (await client.send(command)) as { SecretString?: string };

      if (!response.SecretString) {
        logger.debug('Secret has no string value (may be binary)', { secretName });
        return null;
      }

      // Parse the secret value — supports both JSON objects and simple key:value format
      let parsed: Record<string, string>;
      try {
        // Try standard JSON first
        parsed = JSON.parse(response.SecretString) as Record<string, string>;
      } catch {
        // Fall back to simple key:value format (e.g., {KEY:value,KEY2:value2})
        parsed = {};
        const cleaned = response.SecretString.replace(/^\{|\}$/g, '');
        for (const pair of cleaned.split(',')) {
          const colonIdx = pair.indexOf(':');
          if (colonIdx > 0) {
            const key = pair.substring(0, colonIdx).trim();
            const value = pair.substring(colonIdx + 1).trim();
            parsed[key] = value;
          }
        }
      }

      // Cache the parsed result
      this.cache.set(secretName, {
        value: parsed,
        expiresAt: Date.now() + this.cacheTtlMs,
      });

      logger.debug('Fetched and cached secret', {
        secretName,
        keyCount: Object.keys(parsed).length,
        cacheTtlMs: this.cacheTtlMs,
      });

      return parsed;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to fetch secret from AWS Secrets Manager', {
        secretName,
        error: errMsg,
      });
      return null;
    }
  }

  /**
   * List all secrets matching the configured prefix and search for the key
   */
  private async findSecretKey(key: string): Promise<string | undefined> {
    const client = await this.getClient();
    if (!client) return undefined;

    try {
      // @ts-ignore - optional dependency
      const { ListSecretsCommand } = await import('@aws-sdk/client-secrets-manager');
      const command = new ListSecretsCommand({
        Filters: [{ Key: 'name', Values: [this.secretPrefix] }],
      });
      const response = (await client.send(command)) as {
        SecretList?: Array<{ Name?: string }>;
      };

      const secretNames = (response.SecretList || [])
        .map((s) => s.Name)
        .filter((name): name is string => !!name);

      // Search each secret for the requested key
      for (const secretName of secretNames) {
        const parsed = await this.fetchSecret(secretName);
        if (parsed && key in parsed) {
          return parsed[key];
        }
      }

      return undefined;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to list secrets from AWS Secrets Manager', {
        prefix: this.secretPrefix,
        error: errMsg,
      });
      return undefined;
    }
  }

  async getSecret(key: string): Promise<string | undefined> {
    // First check if the key directly matches a secret name
    const directResult = await this.fetchSecret(`${this.secretPrefix}${key}`);
    if (directResult) {
      // If it's a single-value secret, return the first value
      const values = Object.values(directResult);
      if (values.length === 1) return values[0];
    }

    // Search across all prefixed secrets for the key
    return this.findSecretKey(key);
  }

  async hasSecret(key: string): Promise<boolean> {
    const value = await this.getSecret(key);
    return value !== undefined;
  }

  /**
   * Invalidate the cache for a specific secret or all secrets
   */
  invalidateCache(secretName?: string): void {
    if (secretName) {
      this.cache.delete(secretName);
    } else {
      this.cache.clear();
    }
  }
}

/**
 * CompositeSecretsProvider: chains multiple providers together
 * Tries each provider in order until one returns a value (short-circuit behavior).
 */
export class CompositeSecretsProvider implements SecretsProvider {
  constructor(private providers: SecretsProvider[]) {
    if (providers.length === 0) {
      throw new Error('CompositeSecretsProvider requires at least one provider');
    }
  }

  async getSecret(key: string): Promise<string | undefined> {
    for (const provider of this.providers) {
      const secret = await provider.getSecret(key);
      if (secret !== undefined) {
        return secret;
      }
    }
    return undefined;
  }

  async hasSecret(key: string): Promise<boolean> {
    for (const provider of this.providers) {
      const has = await provider.hasSecret(key);
      if (has) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Factory function to create the appropriate SecretsProvider based on env config
 */
export function createSecretsProvider(): SecretsProvider {
  const providerType = process.env['SECRETS_PROVIDER'] || 'env';

  switch (providerType) {
    case 'env':
      logger.info('Using EnvSecretsProvider for secrets management');
      return new EnvSecretsProvider();

    case 'vault': {
      const vaultUrl = process.env['VAULT_URL'];
      const vaultToken = process.env['VAULT_TOKEN'];
      const vaultNamespace = process.env['VAULT_NAMESPACE'];

      if (!vaultUrl || !vaultToken) {
        throw new Error(
          'VaultSecretsProvider requires VAULT_URL and VAULT_TOKEN environment variables'
        );
      }

      logger.info('Using VaultSecretsProvider for secrets management', {
        vaultUrl,
        namespace: vaultNamespace || 'default',
      });
      return new VaultSecretsProvider(vaultUrl, vaultToken, vaultNamespace);
    }

    case 'aws': {
      const region = process.env['AWS_SECRETS_REGION'] || 'us-east-1';
      const prefix = process.env['AWS_SECRETS_PREFIX'] || 'servalsheets/';
      const cacheTtl = parseInt(process.env['AWS_SECRETS_CACHE_TTL_MS'] || '300000', 10);

      logger.info('Using AwsSecretsManagerProvider for secrets management', {
        region,
        prefix,
        cacheTtlMs: cacheTtl,
      });
      return new AwsSecretsManagerProvider(region, prefix, cacheTtl);
    }

    case 'composite': {
      const providers: SecretsProvider[] = [];

      // AWS first (highest priority in production)
      const awsRegion = process.env['AWS_SECRETS_REGION'];
      if (awsRegion) {
        const prefix = process.env['AWS_SECRETS_PREFIX'] || 'servalsheets/';
        logger.info('Adding AwsSecretsManagerProvider to composite chain');
        providers.push(new AwsSecretsManagerProvider(awsRegion, prefix));
      }

      // Vault second
      const vaultUrl = process.env['VAULT_URL'];
      const vaultToken = process.env['VAULT_TOKEN'];
      if (vaultUrl && vaultToken) {
        logger.info('Adding VaultSecretsProvider to composite chain');
        providers.push(
          new VaultSecretsProvider(
            vaultUrl,
            vaultToken,
            process.env['VAULT_NAMESPACE']
          )
        );
      }

      // Env last (fallback)
      providers.push(new EnvSecretsProvider());

      logger.info('Using CompositeSecretsProvider (chained)', {
        providerCount: providers.length,
      });
      return new CompositeSecretsProvider(providers);
    }

    default:
      throw new Error(
        `Unknown SECRETS_PROVIDER: ${providerType}. Valid options: env, vault, aws, composite`
      );
  }
}

/**
 * Singleton instance of the configured SecretsProvider
 */
let secretsProviderInstance: SecretsProvider | null = null;

/**
 * Get the global SecretsProvider instance (lazy-initialized on first call)
 */
export function getSecretsProvider(): SecretsProvider {
  if (secretsProviderInstance === null) {
    secretsProviderInstance = createSecretsProvider();
  }
  return secretsProviderInstance;
}

/**
 * Reset the global instance (useful for testing)
 */
export function resetSecretsProvider(): void {
  secretsProviderInstance = null;
}
