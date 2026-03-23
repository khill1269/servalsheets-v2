import { ElicitRequestFormParamsSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import type { FormElicitParams } from '../../src/mcp/elicitation.js';

describe('elicitation schema compatibility', () => {
  it('accepts spec-compliant multi-select array fields through the official MCP SDK schema', () => {
    const requestedSchema = {
      type: 'object',
      properties: {
        labels: {
          type: 'array',
          title: 'Labels',
          description: 'Choose one or more labels to apply',
          minItems: 1,
          items: {
            type: 'string',
            enum: ['finance', 'operations', 'sales'],
          },
        },
      },
      required: ['labels'],
    } satisfies FormElicitParams['requestedSchema'];

    const parseResult = ElicitRequestFormParamsSchema.safeParse({
      message: 'Select labels',
      requestedSchema,
    });

    expect(parseResult.success).toBe(true);
  });
});
