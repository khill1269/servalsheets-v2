/**
 * ServalSheets - Handler Index
 *
 * Lazy-loading handler factory for faster initialization.
 *
 * Architectural Notes (MCP 2025-11-25):
 * - Claude (LLM) does planning and orchestration
 * - sheets_confirm uses Elicitation (SEP-1036) for user confirmation
 * - sheets_analyze uses Sampling (SEP-1577) for AI analysis
 * - Removed: planning, insights (anti-patterns that duplicated LLM capabilities)
 */

// Re-export base types
export * from './base.js';

// Re-export handler types for backwards compatibility
export type { SheetsDataHandler } from './data.js';
export type { FormatHandler } from './format.js';
export type { DimensionsHandler } from './dimensions.js';
export type { AdvancedHandler } from './advanced.js';
export type { TransactionHandler } from './transaction.js';
export type { QualityHandler } from './quality.js';
export type { HistoryHandler } from './history.js';
// MCP-native handlers (Elicitation & Sampling)
export type { ConfirmHandler } from './confirm.js';
export type { AnalyzeHandler } from './analyze.js';
export type { CompositeHandler } from './composite.js';
// Session context handler for NL excellence
export type { SessionHandler } from './session.js';
// Wave 1 consolidated handlers
export type { SheetsCoreHandler } from './core.js';
export type { VisualizeHandler } from './visualize.js';
export type { CollaborateHandler } from './collaborate.js';
// Tier 7 Enterprise handlers
export type { SheetsTemplatesHandler } from './templates.js';
export type { SheetsBigQueryHandler } from './bigquery.js';
export type { SheetsAppsScriptHandler } from './appsscript.js';
// Webhook handler
export type { WebhookHandler } from './webhooks.js';
// Dependencies handler
export type { DependenciesHandler } from './dependencies.js';
// Federation handler (Feature 3)
export type { FederationHandler } from './federation.js';
// Computation engine (Phase 5)
export type { ComputeHandler } from './compute.js';
// Agent loop (Phase 6)
export type { AgentHandler } from './agent.js';
// Live data connectors (Wave 6)
export type { ConnectorsHandler } from './connectors.js';

import type { sheets_v4, drive_v3 } from 'googleapis';
import type { bigquery_v2 } from 'googleapis';
import type { HandlerContext } from './base.js';
import { HandlerLoadError } from '../core/errors.js';

export interface HandlerFactoryOptions {
  context: HandlerContext;
  sheetsApi: sheets_v4.Sheets;
  driveApi: drive_v3.Drive;
  bigqueryApi?: bigquery_v2.Bigquery;
}

// Define handler types for TypeScript
export interface Handlers {
  data: import('./data.js').SheetsDataHandler;
  format: import('./format.js').FormatHandler;
  dimensions: import('./dimensions.js').DimensionsHandler;
  advanced: import('./advanced.js').AdvancedHandler;
  transaction: import('./transaction.js').TransactionHandler;
  quality: import('./quality.js').QualityHandler;
  history: import('./history.js').HistoryHandler;
  // MCP-native handlers (Elicitation & Sampling)
  confirm: import('./confirm.js').ConfirmHandler;
  analyze: import('./analyze.js').AnalyzeHandler;
  fix: import('./fix.js').FixHandler;
  // Composite operations handler
  composite: import('./composite.js').CompositeHandler;
  // Session context handler for NL excellence
  session: import('./session.js').SessionHandler;
  // Wave 1 consolidated handlers
  core: import('./core.js').SheetsCoreHandler;
  visualize: import('./visualize.js').VisualizeHandler;
  collaborate: import('./collaborate.js').CollaborateHandler;
  // Tier 7 Enterprise handlers
  templates: import('./templates.js').SheetsTemplatesHandler;
  bigquery: import('./bigquery.js').SheetsBigQueryHandler;
  appsscript: import('./appsscript.js').SheetsAppsScriptHandler;
  // Webhook handler
  webhooks: import('./webhooks.js').WebhookHandler;
  // Dependencies handler
  dependencies: import('./dependencies.js').DependenciesHandler;
  // Federation handler (Feature 3)
  federation: import('./federation.js').FederationHandler;
  // Computation engine (Phase 5)
  compute: import('./compute.js').ComputeHandler;
  // Agent loop (Phase 6)
  agent: import('./agent.js').AgentHandler;
  // Live data connectors (Wave 6)
  connectors: import('./connectors.js').ConnectorsHandler;
}

/**
 * Lazy-loading handler factory
 * Handlers are only imported and instantiated when first accessed
 * Provides ~30% faster initialization for typical usage
 */
export function createHandlers(options: HandlerFactoryOptions): Handlers {
  const cache = {} as Partial<Handlers>;
  let handlersRef: Handlers | undefined;

  const loaders = {
    async data() {
      const { SheetsDataHandler } = await import('./data.js');
      return new SheetsDataHandler(options.context, options.sheetsApi);
    },
    async format() {
      const { FormatHandler } = await import('./format.js');
      return new FormatHandler(options.context, options.sheetsApi);
    },
    async dimensions() {
      const { DimensionsHandler } = await import('./dimensions.js');
      return new DimensionsHandler(options.context, options.sheetsApi);
    },
    async advanced() {
      const { AdvancedHandler } = await import('./advanced.js');
      return new AdvancedHandler(options.context, options.sheetsApi);
    },
    async transaction() {
      const { TransactionHandler } = await import('./transaction.js');
      return new TransactionHandler({ context: options.context });
    },
    async quality() {
      const { QualityHandler } = await import('./quality.js');
      return new QualityHandler();
    },
    async history() {
      const { HistoryHandler } = await import('./history.js');
      return new HistoryHandler({
        snapshotService: options.context.snapshotService,
        driveApi: options.driveApi,
        sheetsApi: options.sheetsApi,
        server: options.context.server,
        taskStore: options.context.taskStore,
        googleClient: options.context.googleClient ?? undefined,
        sessionContext: options.context.sessionContext,
      });
    },
    // New MCP-native handlers
    async confirm() {
      const { ConfirmHandler } = await import('./confirm.js');
      return new ConfirmHandler({ context: options.context });
    },
    async analyze() {
      const { AnalyzeHandler } = await import('./analyze.js');
      return new AnalyzeHandler(options.context, options.sheetsApi);
    },
    async fix() {
      const { FixHandler } = await import('./fix.js');
      return new FixHandler(options.context, options.sheetsApi);
    },
    async composite() {
      const { CompositeHandler } = await import('./composite.js');
      return new CompositeHandler(options.context, options.sheetsApi, options.driveApi);
    },
    async session() {
      const { SessionHandler } = await import('./session.js');
      const handler = new SessionHandler(options.context.sessionContext);
      if (options.context.scheduler) {
        handler.setScheduler(options.context.scheduler);
      }
      return handler;
    },
    // Wave 1 consolidated handlers
    async core() {
      const { SheetsCoreHandler } = await import('./core.js');
      return new SheetsCoreHandler(options.context, options.sheetsApi, options.driveApi);
    },
    async visualize() {
      const { VisualizeHandler } = await import('./visualize.js');
      return new VisualizeHandler(options.context, options.sheetsApi);
    },
    async collaborate() {
      const { CollaborateHandler } = await import('./collaborate.js');
      return new CollaborateHandler(options.context, options.driveApi, options.sheetsApi);
    },
    // Tier 7 Enterprise handlers
    async templates() {
      const { SheetsTemplatesHandler } = await import('./templates.js');
      return new SheetsTemplatesHandler(options.context, options.sheetsApi, options.driveApi);
    },
    async bigquery() {
      const { SheetsBigQueryHandler } = await import('./bigquery.js');
      return new SheetsBigQueryHandler(options.context, options.sheetsApi, options.bigqueryApi);
    },
    async appsscript() {
      const { SheetsAppsScriptHandler } = await import('./appsscript.js');
      return new SheetsAppsScriptHandler(options.context);
    },
    // Webhook handler
    async webhooks() {
      const { createWebhookHandler } = await import('./webhooks.js');
      const { WorkspaceEventsService } = await import('../services/workspace-events.js');
      const workspaceEventsService = options.context.googleClient
        ? new WorkspaceEventsService(options.context.googleClient)
        : undefined;
      return createWebhookHandler({
        driveApi: options.driveApi,
        workspaceEventsService,
      });
    },
    // Dependencies handler
    async dependencies() {
      const { createDependenciesHandler } = await import('./dependencies.js');
      return createDependenciesHandler(options.sheetsApi, {
        sessionContext: options.context.sessionContext,
      });
    },
    // Federation handler (Feature 3)
    async federation() {
      const { FederationHandler } = await import('./federation.js');
      return new FederationHandler(options.context.taskStore, {
        sessionContext: options.context.sessionContext,
      });
    },
    // Computation engine (Phase 5)
    async compute() {
      const { ComputeHandler } = await import('./compute.js');
      return new ComputeHandler(options.sheetsApi, {
        samplingServer: options.context.samplingServer,
        duckdbEngine: options.context.duckdbEngine,
        sessionContext: options.context.sessionContext,
      });
    },
    // Agent loop (Phase 6)
    async agent() {
      const { AgentHandler } = await import('./agent.js');
      return new AgentHandler(handlersRef as unknown as import('./agent.js').AgentHandlerRegistry, {
        sessionContext: options.context.sessionContext,
      });
    },
    // Live data connectors (Wave 6)
    async connectors() {
      const { ConnectorsHandler } = await import('./connectors.js');
      return new ConnectorsHandler({
        samplingServer: options.context.samplingServer,
        sessionContext: options.context.sessionContext,
        elicitationServer: options.context.elicitationServer ?? options.context.server,
      });
    },
  };

  handlersRef = new Proxy({} as Handlers, {
    get(_, prop: string) {
      // Return cached handler if available
      if (cache[prop as keyof Handlers]) {
        return cache[prop as keyof Handlers];
      }

      // Check if loader exists for this handler
      const loader = loaders[prop as keyof typeof loaders];
      if (!loader) {
        throw new HandlerLoadError(`Unknown handler: ${prop}`, prop as string, {
          availableHandlers: Object.keys(loaders),
        });
      }

      // Return a proxy that loads the handler on first method call
      return new Proxy(
        {},
        {
          get(_, methodProp: string) {
            return async (...args: unknown[]) => {
              // Lazy load and cache the handler
              if (!cache[prop as keyof Handlers]) {
                (cache as Record<string, unknown>)[prop as string] = await loader();
              }
              const handler = cache[prop as keyof Handlers]!;
              const method = (handler as unknown as Record<string, unknown>)[methodProp];
              if (typeof method !== 'function') {
                throw new HandlerLoadError(
                  `Method ${methodProp} not found on handler ${prop}`,
                  prop as string,
                  { method: methodProp as string }
                );
              }
              return method.apply(handler, args);
            };
          },
        }
      );
    },
  });
  return handlersRef;
}
