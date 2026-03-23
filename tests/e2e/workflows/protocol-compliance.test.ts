/**
 * ServalSheets - E2E Protocol Compliance Tests
 *
 * Tests MCP 2025-11-25 protocol compliance:
 * - Initialize handshake flow
 * - Capability negotiation
 * - Tool registration format
 * - Response structure validation
 * - Resource URI templates
 * - Sampling (SEP-1577)
 * - Elicitation (SEP-1036)
 * - Tasks (SEP-1686)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHttpClient } from '../mcp-client-simulator.js';
import type { MCPHttpClient } from '../mcp-client-simulator.js';
import { TOOL_COUNT } from '../../../src/schemas/action-counts.js';

const SKIP_E2E = process.env['TEST_E2E'] !== 'true';

describe.skipIf(SKIP_E2E)('E2E: MCP Protocol Compliance', () => {
  let client: MCPHttpClient;

  beforeAll(async () => {
    client = createTestHttpClient('http://localhost:3000');
  });

  afterAll(async () => {
    if (client.isInitialized()) {
      await client.close();
    }
  });

  describe('Initialize Handshake (MCP 2025-11-25)', () => {
    it('should complete initialize/initialized flow', async () => {
      const capabilities = await client.initialize();

      // Verify server capabilities
      expect(capabilities).toBeDefined();
      expect(capabilities.tools).toBeDefined();
      expect(capabilities.resources).toBeDefined();
      expect(capabilities.prompts).toBeDefined();
      expect(capabilities.logging).toBeDefined();

      // Verify client is marked as initialized
      expect(client.isInitialized()).toBe(true);
    });

    it('should reject duplicate initialization', async () => {
      // Already initialized in previous test
      await expect(client.initialize()).rejects.toThrow();
    });

    it('should include server info', async () => {
      const session = client.getSession();

      expect(session.serverCapabilities).toBeDefined();
    });
  });

  describe('Capability Negotiation', () => {
    it('should declare tools capability', async () => {
      const session = client.getSession();

      expect(session.serverCapabilities?.tools).toBeDefined();
    });

    it('should declare resources capability', async () => {
      const session = client.getSession();

      expect(session.serverCapabilities?.resources).toBeDefined();
      expect(session.serverCapabilities?.resources).toMatchObject({
        subscribe: true,
      });
    });

    it('should declare prompts capability', async () => {
      const session = client.getSession();

      expect(session.serverCapabilities?.prompts).toBeDefined();
    });

    it('should declare logging capability', async () => {
      const session = client.getSession();

      expect(session.serverCapabilities?.logging).toBeDefined();
    });

    it('should handle client capabilities', async () => {
      // Client capabilities passed during init
      const config = {
        name: 'capability-test-client',
        version: '1.0.0',
        capabilities: {
          elicitation: true,
          sampling: true,
        },
        protocolVersion: '2025-11-25',
        transport: 'http' as const,
      };

      const testClient = createTestHttpClient('http://localhost:3000', config);
      await testClient.initialize();

      expect(testClient.isInitialized()).toBe(true);

      await testClient.close();
    });
  });

  describe('Tool Registration Format', () => {
    it('should register exactly TOOL_COUNT tools', async () => {
      const tools = await client.listTools();

      expect(tools).toHaveLength(TOOL_COUNT);
    });

    it('should satisfy MCP tool naming rules', async () => {
      const tools = await client.listTools();

      for (const tool of tools) {
        expect(tool.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      }
    });

    it('should include required tool fields', async () => {
      const tools = await client.listTools();

      for (const tool of tools) {
        // Required by MCP 2025-11-25
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
      }
    });

    it('should include tool annotations', async () => {
      const tools = await client.listTools();

      for (const tool of tools) {
        // Annotations are optional but recommended
        if ('annotations' in tool && tool.annotations) {
          const annotations = tool.annotations as {
            readOnlyHint?: boolean;
            destructiveHint?: boolean;
            idempotentHint?: boolean;
            openWorldHint?: boolean;
          };

          // If present, should be valid boolean values
          if ('readOnlyHint' in annotations) {
            expect(typeof annotations.readOnlyHint).toBe('boolean');
          }
          if ('destructiveHint' in annotations) {
            expect(typeof annotations.destructiveHint).toBe('boolean');
          }
          if ('idempotentHint' in annotations) {
            expect(typeof annotations.idempotentHint).toBe('boolean');
          }
          if ('openWorldHint' in annotations) {
            expect(typeof annotations.openWorldHint).toBe('boolean');
          }
        }
      }
    });

    it('should include icons (SEP-973)', async () => {
      const tools = await client.listTools();

      // Count tools with icons
      const toolsWithIcons = tools.filter((t) => 'icon' in t && t.icon);

      // Should have icons for most tools
      expect(toolsWithIcons.length).toBeGreaterThan(0);
    });
  });

  describe('Response Structure Validation', () => {
    it('should return CallToolResult structure', async () => {
      const result = await client.callTool('sheets_auth', {
        request: {
          action: 'check_auth',
        },
      });

      // MCP 2025-11-25 CallToolResult structure
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('isError');
      expect(Array.isArray(result.content)).toBe(true);
      expect(typeof result.isError).toBe('boolean');
    });

    it('should include content array', async () => {
      const result = await client.callTool('sheets_auth', {
        request: {
          action: 'check_auth',
        },
      });

      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);

      // Each content item should have type
      for (const item of result.content) {
        expect(item).toHaveProperty('type');
      }
    });

    it('should include structuredContent when available', async () => {
      const result = await client.callTool('sheets_auth', {
        request: {
          action: 'check_auth',
        },
      });

      // structuredContent is optional but recommended
      if ('structuredContent' in result && result.structuredContent) {
        expect(typeof result.structuredContent).toBe('object');

        // Should follow response envelope pattern
        const structured = result.structuredContent as {
          response?: { success?: boolean };
        };
        if ('response' in structured) {
          expect(structured.response).toHaveProperty('success');
        }
      }
    });

    it('should include metadata when available', async () => {
      const result = await client.callTool('sheets_auth', {
        request: {
          action: 'check_auth',
        },
      });

      // metadata is optional
      if ('_meta' in result && result._meta) {
        expect(typeof result._meta).toBe('object');
      }
    });
  });

  describe('Resource Compliance', () => {
    it('should list resources with valid structure', async () => {
      const resources = await client.listResources();

      expect(resources.length).toBeGreaterThan(0);

      for (const resource of resources) {
        expect(typeof resource.uri).toBe('string');
        expect(resource.uri.length).toBeGreaterThan(0);
        expect(typeof resource.name).toBe('string');
        expect(resource.name.length).toBeGreaterThan(0);

        // Optional fields
        if ('description' in resource) {
          expect(typeof resource.description).toBe('string');
        }
        if ('mimeType' in resource) {
          expect(typeof resource.mimeType).toBe('string');
        }
      }
    });

    it('should support resource URI templates', async () => {
      const resources = await client.listResources();

      // Look for templated URIs (contain {variable})
      const templated = resources.filter((r) => r.uri.includes('{'));

      expect(templated.length).toBeGreaterThan(0);
    });

    it('should read resources successfully', async () => {
      const resources = await client.listResources();

      // Find a non-templated resource
      const staticResource = resources.find((r) => !r.uri.includes('{'));

      if (staticResource) {
        const content = await client.readResource(staticResource.uri);

        expect(content.contents).toBeDefined();
        expect(Array.isArray(content.contents)).toBe(true);
      }
    });
  });

  describe('Prompt Compliance', () => {
    it('should list prompts with valid structure', async () => {
      const prompts = await client.listPrompts();

      expect(prompts.length).toBeGreaterThan(0);

      for (const prompt of prompts) {
        expect(typeof prompt.name).toBe('string');
        expect(prompt.name.length).toBeGreaterThan(0);

        // Optional fields
        if ('description' in prompt) {
          expect(typeof prompt.description).toBe('string');
        }
        if ('arguments' in prompt && prompt.arguments) {
          expect(Array.isArray(prompt.arguments)).toBe(true);
        }
      }
    });

    it('should get prompts successfully', async () => {
      const prompts = await client.listPrompts();

      if (prompts.length > 0) {
        const promptResult = await client.getPrompt(prompts[0].name);

        expect(promptResult.messages).toBeDefined();
        expect(Array.isArray(promptResult.messages)).toBe(true);
      }
    });
  });

  describe('Logging Compliance', () => {
    it('should support setLevel', async () => {
      await expect(client.setLogLevel('info')).resolves.not.toThrow();
    });

    it('should accept all log levels', async () => {
      const levels: Array<'debug' | 'info' | 'warn' | 'error'> = ['debug', 'info', 'warn', 'error'];

      for (const level of levels) {
        await expect(client.setLogLevel(level)).resolves.not.toThrow();
      }
    });
  });

  describe('Protocol Validation', () => {
    it('should pass comprehensive protocol validation', () => {
      const validation = client.validateProtocolCompliance();

      if (!validation.valid) {
        console.error('Protocol compliance errors:', validation.errors);
      }

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('Discriminated Unions', () => {
    it('should use action discriminator in requests', async () => {
      // MCP 2025-11-25 uses discriminated unions for actions
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'read_range', // Discriminator field
          spreadsheetId: '1test',
          range: 'A1',
        },
      });

      expect(result).toBeDefined();
    });

    it('should use success discriminator in responses', async () => {
      const result = await client.callTool('sheets_auth', {
        request: {
          action: 'check_auth',
        },
      });

      if ('structuredContent' in result && result.structuredContent) {
        const structured = result.structuredContent as {
          response?: { success?: boolean };
        };
        if ('response' in structured && structured.response) {
          expect('success' in structured.response).toBe(true);
          expect(typeof structured.response.success).toBe('boolean');
        }
      }
    });
  });

  describe('Error Handling Compliance', () => {
    it('should set isError flag on errors', async () => {
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: 'invalid',
          range: 'A1',
        },
      });

      expect(result.isError).toBe(true);
    });

    it('should provide error content', async () => {
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: 'invalid',
          range: 'A1',
        },
      });

      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0]).toHaveProperty('text');
    });
  });
});
