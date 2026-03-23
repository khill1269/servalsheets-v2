/**
 * Schema Version Management System
 *
 * Manages multiple schema versions with backward compatibility.
 * Supports version negotiation, deprecation warnings, and migration paths.
 */

import { logger } from '../utils/logger.js';
import { ServiceError } from '../core/errors.js';

export type SchemaVersion = 'v1' | 'v2';
export type DeprecationStatus = 'active' | 'deprecated' | 'sunset';

export interface VersionMetadata {
  version: SchemaVersion;
  status: DeprecationStatus;
  releaseDate: string;
  deprecationDate?: string;
  sunsetDate?: string;
  description: string;
  breakingChanges?: string[];
  migrationGuide?: string;
}

export interface VersionSelection {
  requestedVersion?: SchemaVersion;
  selectedVersion: SchemaVersion;
  isDeprecated: boolean;
  deprecationWarning?: string;
}

const VERSION_REGISTRY: Map<SchemaVersion, VersionMetadata> = new Map([
  [
    'v1',
    {
      version: 'v1',
      status: 'active',
      releaseDate: '2026-01-01',
      description: 'Initial schema version - Current stable release',
    },
  ],
  [
    'v2',
    {
      version: 'v2',
      status: 'active',
      releaseDate: '2026-03-01',
      description: 'Enhanced schema with improved validation',
      breakingChanges: [
        'Renamed actions: copy_to → copy_sheet_to',
        'Stricter spreadsheetId validation',
      ],
      migrationGuide: 'docs/guides/MIGRATION_V1_TO_V2.md',
    },
  ],
]);

export const DEFAULT_VERSION: SchemaVersion = 'v1';
export const LATEST_VERSION: SchemaVersion = 'v2';

export class SchemaVersionManager {
  selectVersion(queryParam?: string, header?: string): VersionSelection {
    let requestedVersion = this.parseVersion(queryParam);
    if (!requestedVersion && header) {
      requestedVersion = this.parseVersion(header);
    }

    const selectedVersion = requestedVersion || DEFAULT_VERSION;
    const metadata = this.getVersionMetadata(selectedVersion);
    const isDeprecated = metadata.status === 'deprecated';
    const deprecationWarning = isDeprecated ? this.generateDeprecationWarning(metadata) : undefined;

    logger.debug('Schema version selected', {
      requestedVersion,
      selectedVersion,
      isDeprecated,
    });

    return {
      requestedVersion,
      selectedVersion,
      isDeprecated,
      deprecationWarning,
    };
  }

  getVersionMetadata(version: SchemaVersion): VersionMetadata {
    const metadata = VERSION_REGISTRY.get(version);
    if (!metadata) {
      throw new ServiceError(
        `Unknown schema version: ${version}`,
        'INTERNAL_ERROR',
        'schema-manager',
        false
      );
    }
    return metadata;
  }

  getAllVersions(): VersionMetadata[] {
    return Array.from(VERSION_REGISTRY.values());
  }

  isDeprecated(version: SchemaVersion): boolean {
    const metadata = this.getVersionMetadata(version);
    return metadata.status === 'deprecated' || metadata.status === 'sunset';
  }

  private parseVersion(versionString?: string): SchemaVersion | undefined {
    if (!versionString) {
      return undefined;
    }

    const normalized = versionString.toLowerCase().trim();
    if (normalized === 'v1' || normalized === '1') {
      return 'v1';
    }
    if (normalized === 'v2' || normalized === '2') {
      return 'v2';
    }

    logger.warn('Invalid version string', { versionString });
    return undefined;
  }

  private generateDeprecationWarning(metadata: VersionMetadata): string {
    const parts = [`Schema version ${metadata.version} is deprecated.`];
    if (metadata.deprecationDate) {
      parts.push(`Deprecated since: ${metadata.deprecationDate}.`);
    }
    if (metadata.sunsetDate) {
      parts.push(`Will be removed on: ${metadata.sunsetDate}.`);
    }
    parts.push(`Please migrate to ${LATEST_VERSION}.`);
    if (metadata.migrationGuide) {
      parts.push(`Migration guide: ${metadata.migrationGuide}`);
    }
    return parts.join(' ');
  }
}

export const schemaVersionManager = new SchemaVersionManager();

export function extractVersionFromRequest(req: {
  query?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
}): VersionSelection {
  const queryVersion = req.query?.['version'] as string | undefined;
  const headerVersion = Array.isArray(req.headers?.['x-schema-version'])
    ? req.headers['x-schema-version'][0]
    : (req.headers?.['x-schema-version'] as string | undefined);

  return schemaVersionManager.selectVersion(queryVersion, headerVersion);
}

export function addDeprecationHeaders(
  res: { setHeader(name: string, value: string): void },
  versionSelection: VersionSelection
): void {
  if (versionSelection.isDeprecated && versionSelection.deprecationWarning) {
    res.setHeader('X-Schema-Version-Deprecated', 'true');
    res.setHeader('X-Schema-Version-Warning', versionSelection.deprecationWarning);
    res.setHeader('X-Schema-Version-Latest', LATEST_VERSION);
  }
  res.setHeader('X-Schema-Version', versionSelection.selectedVersion);
}
