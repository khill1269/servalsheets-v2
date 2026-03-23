/**
 * Billing Integration Example
 *
 * Demonstrates how to integrate cost tracking and billing into ServalSheets
 * for SaaS deployment with Stripe payment processing.
 */

import { getCostTracker } from '../src/services/cost-tracker.js';
import { createBillingIntegration } from '../src/services/billing-integration.js';
import { createHttpServer } from '../src/http-server.js';
import type { Request, Response, NextFunction } from 'express';

// ============================================================================
// Example 1: Basic Cost Tracking
// ============================================================================

export function exampleBasicCostTracking() {
  const costTracker = getCostTracker();
  const tenantId = 'tenant-abc-123';

  // Set pricing tier
  costTracker.setTier(tenantId, 'professional');

  // Track API calls
  costTracker.trackApiCall(tenantId, 'sheets'); // Sheets API call
  costTracker.trackApiCall(tenantId, 'drive'); // Drive API call
  costTracker.trackApiCall(tenantId, 'bigquery'); // BigQuery API call

  // Track storage usage
  const storageBytes = 50 * 1024 * 1024 * 1024; // 50 GB
  costTracker.trackStorage(tenantId, storageBytes);

  // Track user seats
  costTracker.trackUserSeats(tenantId, 15, 20); // 15 active, 20 total

  // Track feature usage
  costTracker.trackFeatureUsage(tenantId, 'rowsProcessed', 100000);
  costTracker.trackFeatureUsage(tenantId, 'formulasExecuted', 5000);
  costTracker.trackFeatureUsage(tenantId, 'webhooksDelivered', 250);
  costTracker.trackFeatureUsage(tenantId, 'transactionsExecuted', 10);

  // Get cost breakdown
  const breakdown = costTracker.calculateCost(tenantId);

  console.log('Cost Breakdown:');
  console.log(`  API Calls: $${breakdown.costs.apiCalls.toFixed(2)}`);
  console.log(`  Storage: $${breakdown.costs.storage.toFixed(2)}`);
  console.log(`  User Seats: $${breakdown.costs.userSeats.toFixed(2)}`);
  console.log(`  Features: $${breakdown.costs.features.toFixed(2)}`);
  console.log(`  Discounts: -$${breakdown.costs.discounts.toFixed(2)}`);
  console.log(`  Total: $${breakdown.costs.total.toFixed(2)}`);
}

// ============================================================================
// Example 2: Budget Management with Alerts
// ============================================================================

export function exampleBudgetManagement() {
  const costTracker = getCostTracker();
  const tenantId = 'tenant-xyz-456';

  // Set monthly budget limit
  costTracker.setBudget(tenantId, 500); // $500 budget

  // Listen for budget alerts
  costTracker.on('alert', (alert) => {
    switch (alert.type) {
      case 'budget_warning':
        console.log(`⚠️  Warning: ${alert.message}`);
        // Send email notification
        sendEmailNotification(alert.tenantId, alert.message);
        break;

      case 'budget_exceeded':
        console.log(`🚨 Critical: ${alert.message}`);
        // Suspend tenant access or reduce rate limits
        suspendTenantAccess(alert.tenantId);
        break;

      case 'tier_upgrade_suggested':
        console.log(`💡 Suggestion: ${alert.message}`);
        // Send upgrade recommendation
        sendUpgradeRecommendation(alert.tenantId);
        break;
    }
  });

  // Track usage that exceeds budget
  costTracker.setTier(tenantId, 'professional');
  costTracker.trackUserSeats(tenantId, 50, 50); // 50 * $8 = $400
  costTracker.trackStorage(tenantId, 200 * 1024 * 1024 * 1024); // 200 GB * $0.40 = $80
  // Total: $480 (96% of budget) - will trigger warning alert

  // Check budget status
  const status = costTracker.getBudgetStatus(tenantId);
  console.log(`Budget Status: ${status.percentUsed.toFixed(1)}% used`);
}

// ============================================================================
// Example 3: Stripe Integration
// ============================================================================

export async function exampleStripeIntegration() {
  // Initialize billing integration
  const billing = createBillingIntegration({
    stripeSecretKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    currency: 'usd',
    billingCycle: 'monthly',
    autoInvoicing: true,
  });

  const tenantId = 'tenant-def-789';

  // Create Stripe customer
  const customerId = await billing.createCustomer(
    tenantId,
    'customer@example.com',
    'Example Corp',
    { plan: 'professional' }
  );

  // Create subscription with 14-day trial
  const subscription = await billing.createSubscription(
    tenantId,
    'price_1234567890', // Stripe price ID
    14 // trial days
  );

  console.log(`Subscription created: ${subscription.stripeSubscriptionId}`);
  console.log(`Status: ${subscription.status}`);
  console.log(`Trial until: ${subscription.currentPeriodEnd.toISOString()}`);

  // Attach payment method
  await billing.attachPaymentMethod(tenantId, 'pm_1234567890');

  // List payment methods
  const paymentMethods = await billing.listPaymentMethods(tenantId);
  for (const pm of paymentMethods) {
    console.log(`${pm.brand} ending in ${pm.last4} (default: ${pm.isDefault})`);
  }
}

// ============================================================================
// Example 4: Automatic Invoice Generation
// ============================================================================

export async function exampleInvoiceGeneration() {
  const costTracker = getCostTracker();
  const billing = createBillingIntegration({
    stripeSecretKey: process.env.STRIPE_SECRET_KEY!,
    autoInvoicing: true,
  });

  const tenantId = 'tenant-ghi-012';

  // Set up tenant
  costTracker.setTier(tenantId, 'professional');
  await billing.createCustomer(tenantId, 'billing@company.com', 'Company Inc');

  // Track usage throughout the month
  for (let i = 0; i < 1000; i++) {
    costTracker.trackApiCall(tenantId, 'sheets');
  }
  costTracker.trackStorage(tenantId, 25 * 1024 * 1024 * 1024); // 25 GB
  costTracker.trackUserSeats(tenantId, 10, 10);

  // Generate invoice manually (or wait for automatic generation at end of month)
  const invoice = await billing.generateInvoice(tenantId);

  console.log('Invoice Generated:');
  console.log(`  ID: ${invoice.invoiceId}`);
  console.log(`  Amount: $${invoice.amount.toFixed(2)}`);
  console.log(`  Status: ${invoice.status}`);
  console.log(
    `  Period: ${invoice.periodStart.toISOString()} - ${invoice.periodEnd.toISOString()}`
  );
  console.log(`  URL: ${invoice.hostedInvoiceUrl}`);
  console.log(`  PDF: ${invoice.invoicePdf}`);

  // List all invoices
  const invoices = await billing.listInvoices(tenantId);
  console.log(`\nTotal invoices: ${invoices.length}`);
}

// ============================================================================
// Example 5: Cost Forecasting
// ============================================================================

export function exampleCostForecasting() {
  const costTracker = getCostTracker();
  const tenantId = 'tenant-jkl-345';

  costTracker.setTier(tenantId, 'professional');

  // Simulate mid-month usage
  for (let i = 0; i < 50000; i++) {
    costTracker.trackApiCall(tenantId, 'sheets');
  }
  costTracker.trackStorage(tenantId, 75 * 1024 * 1024 * 1024);
  costTracker.trackUserSeats(tenantId, 20, 25);

  // Calculate current cost
  const breakdown = costTracker.calculateCost(tenantId);
  console.log(`Current month-to-date: $${breakdown.costs.total.toFixed(2)}`);

  // Forecast end-of-month cost
  const forecast = costTracker.forecastCost(tenantId);
  console.log(`Forecasted end-of-month: $${forecast.forecast.toFixed(2)}`);
  console.log(`Confidence: ${(forecast.confidence * 100).toFixed(1)}%`);

  // Check if forecast exceeds budget
  const status = costTracker.getBudgetStatus(tenantId);
  if (forecast.forecast > (status.budget || Infinity)) {
    console.log('⚠️  Warning: Forecasted cost exceeds budget!');
    console.log('Consider optimizing usage or upgrading tier.');
  }
}

// ============================================================================
// Example 6: HTTP Server Integration with Cost Tracking Middleware
// ============================================================================

export async function exampleHttpServerIntegration() {
  const costTracker = getCostTracker();

  // Create cost tracking middleware
  const costTrackingMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.headers['x-tenant-id'] as string;

    if (tenantId) {
      // Track API call
      costTracker.trackApiCall(tenantId, 'sheets');

      // Add cost info to response headers
      res.on('finish', () => {
        const breakdown = costTracker.calculateCost(tenantId);
        res.setHeader('X-Current-Cost', breakdown.costs.total.toFixed(2));

        const status = costTracker.getBudgetStatus(tenantId);
        res.setHeader('X-Budget-Remaining', status.remaining.toFixed(2));
      });
    }

    next();
  };

  // Create HTTP server with billing enabled
  const server = await createHttpServer({
    port: 3000,
    enableOAuth: true,
    oauthConfig: {
      issuer: 'https://your-domain.com',
      clientId: process.env.OAUTH_CLIENT_ID!,
      clientSecret: process.env.OAUTH_CLIENT_SECRET!,
      jwtSecret: process.env.JWT_SECRET!,
      stateSecret: process.env.STATE_SECRET!,
      allowedRedirectUris: ['http://localhost:3000/callback'],
      googleClientId: process.env.GOOGLE_CLIENT_ID!,
      googleClientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      accessTokenTtl: 3600,
      refreshTokenTtl: 604800,
    },
  });

  // Add cost tracking middleware
  // Note: This would be added in the actual HTTP server implementation
  // app.use(costTrackingMiddleware);

  console.log('HTTP Server with billing integration started on port 3000');
}

// ============================================================================
// Example 7: Webhook Event Handling
// ============================================================================

export async function exampleWebhookHandling() {
  const costTracker = getCostTracker();
  const billing = createBillingIntegration({
    stripeSecretKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
  });

  // Listen for billing events
  billing.on('invoice:paid', ({ tenantId, invoiceId }) => {
    console.log(`✅ Invoice paid for tenant ${tenantId}: ${invoiceId}`);
    // Reset usage for new billing period
    costTracker.resetUsage(tenantId);
  });

  billing.on('invoice:payment_failed', ({ tenantId, invoiceId }) => {
    console.log(`❌ Payment failed for tenant ${tenantId}: ${invoiceId}`);
    // Suspend tenant access
    suspendTenantAccess(tenantId);
    // Send payment reminder
    sendPaymentReminder(tenantId);
  });

  billing.on('subscription:deleted', ({ tenantId, subscriptionId }) => {
    console.log(`🔔 Subscription canceled for tenant ${tenantId}: ${subscriptionId}`);
    // Downgrade to free tier
    costTracker.setTier(tenantId, 'free');
    // Archive tenant data
    archiveTenantData(tenantId);
  });

  billing.on('subscription:updated', ({ tenantId, subscriptionId }) => {
    console.log(`🔄 Subscription updated for tenant ${tenantId}: ${subscriptionId}`);
    // Fetch new subscription details
    const subscription = await billing.getSubscription(subscriptionId);
    if (subscription) {
      // Update tier based on subscription
      costTracker.setTier(tenantId, subscription.tier as any);
    }
  });
}

// ============================================================================
// Example 8: Multi-Tenant Cost Tracking
// ============================================================================

export function exampleMultiTenantTracking() {
  const costTracker = getCostTracker();

  const tenants = [
    { id: 'tenant-001', tier: 'free', apiCalls: 500 },
    { id: 'tenant-002', tier: 'starter', apiCalls: 5000 },
    { id: 'tenant-003', tier: 'professional', apiCalls: 50000 },
    { id: 'tenant-004', tier: 'enterprise', apiCalls: 500000 },
  ];

  // Track usage for all tenants
  for (const tenant of tenants) {
    costTracker.setTier(tenant.id, tenant.tier as any);
    for (let i = 0; i < tenant.apiCalls; i++) {
      costTracker.trackApiCall(tenant.id, 'sheets');
    }
  }

  // Generate cost report for all tenants
  console.log('Multi-Tenant Cost Report:');
  console.log('='.repeat(60));

  let totalRevenue = 0;
  for (const tenant of tenants) {
    const breakdown = costTracker.calculateCost(tenant.id);
    const usage = costTracker.getUsage(tenant.id);

    console.log(`\nTenant: ${tenant.id}`);
    console.log(`  Tier: ${breakdown.tier.name}`);
    console.log(`  API Calls: ${usage.apiCalls.total.toLocaleString()}`);
    console.log(`  Cost: $${breakdown.costs.total.toFixed(2)}`);

    totalRevenue += breakdown.costs.total;
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Total Revenue: $${totalRevenue.toFixed(2)}`);
}

// ============================================================================
// Helper Functions (Mock implementations)
// ============================================================================

function sendEmailNotification(tenantId: string, message: string): void {
  console.log(`📧 Email sent to ${tenantId}: ${message}`);
}

function suspendTenantAccess(tenantId: string): void {
  console.log(`🔒 Access suspended for ${tenantId}`);
}

function sendUpgradeRecommendation(tenantId: string): void {
  console.log(`📈 Upgrade recommendation sent to ${tenantId}`);
}

function sendPaymentReminder(tenantId: string): void {
  console.log(`💳 Payment reminder sent to ${tenantId}`);
}

function archiveTenantData(tenantId: string): void {
  console.log(`📦 Data archived for ${tenantId}`);
}

// ============================================================================
// Run Examples
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('ServalSheets Billing Integration Examples\n');

  console.log('Example 1: Basic Cost Tracking');
  console.log('-'.repeat(60));
  exampleBasicCostTracking();

  console.log('\n\nExample 2: Budget Management');
  console.log('-'.repeat(60));
  exampleBudgetManagement();

  console.log('\n\nExample 5: Cost Forecasting');
  console.log('-'.repeat(60));
  exampleCostForecasting();

  console.log('\n\nExample 8: Multi-Tenant Cost Tracking');
  console.log('-'.repeat(60));
  exampleMultiTenantTracking();

  // Async examples would need to be wrapped in async function
  // exampleStripeIntegration();
  // exampleInvoiceGeneration();
  // exampleHttpServerIntegration();
  // exampleWebhookHandling();
}
