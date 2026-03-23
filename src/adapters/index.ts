/**
 * ServalSheets - Backend Adapters
 *
 * SpreadsheetBackend implementations for specific platforms.
 *
 * GoogleSheetsBackend is the production backend.
 * Excel, Notion, and Airtable backends are scaffolds — not production-ready.
 * They are excluded from the default build unless ENABLE_EXPERIMENTAL_BACKENDS=true.
 * See H-10 in AQUI-VR_v3.2_Framework.md.
 */
export { GoogleSheetsBackend } from './google-sheets-backend.js';

// Scaffold backends: require explicit opt-in. These are not yet implemented and throw at runtime.
export { ExcelOnlineBackend } from './excel-online-backend.js';
export type { GraphClient, GraphRequest, ExcelOnlineConfig } from './excel-online-backend.js';
export { NotionBackend } from './notion-backend.js';
export type { NotionClient, NotionBackendConfig } from './notion-backend.js';
export { AirtableBackend } from './airtable-backend.js';
export type { AirtableClient, AirtableBackendConfig } from './airtable-backend.js';
