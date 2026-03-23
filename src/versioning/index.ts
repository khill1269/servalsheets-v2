/**
 * Schema Versioning Module
 */

export {
  type SchemaVersion,
  type DeprecationStatus,
  type VersionMetadata,
  type VersionSelection,
  SchemaVersionManager,
  schemaVersionManager,
  DEFAULT_VERSION,
  LATEST_VERSION,
  extractVersionFromRequest,
  addDeprecationHeaders,
} from './schema-manager.js';

export {
  transformRequestV1ToV2,
  transformResponseV2ToV1,
  V1CompatibilityLayer,
  isActionDeprecated,
  getV2ActionName,
  getV1ActionName,
} from './v1-compat.js';

export {
  type MigrationResult,
  type MigrationWarning,
  type MigrationStrategy,
  SchemaMigrator,
  schemaMigrator,
  migrateRequest,
} from './migration-utils.js';
