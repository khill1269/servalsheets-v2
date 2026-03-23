/**
 * ServalSheets - Security Module Index
 *
 * Security features for production-grade operation:
 * - Incremental scope consent (SEP-835)
 * - Resource indicators (RFC 8707)
 * - Token validation
 */

export {
  ScopeCategory,
  OPERATION_SCOPES,
  IncrementalScopeRequiredError,
  ScopeValidator,
  createScopeValidator,
  requireScopes,
  isIncrementalScopeError,
} from './incremental-scope.js';

export {
  ResourceIndicatorValidator,
  resourceIndicatorMiddleware,
  optionalResourceIndicatorMiddleware,
  createResourceIndicatorValidator,
  type ResourceIndicatorConfig,
  type TokenValidationResult,
} from './resource-indicators.js';

export {
  WebhookSignatureManager,
  initWebhookSignatureManager,
  getWebhookSignatureManager,
  resetWebhookSignatureManager,
  generateWebhookSecret,
  signWebhookPayload,
  verifyWebhookSignature,
  type WebhookSignatureConfig,
} from './webhook-signature.js';

export {
  SamlProvider,
  createSamlProviderFromEnv,
  type SamlProviderConfig,
} from './saml-provider.js';
