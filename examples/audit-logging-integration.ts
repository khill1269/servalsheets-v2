/**
 * Audit Logging Integration Example
 *
 * Demonstrates how to integrate compliance-grade audit logging
 * into ServalSheets MCP server.
 */

import { getAuditLogger } from '../src/services/audit-logger.js';
import { createAuditMiddleware } from '../src/middleware/audit-middleware.js';
import { runWithRequestContext, createRequestContext } from '../src/utils/request-context.js';

/**
 * Example 1: Manual audit logging
 *
 * Use this approach when you need fine-grained control over
 * audit events (e.g., logging external API calls, custom events).
 */
async function manualAuditLogging() {
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
    ipAddress: '203.0.113.42',
    requestId: crypto.randomUUID(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  console.log('✅ Mutation event logged');

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
    ipAddress: '203.0.113.42',
    requestId: crypto.randomUUID(),
  });

  console.log('✅ Permission change logged');

  // Log authentication event
  await auditLogger.logAuthentication({
    userId: 'user@example.com',
    action: 'login',
    resource: { type: 'token' },
    outcome: 'success',
    method: 'oauth',
    ipAddress: '203.0.113.42',
    requestId: crypto.randomUUID(),
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  });

  console.log('✅ Authentication event logged');

  // Log export event
  await auditLogger.logExport({
    userId: 'user@example.com',
    action: 'export_csv',
    resource: {
      type: 'export',
      spreadsheetId: '1ABC...',
    },
    outcome: 'success',
    format: 'csv',
    recordCount: 1000,
    fileSize: 52428, // 51.2 KB
    ipAddress: '203.0.113.42',
    requestId: crypto.randomUUID(),
  });

  console.log('✅ Export event logged');

  // Verify integrity
  const isValid = await auditLogger.verifyIntegrity();
  console.log(`\n🔒 Audit log integrity: ${isValid ? 'VALID' : 'COMPROMISED'}`);
}

/**
 * Example 2: Automatic audit logging (middleware)
 *
 * Use this approach for automatic logging of MCP tool calls.
 * The middleware automatically detects mutation operations and
 * logs appropriate audit events.
 */
async function automaticAuditLogging() {
  const auditLogger = getAuditLogger();
  const auditMiddleware = createAuditMiddleware(auditLogger);

  // Create request context
  const requestContext = createRequestContext({
    requestId: crypto.randomUUID(),
  });

  // Wrap handler execution with audit middleware
  await runWithRequestContext(requestContext, async () => {
    // Example: sheets_data write_range
    await auditMiddleware.wrap(
      'sheets_data',
      'write_range',
      {
        userId: 'user@example.com',
        spreadsheetId: '1ABC...',
        range: 'Sheet1!A1:B10',
        values: [
          [1, 2],
          [3, 4],
        ],
      },
      async () => {
        // Simulate handler execution
        return {
          success: true,
          cellsModified: 20,
          response: { updatedCells: 20 },
        };
      }
    );

    console.log('✅ Mutation automatically logged');

    // Example: sheets_collaborate share_spreadsheet
    await auditMiddleware.wrap(
      'sheets_collaborate',
      'share_spreadsheet',
      {
        userId: 'admin@example.com',
        spreadsheetId: '1ABC...',
        role: 'writer',
        email: 'user@example.com',
      },
      async () => {
        // Simulate handler execution
        return {
          success: true,
          response: { permissionId: 'perm-123' },
        };
      }
    );

    console.log('✅ Permission change automatically logged');

    // Example: Read-only operation (not logged)
    await auditMiddleware.wrap(
      'sheets_data',
      'read_range',
      {
        userId: 'user@example.com',
        spreadsheetId: '1ABC...',
        range: 'Sheet1!A1:B10',
      },
      async () => {
        // Simulate handler execution
        return {
          success: true,
          values: [
            [1, 2],
            [3, 4],
          ],
        };
      }
    );

    console.log('✅ Read operation (not logged, as expected)');
  });

  // Verify integrity
  const isValid = await auditLogger.verifyIntegrity();
  console.log(`\n🔒 Audit log integrity: ${isValid ? 'VALID' : 'COMPROMISED'}`);
}

/**
 * Example 3: SIEM integration
 *
 * Configure SIEM endpoints for real-time audit log streaming.
 */
function siemIntegration() {
  console.log('\n📊 SIEM Integration Configuration\n');

  console.log('1. Splunk HTTP Event Collector:');
  console.log('   export AUDIT_SPLUNK_ENDPOINT=https://splunk.example.com:8088/services/collector');
  console.log('   export AUDIT_SPLUNK_TOKEN=your-hec-token\n');

  console.log('2. Datadog Logs API:');
  console.log('   export AUDIT_DATADOG_ENDPOINT=https://http-intake.logs.datadoghq.com/v1/input');
  console.log('   export AUDIT_DATADOG_API_KEY=your-dd-api-key\n');

  console.log('3. AWS CloudWatch Logs:');
  console.log('   export AUDIT_CLOUDWATCH_LOG_GROUP=/servalsheets/audit');
  console.log('   export AUDIT_CLOUDWATCH_LOG_STREAM=production');
  console.log('   export AWS_REGION=us-east-1\n');

  console.log('4. Azure Monitor Logs:');
  console.log('   export AUDIT_AZURE_ENDPOINT=https://logs.azure.com/v1/ingest');
  console.log('   export AUDIT_AZURE_API_KEY=your-azure-api-key\n');

  console.log('Events will be streamed to all configured SIEM systems.');
}

/**
 * Example 4: Compliance reporting
 *
 * Generate compliance reports from audit logs.
 */
async function complianceReporting() {
  const auditLogger = getAuditLogger();

  console.log('\n📋 Compliance Reporting\n');

  // Log sample events
  await auditLogger.logMutation({
    userId: 'user@example.com',
    action: 'write_range',
    resource: { type: 'spreadsheet', spreadsheetId: '1ABC...' },
    outcome: 'success',
    ipAddress: '203.0.113.42',
    requestId: crypto.randomUUID(),
  });

  await auditLogger.logAuthentication({
    userId: 'user@example.com',
    action: 'login',
    resource: { type: 'token' },
    outcome: 'success',
    method: 'oauth',
    ipAddress: '203.0.113.42',
    requestId: crypto.randomUUID(),
  });

  await auditLogger.logPermissionChange({
    userId: 'admin@example.com',
    action: 'share_spreadsheet',
    resource: { type: 'permission', spreadsheetId: '1ABC...' },
    outcome: 'success',
    permission: { role: 'writer', email: 'user@example.com' },
    ipAddress: '203.0.113.42',
    requestId: crypto.randomUUID(),
  });

  // Verify integrity
  const isValid = await auditLogger.verifyIntegrity();

  console.log('Compliance Report:');
  console.log('==================');
  console.log(`Audit Log Integrity: ${isValid ? 'VALID ✅' : 'COMPROMISED ❌'}`);
  console.log(`Storage Location: ${process.cwd()}/audit-logs/`);
  console.log(`Current Date: ${new Date().toISOString().split('T')[0]}`);
  console.log('\nCompliance Standards:');
  console.log('  ✅ SOC 2 (Trust Services Criteria)');
  console.log('  ✅ HIPAA (Health Insurance Portability and Accountability Act)');
  console.log('  ✅ GDPR (General Data Protection Regulation)');
  console.log('\nRetention Policy:');
  console.log('  📅 7 years (configurable)');
  console.log('  🔒 Immutable, append-only storage');
  console.log('  🔐 Cryptographic integrity (HMAC-SHA256)');
}

/**
 * Example 5: Tamper detection
 *
 * Demonstrate tamper-proof integrity verification.
 */
async function tamperDetection() {
  const auditLogger = getAuditLogger();

  console.log('\n🔒 Tamper Detection Example\n');

  // Log events
  await auditLogger.logMutation({
    userId: 'user@example.com',
    action: 'write_range',
    resource: { type: 'spreadsheet', spreadsheetId: '1ABC...' },
    outcome: 'success',
    ipAddress: '203.0.113.42',
    requestId: crypto.randomUUID(),
  });

  await auditLogger.logMutation({
    userId: 'user@example.com',
    action: 'append_rows',
    resource: { type: 'spreadsheet', spreadsheetId: '1ABC...' },
    outcome: 'success',
    ipAddress: '203.0.113.42',
    requestId: crypto.randomUUID(),
  });

  // Verify integrity (should pass)
  let isValid = await auditLogger.verifyIntegrity();
  console.log(`Initial integrity check: ${isValid ? 'VALID ✅' : 'COMPROMISED ❌'}`);

  // Note: In a real scenario, if someone modifies the log file directly,
  // the next integrity check would fail due to broken hash chain.
  console.log('\nIntegrity guarantees:');
  console.log('  🔗 Chain of hashes (each entry includes previous hash)');
  console.log('  🔐 HMAC-SHA256 signatures');
  console.log('  📝 Append-only storage (no updates/deletes)');
  console.log('  ⚠️  Any modification breaks the chain');
}

/**
 * Run all examples
 */
async function main() {
  console.log('🔍 ServalSheets Audit Logging Integration Examples\n');
  console.log('='.repeat(60));

  try {
    // Example 1: Manual logging
    console.log('\n📝 Example 1: Manual Audit Logging\n');
    await manualAuditLogging();

    // Example 2: Automatic logging
    console.log('\n\n🤖 Example 2: Automatic Audit Logging (Middleware)\n');
    await automaticAuditLogging();

    // Example 3: SIEM integration
    siemIntegration();

    // Example 4: Compliance reporting
    await complianceReporting();

    // Example 5: Tamper detection
    await tamperDetection();

    console.log('\n' + '='.repeat(60));
    console.log('✅ All examples completed successfully!\n');
    console.log('📁 Audit logs stored in: ./audit-logs/');
    console.log('📖 Documentation: docs/compliance/AUDIT_LOGGING.md\n');
  } catch (error) {
    console.error('❌ Error running examples:', error);
    process.exit(1);
  }
}

// Run examples if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
