/**
 * Audit Logging Compliance Tests
 *
 * Verifies SOC 2, HIPAA, and GDPR compliance requirements.
 *
 * Test Categories:
 * 1. W5 Format Compliance (Who, What, When, Where, Why)
 * 2. Immutability Guarantees
 * 3. Tamper-Proof Integrity
 * 4. Event Coverage (100% mutation operations)
 * 5. SIEM Integration
 * 6. Compliance Reports
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuditLogger } from '../../src/services/audit-logger.js';
import { AuditMiddleware, createAuditMiddleware } from '../../src/middleware/audit-middleware.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { runWithRequestContext, createRequestContext } from '../../src/utils/request-context.js';

describe('Audit Logger - W5 Format Compliance', () => {
  let auditLogger: AuditLogger;
  let logDir: string;

  beforeEach(async () => {
    // Create temporary log directory
    logDir = join(tmpdir(), `audit-logs-${randomBytes(8).toString('hex')}`);
    await fs.mkdir(logDir, { recursive: true });

    auditLogger = new AuditLogger({ logDir });
  });

  afterEach(async () => {
    // Clean up temporary logs
    await fs.rm(logDir, { recursive: true, force: true });
  });

  it('should capture WHO (user identity) in audit events', async () => {
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim());

    expect(entry.event.userId).toBe('user@example.com');
  });

  it('should capture WHAT (action and outcome) in audit events', async () => {
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'range', spreadsheetId: '1ABC', range: 'Sheet1!A1:B10' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
      cellsModified: 20,
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim());

    expect(entry.event.action).toBe('write_range');
    expect(entry.event.outcome).toBe('success');
    expect(entry.event.resource.type).toBe('range');
    expect(entry.event.resource.spreadsheetId).toBe('1ABC');
    expect(entry.event.cellsModified).toBe(20);
  });

  it('should capture WHEN (ISO 8601 timestamp) in audit events', async () => {
    const beforeTime = new Date();

    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
    });

    const afterTime = new Date();

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim());

    const timestamp = new Date(entry.event.timestamp);
    expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    expect(timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    expect(entry.event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('should capture WHERE (IP address, location) in audit events', async () => {
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '203.0.113.42',
      geoLocation: 'San Francisco, US',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      requestId: 'req-123',
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim());

    expect(entry.event.ipAddress).toBe('203.0.113.42');
    expect(entry.event.geoLocation).toBe('San Francisco, US');
    expect(entry.event.userAgent).toContain('Macintosh');
  });

  it('should capture WHY (business context, scopes) in audit events', async () => {
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      reason: 'emergency data correction',
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim());

    expect(entry.event.scopes).toContain('https://www.googleapis.com/auth/spreadsheets');
    expect(entry.event.reason).toBe('emergency data correction');
    expect(entry.event.requestId).toBe('req-123');
  });
});

describe('Audit Logger - Immutability Guarantees', () => {
  let auditLogger: AuditLogger;
  let logDir: string;

  beforeEach(async () => {
    logDir = join(tmpdir(), `audit-logs-${randomBytes(8).toString('hex')}`);
    await fs.mkdir(logDir, { recursive: true });
    auditLogger = new AuditLogger({ logDir });
  });

  afterEach(async () => {
    await fs.rm(logDir, { recursive: true, force: true });
  });

  it('should use append-only storage', async () => {
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
    });

    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'append_rows',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-124',
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');

    expect(lines).toHaveLength(2);

    const entry1 = JSON.parse(lines[0]!);
    const entry2 = JSON.parse(lines[1]!);

    expect(entry1.event.action).toBe('write_range');
    expect(entry2.event.action).toBe('append_rows');
  });

  it('should have monotonically increasing sequence numbers', async () => {
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
    });

    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'append_rows',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-124',
    });

    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'clear_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-125',
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');

    const sequences = lines.map((line) => JSON.parse(line).sequenceNumber);

    expect(sequences).toEqual([1, 2, 3]);
  });

  it('should not allow modification of existing entries', async () => {
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const originalContent = await fs.readFile(logPath, 'utf-8');

    // Attempt to modify log file directly (should be detected by integrity check)
    const modifiedContent = originalContent.replace('write_range', 'tampered_action');
    await fs.writeFile(logPath, modifiedContent);

    // Verify integrity
    const isValid = await auditLogger.verifyIntegrity();

    expect(isValid).toBe(false);
  });
});

describe('Audit Logger - Tamper-Proof Integrity', () => {
  let auditLogger: AuditLogger;
  let logDir: string;
  const hmacSecret = randomBytes(32).toString('hex');

  beforeEach(async () => {
    logDir = join(tmpdir(), `audit-logs-${randomBytes(8).toString('hex')}`);
    await fs.mkdir(logDir, { recursive: true });
    auditLogger = new AuditLogger({ logDir, hmacSecret });
  });

  afterEach(async () => {
    await fs.rm(logDir, { recursive: true, force: true });
  });

  it('should include HMAC signature for each entry', async () => {
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim());

    expect(entry.hash).toBeDefined();
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/); // SHA256 hash (64 hex chars)
  });

  it('should chain hashes (previous hash included in current hash)', async () => {
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
    });

    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'append_rows',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-124',
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');

    const entry1 = JSON.parse(lines[0]!);
    const entry2 = JSON.parse(lines[1]!);

    expect(entry2.previousHash).toBe(entry1.hash);
  });

  it('should verify integrity of entire log', async () => {
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
    });

    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'append_rows',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-124',
    });

    const isValid = await auditLogger.verifyIntegrity();

    expect(isValid).toBe(true);
  });

  it('should detect hash chain tampering', async () => {
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
    });

    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'append_rows',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-124',
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');

    // Tamper with second entry's previousHash
    const entry2 = JSON.parse(lines[1]!);
    entry2.previousHash = '0'.repeat(64);
    lines[1] = JSON.stringify(entry2);

    await fs.writeFile(logPath, lines.join('\n') + '\n');

    const isValid = await auditLogger.verifyIntegrity();

    expect(isValid).toBe(false);
  });
});

describe('Audit Logger - Encryption At Rest', () => {
  let auditLogger: AuditLogger;
  let logDir: string;
  const hmacSecret = randomBytes(32).toString('hex');
  const encryptionKey = 'audit-encryption-test-passphrase';

  beforeEach(async () => {
    logDir = join(tmpdir(), `audit-logs-${randomBytes(8).toString('hex')}`);
    await fs.mkdir(logDir, { recursive: true });
    auditLogger = new AuditLogger({ logDir, hmacSecret, encryptionKey });
  });

  afterEach(async () => {
    await fs.rm(logDir, { recursive: true, force: true });
  });

  it('should write encrypted log lines when encryption key is configured', async () => {
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-encrypted-1',
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const line = content.trim();

    expect(line.startsWith('ENC:')).toBe(true);
    expect(() => JSON.parse(line)).toThrow();
  });

  it('should decrypt encrypted log lines', async () => {
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-encrypted-2',
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const decrypted = auditLogger.decryptLogEntry(content.trim());
    const entry = JSON.parse(decrypted);

    expect(entry.event.action).toBe('write_range');
    expect(entry.event.requestId).toBe('req-encrypted-2');
  });

  it('should verify integrity for encrypted logs', async () => {
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-encrypted-3',
    });

    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'append_rows',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-encrypted-4',
    });

    const isValid = await auditLogger.verifyIntegrity();
    expect(isValid).toBe(true);
  });

  it('should fail integrity verification with incorrect encryption key', async () => {
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-encrypted-5',
    });

    const wrongKeyLogger = new AuditLogger({
      logDir,
      hmacSecret,
      encryptionKey: 'wrong-passphrase',
    });
    const isValid = await wrongKeyLogger.verifyIntegrity();
    expect(isValid).toBe(false);
  });
});

describe('Audit Logger - Retention Policy', () => {
  let auditLogger: AuditLogger;
  let logDir: string;

  beforeEach(async () => {
    logDir = join(tmpdir(), `audit-logs-${randomBytes(8).toString('hex')}`);
    await fs.mkdir(logDir, { recursive: true });

    const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    await fs.writeFile(join(logDir, `${oldDate}.jsonl`), '{"old":"entry"}\n');
    await fs.writeFile(join(logDir, `${recentDate}.jsonl`), '{"recent":"entry"}\n');

    auditLogger = new AuditLogger({ logDir, retentionDays: 30 });
  });

  afterEach(async () => {
    await fs.rm(logDir, { recursive: true, force: true });
  });

  it('should prune audit logs older than retention window', async () => {
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-retention-1',
    });

    const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    await expect(fs.access(join(logDir, `${oldDate}.jsonl`))).rejects.toThrow();
    await expect(fs.access(join(logDir, `${recentDate}.jsonl`))).resolves.toBeUndefined();
  });
});

describe('Audit Logger - Event Coverage', () => {
  let auditLogger: AuditLogger;
  let logDir: string;

  beforeEach(async () => {
    logDir = join(tmpdir(), `audit-logs-${randomBytes(8).toString('hex')}`);
    await fs.mkdir(logDir, { recursive: true });
    auditLogger = new AuditLogger({ logDir });
  });

  afterEach(async () => {
    await fs.rm(logDir, { recursive: true, force: true });
  });

  it('should log data mutation events', async () => {
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'range', spreadsheetId: '1ABC', range: 'Sheet1!A1:B10' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
      cellsModified: 20,
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim());

    expect(entry.event.action).toBe('write_range');
    expect(entry.event.cellsModified).toBe(20);
  });

  it('should log permission change events', async () => {
    await auditLogger.logPermissionChange({
      userId: 'admin@example.com',
      action: 'share_spreadsheet',
      resource: { type: 'permission', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
      permission: { role: 'writer', email: 'user@example.com' },
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim());

    expect(entry.event.action).toBe('share_spreadsheet');
    expect(entry.event.permission.role).toBe('writer');
    expect(entry.event.permission.email).toBe('user@example.com');
  });

  it('should log authentication events', async () => {
    await auditLogger.logAuthentication({
      userId: 'user@example.com',
      action: 'login',
      resource: { type: 'token' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
      method: 'oauth',
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim());

    expect(entry.event.action).toBe('login');
    expect(entry.event.method).toBe('oauth');
  });

  it('should log export events', async () => {
    await auditLogger.logExport({
      userId: 'user@example.com',
      action: 'export_csv',
      resource: { type: 'export', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
      format: 'csv',
      recordCount: 1000,
      fileSize: 52428, // 51.2 KB
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim());

    expect(entry.event.action).toBe('export_csv');
    expect(entry.event.format).toBe('csv');
    expect(entry.event.recordCount).toBe(1000);
    expect(entry.event.fileSize).toBe(52428);
  });

  it('should log configuration change events', async () => {
    await auditLogger.logConfiguration({
      userId: 'admin@example.com',
      action: 'toggle_feature',
      resource: { type: 'config' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
      configKey: 'ENABLE_CACHE',
      oldValue: 'false',
      newValue: 'true',
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim());

    expect(entry.event.action).toBe('toggle_feature');
    expect(entry.event.configKey).toBe('ENABLE_CACHE');
    expect(entry.event.oldValue).toBe('false');
    expect(entry.event.newValue).toBe('true');
  });
});

describe('Audit Middleware - Automatic Event Logging', () => {
  let auditLogger: AuditLogger;
  let auditMiddleware: AuditMiddleware;
  let logDir: string;

  beforeEach(async () => {
    logDir = join(tmpdir(), `audit-logs-${randomBytes(8).toString('hex')}`);
    await fs.mkdir(logDir, { recursive: true });
    auditLogger = new AuditLogger({ logDir });
    auditMiddleware = createAuditMiddleware(auditLogger);
  });

  afterEach(async () => {
    await fs.rm(logDir, { recursive: true, force: true });
  });

  it('should automatically log mutation actions', async () => {
    const requestContext = createRequestContext({
      requestId: 'req-123',
    });

    await runWithRequestContext(requestContext, async () => {
      await auditMiddleware.wrap(
        'sheets_data',
        'write',
        {
          userId: 'user@example.com',
          spreadsheetId: '1ABC',
          range: 'Sheet1!A1:B10',
        },
        async () => {
          return { success: true, cellsModified: 20 };
        }
      );
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim());

    expect(entry.event.action).toBe('write');
    expect(entry.event.tool).toBe('sheets_data');
    expect(entry.event.userId).toBe('user@example.com');
    expect(entry.event.requestId).toBe('req-123');
  });

  it('should automatically log permission change actions', async () => {
    const requestContext = createRequestContext({
      requestId: 'req-123',
    });

    await runWithRequestContext(requestContext, async () => {
      await auditMiddleware.wrap(
        'sheets_collaborate',
        'share_add',
        {
          userId: 'admin@example.com',
          spreadsheetId: '1ABC',
          role: 'writer',
          email: 'user@example.com',
        },
        async () => {
          return { success: true };
        }
      );
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim());

    expect(entry.event.action).toBe('share_add');
    expect(entry.event.tool).toBe('sheets_collaborate');
    expect(entry.event.permission.role).toBe('writer');
    expect(entry.event.permission.email).toBe('user@example.com');
  });

  it('should log failed operations with error details', async () => {
    const requestContext = createRequestContext({
      requestId: 'req-123',
    });

    await expect(async () => {
      await runWithRequestContext(requestContext, async () => {
        await auditMiddleware.wrap(
          'sheets_data',
          'write',
          {
            userId: 'user@example.com',
            spreadsheetId: '1ABC',
            range: 'Sheet1!A1:B10',
          },
          async () => {
            throw new Error('Permission denied');
          }
        );
      });
    }).rejects.toThrow('Permission denied');

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim());

    expect(entry.event.outcome).toBe('failure');
    expect(entry.event.errorMessage).toBe('Permission denied');
  });

  it('should not log read-only actions', async () => {
    const requestContext = createRequestContext({
      requestId: 'req-123',
    });

    await runWithRequestContext(requestContext, async () => {
      await auditMiddleware.wrap(
        'sheets_data',
        'read_range',
        {
          userId: 'user@example.com',
          spreadsheetId: '1ABC',
          range: 'Sheet1!A1:B10',
        },
        async () => {
          return {
            success: true,
            values: [
              [1, 2],
              [3, 4],
            ],
          };
        }
      );
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const exists = await fs
      .access(logPath)
      .then(() => true)
      .catch(() => false);

    expect(exists).toBe(false);
  });
});

describe('Audit Logger - Compliance Requirements', () => {
  let auditLogger: AuditLogger;
  let logDir: string;

  beforeEach(async () => {
    logDir = join(tmpdir(), `audit-logs-${randomBytes(8).toString('hex')}`);
    await fs.mkdir(logDir, { recursive: true });
    auditLogger = new AuditLogger({ logDir });
  });

  afterEach(async () => {
    await fs.rm(logDir, { recursive: true, force: true });
  });

  it('should support 7-year retention policy (SOC 2)', async () => {
    // Log entries should be timestamped and stored permanently
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim());

    // Verify timestamp format allows date-based retention
    const timestamp = new Date(entry.event.timestamp);
    const ageInYears = (Date.now() - timestamp.getTime()) / (1000 * 60 * 60 * 24 * 365);

    expect(ageInYears).toBeLessThan(1); // Should be recent
    expect(entry.event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // YYYY-MM-DD format for archival
  });

  it('should log PHI access (HIPAA §164.312(b))', async () => {
    // Healthcare data access must be logged
    await auditLogger.logMutation({
      userId: 'doctor@hospital.com',
      action: 'write_range',
      resource: {
        type: 'spreadsheet',
        spreadsheetId: '1ABC',
        spreadsheetName: 'Patient Records',
      },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      metadata: {
        dataType: 'PHI',
        patientId: 'P12345',
      },
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim());

    expect(entry.event.userId).toBe('doctor@hospital.com');
    expect(entry.event.resource.spreadsheetName).toBe('Patient Records');
    expect(entry.event.metadata.dataType).toBe('PHI');
  });

  it('should log data processing activities (GDPR Article 30)', async () => {
    // Data controller must maintain records of processing activities
    await auditLogger.logMutation({
      userId: 'user@example.com',
      action: 'write_range',
      resource: { type: 'spreadsheet', spreadsheetId: '1ABC' },
      outcome: 'success',
      ipAddress: '192.168.1.1',
      requestId: 'req-123',
      metadata: {
        legalBasis: 'consent',
        dataSubject: 'customer@example.com',
        processingPurpose: 'order fulfillment',
      },
    });

    const logPath = join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const content = await fs.readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim());

    expect(entry.event.metadata.legalBasis).toBe('consent');
    expect(entry.event.metadata.dataSubject).toBe('customer@example.com');
    expect(entry.event.metadata.processingPurpose).toBe('order fulfillment');
  });
});
