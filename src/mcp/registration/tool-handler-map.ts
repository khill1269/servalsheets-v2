import { AuthHandler } from '../../handlers/auth.js';
import type { Handlers } from '../../handlers/index.js';
import {
  CompositeInputSchema,
  SheetsAdvancedInputSchema,
  SheetsAnalyzeInputSchema,
  SheetsAppsScriptInputSchema,
  SheetsAuthInputSchema,
  SheetsBigQueryInputSchema,
  SheetsCollaborateInputSchema,
  SheetsComputeInputSchema,
  SheetsConfirmInputSchema,
  SheetsConnectorsInputSchema,
  SheetsCoreInputSchema,
  SheetsDataInputSchema,
  SheetsDependenciesInputSchema,
  SheetsDimensionsInputSchema,
  SheetsFederationInputSchema,
  SheetsFixInputSchema,
  SheetsFormatInputSchema,
  SheetsHistoryInputSchema,
  SheetsQualityInputSchema,
  SheetsSessionInputSchema,
  SheetsTemplatesInputSchema,
  SheetsTransactionInputSchema,
  SheetsVisualizeInputSchema,
  SheetsWebhookInputSchema,
  SheetsAgentInputSchema,
} from '../../schemas/index.js';
import { createMetadataCache } from '../../services/metadata-cache.js';
import type { GoogleApiClient } from '../../services/google-api.js';
import { registerPipelineDispatch } from '../../services/pipeline-registry.js';
import { getEnv } from '../../config/env.js';
import { wrapToolMapWithIdempotency } from '../../middleware/idempotency-middleware.js';
import { getRequestContext } from '../../utils/request-context.js';
import {
  prepareSchemaForRegistrationCached,
  wrapInputSchemaForLegacyRequest,
} from './schema-helpers.js';
import { parseForHandler } from './tool-arg-normalization.js';

export type ToolHandlerMap = Record<string, (args: unknown, extra?: unknown) => Promise<unknown>>;

export const SheetsAuthInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsAuthInputSchema);
export const SheetsCoreInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsCoreInputSchema);
export const SheetsDataInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsDataInputSchema);
export const SheetsFormatInputSchemaLegacy =
  wrapInputSchemaForLegacyRequest(SheetsFormatInputSchema);
export const SheetsDimensionsInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsDimensionsInputSchema
);
export const SheetsVisualizeInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsVisualizeInputSchema
);
export const SheetsCollaborateInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsCollaborateInputSchema
);
export const SheetsAdvancedInputSchemaLegacy =
  wrapInputSchemaForLegacyRequest(SheetsAdvancedInputSchema);
export const SheetsTransactionInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsTransactionInputSchema
);
export const SheetsQualityInputSchemaLegacy =
  wrapInputSchemaForLegacyRequest(SheetsQualityInputSchema);
export const SheetsHistoryInputSchemaLegacy =
  wrapInputSchemaForLegacyRequest(SheetsHistoryInputSchema);
export const SheetsConfirmInputSchemaLegacy =
  wrapInputSchemaForLegacyRequest(SheetsConfirmInputSchema);
export const SheetsAnalyzeInputSchemaLegacy =
  wrapInputSchemaForLegacyRequest(SheetsAnalyzeInputSchema);
export const SheetsFixInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsFixInputSchema);
export const CompositeInputSchemaLegacy = wrapInputSchemaForLegacyRequest(CompositeInputSchema);
export const SheetsSessionInputSchemaLegacy =
  wrapInputSchemaForLegacyRequest(SheetsSessionInputSchema);
export const SheetsTemplatesInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsTemplatesInputSchema
);
export const SheetsBigQueryInputSchemaLegacy =
  wrapInputSchemaForLegacyRequest(SheetsBigQueryInputSchema);
export const SheetsAppsScriptInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsAppsScriptInputSchema
);
export const SheetsWebhookInputSchemaLegacy =
  wrapInputSchemaForLegacyRequest(SheetsWebhookInputSchema);
export const SheetsDependenciesInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsDependenciesInputSchema
);
export const SheetsFederationInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsFederationInputSchema
);
export const SheetsComputeInputSchemaLegacy =
  wrapInputSchemaForLegacyRequest(SheetsComputeInputSchema);
export const SheetsAgentInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsAgentInputSchema);
export const SheetsConnectorsInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsConnectorsInputSchema
);

function withRequestMetadataCache(
  fn: (args: unknown, extra?: unknown) => Promise<unknown>,
  googleClient?: GoogleApiClient | null
): (args: unknown, extra?: unknown) => Promise<unknown> {
  if (!googleClient?.sheets) {
    return fn;
  }

  return async (args: unknown, extra?: unknown) => {
    const requestContext = getRequestContext();
    if (requestContext?.metadataCache) {
      return fn(args, extra);
    }

    const metadataCache = createMetadataCache(googleClient.sheets);
    if (requestContext) {
      requestContext.metadataCache = metadataCache;
    }

    try {
      return await fn(args, extra);
    } finally {
      if (requestContext?.metadataCache === metadataCache) {
        delete requestContext.metadataCache;
      }
      metadataCache.clear();
    }
  };
}

export function createToolHandlerMap(
  handlers: Handlers,
  authHandler?: AuthHandler,
  googleClient?: GoogleApiClient | null
): ToolHandlerMap {
  const map: ToolHandlerMap = {
    sheets_core: (args) =>
      handlers.core.handle(
        parseForHandler<Parameters<Handlers['core']['handle']>[0]>(
          SheetsCoreInputSchemaLegacy,
          args,
          'SheetsCoreInput',
          'sheets_core'
        )
      ),
    sheets_data: (args) =>
      handlers.data.handle(
        parseForHandler<Parameters<Handlers['data']['handle']>[0]>(
          SheetsDataInputSchemaLegacy,
          args,
          'SheetsDataInput',
          'sheets_data'
        )
      ),
    sheets_format: (args) =>
      handlers.format.handle(
        parseForHandler<Parameters<Handlers['format']['handle']>[0]>(
          SheetsFormatInputSchemaLegacy,
          args,
          'SheetsFormatInput',
          'sheets_format'
        )
      ),
    sheets_dimensions: (args) =>
      handlers.dimensions.handle(
        parseForHandler<Parameters<Handlers['dimensions']['handle']>[0]>(
          SheetsDimensionsInputSchemaLegacy,
          args,
          'SheetsDimensionsInput',
          'sheets_dimensions'
        )
      ),
    sheets_visualize: (args) =>
      handlers.visualize.handle(
        parseForHandler<Parameters<Handlers['visualize']['handle']>[0]>(
          SheetsVisualizeInputSchemaLegacy,
          args,
          'SheetsVisualizeInput',
          'sheets_visualize'
        )
      ),
    sheets_collaborate: (args) =>
      handlers.collaborate.handle(
        parseForHandler<Parameters<Handlers['collaborate']['handle']>[0]>(
          SheetsCollaborateInputSchemaLegacy,
          args,
          'SheetsCollaborateInput',
          'sheets_collaborate'
        )
      ),
    sheets_advanced: (args) =>
      handlers.advanced.handle(
        parseForHandler<Parameters<Handlers['advanced']['handle']>[0]>(
          SheetsAdvancedInputSchemaLegacy,
          args,
          'SheetsAdvancedInput',
          'sheets_advanced'
        )
      ),
    sheets_transaction: (args) =>
      handlers.transaction.handle(
        parseForHandler<Parameters<Handlers['transaction']['handle']>[0]>(
          SheetsTransactionInputSchemaLegacy,
          args,
          'SheetsTransactionInput',
          'sheets_transaction'
        )
      ),
    sheets_quality: (args) =>
      handlers.quality.handle(
        parseForHandler<Parameters<Handlers['quality']['handle']>[0]>(
          SheetsQualityInputSchemaLegacy,
          args,
          'SheetsQualityInput',
          'sheets_quality'
        )
      ),
    sheets_history: (args) =>
      handlers.history.handle(
        parseForHandler<Parameters<Handlers['history']['handle']>[0]>(
          SheetsHistoryInputSchemaLegacy,
          args,
          'SheetsHistoryInput',
          'sheets_history'
        )
      ),
    sheets_confirm: (args) =>
      handlers.confirm.handle(
        parseForHandler<Parameters<Handlers['confirm']['handle']>[0]>(
          SheetsConfirmInputSchemaLegacy,
          args,
          'SheetsConfirmInput',
          'sheets_confirm'
        )
      ),
    sheets_analyze: (args) =>
      handlers.analyze.handle(
        parseForHandler<Parameters<Handlers['analyze']['handle']>[0]>(
          SheetsAnalyzeInputSchemaLegacy,
          args,
          'SheetsAnalyzeInput',
          'sheets_analyze'
        )
      ),
    sheets_fix: (args) =>
      handlers.fix.handle(
        parseForHandler<Parameters<Handlers['fix']['handle']>[0]>(
          SheetsFixInputSchemaLegacy,
          args,
          'SheetsFixInput',
          'sheets_fix'
        )
      ),
    sheets_composite: (args) =>
      handlers.composite.handle(
        parseForHandler<Parameters<Handlers['composite']['handle']>[0]>(
          CompositeInputSchemaLegacy,
          args,
          'CompositeInput',
          'sheets_composite'
        )
      ),
    sheets_session: (args) =>
      handlers.session.handle(
        parseForHandler<Parameters<Handlers['session']['handle']>[0]>(
          SheetsSessionInputSchemaLegacy,
          args,
          'SheetsSessionInput',
          'sheets_session'
        )
      ),
    sheets_templates: (args) =>
      handlers.templates.handle(
        parseForHandler<Parameters<Handlers['templates']['handle']>[0]>(
          SheetsTemplatesInputSchemaLegacy,
          args,
          'SheetsTemplatesInput',
          'sheets_templates'
        )
      ),
    sheets_bigquery: (args) =>
      handlers.bigquery.handle(
        parseForHandler<Parameters<Handlers['bigquery']['handle']>[0]>(
          SheetsBigQueryInputSchemaLegacy,
          args,
          'SheetsBigQueryInput',
          'sheets_bigquery'
        )
      ),
    sheets_appsscript: (args) =>
      handlers.appsscript.handle(
        parseForHandler<Parameters<Handlers['appsscript']['handle']>[0]>(
          SheetsAppsScriptInputSchemaLegacy,
          args,
          'SheetsAppsScriptInput',
          'sheets_appsscript'
        )
      ),
    sheets_webhook: (args) =>
      handlers.webhooks.handle(
        parseForHandler<Parameters<Handlers['webhooks']['handle']>[0]>(
          SheetsWebhookInputSchemaLegacy,
          args,
          'SheetsWebhookInput',
          'sheets_webhook'
        )
      ),
    sheets_dependencies: (args) =>
      handlers.dependencies.handle(
        parseForHandler<Parameters<Handlers['dependencies']['handle']>[0]>(
          SheetsDependenciesInputSchemaLegacy,
          args,
          'SheetsDependenciesInput',
          'sheets_dependencies'
        )
      ),
    sheets_federation: (args) =>
      handlers.federation.handle(
        parseForHandler<Parameters<Handlers['federation']['handle']>[0]>(
          SheetsFederationInputSchemaLegacy,
          args,
          'SheetsFederationInput',
          'sheets_federation'
        )
      ),
    sheets_compute: (args) =>
      handlers.compute.handle(
        parseForHandler<Parameters<Handlers['compute']['handle']>[0]>(
          SheetsComputeInputSchemaLegacy,
          args,
          'SheetsComputeInput',
          'sheets_compute'
        )
      ),
    sheets_agent: (args) =>
      handlers.agent.handle(
        parseForHandler<Parameters<Handlers['agent']['handle']>[0]>(
          SheetsAgentInputSchemaLegacy,
          args,
          'SheetsAgentInput',
          'sheets_agent'
        )
      ),
    sheets_connectors: (args) =>
      handlers.connectors.handle(
        parseForHandler<Parameters<Handlers['connectors']['handle']>[0]>(
          SheetsConnectorsInputSchemaLegacy,
          args,
          'SheetsConnectorsInput',
          'sheets_connectors'
        )
      ),
  };

  if (authHandler) {
    map['sheets_auth'] = (args) =>
      authHandler.handle(
        parseForHandler<Parameters<AuthHandler['handle']>[0]>(
          SheetsAuthInputSchemaLegacy,
          args,
          'SheetsAuthInput',
          'sheets_auth'
        )
      );
  }

  for (const [toolName, fn] of Object.entries(map)) {
    map[toolName] = withRequestMetadataCache(fn, googleClient);
  }

  const finalMap = getEnv().ENABLE_IDEMPOTENCY ? wrapToolMapWithIdempotency(map) : map;

  registerPipelineDispatch((tool: string, args: Record<string, unknown>) => {
    const fn = finalMap[tool];
    if (!fn) {
      return Promise.reject(new Error(`Unknown tool in pipeline: ${tool}`));
    }
    return fn(args) as Promise<unknown>;
  });

  return finalMap;
}

export { prepareSchemaForRegistrationCached, wrapInputSchemaForLegacyRequest };
