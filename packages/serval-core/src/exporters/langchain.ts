/**
 * Serval Core - LangChain Tool Exporter
 *
 * Converts tool definitions with JSON Schema to LangChain tool format.
 * Compatible with LangChain's StructuredTool and tool() helper.
 *
 * @see https://js.langchain.com/docs/how_to/custom_tools
 */

/**
 * LangChain tool definition
 * Compatible with LangChain's DynamicStructuredTool constructor args
 */
export interface LangChainToolDef {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  /** Metadata for LangChain tool categorization */
  metadata?: {
    category?: string;
    tags?: string[];
    returnDirect?: boolean;
  };
}

/**
 * Input: a generic tool definition with JSON Schema
 */
export interface ToolSchemaInput {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  metadata?: {
    category?: string;
    tags?: string[];
  };
}

/**
 * Convert a single tool to LangChain tool definition
 */
export function toLangChainTool(tool: ToolSchemaInput): LangChainToolDef {
  return {
    name: tool.name,
    description: tool.description,
    schema: cleanJsonSchemaForLangChain(tool.inputSchema),
    metadata: tool.metadata
      ? {
          category: tool.metadata.category,
          tags: tool.metadata.tags,
        }
      : undefined,
  };
}

/**
 * Convert multiple tools to LangChain format
 */
export function toLangChainTools(tools: ToolSchemaInput[]): LangChainToolDef[] {
  return tools.map(toLangChainTool);
}

/**
 * Generate LangChain tool registration code (TypeScript)
 *
 * Produces code that can be used with LangChain's DynamicStructuredTool
 */
export function generateLangChainCode(tools: ToolSchemaInput[], callbackFn: string = 'executeServalTool'): string {
  const imports = `import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';`;

  const toolDefs = tools.map((tool) => {
    const schemaJson = JSON.stringify(tool.inputSchema, null, 2);
    return `new DynamicStructuredTool({
  name: '${tool.name}',
  description: ${JSON.stringify(tool.description)},
  schema: z.any(), // Use JSON Schema: ${schemaJson.substring(0, 100)}...
  func: async (input) => ${callbackFn}('${tool.name}', input),
})`;
  });

  return `${imports}\n\nexport const servalTools = [\n  ${toolDefs.join(',\n  ')}\n];\n`;
}

/**
 * Clean JSON Schema for LangChain compatibility
 */
function cleanJsonSchemaForLangChain(schema: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...schema };

  // Remove meta-schema references that LangChain doesn't use
  delete cleaned['$schema'];
  delete cleaned['$id'];

  return cleaned;
}
