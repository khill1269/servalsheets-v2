/**
 * SamplingAnalysisService
 *
 * @purpose Leverages MCP Sampling (SEP-1577) for AI-powered data analysis instead of custom ML; LLM analyzes patterns, outliers, insights
 * @category Core
 * @usage Use for sheets_analyze tool; sends data samples to LLM via Sampling API, receives structured analysis (trends, recommendations)
 * @dependencies MCP SDK (Sampling capability), logger
 * @stateful No - stateless analysis service; each request is independent
 * @singleton No - can be instantiated per analysis request
 *
 * @example
 * const service = new SamplingAnalysisService(mcpClient);
 * const analysis = await service.analyze({ type: 'pattern_detection', data: values, prompt: 'Find sales trends' });
 * // { patterns: [...], insights: [...], recommendations: [...], confidence: 0.92 }
 */

import { ServiceError } from '../core/errors.js';

/**
 * Analysis type options
 */
export type AnalysisType =
  | 'summary'
  | 'patterns'
  | 'anomalies'
  | 'trends'
  | 'quality'
  | 'correlations'
  | 'recommendations';

/**
 * Request for AI-powered analysis
 */
export interface AnalysisRequest {
  /** Spreadsheet ID */
  spreadsheetId: string;
  /** Sheet name (optional) */
  sheetName?: string;
  /** Range in A1 notation (optional) */
  range?: string;
  /** Types of analysis to perform */
  analysisTypes: AnalysisType[];
  /** Additional context for the analysis */
  context?: string;
  /** Maximum tokens for response */
  maxTokens?: number;
}

/**
 * Sampling message for MCP
 */
export interface SamplingMessage {
  role: 'user' | 'assistant';
  content: {
    type: 'text';
    text: string;
  };
}

/**
 * Sampling request parameters
 */
export interface SamplingRequest {
  messages: SamplingMessage[];
  systemPrompt?: string;
  modelPreferences?: {
    hints?: Array<{ name: string }>;
    intelligencePriority?: number;
    speedPriority?: number;
  };
  maxTokens: number;
  // MCP 2025-11-25 soft-deprecates includeContext hints; omit by default unless
  // the caller has verified the client advertises sampling.context support.
  includeContext?: 'none' | 'thisServer' | 'allServers';
}

/**
 * Build a sampling request for data analysis
 */
export function buildAnalysisSamplingRequest(
  data: unknown[][],
  request: AnalysisRequest
): SamplingRequest {
  const analysisTypeDescriptions: Record<AnalysisType, string> = {
    summary:
      'Provide a comprehensive summary of the data including key statistics, data types, and notable observations.',
    patterns: 'Identify recurring patterns, sequences, and regularities in the data.',
    anomalies: 'Find outliers, unexpected values, missing data, and inconsistencies.',
    trends: 'Analyze trends over time or across categories, including growth/decline patterns.',
    quality:
      'Assess data quality including completeness, consistency, accuracy, and format issues.',
    correlations: 'Discover relationships and correlations between different columns/fields.',
    recommendations:
      'Provide actionable recommendations for improving, organizing, or utilizing this data.',
  };

  const requestedAnalyses = request.analysisTypes
    .map((type) => `- **${type}**: ${analysisTypeDescriptions[type]}`)
    .join('\n');

  const contextInfo = request.context ? `\n\nAdditional context: ${request.context}` : '';
  const locationInfo = request.sheetName
    ? `Sheet: ${request.sheetName}${request.range ? `, Range: ${request.range}` : ''}`
    : request.range
      ? `Range: ${request.range}`
      : 'Entire spreadsheet';

  // Prepare data sample (limit to avoid token overflow)
  const maxRows = 100;
  const maxCols = 20;
  const dataSample = data.slice(0, maxRows).map((row) => row.slice(0, maxCols));
  const truncatedNote =
    data.length > maxRows || (data[0] && data[0].length > maxCols)
      ? `\n\n*Note: Data truncated from ${data.length} rows × ${data[0]?.length ?? 0} cols to ${dataSample.length} rows × ${dataSample[0]?.length ?? 0} cols for analysis.*`
      : '';

  const prompt = `Analyze the following spreadsheet data and provide insights.

**Location:** ${locationInfo}
**Spreadsheet ID:** ${request.spreadsheetId}

**Requested Analyses:**
${requestedAnalyses}
${contextInfo}

**Data:**
\`\`\`json
${JSON.stringify(dataSample, null, 2)}
\`\`\`
${truncatedNote}

Please provide your analysis in a structured format with clear sections for each requested analysis type. Include:
1. Key findings with specific examples from the data
2. Confidence level (high/medium/low) for each finding
3. Specific cell references or values when relevant
4. Actionable recommendations where applicable

Format your response as JSON with this structure:
{
  "summary": "Brief overall summary",
  "analyses": [
    {
      "type": "analysis_type",
      "confidence": "high|medium|low",
      "findings": ["finding1", "finding2"],
      "details": "Detailed explanation",
      "affectedCells": ["A1", "B2:B10"],
      "recommendations": ["recommendation1"]
    }
  ],
  "overallQualityScore": 0-100,
  "topInsights": ["Most important insight 1", "Most important insight 2", "Most important insight 3"]
}`;

  return {
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: prompt,
        },
      },
    ],
    systemPrompt: `You are an expert data analyst specializing in spreadsheet data analysis. You provide clear, actionable insights based on the data provided. Always be specific, cite examples from the data, and indicate your confidence level. Focus on practical findings that help users understand and improve their data.

Always respond in this JSON schema:
{ "summary": string, "findings": [{"type": string, "severity": "critical"|"high"|"medium"|"low", "location": string, "description": string, "recommendation": string}], "confidence": number }

Example finding: "Column B (Revenue) has 3 null values in rows 14, 27, 31 (4.2% of 71 rows). These are likely missing transactions. Use sheets_fix.fill_missing with strategy:'mean' to impute."`,
    modelPreferences: {
      hints: [{ name: 'claude-3-sonnet' }],
      intelligencePriority: 0.8,
      speedPriority: 0.5,
    },
    maxTokens: request.maxTokens ?? 4096,
    includeContext: 'thisServer' as const,
  };
}

/**
 * Build a sampling request for formula generation
 */
export function buildFormulaSamplingRequest(
  description: string,
  context: {
    headers?: string[];
    sampleData?: unknown[][];
    targetCell?: string;
    sheetName?: string;
  }
): SamplingRequest {
  const headerInfo = context.headers ? `\n**Headers:** ${context.headers.join(', ')}` : '';
  const sampleInfo = context.sampleData
    ? `\n**Sample data:**\n\`\`\`json\n${JSON.stringify(context.sampleData.slice(0, 5), null, 2)}\n\`\`\``
    : '';
  const targetInfo = context.targetCell ? `\n**Target cell:** ${context.targetCell}` : '';
  const sheetInfo = context.sheetName ? `\n**Sheet:** ${context.sheetName}` : '';

  // Inject relevant formula patterns as examples for the LLM
  let patternExamplesText = '';
  try {
    // Dynamic import to avoid circular deps at module load time
    const { extractFormulaKeywords, getRelevantPatterns } =
      require('../analysis/formula-helpers.js') as typeof import('../analysis/formula-helpers.js');
    const keywords = extractFormulaKeywords(description);
    const relevantPatterns = getRelevantPatterns(keywords);
    if (relevantPatterns.length > 0) {
      patternExamplesText =
        '\n\n**Relevant formula patterns for reference:**\n' +
        relevantPatterns
          .map((p) => `Pattern: ${p.template}\nExample: ${p.example}\nUse case: ${p.description}`)
          .join('\n\n');
    }
  } catch {
    // Pattern injection is best-effort; never block formula generation
  }

  const prompt = `Generate a Google Sheets formula for the following requirement:

**Requirement:** ${description}
${sheetInfo}${headerInfo}${targetInfo}${sampleInfo}${patternExamplesText}

Please provide:
1. The formula
2. Explanation of how it works
3. Any assumptions made
4. Alternative approaches if applicable

Format your response as JSON:
{
  "formula": "=YOUR_FORMULA_HERE",
  "explanation": "How the formula works",
  "assumptions": ["assumption1", "assumption2"],
  "alternatives": [
    {
      "formula": "=ALTERNATIVE",
      "useCase": "When to use this instead"
    }
  ],
  "tips": ["Helpful tip 1"]
}`;

  return {
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: prompt,
        },
      },
    ],
    systemPrompt: `You are an expert in Google Sheets formulas. You create efficient, accurate formulas and explain them clearly. Always consider edge cases and provide alternatives when appropriate.`,
    modelPreferences: {
      hints: [{ name: 'claude-3-sonnet' }],
      intelligencePriority: 0.9,
      speedPriority: 0.5,
    },
    maxTokens: 2048,
  };
}

/**
 * Build a sampling request for chart recommendations
 */
export function buildChartSamplingRequest(
  data: unknown[][],
  context: {
    goal?: string;
    dataDescription?: string;
    preferredTypes?: string[];
  }
): SamplingRequest {
  const goalInfo = context.goal ? `\n**Goal:** ${context.goal}` : '';
  const descInfo = context.dataDescription
    ? `\n**Data description:** ${context.dataDescription}`
    : '';
  const prefInfo = context.preferredTypes?.length
    ? `\n**Preferred chart types:** ${context.preferredTypes.join(', ')}`
    : '';

  // Sample the data
  const dataSample = data.slice(0, 20).map((row) => row.slice(0, 10));

  const prompt = `Recommend the best chart type(s) for visualizing this data:
${goalInfo}${descInfo}${prefInfo}

**Data sample:**
\`\`\`json
${JSON.stringify(dataSample, null, 2)}
\`\`\`

Please provide:
1. Top 3 chart type recommendations ranked by suitability
2. Explanation of why each is suitable
3. Specific configuration recommendations
4. What insights each chart type would reveal

Format your response as JSON:
{
  "recommendations": [
    {
      "chartType": "COLUMN|LINE|PIE|SCATTER|AREA|BAR|COMBO",
      "suitabilityScore": 0-100,
      "reasoning": "Why this chart type is suitable",
      "configuration": {
        "categories": "column index or name for categories",
        "series": ["column indices or names for series"],
        "stacked": true|false,
        "title": "Suggested title"
      },
      "insights": ["What insight this reveals"]
    }
  ],
  "dataAssessment": {
    "dataType": "time-series|categorical|numerical|mixed",
    "rowCount": number,
    "columnCount": number,
    "hasHeaders": true|false
  }
}`;

  return {
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: prompt,
        },
      },
    ],
    systemPrompt: `You are a data visualization expert. You recommend the most effective chart types based on data characteristics and visualization goals. Consider data types, relationships, and the story the data tells.`,
    modelPreferences: {
      hints: [{ name: 'claude-3-sonnet' }],
      intelligencePriority: 0.7,
      speedPriority: 0.6,
    },
    maxTokens: 2048,
  };
}

/**
 * Parse sampling response into structured analysis result
 */
export function parseAnalysisResponse(responseText: string): {
  success: boolean;
  result?: {
    summary: string;
    analyses: Array<{
      type: string;
      confidence: string;
      findings: string[];
      details: string;
      affectedCells?: string[];
      recommendations?: string[];
    }>;
    overallQualityScore: number;
    topInsights: string[];
  };
  error?: string;
} {
  try {
    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        success: false,
        error: 'No JSON found in response',
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      success: true,
      result: parsed,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to parse response: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Statistics for sampling analysis
 */
export interface SamplingAnalysisStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  avgResponseTime: number;
  requestsByType: Record<AnalysisType, number>;
}

/**
 * Sampling Analysis Service
 *
 * Manages AI-powered analysis via MCP Sampling.
 * This service builds requests but does NOT execute them -
 * the handler uses the MCP client's sampling capability.
 */
class SamplingAnalysisService {
  private stats: SamplingAnalysisStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    successRate: 0,
    avgResponseTime: 0,
    requestsByType: {
      summary: 0,
      patterns: 0,
      anomalies: 0,
      trends: 0,
      quality: 0,
      correlations: 0,
      recommendations: 0,
    },
  };

  private responseTimes: number[] = [];
  private readonly maxResponseTimeHistory = 100;

  /**
   * Record a successful request
   */
  recordSuccess(analysisTypes: AnalysisType[], responseTime: number): void {
    this.stats.totalRequests++;
    this.stats.successfulRequests++;
    this.recordResponseTime(responseTime);

    for (const type of analysisTypes) {
      this.stats.requestsByType[type]++;
    }

    this.updateSuccessRate();
  }

  /**
   * Record a failed request
   */
  recordFailure(analysisTypes: AnalysisType[]): void {
    this.stats.totalRequests++;
    this.stats.failedRequests++;

    for (const type of analysisTypes) {
      this.stats.requestsByType[type]++;
    }

    this.updateSuccessRate();
  }

  /**
   * Record response time
   */
  private recordResponseTime(time: number): void {
    this.responseTimes.push(time);
    if (this.responseTimes.length > this.maxResponseTimeHistory) {
      this.responseTimes.shift();
    }
    this.stats.avgResponseTime =
      this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
  }

  /**
   * Update success rate
   */
  private updateSuccessRate(): void {
    if (this.stats.totalRequests > 0) {
      this.stats.successRate = (this.stats.successfulRequests / this.stats.totalRequests) * 100;
    }
  }

  /**
   * Get statistics
   */
  getStats(): SamplingAnalysisStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics (for testing)
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      successRate: 0,
      avgResponseTime: 0,
      requestsByType: {
        summary: 0,
        patterns: 0,
        anomalies: 0,
        trends: 0,
        quality: 0,
        correlations: 0,
        recommendations: 0,
      },
    };
    this.responseTimes = [];
  }
}

// Singleton instance
let samplingAnalysisService: SamplingAnalysisService | null = null;

/**
 * Get the sampling analysis service instance
 */
export function getSamplingAnalysisService(): SamplingAnalysisService {
  if (!samplingAnalysisService) {
    samplingAnalysisService = new SamplingAnalysisService();
  }
  return samplingAnalysisService;
}

/**
 * Reset the sampling analysis service (for testing only)
 * @internal
 */
export function resetSamplingAnalysisService(): void {
  if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] !== 'true') {
    throw new ServiceError(
      'resetSamplingAnalysisService() can only be called in test environment',
      'INTERNAL_ERROR',
      'SamplingAnalysisService'
    );
  }
  samplingAnalysisService = null;
}
