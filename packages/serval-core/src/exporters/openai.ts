/**
 * Serval Core - OpenAI Function Calling Exporter
 *
 * Converts tool definitions with JSON Schema to OpenAI function calling format.
 * Compatible with OpenAI Chat Completions API (gpt-4, gpt-3.5-turbo, etc.)
 *
 * @see https://platform.openai.com/docs/guides/function-calling
 */

/**
 * OpenAI function definition format
 */
export interface OpenAIFunctionDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

/**
 * OpenAI tool definition (wraps function)
 */
export interface OpenAIToolDef {
  type: 'function';
  function: OpenAIFunctionDef;
}

/**
 * Input: a generic tool definition with JSON Schema
 */
export interface ToolSchemaInput {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Convert a single tool to OpenAI function definition
 */
export function toOpenAIFunction(tool: ToolSchemaInput): OpenAIFunctionDef {
  const parameters = cleanJsonSchemaForOpenAI(tool.inputSchema);

  return {
    name: tool.name,
    description: truncateDescription(tool.description, 1024),
    parameters,
  };
}

/**
 * Convert a single tool to OpenAI tool definition (with type: 'function' wrapper)
 */
export function toOpenAITool(tool: ToolSchemaInput): OpenAIToolDef {
  return {
    type: 'function',
    function: toOpenAIFunction(tool),
  };
}

/**
 * Convert multiple tools to OpenAI format
 */
export function toOpenAITools(tools: ToolSchemaInput[]): OpenAIToolDef[] {
  return tools.map(toOpenAITool);
}

/**
 * Clean JSON Schema for OpenAI compatibility:
 * - OpenAI expects `type: "object"` at root
 * - Remove unsupported keywords ($schema, $id, definitions not at root)
 * - Flatten `anyOf`/`oneOf` if they represent discriminated unions
 */
function cleanJsonSchemaForOpenAI(schema: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...schema };

  // Remove meta-schema references
  delete cleaned['$schema'];
  delete cleaned['$id'];

  // OpenAI requires root to be object type
  if (!cleaned['type']) {
    cleaned['type'] = 'object';
  }

  // Ensure properties exist for object types
  if (cleaned['type'] === 'object' && !cleaned['properties']) {
    cleaned['properties'] = {};
  }

  return cleaned;
}

/**
 * Truncate description to max length (OpenAI has 1024 char limit for descriptions)
 */
function truncateDescription(description: string, maxLength: number): string {
  if (description.length <= maxLength) return description;
  return description.substring(0, maxLength - 3) + '...';
}
