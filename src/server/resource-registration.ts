import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HandlerContext } from '../handlers/index.js';
import type { GoogleApiClient } from '../services/google-api.js';
import { logger as baseLogger } from '../utils/logger.js';
import { DEFER_SCHEMAS } from '../config/constants.js';
import { getEnv } from '../config/env.js';
import { TOOL_DEFINITIONS } from '../mcp/registration/tool-definitions.js';
import { registerServalSheetsResources } from '../mcp/registration/resource-registration.js';
import { registerServalSheetsPrompts } from '../mcp/registration/prompt-registration.js';
import {
  registerKnowledgeResources,
  registerDeferredKnowledgeResources,
  registerHistoryResources,
  registerCacheResources,
  registerTransactionResources,
  registerConflictResources,
  registerImpactResources,
  registerValidationResources,
  registerMetricsResources,
  registerConfirmResources,
  registerAnalyzeResources,
  registerReferenceResources,
  registerGuideResources,
  registerDecisionResources,
  registerExamplesResources,
  registerPatternResources,
  registerSheetResources,
  registerSchemaResources,
  registerDiscoveryResources,
  registerMasterIndexResource,
  registerKnowledgeIndexResource,
  registerKnowledgeSearchResource,
  initializeResourceNotifications,
  registerConnectionHealthResource,
  registerRestartHealthResource,
  registerCostDashboardResources,
  registerTimeTravelResources,
} from '../resources/index.js';
import { resourceNotifications } from '../resources/notifications.js';

export async function registerServerResources(params: {
  server: McpServer;
  googleClient: GoogleApiClient | null;
  context: HandlerContext | null;
}): Promise<void> {
  const { server, googleClient, context } = params;
  registerServalSheetsResources(server, googleClient);

  const useDeferred = process.env['DISABLE_KNOWLEDGE_RESOURCES'] === 'true' || DEFER_SCHEMAS;
  if (useDeferred) {
    registerDeferredKnowledgeResources(server);
  } else {
    await registerKnowledgeResources(server);
  }

  registerHistoryResources(server);
  registerTimeTravelResources(server);
  registerCacheResources(server);

  if (googleClient) {
    registerTransactionResources(server);
    registerConflictResources(server);
    registerImpactResources(server);
    registerValidationResources(server);
    registerMetricsResources(server);
    registerDiscoveryResources(server);
  }

  registerConfirmResources(server);
  registerAnalyzeResources(server);

  if (googleClient && context) {
    registerSheetResources(server, context);
  }

  registerReferenceResources(server);
  registerGuideResources(server);
  registerDecisionResources(server);
  registerExamplesResources(server);
  registerPatternResources(server);
  registerSchemaResources(server);
  registerCostDashboardResources(server);
  registerConnectionHealthResource(server);
  registerRestartHealthResource(server);
  registerMasterIndexResource(server);
  registerKnowledgeIndexResource(server);
  registerKnowledgeSearchResource(server);

  initializeResourceNotifications(server);

  if (getEnv().ENABLE_TOOLS_LIST_CHANGED_NOTIFICATIONS) {
    resourceNotifications.syncToolList(
      TOOL_DEFINITIONS.map((tool) => tool.name),
      {
        emitOnFirstSet: false,
        reason: 'resource initialization completed',
      }
    );
  }
}

export function ensureServerCompletionsRegistered(log = baseLogger): void {
  try {
    log.info('Completions capability registered (spreadsheetId + range autocompletion active)');
  } catch (error) {
    log.error('Failed to register completions', { error });
  }
}

export function registerServerPrompts(server: McpServer): void {
  registerServalSheetsPrompts(server);
}

export async function ensureServerResourcesRegistered(params: {
  resourcesRegistered: boolean;
  resourceRegistrationPromise: Promise<void> | null;
  resourceRegistrationFailed: boolean;
  registerResources: () => Promise<void>;
  setResourcesRegistered: (value: boolean) => void;
  setResourceRegistrationPromise: (value: Promise<void> | null) => void;
  setResourceRegistrationFailed: (value: boolean) => void;
  log?: typeof baseLogger;
}): Promise<void> {
  const {
    resourcesRegistered,
    resourceRegistrationPromise,
    resourceRegistrationFailed,
    registerResources,
    setResourcesRegistered,
    setResourceRegistrationPromise,
    setResourceRegistrationFailed,
    log = baseLogger,
  } = params;

  if (resourcesRegistered) {
    return;
  }

  // Poisoned: a previous attempt partially registered resources into the SDK's
  // internal maps before throwing. Retrying would cause "already registered" errors.
  // Resources will be unavailable this session; tools still function.
  if (resourceRegistrationFailed) {
    return;
  }

  if (resourceRegistrationPromise) {
    await resourceRegistrationPromise;
    return;
  }

  const nextPromise = (async () => {
    try {
      log.info('Lazy-loading resources on first access');
      await registerResources();
      setResourcesRegistered(true);
      log.info('Resources registered successfully');
    } catch (error) {
      log.error(
        'Failed to register resources — poisoning retry guard to prevent cascading "already registered" errors',
        { error }
      );
      setResourceRegistrationFailed(true);
      setResourceRegistrationPromise(null);
      throw error;
    }
  })();

  setResourceRegistrationPromise(nextPromise);
  await nextPromise;
  setResourceRegistrationPromise(null);
}
