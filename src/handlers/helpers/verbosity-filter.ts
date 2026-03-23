/**
 * ServalSheets - Verbosity Filter Helper
 *
 * Re-exports the applyVerbosityFilter utility for standalone handlers
 * (those that do not extend BaseHandler).
 *
 * BaseHandler subclasses use the protected method at base.ts:1479.
 * Standalone handlers (quality, session, history, auth, transaction, confirm)
 * import this function directly instead of duplicating the private method.
 */

export { applyVerbosityFilter } from './validation-helpers.js';
