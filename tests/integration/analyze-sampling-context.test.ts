import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  createServalSheetsTestHarness,
  type McpTestHarness,
} from '../helpers/mcp-test-harness.js';

const {
  mockSheetsValuesGet,
  mockSheetsValuesUpdate,
  mockCreateGoogleApiClient,
  fakeGoogleClient,
  resetSheetStore,
  seedRange,
} = vi.hoisted(() => {
  const sheetStore = new Map<string, unknown[][]>();
  const normalizeRange = (range: string): string => range.replace(/'([^']+)'!/g, '$1!');
  const cloneValues = (values: unknown[][]): unknown[][] =>
    values.map((row) => [...row]);
  const valuesGet = vi.fn(async (request: { range: string }) => {
    const normalizedRange = normalizeRange(request.range);
    const values = sheetStore.get(normalizedRange) ?? [];
    return {
      data: {
        range: request.range,
        values: cloneValues(values),
        majorDimension: 'ROWS',
      },
    };
  });
  const valuesUpdate = vi.fn(
    async (request: { range: string; requestBody?: { values?: unknown[][] } }) => {
      const normalizedRange = normalizeRange(request.range);
      const values = cloneValues(request.requestBody?.values ?? []);
      sheetStore.set(normalizedRange, values);

      return {
        data: {
          updatedCells: values.reduce((sum, row) => sum + row.length, 0),
          updatedRows: values.length,
          updatedColumns: values.length > 0 ? Math.max(...values.map((row) => row.length)) : 0,
          updatedRange: request.range,
        },
      };
    }
  );
  const spreadsheetsGet = vi.fn(async () => ({
    data: {
      sheets: [
        {
          properties: {
            sheetId: 0,
            title: 'Sheet1',
          },
        },
      ],
      namedRanges: [],
    },
  }));
  const client = {
    authType: 'access_token',
    sheets: {
      spreadsheets: {
        values: {
          get: valuesGet,
          update: valuesUpdate,
          batchGet: vi.fn(),
          batchUpdate: vi.fn(),
          append: vi.fn(),
          clear: vi.fn(),
        },
        get: spreadsheetsGet,
        batchUpdate: vi.fn(),
      },
    },
    drive: {
      files: {
        get: vi.fn(),
        list: vi.fn(),
      },
    },
    bigquery: undefined,
    hasElevatedAccess: true,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    getTokenStatus: vi.fn(() => ({
      hasAccessToken: true,
      hasRefreshToken: false,
      expiryDate: Date.now() + 60_000,
    })),
    validateToken: vi.fn(async () => ({ valid: true })),
  };

  return {
    mockSheetsValuesGet: valuesGet,
    mockSheetsValuesUpdate: valuesUpdate,
    mockCreateGoogleApiClient: vi.fn(async () => client),
    fakeGoogleClient: client,
    resetSheetStore: () => sheetStore.clear(),
    seedRange: (range: string, values: unknown[][]) => {
      sheetStore.set(normalizeRange(range), cloneValues(values));
    },
  };
});

vi.mock('../../src/services/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/index.js')>(
    '../../src/services/index.js'
  );

  return {
    ...actual,
    SnapshotService: class MockSnapshotService {
      constructor(_options: unknown) {}
    },
    createGoogleApiClient: mockCreateGoogleApiClient,
    GoogleApiClient: class MockGoogleApiClient {},
  };
});

vi.mock('../../src/startup/performance-init.js', () => ({
  initializePerformanceOptimizations: vi.fn(async () => ({
    batchingSystem: undefined,
    cachedSheetsApi: {},
    requestMerger: undefined,
    parallelExecutor: {},
    prefetchPredictor: {},
    accessPatternTracker: {},
    queryOptimizer: {},
    prefetchingSystem: {},
  })),
}));

vi.mock('../../src/adapters/index.js', () => ({
  GoogleSheetsBackend: class MockGoogleSheetsBackend {
    constructor(_client: unknown) {}
    async initialize(): Promise<void> {}
  },
}));

vi.mock('../../src/services/transaction-manager.js', () => ({
  initTransactionManager: vi.fn(),
  getTransactionManager: vi.fn(() => ({
    getStats: () => ({
      totalTransactions: 0,
      successfulTransactions: 0,
      failedTransactions: 0,
      rolledBackTransactions: 0,
      successRate: 0,
      avgTransactionDuration: 0,
      avgOperationsPerTransaction: 0,
      apiCallsSaved: 0,
      snapshotsCreated: 0,
      activeTransactions: 0,
      totalDataProcessed: 0,
    }),
  })),
}));

vi.mock('../../src/services/conflict-detector.js', () => ({
  initConflictDetector: vi.fn(),
  getConflictDetector: vi.fn(() => ({
    getStats: () => ({
      totalChecks: 0,
      conflictsDetected: 0,
      conflictsResolved: 0,
      conflictsAutoResolved: 0,
      conflictsManuallyResolved: 0,
      detectionRate: 0,
      resolutionSuccessRate: 0,
      avgResolutionTime: 0,
      resolutionsByStrategy: {},
      cacheHitRate: 0,
      versionsTracked: 0,
    }),
  })),
}));

vi.mock('../../src/services/impact-analyzer.js', () => ({
  initImpactAnalyzer: vi.fn(),
  getImpactAnalyzer: vi.fn(() => ({
    getStats: () => ({
      totalAnalyses: 0,
      operationsPrevented: 0,
      avgAnalysisTime: 0,
      totalWarnings: 0,
      warningsBySeverity: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      },
    }),
  })),
}));

vi.mock('../../src/services/validation-engine.js', () => ({
  initValidationEngine: vi.fn(),
  getValidationEngine: vi.fn(() => ({
    getStats: () => ({
      totalValidations: 0,
      passedValidations: 0,
      failedValidations: 0,
      successRate: 0,
      avgValidationTime: 0,
      errorsByType: {},
      errorsBySeverity: {},
      cacheHitRate: 0,
    }),
  })),
}));

vi.mock('../../src/services/webhook-queue.js', () => ({
  initWebhookQueue: vi.fn(),
}));

vi.mock('../../src/services/webhook-manager.js', () => ({
  initWebhookManager: vi.fn(),
}));

describe('MCP analyze sampling context integration', () => {
  let harness: McpTestHarness;
  let samplingPrompts: string[];

  beforeAll(async () => {
    harness = await createServalSheetsTestHarness({
      serverOptions: {
        name: 'servalsheets-sampling-test',
        version: '1.0.0-test',
        googleApiOptions: {
          accessToken: 'test-access-token',
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        },
      },
      clientCapabilities: {
        sampling: {},
      },
    });
  });

  beforeEach(() => {
    samplingPrompts = [];
    vi.clearAllMocks();
    resetSheetStore();
    seedRange('Sheet1!A1:C4', [
      ['Product', 'Region', 'Sales'],
      ['Widget', 'East', '10'],
      ['Widget', 'West', '20'],
      ['Gadget', 'East', '30'],
    ]);

    mockCreateGoogleApiClient.mockResolvedValue(fakeGoogleClient);

    harness.client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
      const firstMessage = request.params.messages[0];
      const content = firstMessage?.content;
      const prompt =
        content && typeof content === 'object' && !Array.isArray(content) && content.type === 'text'
          ? content.text
          : '';

      samplingPrompts.push(prompt);

      return {
        model: 'mock-sampling-model',
        role: 'assistant',
        content: {
          type: 'text',
          text: JSON.stringify({
            formula: '=SUM(C2,C3,C4)',
            explanation: 'Sums the sales values from the sampled rows in column C.',
            assumptions: ['Sales values are in the third column'],
            alternatives: [{ formula: '=C2+C3+C4', useCase: 'Simple inline fallback' }],
            tips: ['Replace the fixed cell list with a dynamic range if the table will grow.'],
          }),
        },
      };
    });
  });

  afterAll(async () => {
    if (harness) {
      await harness.close();
    }
  });

  it('passes spreadsheet headers, sample rows, and target cell into formula sampling prompts', async () => {
    const result = await harness.client.callTool({
      name: 'sheets_analyze',
      arguments: {
        request: {
          action: 'generate_formula',
          spreadsheetId: 'spreadsheet-123',
          description: 'Calculate the total sales for the rows shown',
          range: 'Sheet1!A1:C4',
          targetCell: 'D2',
        },
      },
    });

    const response = result.structuredContent as {
      response?: {
        success?: boolean;
        action?: string;
        formula?: {
          formula?: string;
          explanation?: string;
        };
      };
    };

    expect(mockSheetsValuesGet).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: 'spreadsheet-123',
        range: 'Sheet1!A1:C4',
        valueRenderOption: 'FORMATTED_VALUE',
      })
    );
    expect(samplingPrompts).toHaveLength(1);
    expect(samplingPrompts[0]).toContain('Calculate the total sales for the rows shown');
    expect(samplingPrompts[0]).toContain('Headers:** Product, Region, Sales');
    expect(samplingPrompts[0]).toContain('Target cell:** D2');
    expect(samplingPrompts[0]).toContain('"Widget"');
    expect(samplingPrompts[0]).toContain('"30"');
    expect(response.response).toMatchObject({
      success: true,
      action: 'generate_formula',
      formula: {
        formula: '=SUM(C2,C3,C4)',
        explanation: 'Sums the sales values from the sampled rows in column C.',
      },
    });
  });

  it(
    'supports a chained write, formula generation, and compute evaluation workflow over MCP',
    async () => {
      const writeResult = await harness.client.callTool({
        name: 'sheets_data',
        arguments: {
          request: {
            action: 'write',
            spreadsheetId: 'spreadsheet-123',
            range: 'Sheet1!A1:C4',
            values: [
              ['Product', 'Region', 'Sales'],
              ['Widget', 'East', '10'],
              ['Widget', 'West', '20'],
              ['Gadget', 'East', '30'],
            ],
          },
        },
      });

      const writeResponse = writeResult.structuredContent as {
        response?: {
          success?: boolean;
          action?: string;
          updatedCells?: number;
          updatedRange?: string;
        };
      };

      expect(writeResponse.response).toMatchObject({
        success: true,
        action: 'write',
        updatedCells: 12,
        updatedRange: 'Sheet1!A1:C4',
      });

      const generated = await harness.client.callTool({
        name: 'sheets_analyze',
        arguments: {
          request: {
            action: 'generate_formula',
            spreadsheetId: 'spreadsheet-123',
            description: 'Calculate the total sales for the rows shown',
            range: 'Sheet1!A1:C4',
            targetCell: 'D2',
          },
        },
      });

      const generatedResponse = generated.structuredContent as {
        response?: {
          formula?: {
            formula?: string;
          };
        };
      };
      const formula = generatedResponse.response?.formula?.formula;

      expect(formula).toBe('=SUM(C2,C3,C4)');

      const evaluated = await harness.client.callTool({
        name: 'sheets_compute',
        arguments: {
          request: {
            action: 'evaluate',
            spreadsheetId: 'spreadsheet-123',
            formula,
            range: 'Sheet1!A1:C4',
          },
        },
      });

      const evaluatedResponse = evaluated.structuredContent as {
        response?: {
          success?: boolean;
          action?: string;
          result?: unknown;
        };
      };

      expect(mockSheetsValuesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'spreadsheet-123',
          range: 'Sheet1!A1:C4',
        })
      );
      expect(mockSheetsValuesGet).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'spreadsheet-123',
          range: 'Sheet1!A1:C4',
        })
      );
      expect(evaluatedResponse.response).toMatchObject({
        success: true,
        action: 'evaluate',
        result: 60,
      });
    },
    30_000
  );
});
