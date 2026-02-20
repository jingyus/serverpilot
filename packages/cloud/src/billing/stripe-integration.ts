// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Stripe subscription management service.
 *
 * Handles Stripe Customer creation/retrieval, subscription lifecycle
 * (create, cancel, plan change), and maps Stripe objects to our DB schema.
 *
 * @module cloud/billing/stripe-integration
 */

import Stripe from 'stripe';
import { getPriceId } from './constants.js';
import type {
  SubscriptionRow,
  CreateSubscriptionInput,
  CreateSubscriptionResult,
  CancelSubscriptionInput,
  CancelSubscriptionResult,
  ChangePlanInput,
  ChangePlanResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Stripe client factory (mockable for tests)
// ---------------------------------------------------------------------------

let _stripeClient: Stripe | null = null;

/** Returns the shared Stripe SDK instance, creating it lazily. */
export function getStripeClient(): Stripe {
  if (!_stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }
    _stripeClient = new Stripe(key);
  }
  return _stripeClient;
}

/** Replace the Stripe client (for testing). */
export function setStripeClient(client: Stripe | null): void {
  _stripeClient = client;
}

// ---------------------------------------------------------------------------
// Subscription repository interface (dependency injection)
// ---------------------------------------------------------------------------

/** Minimal interface for persisting subscription data. */
export interface SubscriptionStore {
  findByTenantId(tenantId: string): Promise<SubscriptionRow | null>;
  create(row: Omit<SubscriptionRow, 'id'>): Promise<SubscriptionRow>;
  update(id: number, data: Partial<SubscriptionRow>): Promise<SubscriptionRow>;
}

let _store: SubscriptionStore | null = null;

/** Set the subscription store implementation. */
export function setSubscriptionStore(store: SubscriptionStore | null): void {
  _store = store;
}

/** Get the subscription store (throws if not set). */
export function getSubscriptionStore(): SubscriptionStore {
  if (!_store) {
    throw new Error('SubscriptionStore not initialized — call setSubscriptionStore() first');
  }
  return _store;
}

// ---------------------------------------------------------------------------
// Customer management
// ---------------------------------------------------------------------------

/**
 * Finds or creates a Stripe Customer for the given user.
 *
 * If `stripeCustomerId` is provided, validates it exists in Stripe.
 * Otherwise creates a new Customer with the user's email as metadata.
 */
export async function findOrCreateCustomer(
  userId: string,
  tenantId: string,
  email?: string,
  existingCustomerId?: string,
): Promise<string> {
  const stripe = getStripeClient();

  if (existingCustomerId) {
    const customer = await stripe.customers.retrieve(existingCustomerId);
    if (customer.deleted) {
      throw new Error(`Stripe customer ${existingCustomerId} has been deleted`);
    }
    return existingCustomerId;
  }

  const customer = await stripe.customers.create({
    metadata: { userId, tenantId },
    ...(email ? { email } : {}),
  });

  return customer.id;
}

// ---------------------------------------------------------------------------
// Subscription CRUD
// ---------------------------------------------------------------------------

/**
 * Creates a new Stripe subscription for a tenant.
 *
 * Flow:
 * 1. Resolve Stripe Price ID from plan
 * 2. Find or create Stripe Customer
 * 3. Create Stripe Subscription (payment_behavior: default_incomplete)
 * 4. Persist to DB
 * 5. Return clientSecret for frontend payment confirmation
 */
export async function createSubscription(
  input: CreateSubscriptionInput,
): Promise<CreateSubscriptionResult> {
  const { tenantId, userId, plan, stripeCustomerId } = input;

  const priceId = getPriceId(plan);
  if (!priceId) {
    throw new Error(`No Stripe price configured for plan: ${plan}`);
  }

  const customerId = await findOrCreateCustomer(userId, tenantId, undefined, stripeCustomerId);

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    metadata: { tenantId, userId, plan },
    expand: ['latest_invoice.confirmation_secret'],
  });

  const clientSecret = extractClientSecret(subscription);

  const now = new Date();
  const periodStart = new Date(subscription.start_date * 1000);
  const periodEnd = computePeriodEnd(periodStart);

  const store = getSubscriptionStore();
  const row = await store.create({
    tenantId,
    userId,
    plan,
    status: subscription.status as SubscriptionRow['status'],
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    createdAt: now,
    updatedAt: now,
  });

  return {
    subscription: row,
    stripeSubscriptionId: subscription.id,
    clientSecret: clientSecret ?? undefined,
  };
}

/**
 * Cancels a subscription at end of current billing period (or immediately).
 */
export async function cancelSubscription(
  input: CancelSubscriptionInput,
): Promise<CancelSubscriptionResult> {
  const { tenantId, immediate } = input;

  const store = getSubscriptionStore();
  const existing = await store.findByTenantId(tenantId);
  if (!existing) {
    throw new Error(`No subscription found for tenant: ${tenantId}`);
  }
  if (!existing.stripeSubscriptionId) {
    throw new Error(`Subscription for tenant ${tenantId} has no Stripe subscription ID`);
  }

  const stripe = getStripeClient();
  let effectiveDate: Date;

  if (immediate) {
    await stripe.subscriptions.cancel(existing.stripeSubscriptionId);
    effectiveDate = new Date();
  } else {
    await stripe.subscriptions.update(existing.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    effectiveDate = existing.currentPeriodEnd ?? new Date();
  }

  const updated = await store.update(existing.id, {
    cancelAtPeriodEnd: !immediate,
    status: immediate ? 'canceled' : existing.status,
    updatedAt: new Date(),
  });

  return { subscription: updated, effectiveDate };
}

/**
 * Retrieves the current subscription for a tenant.
 */
export async function getSubscription(tenantId: string): Promise<SubscriptionRow | null> {
  const store = getSubscriptionStore();
  return store.findByTenantId(tenantId);
}

/**
 * Changes the plan on an existing subscription.
 *
 * Uses Stripe's proration behavior to adjust billing.
 */
export async function updateSubscriptionPlan(
  input: ChangePlanInput,
): Promise<ChangePlanResult> {
  const { tenantId, newPlan } = input;

  const priceId = getPriceId(newPlan);
  if (!priceId) {
    throw new Error(`No Stripe price configured for plan: ${newPlan}`);
  }

  const store = getSubscriptionStore();
  const existing = await store.findByTenantId(tenantId);
  if (!existing) {
    throw new Error(`No subscription found for tenant: ${tenantId}`);
  }
  if (!existing.stripeSubscriptionId) {
    throw new Error(`Subscription for tenant ${tenantId} has no Stripe subscription ID`);
  }

  const stripe = getStripeClient();

  const sub = await stripe.subscriptions.retrieve(existing.stripeSubscriptionId);
  const currentItem = sub.items.data[0];
  if (!currentItem) {
    throw new Error('Stripe subscription has no items');
  }

  const updatedSub = await stripe.subscriptions.update(existing.stripeSubscriptionId, {
    items: [{ id: currentItem.id, price: priceId }],
    proration_behavior: 'always_invoice',
    metadata: { plan: newPlan },
  });

  const periodStart = new Date(updatedSub.start_date * 1000);
  const periodEnd = computePeriodEnd(periodStart);

  const updated = await store.update(existing.id, {
    plan: newPlan,
    status: updatedSub.status as SubscriptionRow['status'],
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    updatedAt: new Date(),
  });

  return {
    subscription: updated,
    immediate: true,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the client_secret from an expanded subscription's latest invoice.
 * Uses the Clover API's `confirmation_secret.client_secret` path.
 */
function extractClientSecret(subscription: Stripe.Subscription): string | null {
  const invoice = subscription.latest_invoice;
  if (!invoice || typeof invoice === 'string') return null;
  return invoice.confirmation_secret?.client_secret ?? null;
}

/**
 * Computes the end of a monthly billing period from a start date.
 * Adds 1 calendar month (matching Stripe's default monthly behavior).
 */
export function computePeriodEnd(start: Date): Date {
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
}
