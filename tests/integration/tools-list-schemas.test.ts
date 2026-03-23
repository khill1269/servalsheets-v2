import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { resetEnvForTest } from '../../src/config/env.js';
import { ServalSheetsServer } from '../../src/server.js';
import { DEFER_SCHEMAS } from '../../src/config/constants.js';
import { TOOL_COUNT } from '../../src/schemas/action-counts.js';

type ListToolsResponse = {
  tools: Array<{
    name: string;
    inputSchema: { type: string; properties?: Record<string, unknown>; [key: string]: unknown };
    outputSchema?: { type: string; properties?: Record<string, unknown>; [key: string]: unknown };
    icons?: Array<{
      src: string;
      mimeType?: string;
      sizes?: string[];
    }>;
  }>;
};

async function requestToolsList(server: ServalSheetsServer): Promise<ListToolsResponse> {
  const mcpServer = server.server;
  const protocolServer = (
    mcpServer as unknown as { server: { _requestHandlers?: Map<string, any> } }
  ).server;
  const handler = protocolServer?._requestHandlers?.get('tools/list');
  if (!handler) {
    throw new Error('tools/list handler not registered');
  }
  return handler({ method: 'tools/list', params: {} }, { sessionId: 'test' });
}

function getRequestActions(tool: ListToolsResponse['tools'][number]): string[] {
  const request = (tool.inputSchema.properties?.['request'] ?? {}) as Record<string, unknown>;
  const requestProperties = (request['properties'] ?? {}) as Record<string, any>;
  const enumValues = requestProperties['action']?.['enum'];
  if (Array.isArray(enumValues)) {
    return enumValues.filter((value): value is string => typeof value === 'string');
  }

  const variants = Array.isArray(request['oneOf'])
    ? request['oneOf']
    : Array.isArray(request['anyOf'])
      ? request['anyOf']
      : [];

  return variants
    .map((variant) => {
      const actionSchema = (variant as Record<string, any>)?.['properties']?.['action'];
      if (typeof actionSchema?.['const'] === 'string') {
        return actionSchema['const'];
      }
      const variantEnum = actionSchema?.['enum'];
      return Array.isArray(variantEnum) && typeof variantEnum[0] === 'string'
        ? variantEnum[0]
        : null;
    })
    .filter((value): value is string => Boolean(value));
}

describe('tools/list Schema Serialization', () => {
  let server: ServalSheetsServer;

  beforeAll(async () => {
    // Create server instance (applies SDK patch)
    server = new ServalSheetsServer({
      name: 'ServalSheets Test',
      version: '1.0.0-test',
    });

    // Initialize to register tools
    await server.initialize();
  });

  afterAll(async () => {
    // Clean shutdown
    await server.shutdown();
  });

  afterEach(() => {
    resetEnvForTest();
    delete process.env['ENABLE_APPSSCRIPT_TRIGGER_COMPAT'];
  });

  it('should return non-empty schemas for all tools', async () => {
    // Call tools/list via MCP protocol
    const response = await requestToolsList(server);

    expect(response).toBeDefined();
    expect(response.tools).toBeInstanceOf(Array);
    expect(response.tools).toHaveLength(TOOL_COUNT);

    // Check each tool has non-empty schema
    for (const tool of response.tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();

      const properties = tool.inputSchema.properties as Record<string, unknown>;
      const propertyCount = Object.keys(properties).length;
      expect(propertyCount).toBeGreaterThan(0);

      // Should NOT be the empty schema bug
      expect(tool.inputSchema).not.toEqual({
        type: 'object',
        properties: {},
      });
    }
  });

  it('should handle z.preprocess tools correctly', async () => {
    const preprocessTools = [
      'sheets_confirm',
      'sheets_data',
      'sheets_format',
      'sheets_dimensions',
      'sheets_quality',
    ];

    const response = await requestToolsList(server);

    for (const toolName of preprocessTools) {
      const tool = response.tools.find((t) => t.name === toolName);
      expect(tool, `Tool ${toolName} should be registered`).toBeDefined();
      expect(tool!.inputSchema.properties).toBeDefined();

      const propertyCount = Object.keys(tool!.inputSchema.properties).length;
      expect(propertyCount, `Tool ${toolName} should have non-empty schema`).toBeGreaterThan(0);
    }
  });

  it('should expose request property for all tools', async () => {
    const response = await requestToolsList(server);

    // All ServalSheets tools use { request: ... } pattern
    for (const tool of response.tools) {
      expect(
        tool.inputSchema.properties.request,
        `Tool ${tool.name} should have request property`
      ).toBeDefined();

      // Request should have oneOf or properties
      const request = tool.inputSchema.properties.request as Record<string, unknown>;
      const hasOneOf = 'oneOf' in request;
      const hasProperties = 'properties' in request;

      expect(
        hasOneOf || hasProperties,
        `Tool ${tool.name} request should have oneOf or properties`
      ).toBe(true);
    }
  });

  it('should handle outputSchema registration', async () => {
    const response = await requestToolsList(server);

    // Output schemas are optional in MCP, but if present should be valid
    for (const tool of response.tools) {
      if (tool.outputSchema) {
        expect(tool.outputSchema.type).toBe('object');
        expect(tool.outputSchema.properties).toBeDefined();

        // Should not be empty
        const properties = tool.outputSchema.properties as Record<string, unknown>;
        const propertyCount = Object.keys(properties).length;
        expect(
          propertyCount,
          `Tool ${tool.name} should have non-empty output schema`
        ).toBeGreaterThan(0);
      }
    }
  });

  it('should include icons for all tools in runtime tools/list output', async () => {
    const response = await requestToolsList(server);

    for (const tool of response.tools) {
      expect(tool.icons, `Tool ${tool.name} should expose icons in tools/list`).toBeDefined();
      expect(tool.icons, `Tool ${tool.name} should expose at least one icon`).toHaveLength(1);
      expect(tool.icons?.[0]?.src).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(tool.icons?.[0]?.mimeType).toBe('image/svg+xml');
    }
  });

  it('should expose inline action parameter hints in deferred schema mode', async () => {
    if (!DEFER_SCHEMAS) return;

    const response = await requestToolsList(server);
    const dataTool = response.tools.find((tool) => tool.name === 'sheets_data');

    expect(dataTool).toBeDefined();

    const metadata = (dataTool!.inputSchema as Record<string, unknown>)['x-servalsheets'] as
      | Record<string, unknown>
      | undefined;
    expect(metadata).toBeDefined();

    const actionParams = metadata?.['actionParams'] as Record<string, unknown> | undefined;
    expect(actionParams).toBeDefined();

    const writeHint = actionParams?.['write'] as Record<string, unknown> | undefined;
    expect(writeHint).toBeDefined();
    expect(writeHint?.['required']).toEqual(expect.arrayContaining(['spreadsheetId', 'values']));

    const requestSchema = (dataTool!.inputSchema.properties?.['request'] ?? {}) as Record<
      string,
      unknown
    >;
    expect(String(requestSchema['description'] ?? '')).toContain('Required fields by action:');
    expect(String(requestSchema['description'] ?? '')).toContain('write(');
    expect(String(requestSchema['description'] ?? '')).not.toContain('schema://tools/');
  });

  it('should expose compact nested enum/type hints for deferred schemas', async () => {
    if (!DEFER_SCHEMAS) return;

    const response = await requestToolsList(server);

    const getActionParams = (toolName: string): Record<string, any> => {
      const tool = response.tools.find((entry) => entry.name === toolName);
      expect(tool, `Tool ${toolName} should be present`).toBeDefined();

      const metadata = (tool!.inputSchema as Record<string, unknown>)['x-servalsheets'] as
        | Record<string, unknown>
        | undefined;
      expect(metadata, `Tool ${toolName} should expose x-servalsheets metadata`).toBeDefined();

      const actionParams = metadata?.['actionParams'] as Record<string, any> | undefined;
      expect(actionParams, `Tool ${toolName} should expose actionParams`).toBeDefined();
      return actionParams ?? {};
    };

    const fixActionParams = getActionParams('sheets_fix');
    expect(fixActionParams['fill_missing']?.params?.strategy).toMatchObject({
      type: 'string',
      enum: ['forward', 'backward', 'mean', 'median', 'mode', 'constant'],
    });
    expect(
      fixActionParams['standardize_formats']?.params?.columns?.items?.properties?.targetFormat?.enum
    ).toContain('title_case');

    const formatActionParams = getActionParams('sheets_format');
    expect(
      formatActionParams['batch_format']?.params?.operations?.items?.properties?.type?.enum
    ).toEqual(expect.arrayContaining(['background', 'text_format', 'borders']));
    expect(formatActionParams['auto_fit']?.requiredOneOf).toEqual([['range', 'sheetId']]);

    const visualizeActionParams = getActionParams('sheets_visualize');
    expect(
      visualizeActionParams['chart_create']?.params?.options?.properties?.legendPosition?.enum
    ).toContain('BOTTOM_LEGEND');

    const appsscriptActionParams = getActionParams('sheets_appsscript');
    expect(appsscriptActionParams['list_triggers']).toBeUndefined();
    expect(appsscriptActionParams['update_content']?.requiredOneOf).toEqual([
      ['scriptId', 'spreadsheetId'],
    ]);

    const collaborateActionParams = getActionParams('sheets_collaborate');
    expect(collaborateActionParams['share_add']?.required).toEqual(
      expect.arrayContaining(['spreadsheetId', 'type', 'role'])
    );
    expect(
      Object.values(collaborateActionParams).filter(
        (hint) => typeof hint?.description === 'string' && hint.description.length > 0
      )
    ).toHaveLength(41);
    expect(collaborateActionParams['share_add']?.params?.type?.enum).toEqual(
      expect.arrayContaining(['user', 'group', 'domain', 'anyone'])
    );
    expect(
      String(collaborateActionParams['version_restore_revision']?.description ?? '')
    ).toContain('Drive revision');
    expect(String(collaborateActionParams['approval_delegate']?.description ?? '')).toContain(
      'Delegate'
    );
    expect(collaborateActionParams['label_apply']?.requiredOneOf).toEqual([
      ['fileId', 'spreadsheetId'],
    ]);

    const federationActionParams = getActionParams('sheets_federation');
    expect(
      Object.values(federationActionParams).filter((hint) =>
        Object.prototype.hasOwnProperty.call(hint, 'params')
      )
    ).toHaveLength(4);
    expect(Object.keys(federationActionParams['list_servers']?.params ?? {})).toEqual([]);
    expect(Object.keys(federationActionParams['call_remote']?.params ?? {})).toEqual([
      'serverName',
      'toolName',
      'toolInput',
    ]);
    expect(Object.keys(federationActionParams['get_server_tools']?.params ?? {})).toEqual([
      'serverName',
    ]);
    expect(Object.keys(federationActionParams['validate_connection']?.params ?? {})).toEqual([
      'serverName',
    ]);

    const connectorsActionParams = getActionParams('sheets_connectors');
    expect(connectorsActionParams['configure']?.required).toEqual([]);
    expect(String(connectorsActionParams['configure']?.description ?? '')).toContain(
      'MCP URL elicitation'
    );

    const sessionActionParams = getActionParams('sheets_session');
    expect(
      Object.values(sessionActionParams).filter((hint) =>
        Object.prototype.hasOwnProperty.call(hint, 'required')
      )
    ).toHaveLength(31);
    expect(sessionActionParams['get_context']?.required).toEqual([]);
    expect(sessionActionParams['set_active']?.required).toEqual(['spreadsheetId']);

    const authActionParams = getActionParams('sheets_auth');
    expect(
      Object.values(authActionParams).filter((hint) =>
        Object.prototype.hasOwnProperty.call(hint, 'required')
      )
    ).toHaveLength(5);
    expect(authActionParams['status']?.required).toEqual([]);
    expect(authActionParams['callback']?.required).toEqual(['code', 'state']);
  });

  it('should expose typed flat request properties in deferred input schemas', async () => {
    if (!DEFER_SCHEMAS) return;

    const response = await requestToolsList(server);

    const getRequestProperties = (toolName: string): Record<string, any> => {
      const tool = response.tools.find((entry) => entry.name === toolName);
      expect(tool, `Tool ${toolName} should be present`).toBeDefined();

      const request = (tool!.inputSchema.properties?.['request'] ?? {}) as Record<string, any>;
      expect(request['type'], `Tool ${toolName} request should be an object`).toBe('object');
      expect(
        request['additionalProperties'],
        `Tool ${toolName} request should stay permissive`
      ).toBe(true);

      return (request['properties'] ?? {}) as Record<string, any>;
    };

    const fixProperties = getRequestProperties('sheets_fix');
    expect(fixProperties['strategy']).toMatchObject({
      type: 'string',
      enum: ['forward', 'backward', 'mean', 'median', 'mode', 'constant'],
    });

    const dataProperties = getRequestProperties('sheets_data');
    expect(dataProperties['values']?.type).toBe('array');
    expect(dataProperties['values']?.items?.type).toBe('array');

    const qualityProperties = getRequestProperties('sheets_quality');
    expect(
      qualityProperties['value']?.oneOf ??
        qualityProperties['value']?.anyOf ??
        qualityProperties['value']?.type
    ).toBeDefined();

    const visualizeProperties = getRequestProperties('sheets_visualize');
    expect(['number', 'integer']).toContain(visualizeProperties['sheetId']?.type);

    const connectorsProperties = getRequestProperties('sheets_connectors');
    expect(connectorsProperties['credentials']?.type).toBe('object');
    expect(connectorsProperties['connectorId']?.type).toBe('string');
  });

  it('should expose partial availability metadata for sheets_webhook when Redis is not configured', async () => {
    const previousRedisUrl = process.env['REDIS_URL'];
    delete process.env['REDIS_URL'];

    try {
      const response = await requestToolsList(server);
      const webhookTool = response.tools.find((tool) => tool.name === 'sheets_webhook');

      expect(webhookTool).toBeDefined();
      expect(String(webhookTool!.description ?? '')).toContain(
        'Redis is not configured in this server process'
      );

      if (DEFER_SCHEMAS) {
        const metadata = (webhookTool!.inputSchema as Record<string, unknown>)['x-servalsheets'] as
          | Record<string, unknown>
          | undefined;
        expect(metadata).toBeDefined();

        const availability = metadata?.['availability'] as Record<string, unknown> | undefined;
        expect(availability).toMatchObject({
          status: 'partial',
          reason: 'Redis backend not configured in this server process',
        });
        expect(availability?.['unavailableActions']).toEqual(
          expect.arrayContaining(['register', 'list', 'test', 'get_stats'])
        );
        expect(availability?.['availableActions']).toEqual(
          expect.arrayContaining(['watch_changes', 'subscribe_workspace'])
        );
      }
    } finally {
      if (previousRedisUrl === undefined) {
        delete process.env['REDIS_URL'];
      } else {
        process.env['REDIS_URL'] = previousRedisUrl;
      }
    }
  });

  it('should hide Apps Script trigger compatibility actions by default', async () => {
    delete process.env['ENABLE_APPSSCRIPT_TRIGGER_COMPAT'];
    resetEnvForTest();

    const response = await requestToolsList(server);
    const appsscriptTool = response.tools.find((tool) => tool.name === 'sheets_appsscript');

    expect(appsscriptTool).toBeDefined();
    expect(String(appsscriptTool!.description ?? '')).toContain(
      'Apps Script trigger compatibility actions are hidden by default'
    );

    const actionEnum = getRequestActions(appsscriptTool!);

    expect(actionEnum).not.toContain('create_trigger');
    expect(actionEnum).not.toContain('list_triggers');

    if (DEFER_SCHEMAS) {
      const metadata = (appsscriptTool!.inputSchema as Record<string, unknown>)[
        'x-servalsheets'
      ] as Record<string, unknown> | undefined;
      const actionParams = (metadata?.['actionParams'] ?? {}) as Record<string, unknown>;
      const availability = metadata?.['availability'] as Record<string, unknown> | undefined;

      expect(actionParams['create_trigger']).toBeUndefined();
      expect(actionParams['list_triggers']).toBeUndefined();
      expect(availability).toMatchObject({
        status: 'partial',
        reason:
          'Apps Script trigger compatibility actions are disabled by default because external Apps Script REST clients cannot manage triggers.',
      });
      expect(availability?.['unavailableActions']).toEqual(
        expect.arrayContaining([
          'create_trigger',
          'list_triggers',
          'delete_trigger',
          'update_trigger',
        ])
      );
    }
  });

  it('should expose Apps Script trigger compatibility actions when explicitly enabled', async () => {
    process.env['ENABLE_APPSSCRIPT_TRIGGER_COMPAT'] = 'true';
    resetEnvForTest();

    const response = await requestToolsList(server);
    const appsscriptTool = response.tools.find((tool) => tool.name === 'sheets_appsscript');

    expect(appsscriptTool).toBeDefined();

    const actionEnum = getRequestActions(appsscriptTool!);

    expect(actionEnum).toContain('create_trigger');
    expect(actionEnum).toContain('list_triggers');

    if (DEFER_SCHEMAS) {
      const metadata = (appsscriptTool!.inputSchema as Record<string, unknown>)[
        'x-servalsheets'
      ] as Record<string, unknown> | undefined;
      const actionParams = (metadata?.['actionParams'] ?? {}) as Record<string, unknown>;
      const availability = metadata?.['availability'];

      expect(actionParams['create_trigger']).toBeDefined();
      expect(actionParams['list_triggers']).toBeDefined();
      expect(availability).toBeUndefined();
    }
  });
});
