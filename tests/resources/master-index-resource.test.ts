import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEnvForTest } from '../../src/config/env.js';
import { registerMasterIndexResource } from '../../src/resources/master-index.js';
import { getPromptsCatalogCount } from '../../src/resources/prompts-catalog.js';

interface ResourceResult {
  contents: Array<{ text: string }>;
}

type ResourceHandler = (uri: string | URL) => Promise<ResourceResult>;

function createResourceHarness() {
  const handlers = new Map<string, ResourceHandler>();
  const server = {
    registerResource(
      _name: string,
      uri: string,
      _metadata: unknown,
      handler: ResourceHandler
    ): void {
      handlers.set(uri, handler);
    },
  };

  registerMasterIndexResource(server as never);

  return {
    async read(uri: string) {
      const handler = handlers.get(uri);
      expect(handler).toBeDefined();
      return await handler!(uri);
    },
  };
}

describe('servalsheets://index resource', () => {
  afterEach(() => {
    resetEnvForTest();
    vi.unstubAllEnvs();
  });

  it('exposes live prompt counts and human descriptions for advanced tools', async () => {
    const harness = createResourceHarness();
    const result = await harness.read('servalsheets://index');
    const payload = JSON.parse(result.contents[0]!.text);

    expect(payload.stats.prompts).toBe(getPromptsCatalogCount());

    const descriptions = new Map(
      payload.tools.byActionCount.map((tool: { name: string; description: string }) => [
        tool.name,
        tool.description,
      ])
    );

    expect(descriptions.get('sheets_compute')).toContain('forecast');
    expect(descriptions.get('sheets_agent')).toContain('Autonomous');
    expect(descriptions.get('sheets_connectors')).toContain('external data');
    expect(descriptions.get('sheets_federation')).toContain('cross-server');

    expect(payload.promptCatalog.total).toBe(getPromptsCatalogCount());
    expect(payload.promptCatalog.bucketCount).toBeGreaterThan(0);
    expect(
      payload.promptCatalog.buckets.some(
        (bucket: { id: string; prompts: Array<{ name: string }> }) =>
          bucket.id === 'analyze' &&
          bucket.prompts.some((prompt) => prompt.name === 'analyze_spreadsheet')
      )
    ).toBe(true);

    const appsscriptTool = payload.tools.byActionCount.find(
      (tool: { name: string; actions: number }) => tool.name === 'sheets_appsscript'
    );
    expect(appsscriptTool?.actions).toBe(15);
  });

  it('routes full analysis through scout before comprehensive', async () => {
    const harness = createResourceHarness();
    const result = await harness.read('servalsheets://index');
    const payload = JSON.parse(result.contents[0]!.text);

    const fullAnalysis = payload.commonWorkflows.find(
      (workflow: { name: string }) => workflow.name === 'Full Analysis'
    );

    expect(fullAnalysis).toBeDefined();
    expect(fullAnalysis.steps[0]).toBe('sheets_auth status');
    expect(fullAnalysis.steps[1]).toBe('sheets_analyze scout');
    expect(fullAnalysis.steps[2]).toBe('sheets_analyze comprehensive');
    expect(payload.usage.toolSelection).toContain('route directly when intent is explicit');

    expect(payload.workflowCatalog.total).toBeGreaterThan(0);
    expect(payload.workflowCatalog.usage).toContain('action:"plan"');
    expect(payload.workflowCatalog.usage).toContain('action:"execute_plan"');
    expect(payload.workflowCatalog.usage).not.toContain('plan_execute');

    const smartCleanup = payload.workflowCatalog.flows.find(
      (flow: { type: string }) => flow.type === 'smart_cleanup'
    );

    expect(smartCleanup).toBeDefined();
    expect(smartCleanup.stepCount).toBeGreaterThan(0);
    expect(typeof smartCleanup.hasMutatingSteps).toBe('boolean');
  });

  it('restores full Apps Script action counts when trigger compatibility is enabled', async () => {
    vi.stubEnv('ENABLE_APPSSCRIPT_TRIGGER_COMPAT', 'true');
    resetEnvForTest();

    const harness = createResourceHarness();
    const result = await harness.read('servalsheets://index');
    const payload = JSON.parse(result.contents[0]!.text);

    const appsscriptTool = payload.tools.byActionCount.find(
      (tool: { name: string; actions: number }) => tool.name === 'sheets_appsscript'
    );
    expect(appsscriptTool?.actions).toBe(19);
  });
});
