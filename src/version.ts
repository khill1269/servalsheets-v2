/**
 * ServalSheets - Version Information
 *
 * Single source of truth for version numbers.
 * Import this instead of hardcoding versions.
 */

import type { Icon } from '@modelcontextprotocol/sdk/types.js';
import {
  SERVER_ICON_DATA_URI,
  SERVER_ICON_MIME_TYPE,
  SERVER_ICON_SIZES,
} from './config/server-icon.js';
import { MCP_PROTOCOL_VERSION } from './config/protocol.js';

/** Current version - sync with package.json */
export const VERSION = '2.0.0';

/** Protocol version */
export { MCP_PROTOCOL_VERSION };

/** Server info for MCP initialization */
export const SERVER_INFO = {
  name: 'servalsheets',
  version: VERSION,
  protocolVersion: MCP_PROTOCOL_VERSION,
} as const;

/** Server icon metadata for client UIs (inline SVG to avoid dead GitHub asset URLs) */
export const SERVER_ICONS: Icon[] = [
  {
    src: SERVER_ICON_DATA_URI,
    mimeType: SERVER_ICON_MIME_TYPE,
    sizes: [...SERVER_ICON_SIZES],
  },
];

/** Human-readable version string */
export const VERSION_STRING = `ServalSheets v${VERSION} (MCP ${MCP_PROTOCOL_VERSION})`;
