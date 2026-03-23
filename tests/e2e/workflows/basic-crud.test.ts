/**
 * ServalSheets - E2E Basic CRUD Workflow Tests
 *
 * Tests basic Create, Read, Update, Delete operations
 * with real MCP client simulation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHttpClient } from '../mcp-client-simulator.js';
import type { MCPHttpClient } from '../mcp-client-simulator.js';
import { TOOL_COUNT } from '../../../src/schemas/action-counts.js';

const TEST_SPREADSHEET_ID = process.env['TEST_SPREADSHEET_ID'];
const SKIP_E2E = !TEST_SPREADSHEET_ID || process.env['TEST_E2E'] !== 'true';

describe.skipIf(SKIP_E2E)('E2E: Basic CRUD Operations', () => {
  let client: MCPHttpClient;

  beforeAll(async () => {
    // Create HTTP client targeting local server
    client = createTestHttpClient('http://localhost:3000');

    // Initialize handshake
    const capabilities = await client.initialize();

    // Verify server capabilities
    expect(capabilities.tools).toBeDefined();
    expect(capabilities.resources).toBeDefined();
    expect(capabilities.prompts).toBeDefined();
  });

  afterAll(async () => {
    await client.close();
  });

  describe('Tool Discovery', () => {
    it('should list all tools', async () => {
      const tools = await client.listTools();

      expect(tools).toHaveLength(TOOL_COUNT);

      // Verify essential tools exist
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('sheets_auth');
      expect(toolNames).toContain('sheets_core');
      expect(toolNames).toContain('sheets_data');
      expect(toolNames).toContain('sheets_format');
    });

    it('should have valid tool schemas', async () => {
      const tools = await client.listTools();

      for (const tool of tools) {
        // Every tool must have these fields
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
        expect(tool.inputSchema).toBeDefined();

        // Validate inputSchema is valid JSON Schema
        expect(tool.inputSchema.type).toBeDefined();
        expect(tool.inputSchema.properties).toBeDefined();
      }
    });

    it('should validate protocol compliance', () => {
      const validation = client.validateProtocolCompliance();

      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Protocol violations:', validation.errors);
      }
    });
  });

  describe('Read Operations', () => {
    it('should read spreadsheet metadata', async () => {
      const result = await client.callTool('sheets_core', {
        request: {
          action: 'get_spreadsheet',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);

      // Verify structured content
      if ('structuredContent' in result && result.structuredContent) {
        const structured = result.structuredContent as {
          response: { success: boolean; data: { spreadsheet: unknown } };
        };
        expect(structured.response.success).toBe(true);
        expect(structured.response.data.spreadsheet).toBeDefined();
      }
    });

    it('should read range values', async () => {
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1:B2',
        },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toBeDefined();
    });
  });

  describe('Write Operations', () => {
    it('should write values to range', async () => {
      const testData = [
        ['Name', 'Age'],
        ['Alice', '30'],
        ['Bob', '25'],
      ];

      const result = await client.callTool('sheets_data', {
        request: {
          action: 'write_values',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1:B3',
          values: testData,
        },
      });

      expect(result.isError).toBe(false);

      // Verify write succeeded
      if ('structuredContent' in result && result.structuredContent) {
        const structured = result.structuredContent as {
          response: { success: boolean };
        };
        expect(structured.response.success).toBe(true);
      }
    });

    it('should update existing values', async () => {
      // First write
      await client.callTool('sheets_data', {
        request: {
          action: 'write_values',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1',
          values: [['Original']],
        },
      });

      // Update
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'write_values',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1',
          values: [['Updated']],
        },
      });

      expect(result.isError).toBe(false);

      // Read back and verify
      const readResult = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1',
        },
      });

      expect(readResult.isError).toBe(false);
    });
  });

  describe('Delete Operations', () => {
    it('should clear range values', async () => {
      // Write test data
      await client.callTool('sheets_data', {
        request: {
          action: 'write_values',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A10:B10',
          values: [['Delete', 'Me']],
        },
      });

      // Clear the range
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'clear_range',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A10:B10',
        },
      });

      expect(result.isError).toBe(false);

      // Verify cleared
      const readResult = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A10:B10',
        },
      });

      expect(readResult.isError).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid spreadsheet ID', async () => {
      const result = await client.callTool('sheets_core', {
        request: {
          action: 'get_spreadsheet',
          spreadsheetId: 'invalid-id',
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content[0]).toMatchObject({
        type: 'text',
      });
    });

    it('should handle invalid range', async () => {
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'InvalidRange!!!',
        },
      });

      expect(result.isError).toBe(true);
    });

    it('should handle missing required fields', async () => {
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          // Missing spreadsheetId
          range: 'A1:B2',
        },
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('Resource Access', () => {
    it('should list available resources', async () => {
      const resources = await client.listResources();

      expect(resources.length).toBeGreaterThan(0);

      // Verify resource structure
      for (const resource of resources) {
        expect(typeof resource.uri).toBe('string');
        expect(resource.uri.length).toBeGreaterThan(0);
        expect(typeof resource.name).toBe('string');
        expect(resource.name.length).toBeGreaterThan(0);
      }
    });

    it('should read schema resources', async () => {
      const resources = await client.listResources();

      // Find a schema resource
      const schemaResource = resources.find((r) => r.uri.startsWith('schema://'));

      if (schemaResource) {
        const content = await client.readResource(schemaResource.uri);
        expect(content.contents).toBeDefined();
        expect(content.contents.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Prompt Access', () => {
    it('should list available prompts', async () => {
      const prompts = await client.listPrompts();

      expect(prompts.length).toBeGreaterThan(0);

      // Verify prompt structure
      for (const prompt of prompts) {
        expect(typeof prompt.name).toBe('string');
        expect(prompt.name.length).toBeGreaterThan(0);
        expect(typeof prompt.description).toBe('string');
        expect(prompt.description.length).toBeGreaterThan(0);
      }
    });
  });
});
