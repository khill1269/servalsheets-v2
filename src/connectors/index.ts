/**
 * ServalSheets - Connector Framework
 *
 * Barrel export for all connector types, manager, and built-in connectors.
 */

// Core types and interfaces
export * from './types.js';

// Connector manager (singleton)
export {
  ConnectorManager,
  connectorManager,
  applyTransform,
  registerBuiltinConnectors,
  initializeBuiltinConnectors,
} from './connector-manager.js';

// Built-in connectors
export { FinnhubConnector } from './finnhub.js';
export { FredConnector } from './fred.js';
export { FmpConnector } from './fmp.js';
export { AlphaVantageConnector } from './alpha-vantage.js';
export { PolygonConnector } from './polygon.js';
export { WebSearchConnector } from './web-search-connector.js';

// Finance connectors
export { SecEdgarConnector } from './sec-edgar-connector.js';
export { WorldBankConnector } from './world-bank-connector.js';
export { OpenFigiConnector } from './openfigi-connector.js';

// Google Workspace connectors
export { GmailConnector } from './gmail-connector.js';
export { DriveConnector } from './drive-connector.js';
export { DocsConnector } from './docs-connector.js';

// Bridge connectors
export { McpBridgeConnector } from './mcp-bridge.js';
export { GenericRestConnector } from './rest-generic.js';
