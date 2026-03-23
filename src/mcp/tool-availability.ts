import { getEnv } from '../config/env.js';
import { isWebhookRedisConfigured } from '../services/webhook-manager.js';

export const WEBHOOK_REDIS_REQUIRED_ACTIONS = [
  'register',
  'unregister',
  'list',
  'get',
  'test',
  'get_stats',
] as const;

export const WEBHOOK_NON_REDIS_ACTIONS = [
  'watch_changes',
  'subscribe_workspace',
  'unsubscribe_workspace',
  'list_workspace_subscriptions',
] as const;

export const APPSSCRIPT_TRIGGER_COMPAT_ACTIONS = [
  'create_trigger',
  'list_triggers',
  'delete_trigger',
  'update_trigger',
] as const;

export const APPSSCRIPT_STANDARD_ACTIONS = [
  'create',
  'get',
  'get_content',
  'update_content',
  'create_version',
  'list_versions',
  'get_version',
  'deploy',
  'list_deployments',
  'get_deployment',
  'undeploy',
  'run',
  'list_processes',
  'get_metrics',
  'install_serval_function',
] as const;

export function isAppsScriptTriggerCompatibilityEnabled(): boolean {
  return getEnv().ENABLE_APPSSCRIPT_TRIGGER_COMPAT;
}

export function getToolAvailabilityMetadata(toolName: string): Record<string, unknown> | undefined {
  if (toolName === 'sheets_webhook' && !isWebhookRedisConfigured()) {
    return {
      status: 'partial',
      reason: 'Redis backend not configured in this server process',
      unavailableActions: [...WEBHOOK_REDIS_REQUIRED_ACTIONS],
      availableActions: [...WEBHOOK_NON_REDIS_ACTIONS],
    };
  }

  if (toolName === 'sheets_appsscript' && !isAppsScriptTriggerCompatibilityEnabled()) {
    return {
      status: 'partial',
      reason:
        'Apps Script trigger compatibility actions are disabled by default because external Apps Script REST clients cannot manage triggers.',
      unavailableActions: [...APPSSCRIPT_TRIGGER_COMPAT_ACTIONS],
      availableActions: [...APPSSCRIPT_STANDARD_ACTIONS],
    };
  }

  return undefined; // OK: Explicit full availability
}

export function filterAvailableActions(
  toolName: string,
  actions: readonly string[]
): readonly string[] {
  if (toolName === 'sheets_webhook' && !isWebhookRedisConfigured()) {
    return actions.filter((action) =>
      WEBHOOK_NON_REDIS_ACTIONS.includes(action as (typeof WEBHOOK_NON_REDIS_ACTIONS)[number])
    );
  }

  if (toolName === 'sheets_appsscript' && !isAppsScriptTriggerCompatibilityEnabled()) {
    return actions.filter(
      (action) =>
        !APPSSCRIPT_TRIGGER_COMPAT_ACTIONS.includes(
          action as (typeof APPSSCRIPT_TRIGGER_COMPAT_ACTIONS)[number]
        )
    );
  }

  return [...actions];
}
