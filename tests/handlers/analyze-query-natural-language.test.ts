import { describe, expect, it, vi } from 'vitest';
import { handleQueryNaturalLanguageAction } from '../../src/handlers/analyze-actions/query-natural-language.js';

describe('query_natural_language action', () => {
  it('honors an explicit range and uses header rows for schema inference', async () => {
    const createMessage = vi.fn().mockResolvedValue({
      content: {
        type: 'text',
        text: JSON.stringify({
          answer: 'Total revenue is 300.',
          followUpQuestions: [],
        }),
      },
    });
    const sheetsApi = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({
          data: {
            spreadsheetId: 'sheet-123',
            properties: { title: 'Quarterly Metrics' },
            sheets: [
              {
                properties: {
                  sheetId: 1,
                  title: 'Summary',
                  index: 0,
                  gridProperties: { rowCount: 100, columnCount: 10 },
                },
              },
              {
                properties: {
                  sheetId: 2,
                  title: 'Revenue',
                  index: 1,
                  gridProperties: { rowCount: 50, columnCount: 2 },
                },
              },
            ],
          },
        }),
        values: {
          get: vi.fn().mockResolvedValue({
            data: {
              values: [
                ['Revenue', 'Cost'],
                [100, 40],
                [200, 80],
              ],
            },
          }),
        },
      },
    } as any;

    const result = await handleQueryNaturalLanguageAction(
      {
        spreadsheetId: 'sheet-123',
        query: 'What is the total Revenue?',
        range: 'Revenue!A1:B3',
      },
      {
        checkSamplingCapability: vi.fn().mockResolvedValue(null),
        server: {
          createMessage,
        } as any,
        sheetsApi,
        sessionContext: {
          understandingStore: {
            getSummary: vi.fn().mockReturnValue({
              spreadsheetId: 'sheet-123',
              title: 'Quarterly Metrics',
              inferredPurpose: 'budget',
              domain: 'finance',
              userIntent: 'track revenue',
              confidenceScore: 88,
              confidenceLevel: 'high',
              topGaps: ['Confirm expense categories'],
              activeHypotheses: [],
              interactionCount: 2,
              maxTierReached: 4,
            }),
            get: vi.fn().mockReturnValue({
              semanticIndex: {
                workbookType: 'report',
                workbookTypeConfidence: 91,
                suggestedOperations: ['aggregate', 'pivot_compute'],
              },
            }),
          },
        } as any,
      }
    );

    expect(result.success).toBe(true);
    expect(sheetsApi.spreadsheets.values.get).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-123',
      range: 'Revenue!A1:B3',
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('Workbook Understanding'),
      })
    );
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('Business domain: finance.'),
      })
    );
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('Likely useful operations: aggregate, pivot_compute.'),
      })
    );
    if (result.success) {
      expect(result.queryResult?.intent.type).toBe('AGGREGATE');
      expect(result.queryResult?.answer).toContain('300');
    }
  });

  it('allows broad natural-language questions without exact column-name matches', async () => {
    const createMessage = vi.fn().mockResolvedValue({
      content: {
        type: 'text',
        text: JSON.stringify({
          answer: 'Revenue is increasing while costs remain stable.',
          followUpQuestions: [],
        }),
      },
    });
    const sheetsApi = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({
          data: {
            spreadsheetId: 'sheet-123',
            properties: { title: 'Quarterly Metrics' },
            sheets: [
              {
                properties: {
                  sheetId: 1,
                  title: 'Summary',
                  index: 0,
                  gridProperties: { rowCount: 100, columnCount: 10 },
                },
              },
            ],
          },
        }),
        values: {
          get: vi.fn().mockResolvedValue({
            data: {
              values: [
                ['Revenue', 'Cost'],
                [100, 40],
                [200, 80],
              ],
            },
          }),
        },
      },
    } as any;

    const result = await handleQueryNaturalLanguageAction(
      {
        spreadsheetId: 'sheet-123',
        query: 'What trends do you see here?',
        range: 'Summary!A1:B3',
      },
      {
        checkSamplingCapability: vi.fn().mockResolvedValue(null),
        server: {
          createMessage,
        } as any,
        sheetsApi,
      }
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.queryResult?.answer).toContain('Revenue is increasing');
    }
  });
});
