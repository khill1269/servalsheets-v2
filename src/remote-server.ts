/**
 * ServalSheets - Remote Server Entry Point
 *
 * @deprecated Use createHttpServer with enableOAuth: true
 * This file is kept for backward compatibility only.
 *
 * The remote server functionality has been consolidated into http-server.ts.
 * Use the startRemoteServer() function from http-server.ts or index.ts instead.
 */

export { startRemoteServer } from './http-server.js';
