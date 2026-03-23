import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { TOOL_DEFINITIONS } from '../../src/mcp/registration/tool-definitions.js';
import { buildToolResponse } from '../../src/mcp/registration/tool-response.js';
import { zodSchemaToJsonSchema } from '../../src/utils/schema-compat.js';

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
addFormats(ajv);

function getToolDefinition(toolName: string) {
  const tool = TOOL_DEFINITIONS.find((candidate) => candidate.name === toolName);
  if (!tool) {
    throw new Error(`Tool definition not found: ${toolName}`);
  }
  return tool;
}

function expectToolOutputToValidate(toolName: string, sample: Record<string, unknown>): void {
  const tool = getToolDefinition(toolName);
  const jsonSchema = zodSchemaToJsonSchema(tool.outputSchema);
  const validate = ajv.compile(jsonSchema);

  expect(validate(sample)).toBe(true);
  if (validate.errors) {
    throw new Error(`${toolName} sample failed emitted JSON schema: ${JSON.stringify(validate.errors)}`);
  }

  const built = buildToolResponse(sample, toolName, tool.outputSchema);
  expect(validate(built.structuredContent as Record<string, unknown>)).toBe(true);
  if (validate.errors) {
    throw new Error(
      `${toolName} buildToolResponse output failed emitted JSON schema: ${JSON.stringify(validate.errors)}`
    );
  }
}

describe('Output schema JSON Schema regressions', () => {
  it('validates a representative quick_insights response', () => {
    expectToolOutputToValidate('sheets_analyze', {
      response: {
        success: true,
        action: 'quick_insights',
        stats: {
          rowCount: 3,
          columnCount: 2,
          dataTypes: ['text', 'number'],
          emptyRate: 0,
        },
        insights: ['Column B is numeric with no empty cells'],
        message: 'Quick insights generated',
      },
    });
  });

  it('validates a representative suggest_cleaning response', () => {
    expectToolOutputToValidate('sheets_fix', {
      response: {
        success: true,
        action: 'suggest_cleaning',
        mode: 'preview',
        operations: [
          {
            id: 'op-1',
            issueType: 'NO_FROZEN_HEADERS',
            tool: 'sheets_dimensions',
            action: 'freeze',
            parameters: {
              spreadsheetId: 'ss-1',
              frozenRowCount: 1,
            },
            estimatedImpact: 'Freeze the header row for easier review',
            risk: 'low',
          },
        ],
        summary: {
          total: 1,
        },
        recommendations: [
          {
            id: 'rec-1',
            title: 'Normalize email casing',
            description: 'Lowercase email addresses before downstream joins',
            column: 'D',
            issueCount: 3,
            severity: 'medium',
            suggestedRule: 'lowercase_email',
            sampleBefore: ['Alice@Example.COM', 'BOB@example.com'],
            sampleAfter: ['alice@example.com', 'bob@example.com'],
          },
        ],
        dataProfile: {
          totalRows: 25,
          totalColumns: 4,
          nullRate: 0.08,
          columnProfiles: [
            {
              column: 'D',
              header: 'Email',
              type: 'text',
              nullCount: 0,
              uniqueCount: 24,
              sampleValues: ['alice@example.com', 'bob@example.com'],
            },
          ],
        },
        message: '1 cleaning recommendation generated',
      },
    });
  });

  it('validates a representative model_scenario response', () => {
    expectToolOutputToValidate('sheets_dependencies', {
      response: {
        success: true,
        data: {
          action: 'model_scenario',
          inputChanges: [
            {
              cell: 'Sheet1!B2',
              from: 95,
              to: 100,
            },
          ],
          cascadeEffects: [
            {
              cell: 'Sheet1!C2',
              formula: '=B2*1.1',
              currentValue: 110,
              affectedBy: ['Sheet1!B2'],
            },
          ],
          summary: {
            cellsAffected: 1,
            message: 'Scenario affected 1 downstream cell',
          },
        },
      },
    });
  });

  it('validates a representative templates.create response', () => {
    expectToolOutputToValidate('sheets_templates', {
      response: {
        success: true,
        action: 'create',
        template: {
          id: 'tpl-1',
          name: 'Budget Template',
          description: 'Monthly budget planning template',
          category: 'finance',
          version: '1.0.0',
          created: '2026-03-17T10:00:00.000Z',
          updated: '2026-03-17T10:00:00.000Z',
          sheets: [
            {
              name: 'Summary',
              headers: ['Month', 'Budget', 'Actual'],
              rowCount: 12,
              columnCount: 3,
              frozenRowCount: 1,
            },
          ],
        },
      },
    });
  });
});
