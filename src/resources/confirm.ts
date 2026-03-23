/**
 * ServalSheets - Confirmation Resources
 *
 * Exposes plan confirmation capabilities as MCP resources for discovery and reference.
 * Uses MCP Elicitation (SEP-1036) for user confirmation.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getConfirmationService } from '../services/confirm-service.js';

/**
 * Register confirmation resources with the MCP server
 */
export function registerConfirmResources(server: McpServer): number {
  const confirmService = getConfirmationService();

  // Resource 1: confirm://stats - Confirmation service statistics
  server.registerResource(
    'Plan Confirmation Statistics',
    'confirm://stats',
    {
      description: 'Plan confirmation statistics: approval rate, response times',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const stats = confirmService.getStats();

        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  stats: {
                    totalConfirmations: stats.totalConfirmations,
                    approved: stats.approved,
                    declined: stats.declined,
                    cancelled: stats.cancelled,
                    approvalRate: `${stats.approvalRate.toFixed(1)}%`,
                    avgResponseTime: `${(stats.avgResponseTime / 1000).toFixed(2)}s`,
                  },
                  summary: `${stats.approved}/${stats.totalConfirmations} plans approved (${stats.approvalRate.toFixed(1)}% approval rate)`,
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
                  error: 'Failed to fetch confirmation statistics',
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

  // Resource 2: confirm://help - Confirmation capabilities documentation
  server.registerResource(
    'Plan Confirmation Help',
    'confirm://help',
    {
      description: 'Documentation for plan confirmation using MCP Elicitation',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      try {
        const helpText = `# Plan Confirmation (MCP Elicitation)

## Overview
ServalSheets uses MCP Elicitation (SEP-1036) for user confirmation before executing
multi-step operations. This follows the correct architectural pattern:

1. **Claude plans** - The LLM naturally plans multi-step operations
2. **User confirms** - Elicitation presents the plan for approval
3. **Claude executes** - After approval, Claude executes the plan

## Why This Pattern?

❌ **Wrong (Anti-Pattern)**: Building a "planning agent" service
- Duplicates what Claude already does
- Rule-based logic < LLM intelligence  
- No user confirmation

✅ **Correct (MCP-Native)**: Using Elicitation for confirmation
- Claude's natural planning ability
- User stays in control
- Standard MCP protocol

## How It Works

### Step 1: Claude Plans
Claude naturally breaks down complex requests:
\`\`\`
User: "Create a sales dashboard with charts"

Claude thinks:
1. Read the sales data structure
2. Create a new "Dashboard" sheet
3. Add summary formulas (SUMIF, AVERAGE)
4. Create a bar chart for monthly totals
5. Apply professional formatting
\`\`\`

### Step 2: Confirm with User
Claude calls \`sheets_confirm\` with the plan:
\`\`\`
sheets_confirm({
  action: 'request',
  plan: {
    title: 'Create Sales Dashboard',
    description: 'Create a dashboard with...',
    steps: [
      { stepNumber: 1, description: 'Read data', tool: 'sheets_data', action: 'read', risk: 'low' },
      { stepNumber: 2, description: 'Create sheet', tool: 'sheets_core', action: 'sheet_add', risk: 'low' },
      // ...
    ],
    willCreateSnapshot: true
  }
})
\`\`\`

### Step 3: User Sees Confirmation Dialog
The MCP client shows the user:
\`\`\`
📋 Create Sales Dashboard

Create a dashboard with summary formulas and charts.

Steps:
1. Read data 🟢
2. Create sheet 🟢
3. Add formulas 🟢
4. Create chart 🟡
5. Apply formatting 🟢

Summary:
- Total steps: 5
- Estimated API calls: 8
- Overall risk: MEDIUM
- Snapshot: Will be created

[✓ Execute]  [✎ Modify]  [✗ Cancel]
\`\`\`

### Step 4: Claude Executes (if approved)
If the user approves, Claude proceeds to call the individual tools.

## Risk Levels

| Level | Emoji | Meaning |
|-------|-------|---------|
| low | 🟢 | Safe operations, easily reversible |
| medium | 🟡 | Some risk, snapshot recommended |
| high | 🟠 | Significant changes, review carefully |
| critical | 🔴 | Major impact, extra caution needed |

## Usage

### Request Confirmation
\`\`\`
sheets_confirm({
  action: 'request',
  plan: {
    title: 'Your Plan Title',
    description: 'What this plan does',
    steps: [...],
    willCreateSnapshot: true,
    additionalWarnings: ['Custom warning']
  }
})
\`\`\`

### Get Statistics
\`\`\`
sheets_confirm({ action: 'get_stats' })
\`\`\`

## Requirements
- Client must support MCP Elicitation (SEP-1036)

## Statistics
View confirmation statistics at: confirm://stats
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
              text: `Error fetching confirmation help: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  console.error('[ServalSheets] Registered 2 confirm resources:');
  console.error('  - confirm://stats (confirmation statistics)');
  console.error('  - confirm://help (confirmation documentation)');

  return 2;
}
