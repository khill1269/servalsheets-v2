/**
 * ServalSheets - Pre-Test Validator
 *
 * Validates environment, credentials, and quota before running tests.
 * Prevents test runs that would fail due to configuration issues.
 */

import { TEST_CONFIG } from '../setup/config.js';
import { getQuotaManager, type QuotaVerification } from '../setup/quota-manager.js';
import { getTestRateLimiter } from '../setup/test-rate-limiter.js';
import { shouldRunIntegrationTests, loadTestCredentials } from '../../helpers/credential-loader.js';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  summary: string;
}

/**
 * Validation error (blocks test run)
 */
export interface ValidationError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Validation warning (allows test run but may cause issues)
 */
export interface ValidationWarning {
  code: string;
  message: string;
  suggestion?: string;
}

/**
 * Pre-test validation options
 */
export interface PreTestValidationOptions {
  /** Required environment variables */
  requiredEnvVars?: string[];
  /** Minimum quota required for reads */
  minReadQuota?: number;
  /** Minimum quota required for writes */
  minWriteQuota?: number;
  /** Check credentials */
  checkCredentials?: boolean;
  /** Check quota */
  checkQuota?: boolean;
  /** Check rate limiter */
  checkRateLimiter?: boolean;
  /** Strict mode - warnings become errors */
  strict?: boolean;
}

const DEFAULT_OPTIONS: Required<PreTestValidationOptions> = {
  requiredEnvVars: ['TEST_REAL_API'],
  minReadQuota: 10,
  minWriteQuota: 5,
  checkCredentials: true,
  checkQuota: true,
  checkRateLimiter: true,
  strict: false,
};

/**
 * Pre-Test Validator class
 */
export class PreTestValidator {
  private options: Required<PreTestValidationOptions>;

  constructor(options: PreTestValidationOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Run all validations
   */
  async validate(): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check environment variables
    const envResult = this.validateEnvironment();
    errors.push(...envResult.errors);
    warnings.push(...envResult.warnings);

    // Check credentials
    if (this.options.checkCredentials) {
      const credResult = await this.validateCredentials();
      errors.push(...credResult.errors);
      warnings.push(...credResult.warnings);
    }

    // Check quota
    if (this.options.checkQuota) {
      const quotaResult = this.validateQuota();
      errors.push(...quotaResult.errors);
      warnings.push(...quotaResult.warnings);
    }

    // Check rate limiter
    if (this.options.checkRateLimiter) {
      const rateLimiterResult = this.validateRateLimiter();
      errors.push(...rateLimiterResult.errors);
      warnings.push(...rateLimiterResult.warnings);
    }

    // In strict mode, warnings become errors
    if (this.options.strict) {
      for (const warning of warnings) {
        errors.push({
          code: `STRICT_${warning.code}`,
          message: warning.message,
          details: { suggestion: warning.suggestion },
        });
      }
      warnings.length = 0;
    }

    const valid = errors.length === 0;
    const summary = this.generateSummary(errors, warnings);

    return { valid, errors, warnings, summary };
  }

  /**
   * Validate environment variables
   */
  private validateEnvironment(): { errors: ValidationError[]; warnings: ValidationWarning[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check if integration tests are enabled
    if (!shouldRunIntegrationTests()) {
      errors.push({
        code: 'ENV_INTEGRATION_DISABLED',
        message: 'Integration tests are not enabled. Set TEST_REAL_API=true to run live tests.',
      });
    }

    // Check required environment variables
    for (const envVar of this.options.requiredEnvVars) {
      if (!process.env[envVar]) {
        if (envVar === 'TEST_REAL_API') {
          // Already handled above
          continue;
        }
        errors.push({
          code: 'ENV_MISSING',
          message: `Required environment variable ${envVar} is not set.`,
          details: { envVar },
        });
      }
    }

    // Check optional but recommended environment variables
    const recommendedVars = ['GOOGLE_APPLICATION_CREDENTIALS'];
    for (const envVar of recommendedVars) {
      if (!process.env[envVar]) {
        warnings.push({
          code: 'ENV_RECOMMENDED_MISSING',
          message: `Recommended environment variable ${envVar} is not set.`,
          suggestion: `Set ${envVar} for better test reliability.`,
        });
      }
    }

    return { errors, warnings };
  }

  /**
   * Validate credentials
   */
  private async validateCredentials(): Promise<{
    errors: ValidationError[];
    warnings: ValidationWarning[];
  }> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    try {
      const credentials = await loadTestCredentials();

      if (!credentials) {
        errors.push({
          code: 'CRED_NOT_FOUND',
          message:
            'Could not load test credentials. Check GOOGLE_APPLICATION_CREDENTIALS or OAuth configuration.',
        });
        return { errors, warnings };
      }

      // Check for service account vs OAuth
      if (!credentials.serviceAccount && !credentials.oauth) {
        errors.push({
          code: 'CRED_INVALID',
          message:
            'No valid authentication method found. Provide either service account or OAuth credentials.',
        });
      }

      // Check for test spreadsheet (warning only — tests create their own spreadsheets)
      if (!credentials.testSpreadsheet?.id) {
        warnings.push({
          code: 'CRED_NO_SPREADSHEET',
          message: 'No pre-existing test spreadsheet ID configured.',
          suggestion:
            'Set TEST_SPREADSHEET_ID if you want to use a persistent test spreadsheet. Tests create their own spreadsheets when this is not set.',
        });
      }

      // Warn about OAuth token expiry
      if (credentials.oauth?.tokens) {
        const expiry = credentials.oauth.tokens.expiry_date;
        if (expiry && expiry < Date.now()) {
          warnings.push({
            code: 'CRED_TOKEN_EXPIRED',
            message: 'OAuth token has expired.',
            suggestion: 'Re-authenticate to get fresh tokens.',
          });
        } else if (expiry && expiry < Date.now() + 3600000) {
          warnings.push({
            code: 'CRED_TOKEN_EXPIRING',
            message: 'OAuth token will expire within 1 hour.',
            suggestion: 'Consider refreshing tokens before running tests.',
          });
        }
      }
    } catch (error) {
      errors.push({
        code: 'CRED_LOAD_ERROR',
        message: `Error loading credentials: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    return { errors, warnings };
  }

  /**
   * Validate quota availability
   */
  private validateQuota(): { errors: ValidationError[]; warnings: ValidationWarning[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    const quota = getQuotaManager();
    const state = quota.getState();
    const verification = quota.verifyQuota({
      reads: this.options.minReadQuota,
      writes: this.options.minWriteQuota,
    });

    if (!verification.hasQuota) {
      if (verification.recommendedDelayMs > TEST_CONFIG.quota.maxQuotaDelayMs) {
        errors.push({
          code: 'QUOTA_EXHAUSTED',
          message: `Insufficient quota. Available: ${verification.availableReads} reads, ${verification.availableWrites} writes. Required: ${this.options.minReadQuota} reads, ${this.options.minWriteQuota} writes.`,
          details: {
            available: { reads: verification.availableReads, writes: verification.availableWrites },
            required: { reads: this.options.minReadQuota, writes: this.options.minWriteQuota },
            recommendedDelayMs: verification.recommendedDelayMs,
          },
        });
      } else {
        warnings.push({
          code: 'QUOTA_LOW',
          message: verification.warning ?? 'Quota is running low.',
          suggestion: `Wait ${Math.ceil(verification.recommendedDelayMs / 1000)}s for quota recovery.`,
        });
      }
    }

    // Warn if throttled
    if (state.isThrottled) {
      warnings.push({
        code: 'QUOTA_THROTTLED',
        message: 'Rate limiter is in throttled mode due to previous rate limit errors.',
        suggestion: 'Wait for throttle to expire or reset the rate limiter.',
      });
    }

    // Warn if high usage
    if (state.readPercentageUsed > 70 || state.writePercentageUsed > 70) {
      warnings.push({
        code: 'QUOTA_HIGH_USAGE',
        message: `Quota usage is high: ${state.readPercentageUsed.toFixed(0)}% reads, ${state.writePercentageUsed.toFixed(0)}% writes.`,
        suggestion: 'Consider adding delays between tests to avoid rate limiting.',
      });
    }

    return { errors, warnings };
  }

  /**
   * Validate rate limiter state
   */
  private validateRateLimiter(): { errors: ValidationError[]; warnings: ValidationWarning[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    const rateLimiter = getTestRateLimiter();
    const status = rateLimiter.getStatus();

    if (status.isThrottled) {
      warnings.push({
        code: 'RATE_LIMITER_THROTTLED',
        message: 'Rate limiter is in throttled mode.',
        suggestion: 'Consider resetting the rate limiter or waiting for throttle to expire.',
      });
    }

    if (status.availableReads < this.options.minReadQuota) {
      warnings.push({
        code: 'RATE_LIMITER_LOW_READS',
        message: `Low read tokens available: ${status.availableReads.toFixed(0)}`,
        suggestion: 'Wait for token bucket to refill.',
      });
    }

    if (status.availableWrites < this.options.minWriteQuota) {
      warnings.push({
        code: 'RATE_LIMITER_LOW_WRITES',
        message: `Low write tokens available: ${status.availableWrites.toFixed(0)}`,
        suggestion: 'Wait for token bucket to refill.',
      });
    }

    return { errors, warnings };
  }

  /**
   * Generate summary message
   */
  private generateSummary(errors: ValidationError[], warnings: ValidationWarning[]): string {
    const parts: string[] = [];

    if (errors.length === 0 && warnings.length === 0) {
      return 'All pre-test validations passed.';
    }

    if (errors.length > 0) {
      parts.push(`${errors.length} error(s) found:`);
      for (const error of errors) {
        parts.push(`  - [${error.code}] ${error.message}`);
      }
    }

    if (warnings.length > 0) {
      parts.push(`${warnings.length} warning(s):`);
      for (const warning of warnings) {
        parts.push(`  - [${warning.code}] ${warning.message}`);
      }
    }

    return parts.join('\n');
  }
}

/**
 * Singleton instance
 */
let _instance: PreTestValidator | null = null;

/**
 * Get the singleton pre-test validator
 */
export function getPreTestValidator(options?: PreTestValidationOptions): PreTestValidator {
  if (!_instance || options) {
    _instance = new PreTestValidator(options);
  }
  return _instance;
}

/**
 * Reset the singleton
 */
export function resetPreTestValidator(): void {
  _instance = null;
}

/**
 * Convenience function to run validation
 */
export async function validatePreTestConditions(
  options?: PreTestValidationOptions
): Promise<ValidationResult> {
  return getPreTestValidator(options).validate();
}

/**
 * Convenience function to assert valid pre-test conditions
 * Throws if validation fails
 */
export async function assertPreTestConditions(options?: PreTestValidationOptions): Promise<void> {
  const result = await validatePreTestConditions(options);
  if (!result.valid) {
    throw new Error(`Pre-test validation failed:\n${result.summary}`);
  }
}

/**
 * Vitest-compatible skip condition
 * Use with describe.skipIf()
 */
export async function shouldSkipTests(options?: PreTestValidationOptions): Promise<boolean> {
  try {
    const result = await validatePreTestConditions(options);
    return !result.valid;
  } catch {
    return true;
  }
}
