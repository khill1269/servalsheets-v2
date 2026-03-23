/**
 * Serval Core - Multi-LLM Schema Exporters
 *
 * Export tool definitions in multiple formats:
 * - OpenAI function calling (Chat Completions API)
 * - LangChain (DynamicStructuredTool)
 * - REST / OpenAPI (generic HTTP consumers)
 */

// OpenAI
export {
  toOpenAIFunction,
  toOpenAITool,
  toOpenAITools,
  type OpenAIFunctionDef,
  type OpenAIToolDef,
} from './openai.js';

// LangChain
export {
  toLangChainTool,
  toLangChainTools,
  generateLangChainCode,
  type LangChainToolDef,
} from './langchain.js';

// REST / OpenAPI
export {
  toRESTEndpoint,
  toRESTApiSpec,
  toOpenAPI,
  type RESTEndpointDef,
  type RESTApiSpec,
} from './rest.js';
