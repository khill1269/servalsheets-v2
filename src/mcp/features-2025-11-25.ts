/**
 * ServalSheets - MCP 2025-11-25 Feature Enhancement
 *
 * This file documents and implements all MCP 2025-11-25 features
 * including SEP-1686 (Tasks), SEP-973 (Icons), and proper capability wiring.
 *
 * AUDIT: January 2026
 *
 * ============================================================================
 * MCP SERVER CAPABILITIES DECLARATION
 * ============================================================================
 *
 * DECLARED CAPABILITIES (via createServerCapabilities):
 * - tools: configured tool set with the configured action count
 * - resources: registered URI templates and reference resources
 * - prompts: registered guided workflows for common operations
 * - completions: Argument autocompletion for prompts/resources
 * - tasks: Background execution with TaskStoreAdapter (SEP-1686)
 * - logging: Dynamic log level control via logging/setLevel handler
 *
 * CLIENT-SIDE CAPABILITIES (checked, not declared):
 * - elicitation (SEP-1036): sheets_confirm checks clientCapabilities.elicitation
 * - sampling (SEP-1577): sheets_analyze checks clientCapabilities.sampling
 * Note: These are CLIENT capabilities per MCP spec — the server sends requests,
 * the client declares support. No ServerCapabilities declaration needed.
 *
 * NOT APPLICABLE:
 * - roots: Not applicable for Google Sheets (cloud-based, no filesystem)
 *
 * ============================================================================
 */

import type { ServerCapabilities, Icon, ToolExecution } from '@modelcontextprotocol/sdk/types.js';
import { DEFER_SCHEMAS, STAGED_REGISTRATION } from '../config/constants.js';
import { getConfiguredActionCount, getConfiguredToolCount } from './tool-catalog.js';

// ============================================================================
// MCP 2025-11-25 FEATURE STATUS
// ============================================================================

/**
 * MCP 2025-11-25 Feature Implementation Status
 *
 * ✅ IMPLEMENTED MCP 2025-11-25 SERVER FEATURES:
 * - MCP-compliant tool naming validation (letters, numbers, hyphens, underscores)
 * - Tool Annotations (all 4 hints: readOnlyHint, destructiveHint, idempotentHint, openWorldHint)
 * - Structured Outputs (content + structuredContent in responses)
 * - Discriminated Unions (action in request, success in response)
 * - Resources (spreadsheet metadata via URI template)
 * - Prompts (guided workflows)
 * - Knowledge Resources (formulas, colors, formats)
 * - listChanged notifications (auto-registered by McpServer)
 * - SEP-973 Icons (SVG icons for all 25 tools)
 * - Server Instructions (LLM context guidance)
 * - SEP-1686 Tasks (SDK-compatible TaskStoreAdapter with listTasks)
 * - Logging capability (winston logger + MCP logging/setLevel)
 * - Completions capability (argument autocompletion for actions, IDs, types)
 * - SEP-1577 Sampling (server-to-client LLM requests for AI-powered analysis)
 * - SEP-1036 Elicitation (user input collection via forms and URLs)
 */

// ============================================================================
// ICONS (SEP-973)
// ============================================================================

/**
 * Tool icons for ServalSheets
 *
 * Icons improve UX in MCP clients by providing visual identification.
 * Format: data: URI with base64 SVG
 *
 * Icon interface: { src: string; mimeType?: string; sizes?: string[]; theme?: 'light' | 'dark' }
 */
export const TOOL_ICONS: Record<string, Icon[]> = {
  sheets_auth: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48cGF0aCBkPSJNMjAgMjFWMTlBNCA0IDAgMCAwIDE2IDE1SDhBNCA0IDAgMCAwIDQgMTlWMjEiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjciIHI9IjQiLz48L3N2Zz4=',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_core: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48cGF0aCBkPSJNMTQgMkg2YTIgMiAwIDAgMC0yIDJ2MTZhMiAyIDAgMCAwIDIgMmgxMmEyIDIgMCAwIDAgMi0yVjhsLTYtNnoiLz48cGF0aCBkPSJNMTQgMnY2aDYiLz48cGF0aCBkPSJNOCAxM2g4Ii8+PHBhdGggZD0iTTggMTdoOCIvPjwvc3ZnPg==',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_data: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48cGF0aCBkPSJNNCA3VjRoMTZ2MyIvPjxwYXRoIGQ9Ik05IDIwaDYiLz48cGF0aCBkPSJNMTIgNHYxNiIvPjwvc3ZnPg==',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_format: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48cGF0aCBkPSJtOS4wNiAxMS45IDguMDctOC4wNmEyLjg1IDIuODUgMCAxIDEgNC4wMyA0LjAzbC04LjA2IDguMDgiLz48cGF0aCBkPSJNNy4wNyAxNC45NGMtMS42NiAwLTMgMS4zNS0zIDNMMiAyMWwzLjA2LTIuMDdjMS42NCAwIDMtMS4zNCAzLTN6Ii8+PC9zdmc+',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_dimensions: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48cGF0aCBkPSJNMjEgM0gzdjE4aDE4VjN6Ii8+PHBhdGggZD0iTTIxIDloLTE4Ii8+PHBhdGggZD0iTTkgMjFWOSIvPjwvc3ZnPg==',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_visualize: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48bGluZSB4MT0iMTgiIHkxPSIyMCIgeDI9IjE4IiB5Mj0iMTAiLz48bGluZSB4MT0iMTIiIHkxPSIyMCIgeDI9IjEyIiB5Mj0iNCIvPjxsaW5lIHgxPSI2IiB5MT0iMjAiIHgyPSI2IiB5Mj0iMTQiLz48L3N2Zz4=',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_collaborate: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48Y2lyY2xlIGN4PSIxOCIgY3k9IjUiIHI9IjMiLz48Y2lyY2xlIGN4PSI2IiBjeT0iMTIiIHI9IjMiLz48Y2lyY2xlIGN4PSIxOCIgY3k9IjE5IiByPSIzIi8+PGxpbmUgeDE9IjguNTkiIHkxPSIxMy41MSIgeDI9IjE1LjQyIiB5Mj0iMTcuNDkiLz48bGluZSB4MT0iMTUuNDEiIHkxPSI2LjUxIiB4Mj0iOC41OSIgeTI9IjEwLjQ5Ii8+PC9zdmc+',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_advanced: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIzIi8+PHBhdGggZD0iTTE5LjQgMTVhMS42NSAxLjY1IDAgMCAwIC4zMyAxLjgybC4wNi4wNmEyIDIgMCAwIDEgMCAyLjgzIDIgMiAwIDAgMS0yLjgzIDBsLS4wNi0uMDZhMS42NSAxLjY1IDAgMCAwLTEuODItLjMzIDEuNjUgMS42NSAwIDAgMC0xIDEuNTFWMjFhMiAyIDAgMCAxLTIgMiAyIDIgMCAwIDEtMi0ydi0uMDlBMS42NSAxLjY1IDAgMCAwIDkgMTkuNGExLjY1IDEuNjUgMCAwIDAtMS44Mi4zM2wtLjA2LjA2YTIgMiAwIDAgMS0yLjgzIDAgMiAyIDAgMCAxIDAtMi44M2wuMDYtLjA2YTEuNjUgMS42NSAwIDAgMCAuMzMtMS44MiAxLjY1IDEuNjUgMCAwIDAtMS41MS0xSDNhMiAyIDAgMCAxLTItMiAyIDIgMCAwIDEgMi0yaC4wOUExLjY1IDEuNjUgMCAwIDAgNC42IDlhMS42NSAxLjY1IDAgMCAwLS4zMy0xLjgybC0uMDYtLjA2YTIgMiAwIDAgMSAwLTIuODMgMiAyIDAgMCAxIDIuODMgMGwuMDYuMDZhMS42NSAxLjY1IDAgMCAwIDEuODIuMzNIOS4xNWExLjY1IDEuNjUgMCAwIDAgMS0xLjUxVjNhMiAyIDAgMCAxIDItMiAyIDIgMCAwIDEgMiAydi4wOWExLjY1IDEuNjUgMCAwIDAgMSAxLjUxIDEuNjUgMS42NSAwIDAgMCAxLjgyLS4zM2wuMDYtLjA2YTIgMiAwIDAgMSAyLjgzIDAgMiAyIDAgMCAxIDAgMi44M2wtLjA2LjA2YTEuNjUgMS42NSAwIDAgMC0uMzMgMS44MlY5YTEuNjUgMS42NSAwIDAgMCAxLjUxIDFIMjFhMiAyIDAgMCAxIDIgMiAyIDIgMCAwIDEtMiAyaC0uMDlhMS42NSAxLjY1IDAgMCAwLTEuNTEgMXoiLz48L3N2Zz4=',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_transaction: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48cG9seWdvbiBwb2ludHM9IjIyIDMgMiAzIDEwIDEyLjQ2IDEwIDE5IDE0IDIxIDE0IDEyLjQ2IDIyIDMiLz48L3N2Zz4=',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_quality: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48cGF0aCBkPSJNMTIgMjJ2LTZoNHY2Ii8+PHBhdGggZD0iTTIgMjBoMjAiLz48cGF0aCBkPSJNNCAxNnYtNmgydjYiLz48cGF0aCBkPSJNMTAgMTZ2LTZoMnY2Ii8+PHBhdGggZD0iTTE2IDE2VjZoMnYxMCIvPjwvc3ZnPg==',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_history: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIvPjxwb2x5bGluZSBwb2ludHM9IjEyIDYgMTIgMTIgMTYgMTQiLz48L3N2Zz4=',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_confirm: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48cGF0aCBkPSJNMjEgMTVhMiAyIDAgMCAxLTIgMkg3bC00IDRWNWEyIDIgMCAwIDEgMi0yaDE0YTIgMiAwIDAgMSAyIDJ6Ii8+PC9zdmc+',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_analyze: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48Y2lyY2xlIGN4PSIxMSIgY3k9IjExIiByPSI4Ii8+PGxpbmUgeDE9IjIxIiB5MT0iMjEiIHgyPSIxNi42NSIgeTI9IjE2LjY1Ii8+PC9zdmc+',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_fix: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48cmVjdCB4PSIzIiB5PSIzIiB3aWR0aD0iNyIgaGVpZ2h0PSI3Ii8+PHJlY3QgeD0iMTQiIHk9IjMiIHdpZHRoPSI3IiBoZWlnaHQ9IjciLz48cmVjdCB4PSIxNCIgeT0iMTQiIHdpZHRoPSI3IiBoZWlnaHQ9IjciLz48cmVjdCB4PSIzIiB5PSIxNCIgd2lkdGg9IjciIGhlaWdodD0iNyIvPjwvc3ZnPg==',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_composite: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48cmVjdCB4PSIzIiB5PSIzIiB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHJ4PSIyIi8+PHBhdGggZD0iTTMgOWgxOCIvPjxwYXRoIGQ9Ik05IDN2MTgiLz48L3N2Zz4=',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_session: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48cGF0aCBkPSJNMjAgMjFWMTlBNCA0IDAgMCAwIDE2IDE1SDhBNCA0IDAgMCAwIDQgMTlWMjEiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjciIHI9IjQiLz48L3N2Zz4=',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_templates: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHg9IjMiIHk9IjMiIHdpZHRoPSI4IiBoZWlnaHQ9IjgiIHJ4PSIxIi8+PHJlY3QgeD0iMTMiIHk9IjMiIHdpZHRoPSI4IiBoZWlnaHQ9IjgiIHJ4PSIxIi8+PHJlY3QgeD0iMyIgeT0iMTMiIHdpZHRoPSI4IiBoZWlnaHQ9IjgiIHJ4PSIxIi8+PHJlY3QgeD0iMTMiIHk9IjEzIiB3aWR0aD0iOCIgaGVpZ2h0PSI4IiByeD0iMSIvPjwvc3ZnPg==',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_bigquery: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjEyIiBjeT0iNiIgcj0iMi41Ii8+PGNpcmNsZSBjeD0iNyIgY3k9IjEzIiByPSIyLjUiLz48Y2lyY2xlIGN4PSIxNyIgY3k9IjEzIiByPSIyLjUiLz48cGF0aCBkPSJNMTEuNSA4LjVMMTAgMTAuNW0xIDAtMy41LjVMMTAgMTAuNW0wIDAgMy41LjVNMTIgOXY0Ii8+PC9zdmc+',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_appsscript: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik05IDMgMTIgNiAxNSAzIi8+PHBhdGggZD0iTTkgOCAxMiAxMSAxNSA4Ii8+PHBhdGggZD0iTTkgMTMgMTIgMTYgMTUgMTMiLz48cGF0aCBkPSJNOSAxOCAxMiAyMSAxNSAxOCIvPjwvc3ZnPg==',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_webhook: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjQiIGN5PSI4IiByPSIyIi8+PHBhdGggZD0iTTYuNSA5LjVsOC41IC41Ii8+PGNpcmNsZSBjeD0iMjAiIGN5PSI4IiByPSIyIi8+PHBhdGggZD0iTTYgMTZoMTJ2MyIvPjxwYXRoIGQ9Ik0xMiAxMnYzIi8+PC9zdmc+',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_dependencies: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjMiIGN5PSI2IiByPSIyIi8+PGNpcmNsZSBjeD0iMjEiIGN5PSI2IiByPSIyIi8+PGNpcmNsZSBjeD0iMTIiIGN5PSIxOCIgcj0iMiIvPjxwYXRoIGQ9Ik01IDE4bDcgLTEwIi8+PHBhdGggZD0iTTE5IDE4bC03IC0xMCIvPjwvc3ZnPg==',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_federation: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjEyIiBjeT0iNCIgcj0iMiIvPjxjaXJjbGUgY3g9IjQiIGN5PSIxMiIgcj0iMiIvPjxjaXJjbGUgY3g9IjIwIiBjeT0iMTIiIHI9IjIiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjIwIiByPSIyIi8+PGxpbmUgeDE9IjEyIiB5MT0iNiIgeDI9IjEyIiB5Mj0iMTgiLz48bGluZSB4MT0iNi40IiB5MT0iMTAuNCIgeDI9IjEwLjQiIHkyPSI2LjQiLz48bGluZSB4MT0iMTcuNiIgeTE9IjEwLjQiIHgyPSIxMy42IiB5Mj0iNi40Ii8+PGxpbmUgeDE9IjYuNCIgeTE9IjEzLjYiIHgyPSIxMC40IiB5Mj0iMTcuNiIvPjxsaW5lIHgxPSIxNy42IiB5MT0iMTMuNiIgeDI9IjEzLjYiIHkyPSIxNy42Ii8+PC9zdmc+',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_compute: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48cGF0aCBkPSJtMyAxNyA2LTYgNCA0IDgtOCIvPjxwYXRoIGQ9Ik0xNyA3aDR2NCIvPjwvc3ZnPg==',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_agent: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48cmVjdCB4PSIzIiB5PSI0IiB3aWR0aD0iMTgiIGhlaWdodD0iMTQiIHJ4PSIyIi8+PHBhdGggZD0iTTggMTRsMi0yIDIgMiA0LTQiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjIiIHI9IjEiLz48L3N2Zz4=',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
  sheets_connectors: [
    {
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48cGF0aCBkPSJNNyA3bTItMmgtNGEyIDIgMCAwIDAtMiAydjRhMiAyIDAgMCAwIDIgMmg0YTIgMiAwIDAgMCAyLTJ2LTRhMiAyIDAgMCAwLTItMnoiLz48cGF0aCBkPSJNMTcgMTdtMi0yaC00YTIgMiAwIDAgMC0yIDJ2NGEyIDIgMCAwIDAgMiAyaDRhMiAyIDAgMCAwIDItMnYtNGEyIDIgMCAwIDAtMi0yeiIvPjxwYXRoIGQ9Ik0xMCA4aDRhMiAyIDAgMCAxIDIgMnY0Ii8+PC9zdmc+',
      mimeType: 'image/svg+xml',
      sizes: ['24x24'],
    },
  ],
};

// ============================================================================
// EXECUTION / TASK SUPPORT
// ============================================================================

/**
 * Tool execution configuration for task support (SEP-1686)
 *
 * taskSupport values:
 * - 'forbidden': Tool cannot be used with task augmentation
 * - 'optional': Tool can be used with or without task augmentation
 * - 'required': Tool MUST be used with task augmentation
 *
 * Long-running tools (analysis, bulk operations) use 'optional' to allow
 * clients to request task-based execution for progress tracking.
 */
export const TOOL_EXECUTION_CONFIG: Record<string, ToolExecution> = {
  // Task support enabled for long-running operations to allow progress tracking and cancellation

  // Analysis tools - potentially long-running, task support enabled
  sheets_analyze: { taskSupport: 'optional' },

  // Data operations - can be slow with large ranges (>1000 rows)
  sheets_data: { taskSupport: 'optional' },

  // Formatting - can be slow with large ranges (>10K cells)
  sheets_format: { taskSupport: 'optional' },

  // Dimension operations - can be slow with bulk row/column operations (>100 rows)
  sheets_dimensions: { taskSupport: 'optional' },

  // Visualization - can be slow with large datasets
  sheets_visualize: { taskSupport: 'optional' },

  // Composite operations can be long-running and may require cancellation.
  // Nested sampling requests use the base server channel so task mode remains
  // compatible with the official Streamable HTTP SDK client.
  sheets_composite: { taskSupport: 'optional' },

  // Standard operations - typically fast, no task support needed
  sheets_auth: { taskSupport: 'forbidden' },
  sheets_core: { taskSupport: 'forbidden' },
  sheets_collaborate: { taskSupport: 'optional' },
  sheets_advanced: { taskSupport: 'forbidden' },
  sheets_transaction: { taskSupport: 'forbidden' },
  sheets_quality: { taskSupport: 'forbidden' },
  sheets_history: { taskSupport: 'optional' },
  sheets_confirm: { taskSupport: 'forbidden' },
  sheets_fix: { taskSupport: 'optional' },
  sheets_session: { taskSupport: 'forbidden' },

  // Tier 7: Enterprise tools - potentially long-running, task support enabled
  sheets_appsscript: { taskSupport: 'optional' },
  sheets_bigquery: { taskSupport: 'optional' },
  sheets_templates: { taskSupport: 'optional' },
  sheets_webhook: { taskSupport: 'forbidden' },
  sheets_dependencies: { taskSupport: 'optional' },
  sheets_federation: { taskSupport: 'optional' }, // Network calls to remote MCP servers
  sheets_compute: { taskSupport: 'optional' },
  sheets_agent: { taskSupport: 'optional' },
  sheets_connectors: { taskSupport: 'optional' },
};

// ============================================================================
// SERVER CAPABILITIES
// ============================================================================

/**
 * Full server capabilities for ServalSheets
 *
 * MCP 2025-11-25 ServerCapabilities (Honest Declaration):
 * - completions: Argument autocompletion for prompts/resources (NOT tool args)
 * - prompts: Auto-registered by McpServer.registerPrompt()
 * - resources: Auto-registered by McpServer.registerResource()
 * - tools: Auto-registered by McpServer.registerTool()
 * - tasks: Task-augmented execution (SEP-1686)
 * - logging: Dynamic log level control via logging/setLevel handler
 *
 * CLIENT CAPABILITIES (not declared by server — this is correct per MCP spec):
 * - elicitation (SEP-1036): Client declares support; server checks before sending requests
 * - sampling (SEP-1577): Client declares support; server checks before sending requests
 *
 * ARCHITECTURAL NOTE:
 * Sampling and elicitation are CLIENT capabilities in MCP 2025-11-25.
 * The server sends sampling/createMessage and elicitation/create requests,
 * and the client declares it can handle them. See checkSamplingSupport()
 * and checkElicitationSupport() in sampling.ts and elicitation.ts.
 */
export function createServerCapabilities(): ServerCapabilities {
  return {
    // Resource update support - clients can subscribe to concrete resource URIs
    // and re-read them after notifications/resources/updated.
    resources: {
      subscribe: true,
      listChanged: true,
    },

    // Task support (MCP 2025-11-25 standard capability)
    // Tools with taskSupport: 'optional'/'required' can be invoked with task mode
    // Registered via server.experimental.tasks.registerToolTask() SDK API
    tasks: {
      list: {},
      cancel: {},
      requests: {
        tools: {
          call: {},
        },
      },
    },

    // Logging support - Dynamic log level control
    // Clients can use logging/setLevel to adjust server verbosity
    logging: {},

    // Completions support — argument autocompletion for tools (MCP 2025-11-25)
    // Required when server handles completion/complete requests.
    // ServalSheets completes spreadsheetId and action arguments.
    completions: {},

    // Extensions framework (MCP 2025-11-25)
    // Declares non-standard experimental capabilities the server supports.
    // Currently empty — all ServalSheets capabilities use standard spec fields.
    // Add entries here when adopting future experimental MCP features.
    experimental: {},

    // When staged registration is enabled, we emit tools/list_changed after each stage.
    // Declare this so clients know to re-fetch the tool list on notification.
    // When disabled, all tools register at once — no notification needed.
    ...(STAGED_REGISTRATION ? { tools: { listChanged: true } } : {}),

    // Note: tools, prompts, resources capabilities are auto-registered by McpServer
    // when using registerTool(), registerPrompt(), registerResource()
  };
}

// ============================================================================
// SERVER INSTRUCTIONS
// ============================================================================

/**
 * Server instructions for LLM context
 *
 * These instructions help the LLM understand how to use ServalSheets effectively.
 * They are sent during initialization and can be added to system prompts.
 *
 * Optimized for LLM tool usage based on Anthropic best practices:
 * 1. Clear prerequisites and ordering
 * 2. Decision tree for tool selection
 * 3. Error recovery guidance
 * 4. Context management with sheets_session
 */
export function getServerInstructions(): string {
  const baseInstructions = `
ServalSheets is a Google Sheets MCP server with ${getConfiguredToolCount()} tools and ${getConfiguredActionCount()} actions.

Available tools may vary by deployment settings or staged registration. Treat \`tools/list\` as the source of truth for what is callable right now.

## 🔐 STEP 1: Authentication (MANDATORY)

**BEFORE any other tool, verify authentication:**
\`\`\`
sheets_auth action:"status"
\`\`\`

If \`authenticated: false\`:
1. \`sheets_auth action:"login"\` → Get OAuth URL
2. Show user the authUrl link
3. User provides authorization code
4. \`sheets_auth action:"callback" code:"..."\`

**NEVER skip authentication.** All other tools will fail without it.

## 🚀 DEFAULT FIRST-RUN FUNNEL

When the user is new, do not dump the whole tool catalog immediately. Use this onboarding ladder:
1. \`sheets_auth action:"status"\`
2. Read \`readiness\`, \`blockingIssues\`, \`recommendedNextAction\`, and \`recommendedPrompt\`
3. If blocked, route to \`sheets_auth action:"login"\` or \`sheets_auth action:"setup_feature"\`
4. Run \`/test_connection\` to verify the full stack on a public spreadsheet
5. Move to \`/first_operation\` for the first useful task, or \`/full_setup\` for a brand-new workbook

**Default guidance:** status → readiness summary → connection test → first useful action.
**Do not lead with docs.** Tell the client and user what the next concrete action is.

## 📍 STEP 2: Set Context (RECOMMENDED)

After auth, set the active spreadsheet to enable natural language ranges:
\`\`\`
sheets_session action:"set_active" spreadsheetId:"1ABC..."
\`\`\`

Benefits:
- Omit spreadsheetId from subsequent calls
- Use column names instead of A1 notation: \`range:"Sales column"\`
- Server tracks your working context

## 🔄 WORKFLOW CHAIN

**Optimal sequence:** session.set_active → analyze.scout → plan → quality.validate (if >100 cells) → execute (batch/transaction for 3+ ops) → history.undo if needed

## 🤝 COLLABORATIVE WORKFLOW

1. Gather requirements
2. Plan execution steps
3. Wait for user approval
4. Execute with safety checks
5. Verify results and report back

## 📊 TOOL SELECTION DECISION TREE (What to Use?)

**Reading data?**
├─ 1-2 ranges → \`sheets_data.read\`
├─ 3+ ranges → \`sheets_data.batch_read\` (same API cost as single read!)
├─ Need structure info only → \`sheets_analyze.scout\` (no data, just metadata)
└─ Need data from multiple spreadsheets → \`sheets_data.cross_read\` / \`cross_query\`

**Writing data?**
├─ Update existing cells at KNOWN positions → \`sheets_data.write\` (always prefer this)
├─ Replace pattern across UNKNOWN positions → \`sheets_data.find_replace\` (pattern-based only!)
├─ Add rows at bottom → \`sheets_data.append\` (WARNING: NOT idempotent!)
├─ 3+ ranges → \`sheets_data.batch_write\` (70% faster)
├─ Match by column headers → \`sheets_composite.smart_append\`
└─ Import CSV file → \`sheets_composite.import_csv\`

⚠️ **COMMON MISTAKE**: Do NOT use \`find_replace\` when you know the cell address. Use \`write\` instead. \`find_replace\` scans the entire range for a pattern — it is slow and non-deterministic for targeted updates.

## 🚫 ANTI-PATTERNS

- Don't use transactions for single operations
- Don't read entire sheet
- Don't lead with docs when the next concrete action is available

**Formatting cells?**
├─ 1-2 format changes → Specific action (set_background, set_text_format, etc.)
├─ 3+ format changes → \`sheets_format.batch_format\` (1 API call for ALL)
├─ Quick preset → \`sheets_format.apply_preset\` (header_row, currency, percentages)
└─ New sheet + formatting → \`sheets_composite.setup_sheet\` (2 API calls total)

**Rows & columns?**
├─ Insert/delete rows or columns → \`sheets_dimensions\` (insert, delete, with dimension:"ROWS" or "COLUMNS")
├─ Resize, hide, freeze → \`sheets_dimensions\` (resize, hide, show, freeze)
├─ Sort or filter data → \`sheets_dimensions\` (sort_range, set_basic_filter, create_filter_view)
└─ Auto-fit column widths → \`sheets_dimensions.auto_resize\`

**Managing sheets?**
├─ Create → \`sheets_core.add_sheet\` or \`sheets_composite.setup_sheet\` (with formatting)
├─ Delete → \`sheets_core.delete_sheet\` (⚠️ check sheets_dependencies analyze_impact first!)
├─ Copy structure → \`sheets_core.duplicate_sheet\`
└─ Apply template → \`sheets_templates.apply\`

**Sharing & collaboration?**
├─ Share spreadsheet → \`sheets_collaborate share_add\` / share_update / share_remove
├─ Comments → \`sheets_collaborate comment_add\` / comment_list / comment_resolve
└─ Version history → \`sheets_collaborate version_list_revisions\`

**sheets_advanced actions? (ISSUE-210: 31 actions across 7 domains)**
├─ Named ranges → \`add_named_range\`, \`update_named_range\`, \`delete_named_range\`, \`list_named_ranges\`, \`get_named_range\`
├─ Protected ranges → \`add_protected_range\`, \`update_protected_range\`, \`delete_protected_range\`, \`list_protected_ranges\`
├─ Metadata (developer) → \`set_metadata\`, \`get_metadata\`, \`delete_metadata\`
├─ Banding (row colors) → \`add_banding\`, \`update_banding\`, \`delete_banding\`, \`list_banding\`
├─ Tables → \`create_table\`, \`delete_table\`, \`list_tables\`, \`update_table\`, \`rename_table_column\`, \`set_table_column_properties\`
├─ Smart chips → \`add_person_chip\`, \`add_drive_chip\`, \`add_rich_link_chip\`, \`list_chips\`
└─ Named functions → \`list_named_functions\`, \`get_named_function\`, \`create_named_function\`, \`update_named_function\`, \`delete_named_function\`

**Enterprise & automation?**
├─ BigQuery integration → \`sheets_bigquery\` (connect, query, import_from_bigquery)
├─ Apps Script → \`sheets_appsscript\` (run scripts, deploy, ScriptApp-based automation)
├─ Webhooks → \`sheets_webhook\` (register, watch_changes, trigger notifications)
├─ Templates → \`sheets_templates\` (list, apply, create reusable patterns)
└─ Federation → \`sheets_federation\` (call_remote, list_servers, cross-service workflows)

**Live external API data?**
└─ \`sheets_connectors\` (list connectors, configure, query/batch_query, subscribe)

**Large datasets (>10K rows)?**
├─ Use \`sheets_data.batch_read\` with pagination (cursor-based)
├─ Use \`sheets_bigquery\` for SQL queries on connected data
├─ Use \`sheets_composite.export_large_dataset\` for exports
└─ Use \`sheets_transaction\` for bulk writes (80-95% fewer API calls)

**Checking dependencies before changes?**
├─ Impact analysis → \`sheets_dependencies analyze_impact\` (what breaks if I change this?)
├─ Formula graph → \`sheets_dependencies build\` (see all formula relationships)
├─ Circular refs → \`sheets_dependencies detect_cycles\`
└─ What-if analysis → \`sheets_dependencies model_scenario\` (revenue drops 20%? trace all cascading effects)

**Undo or audit changes?**
├─ View recent operations → \`sheets_history list\`
├─ Undo last change → \`sheets_history undo\`
├─ Redo → \`sheets_history redo\`
├─ Revert to specific point → \`sheets_history revert_to\`
└─ When did data change? → \`sheets_history timeline\` (per-cell change history across sessions)

**Cleaning data?**
├─ Auto-detect & fix issues → \`sheets_fix.clean\` (preview first with mode:"preview")
├─ Standardize formats → \`sheets_fix.standardize_formats\` (dates, currencies, phones)
├─ Fill empty cells → \`sheets_fix.fill_missing\` (forward, backward, mean, median)
├─ Find outliers → \`sheets_fix.detect_anomalies\`
└─ Get AI recommendations → \`sheets_fix.suggest_cleaning\`

**Creating a new spreadsheet from scratch?**
├─ From a description → \`sheets_composite.generate_sheet\` ("Q1 budget tracker")
├─ Preview first → \`sheets_composite.preview_generation\`
├─ Save as template → \`sheets_composite.generate_template\`
└─ Manual setup → \`sheets_composite.setup_sheet\`

**Investigating changes over time?**
├─ When did data change? → \`sheets_history.timeline\`
├─ Compare two revisions → \`sheets_history.diff_revisions\`
├─ Restore specific cells → \`sheets_history.restore_cells\` (surgical, not full revision)
└─ Undo last operation → \`sheets_history.undo\`

**What-if analysis?**
├─ Model a scenario → \`sheets_dependencies.model_scenario\` (traces formula cascade)
├─ Compare scenarios → \`sheets_dependencies.compare_scenarios\`
└─ Materialize as sheet → \`sheets_dependencies.create_scenario_sheet\`

**Want proactive suggestions?**
├─ Get ranked suggestions → \`sheets_analyze.suggest_next_actions\`
└─ Auto-apply safe improvements → \`sheets_analyze.auto_enhance\` (preview first)

**Want to understand a sheet completely? (ISSUE-209: choose the right entry point)**
├─ "What's in this sheet?" (fast) → \`sheets_analyze.scout\` (structure only, ~200ms, 1 API call)
├─ "Analyze only one aspect" → \`sheets_analyze.analyze_data\` with category:"formulas"|"data"|"structure"|"performance"|"quality"
├─ "Full audit of everything" → \`sheets_analyze.comprehensive\` (all categories, 2 API calls, use after scout)
├─ Formula health specifically → \`sheets_analyze.analyze_formulas\` (upgrade opportunities, errors)
└─ Architecture review → \`sheets_analyze.comprehensive\` → \`sheets_analyze.analyze_formulas\` → \`sheets_dependencies.build\`

⚠️ **HIERARCHY**: scout → analyze_data (targeted) OR comprehensive (full). Never call comprehensive without scout first — it needs context. Never use analyze_data when you only need metadata (use scout).

**Want to upgrade legacy formulas?**
└─ \`sheets_analyze.analyze_formulas\` → check upgradeOpportunities → \`sheets_analyze.generate_formula\` per upgrade → \`sheets_data.write\`

## 🧠 QUICK FORMULA TIPS

- Quick formula tips: prefer modern lookups over VLOOKUP when possible
- INDEX/MATCH remains the compatibility fallback when modern functions are unavailable
- Use sheets_analyze.analyze_formulas before mass formula rewrites

**Building a dashboard?**
├─ Get chart recommendations → \`sheets_visualize.suggest_chart\`
├─ Create chart + sparklines → \`sheets_visualize.chart_create\` → \`sheets_format.sparkline_add\`
├─ Add interactive slicer → \`sheets_dimensions.create_slicer\` (⚠️ do NOT combine with set_basic_filter on the same range — use one or the other)
├─ Add dropdowns/validation → \`sheets_format.set_data_validation\`
└─ Full dashboard → scout → suggest_chart → chart_create → sparkline_add → apply_preset → add_conditional_format_rule

**Auditing, reporting, or migrating spreadsheets?**
├─ Full quality + formula + structure audit → \`sheets_composite.audit_sheet\`
├─ Export formatted report as PDF/XLSX/CSV → \`sheets_composite.publish_report\`
├─ Build a recurring data pipeline (fetch → transform → write) → \`sheets_composite.data_pipeline\`
├─ Create a sheet from a saved template with custom values → \`sheets_composite.instantiate_template\`
└─ Move data between spreadsheets with structure preservation → \`sheets_composite.migrate_spreadsheet\`

**Running formulas/statistics/regression/forecasting server-side?**
└─ \`sheets_compute\` (evaluate expressions, run statistical analysis, forecast)

**Multi-step autonomous plan/execute/rollback workflows?**
└─ \`sheets_agent\` (plan, execute steps, handle errors, rollback on failure)

**5+ operations?**
├─ All formatting → \`sheets_format.batch_format\`
├─ Mixed operations → \`sheets_transaction\` (begin → queue → commit)
└─ Sheet from scratch → \`sheets_composite.setup_sheet\`

## 🗺️ QUICK ROUTING MATRIX

See resource: guide://routing-matrix (read it with resources/read)

## 🧭 5-GROUP MENTAL MODEL (Start Here Before Picking a Tool)

When the user's intent is ambiguous, classify it into one of 5 groups first, then drill into the specific tool. This avoids the most common tool-selection errors.

**GROUP 1 — Data I/O** (move data in or out; read, write, import, export, compute)
→ \`sheets_data\` · \`sheets_composite\` · \`sheets_compute\` · \`sheets_connectors\`
→ Use when: "read", "write", "append", "import", "export", "calculate", "fetch", "get stock price"

**GROUP 2 — Appearance** (how the sheet looks; formatting, charts, layout, sizing)
→ \`sheets_format\` · \`sheets_visualize\` · \`sheets_dimensions\`
→ Use when: "format", "color", "bold", "chart", "freeze", "sort", "hide", "resize", "filter"

**GROUP 3 — Spreadsheet Structure** (files, sheets, sharing, named ranges, protection)
→ \`sheets_core\` · \`sheets_collaborate\` · \`sheets_advanced\` · \`sheets_templates\`
→ Use when: "create spreadsheet", "add sheet", "share", "protect", "named range", "label"

**GROUP 4 — Analysis & Quality** (understand data; fix issues; trace dependencies)
→ \`sheets_analyze\` · \`sheets_fix\` · \`sheets_quality\` · \`sheets_dependencies\`
→ Use when: "analyze", "what's in", "find issues", "clean", "dependencies", "what-if scenario"

**GROUP 5 — Automation & Workflow** (orchestrate; automate; track state; integrate)
→ \`sheets_history\` · \`sheets_session\` · \`sheets_transaction\` · \`sheets_agent\`
→ \`sheets_auth\` · \`sheets_confirm\` · \`sheets_webhook\` · \`sheets_appsscript\`
→ \`sheets_bigquery\` · \`sheets_federation\`
→ Use when: "undo", "automate", "trigger", "run script", "transaction", "authenticate"

**Tiebreaker rule**: If two groups seem to fit, pick GROUP 1 (Data I/O) for anything involving cell values, GROUP 2 for anything involving appearance only.

## 🤖 WHEN TO USE AI FEATURES

These actions invoke LLM analysis automatically (Sampling SEP-1577):

**Need AI data analysis?** → \`sheets_analyze action:"comprehensive"\` (Sampling auto-triggered)
**Need formula generated from description?** → \`sheets_analyze action:"generate_formula" description:"profit margin = revenue minus costs divided by revenue"\`
**Need chart type recommendation?** → \`sheets_visualize action:"suggest_chart"\` (Sampling picks best fit)
**Need to understand revision changes?** → \`sheets_history action:"diff_revisions"\` (Sampling explains what changed)
**Need to model a what-if scenario?** → \`sheets_dependencies action:"model_scenario"\` (Sampling narrates the cascade)
**Need interactive input from user?** → \`sheets_confirm action:"request"\` (Elicitation wizard)

## 🔀 DISAMBIGUATION: Same Name, Different Tool

"list" → What are you listing?
  - Spreadsheets in Drive → sheets_core.list
  - Sheets/tabs in a spreadsheet → sheets_core.list_sheets
  - Named ranges → sheets_advanced.list_named_ranges
  - Charts → sheets_visualize.chart_list
  - Comments → sheets_collaborate.comment_list
  - Templates → sheets_templates.list
  - Webhooks → sheets_webhook.list
  - Transactions → sheets_transaction.list
  - Data validations → sheets_format.list_data_validations
  - Filter views → sheets_dimensions.list_filter_views

"delete" → What are you deleting?
  - Rows/columns → sheets_dimensions.delete
  - A sheet tab → sheets_core.delete_sheet
  - A named range → sheets_advanced.delete_named_range
  - A chart → sheets_visualize.chart_delete
  - A comment → sheets_collaborate.comment_delete
  - Data validation → sheets_format.clear_data_validation
  - A filter view → sheets_dimensions.delete_filter_view
  - A template → sheets_templates.delete
  - A webhook → sheets_webhook.unregister

"create" → What are you creating?
  - New spreadsheet → sheets_core.create
  - New sheet/tab → sheets_core.add_sheet
  - New chart → sheets_visualize.chart_create
  - New template → sheets_templates.create
  - New named range → sheets_advanced.add_named_range
  - New filter view → sheets_dimensions.create_filter_view
  - New Apps Script → sheets_appsscript.create

"get" → What are you getting?
  - Spreadsheet metadata → sheets_core.get
  - Cell data → sheets_data.read
  - Sheet properties → sheets_core.get_sheet
  - Chart details → sheets_visualize.chart_get
  - Comment → sheets_collaborate.comment_get
  - Named range → sheets_advanced.get_named_range

"update" → What are you updating?
  - Cell values → sheets_data.write
  - Sheet properties (name, color, visibility) → sheets_core.update_sheet
  - Spreadsheet title/locale → sheets_core.update_properties
  - Chart appearance → sheets_visualize.chart_update
  - Permission role → sheets_collaborate.share_update
  - Named range bounds → sheets_advanced.update_named_range
  - Dimension sizes (row height, column width) → sheets_dimensions.resize

"import" → What are you importing?
  - CSV file → sheets_composite.import_csv
  - Excel XLSX file → sheets_composite.import_xlsx
  - Built-in template → sheets_templates.import_builtin
  - Data from BigQuery → sheets_bigquery.import_from_bigquery
  - Data from external API → sheets_connectors.query

"analyze" → What do you want to analyze?
  - Cell values and data quality → sheets_analyze.analyze_data
  - Formulas and upgrade opportunities → sheets_analyze.analyze_formulas
  - Sheet structure and layout → sheets_analyze.analyze_structure
  - Performance bottlenecks → sheets_analyze.analyze_performance
  - Formula dependency impact for a specific cell → sheets_dependencies.analyze_impact
  - Data validation conflicts → sheets_quality.analyze_impact

## ⚡ CRITICAL RULES (Avoid Common Mistakes)

1. **Use sheets_analyze.scout ONLY when:**
   - User hasn't specified exact range/sheet
   - Operation requires understanding sheet structure (e.g., 'find duplicates', 'summarize data')
   - User asks 'what's in this spreadsheet?'
   **SKIP scout when user provides:** specific cell/range, exact action ('write A1'), or structural command ('add sheet', 'delete sheet', 'share with').
2. **append is NOT idempotent** — Never retry on timeout. It will duplicate data.
3. **Always include sheet name** in ranges: \`"Sheet1!A1:D10"\` not \`"A1:D10"\`
4. **NEVER type emoji sheet names manually** — Always copy sheet names from \`sheets_core.list_sheets\` response. Emoji characters may look identical but have different Unicode (📊 U+1F4CA vs 📈 U+1F4C8). Quote sheet names with spaces or emoji: \`"'📊 Dashboard'!A1"\`
5. **Use 0-based indices** for insert/delete: row 1 = index 0
6. **batch_format max 100** operations per call
7. **Use verbosity:"minimal"** to save tokens when you don't need full response
8. **Use sheets_transaction for 5+ operations** — Saves 80-95% API calls and ensures atomicity. Example: Updating 50 rows = 1 transaction call instead of 50 individual writes. Don't use for 1-4 operations (overhead exceeds benefit)
9. **\`find_replace\` is for patterns, NOT targeted updates** (ISSUE-208) — If you know the cell address, use \`data.write\`. \`find_replace\` scans the entire range for a regex pattern — slow, non-deterministic for single-cell updates, and may match unintended cells. Rule: "Do I know WHERE to write?" → write. "Do I need to search?" → find_replace.
10. **Use \`valueRenderOption: "UNFORMATTED_VALUE"\` for numeric reads** — When results will be used in calculations or comparisons, always set \`valueRenderOption: "UNFORMATTED_VALUE"\`. The default \`FORMATTED_VALUE\` returns locale-formatted strings like \`"$1,234.56"\` or \`"1.234,56"\` that break numeric operations. Only use \`FORMATTED_VALUE\` when displaying data to humans.
11. **Use \`valueInputOption: "USER_ENTERED"\` for formula writes** — When writing formulas (strings starting with \`=\`), set \`valueInputOption: "USER_ENTERED"\`. The default \`RAW\` writes the formula as a literal string — the cell shows \`=SUM(A1:A10)\` as text rather than evaluating it. Symptom: cell displays the formula text unchanged after write.
12. **Use \`batch_write\` for formula extension, not sequential writes** — To fill a formula down N rows, use \`sheets_data.batch_write\` with N range-value pairs in ONE call. Sequential writes waste 90% of API quota and trigger rate limits. Example: fill \`=B{row}-C{row}\` for rows 2–51 as 50 entries in a single \`batch_write\`.
13. **Validate formulas after batch writes** — After any batch formula write, call \`sheets_analyze.analyze_formulas\` with \`checkErrors: true\` on the written range to detect \`#ERROR!\`, \`#REF!\`, \`#NAME?\` cells. The Sheets API returns HTTP 200 even when formulas produce errors — never assume a successful write means correct formula evaluation.

## ⚠️ FORMULA LOCALE AWARENESS

Non-English spreadsheets (locale \`fr_FR\`, \`de_DE\`, etc.) use \`;\` as the function argument separator instead of \`,\`, and \`,\` as the decimal separator. Use \`sheets_format.set_number_format\` to read \`spreadsheetLocale\` before writing formulas in unfamiliar spreadsheets. Formula evaluator actions (\`model_scenario\`, \`compare_scenarios\`) handle locale automatically.

## 🔁 ERROR SELF-CORRECTION PROTOCOL

When a tool call returns an error, follow these steps:

1. **Read the error response** — Check \`error.code\`, \`error.message\`, and \`error.details\`
2. **Check fixableVia** — If the response includes \`fixableVia\`, it contains the exact tool, action, and params to fix the issue. Execute it immediately.
3. **Check _learnedFix** — If present, this is a fix that worked before for the same error pattern. Apply it with confidence from the server learning layer.
4. **Check suggestedActions** — Alternative approaches ranked by likelihood of success.
5. **If none of the above** — Use \`sheets_analyze.scout\` to understand the spreadsheet state, then retry with corrected parameters.

**Common self-corrections:**

| Error | fixableVia Action | Explanation |
|-------|------------------|-------------|
| SHEET_NOT_FOUND | \`sheets_core.list_sheets\` | Copy exact sheet name from response; emoji/case/whitespace mismatch |
| INVALID_RANGE | Re-call with bounded range (A1:Z1000 not A:Z) | Full-column unbounded ranges must have row bounds |
| PERMISSION_DENIED | \`sheets_auth.login\` | Re-authenticate to refresh access |
| QUOTA_EXCEEDED | Retry with \`verbosity: 'minimal'\` or use \`sheets_transaction\` | Reduce API call size or batch operations |
| VALIDATION_ERROR | Check schema for required fields | Use tool description or \`tools/list\` to see field requirements |
| SPREADSHEET_NOT_FOUND | \`sheets_core.list\` | Find correct spreadsheet ID in Drive |

**TAER Pattern:** When error occurs:
1. **Think** — Read \`error.fixableVia\` (executable fix), \`error.alternatives\` (backup approaches), \`error._learnedFix\` (server-learned fix with confidence)
2. **Analyze** — Check \`error.retryable\`, \`error.retryAfterMs\`, \`error.resolutionSteps\`
3. **Execute** — Call \`fixableVia\` tool/action if present; otherwise apply \`_learnedFix\` if confidence high
4. **Review** — Verify the fix; retry original operation
5. **Plan** — If still failing after 2 attempts, use \`sheets_analyze.scout\` to re-examine structure

**Key error patterns:**
- \`invalid_union\` on conditional format → Use \`add_conditional_format_rule\` with preset
- \`range is required\` → Use string \`"Sheet1!A1"\`, not object \`{a1: "..."}\`
- Timeout on \`append\` → Never retry (NOT idempotent, duplicates data)
- \`SHEET_NOT_FOUND\` → Emoji/unicode mismatch; use \`sheets_core list_sheets\` to copy exact name

**Response hints for data-aware planning:**
- \`_hints\` — \`{ dataShape, primaryKeyColumn, riskLevel, nextPhase }\` on read responses
- \`suggestedNextActions\` — Recommended follow-ups on success
- Never leave debug strings ("test123", "temp") in production cells; verify final values

## ⚡ OPERATION PERFORMANCE TIERS

Check \`_meta.executionTimeMs\` and \`_meta.apiCallsMade\` after each call for actual cost.

| Tier | Latency | API Calls | Examples |
|------|---------|-----------|---------|
| **Instant** (<50ms) | 0 | Session/context ops, cached reads | \`sheets_session.*\`, \`sheets_auth.status\`, ETag 304 |
| **Fast** (50-300ms) | 1 | Single read/write, metadata | \`sheets_data.read\`, \`sheets_format.set_background\`, \`sheets_core.get\` |
| **Medium** (300ms-2s) | 1-3 | Batch ops, chart create, scout | \`batch_write\`, \`chart_create\`, \`scout\` |
| **Slow** (2-10s) | 3-10 | AI analysis, large imports, history | \`comprehensive\`, \`import_csv\`, \`clean\` |
| **Background** (10s+) | 5-20+ | Apps Script, timeline, BigQuery | \`sheets_appsscript.run\`, \`timeline\`, \`export_to_bigquery\` |

**Quota**: 60 req/min per user. Use \`sheets_transaction\` (N ops in 1 call) or \`batch_write\` (100 cells in 1 call) to optimize. Check \`_meta.quotaStatus\` for utilization.

## 🔧 MCP 2025-11-25 PROTOCOL FEATURES

**Sampling (SEP-1577)** — AI analysis happens automatically when you call:
\`sheets_analyze.generate_formula\`, \`sheets_visualize.suggest_chart\`, \`sheets_fix.suggest_cleaning\`,
\`sheets_dependencies.model_scenario\`, \`sheets_history.diff_revisions\`, \`sheets_collaborate.comment_add\`.
You do NOT invoke sampling directly — the server requests AI analysis from the client transparently.
If the client doesn't support sampling, these operations degrade gracefully to rule-based logic.

**Elicitation (SEP-1036)** — Destructive operations may open user approval dialogs:
\`sheets_core.delete_sheet\`, \`sheets_dimensions.delete\`, \`sheets_history.revert_to\`, bulk overwrites.
The server uses \`sheets_confirm\` internally. If the client doesn't support elicitation, the server
falls back to \`safety.dryRun\` parameter — always set \`dryRun: true\` first for destructive ops.

**Tasks (SEP-1686)** — Use MCP \`tasks/call\` for background tracking on task-enabled tools.
The transport returns the Task ID, and clients can cancel, track progress, or query status without
waiting on the foreground \`tools/call\` response.

**Transactions** — For 5+ operations, use atomic batching:
1. \`sheets_transaction begin\` (description for audit trail)
2. \`sheets_transaction queue\` (operation: {tool, action, params}) — repeat for each op
3. \`sheets_transaction commit\` — executes all queued ops in a single API call (80-95% savings)
4. On failure: \`sheets_transaction rollback\` restores pre-transaction state

## 💡 COMMON PATTERNS (Copy-Paste Ready)

**Pattern: Format a data table**
\`sheets_format.batch_format with [header_row preset, alternating_rows preset, auto_fit columns]\`

**Pattern: Add validated data safely**
\`sheets_quality.validate → sheets_data.append → sheets_analyze.scout (verify)\`

**Pattern: Build a dashboard**
\`sheets_composite.setup_sheet → sheets_data.write formulas → sheets_format.batch_format → sheets_visualize.chart_create\`

**Pattern: Dependent dropdowns (e.g. Country → City)**
\`sheets_format.build_dependent_dropdown sourceRange:"Config!A:B" targetSheet:"Form" parentColumn:"A" childColumn:"B"\`

**Pattern: Live data connector → analyze → clean**
\`sheets_connectors.list_connectors → sheets_connectors.query connectorId:"fred" → sheets_data.write → sheets_fix.clean\`

**Pattern: Cross-sheet lookup upgrade**
\`sheets_analyze.analyze_formulas (find VLOOKUP) → sheets_analyze.generate_formula "convert to XLOOKUP" → sheets_data.write\`

## 🔗 TOOL CHAINING (Multi-Step Workflows)

| Workflow | Chain |
|----------|-------|
| Analysis & Fix | scout → comprehensive → sheets_fix (auto-apply) |
| Safe Deletion | analyze_impact → sheets_confirm request → delete_sheet |
| Import Data | import_csv → validate → apply_preset |
| Create Apps Script | create → update_content → create_version → deploy → run |
| Clean Data | suggest_cleaning → clean mode:"preview" → clean mode:"apply" |
| Scenario Analysis | build → model_scenario → create_scenario_sheet |
| Time-Travel | timeline → diff_revisions → restore_cells |
| AI Sheet Gen | preview_generation → generate_sheet → suggest_next_actions |
| Full Audit | scout → comprehensive → suggest_next_actions |
| Formula Modernize | analyze_formulas → (review upgradeOpportunities) → generate_formula → write |
| Build Dashboard | scout → suggest_chart → chart_create → sparkline_add → apply_preset |
| Data Relationships | build → get_dependencies → analyze_formulas → detect_patterns |
| Architecture Review | comprehensive → setup_sheet → add_protected_range → clone_structure |
| Cross-Sheet Analysis | cross_read → comprehensive → cross_compare → suggest_next_actions |
| Quality Audit | audit_sheet → (review) → publish_report |
| Data Pipeline | configure → data_pipeline → batch_format |
| Spreadsheet Migration | scout (source) → migrate_spreadsheet → scout (destination verify) |
| Federation/Remote | list_servers → get_server_tools → call_remote → cross_read (optional) |
| Session Continuity | set_active → read → get_context → (use context in next actions) |

## 🪄 INTERACTIVE WIZARDS (Elicitation)

When a supporting MCP client is connected, these actions launch **interactive forms** to collect missing parameters. If the client doesn't support elicitation, parameters use safe defaults and the action proceeds without interruption.

| Action | What the Wizard Asks |
|--------|---------------------|
| \`sheets_core.create\` | Spreadsheet title + locale + timezone (3-field form) |
| \`sheets_collaborate.share_add\` | Recipient email + permission role + notification settings |
| \`sheets_visualize.chart_create\` | Chart type (bar/line/pie/...) → chart title (2-step) |
| \`sheets_format.add_conditional_format_rule\` | Rule preset (highlight_duplicates, color_scale, data_bars, ...) |
| \`sheets_transaction.begin\` | Transaction description for audit trail |

**Any destructive action** (delete_sheet, clear, bulk overwrite) shows a confirmation form before executing.

**Usage tip**: You can omit parameters for wizard-enabled actions and let the user fill them interactively. Example: call \`sheets_core.create\` with no title — the user will be prompted.

## 📏 RANGE STRATEGY (How to Fetch Data Efficiently)

**PRIORITY ORDER — always use the highest-applicable strategy:**

| Priority | Strategy | When to Use | API Cost | Example |
|----------|----------|-------------|----------|---------|
| 1 | **User-provided range** | User specifies cells/range | 1 call | \`sheets_data.read range:"Sheet1!A1:D50"\` |
| 2 | **Metadata-first** | No range specified, need actual data bounds | 2 calls (meta + data) | \`sheets_analyze.scout\` → \`sheets_data.read\` with discovered bounds |
| 3 | **Scout + targeted** | Exploratory analysis | 1-2 calls | \`sheets_analyze.scout\` returns structure → use returned sheet dimensions |
| 4 | **Tiered retrieval** | Full analysis workflows | 1-4 calls (progressive) | \`sheets_analyze.comprehensive\` auto-tiers |
| 5 | **Bounded fallback** | Metadata fetch failed | 1 call | A1:Z1000 (26K cells max) |

**NEVER do these:**
- ❌ Fetch A1:ZZ10000 (260K cells) — always resolve bounds first
- ❌ Use \`includeGridData: true\` without a \`ranges\` parameter — fetches ALL formatting for ALL cells
- ❌ Use full-column references like \`A:Z\` — triggers full grid scan up to max rows
- ❌ Skip field masks on \`spreadsheets.get()\` — metadata calls should use \`fields\` parameter

**ALWAYS do these:**
- ✅ Include sheet name in ranges: \`"Sheet1!A1:D50"\` not \`"A1:D50"\`
- ✅ Use \`sheets_analyze.scout\` first when range is unknown — it returns actual rowCount/columnCount
- ✅ Use \`verbosity:"minimal"\` for reads where you only need values, not metadata
- ✅ Use \`batch_read\` for 3+ ranges — same API cost as individual reads, processed in parallel
- ✅ Cap analysis ranges: 10K rows max for data reads, 1K rows max for formatting scans

**Dynamic range resolution pattern (best practice):**
1. \`sheets_analyze.scout spreadsheetId:"..."\` → returns \`{ sheets: [{ rowCount: 500, columnCount: 8 }] }\`
2. \`sheets_data.read range:"Sheet1!A1:H500"\` ← bounded to actual data

## 📝 EXAMPLES: Common Requests → Correct Tool Calls

| "User says" | Correct call | Why NOT alternative |
|---|---|---|
| "Write 'Hello' in cell A1" | sheets_data write range:"Sheet1!A1" | Append finds last row; write targets specific cell |
| "Add these rows to bottom" | sheets_data append range:"Sheet1" | Write is for known positions; append auto-finds end |
| "Add sheet called Sales" | sheets_core add_sheet title:"Sales" | sheets_dimensions.insert adds rows/columns, not sheets |
| "Insert 3 rows above row 5" | sheets_dimensions insert dimension:"ROWS" startIndex:4 endIndex:7 | dimensions for rows/cols; core for sheets. 0-based indices. |
| "Make header row bold+blue" | sheets_format batch_format (single call) | Batch is 1 API call; individual set_* is slower for multiple formats |
| "Highlight cells >1000 red" | sheets_format add_conditional_format_rule | set_data_validation restricts input; conditional changes appearance |
| "Share with alice@company.com as editor" | sheets_collaborate share_add role:"writer" | "writer" is Google API term, not "editor" |
| "Import data.csv to new sheet" | sheets_composite import_csv | sheets_data.write requires manual parsing |
| "Show dependencies of cell D5" | sheets_dependencies get_dependents cell:"Sheet1!D5" | dependencies traces formula graph; analyze examines whole sheet |
| "Undo last change" | sheets_history undo | undo reverses last op; revert_to restores specific revision |
| "What's in this spreadsheet?" | sheets_analyze scout | scout is metadata only (~200ms, 1 API call); read fetches cell data |
| "Read A1 to D50" | sheets_data read range:"Sheet1!A1:D50" | scout is for unknown ranges; you know the range here |
| "Sort table by Date desc" | sheets_dimensions sort_range | sort_range is server-side sort; write requires re-fetching |
| "Freeze header row" | sheets_dimensions freeze frozenRowCount:1 | freeze is sheet view property, not cell formatting |
| "Remove duplicate rows" | sheets_composite deduplicate | deduplicate does row-level comparison; find_replace does text only |
| "Average of B2:B100 server-side" | sheets_compute aggregate function:"AVERAGE" | compute is server-side; read + manual math wastes bandwidth |
| "Get AAPL stock price" | sheets_connectors query connectorId:"alpha-vantage" | connectors for live APIs; sheets_data only reads cells |
| "Save checkpoint for undo" | sheets_session save_checkpoint | session checkpoints are in-session fast restore; history tracks cross-session |
| "What breaks if I change B5?" | sheets_dependencies analyze_impact cell:"Sheet1!B5" | dependencies traces formula graph; analyze is for data quality |
| "Clean data: dates, whitespace, dupes" | sheets_fix clean mode:"preview" | clean auto-detects 10+ issue types; find_replace is text-only |

## ⚠️ GOOGLE SHEETS API LIMITATIONS

These operations are NOT possible or limited via the REST API v4:
- **Data bars**: Conditional formatting only supports BooleanRule and GradientRule. Use \`=SPARKLINE(data, {"charttype","bar"})\` formulas instead.
- **Print setup**: Page orientation, margins, headers/footers require Apps Script (PageSetup). Use \`sheets_appsscript\` to configure.
- **LAMBDA**: Not available on Frontline, Nonprofits, or legacy G Suite tiers. Use named ranges with regular formulas as fallback.
- **XLOOKUP**: Lookup range must be a single row or single column. For matrix lookups, use INDEX/MATCH.
- **Revision content export**: Google Drive API returns metadata for Workspace files, not cell-level historical content. Use \`sheets_history.timeline\` for per-cell change tracking.

## ⚠️ COMMON ERRORS AND RECOVERY

| Error Code | Meaning | Recovery |
|------------|---------|----------|
| UNAUTHENTICATED | Token expired/missing | Run sheets_auth status → login flow |
| PERMISSION_DENIED | No access to spreadsheet | Check spreadsheetId, request access |
| SPREADSHEET_NOT_FOUND | Invalid spreadsheetId | Verify ID from URL |
| SHEET_NOT_FOUND | Sheet name doesn't exist | Use sheets_core action:"list_sheets" |
| INVALID_RANGE | Bad A1 notation | Check format: "A1:B10" or "Sheet1!A1" |
| QUOTA_EXCEEDED | Too many requests | Wait 60 seconds, use batch operations with smaller chunks |
| INVALID_ARGUMENT | Bad parameter format/value | Check param types, use sheets_analyze.scout for validation |
| CONFLICT | Concurrent modification detected | Use sheets_quality.detect_conflicts, then resolve_conflict |
| TIMEOUT | Request took too long | Reduce range size, use batch_read with smaller chunks |
| AUTH_EXPIRED | Credentials no longer valid | Run sheets_auth.login to refresh token |
| RATE_LIMITED | Too many rapid requests | Use exponential backoff, check sheets_session.get_context |
| NOT_FOUND (chart) | Chart ID doesn't exist | Use sheets_visualize.chart_list to verify chart IDs |
| NOT_FOUND (range) | Named range doesn't exist | Use sheets_advanced.list_named_ranges |
| PROTECTED_RANGE | Range is protected | Use sheets_advanced to check protection |

**Before destructive ops (delete, clear, bulk overwrite):**
- Use \`dryRun: true\` to preview; use \`sheets_confirm\` for >100 cells; set \`safety.maxCellsAffected\` to limit blast radius
- Example recovery: \`sheets_auth status\` → check scopes → re-login if missing; \`sheets_core list_sheets\` for exact sheet names (emoji/unicode issues)
- NEVER retry \`append\` on timeout (NOT idempotent, duplicates data); use \`sheets_data.write\` for known positions instead

## 🎨 COLOR FORMAT

All colors use **0-1 scale** (NOT 0-255):
\`\`\`json
{ "red": 0.2, "green": 0.6, "blue": 0.8 }
\`\`\`

## 📚 RESOURCE DISCOVERY

- Use \`tools/list\` descriptions plus inline \`x-servalsheets.actionParams\` hints as the primary source for request shapes
- Read \`servalsheets://index\` when you need a resource catalog and your client supports MCP resource reads
- Read \`sheets:///{spreadsheetId}/context\` for full structural metadata (sheets, charts, named ranges, protection, filters — 1 API call, no cell data)
- Search \`knowledge:///search?q={query}\` for domain-specific guidance (formulas, API limits, templates)
- Read \`servalsheets://guides/{topic}\` for optimization guides (quota, batching, caching, error recovery)

## 🏗️ ADVANCED SHEET PATTERNS

**Multi-tab spreadsheet with cross-sheet lookups?**
→ \`sheets_agent action:"plan" description:"Create Products + Orders sheets with XLOOKUP from Orders→Products"\`
→ The agent generates the full multi-step plan: create sheets → write headers → inject XLOOKUP formulas

**Full analytics dashboard (KPIs + charts + slicers)?**
→ \`sheets_composite action:"build_dashboard" dataSheet:"Sales" layout:"full_analytics"\`
→ Assembles KPI row, charts, slicers, formatting in one action

**Dependent dropdowns (e.g., Country → Cities)?**
→ \`sheets_format action:"build_dependent_dropdown" parentRange:"Sheet1!A2:A100" dependentRange:"Sheet1!B2:B100" lookupSheet:"Lookup"\`
→ Handles named ranges + INDIRECT formula + data validation automatically

**VLOOKUP detected? Upgrade to XLOOKUP?**
→ \`sheets_analyze action:"analyze_formulas"\` → check \`upgradeOpportunities\` → \`sheets_data action:"write"\` with XLOOKUP formula
→ XLOOKUP is more robust: left-lookup, default value, exact/approximate match control

**Pivot table + interactive slicer?**
→ \`sheets_visualize action:"pivot_create"\` → \`sheets_dimensions action:"create_slicer" dataRange:"same source range"\`
→ Do NOT combine create_slicer with set_basic_filter on the same range

**Dynamic filter formula (show only active rows)?**
→ \`sheets_analyze action:"generate_formula" description:"FILTER formula showing rows where Status column equals Active"\`
→ Returns FILTER formula that spills results dynamically (no manual refresh needed)

**Running total column?**
→ \`sheets_analyze action:"generate_formula" description:"running total of column B starting at row 2"\`
→ Returns \`=SUM($B$2:B2)\` — drag down to extend

**Budget vs. Actuals comparison?**
→ \`sheets_agent action:"plan" description:"Create Budget sheet + Actuals sheet + Variance sheet with formulas =Actuals!B2-Budget!B2"\`
`;

  const deferredSchemaInstructions = `
## 📋 INLINE PARAMETER HINTS (IMPORTANT)

**Tool schemas may be deferred to save tokens.** Treat the tool description and inline
\`x-servalsheets.actionParams\` hints from \`tools/list\` as the canonical source for actions,
required fields, and common request shapes.

**When to re-check inline hints:**
- First time using a tool in this conversation
- When you need to know which actions are available
- When you get validation errors (check required fields for the selected action)
`;

  // Include deferred schema instructions when DEFER_SCHEMAS is enabled
  if (DEFER_SCHEMAS) {
    return (baseInstructions + deferredSchemaInstructions).trim();
  }

  return baseInstructions.trim();
}

/**
 * Server instructions for LLM context (static export for backward compatibility)
 *
 * @deprecated Use getServerInstructions() instead for dynamic content
 */
export const SERVER_INSTRUCTIONS = getServerInstructions();
