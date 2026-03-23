---
title: Compliance-Grade Audit Logging
category: general
last_updated: 2026-03-10
description: ServalSheets implements enterprise-grade audit logging for SOC 2, HIPAA, and GDPR compliance.
version: 1.6.0
tags: [prometheus]
---

# Compliance-Grade Audit Logging

ServalSheets implements enterprise-grade audit logging for SOC 2, HIPAA, and GDPR compliance.

## Overview

The audit logging system provides:

- **W5 audit format** (Who, What, When, Where, Why)
- **Immutable storage** with append-only logs
- **Tamper-proof integrity** using cryptographic signatures
- **100% mutation coverage** for all data operations
- **SIEM integration** for real-time monitoring
- **7-year retention** for compliance requirements

## Architecture

### Storage Layer

**Primary Storage**: JSON Lines (append-only)

```
audit-logs/
├── 2026-02-17.jsonl          # Daily log files
├── 2026-02-16.jsonl
├── 2026-02-15.jsonl
└── current.jsonl → 2026-02-17.jsonl  # Symlink to current log
```

**Log Entry Format** (JSON Lines):

```json
{
  "sequenceNumber": 1,
  "event": {
    "userId": "user@example.com",
    "action": "write_range",
    "tool": "sheets_data",
    "resource": {
      "type": "range",
      "spreadsheetId": "1ABC...",
      "range": "Sheet1!A1:B10"
    },
    "outcome": "success",
    "timestamp": "2026-02-17T06:25:42.123Z",
    "ipAddress": "203.0.113.42",
    "requestId": "550e8400-e29b-41d4-a716-446655440000"
  },
  "hash": "a3b2c1d4e5f6...",
  "previousHash": "0000000000..."
}
```

### Integrity Chain

Each audit entry includes:

1. **Sequence Number**: Monotonically increasing (1, 2, 3, ...)
2. **Hash**: HMAC-SHA256(sequenceNumber + event + previousHash)
3. **Previous Hash**: Hash of previous entry (chain of trust)

**Genesis Entry**: First entry has `previousHash = "0000..."`

**Verification**:

```bash
# Verify audit log integrity
npm run verify:audit

# Or programmatically
import { getAuditLogger } from './services/audit-logger.js';
const isValid = await getAuditLogger().verifyIntegrity();
```

## W5 Audit Format

Every audit event captures:

### 1. WHO (Identity)

- **userId**: User identifier (email, sub claim, API key ID)
- **sessionId**: Session identifier for correlation
- **clientId**: OAuth client ID
- **apiKeyId**: API key identifier (not the key itself)

### 2. WHAT (Action)

- **action**: Action performed (e.g., `write_range`, `share_spreadsheet`)
- **tool**: MCP tool invoked (e.g., `sheets_data`)
- **resource**: Resource affected (spreadsheet, range, permission)
- **outcome**: `success` | `failure` | `partial`
- **errorCode**: Error code if outcome is failure
- **errorMessage**: Error message (sanitized, no PII)

### 3. WHEN (Temporal)

- **timestamp**: ISO 8601 timestamp with millisecond precision
- **durationMs**: Operation duration in milliseconds

### 4. WHERE (Location)

- **ipAddress**: Source IP address (IPv4 or IPv6)
- **geoLocation**: Geographic location (city, country)
- **userAgent**: User agent string
- **endpoint**: API endpoint invoked

### 5. WHY (Context)

- **requestId**: Request ID for correlation
- **scopes**: OAuth scopes granted
- **reason**: Business justification (e.g., "emergency access")

## Event Categories

### Data Mutations

All operations that modify spreadsheet data:

- `write_range` - Write values to range
- `append_rows` - Append rows to sheet
- `clear_range` - Clear range contents
- `delete_rows` - Delete rows
- `delete_columns` - Delete columns
- `insert_rows` - Insert rows
- `insert_columns` - Insert columns
- `apply_formatting` - Apply cell formatting

**Metadata Captured**:

- `cellsModified`: Number of cells affected
- `rowsModified`: Number of rows affected
- `columnsModified`: Number of columns affected
- `snapshot`: Snapshot ID for rollback

### Permission Changes

All operations that modify access control:

- `share_spreadsheet` - Share spreadsheet with user
- `update_permissions` - Update user permissions
- `revoke_access` - Revoke user access
- `transfer_ownership` - Transfer ownership

**Metadata Captured**:

- `permission.role`: `owner` | `writer` | `reader`
- `permission.email`: User email
- `permission.domain`: Domain for domain-wide sharing
- `permission.anyone`: Public access flag

### Authentication

All identity verification events:

- `login` - User login
- `logout` - User logout
- `token_refresh` - OAuth token refresh
- `token_revoke` - OAuth token revocation
- `oauth_grant` - OAuth authorization granted

**Metadata Captured**:

- `method`: `oauth` | `api_key` | `service_account` | `managed_identity`
- `failureReason`: Reason for authentication failure

### Exports

All data extraction operations:

- `export_csv` - Export to CSV
- `export_xlsx` - Export to XLSX
- `export_bigquery` - Export to BigQuery
- `download_attachment` - Download file attachment

**Metadata Captured**:

- `format`: Export format (csv, xlsx, pdf)
- `recordCount`: Number of records exported
- `fileSize`: File size in bytes
- `destination`: Destination (sanitized, no credentials)

### Configuration

All system configuration changes:

- `update_env` - Update environment variable
- `toggle_feature` - Toggle feature flag
- `adjust_rate_limit` - Adjust rate limit

**Metadata Captured**:

- `configKey`: Configuration key changed
- `oldValue`: Previous value (sanitized, no secrets)
- `newValue`: New value (sanitized, no secrets)

## Usage

### Manual Logging

```typescript
import { getAuditLogger } from './services/audit-logger.js';

const auditLogger = getAuditLogger();

// Log data mutation
await auditLogger.logMutation({
  userId: 'user@example.com',
  action: 'write_range',
  resource: {
    type: 'range',
    spreadsheetId: '1ABC...',
    range: 'Sheet1!A1:B10',
  },
  outcome: 'success',
  cellsModified: 20,
  ipAddress: req.ip,
  requestId: req.headers['x-request-id'],
});

// Log permission change
await auditLogger.logPermissionChange({
  userId: 'admin@example.com',
  action: 'share_spreadsheet',
  resource: {
    type: 'permission',
    spreadsheetId: '1ABC...',
  },
  outcome: 'success',
  permission: {
    role: 'writer',
    email: 'user@example.com',
  },
  ipAddress: req.ip,
  requestId: req.headers['x-request-id'],
});

// Log authentication event
await auditLogger.logAuthentication({
  userId: 'user@example.com',
  action: 'login',
  resource: { type: 'token' },
  outcome: 'success',
  method: 'oauth',
  ipAddress: req.ip,
  requestId: req.headers['x-request-id'],
  userAgent: req.headers['user-agent'],
});
```

### Automatic Logging (Middleware)

```typescript
import { createAuditMiddleware } from './middleware/audit-middleware.js';
import { getAuditLogger } from './services/audit-logger.js';

const auditLogger = getAuditLogger();
const auditMiddleware = createAuditMiddleware(auditLogger);

// Wrap handler execution
const result = await auditMiddleware.wrap('sheets_data', 'write_range', args, () =>
  handler.executeAction(args)
);
```

The middleware automatically:

- Detects which actions require audit logging
- Extracts user context from request
- Logs appropriate event type (mutation, permission, auth, export)
- Captures success/failure outcome
- Does not block on audit logging failures

## SIEM Integration

### Splunk HTTP Event Collector

**Environment Variables**:

```bash
AUDIT_SPLUNK_ENDPOINT=https://splunk.example.com:8088/services/collector
AUDIT_SPLUNK_TOKEN=your-hec-token
```

**Event Format**:

```json
{
  "event": { ...audit event... },
  "sourcetype": "servalsheets:audit",
  "source": "audit-logger",
  "index": "audit",
  "fields": {
    "sequence_number": 123,
    "hash": "a3b2c1d4...",
    "previous_hash": "0000..."
  }
}
```

### Datadog Logs API

**Environment Variables**:

```bash
AUDIT_DATADOG_ENDPOINT=https://http-intake.logs.datadoghq.com/v1/input
AUDIT_DATADOG_API_KEY=your-dd-api-key
```

**Event Format**:

```json
{
  "ddsource": "servalsheets",
  "ddtags": "env:production,service:audit-logger",
  "hostname": "servalsheets-01",
  "message": "{ ...audit event... }",
  "service": "audit-logger",
  "status": "success",
  "sequence_number": 123,
  "hash": "a3b2c1d4..."
}
```

### AWS CloudWatch Logs

**Environment Variables**:

```bash
AUDIT_CLOUDWATCH_LOG_GROUP=/servalsheets/audit
AUDIT_CLOUDWATCH_LOG_STREAM=production
AWS_REGION=us-east-1
```

Requires AWS SDK for CloudWatch Logs integration.

### Azure Monitor Logs

**Environment Variables**:

```bash
AUDIT_AZURE_ENDPOINT=https://logs.azure.com/v1/ingest
AUDIT_AZURE_API_KEY=your-azure-api-key
```

Requires Azure SDK for Monitor Logs integration.

## Compliance Requirements

### SOC 2 (Trust Services Criteria)

**CC6.1 - Logical and Physical Access Controls**:

- ✅ All access attempts logged (authentication events)
- ✅ Failed authentication attempts logged with reason
- ✅ User identity captured in all events

**CC6.2 - Prior to Issuing System Credentials**:

- ✅ Credential issuance logged (oauth_grant events)
- ✅ Token refresh logged (token_refresh events)
- ✅ Token revocation logged (token_revoke events)

**CC7.2 - System Operations**:

- ✅ All data mutations logged with outcome
- ✅ Configuration changes logged with old/new values
- ✅ Tamper-proof integrity via cryptographic signatures

**CC7.3 - Monitoring of Controls**:

- ✅ 7-year retention policy via date-based log files
- ✅ SIEM integration for real-time monitoring
- ✅ Integrity verification available on demand

### HIPAA (Health Insurance Portability and Accountability Act)

**§164.312(b) - Audit Controls**:

- ✅ All PHI access logged with user identity
- ✅ Timestamp with millisecond precision
- ✅ IP address and location captured

**§164.312(d) - Person or Entity Authentication**:

- ✅ All authentication events logged
- ✅ Failed authentication attempts logged
- ✅ Multi-factor authentication events captured

**§164.312(a)(2)(ii) - Emergency Access Procedure**:

- ✅ Emergency access logged with reason field
- ✅ Break-glass access distinguishable via reason

**§164.316(b)(2)(i) - Retention of Documentation**:

- ✅ 6-year retention minimum (7-year default)
- ✅ Immutable storage prevents deletion
- ✅ Daily log files enable date-based archival

### GDPR (General Data Protection Regulation)

**Article 30 - Records of Processing Activities**:

- ✅ All data processing logged with purpose
- ✅ Legal basis captured in metadata
- ✅ Data subject identifier captured

**Article 15 - Right of Access by Data Subject**:

- ✅ Audit trail can be filtered by data subject
- ✅ Export functionality for subject access requests
- ✅ Structured format (JSON) for machine processing

**Article 17 - Right to Erasure**:

- ✅ Data erasure operations logged
- ✅ Compliance with retention periods
- ✅ Audit trail preserved even after data deletion

**Article 33 - Notification of Personal Data Breach**:

- ✅ All data access logged with timestamp
- ✅ Failed access attempts logged (potential breach indicator)
- ✅ 72-hour breach notification enabled via audit trail analysis

## Security Features

### Tamper-Proof Guarantees

**Cryptographic Integrity**:

- HMAC-SHA256 signature for each entry
- Chain of hashes (current entry includes previous hash)
- Secret key rotation support

**Append-Only Storage**:

- File opened with O_APPEND flag (atomic appends)
- No update or delete operations
- Atomic writes with fsync()

**Access Controls**:

- File permissions: 0640 (owner read/write, group read)
- Separate audit user/group (not application user)
- SELinux/AppArmor policies recommended

### Secret Management

**HMAC Secret**:

```bash
# Generate strong HMAC secret
AUDIT_HMAC_SECRET=$(openssl rand -hex 32)
export AUDIT_HMAC_SECRET

# Or use environment variable
echo "AUDIT_HMAC_SECRET=your-secret-here" >> .env
```

**Secret Rotation**:

1. Generate new HMAC secret
2. Update environment variable
3. New entries use new secret
4. Old entries remain valid with old secret
5. Keep old secrets for verification

### PII Sanitization

**Automatic Redaction**:

- Configuration values containing "secret", "token", "key" are redacted
- Error messages sanitized to remove sensitive data
- User identifiers normalized (email → hashed ID)

**Manual Sanitization**:

```typescript
// Sanitize config value before logging
const sanitized = value.includes('secret') ? '[REDACTED]' : value;

await auditLogger.logConfiguration({
  configKey: 'API_KEY',
  oldValue: sanitized,
  newValue: sanitized,
  ...
});
```

## Compliance Reports

### Audit Trail Export

```typescript
import { getAuditLogger } from './services/audit-logger.js';
import { promises as fs } from 'fs';

const auditLogger = getAuditLogger();

// Read audit log
const logPath = './audit-logs/2026-02-17.jsonl';
const content = await fs.readFile(logPath, 'utf-8');
const entries = content.trim().split('\n').map(JSON.parse);

// Filter by user
const userEntries = entries.filter((e) => e.event.userId === 'user@example.com');

// Export to CSV
const csv = entries.map((e) => ({
  timestamp: e.event.timestamp,
  userId: e.event.userId,
  action: e.event.action,
  resource: JSON.stringify(e.event.resource),
  outcome: e.event.outcome,
  ipAddress: e.event.ipAddress,
}));

await fs.writeFile('audit-report.csv', csvStringify(csv));
```

### Integrity Verification Report

```typescript
import { getAuditLogger } from './services/audit-logger.js';

const auditLogger = getAuditLogger();

// Verify integrity
const isValid = await auditLogger.verifyIntegrity();

console.log(`Audit log integrity: ${isValid ? 'VALID' : 'COMPROMISED'}`);

// If compromised, find tampered entries
if (!isValid) {
  // Manual verification with detailed error messages
  // See logs for specific integrity violations
}
```

### Compliance Dashboard

**Key Metrics**:

- Total audit events logged
- Events by outcome (success/failure)
- Events by action type
- Failed authentication attempts
- Data export operations
- Permission changes
- Configuration changes

**Visualization**:

```bash
# Export metrics to Prometheus
curl http://localhost:3000/metrics | grep audit

# Example metrics:
# servalsheets_audit_events_total{outcome="success"} 1234
# servalsheets_audit_events_total{outcome="failure"} 56
# servalsheets_audit_mutations_total 890
# servalsheets_audit_permission_changes_total 45
# servalsheets_audit_authentication_attempts_total 123
```

## Performance Considerations

### Write Performance

**Throughput**: ~10,000 events/second (single thread, SSD)

- JSON serialization: ~0.01ms
- HMAC computation: ~0.05ms
- File append: ~0.04ms
- Total latency: ~0.1ms per event

**Optimization**:

- Batch writes for high-throughput scenarios
- Async SIEM delivery (non-blocking)
- Daily log rotation to prevent large files
- SSD storage recommended

### Storage Requirements

**Per Event**: ~500 bytes (JSON)

- 1,000 events/day = 500 KB/day = 180 MB/year
- 10,000 events/day = 5 MB/day = 1.8 GB/year
- 100,000 events/day = 50 MB/day = 18 GB/year

**Compression**: gzip compression reduces size by ~70%

- 100,000 events/day = 50 MB/day → 15 MB/day compressed
- 7-year retention = 38 GB compressed

**Archival Strategy**:

1. Keep last 30 days hot (local SSD)
2. Compress and move to warm storage (31-365 days)
3. Archive to cold storage (S3 Glacier, 1-7 years)

## Troubleshooting

### Log File Not Found

**Symptom**: `ENOENT: no such file or directory`

**Solution**: Ensure audit log directory exists

```bash
mkdir -p ./audit-logs
chmod 750 ./audit-logs
```

### Integrity Verification Failed

**Symptom**: `verifyIntegrity()` returns `false`

**Possible Causes**:

1. Log file manually edited
2. HMAC secret changed
3. Filesystem corruption

**Resolution**:

1. Check logs for specific integrity violations
2. Restore from backup
3. Regenerate audit trail from source data (if available)

### SIEM Delivery Failure

**Symptom**: Logs not appearing in SIEM dashboard

**Debug Steps**:

1. Check SIEM endpoint configuration
2. Verify API token/key is valid
3. Check network connectivity
4. Review application logs for delivery errors

**Non-Blocking**: SIEM delivery failures do not block operations

## Best Practices

### Configuration

1. **Use Strong HMAC Secret**: 32 bytes (256 bits) minimum
2. **Rotate Secrets Annually**: Keep old secrets for verification
3. **Enable SIEM Integration**: Real-time monitoring catches issues faster
4. **Test Integrity Verification**: Run weekly to detect tampering
5. **Automate Archival**: Move old logs to cold storage

### Operations

1. **Monitor Audit Log Growth**: Set alerts for unusual volume
2. **Review Failed Events**: Investigate failed authentication attempts
3. **Analyze Permission Changes**: Detect privilege escalation
4. **Track Export Operations**: Monitor data exfiltration risks
5. **Verify SIEM Delivery**: Check SIEM dashboard daily

### Security

1. **Restrict File Access**: Audit logs readable only by audit user/group
2. **Use Separate Audit User**: Not the application user
3. **Enable SELinux/AppArmor**: Prevent unauthorized access
4. **Encrypt at Rest**: Enable filesystem encryption
5. **Encrypt in Transit**: Use HTTPS for SIEM delivery

## References

- [SOC 2 Trust Services Criteria](https://www.aicpa.org/interestareas/frc/assuranceadvisoryservices/aicpasoc2report.html)
- [HIPAA Security Rule](https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html)
- [GDPR Regulation](https://gdpr-info.eu/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [JSON Lines Format](https://jsonlines.org/)
- [Splunk HEC](https://docs.splunk.com/Documentation/Splunk/latest/Data/UsetheHTTPEventCollector)
- [Datadog Logs API](https://docs.datadoghq.com/api/latest/logs/)
