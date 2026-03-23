/**
 * Billing Integration Service
 *
 * Stripe integration for subscription management, invoice generation, and payment processing
 *
 * @category Billing
 * @usage Integrate with Stripe for automated billing
 */

import Stripe from 'stripe';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { NotFoundError, ServiceError } from '../core/errors.js';
import { getCostTracker, type CostBreakdown } from './cost-tracker.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface BillingConfig {
  stripeSecretKey: string;
  webhookSecret?: string;
  currency?: string;
  billingCycle?: 'monthly' | 'annual';
  autoInvoicing?: boolean;
}

/**
 * Runtime bootstrap config for billing integration.
 *
 * Keeps startup wiring explicit and safe:
 * - Disabled by default unless `enabled` is true
 * - No initialization if Stripe secret is missing
 */
export interface BillingBootstrapConfig {
  enabled: boolean;
  stripeSecretKey?: string;
  webhookSecret?: string;
  currency?: string;
  billingCycle?: 'monthly' | 'annual';
  autoInvoicing?: boolean;
}

export interface SubscriptionInfo {
  tenantId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: 'active' | 'canceled' | 'past_due' | 'unpaid' | 'trialing';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  tier: string;
}

export interface InvoiceInfo {
  tenantId: string;
  invoiceId: string;
  stripeInvoiceId: string;
  amount: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  periodStart: Date;
  periodEnd: Date;
  createdAt: Date;
  dueDate?: Date;
  paidAt?: Date;
  hostedInvoiceUrl?: string;
  invoicePdf?: string;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'bank_account';
  last4: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
}

// ============================================================================
// Billing Integration Service
// ============================================================================

export class BillingIntegration extends EventEmitter {
  private stripe: Stripe;
  private costTracker = getCostTracker();
  private config: Required<BillingConfig>;
  private tenantCustomers: Map<string, string> = new Map(); // tenantId -> stripeCustomerId
  private customerTenants: Map<string, string> = new Map(); // stripeCustomerId -> tenantId

  constructor(config: BillingConfig) {
    super();

    this.config = {
      stripeSecretKey: config.stripeSecretKey,
      webhookSecret: config.webhookSecret || '',
      currency: config.currency || 'usd',
      billingCycle: config.billingCycle || 'monthly',
      autoInvoicing: config.autoInvoicing !== false,
    };

    this.stripe = new Stripe(this.config.stripeSecretKey, {
      apiVersion: '2024-12-18.acacia',
      typescript: true,
    });

    if (this.config.autoInvoicing) {
      this.startAutoInvoicing();
    }
  }

  // ==========================================================================
  // Customer Management
  // ==========================================================================

  /**
   * Create or get Stripe customer for tenant
   */
  async createCustomer(
    tenantId: string,
    email: string,
    name?: string,
    metadata?: Record<string, string>
  ): Promise<string> {
    try {
      // Check if customer already exists
      const existingCustomerId = this.tenantCustomers.get(tenantId);
      if (existingCustomerId) {
        return existingCustomerId;
      }

      // Create new customer
      const customer = await this.stripe.customers.create({
        email,
        name,
        metadata: {
          tenantId,
          ...metadata,
        },
      });

      this.tenantCustomers.set(tenantId, customer.id);
      this.customerTenants.set(customer.id, tenantId);

      logger.info('Created Stripe customer', { tenantId, customerId: customer.id });
      return customer.id;
    } catch (error) {
      logger.error('Failed to create Stripe customer', { tenantId, error });
      throw error;
    }
  }

  /**
   * Get Stripe customer ID for tenant
   */
  getCustomerId(tenantId: string): string | undefined {
    return this.tenantCustomers.get(tenantId);
  }

  /**
   * Get tenant ID from Stripe customer ID
   */
  getTenantId(customerId: string): string | undefined {
    return this.customerTenants.get(customerId);
  }

  // ==========================================================================
  // Subscription Management
  // ==========================================================================

  /**
   * Create subscription for tenant
   */
  async createSubscription(
    tenantId: string,
    priceId: string,
    trialDays?: number
  ): Promise<SubscriptionInfo> {
    try {
      const customerId = this.getCustomerId(tenantId);
      if (!customerId) {
        throw new NotFoundError('Stripe customer', tenantId);
      }

      const subscription = await this.stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        trial_period_days: trialDays,
        metadata: { tenantId },
      });

      const info: SubscriptionInfo = {
        tenantId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id,
        status: subscription.status as SubscriptionInfo['status'],
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        tier: subscription.items.data[0]?.price.metadata?.['tier'] || 'unknown',
      };

      logger.info('Created subscription', info);
      return info;
    } catch (error) {
      logger.error('Failed to create subscription', { tenantId, error });
      throw error;
    }
  }

  /**
   * Get subscription info
   */
  async getSubscription(subscriptionId: string): Promise<SubscriptionInfo | null> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
      const tenantId = this.getTenantId(subscription.customer as string);

      if (!tenantId) {
        return null;
      }

      return {
        tenantId,
        stripeCustomerId: subscription.customer as string,
        stripeSubscriptionId: subscription.id,
        status: subscription.status as SubscriptionInfo['status'],
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        tier: subscription.items.data[0]?.price.metadata?.['tier'] || 'unknown',
      };
    } catch (error) {
      logger.error('Failed to get subscription', { subscriptionId, error });
      return null;
    }
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(subscriptionId: string, immediate: boolean = false): Promise<void> {
    try {
      if (immediate) {
        await this.stripe.subscriptions.cancel(subscriptionId);
      } else {
        await this.stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true,
        });
      }

      logger.info('Canceled subscription', { subscriptionId, immediate });
    } catch (error) {
      logger.error('Failed to cancel subscription', { subscriptionId, error });
      throw error;
    }
  }

  /**
   * Update subscription tier
   */
  async updateSubscription(subscriptionId: string, newPriceId: string): Promise<void> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
      const firstItem = subscription.items.data[0];
      if (!firstItem) {
        throw new ServiceError(
          'No subscription items found',
          'INTERNAL_ERROR',
          'BillingIntegration'
        );
      }
      await this.stripe.subscriptions.update(subscriptionId, {
        items: [
          {
            id: firstItem.id,
            price: newPriceId,
          },
        ],
      });

      logger.info('Updated subscription', { subscriptionId, newPriceId });
    } catch (error) {
      logger.error('Failed to update subscription', { subscriptionId, error });
      throw error;
    }
  }

  // ==========================================================================
  // Invoice Generation
  // ==========================================================================

  /**
   * Generate invoice for tenant
   */
  async generateInvoice(tenantId: string): Promise<InvoiceInfo> {
    try {
      const customerId = this.getCustomerId(tenantId);
      if (!customerId) {
        throw new NotFoundError('Stripe customer', tenantId);
      }

      // Get cost breakdown
      const costBreakdown = this.costTracker.calculateCost(tenantId);

      // Create invoice items
      await this.addInvoiceItems(customerId, costBreakdown);

      // Create invoice
      const invoice = await this.stripe.invoices.create({
        customer: customerId,
        auto_advance: true,
        metadata: {
          tenantId,
          periodStart: costBreakdown.period.startDate.toISOString(),
          periodEnd: costBreakdown.period.endDate.toISOString(),
        },
      });

      // Finalize invoice
      const finalizedInvoice = await this.stripe.invoices.finalizeInvoice(invoice.id);

      const info: InvoiceInfo = {
        tenantId,
        invoiceId: invoice.id,
        stripeInvoiceId: invoice.id,
        amount: finalizedInvoice.amount_due / 100, // Convert from cents
        currency: finalizedInvoice.currency,
        status: finalizedInvoice.status as InvoiceInfo['status'],
        periodStart: costBreakdown.period.startDate,
        periodEnd: costBreakdown.period.endDate,
        createdAt: new Date(finalizedInvoice.created * 1000),
        dueDate: finalizedInvoice.due_date ? new Date(finalizedInvoice.due_date * 1000) : undefined,
        hostedInvoiceUrl: finalizedInvoice.hosted_invoice_url || undefined,
        invoicePdf: finalizedInvoice.invoice_pdf || undefined,
      };

      logger.info('Generated invoice', info);
      this.emit('invoice:generated', info);

      return info;
    } catch (error) {
      logger.error('Failed to generate invoice', { tenantId, error });
      throw error;
    }
  }

  /**
   * Add invoice items from cost breakdown
   */
  private async addInvoiceItems(customerId: string, costBreakdown: CostBreakdown): Promise<void> {
    const items = [
      {
        description: `API Calls (${costBreakdown.usage.apiCalls.total.toLocaleString()})`,
        amount: Math.round(costBreakdown.costs.apiCalls * 100), // Convert to cents
      },
      {
        description: `Storage (${costBreakdown.usage.storage.gb.toFixed(2)} GB)`,
        amount: Math.round(costBreakdown.costs.storage * 100),
      },
      {
        description: `User Seats (${costBreakdown.usage.users.totalSeats})`,
        amount: Math.round(costBreakdown.costs.userSeats * 100),
      },
      {
        description: 'Feature Usage',
        amount: Math.round(costBreakdown.costs.features * 100),
      },
    ];

    // Add discount if applicable
    if (costBreakdown.costs.discounts > 0) {
      items.push({
        description: `${costBreakdown.tier.name} Tier Discount (${costBreakdown.tier.discountPercent}%)`,
        amount: -Math.round(costBreakdown.costs.discounts * 100),
      });
    }

    // Create invoice items
    for (const item of items) {
      if (item.amount > 0 || item.amount < 0) {
        await this.stripe.invoiceItems.create({
          customer: customerId,
          amount: item.amount,
          currency: this.config.currency,
          description: item.description,
        });
      }
    }
  }

  /**
   * Get invoice
   */
  async getInvoice(invoiceId: string): Promise<InvoiceInfo | null> {
    try {
      const invoice = await this.stripe.invoices.retrieve(invoiceId);
      const tenantId = this.getTenantId(invoice.customer as string);

      if (!tenantId) {
        return null;
      }

      return {
        tenantId,
        invoiceId: invoice.id,
        stripeInvoiceId: invoice.id,
        amount: invoice.amount_due / 100,
        currency: invoice.currency,
        status: invoice.status as InvoiceInfo['status'],
        periodStart: new Date(invoice.period_start * 1000),
        periodEnd: new Date(invoice.period_end * 1000),
        createdAt: new Date(invoice.created * 1000),
        dueDate: invoice.due_date ? new Date(invoice.due_date * 1000) : undefined,
        paidAt: invoice.status_transitions?.paid_at
          ? new Date(invoice.status_transitions.paid_at * 1000)
          : undefined,
        hostedInvoiceUrl: invoice.hosted_invoice_url || undefined,
        invoicePdf: invoice.invoice_pdf || undefined,
      };
    } catch (error) {
      logger.error('Failed to get invoice', { invoiceId, error });
      return null;
    }
  }

  /**
   * List invoices for tenant
   */
  async listInvoices(tenantId: string, limit: number = 10): Promise<InvoiceInfo[]> {
    try {
      const customerId = this.getCustomerId(tenantId);
      if (!customerId) {
        return [];
      }

      const invoices = await this.stripe.invoices.list({
        customer: customerId,
        limit,
      });

      return invoices.data.map((invoice: Stripe.Invoice) => ({
        tenantId,
        invoiceId: invoice.id,
        stripeInvoiceId: invoice.id,
        amount: invoice.amount_due / 100,
        currency: invoice.currency,
        status: invoice.status as InvoiceInfo['status'],
        periodStart: new Date(invoice.period_start * 1000),
        periodEnd: new Date(invoice.period_end * 1000),
        createdAt: new Date(invoice.created * 1000),
        dueDate: invoice.due_date ? new Date(invoice.due_date * 1000) : undefined,
        paidAt: invoice.status_transitions?.paid_at
          ? new Date(invoice.status_transitions.paid_at * 1000)
          : undefined,
        hostedInvoiceUrl: invoice.hosted_invoice_url || undefined,
        invoicePdf: invoice.invoice_pdf || undefined,
      }));
    } catch (error) {
      logger.error('Failed to list invoices', { tenantId, error });
      return [];
    }
  }

  // ==========================================================================
  // Payment Methods
  // ==========================================================================

  /**
   * Attach payment method to customer
   */
  async attachPaymentMethod(tenantId: string, paymentMethodId: string): Promise<void> {
    try {
      const customerId = this.getCustomerId(tenantId);
      if (!customerId) {
        throw new NotFoundError('Stripe customer', tenantId);
      }

      await this.stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });

      // Set as default payment method
      await this.stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });

      logger.info('Attached payment method', { tenantId, paymentMethodId });
    } catch (error) {
      logger.error('Failed to attach payment method', { tenantId, error });
      throw error;
    }
  }

  /**
   * List payment methods for tenant
   */
  async listPaymentMethods(tenantId: string): Promise<PaymentMethod[]> {
    try {
      const customerId = this.getCustomerId(tenantId);
      if (!customerId) {
        return [];
      }

      const customer = await this.stripe.customers.retrieve(customerId);
      const defaultPaymentMethodId =
        customer && !customer.deleted ? customer.invoice_settings?.default_payment_method : null;

      const paymentMethods = await this.stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
      });

      return paymentMethods.data.map((pm: Stripe.PaymentMethod) => ({
        id: pm.id,
        type: pm.type as 'card',
        last4: pm.card?.last4 || '',
        brand: pm.card?.brand,
        expiryMonth: pm.card?.exp_month,
        expiryYear: pm.card?.exp_year,
        isDefault: pm.id === defaultPaymentMethodId,
      }));
    } catch (error) {
      logger.error('Failed to list payment methods', { tenantId, error });
      return [];
    }
  }

  // ==========================================================================
  // Auto-Invoicing
  // ==========================================================================

  /**
   * Start automatic invoice generation at end of billing period
   */
  private startAutoInvoicing(): void {
    const checkInterval = 24 * 60 * 60 * 1000; // Check daily

    setInterval(async () => {
      const now = new Date();
      const isEndOfMonth =
        now.getDate() === new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

      if (isEndOfMonth) {
        logger.info('Running auto-invoicing for all tenants');
        const tenants = this.costTracker.getAllTenants();

        for (const tenantId of tenants) {
          try {
            await this.generateInvoice(tenantId);
          } catch (error) {
            logger.error('Auto-invoicing failed', { tenantId, error });
          }
        }
      }
    }, checkInterval);
  }

  // ==========================================================================
  // Webhook Handling
  // ==========================================================================

  /**
   * Handle Stripe webhook event
   */
  async handleWebhook(payload: string | Buffer, signature: string): Promise<void> {
    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.config.webhookSecret
      );

      switch (event.type) {
        case 'invoice.paid':
          await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
          break;
        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;
      }
    } catch (error) {
      logger.error('Webhook handling failed', { error });
      throw error;
    }
  }

  private async handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const tenantId = this.getTenantId(invoice.customer as string);
    if (tenantId) {
      logger.info('Invoice paid', { tenantId, invoiceId: invoice.id });
      this.emit('invoice:paid', { tenantId, invoiceId: invoice.id });
    }
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const tenantId = this.getTenantId(invoice.customer as string);
    if (tenantId) {
      logger.warn('Invoice payment failed', { tenantId, invoiceId: invoice.id });
      this.emit('invoice:payment_failed', { tenantId, invoiceId: invoice.id });
    }
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const tenantId = this.getTenantId(subscription.customer as string);
    if (tenantId) {
      logger.info('Subscription deleted', { tenantId, subscriptionId: subscription.id });
      this.emit('subscription:deleted', { tenantId, subscriptionId: subscription.id });
    }
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const tenantId = this.getTenantId(subscription.customer as string);
    if (tenantId) {
      logger.info('Subscription updated', { tenantId, subscriptionId: subscription.id });
      this.emit('subscription:updated', { tenantId, subscriptionId: subscription.id });
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

let billingIntegrationInstance: BillingIntegration | null = null;

export function createBillingIntegration(config: BillingConfig): BillingIntegration {
  billingIntegrationInstance = new BillingIntegration(config);
  return billingIntegrationInstance;
}

export function getBillingIntegration(): BillingIntegration | null {
  return billingIntegrationInstance;
}

/**
 * Initialize billing integration from runtime configuration.
 *
 * Safe behavior:
 * - No-op when disabled
 * - Reuses existing singleton if already initialized
 * - Logs and returns null on missing/invalid config
 */
export function initializeBillingIntegration(
  config: BillingBootstrapConfig
): BillingIntegration | null {
  if (!config.enabled) {
    return billingIntegrationInstance;
  }

  if (billingIntegrationInstance) {
    return billingIntegrationInstance;
  }

  const secret = config.stripeSecretKey?.trim();
  if (!secret) {
    logger.warn('Billing integration enabled but STRIPE_SECRET_KEY is not configured');
    return null;
  }

  try {
    const integration = createBillingIntegration({
      stripeSecretKey: secret,
      webhookSecret: config.webhookSecret?.trim() || undefined,
      currency: config.currency ?? 'usd',
      billingCycle: config.billingCycle ?? 'monthly',
      autoInvoicing: config.autoInvoicing ?? true,
    });

    logger.info('Billing integration initialized', {
      billingCycle: config.billingCycle ?? 'monthly',
      autoInvoicing: config.autoInvoicing ?? true,
      hasWebhookSecret: Boolean(config.webhookSecret),
    });

    return integration;
  } catch (error) {
    logger.error('Billing integration initialization failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
