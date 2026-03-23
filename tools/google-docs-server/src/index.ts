#!/usr/bin/env node

/**
 * Google Docs MCP Server
 *
 * Provides real-time access to Google API documentation for ServalSheets.
 * Eliminates documentation drift by fetching latest docs on-demand.
 *
 * Tools provided:
 * 1. google_api_docs - Fetch endpoint documentation
 * 2. google_api_changelog - Get API changes and breaking changes
 * 3. google_quota_limits - Get current quota limits
 * 4. google_best_practices - Get best practices for category
 * 5. google_deprecations - Get deprecation schedule
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

// Cache configuration
const CACHE_TTL = 3600000; // 1 hour
const cache = new Map<string, { data: any; timestamp: number }>();

/**
 * Fetch Google Sheets API documentation
 */
async function fetchGoogleApiDocs(endpoint: string): Promise<any> {
  const cacheKey = `docs:${endpoint}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    // Google Sheets API v4 documentation
    const baseUrl = 'https://developers.google.com/sheets/api/reference/rest/v4';
    const url = `${baseUrl}/${endpoint}`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'ServalSheets-MCP-Server/1.0',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);

    // Extract documentation
    const documentation = {
      endpoint,
      url,
      title: $('h1').first().text().trim(),
      description: $('meta[name="description"]').attr('content') || '',
      httpMethod: extractHttpMethod($),
      requestUrl: extractRequestUrl($),
      parameters: extractParameters($),
      requestBody: extractRequestBody($),
      responseBody: extractResponseBody($),
      scopes: extractScopes($),
      examples: extractExamples($),
      lastFetched: new Date().toISOString(),
    };

    cache.set(cacheKey, { data: documentation, timestamp: Date.now() });
    return documentation;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Failed to fetch docs for ${endpoint}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Fetch API changelog
 */
async function fetchGoogleApiChangelog(since?: string): Promise<any> {
  const cacheKey = `changelog:${since || 'all'}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const url = 'https://developers.google.com/sheets/api/guides/migration';
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'ServalSheets-MCP-Server/1.0' },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);

    const changes = {
      url,
      changes: [] as any[],
      breakingChanges: [] as any[],
      deprecations: [] as any[],
      lastFetched: new Date().toISOString(),
    };

    // Extract changelog entries
    $('h2, h3').each((i, elem) => {
      const heading = $(elem).text().trim();
      const content = $(elem).next('p, ul').text().trim();

      const change = {
        date: extractDate(heading),
        title: heading,
        description: content,
        type: determineChangeType(heading, content),
      };

      changes.changes.push(change);

      if (change.type === 'breaking') {
        changes.breakingChanges.push(change);
      } else if (change.type === 'deprecation') {
        changes.deprecations.push(change);
      }
    });

    // Filter by date if provided
    if (since) {
      const sinceDate = new Date(since);
      changes.changes = changes.changes.filter((c) => c.date && new Date(c.date) >= sinceDate);
      changes.breakingChanges = changes.breakingChanges.filter(
        (c) => c.date && new Date(c.date) >= sinceDate
      );
    }

    cache.set(cacheKey, { data: changes, timestamp: Date.now() });
    return changes;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Failed to fetch changelog: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Fetch quota limits
 */
async function fetchQuotaLimits(method?: string): Promise<any> {
  const cacheKey = `quota:${method || 'all'}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const url = 'https://developers.google.com/sheets/api/limits';
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'ServalSheets-MCP-Server/1.0' },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);

    const quotas = {
      url,
      readRequests: {
        perMinPerUser: 300,
        perDayPerProject: 500000,
        description: 'Read requests quota',
      },
      writeRequests: {
        perMinPerUser: 300,
        perDayPerProject: 500000,
        description: 'Write requests quota',
      },
      general: [] as any[],
      lastFetched: new Date().toISOString(),
    };

    // Extract quota details from table
    $('table tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 2) {
        quotas.general.push({
          operation: $(cells[0]).text().trim(),
          limit: $(cells[1]).text().trim(),
        });
      }
    });

    cache.set(cacheKey, { data: quotas, timestamp: Date.now() });
    return quotas;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Failed to fetch quota limits: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Fetch best practices
 */
async function fetchBestPractices(category: string): Promise<any> {
  const cacheKey = `practices:${category}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const urlMap: Record<string, string> = {
    quota: 'https://developers.google.com/sheets/api/guides/performance',
    performance: 'https://developers.google.com/sheets/api/guides/performance',
    security: 'https://developers.google.com/sheets/api/guides/authorizing',
    errors: 'https://developers.google.com/sheets/api/guides/troubleshooting',
  };

  const url = urlMap[category] || urlMap.performance;

  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'ServalSheets-MCP-Server/1.0' },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);

    const practices = {
      category,
      url,
      practices: [] as any[],
      lastFetched: new Date().toISOString(),
    };

    // Extract best practices
    $('h2, h3').each((i, elem) => {
      const heading = $(elem).text().trim();
      const content = $(elem).nextUntil('h2, h3', 'p, ul').text().trim();

      if (content) {
        practices.practices.push({
          title: heading,
          description: content,
          category: determinePracticeCategory(heading, content),
        });
      }
    });

    cache.set(cacheKey, { data: practices, timestamp: Date.now() });
    return practices;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Failed to fetch best practices: ${error.message}`);
    }
    throw error;
  }
}

// Helper functions
function extractHttpMethod($: cheerio.CheerioAPI): string {
  const method = $('code:contains("POST"), code:contains("GET"), code:contains("PUT")')
    .first()
    .text();
  return method || 'UNKNOWN';
}

function extractRequestUrl($: cheerio.CheerioAPI): string {
  const url = $('code')
    .filter((i, el) => $(el).text().includes('https://'))
    .first()
    .text();
  return url || '';
}

function extractParameters($: cheerio.CheerioAPI): any[] {
  const params: any[] = [];
  $('table')
    .first()
    .find('tr')
    .each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 2) {
        params.push({
          name: $(cells[0]).text().trim(),
          type: $(cells[1]).text().trim(),
          description: $(cells[2])?.text().trim() || '',
        });
      }
    });
  return params;
}

function extractRequestBody($: cheerio.CheerioAPI): any {
  const body = $('h3:contains("Request body")').next('pre, code').text();
  try {
    return body ? JSON.parse(body) : null;
  } catch {
    return { raw: body };
  }
}

function extractResponseBody($: cheerio.CheerioAPI): any {
  const body = $('h3:contains("Response body")').next('pre, code').text();
  try {
    return body ? JSON.parse(body) : null;
  } catch {
    return { raw: body };
  }
}

function extractScopes($: cheerio.CheerioAPI): string[] {
  const scopes: string[] = [];
  $('code:contains("https://www.googleapis.com/auth/")').each((i, elem) => {
    scopes.push($(elem).text().trim());
  });
  return scopes;
}

function extractExamples($: cheerio.CheerioAPI): any[] {
  const examples: any[] = [];
  $('h3:contains("Example")').each((i, elem) => {
    const code = $(elem).nextUntil('h3', 'pre, code').text();
    if (code) {
      examples.push({ code: code.trim() });
    }
  });
  return examples;
}

function extractDate(text: string): string | null {
  const match = text.match(/\d{4}-\d{2}-\d{2}|\w+ \d{1,2},? \d{4}/);
  return match ? match[0] : null;
}

function determineChangeType(heading: string, content: string): string {
  const lower = (heading + ' ' + content).toLowerCase();
  if (lower.includes('breaking') || lower.includes('removed')) return 'breaking';
  if (lower.includes('deprecat')) return 'deprecation';
  if (lower.includes('new') || lower.includes('add')) return 'addition';
  return 'change';
}

function determinePracticeCategory(heading: string, content: string): string {
  const lower = (heading + ' ' + content).toLowerCase();
  if (lower.includes('batch') || lower.includes('quota')) return 'quota';
  if (lower.includes('perform') || lower.includes('speed')) return 'performance';
  if (lower.includes('security') || lower.includes('auth')) return 'security';
  if (lower.includes('error') || lower.includes('retry')) return 'errors';
  return 'general';
}

// Create MCP server
const server = new Server(
  {
    name: 'google-docs-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'google_api_docs',
        description: 'Fetch latest Google Sheets API documentation for specific endpoint',
        inputSchema: {
          type: 'object',
          properties: {
            endpoint: {
              type: 'string',
              description: 'API endpoint name (e.g., "spreadsheets.values.batchGet")',
            },
          },
          required: ['endpoint'],
        },
      },
      {
        name: 'google_api_changelog',
        description: 'Get Google Sheets API changelog and breaking changes',
        inputSchema: {
          type: 'object',
          properties: {
            since: {
              type: 'string',
              description: 'ISO date to filter changes (e.g., "2024-01-01")',
            },
          },
        },
      },
      {
        name: 'google_quota_limits',
        description: 'Get current Google Sheets API quota limits',
        inputSchema: {
          type: 'object',
          properties: {
            method: {
              type: 'string',
              description: 'Specific method to get quota for (optional)',
            },
          },
        },
      },
      {
        name: 'google_best_practices',
        description: 'Get Google Sheets API best practices for category',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Category: quota, performance, security, errors',
              enum: ['quota', 'performance', 'security', 'errors'],
            },
          },
          required: ['category'],
        },
      },
      {
        name: 'google_deprecations',
        description: 'Get Google Sheets API deprecation schedule',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'google_api_docs': {
        const { endpoint } = args as { endpoint: string };
        const docs = await fetchGoogleApiDocs(endpoint);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(docs, null, 2),
            },
          ],
        };
      }

      case 'google_api_changelog': {
        const { since } = args as { since?: string };
        const changelog = await fetchGoogleApiChangelog(since);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(changelog, null, 2),
            },
          ],
        };
      }

      case 'google_quota_limits': {
        const { method } = args as { method?: string };
        const quotas = await fetchQuotaLimits(method);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(quotas, null, 2),
            },
          ],
        };
      }

      case 'google_best_practices': {
        const { category } = args as { category: string };
        const practices = await fetchBestPractices(category);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(practices, null, 2),
            },
          ],
        };
      }

      case 'google_deprecations': {
        const changelog = await fetchGoogleApiChangelog();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  deprecations: changelog.deprecations,
                  breakingChanges: changelog.breakingChanges,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Google Docs MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
