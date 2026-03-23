/**
 * Serval Core - REST API / JSON Schema Exporter
 *
 * Exports tool definitions as a generic REST API specification.
 * Useful for non-MCP consumers that want to call Serval over HTTP.
 *
 * Output format is a lightweight JSON Schema-based API spec
 * (not full OpenAPI, but easily convertible to it).
 */

/**
 * REST endpoint definition
 */
export interface RESTEndpointDef {
  path: string;
  method: 'POST';
  operationId: string;
  summary: string;
  description: string;
  requestBody: {
    contentType: 'application/json';
    schema: Record<string, unknown>;
  };
  responseBody?: {
    contentType: 'application/json';
    schema: Record<string, unknown>;
  };
}

/**
 * Complete REST API specification
 */
export interface RESTApiSpec {
  info: {
    title: string;
    version: string;
    description: string;
  };
  basePath: string;
  endpoints: RESTEndpointDef[];
}

/**
 * Input: a generic tool definition with JSON Schema
 */
export interface ToolSchemaInput {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

/**
 * Convert a single tool to REST endpoint definition
 */
export function toRESTEndpoint(tool: ToolSchemaInput, basePath: string = '/api/v1'): RESTEndpointDef {
  const path = `${basePath}/tools/${tool.name}`;

  return {
    path,
    method: 'POST',
    operationId: tool.name,
    summary: extractSummary(tool.description),
    description: tool.description,
    requestBody: {
      contentType: 'application/json',
      schema: tool.inputSchema,
    },
    responseBody: tool.outputSchema
      ? {
          contentType: 'application/json',
          schema: tool.outputSchema,
        }
      : undefined,
  };
}

/**
 * Convert multiple tools to a complete REST API specification
 */
export function toRESTApiSpec(
  tools: ToolSchemaInput[],
  options: {
    title?: string;
    version?: string;
    description?: string;
    basePath?: string;
  } = {}
): RESTApiSpec {
  const basePath = options.basePath ?? '/api/v1';

  return {
    info: {
      title: options.title ?? 'Serval API',
      version: options.version ?? '1.0.0',
      description: options.description ?? 'Serval spreadsheet operations API',
    },
    basePath,
    endpoints: tools.map((tool) => toRESTEndpoint(tool, basePath)),
  };
}

/**
 * Convert REST API spec to OpenAPI 3.0 format
 */
export function toOpenAPI(spec: RESTApiSpec): Record<string, unknown> {
  const paths: Record<string, unknown> = {};

  for (const endpoint of spec.endpoints) {
    const pathItem: Record<string, unknown> = {
      post: {
        operationId: endpoint.operationId,
        summary: endpoint.summary,
        description: endpoint.description,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: endpoint.requestBody.schema,
            },
          },
        },
        responses: {
          '200': {
            description: 'Successful operation',
            content: endpoint.responseBody
              ? {
                  'application/json': {
                    schema: endpoint.responseBody.schema,
                  },
                }
              : undefined,
          },
          '400': { description: 'Invalid input' },
          '401': { description: 'Authentication required' },
          '429': { description: 'Rate limit exceeded' },
          '500': { description: 'Internal server error' },
        },
      },
    };

    paths[endpoint.path] = pathItem;
  }

  return {
    openapi: '3.0.3',
    info: spec.info,
    paths,
  };
}

/**
 * Extract first sentence as summary
 */
function extractSummary(description: string): string {
  const firstLine = description.split('\n')[0] ?? description;
  const firstSentence = firstLine.split('.')[0] ?? firstLine;
  return firstSentence.trim().substring(0, 200);
}
