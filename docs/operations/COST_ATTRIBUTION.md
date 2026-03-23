---
title: Cost Attribution & Billing Integration
category: runbook
last_updated: 2026-03-10
description: Per-tenant cost tracking and billing integration for ServalSheets SaaS deployment.
version: 1.6.0
tags: [prometheus]
estimated_time: 15-30 minutes
---

# Cost Attribution & Billing Integration

Per-tenant cost tracking and billing integration for ServalSheets SaaS deployment.

## Overview

ServalSheets includes a comprehensive cost attribution system that tracks usage per tenant and integrates with Stripe for automated billing. This enables SaaS providers to:

- Track API calls, storage, and feature usage per tenant
- Calculate costs based on configurable pricing tiers
- Generate invoices automatically
- Provide real-time cost dashboards to customers
- Set budget limits and receive alerts
- Forecast end-of-month costs

## Architecture

### Components

1. **Cost Tracker** (`src/services/cost-tracker.ts`)
   - Per-tenant usage tracking
   - Cost calculation engine
   - Budget management
   - Cost forecasting
   - Alert system

2. **Billing Integration** (`src/services/billing-integration.ts`)
   - Stripe customer management
   - Subscription management
   - Invoice generation
   - Payment processing
   - Webhook handling

3. **Cost Dashboard** (`src/resources/cost-dashboard.ts`)
   - Real-time cost visibility
   - Usage breakdown
   - Optimization suggestions
   - Invoice history

## Pricing Tiers

### Free Tier

**Limits:**

- 1,000 API calls per month
- 1 GB storage
- 1 user seat
- Basic features only

**Pricing:**

- $0/month (free)

### Starter Tier

**Limits:**

- 10,000 API calls per month
- 10 GB storage
- 5 user seats
- Includes transactions

**Pricing:**

- $0.10 per 1,000 API requests
- $0.50 per GB storage per month
- $10 per user seat per month
- $1.00 per 1M rows processed
- $0.01 per 1,000 formula executions
- $1.00 per 1,000 webhooks delivered

### Professional Tier

**Limits:**

- 100,000 API calls per month
- 100 GB storage
- 25 user seats
- Full feature access (transactions, webhooks, BigQuery)

**Pricing (20% discount):**

- $0.08 per 1,000 API requests
- $0.40 per GB storage per month
- $8 per user seat per month
- $0.80 per 1M rows processed
- $0.008 per 1,000 formula executions
- $0.80 per 1,000 webhooks delivered

### Enterprise Tier

**Limits:**

- Unlimited API calls
- Unlimited storage
- Unlimited user seats
- All features (including Apps Script integration)

**Pricing (50% discount):**

- $0.05 per 1,000 API requests
- $0.25 per GB storage per month
- $5 per user seat per month
- $0.50 per 1M rows processed
- $0.005 per 1,000 formula executions
- $0.50 per 1,000 webhooks delivered

## Usage Tracking

### API Calls

Track API calls by type:

```typescript
import { getCostTracker } from './services/cost-tracker.js';

const costTracker = getCostTracker();

// Track Sheets API call
costTracker.trackApiCall(tenantId, 'sheets');

// Track Drive API call
costTracker.trackApiCall(tenantId, 'drive');

// Track BigQuery API call
costTracker.trackApiCall(tenantId, 'bigquery');
```

### Storage

Track storage usage:

```typescript
// Track storage in bytes
const storageBytes = 5 * 1024 * 1024 * 1024; // 5 GB
costTracker.trackStorage(tenantId, storageBytes);
```

### User Seats

Track user seat allocation:

```typescript
// Track active and total seats
costTracker.trackUserSeats(tenantId, activeSeats, totalSeats);
```

### Feature Usage

Track feature-specific usage:

```typescript
// Track rows processed
costTracker.trackFeatureUsage(tenantId, 'rowsProcessed', 1000);

// Track formulas executed
costTracker.trackFeatureUsage(tenantId, 'formulasExecuted', 50);

// Track webhooks delivered
costTracker.trackFeatureUsage(tenantId, 'webhooksDelivered', 10);

// Track transactions executed
costTracker.trackFeatureUsage(tenantId, 'transactionsExecuted', 5);
```

## Cost Calculation

### Get Cost Breakdown

```typescript
const breakdown = costTracker.calculateCost(tenantId);

console.log(`Total cost: $${breakdown.costs.total.toFixed(2)}`);
console.log(`API calls: $${breakdown.costs.apiCalls.toFixed(2)}`);
console.log(`Storage: $${breakdown.costs.storage.toFixed(2)}`);
console.log(`User seats: $${breakdown.costs.userSeats.toFixed(2)}`);
console.log(`Features: $${breakdown.costs.features.toFixed(2)}`);
console.log(`Discounts: -$${breakdown.costs.discounts.toFixed(2)}`);
```

### Cost Forecasting

```typescript
const forecast = costTracker.forecastCost(tenantId);

console.log(`Forecasted end-of-month cost: $${forecast.forecast.toFixed(2)}`);
console.log(`Confidence: ${(forecast.confidence * 100).toFixed(1)}%`);
```

## Budget Management

### Set Budget Limits

```typescript
// Set monthly budget limit
costTracker.setBudget(tenantId, 1000); // $1,000 limit
```

### Budget Alerts

```typescript
// Listen for budget alerts
costTracker.on('alert', (alert) => {
  switch (alert.type) {
    case 'budget_warning':
      console.log(`Warning: ${alert.message}`);
      break;
    case 'budget_exceeded':
      console.log(`Critical: ${alert.message}`);
      break;
    case 'tier_upgrade_suggested':
      console.log(`Suggestion: ${alert.message}`);
      break;
  }
});
```

### Check Budget Status

```typescript
const status = costTracker.getBudgetStatus(tenantId);

console.log(`Budget: $${status.budget}`);
console.log(`Current: $${status.current.toFixed(2)}`);
console.log(`Remaining: $${status.remaining.toFixed(2)}`);
console.log(`Used: ${status.percentUsed.toFixed(1)}%`);
```

## Stripe Integration

### Initialize Billing

```typescript
import { createBillingIntegration } from './services/billing-integration.js';

const billing = createBillingIntegration({
  stripeSecretKey: process.env.STRIPE_SECRET_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  currency: 'usd',
  billingCycle: 'monthly',
  autoInvoicing: true, // Auto-generate invoices at end of billing period
});
```

### Customer Management

```typescript
// Create Stripe customer
const customerId = await billing.createCustomer(tenantId, 'customer@example.com', 'Company Name', {
  plan: 'professional',
});
```

### Subscription Management

```typescript
// Create subscription
const subscription = await billing.createSubscription(
  tenantId,
  'price_1234567890', // Stripe price ID
  14 // 14-day trial
);

// Update subscription tier
await billing.updateSubscription(
  subscription.stripeSubscriptionId,
  'price_0987654321' // New price ID
);

// Cancel subscription
await billing.cancelSubscription(
  subscription.stripeSubscriptionId,
  false // Cancel at period end
);
```

### Invoice Generation

```typescript
// Generate invoice manually
const invoice = await billing.generateInvoice(tenantId);

console.log(`Invoice ID: ${invoice.invoiceId}`);
console.log(`Amount: $${invoice.amount.toFixed(2)}`);
console.log(`Status: ${invoice.status}`);
console.log(`URL: ${invoice.hostedInvoiceUrl}`);

// List recent invoices
const invoices = await billing.listInvoices(tenantId, 10);
```

### Payment Methods

```typescript
// Attach payment method
await billing.attachPaymentMethod(tenantId, 'pm_1234567890');

// List payment methods
const paymentMethods = await billing.listPaymentMethods(tenantId);
for (const pm of paymentMethods) {
  console.log(`${pm.brand} ending in ${pm.last4}`);
  console.log(`Default: ${pm.isDefault}`);
}
```

### Webhook Handling

```typescript
import express from 'express';

const app = express();

app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'] as string;

  try {
    await billing.handleWebhook(req.body, signature);
    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).send('Webhook Error');
  }
});

// Listen for billing events
billing.on('invoice:paid', ({ tenantId, invoiceId }) => {
  console.log(`Invoice paid: ${invoiceId} for tenant ${tenantId}`);
});

billing.on('invoice:payment_failed', ({ tenantId, invoiceId }) => {
  console.log(`Payment failed: ${invoiceId} for tenant ${tenantId}`);
  // Suspend tenant access or send notification
});

billing.on('subscription:deleted', ({ tenantId, subscriptionId }) => {
  console.log(`Subscription canceled: ${subscriptionId} for tenant ${tenantId}`);
  // Downgrade tenant to free tier
});
```

## Cost Dashboard

### Access via MCP Resources

The cost dashboard is exposed as MCP resources for real-time visibility:

#### Cost Dashboard Resource

```
billing://dashboard/{tenantId}
```

Returns:

- Current period info (dates, days elapsed/remaining)
- Current and forecasted costs
- Cost breakdown by category
- Usage statistics
- Budget status
- Tier information
- Optimization suggestions with potential savings

#### Cost Allocation Report

```
billing://allocation/{tenantId}
```

Returns:

- Cost breakdown by category
- Percentage of total for each category
- Period information

#### Recent Invoices

```
billing://invoices/{tenantId}
```

Returns:

- List of recent invoices
- Payment status
- Download links

### Usage Example

```typescript
// Access via MCP server
server.registerResource(
  'Cost Dashboard',
  'billing://dashboard/{tenantId}'
  // ... resource handler
);
```

## Optimization Suggestions

The cost tracker provides intelligent optimization suggestions based on usage patterns:

### API Call Optimization

When API usage exceeds 1,000 calls, suggests:

- Using batch operations
- Implementing caching
- Potential savings: up to 30%

### Storage Optimization

When storage exceeds 10 GB, suggests:

- Archiving old data
- Implementing data retention policies
- Potential savings: up to 20%

### User Seat Optimization

When active seat ratio < 70%, suggests:

- Removing unused seats
- Potential savings: unused seats × seat cost

### Tier Optimization

When usage exceeds tier limits, suggests:

- Upgrading to higher tier for volume discounts
- Potential savings: calculated based on discount percentage

### Feature Usage Optimization

When processing > 1M rows, suggests:

- Using sampling techniques
- Implementing incremental processing
- Potential savings: up to 15%

## Integration with HTTP Server

### Add Cost Tracking Middleware

```typescript
import { getCostTracker } from './services/cost-tracker.js';

app.use((req, res, next) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (tenantId) {
    // Track API call
    getCostTracker().trackApiCall(tenantId, 'sheets');
  }
  next();
});
```

### Add to Google API Wrapper

```typescript
// In src/services/google-api.ts
import { getCostTracker } from './cost-tracker.js';

// Track API calls in wrapGoogleApi
const costTracker = getCostTracker();
const tenantId = getRequestContext()?.tenantId;
if (tenantId) {
  costTracker.trackApiCall(tenantId, apiType);
}
```

## Environment Variables

```bash
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Billing Configuration
BILLING_CURRENCY=usd
BILLING_CYCLE=monthly
AUTO_INVOICING=true
```

## Testing

### Run Cost Attribution Tests

```bash
npm test tests/billing/cost-attribution.test.ts
```

### Test Coverage

The billing system includes 15+ comprehensive tests covering:

- API call tracking (per type and multi-tenant)
- Storage tracking and conversion
- User seat tracking
- Feature usage tracking and accumulation
- Cost calculation for all pricing tiers
- Discount application
- Budget management and alerts
- Cost forecasting
- Tier upgrade suggestions
- Usage reset
- Multi-tenant isolation

## Security Considerations

1. **Stripe API Keys**: Store in environment variables, never commit to code
2. **Webhook Secrets**: Verify all webhook signatures
3. **Tenant Isolation**: Ensure costs are tracked per tenant
4. **Budget Enforcement**: Implement rate limiting or access suspension when budget exceeded
5. **Data Privacy**: Cost data is sensitive, implement access controls

## Monitoring

### Key Metrics to Track

- Total revenue per month
- Revenue per tenant
- Churn rate
- Average revenue per user (ARPU)
- Cost of goods sold (COGS)
- Gross margin
- Budget alert frequency
- Tier upgrade conversion rate

### Prometheus Metrics

```typescript
// Add to src/observability/metrics.ts
export const billingRevenueTotal = new Counter({
  name: 'servalsheets_billing_revenue_total',
  help: 'Total billing revenue',
  labelNames: ['tier', 'tenant_id'],
});

export const billingCostsTotal = new Counter({
  name: 'servalsheets_billing_costs_total',
  help: 'Total tracked costs',
  labelNames: ['category', 'tenant_id'],
});
```

## Troubleshooting

### Common Issues

**Issue:** Invoice not generating

- Check Stripe customer exists
- Verify usage has been tracked
- Check auto-invoicing is enabled

**Issue:** Incorrect cost calculation

- Verify pricing tier is set correctly
- Check usage tracking calls are made
- Review discount application

**Issue:** Budget alerts not firing

- Ensure budget limit is set
- Verify cost tracker is initialized
- Check event listener is registered

**Issue:** Webhook failures

- Verify webhook secret is correct
- Check Stripe signature validation
- Review webhook endpoint accessibility

## Best Practices

1. **Track usage in real-time**: Don't batch tracking calls, track immediately
2. **Set reasonable budgets**: Allow headroom for legitimate usage spikes
3. **Monitor alerts**: Set up notifications for budget and tier alerts
4. **Regular audits**: Review cost attribution data monthly
5. **Optimize based on suggestions**: Implement cost optimization recommendations
6. **Test billing flows**: Use Stripe test mode extensively before production
7. **Handle edge cases**: Account for refunds, proration, and failed payments
8. **Document pricing**: Keep pricing tiers and calculations transparent

## Support

For billing-related issues:

- Check logs in `src/services/cost-tracker.ts` and `billing-integration.ts`
- Review Stripe dashboard for payment issues
- Contact support with tenant ID and invoice ID

## License

This billing system is part of ServalSheets and follows the same license terms.
