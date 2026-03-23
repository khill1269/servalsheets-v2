#!/usr/bin/env node

/**
 * Google Cloud Console MCP Server
 *
 * Provides MCP tools for managing Google Cloud resources, APIs, IAM, and monitoring.
 * Helps configure and manage Google Cloud projects for ServalSheets deployment.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ProjectsClient } from '@google-cloud/resource-manager';
import { Logging } from '@google-cloud/logging';
import { MetricServiceClient } from '@google-cloud/monitoring';
import { google } from 'googleapis';

/**
 * Authentication setup:
 * Requires Application Default Credentials (ADC) via gcloud CLI:
 *   gcloud auth application-default login
 *
 * Or set GOOGLE_APPLICATION_CREDENTIALS environment variable.
 */

// Initialize Google Auth
const googleAuth = new google.auth.GoogleAuth({
  scopes: [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/logging.read',
    'https://www.googleapis.com/auth/monitoring.read',
  ],
});

// Initialize Google Cloud clients (auth handled automatically via ADC)
const projectsClient = new ProjectsClient();
const loggingClient = new Logging();
const metricClient = new MetricServiceClient();

// Initialize googleapis clients for Service Usage and IAM
const serviceUsage = google.serviceusage('v1');
const cloudResourceManager = google.cloudresourcemanager('v3');

// Input schemas
const ListProjectsSchema = z.object({
  parent: z.string().optional().describe('Parent resource (e.g., organizations/123456)'),
  pageSize: z.number().optional().default(50).describe('Number of projects to return'),
});

const GetProjectSchema = z.object({
  projectId: z.string().describe('Google Cloud project ID'),
});

const ListAPIsSchema = z.object({
  projectId: z.string().describe('Google Cloud project ID'),
  filter: z.string().optional().describe('Filter for enabled APIs (e.g., "sheets", "drive")'),
});

const EnableAPISchema = z.object({
  projectId: z.string().describe('Google Cloud project ID'),
  serviceName: z.string().describe('Service name (e.g., "sheets.googleapis.com")'),
});

const GetQuotasSchema = z.object({
  projectId: z.string().describe('Google Cloud project ID'),
  serviceName: z.string().describe('Service name (e.g., "sheets.googleapis.com")'),
});

const ListIAMPoliciesSchema = z.object({
  projectId: z.string().describe('Google Cloud project ID'),
  resourceType: z
    .string()
    .optional()
    .default('project')
    .describe('Resource type (project, bucket, etc.)'),
});

const GetLogsSchema = z.object({
  projectId: z.string().describe('Google Cloud project ID'),
  filter: z.string().optional().describe('Log filter (e.g., "severity>=ERROR")'),
  pageSize: z.number().optional().default(100).describe('Number of log entries to return'),
  orderBy: z.string().optional().default('timestamp desc').describe('Sort order'),
});

const GetMetricsSchema = z.object({
  projectId: z.string().describe('Google Cloud project ID'),
  metricType: z
    .string()
    .describe('Metric type (e.g., "sheets.googleapis.com/quota/read_requests")'),
  startTime: z.string().optional().describe('Start time (RFC3339)'),
  endTime: z.string().optional().describe('End time (RFC3339)'),
});

const ValidatePermissionsSchema = z.object({
  projectId: z.string().describe('Google Cloud project ID'),
  permissions: z.array(z.string()).describe('Permissions to validate'),
});

// Server setup
const server = new Server(
  {
    name: 'gcloud-console-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: 'gcloud_list_projects',
    description: 'List Google Cloud projects accessible with current credentials',
    inputSchema: {
      type: 'object',
      properties: {
        parent: {
          type: 'string',
          description: 'Parent resource (e.g., organizations/123456)',
        },
        pageSize: {
          type: 'number',
          description: 'Number of projects to return (default: 50)',
        },
      },
    },
  },
  {
    name: 'gcloud_get_project',
    description: 'Get details for a specific Google Cloud project',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Google Cloud project ID',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'gcloud_list_enabled_apis',
    description: 'List enabled APIs and services for a project',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Google Cloud project ID',
        },
        filter: {
          type: 'string',
          description: 'Filter for specific APIs (e.g., "sheets", "drive")',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'gcloud_enable_api',
    description: 'Enable a Google Cloud API or service for a project',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Google Cloud project ID',
        },
        serviceName: {
          type: 'string',
          description: 'Service name (e.g., "sheets.googleapis.com", "drive.googleapis.com")',
        },
      },
      required: ['projectId', 'serviceName'],
    },
  },
  {
    name: 'gcloud_get_quotas',
    description: 'Get quota limits and usage for a Google Cloud service',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Google Cloud project ID',
        },
        serviceName: {
          type: 'string',
          description: 'Service name (e.g., "sheets.googleapis.com")',
        },
      },
      required: ['projectId', 'serviceName'],
    },
  },
  {
    name: 'gcloud_list_iam_policies',
    description: 'List IAM policies and roles for a project',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Google Cloud project ID',
        },
        resourceType: {
          type: 'string',
          description: 'Resource type (default: "project")',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'gcloud_get_logs',
    description: 'Get Cloud Logging logs for a project',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Google Cloud project ID',
        },
        filter: {
          type: 'string',
          description: 'Log filter (e.g., "severity>=ERROR", "resource.type=gce_instance")',
        },
        pageSize: {
          type: 'number',
          description: 'Number of log entries to return (default: 100)',
        },
        orderBy: {
          type: 'string',
          description: 'Sort order (default: "timestamp desc")',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'gcloud_get_metrics',
    description: 'Get Cloud Monitoring metrics for a project',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Google Cloud project ID',
        },
        metricType: {
          type: 'string',
          description: 'Metric type (e.g., "sheets.googleapis.com/quota/read_requests")',
        },
        startTime: {
          type: 'string',
          description: 'Start time (RFC3339 format)',
        },
        endTime: {
          type: 'string',
          description: 'End time (RFC3339 format)',
        },
      },
      required: ['projectId', 'metricType'],
    },
  },
  {
    name: 'gcloud_validate_permissions',
    description: 'Validate if service account has required permissions for ServalSheets',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Google Cloud project ID',
        },
        permissions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Permissions to validate',
        },
      },
      required: ['projectId', 'permissions'],
    },
  },
];

// Request handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'gcloud_list_projects': {
        const input = ListProjectsSchema.parse(args);
        const [projects] = await projectsClient.searchProjects({
          query: input.parent ? `parent:${input.parent}` : undefined,
          pageSize: input.pageSize,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Found ${projects.length} projects`,
            },
          ],
          structuredContent: {
            projects: projects.map((p: any) => ({
              projectId: p.projectId,
              displayName: p.displayName,
              state: p.state,
              createTime: p.createTime,
            })),
          },
        };
      }

      case 'gcloud_get_project': {
        const input = GetProjectSchema.parse(args);
        const [project] = await projectsClient.getProject({
          name: `projects/${input.projectId}`,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Project: ${project.displayName} (${project.projectId})`,
            },
          ],
          structuredContent: {
            project: {
              projectId: project.projectId,
              displayName: project.displayName,
              projectNumber: project.name?.split('/')[1],
              state: project.state,
              createTime: project.createTime,
              labels: project.labels,
            },
          },
        };
      }

      case 'gcloud_list_enabled_apis': {
        const input = ListAPIsSchema.parse(args);
        const response = await serviceUsage.services.list({
          auth: googleAuth,
          parent: `projects/${input.projectId}`,
          filter: input.filter
            ? `state:ENABLED AND displayName:*${input.filter}*`
            : 'state:ENABLED',
        });

        const services = response.data?.services || [];
        const relevantAPIs = services.filter((s: any) =>
          ['sheets', 'drive', 'bigquery', 'appsscript'].some((api) => s.config?.name?.includes(api))
        );

        return {
          content: [
            {
              type: 'text',
              text: `Found ${services.length} enabled APIs (${relevantAPIs.length} relevant for ServalSheets)`,
            },
          ],
          structuredContent: {
            enabledAPIs: services.map((s: any) => ({
              name: s.config?.name,
              title: s.config?.title,
              state: s.state,
            })),
            servalSheetsRelevant: relevantAPIs.map((s: any) => ({
              name: s.config?.name,
              title: s.config?.title,
            })),
          },
        };
      }

      case 'gcloud_enable_api': {
        const input = EnableAPISchema.parse(args);
        await serviceUsage.services.enable({
          auth: googleAuth,
          name: `projects/${input.projectId}/services/${input.serviceName}`,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Enabled API: ${input.serviceName}`,
            },
          ],
          structuredContent: {
            success: true,
            serviceName: input.serviceName,
            projectId: input.projectId,
          },
        };
      }

      case 'gcloud_get_quotas': {
        const input = GetQuotasSchema.parse(args);
        const response = await serviceUsage.services.get({
          auth: googleAuth,
          name: `projects/${input.projectId}/services/${input.serviceName}`,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Quotas for ${input.serviceName}`,
            },
          ],
          structuredContent: {
            service: input.serviceName,
            quotaInfo: response.data?.config?.quota || {},
          },
        };
      }

      case 'gcloud_list_iam_policies': {
        const input = ListIAMPoliciesSchema.parse(args);
        const response = await cloudResourceManager.projects.getIamPolicy({
          auth: googleAuth,
          resource: input.projectId,
        });

        return {
          content: [
            {
              type: 'text',
              text: `IAM policies for ${input.projectId}`,
            },
          ],
          structuredContent: {
            projectId: input.projectId,
            bindings: response.data?.bindings,
          },
        };
      }

      case 'gcloud_get_logs': {
        const input = GetLogsSchema.parse(args);
        const [entries] = await loggingClient.getEntries({
          resourceNames: [`projects/${input.projectId}`],
          filter: input.filter,
          pageSize: input.pageSize || 100,
          orderBy: input.orderBy || 'timestamp desc',
        });

        return {
          content: [
            {
              type: 'text',
              text: `Found ${entries.length} log entries`,
            },
          ],
          structuredContent: {
            logEntries: entries.slice(0, 20).map((e: any) => ({
              timestamp: e.timestamp,
              severity: e.severity,
              logName: e.logName,
              textPayload: e.textPayload,
              jsonPayload: e.jsonPayload,
            })),
            totalCount: entries.length,
          },
        };
      }

      case 'gcloud_get_metrics': {
        const input = GetMetricsSchema.parse(args);
        const endTime = input.endTime || new Date().toISOString();
        const startTime = input.startTime || new Date(Date.now() - 3600000).toISOString();

        const [timeSeries] = await metricClient.listTimeSeries({
          name: `projects/${input.projectId}`,
          filter: `metric.type="${input.metricType}"`,
          interval: {
            endTime: { seconds: Math.floor(new Date(endTime).getTime() / 1000) },
            startTime: { seconds: Math.floor(new Date(startTime).getTime() / 1000) },
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: `Metrics for ${input.metricType}`,
            },
          ],
          structuredContent: {
            metricType: input.metricType,
            timeSeries: timeSeries.map((ts: any) => ({
              metric: ts.metric,
              resource: ts.resource,
              points: ts.points,
            })),
          },
        };
      }

      case 'gcloud_validate_permissions': {
        const input = ValidatePermissionsSchema.parse(args);
        const response = await cloudResourceManager.projects.testIamPermissions({
          auth: googleAuth,
          resource: input.projectId,
          requestBody: {
            permissions: input.permissions,
          },
        });

        const hasAll = response.data?.permissions?.length === input.permissions.length;
        const missing = input.permissions.filter((p) => !response.data?.permissions?.includes(p));

        return {
          content: [
            {
              type: 'text',
              text: hasAll
                ? 'All required permissions present ✓'
                : `Missing permissions: ${missing.join(', ')}`,
            },
          ],
          structuredContent: {
            projectId: input.projectId,
            requestedPermissions: input.permissions,
            grantedPermissions: response.data?.permissions || [],
            missingPermissions: missing,
            hasAllPermissions: hasAll,
          },
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
  console.error('Google Cloud Console MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
