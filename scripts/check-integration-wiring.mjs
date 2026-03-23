#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function ensureIncludes(source, pattern, message, issues) {
  if (!source.includes(pattern)) {
    issues.push(message);
  }
}

function ensureExists(path, message, issues) {
  if (!existsSync(path)) {
    issues.push(message);
  }
}

function extractStringSet(source, exportName) {
  const pattern = new RegExp(
    `export const ${exportName} = new Set(?:<[^>]+>)?\\(\\[([\\s\\S]*?)\\]\\);`,
    'm'
  );
  const match = source.match(pattern);
  if (!match?.[1]) {
    return null;
  }

  const values = [];
  const valuePattern = /'([^']+)'|"([^"]+)"/g;
  for (const entry of match[1].matchAll(valuePattern)) {
    values.push(entry[1] ?? entry[2]);
  }
  return values;
}

function hasDependency(packageJson, dependencyName) {
  return Boolean(
    packageJson.dependencies?.[dependencyName] ??
      packageJson.devDependencies?.[dependencyName] ??
      packageJson.optionalDependencies?.[dependencyName] ??
      packageJson.peerDependencies?.[dependencyName]
  );
}

const issues = [];

const httpServer = read('src/http-server.ts');
const httpServerGraphql = read('src/http-server/graphql-admin.ts');
const serverMain = read('src/server.ts');
const envConfig = read('src/config/env.ts');
const graphqlResolvers = read('src/graphql/resolvers.ts');
const formulaEvaluator = read('src/services/formula-evaluator.ts');
const googleFormulaService = read('src/services/google-formula-service.ts');
const dependenciesHandler = read('src/handlers/dependencies.ts');
const toolHandlers = read('src/mcp/registration/tool-handlers.ts');
const auditMiddleware = read('src/middleware/audit-middleware.ts');
const writeLockMiddleware = read('src/middleware/write-lock-middleware.ts');
const webhookSecurityDoc = read('docs/security/WEBHOOK_SECURITY.md');
const packageJson = JSON.parse(read('package.json'));

// RBAC correctness: middleware must not run without manager initialization.
ensureIncludes(
  httpServer,
  'initializeRbacManager(',
  'RBAC manager is not explicitly initialized in src/http-server.ts.',
  issues
);

// Metrics server wiring: documented flags must be wired through env + runtime startup.
ensureIncludes(
  envConfig,
  'ENABLE_METRICS_SERVER',
  'ENABLE_METRICS_SERVER missing in src/config/env.ts.',
  issues
);
ensureIncludes(
  envConfig,
  'METRICS_PORT',
  'METRICS_PORT missing in src/config/env.ts.',
  issues
);
ensureIncludes(
  envConfig,
  'METRICS_HOST',
  'METRICS_HOST missing in src/config/env.ts.',
  issues
);
ensureIncludes(
  envConfig,
  'ENABLE_BILLING_INTEGRATION',
  'ENABLE_BILLING_INTEGRATION missing in src/config/env.ts.',
  issues
);
ensureIncludes(
  envConfig,
  'STRIPE_SECRET_KEY',
  'STRIPE_SECRET_KEY missing in src/config/env.ts.',
  issues
);
ensureIncludes(
  httpServer,
  'startMetricsServer(',
  'Dedicated metrics server is not started from src/http-server.ts.',
  issues
);
ensureIncludes(
  httpServer,
  'stopMetricsServer(',
  'Dedicated metrics server shutdown is not wired in src/http-server.ts.',
  issues
);

// Dependency wiring guardrail: do not remove strategic runtime dependencies before decision.
if (!hasDependency(packageJson, 'graphql')) {
  issues.push('graphql dependency is missing from package.json.');
}
if (!hasDependency(packageJson, 'hyperformula')) {
  issues.push('hyperformula dependency is missing from package.json.');
}

ensureIncludes(
  httpServerGraphql,
  'addGraphQLEndpoint(',
  'GraphQL endpoint is not wired from src/http-server/graphql-admin.ts.',
  issues
);
ensureIncludes(
  graphqlResolvers,
  "from 'graphql'",
  'graphql package import not found in src/graphql/resolvers.ts.',
  issues
);
ensureIncludes(
  formulaEvaluator,
  "import('hyperformula')",
  'HyperFormula dynamic import missing from src/services/formula-evaluator.ts.',
  issues
);
ensureIncludes(
  dependenciesHandler,
  "from '../services/formula-evaluator.js'",
  'Formula evaluator is not wired into src/handlers/dependencies.ts.',
  issues
);
ensureIncludes(
  serverMain,
  'initializeBillingIntegration(',
  'Billing integration is not wired from src/server.ts.',
  issues
);
ensureIncludes(
  httpServer,
  'initializeBillingIntegration(',
  'Billing integration is not wired from src/http-server.ts.',
  issues
);
ensureIncludes(
  toolHandlers,
  'ENABLE_BILLING_INTEGRATION',
  'Cost tracking in tool handlers is not aware of billing integration mode.',
  issues
);
ensureIncludes(
  toolHandlers,
  'invalidateSamplingContext(',
  'Sampling context cache invalidation is not wired from src/mcp/registration/tool-handlers.ts.',
  issues
);
ensureIncludes(
  toolHandlers,
  'getCacheInvalidationGraph().getInvalidationKeys(',
  'Sampling context invalidation is not using cache-invalidation graph signals.',
  issues
);

// Public docs/contracts: if docs reference package subpaths, they must exist in exports.
if (webhookSecurityDoc.includes('servalsheets/utils/webhook-verification')) {
  if (!packageJson.exports || !packageJson.exports['./utils/webhook-verification']) {
    issues.push(
      'Docs reference servalsheets/utils/webhook-verification, but package exports are missing ./utils/webhook-verification.'
    );
  }
}

if (webhookSecurityDoc.includes('servalsheets/security/webhook-signature')) {
  if (!packageJson.exports || !packageJson.exports['./security/webhook-signature']) {
    issues.push(
      'Docs reference servalsheets/security/webhook-signature, but package exports are missing ./security/webhook-signature.'
    );
  }
}

// Strategic integration debt markers: keep these modules until an explicit wire-or-delete decision.
ensureExists(
  'src/services/google-formula-service.ts',
  'src/services/google-formula-service.ts is missing; this is a documented Layer-3 architecture component.',
  issues
);
if (googleFormulaService.includes('deploymentId')) {
  issues.push(
    'src/services/google-formula-service.ts still references deploymentId; expected scriptId contract for Apps Script run API.'
  );
}
ensureExists(
  'src/config/action-field-masks.ts',
  'src/config/action-field-masks.ts is missing; delete only after an explicit optimization decision.',
  issues
);
ensureExists(
  'src/utils/webhook-verification.ts',
  'src/utils/webhook-verification.ts is missing; this is a documented webhook security helper.',
  issues
);

// ISSUE-231 / Class-2 regression guard: MUTATION_ACTIONS must use current canonical action names.
// These are the names that WERE stale and caused audit events to never fire.
// If any of these checks fail after a rename, you need to update audit-middleware.ts too.
const EXPECTED_MUTATION_ACTIONS = ['write', 'append', 'clear', 'bulk_update', 'find_replace'];
for (const actionName of EXPECTED_MUTATION_ACTIONS) {
  if (!auditMiddleware.includes(`'${actionName}'`) && !auditMiddleware.includes(`"${actionName}"`)) {
    issues.push(
      `MUTATION_ACTIONS in audit-middleware.ts is missing expected action '${actionName}'. ` +
        'Action may have been renamed without updating the middleware. See ISSUE-231.'
    );
  }
}

const auditMutationActions = extractStringSet(auditMiddleware, 'MUTATION_ACTIONS');
const writeLockMutationActions = extractStringSet(writeLockMiddleware, 'MUTATION_ACTIONS');
if (!auditMutationActions || !writeLockMutationActions) {
  issues.push('Unable to parse MUTATION_ACTIONS from audit or write-lock middleware.');
} else {
  const auditOnly = auditMutationActions.filter((action) => !writeLockMutationActions.includes(action));
  const writeLockOnly = writeLockMutationActions.filter((action) => !auditMutationActions.includes(action));

  if (auditOnly.length > 0 || writeLockOnly.length > 0) {
    issues.push(
      'MUTATION_ACTIONS drift between audit-middleware.ts and write-lock-middleware.ts. ' +
        `Audit-only: ${auditOnly.join(', ') || 'none'}; ` +
        `write-lock-only: ${writeLockOnly.join(', ') || 'none'}.`
    );
  }
}

// ISSUE-223 regression guard: embedded-oauth.ts must not contain a real-looking credential.
// The placeholder sentinel must be in place. Real secrets must never be committed.
const embeddedOAuth = read('src/config/embedded-oauth.ts');
if (!embeddedOAuth.includes('REPLACE_WITH_')) {
  issues.push(
    'src/config/embedded-oauth.ts no longer contains the expected REPLACE_WITH_ placeholder sentinel. ' +
      'Ensure no real OAuth credentials are committed. See ISSUE-223.'
  );
}

if (issues.length > 0) {
  console.error('Integration wiring check failed:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log('Integration wiring check passed.');
