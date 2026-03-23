/**
 * ServalSheets - Analyze Resources
 *
 * Exposes AI analysis capabilities as MCP resources for discovery and reference.
 * Uses MCP Sampling (SEP-1577) for AI-powered analysis.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getSamplingAnalysisService } from '../services/sampling-analysis.js';
import type { AnalyzeResponse } from '../schemas/analyze.js';
import { resourceNotifications } from './notifications.js';

/**
 * In-memory store for analysis results
 * P1: Enable MCP Resources for analysis result referencing
 */
interface StoredAnalysisResult {
  id: string;
  spreadsheetId: string;
  timestamp: number;
  result: AnalyzeResponse;
  summary: string;
}

const analysisResultsStore = new Map<string, StoredAnalysisResult>();
let nextAnalysisId = 1;

/**
 * Store an analysis result for later retrieval via MCP Resources
 * Returns the analysis ID for referencing
 */
export function storeAnalysisResult(spreadsheetId: string, result: AnalyzeResponse): string {
  const id = `analysis-${nextAnalysisId++}`;
  const summary =
    result.success && 'summary' in result
      ? (result.summary ?? 'Analysis completed')
      : 'Analysis failed';

  analysisResultsStore.set(id, {
    id,
    spreadsheetId,
    timestamp: Date.now(),
    result,
    summary,
  });

  // Keep only last 100 results
  if (analysisResultsStore.size > 100) {
    const firstKey = analysisResultsStore.keys().next().value;
    if (firstKey) {
      analysisResultsStore.delete(firstKey);
    }
  }

  // Notify clients that the resource list has changed
  resourceNotifications.notifyAnalysisAdded(id);

  return id;
}

/**
 * Get a stored analysis result by ID
 */
export function getAnalysisResult(id: string): StoredAnalysisResult | undefined {
  return analysisResultsStore.get(id);
}

/**
 * List all stored analysis results
 */
export function listAnalysisResults(): StoredAnalysisResult[] {
  return Array.from(analysisResultsStore.values()).sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Register analyze resources with the MCP server
 */
export function registerAnalyzeResources(server: McpServer): number {
  const analysisService = getSamplingAnalysisService();

  // Resource 1: analyze://stats - Analysis service statistics
  server.registerResource(
    'AI Analysis Statistics',
    'analyze://stats',
    {
      description: 'AI analysis service statistics: requests, success rate, response times',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const stats = analysisService.getStats();

        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  stats: {
                    totalRequests: stats.totalRequests,
                    successfulRequests: stats.successfulRequests,
                    failedRequests: stats.failedRequests,
                    successRate: `${stats.successRate.toFixed(1)}%`,
                    avgResponseTime: `${(stats.avgResponseTime / 1000).toFixed(2)}s`,
                    requestsByType: stats.requestsByType,
                  },
                  summary: `${stats.successfulRequests}/${stats.totalRequests} analysis requests successful (${stats.successRate.toFixed(1)}% success rate)`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  error: 'Failed to fetch analysis statistics',
                  message: errorMessage,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  // Resource 2: analyze://help - Analysis capabilities documentation
  server.registerResource(
    'AI Analysis Help',
    'analyze://help',
    {
      description: 'Documentation for AI-powered data analysis using MCP Sampling',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      try {
        const helpText = `# AI Data Analysis (MCP Sampling)

## Overview
ServalSheets uses MCP Sampling (SEP-1577) for AI-powered data analysis. Instead of 
implementing custom ML/statistics, we leverage Claude's intelligence for analysis.

## How It Works
1. Claude (the LLM) orchestrates the analysis
2. The \`sheets_analyze\` tool reads your data
3. Data is sent to the LLM via MCP Sampling
4. You get intelligent, contextual analysis

## Analysis Types

### summary
Overall data summary including key statistics, data types, and notable observations.

### patterns
Identify recurring patterns, sequences, and regularities in the data.

### anomalies
Find outliers, unexpected values, missing data, and inconsistencies.

### trends
Analyze trends over time or across categories, including growth/decline patterns.

### quality
Assess data quality: completeness, consistency, accuracy, and format issues.

### correlations
Discover relationships and correlations between different columns/fields.

### recommendations
Get actionable recommendations for improving, organizing, or utilizing your data.

## Usage Examples

### Basic Analysis
\`\`\`
sheets_analyze({
  action: 'analyze_data',
  spreadsheetId: 'your-id',
  range: { a1: 'Sheet1!A1:Z100' },
  analysisTypes: ['summary', 'quality']
})
\`\`\`

### Find Anomalies
\`\`\`
sheets_analyze({
  action: 'analyze_data',
  spreadsheetId: 'your-id',
  range: { sheetName: 'Sales', range: 'A:F' },
  analysisTypes: ['anomalies', 'patterns'],
  context: 'This is monthly sales data'
})
\`\`\`

### Generate Formula
\`\`\`
sheets_analyze({
  action: 'generate_formula',
  spreadsheetId: 'your-id',
  description: 'Sum all values in column B where column A equals "Active"',
  targetCell: 'D1'
})
\`\`\`

### Chart Recommendations
\`\`\`
sheets_analyze({
  action: 'suggest_chart',
  spreadsheetId: 'your-id',
  range: { a1: 'Data!A1:D50' },
  goal: 'Show monthly trends'
})
\`\`\`

## Response Format

Analysis responses include:
- **summary**: Brief overall summary
- **analyses**: Array of findings with type, confidence, and details
- **overallQualityScore**: 0-100 quality score
- **topInsights**: Most important findings
- **recommendations**: Actionable suggestions

## Requirements
- Client must support MCP Sampling (SEP-1577)
- Data is sampled (max 100 rows × 20 cols) to fit token limits

## Why Sampling Instead of Custom ML?

1. **Better Understanding**: Claude understands context, not just numbers
2. **Flexible**: No need to pre-define analysis rules
3. **Actionable**: Recommendations in plain language
4. **Maintained**: No ML models to train/update
5. **MCP-Native**: Uses standard protocol features

## Statistics
View analysis statistics at: analyze://stats
`;

        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'text/markdown',
              text: helpText,
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'text/plain',
              text: `Error fetching analysis help: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  // Resource 3: analyze://results - List recent analysis results
  server.registerResource(
    'Analysis Results List',
    'analyze://results',
    {
      description: 'List of recent analysis results with IDs for retrieval (P1: MCP Resources)',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const results = listAnalysisResults();

        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  count: results.length,
                  results: results.map((r) => ({
                    id: r.id,
                    spreadsheetId: r.spreadsheetId,
                    timestamp: new Date(r.timestamp).toISOString(),
                    summary: r.summary,
                    success: r.result.success,
                    uri: `analyze://results/${r.id}`,
                  })),
                  usage: `Reference a specific result with: analyze://results/{id}`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  error: 'Failed to fetch analysis results list',
                  message: errorMessage,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  // Resource 4: analyze://results/{id} - Get specific analysis result
  server.registerResource(
    'Specific Analysis Result',
    'analyze://results/{id}',
    {
      description: 'Retrieve a specific analysis result by ID (P1: MCP Resources)',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const uriStr = typeof uri === 'string' ? uri : uri.toString();
        const match = uriStr.match(/analyze:\/\/results\/(.+)/);
        const id = match?.[1];

        if (!id) {
          return {
            contents: [
              {
                uri: uriStr,
                mimeType: 'application/json',
                text: JSON.stringify(
                  {
                    error: 'Invalid URI format',
                    expected: 'analyze://results/{id}',
                    received: uriStr,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = getAnalysisResult(id);

        if (!result) {
          return {
            contents: [
              {
                uri: uriStr,
                mimeType: 'application/json',
                text: JSON.stringify(
                  {
                    error: 'Analysis result not found',
                    id,
                    hint: 'Use analyze://results to list available results',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        return {
          contents: [
            {
              uri: uriStr,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  id: result.id,
                  spreadsheetId: result.spreadsheetId,
                  timestamp: new Date(result.timestamp).toISOString(),
                  result: result.result,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const uriStr = typeof uri === 'string' ? uri : uri.toString();
        return {
          contents: [
            {
              uri: uriStr,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  error: 'Failed to fetch analysis result',
                  message: errorMessage,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  console.error('[ServalSheets] Registered 4 analyze resources:');
  console.error('  - analyze://stats (analysis service statistics)');
  console.error('  - analyze://help (AI analysis documentation)');
  console.error('  - analyze://results (list recent analysis results) [P1]');
  console.error('  - analyze://results/{id} (get specific result) [P1]');

  return 4;
}
