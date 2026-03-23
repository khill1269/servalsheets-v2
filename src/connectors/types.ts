/**
 * ServalSheets - Connector Types
 *
 * Defines the interfaces for the data connector framework.
 * All connector plugins implement SpreadsheetConnector.
 */

// ============================================================================
// Connector Interface
// ============================================================================

export interface SpreadsheetConnector {
  /** Unique connector identifier (e.g., 'finnhub', 'fred') */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Brief description of data available */
  readonly description: string;

  /** Authentication method required */
  readonly authType: 'api_key' | 'oauth2' | 'none';

  /** Whether this connector is currently configured and healthy */
  isConfigured(): boolean;

  // Lifecycle
  configure(credentials: ConnectorCredentials): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  dispose(): Promise<void>;

  // Discovery
  listEndpoints(): Promise<DataEndpoint[]>;
  getSchema(endpoint: string): Promise<DataSchema>;

  // Data
  query(endpoint: string, params: QueryParams): Promise<DataResult>;

  // Metadata
  getQuotaUsage(): QuotaStatus;
  getRateLimits(): RateLimitInfo;
}

// ============================================================================
// Credentials
// ============================================================================

export interface ConnectorCredentials {
  type: 'api_key' | 'oauth2' | 'none';
  apiKey?: string;
  oauth?: {
    clientId: string;
    clientSecret: string;
    accessToken?: string;
    refreshToken?: string;
  };
  custom?: Record<string, string>;
}

// ============================================================================
// Health & Status
// ============================================================================

export interface HealthStatus {
  healthy: boolean;
  latencyMs: number;
  message?: string;
  lastChecked: string;
}

export interface QuotaStatus {
  used: number;
  limit: number;
  resetAt: string;
  unit: 'requests' | 'tokens' | 'credits';
}

export interface RateLimitInfo {
  requestsPerMinute: number;
  requestsPerDay: number;
  burstLimit?: number;
}

// ============================================================================
// Discovery
// ============================================================================

export interface DataEndpoint {
  id: string;
  name: string;
  description: string;
  category: string;
  params: EndpointParam[];
}

export interface EndpointParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  required: boolean;
  description: string;
  example?: string;
}

export interface DataSchema {
  endpoint: string;
  columns: ColumnDef[];
  sampleRow?: Record<string, unknown>;
}

export interface ColumnDef {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  description?: string;
}

// ============================================================================
// Query
// ============================================================================

export interface QueryParams {
  [key: string]: string | number | boolean | undefined;
}

export interface DataResult {
  headers: string[];
  rows: (string | number | boolean | null)[][];
  metadata: {
    source: string;
    endpoint: string;
    fetchedAt: string;
    rowCount: number;
    cached: boolean;
    quotaUsed: number;
  };
}

// ============================================================================
// Subscriptions
// ============================================================================

export interface RefreshSchedule {
  interval: 'hourly' | 'daily' | 'weekly' | 'custom';
  customCronExpression?: string;
  timezone?: string;
}

export interface Subscription {
  id: string;
  connectorId: string;
  endpoint: string;
  params: QueryParams;
  schedule: RefreshSchedule;
  destination: {
    spreadsheetId: string;
    range: string;
  };
  status: 'active' | 'paused' | 'error';
  lastRefresh?: string;
  nextRefresh?: string;
  errorMessage?: string;
}

// ============================================================================
// Transform
// ============================================================================

export interface TransformSpec {
  filter?: {
    column: string;
    operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'starts_with';
    value: string | number;
  }[];
  sort?: {
    column: string;
    direction: 'asc' | 'desc';
  }[];
  limit?: number;
  columns?: string[];
  aggregate?: {
    column: string;
    function: 'sum' | 'avg' | 'min' | 'max' | 'count';
    groupBy?: string;
  }[];
  // P5.4: New transform types
  aggregateV2?: {
    groupBy: string;
    operations: Array<{ column: string; function: 'sum' | 'avg' | 'count' | 'min' | 'max' }>;
  };
  calculate?: Array<{ expression: string; as: string }>;
  pivot?: { rowKey: string; pivotColumn: string; valueColumn: string };
  deduplicate?: { column: string };
}

// ============================================================================
// Connector Registry Entry
// ============================================================================

export interface ConnectorRegistryEntry {
  connector: SpreadsheetConnector;
  configured: boolean;
  lastHealthCheck?: HealthStatus;
}
