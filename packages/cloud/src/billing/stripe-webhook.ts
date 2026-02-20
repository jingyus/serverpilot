// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Stripe Webhook event handlers.
 *
 * Processes incoming Stripe webhook events and updates tenant plans,
 * subscription status, and billing state accordingly.
 *
 * Handles 4 event families:
 * - customer.subscription.created/updated → activate/update plan
 * - customer.subscription.deleted → downgrade to Free
 * - invoice.payment_failed → mark past_due
 * - invoice.payment_succeeded → confirm payment
 *
 * @module cloud/billing/stripe-webhook
 */

import Stripe from 'stripe';
import type { PlanId } from '../ai/types.js';
import type {
  SubscriptionRow,
  StripeSubscriptionObject,
  StripeInvoiceObject,
  WebhookProcessResult,
} from './types.js';
import { PLAN_LIMITS, HANDLED_STRIPE_EVENTS, type HandledStripeEvent } from './constants.js';

// ---------------------------------------------------------------------------
// Dependency injection interfaces
// ---------------------------------------------------------------------------

/** Minimal interface for subscription persistence (extends SubscriptionStore). */
export interface WebhookSubscriptionStore {
  findByTenantId(tenantId: string): Promise<SubscriptionRow | null>;
  findByStripeSubscriptionId(stripeSubId: string): Promise<SubscriptionRow | null>;
  create(row: Omit<SubscriptionRow, 'id'>): Promise<SubscriptionRow>;
  update(id: number, data: Partial<SubscriptionRow>): Promise<SubscriptionRow>;
}

/** Minimal interface for tenant plan updates. */
export interface WebhookTenantStore {
  updatePlan(
    tenantId: string,
    plan: PlanId,
    maxServers: number,
    maxUsers: number,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Singleton stores (dependency injection)
// ---------------------------------------------------------------------------

let _subscriptionStore: WebhookSubscriptionStore | null = null;
let _tenantStore: WebhookTenantStore | null = null;

export function setWebhookSubscriptionStore(store: WebhookSubscriptionStore | null): void {
  _subscriptionStore = store;
}

export function getWebhookSubscriptionStore(): WebhookSubscriptionStore {
  if (!_subscriptionStore) {
    throw new Error('WebhookSubscriptionStore not initialized — call setWebhookSubscriptionStore() first');
  }
  return _subscriptionStore;
}

export function setWebhookTenantStore(store: WebhookTenantStore | null): void {
  _tenantStore = store;
}

export function getWebhookTenantStore(): WebhookTenantStore {
  if (!_tenantStore) {
    throw new Error('WebhookTenantStore not initialized — call setWebhookTenantStore() first');
  }
  return _tenantStore;
}

// ---------------------------------------------------------------------------
// Stripe client access (reuses stripe-integration singleton)
// ---------------------------------------------------------------------------

import { getStripeClient } from './stripe-integration.js';

// ---------------------------------------------------------------------------
// Main webhook entry point
// ---------------------------------------------------------------------------

/**
 * Verifies the Stripe webhook signature and dispatches the event
 * to the appropriate handler.
 *
 * @param payload - Raw request body (Buffer or string)
 * @param signature - Value of the `stripe-signature` header
 * @returns Processing result with success status and event metadata
 */
export async function handleStripeWebhook(
  payload: string | Buffer,
  signature: string,
): Promise<WebhookProcessResult> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET environment variable is not set');
  }

  const stripe = getStripeClient();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown signature verification error';
    return {
      success: false,
      eventId: 'unknown',
      eventType: 'customer.subscription.updated' as HandledStripeEvent,
      error: `Signature verification failed: ${message}`,
    };
  }

  const eventType = event.type;

  // Ignore unhandled event types gracefully
  if (!isHandledEvent(eventType)) {
    return {
      success: true,
      eventId: event.id,
      eventType: eventType as HandledStripeEvent,
    };
  }

  try {
    switch (eventType) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as unknown as StripeSubscriptionObject);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionCanceled(event.data.object as unknown as StripeSubscriptionObject);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as unknown as StripeInvoiceObject);
        break;
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object as unknown as StripeInvoiceObject);
        break;
    }

    return {
      success: true,
      eventId: event.id,
      eventType: eventType as HandledStripeEvent,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      success: false,
      eventId: event.id,
      eventType: eventType as HandledStripeEvent,
      error: message,
    };
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * Handles subscription.created and subscription.updated events.
 *
 * Updates the local subscription row with the latest status and period,
 * then syncs the tenant plan and resource limits.
 */
export async function handleSubscriptionUpdated(
  subscription: StripeSubscriptionObject,
): Promise<void> {
  const store = getWebhookSubscriptionStore();
  const tenantStore = getWebhookTenantStore();

  const existing = await store.findByStripeSubscriptionId(subscription.id);
  if (!existing) return; // subscription not tracked locally

  const plan = resolvePlanFromMetadata(subscription);
  const now = new Date();

  await store.update(existing.id, {
    status: subscription.status,
    currentPeriodStart: new Date(subscription.current_period_start * 1000),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    ...(plan ? { plan } : {}),
    updatedAt: now,
  });

  // Sync tenant resource limits
  const effectivePlan = plan ?? existing.plan;
  const limits = PLAN_LIMITS[effectivePlan];
  await tenantStore.updatePlan(
    existing.tenantId,
    effectivePlan,
    limits.maxServers,
    limits.maxUsers,
  );
}

/**
 * Handles subscription.deleted — downgrades tenant to the free plan.
 *
 * Sets subscription status to 'canceled' and resets tenant limits
 * to free-tier values (maxServers: 1, maxUsers: 1).
 */
export async function handleSubscriptionCanceled(
  subscription: StripeSubscriptionObject,
): Promise<void> {
  const store = getWebhookSubscriptionStore();
  const tenantStore = getWebhookTenantStore();

  const existing = await store.findByStripeSubscriptionId(subscription.id);
  if (!existing) return;

  const now = new Date();
  const freeLimits = PLAN_LIMITS['free'];

  await store.update(existing.id, {
    status: 'canceled',
    plan: 'free',
    cancelAtPeriodEnd: false,
    updatedAt: now,
  });

  await tenantStore.updatePlan(
    existing.tenantId,
    'free',
    freeLimits.maxServers,
    freeLimits.maxUsers,
  );
}

/**
 * Handles invoice.payment_failed — marks subscription as past_due.
 */
export async function handlePaymentFailed(
  invoice: StripeInvoiceObject,
): Promise<void> {
  if (!invoice.subscription) return;

  const store = getWebhookSubscriptionStore();
  const existing = await store.findByStripeSubscriptionId(invoice.subscription);
  if (!existing) return;

  await store.update(existing.id, {
    status: 'past_due',
    updatedAt: new Date(),
  });
}

/**
 * Handles invoice.payment_succeeded — confirms subscription is active.
 */
export async function handlePaymentSucceeded(
  invoice: StripeInvoiceObject,
): Promise<void> {
  if (!invoice.subscription) return;

  const store = getWebhookSubscriptionStore();
  const existing = await store.findByStripeSubscriptionId(invoice.subscription);
  if (!existing) return;

  await store.update(existing.id, {
    status: 'active',
    updatedAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Checks whether a Stripe event type is one we handle. */
function isHandledEvent(type: string): type is HandledStripeEvent {
  return (HANDLED_STRIPE_EVENTS as readonly string[]).includes(type);
}

/**
 * Resolves the PlanId from subscription metadata.
 * Returns null if no plan metadata is set.
 */
function resolvePlanFromMetadata(subscription: StripeSubscriptionObject): PlanId | null {
  const plan = subscription.metadata?.plan;
  if (plan && ['free', 'pro', 'team', 'enterprise'].includes(plan)) {
    return plan as PlanId;
  }
  return null;
}
