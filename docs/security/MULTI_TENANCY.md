---
title: ServalSheets Multi-Tenancy Guide
category: general
last_updated: 2026-03-10
description: 'Status: Production Ready'
version: 1.6.0
tags: [security, sheets, prometheus, grafana, kubernetes]
---

# ServalSheets Multi-Tenancy Guide

**Status:** Production Ready
**Version:** 1.7.0
**Last Updated:** 2026-02-17

## Overview

ServalSheets supports multi-tenant deployments, enabling SaaS providers to serve multiple customers on shared infrastructure while maintaining complete data isolation.

## Architecture

### Core Components

1. **Tenant Context Service** (`src/services/tenant-context.ts`)
   - Tenant metadata storage and retrieval
   - API key generation and validation
   - Quota tracking and enforcement
   - Row-level security validation

2. **Tenant Isolation Middleware** (`src/middleware/tenant-isolation.ts`)
   - API key extraction from Authorization header
   - Tenant context injection into requests
   - Spreadsheet access validation
   - Automatic quota enforcement

3. **Data Isolation Layer**
   - Tenant ID injection into all database queries
   - Spreadsheet-level access control
   - Zero cross-tenant data leakage (verified by tests)

## Quick Start

### 1. Enable Multi-Tenancy Mode

Set environment variable:

```bash
export SERVALSHEETS_MULTI_TENANT=true
```

### 2. Create Tenant

```typescript
import { tenantContextService } from './services/tenant-context.js';

const { metadata, apiKey } = await tenantContextService.createTenant('Acme Corp', {
  maxSpreadsheets: 100,
  maxApiCallsPerHour: 10000,
  maxConcurrentRequests: 50,
  enabledFeatures: ['advanced', 'bigquery', 'appsscript'],
});

console.log('Tenant ID:', metadata.tenantId);
console.log('API Key:', apiKey);
```

### 3. Use Tenant API Key

Clients authenticate with API key in Authorization header:

```bash
curl -H "Authorization: Bearer sk_..." \
  http://localhost:3000/api/tools/sheets_data \
  -d '{"action": "read", "spreadsheetId": "...", "range": "A1:B10"}'
```

### 4. Apply Middleware (HTTP Server Only)

```typescript
import express from 'express';
import { tenantIsolationMiddleware } from './middleware/tenant-isolation.js';

const app = express();

// Apply tenant isolation to all routes
app.use('/api', tenantIsolationMiddleware());

// Routes automatically have req.tenantContext available
app.post('/api/tools/:tool', async (req, res) => {
  const { tenantContext } = req;
  console.log('Request from tenant:', tenantContext.tenantId);
  // ...
});
```

## Security Model

### Data Isolation Guarantees

ServalSheets provides **100% data isolation** between tenants:

1. **API Key Isolation**
   - Each tenant has unique UUID-based tenant ID
   - API keys are cryptographically random (256 bits)
   - API key → tenant ID mapping is strictly enforced
   - Impossible to guess or enumerate API keys

2. **Spreadsheet Access Control**
   - All spreadsheet operations validate tenant ownership
   - Cross-tenant spreadsheet access is blocked
   - Validation happens before Google API calls

3. **Metadata Isolation**
   - Tenant metadata is stored separately per tenant
   - No shared state between tenants
   - Updates to one tenant don't affect others

4. **Quota Isolation**
   - Per-tenant rate limits enforced independently
   - One tenant cannot consume another's quota
   - Concurrent request limits prevent resource exhaustion

### Security Tests

The multi-tenancy implementation is verified by 20+ security tests:

```bash
npm run test:security -- tenant-isolation
```

Key test coverage:

- ✅ Zero data leakage between tenants
- ✅ API key validation and revocation
- ✅ Spreadsheet access control
- ✅ Quota isolation
- ✅ Tenant deletion and cleanup
- ✅ API key rotation security

## Tenant Management

### Create Tenant

```typescript
const { metadata, apiKey } = await tenantContextService.createTenant('Tenant Name', {
  maxSpreadsheets: 100,
  maxApiCallsPerHour: 10000,
  maxConcurrentRequests: 50,
  enabledFeatures: ['advanced', 'bigquery'],
  customDomain: 'tenant.example.com',
});
```

### Update Tenant

```typescript
const updated = await tenantContextService.updateTenant(tenantId, {
  name: 'New Name',
  settings: {
    maxApiCallsPerHour: 20000,
  },
});
```

### Suspend Tenant

```typescript
await tenantContextService.updateTenant(tenantId, {
  status: 'suspended',
});
```

### Delete Tenant (Soft Delete)

```typescript
await tenantContextService.deleteTenant(tenantId);
// Tenant marked as deleted, API keys revoked
```

### Rotate API Key

```typescript
const newApiKey = await tenantContextService.rotateApiKey(tenantId);
// Old API key is immediately revoked
```

### List Tenants

```typescript
const tenants = await tenantContextService.listTenants({
  offset: 0,
  limit: 50,
});
```

## Custom Storage Backend

The default in-memory storage is suitable for development. For production, implement custom storage:

```typescript
import { TenantStorage, TenantMetadata } from './services/tenant-context.js';

class PostgresTenantStorage implements TenantStorage {
  async get(tenantId: string): Promise<TenantMetadata | null> {
    const result = await db.query('SELECT * FROM tenants WHERE tenant_id = $1', [tenantId]);
    return result.rows[0] || null;
  }

  async create(metadata: Omit<TenantMetadata, 'createdAt' | 'updatedAt'>): Promise<TenantMetadata> {
    const result = await db.query(
      'INSERT INTO tenants (tenant_id, name, status, settings) VALUES ($1, $2, $3, $4) RETURNING *',
      [metadata.tenantId, metadata.name, metadata.status, JSON.stringify(metadata.settings)]
    );
    return result.rows[0];
  }

  async update(tenantId: string, updates: Partial<TenantMetadata>): Promise<TenantMetadata> {
    // Implement update logic
  }

  async delete(tenantId: string): Promise<void> {
    // Implement soft delete
  }

  async list(options?: { offset?: number; limit?: number }): Promise<TenantMetadata[]> {
    // Implement pagination
  }
}

// Use custom storage
const storage = new PostgresTenantStorage();
const service = new TenantContextService(storage);
```

## Quota Management

### Configure Per-Tenant Quotas

```typescript
await tenantContextService.createTenant('Tenant Name', {
  maxApiCallsPerHour: 10000, // Hourly API call limit
  maxConcurrentRequests: 50, // Concurrent request limit
  maxSpreadsheets: 100, // Max spreadsheets per tenant
});
```

### Enforce Quotas

Quotas are automatically enforced by the middleware:

1. **API Call Quota** - Tracked per hour, resets hourly
2. **Concurrent Requests** - Limited by in-flight request count
3. **Spreadsheet Limit** - Validated on create operations

### Monitor Quota Usage

```typescript
const context = await tenantContextService.extractTenantContext(apiKey);
console.log('Hourly quota remaining:', context.quotaRemaining.hourly);
console.log('Concurrent requests available:', context.quotaRemaining.concurrent);
```

## Advanced Quota Management

### Per-Operation Quota Limits

ServalSheets supports granular quota management with per-operation limits across multiple time windows:

```typescript
import { QuotaManager } from './services/quota-manager.js';

const quotaManager = new QuotaManager(redis);

// Set custom quota limits for tenant
await quotaManager.setQuotaLimits('tenant-123', {
  read: {
    hourly: 2000,
    daily: 20000,
    monthly: 500000,
  },
  write: {
    hourly: 200,
    daily: 2000,
    monthly: 50000,
  },
  admin: {
    hourly: 50,
    daily: 200,
    monthly: 5000,
  },
});
```

### Operation Classification

Actions are automatically classified by operation type:

| Operation Type | Actions                              | Examples                                                        |
| -------------- | ------------------------------------ | --------------------------------------------------------------- |
| **Read**       | Data retrieval, read-only operations | `read_range`, `get_sheet`, `list_sheets`, `get_metadata`        |
| **Write**      | Data modification operations         | `write_range`, `update_cells`, `append_row`, `clear_range`      |
| **Admin**      | Structural changes, admin operations | `create_spreadsheet`, `delete_sheet`, `copy_sheet`, `add_sheet` |

### Quota Enforcement Workflow

```typescript
// 1. Check quota before operation (automatic via middleware)
if (!await quotaManager.checkQuota(tenantId, 'read')) {
  throw new QuotaExceededError('Daily read quota exceeded');
}

// 2. Execute operation
const result = await sheets.spreadsheets.values.get({...});

// 3. Record usage after success (automatic via middleware)
await quotaManager.recordUsage(tenantId, 'read');
```

### Quota Dashboard Integration

Get comprehensive usage statistics for dashboard display:

```typescript
const stats = await quotaManager.getUsageStats('tenant-123');

console.log(stats);
// {
//   tenantId: 'tenant-123',
//   current: {
//     read: { hourly: 156, daily: 3420, monthly: 45600 },
//     write: { hourly: 12, daily: 234, monthly: 3120 },
//     admin: { hourly: 2, daily: 15, monthly: 180 }
//   },
//   limits: {
//     read: { hourly: 2000, daily: 20000, monthly: 500000 },
//     write: { hourly: 200, daily: 2000, monthly: 50000 },
//     admin: { hourly: 50, daily: 200, monthly: 5000 }
//   },
//   percentUsed: {
//     read: { hourly: 8, daily: 17, monthly: 9 },
//     write: { hourly: 6, daily: 12, monthly: 6 },
//     admin: { hourly: 4, daily: 8, monthly: 4 }
//   },
//   nextReset: {
//     hourly: '2026-02-17T16:00:00.000Z',
//     daily: '2026-02-18T00:00:00.000Z',
//     monthly: '2026-03-01T00:00:00.000Z'
//   }
// }
```

### Quota Reset Strategies

#### Automatic Resets

Quotas automatically reset at window boundaries using Redis TTL:

- **Hourly**: Resets at the top of each hour (e.g., 14:00, 15:00)
- **Daily**: Resets at midnight UTC
- **Monthly**: Resets on the 1st of each month at midnight UTC

#### Manual Resets

Administrators can manually reset quotas:

```typescript
// Reset specific window
await quotaManager.resetQuotas('tenant-123', 'hourly');

// Reset all windows
await quotaManager.resetQuotas('tenant-123', 'all');
```

### Quota Alerts

Implement proactive alerts when tenants approach quota limits:

```typescript
const stats = await quotaManager.getUsageStats(tenantId);

// Alert at 80% usage
if (stats.percentUsed.read.daily > 80) {
  await sendQuotaAlert(tenantId, {
    operation: 'read',
    window: 'daily',
    usage: stats.current.read.daily,
    limit: stats.limits.read.daily,
    percentUsed: stats.percentUsed.read.daily,
    nextReset: stats.nextReset.daily,
  });
}
```

### Burst Allowance

Configure burst allowance for temporary traffic spikes:

```typescript
// Allow 150% of hourly limit for short bursts
const burstLimit = stats.limits.read.hourly * 1.5;
const canBurst = stats.current.read.hourly < burstLimit;
```

---

## Billing Integration & Cost Tracking

### Billing Metadata

Tenant metadata includes optional billing information:

```typescript
const { metadata, apiKey } = await tenantContextService.createTenant('Tenant Name', {
  // ... settings
});

await tenantContextService.updateTenant(metadata.tenantId, {
  billingInfo: {
    plan: 'professional',
    billingEmail: 'billing@customer.com',
    subscriptionEndsAt: new Date('2027-01-01'),
    paymentMethod: 'stripe',
    stripeCustomerId: 'cus_...',
    trialEndsAt: new Date('2026-03-17'),
  },
});
```

### Usage-Based Billing

Track API usage for metered billing:

```typescript
import { CostTracker } from './services/cost-tracker.js';

const costTracker = new CostTracker(redis);

// Define pricing per operation type
await costTracker.setPricing({
  read: 0.001, // $0.001 per read operation
  write: 0.005, // $0.005 per write operation
  admin: 0.01, // $0.010 per admin operation
});

// Track costs automatically with usage
await quotaManager.recordUsage(tenantId, 'read');
await costTracker.recordCost(tenantId, 'read');

// Get monthly cost summary
const costs = await costTracker.getMonthlyCosts(tenantId);
// {
//   tenantId: 'tenant-123',
//   month: '2026-02',
//   operations: {
//     read: { count: 45600, cost: 45.60 },
//     write: { count: 3120, cost: 15.60 },
//     admin: { count: 180, cost: 1.80 }
//   },
//   total: 63.00,
//   currency: 'USD'
// }
```

### Billing Plans

Define tiered billing plans with quota limits:

```typescript
const BILLING_PLANS = {
  free: {
    monthlyPrice: 0,
    quotas: {
      read: { daily: 1000, monthly: 10000 },
      write: { daily: 100, monthly: 1000 },
      admin: { daily: 10, monthly: 100 },
    },
    features: ['core'],
  },
  starter: {
    monthlyPrice: 29,
    quotas: {
      read: { daily: 10000, monthly: 250000 },
      write: { daily: 1000, monthly: 25000 },
      admin: { daily: 100, monthly: 2500 },
    },
    features: ['core', 'advanced'],
  },
  professional: {
    monthlyPrice: 99,
    quotas: {
      read: { daily: 50000, monthly: 1500000 },
      write: { daily: 5000, monthly: 150000 },
      admin: { daily: 500, monthly: 15000 },
    },
    features: ['core', 'advanced', 'bigquery', 'appsscript'],
  },
  enterprise: {
    monthlyPrice: 499,
    quotas: {
      read: { daily: null, monthly: null }, // unlimited
      write: { daily: null, monthly: null },
      admin: { daily: null, monthly: null },
    },
    features: ['core', 'advanced', 'bigquery', 'appsscript', 'priority-support'],
  },
};

// Apply plan to tenant
async function applyPlan(tenantId: string, planName: keyof typeof BILLING_PLANS) {
  const plan = BILLING_PLANS[planName];

  await quotaManager.setQuotaLimits(tenantId, plan.quotas);
  await tenantContextService.updateTenant(tenantId, {
    settings: {
      enabledFeatures: plan.features,
    },
    billingInfo: {
      plan: planName,
    },
  });
}
```

### Invoice Generation

Generate monthly invoices based on usage:

```typescript
async function generateInvoice(tenantId: string, month: string) {
  const costs = await costTracker.getMonthlyCosts(tenantId);
  const tenant = await tenantContextService.getTenant(tenantId);
  const plan = BILLING_PLANS[tenant.billingInfo.plan];

  return {
    invoiceId: `INV-${tenantId}-${month}`,
    tenantId,
    billingPeriod: month,
    items: [
      {
        description: `${tenant.billingInfo.plan} Plan`,
        quantity: 1,
        unitPrice: plan.monthlyPrice,
        total: plan.monthlyPrice,
      },
      {
        description: 'API Usage Overage',
        quantity: costs.total,
        unitPrice: 1,
        total: costs.total,
      },
    ],
    subtotal: plan.monthlyPrice + costs.total,
    tax: (plan.monthlyPrice + costs.total) * 0.1, // 10% tax
    total: (plan.monthlyPrice + costs.total) * 1.1,
    currency: 'USD',
    dueDate: new Date(`${month}-28`),
  };
}
```

### Stripe Integration Example

```typescript
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Create Stripe customer during tenant creation
async function createTenantWithBilling(name: string) {
  // 1. Create Stripe customer
  const customer = await stripe.customers.create({
    name,
    metadata: { servalsheetsTenant: true },
  });

  // 2. Create ServalSheets tenant
  const { metadata, apiKey } = await tenantContextService.createTenant(name, {
    maxApiCallsPerHour: 1000,
  });

  // 3. Link Stripe customer to tenant
  await tenantContextService.updateTenant(metadata.tenantId, {
    billingInfo: {
      stripeCustomerId: customer.id,
      paymentMethod: 'stripe',
    },
  });

  return { metadata, apiKey, stripeCustomer: customer };
}

// Charge for monthly usage
async function chargeMonthlyUsage(tenantId: string, month: string) {
  const invoice = await generateInvoice(tenantId, month);
  const tenant = await tenantContextService.getTenant(tenantId);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(invoice.total * 100), // cents
    currency: 'usd',
    customer: tenant.billingInfo.stripeCustomerId,
    metadata: {
      tenantId,
      invoiceId: invoice.invoiceId,
      billingPeriod: month,
    },
  });

  return paymentIntent;
}
```

---

## Enhanced Tenant Isolation

### Network-Level Isolation

Deploy tenants in isolated Kubernetes namespaces with NetworkPolicies:

```yaml
# Network policy for tenant isolation
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: tenant-isolation
  namespace: tenant-123
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress

  # Allow ingress only from load balancer
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - protocol: TCP
          port: 3000

  # Allow egress to Google Sheets API and Redis only
  egress:
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              app: redis
      ports:
        - protocol: TCP
          port: 6379
    - to:
        - namespaceSelector: {}
      ports:
        - protocol: TCP
          port: 443 # Google Sheets API
    - to:
        - namespaceSelector:
            matchLabels:
              name: kube-system
      ports:
        - protocol: UDP
          port: 53 # DNS
```

### Resource Quotas

Enforce resource limits per tenant namespace:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: tenant-quota
  namespace: tenant-123
spec:
  hard:
    # Compute resources
    requests.cpu: '4'
    requests.memory: 8Gi
    limits.cpu: '8'
    limits.memory: 16Gi

    # Storage
    persistentvolumeclaims: '5'
    requests.storage: 100Gi

    # Object counts
    count/deployments.apps: '5'
    count/services: '5'
    count/configmaps: '10'
    count/secrets: '10'
    count/pods: '20'
```

### Database Isolation

Use separate database schemas or instances per tenant:

```typescript
// PostgreSQL schema-based isolation
async function getTenantDatabase(tenantId: string) {
  const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;

  // Create schema if not exists
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);

  // Set search path for all queries
  await db.query(`SET search_path TO ${schemaName}`);

  return {
    schema: schemaName,
    query: (sql: string, params?: any[]) =>
      db.query(`SET search_path TO ${schemaName}; ${sql}`, params),
  };
}
```

### Encryption at Rest

Encrypt tenant-specific data with tenant-specific encryption keys:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

class TenantEncryption {
  async encryptData(tenantId: string, data: string): Promise<string> {
    // Get tenant-specific encryption key (from KMS or secrets manager)
    const key = await this.getTenantKey(tenantId);
    const iv = randomBytes(16);

    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Return: iv + authTag + encrypted data (all base64 encoded)
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  async decryptData(tenantId: string, encryptedData: string): Promise<string> {
    const key = await this.getTenantKey(tenantId);
    const buffer = Buffer.from(encryptedData, 'base64');

    const iv = buffer.subarray(0, 16);
    const authTag = buffer.subarray(16, 32);
    const encrypted = buffer.subarray(32);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  private async getTenantKey(tenantId: string): Promise<Buffer> {
    // Fetch from AWS KMS, GCP KMS, Azure Key Vault, etc.
    // For example, using AWS KMS:
    // const { Plaintext } = await kms.decrypt({
    //   CiphertextBlob: tenantKeyData,
    // });
    // return Buffer.from(Plaintext);

    // Or derive from master key + tenant ID
    const masterKey = Buffer.from(process.env.MASTER_ENCRYPTION_KEY, 'hex');
    return crypto.pbkdf2Sync(tenantId, masterKey, 100000, 32, 'sha256');
  }
}
```

### Audit Logging

Log all tenant actions for compliance and security:

```typescript
import { AuditLogger } from './services/audit-logger.js';

const auditLogger = new AuditLogger(db);

// Log all tenant operations
app.use('/api', async (req, res, next) => {
  const start = Date.now();

  res.on('finish', async () => {
    await auditLogger.log({
      tenantId: req.tenantContext?.tenantId,
      action: `${req.method} ${req.path}`,
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      requestBody: req.body,
      responseStatus: res.statusCode,
      duration: Date.now() - start,
      timestamp: new Date(),
    });
  });

  next();
});

// Query audit logs
const logs = await auditLogger.query({
  tenantId: 'tenant-123',
  startDate: new Date('2026-02-01'),
  endDate: new Date('2026-02-28'),
  action: 'POST /api/tools/sheets_data',
});
```

---

## Automated Tenant Onboarding

### Self-Service Tenant Creation

Provide REST API for automated tenant provisioning:

```typescript
app.post('/api/admin/tenants', async (req, res) => {
  const { name, plan, email } = req.body;

  try {
    // 1. Create tenant
    const { metadata, apiKey } = await tenantContextService.createTenant(name, {
      maxApiCallsPerHour: BILLING_PLANS[plan].quotas.read.hourly,
    });

    // 2. Apply billing plan
    await applyPlan(metadata.tenantId, plan);

    // 3. Create Stripe customer
    const customer = await stripe.customers.create({
      name,
      email,
      metadata: { tenantId: metadata.tenantId },
    });

    // 4. Link Stripe customer
    await tenantContextService.updateTenant(metadata.tenantId, {
      billingInfo: {
        stripeCustomerId: customer.id,
        billingEmail: email,
        plan,
      },
    });

    // 5. Send welcome email
    await sendWelcomeEmail(email, {
      tenantId: metadata.tenantId,
      apiKey,
      dashboardUrl: `https://dashboard.example.com/tenants/${metadata.tenantId}`,
    });

    res.status(201).json({
      success: true,
      tenant: metadata,
      apiKey,
      stripeCustomer: customer,
    });
  } catch (error) {
    logger.error('Failed to create tenant', { error });
    res.status(500).json({ error: 'Failed to create tenant' });
  }
});
```

### Onboarding Workflow

Implement multi-step onboarding with progress tracking:

```typescript
enum OnboardingStep {
  CREATED = 'created',
  EMAIL_VERIFIED = 'email_verified',
  BILLING_SETUP = 'billing_setup',
  API_KEY_GENERATED = 'api_key_generated',
  FIRST_API_CALL = 'first_api_call',
  COMPLETED = 'completed',
}

interface OnboardingStatus {
  tenantId: string;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  startedAt: Date;
  completedAt?: Date;
  progress: number; // 0-100
}

class OnboardingService {
  async getStatus(tenantId: string): Promise<OnboardingStatus> {
    const status = await redis.get(`onboarding:${tenantId}`);
    return status ? JSON.parse(status) : this.initializeOnboarding(tenantId);
  }

  async completeStep(tenantId: string, step: OnboardingStep): Promise<void> {
    const status = await this.getStatus(tenantId);

    if (!status.completedSteps.includes(step)) {
      status.completedSteps.push(step);
    }

    // Calculate progress
    const allSteps = Object.values(OnboardingStep);
    status.progress = Math.round((status.completedSteps.length / allSteps.length) * 100);

    // Update current step
    const stepIndex = allSteps.indexOf(step);
    if (stepIndex < allSteps.length - 1) {
      status.currentStep = allSteps[stepIndex + 1];
    } else {
      status.currentStep = OnboardingStep.COMPLETED;
      status.completedAt = new Date();
    }

    await redis.set(`onboarding:${tenantId}`, JSON.stringify(status));

    // Send progress notification
    await this.sendProgressNotification(tenantId, status);
  }

  private async sendProgressNotification(tenantId: string, status: OnboardingStatus) {
    const tenant = await tenantContextService.getTenant(tenantId);

    if (status.progress === 100) {
      await sendEmail(tenant.billingInfo.billingEmail, {
        subject: 'Welcome to ServalSheets - Setup Complete!',
        body: `Your account is ready. Visit your dashboard: https://dashboard.example.com/tenants/${tenantId}`,
      });
    }
  }
}
```

### Terraform Provider

Enable infrastructure-as-code tenant provisioning:

```hcl
# terraform/servalsheets.tf
terraform {
  required_providers {
    servalsheets = {
      source = "servalsheets/servalsheets"
      version = "~> 1.0"
    }
  }
}

provider "servalsheets" {
  api_endpoint = "https://api.servalsheets.com"
  admin_api_key = var.admin_api_key
}

# Create tenant
resource "servalsheets_tenant" "acme_corp" {
  name = "Acme Corp"

  settings = {
    max_api_calls_per_hour = 5000
    max_concurrent_requests = 100
    enabled_features = ["core", "advanced", "bigquery"]
  }

  billing_info = {
    plan = "professional"
    billing_email = "billing@acme.com"
  }
}

# Output API key (sensitive)
output "acme_api_key" {
  value = servalsheets_tenant.acme_corp.api_key
  sensitive = true
}
```

### Kubernetes Operator for Multi-Tenancy

Automate tenant namespace and resource creation:

```yaml
apiVersion: servalsheets.io/v1alpha1
kind: Tenant
metadata:
  name: acme-corp
spec:
  displayName: 'Acme Corp'
  plan: professional

  resources:
    requests:
      cpu: '2'
      memory: 4Gi
    limits:
      cpu: '4'
      memory: 8Gi

  quotas:
    read:
      hourly: 5000
      daily: 50000
    write:
      hourly: 500
      daily: 5000

  isolation:
    networkPolicy: true
    encryption: true

  billing:
    email: billing@acme.com
    stripeCustomerId: cus_...
```

The operator automatically creates:

- Kubernetes namespace (`tenant-acme-corp`)
- ResourceQuota
- NetworkPolicy
- ServiceAccount with RBAC
- ServalSheetsServer custom resource
- Secrets for API keys and encryption keys

---

## Monitoring & Tenant Analytics

### Per-Tenant Metrics

Track comprehensive metrics for each tenant:

```typescript
import { register, Counter, Histogram, Gauge } from 'prom-client';

// Request metrics by tenant
const tenantRequestsTotal = new Counter({
  name: 'servalsheets_tenant_requests_total',
  help: 'Total requests per tenant',
  labelNames: ['tenant_id', 'tool', 'action', 'status'],
});

// Request duration by tenant
const tenantRequestDuration = new Histogram({
  name: 'servalsheets_tenant_request_duration_seconds',
  help: 'Request duration per tenant',
  labelNames: ['tenant_id', 'tool', 'action'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
});

// Active tenants
const activeTenants = new Gauge({
  name: 'servalsheets_active_tenants_total',
  help: 'Number of active tenants',
});

// Quota usage by tenant
const tenantQuotaUsage = new Gauge({
  name: 'servalsheets_tenant_quota_usage',
  help: 'Quota usage per tenant',
  labelNames: ['tenant_id', 'operation', 'window'],
});

// Error rate by tenant
const tenantErrorsTotal = new Counter({
  name: 'servalsheets_tenant_errors_total',
  help: 'Total errors per tenant',
  labelNames: ['tenant_id', 'error_type'],
});
```

### Metrics Collection Middleware

```typescript
app.use('/api', async (req, res, next) => {
  const start = Date.now();
  const { tenantContext } = req;

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const status = res.statusCode < 400 ? 'success' : 'error';

    // Record metrics
    tenantRequestsTotal.inc({
      tenant_id: tenantContext.tenantId,
      tool: req.params.tool,
      action: req.body.action,
      status,
    });

    tenantRequestDuration.observe(
      {
        tenant_id: tenantContext.tenantId,
        tool: req.params.tool,
        action: req.body.action,
      },
      duration
    );

    if (status === 'error') {
      tenantErrorsTotal.inc({
        tenant_id: tenantContext.tenantId,
        error_type: res.statusCode.toString(),
      });
    }
  });

  next();
});

// Update quota usage metrics periodically
setInterval(async () => {
  const tenants = await tenantContextService.listTenants();

  for (const tenant of tenants) {
    const stats = await quotaManager.getUsageStats(tenant.tenantId);

    for (const operation of ['read', 'write', 'admin']) {
      for (const window of ['hourly', 'daily', 'monthly']) {
        tenantQuotaUsage.set(
          {
            tenant_id: tenant.tenantId,
            operation,
            window,
          },
          stats.current[operation][window]
        );
      }
    }
  }

  activeTenants.set(tenants.length);
}, 60000); // Update every minute
```

### Grafana Dashboard

Example Prometheus queries for Grafana:

```promql
# Requests per second by tenant
rate(servalsheets_tenant_requests_total[5m])

# P95 latency by tenant
histogram_quantile(0.95,
  rate(servalsheets_tenant_request_duration_seconds_bucket[5m])
)

# Top 10 tenants by request volume
topk(10,
  sum by (tenant_id) (rate(servalsheets_tenant_requests_total[1h]))
)

# Quota usage percentage
(servalsheets_tenant_quota_usage{window="daily"} /
 servalsheets_tenant_quota_limit{window="daily"}) * 100

# Error rate by tenant
rate(servalsheets_tenant_errors_total[5m]) /
rate(servalsheets_tenant_requests_total[5m])
```

### Tenant Health Scoring

Calculate tenant health scores based on multiple factors:

```typescript
interface TenantHealthScore {
  tenantId: string;
  overall: number; // 0-100
  factors: {
    uptime: number; // 0-100
    errorRate: number; // 0-100
    quotaUsage: number; // 0-100
    billingStatus: number; // 0-100
    apiUsage: number; // 0-100
  };
  status: 'healthy' | 'warning' | 'critical';
  recommendations: string[];
}

async function calculateTenantHealth(tenantId: string): Promise<TenantHealthScore> {
  const stats = await quotaManager.getUsageStats(tenantId);
  const tenant = await tenantContextService.getTenant(tenantId);

  // Calculate individual factor scores
  const uptime = await calculateUptime(tenantId); // 0-100
  const errorRate = 100 - (await calculateErrorRate(tenantId)) * 100; // 0-100
  const quotaUsage = 100 - Math.max(...Object.values(stats.percentUsed.read)); // 0-100
  const billingStatus = tenant.billingInfo?.plan ? 100 : 50; // 0-100
  const apiUsage = stats.current.read.daily > 0 ? 100 : 0; // 0-100

  // Weighted average
  const overall = Math.round(
    uptime * 0.3 + errorRate * 0.3 + quotaUsage * 0.2 + billingStatus * 0.1 + apiUsage * 0.1
  );

  // Determine status
  let status: 'healthy' | 'warning' | 'critical';
  if (overall >= 80) status = 'healthy';
  else if (overall >= 50) status = 'warning';
  else status = 'critical';

  // Generate recommendations
  const recommendations: string[] = [];
  if (errorRate < 80) recommendations.push('High error rate detected. Review recent API calls.');
  if (quotaUsage < 20) recommendations.push('Approaching quota limit. Consider upgrading plan.');
  if (apiUsage === 0) recommendations.push('No API activity. Tenant may be inactive.');

  return {
    tenantId,
    overall,
    factors: {
      uptime,
      errorRate,
      quotaUsage,
      billingStatus,
      apiUsage,
    },
    status,
    recommendations,
  };
}
```

### Analytics API

Expose tenant analytics via REST API:

```typescript
// Get tenant analytics summary
app.get('/api/admin/tenants/:tenantId/analytics', async (req, res) => {
  const { tenantId } = req.params;
  const { startDate, endDate } = req.query;

  const analytics = {
    tenant: await tenantContextService.getTenant(tenantId),
    usage: await quotaManager.getUsageStats(tenantId),
    costs: await costTracker.getMonthlyCosts(tenantId),
    health: await calculateTenantHealth(tenantId),
    topActions: await getTopActions(tenantId, startDate, endDate),
    errorBreakdown: await getErrorBreakdown(tenantId, startDate, endDate),
    peakUsageHours: await getPeakUsageHours(tenantId),
  };

  res.json(analytics);
});

// Get tenant leaderboard
app.get('/api/admin/analytics/leaderboard', async (req, res) => {
  const tenants = await tenantContextService.listTenants();

  const leaderboard = await Promise.all(
    tenants.map(async (tenant) => {
      const stats = await quotaManager.getUsageStats(tenant.tenantId);
      const costs = await costTracker.getMonthlyCosts(tenant.tenantId);

      return {
        tenantId: tenant.tenantId,
        name: tenant.name,
        totalRequests: Object.values(stats.current).reduce((sum, op) => sum + op.monthly, 0),
        totalCost: costs.total,
        health: (await calculateTenantHealth(tenant.tenantId)).overall,
      };
    })
  );

  // Sort by total requests
  leaderboard.sort((a, b) => b.totalRequests - a.totalRequests);

  res.json(leaderboard);
});
```

---

## Migration from Single-Tenant

Existing single-tenant deployments can migrate to multi-tenant:

### Step 1: Create Default Tenant

```typescript
const { metadata, apiKey } = await tenantContextService.createTenant('Default Tenant');
```

### Step 2: Update Client Configuration

Replace existing authentication with tenant API key:

```bash
# Old (single-tenant)
export GOOGLE_OAUTH_TOKEN="..."

# New (multi-tenant)
export SERVALSHEETS_API_KEY="sk_..."
```

### Step 3: Enable Multi-Tenant Mode

```bash
export SERVALSHEETS_MULTI_TENANT=true
```

### Step 4: Restart Server

```bash
npm run start:http
```

## Performance Considerations

### API Key Lookup

- **In-memory storage:** O(1) lookup via Map
- **Database storage:** Add index on `tenant_id` and `api_key` columns
- **Redis storage:** Use HASH for tenant metadata, SET for API key → tenant ID mapping

### Quota Tracking

- Use Redis for distributed quota tracking
- Implement sliding window rate limiting
- Consider using token bucket algorithm

### Spreadsheet Access Validation

- Cache spreadsheet → tenant mappings
- Use TTL to balance freshness and performance
- Implement eventual consistency for non-critical checks

## Monitoring and Observability

### Metrics to Track

1. **Tenant Count** - Active tenants over time
2. **API Calls per Tenant** - Distribution and outliers
3. **Quota Exhaustion Events** - Rate limit hits
4. **Cross-Tenant Access Attempts** - Security violations
5. **Tenant Onboarding Time** - Time to first API call

### Prometheus Metrics

```typescript
import { register, Counter, Gauge } from 'prom-client';

const tenantCount = new Gauge({
  name: 'servalsheets_tenants_total',
  help: 'Total number of active tenants',
});

const tenantApiCalls = new Counter({
  name: 'servalsheets_tenant_api_calls_total',
  help: 'Total API calls per tenant',
  labelNames: ['tenant_id', 'tool'],
});

const quotaExhaustion = new Counter({
  name: 'servalsheets_quota_exhaustion_total',
  help: 'Quota exhaustion events',
  labelNames: ['tenant_id', 'quota_type'],
});
```

## Troubleshooting

### Issue: Invalid API Key

**Symptom:** 401 Unauthorized response

**Causes:**

1. API key not included in Authorization header
2. API key revoked or tenant deleted
3. Tenant suspended

**Solution:**

```bash
# Verify API key format
echo $SERVALSHEETS_API_KEY | grep -E '^sk_[A-Za-z0-9_-]{43}$'

# Check tenant status
curl -H "Authorization: Bearer $ADMIN_API_KEY" \
  http://localhost:3000/api/tenants/$TENANT_ID
```

### Issue: Spreadsheet Access Denied

**Symptom:** 403 Forbidden response

**Causes:**

1. Spreadsheet belongs to different tenant
2. Spreadsheet access not granted to tenant

**Solution:**

```typescript
// Verify spreadsheet ownership
const hasAccess = await tenantContextService.validateSpreadsheetAccess(tenantId, spreadsheetId);
```

### Issue: Quota Exceeded

**Symptom:** 429 Too Many Requests

**Causes:**

1. Hourly API call limit reached
2. Concurrent request limit reached

**Solution:**

```typescript
// Check quota status
const context = await tenantContextService.extractTenantContext(apiKey);
console.log('Quota remaining:', context.quotaRemaining);

// Increase quota
await tenantContextService.updateTenant(tenantId, {
  settings: {
    maxApiCallsPerHour: 20000,
  },
});
```

## Best Practices

### Security

1. **Rotate API Keys Regularly** - Automate key rotation every 90 days
2. **Use HTTPS Only** - Never transmit API keys over HTTP
3. **Implement IP Allowlists** - Restrict API access by IP range
4. **Audit Logs** - Log all tenant actions for compliance
5. **Rate Limiting** - Prevent abuse with aggressive rate limits

### Performance

1. **Database Indexing** - Index tenant_id, api_key, and status columns
2. **Connection Pooling** - Use connection pools for database access
3. **Caching** - Cache tenant metadata and quota status
4. **Async Processing** - Use background jobs for quota resets
5. **Monitoring** - Track tenant performance metrics

### Operations

1. **Backup Tenant Data** - Regular backups of tenant metadata
2. **Disaster Recovery** - Test tenant restoration procedures
3. **Capacity Planning** - Monitor tenant growth and resource usage
4. **Automated Onboarding** - Self-service tenant creation
5. **Support Tooling** - Admin dashboard for tenant management

## API Reference

### TenantContextService

#### `createTenant(name, settings?)`

Creates new tenant with unique ID and API key.

**Parameters:**

- `name` (string) - Tenant name
- `settings` (object, optional) - Tenant settings

**Returns:**

- `metadata` (TenantMetadata) - Tenant metadata
- `apiKey` (string) - API key for authentication

#### `extractTenantContext(apiKey)`

Extracts tenant context from API key.

**Parameters:**

- `apiKey` (string) - API key from Authorization header

**Returns:**

- `TenantContext | null` - Tenant context or null if invalid

#### `updateTenant(tenantId, updates)`

Updates tenant metadata.

**Parameters:**

- `tenantId` (string) - Tenant UUID
- `updates` (object) - Partial tenant metadata updates

**Returns:**

- `TenantMetadata` - Updated tenant metadata

#### `deleteTenant(tenantId)`

Soft deletes tenant (marks as deleted, revokes API keys).

**Parameters:**

- `tenantId` (string) - Tenant UUID

**Returns:**

- `void`

#### `rotateApiKey(tenantId)`

Rotates API key for tenant (revokes old key).

**Parameters:**

- `tenantId` (string) - Tenant UUID

**Returns:**

- `string` - New API key

#### `validateSpreadsheetAccess(tenantId, spreadsheetId)`

Validates tenant has access to spreadsheet.

**Parameters:**

- `tenantId` (string) - Tenant UUID
- `spreadsheetId` (string) - Google Sheets spreadsheet ID

**Returns:**

- `boolean` - True if tenant has access

### Middleware

#### `tenantIsolationMiddleware()`

Express middleware for tenant authentication and isolation.

**Usage:**

```typescript
app.use('/api', tenantIsolationMiddleware());
```

**Behavior:**

- Extracts API key from Authorization header
- Validates API key and tenant status
- Attaches tenant context to request
- Returns 401 if authentication fails

#### `validateSpreadsheetAccess()`

Express middleware for spreadsheet access validation.

**Usage:**

```typescript
app.use('/api/tools', validateSpreadsheetAccess());
```

**Behavior:**

- Extracts spreadsheet ID from request
- Validates tenant has access to spreadsheet
- Returns 403 if access denied

## Examples

### Complete HTTP Server Setup

```typescript
import express from 'express';
import {
  tenantIsolationMiddleware,
  validateSpreadsheetAccess,
} from './middleware/tenant-isolation.js';

const app = express();
app.use(express.json());

// Public routes (no auth)
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Authenticated routes (tenant isolation)
app.use('/api', tenantIsolationMiddleware());
app.use('/api/tools', validateSpreadsheetAccess());

app.post('/api/tools/:tool', async (req, res) => {
  const { tenantContext } = req;
  const { tool } = req.params;

  // Process request with tenant context
  const result = await processToolRequest(tool, req.body, tenantContext);
  res.json(result);
});

app.listen(3000);
```

### Multi-Tenant Client

```typescript
class ServalSheetsClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'http://localhost:3000') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async readRange(spreadsheetId: string, range: string) {
    const response = await fetch(`${this.baseUrl}/api/tools/sheets_data`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'read',
        spreadsheetId,
        range,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return response.json();
  }
}

// Usage
const client = new ServalSheetsClient('sk_...');
const data = await client.readRange('spreadsheet-id', 'A1:B10');
```

## Roadmap

### Planned Features

- [ ] Tenant-specific feature flags
- [ ] Usage-based billing integration
- [ ] Multi-region tenant distribution
- [ ] Tenant data export (GDPR compliance)
- [ ] Automated quota adjustments based on usage
- [ ] Tenant analytics dashboard
- [ ] Webhook notifications for quota events

### Future Enhancements

- [ ] Hierarchical tenants (organizations → teams → users)
- [ ] Cross-tenant collaboration (with explicit consent)
- [ ] Tenant-specific branding and customization
- [ ] Advanced quota policies (burst limits, time-of-day)
- [ ] Tenant health scoring and alerts

## Support

For questions or issues with multi-tenancy:

1. Check [GitHub Issues](https://github.com/yourusername/servalsheets/issues)
2. Review [Security Tests](../../tests/security/tenant-isolation.test.ts)
3. Consult [Architecture Documentation](../development/ARCHITECTURE.md)

## License

ServalSheets is licensed under [MIT License](../../LICENSE).
