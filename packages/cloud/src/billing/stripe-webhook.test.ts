// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Stripe from 'stripe';
import {
  handleStripeWebhook,
  handleSubscriptionUpdated,
  handleSubscriptionCanceled,
  handlePaymentFailed,
  handlePaymentSucceeded,
  setWebhookSubscriptionStore,
  setWebhookTenantStore,
  getWebhookSubscriptionStore,
  getWebhookTenantStore,
} from './stripe-webhook.js';
import type {
  WebhookSubscriptionStore,
  WebhookTenantStore,
} from './stripe-webhook.js';
import { setStripeClient } from './stripe-integration.js';
import type { SubscriptionRow, StripeSubscriptionObject, StripeInvoiceObject } from './types.js';
import { PLAN_LIMITS } from './constants.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: 1,
    tenantId: 'tenant-1',
    userId: 'user-1',
    plan: 'pro',
    status: 'active',
    stripeSubscriptionId: 'sub_123',
    stripeCustomerId: 'cus_123',
    currentPeriodStart: new Date('2026-02-01'),
    currentPeriodEnd: new Date('2026-03-01'),
    cancelAtPeriodEnd: false,
    createdAt: new Date('2026-02-01'),
    updatedAt: new Date('2026-02-01'),
    ...overrides,
  };
}

function createMockSubStore(existing?: SubscriptionRow | null): WebhookSubscriptionStore {
  let stored = existing ?? null;
  return {
    findByTenantId: vi.fn(async () => stored),
    findByStripeSubscriptionId: vi.fn(async (id: string) => {
      if (stored && stored.stripeSubscriptionId === id) return stored;
      return null;
    }),
    create: vi.fn(async (row: Omit<SubscriptionRow, 'id'>) => {
      stored = { id: 1, ...row } as SubscriptionRow;
      return stored;
    }),
    update: vi.fn(async (id: number, data: Partial<SubscriptionRow>) => {
      if (!stored || stored.id !== id) throw new Error('not found');
      stored = { ...stored, ...data };
      return stored;
    }),
  };
}

function createMockTenantStore(): WebhookTenantStore {
  return {
    updatePlan: vi.fn(async () => {}),
  };
}

function makeSubscriptionObject(
  overrides: Partial<StripeSubscriptionObject> = {},
): StripeSubscriptionObject {
  return {
    id: 'sub_123',
    customer: 'cus_123',
    status: 'active',
    current_period_start: 1738368000,
    current_period_end: 1740960000,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: 'price_pro_monthly' } }] },
    metadata: { tenantId: 'tenant-1', userId: 'user-1', plan: 'pro' },
    ...overrides,
  };
}

function makeInvoiceObject(
  overrides: Partial<StripeInvoiceObject> = {},
): StripeInvoiceObject {
  return {
    id: 'inv_123',
    customer: 'cus_123',
    subscription: 'sub_123',
    status: 'paid',
    amount_due: 1900,
    amount_paid: 1900,
    currency: 'usd',
    ...overrides,
  };
}

function createMockStripe() {
  return {
    webhooks: {
      constructEvent: vi.fn(),
    },
    customers: { retrieve: vi.fn(), create: vi.fn() },
    subscriptions: { create: vi.fn(), retrieve: vi.fn(), update: vi.fn(), cancel: vi.fn() },
  } as unknown as Stripe;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  setWebhookSubscriptionStore(null);
  setWebhookTenantStore(null);
  setStripeClient(null);
});

// ---------------------------------------------------------------------------
// Store singletons
// ---------------------------------------------------------------------------

describe('store singletons', () => {
  it('throws when WebhookSubscriptionStore is not initialized', () => {
    expect(() => getWebhookSubscriptionStore()).toThrow('WebhookSubscriptionStore not initialized');
  });

  it('throws when WebhookTenantStore is not initialized', () => {
    expect(() => getWebhookTenantStore()).toThrow('WebhookTenantStore not initialized');
  });

  it('returns the injected subscription store', () => {
    const store = createMockSubStore();
    setWebhookSubscriptionStore(store);
    expect(getWebhookSubscriptionStore()).toBe(store);
  });

  it('returns the injected tenant store', () => {
    const store = createMockTenantStore();
    setWebhookTenantStore(store);
    expect(getWebhookTenantStore()).toBe(store);
  });
});

// ---------------------------------------------------------------------------
// handleStripeWebhook — signature verification
// ---------------------------------------------------------------------------

describe('handleStripeWebhook', () => {
  it('throws when STRIPE_WEBHOOK_SECRET is not set', async () => {
    const original = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      await expect(handleStripeWebhook('{}', 'sig')).rejects.toThrow(
        'STRIPE_WEBHOOK_SECRET',
      );
    } finally {
      if (original) process.env.STRIPE_WEBHOOK_SECRET = original;
    }
  });

  it('returns failure when signature verification fails', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    const stripe = createMockStripe();
    (stripe.webhooks.constructEvent as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Invalid signature');
    });
    setStripeClient(stripe);

    const result = await handleStripeWebhook('payload', 'bad_sig');

    expect(result.success).toBe(false);
    expect(result.eventId).toBe('unknown');
    expect(result.error).toContain('Signature verification failed');
    expect(result.error).toContain('Invalid signature');

    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it('ignores unhandled event types without error', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    const stripe = createMockStripe();
    (stripe.webhooks.constructEvent as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'evt_unknown',
      type: 'charge.succeeded',
      data: { object: {} },
    });
    setStripeClient(stripe);

    const result = await handleStripeWebhook('payload', 'valid_sig');

    expect(result.success).toBe(true);
    expect(result.eventId).toBe('evt_unknown');

    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it('dispatches subscription.created to handleSubscriptionUpdated', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    const stripe = createMockStripe();
    const subObj = makeSubscriptionObject();
    (stripe.webhooks.constructEvent as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'evt_created',
      type: 'customer.subscription.created',
      data: { object: subObj },
    });
    setStripeClient(stripe);

    const subStore = createMockSubStore(makeRow());
    const tenantStore = createMockTenantStore();
    setWebhookSubscriptionStore(subStore);
    setWebhookTenantStore(tenantStore);

    const result = await handleStripeWebhook('payload', 'valid_sig');

    expect(result.success).toBe(true);
    expect(result.eventType).toBe('customer.subscription.created');
    expect(subStore.findByStripeSubscriptionId).toHaveBeenCalledWith('sub_123');

    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it('returns failure when handler throws', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    const stripe = createMockStripe();
    (stripe.webhooks.constructEvent as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'evt_fail',
      type: 'customer.subscription.updated',
      data: { object: makeSubscriptionObject() },
    });
    setStripeClient(stripe);

    // Don't set stores — handler will throw
    const result = await handleStripeWebhook('payload', 'valid_sig');

    expect(result.success).toBe(false);
    expect(result.eventId).toBe('evt_fail');
    expect(result.error).toContain('WebhookSubscriptionStore not initialized');

    delete process.env.STRIPE_WEBHOOK_SECRET;
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionUpdated
// ---------------------------------------------------------------------------

describe('handleSubscriptionUpdated', () => {
  let subStore: WebhookSubscriptionStore;
  let tenantStore: WebhookTenantStore;

  beforeEach(() => {
    subStore = createMockSubStore(makeRow());
    tenantStore = createMockTenantStore();
    setWebhookSubscriptionStore(subStore);
    setWebhookTenantStore(tenantStore);
  });

  it('updates subscription status and period from Stripe object', async () => {
    const sub = makeSubscriptionObject({ status: 'active' });
    await handleSubscriptionUpdated(sub);

    expect(subStore.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: 'active',
        currentPeriodStart: new Date(sub.current_period_start * 1000),
        currentPeriodEnd: new Date(sub.current_period_end * 1000),
        cancelAtPeriodEnd: false,
      }),
    );
  });

  it('syncs tenant plan and limits from metadata', async () => {
    const sub = makeSubscriptionObject({ metadata: { plan: 'team' } });
    await handleSubscriptionUpdated(sub);

    const teamLimits = PLAN_LIMITS['team'];
    expect(tenantStore.updatePlan).toHaveBeenCalledWith(
      'tenant-1',
      'team',
      teamLimits.maxServers,
      teamLimits.maxUsers,
    );
  });

  it('uses existing plan when metadata has no plan', async () => {
    const sub = makeSubscriptionObject({ metadata: {} });
    await handleSubscriptionUpdated(sub);

    const proLimits = PLAN_LIMITS['pro'];
    expect(tenantStore.updatePlan).toHaveBeenCalledWith(
      'tenant-1',
      'pro', // existing row plan
      proLimits.maxServers,
      proLimits.maxUsers,
    );
  });

  it('silently returns when subscription not found locally', async () => {
    const emptyStore = createMockSubStore(null);
    setWebhookSubscriptionStore(emptyStore);

    const sub = makeSubscriptionObject({ id: 'sub_unknown' });
    await handleSubscriptionUpdated(sub);

    expect(emptyStore.update).not.toHaveBeenCalled();
    expect(tenantStore.updatePlan).not.toHaveBeenCalled();
  });

  it('ignores invalid plan values in metadata', async () => {
    const sub = makeSubscriptionObject({ metadata: { plan: 'invalid_plan' } });
    await handleSubscriptionUpdated(sub);

    // Should fall back to existing plan ('pro')
    const proLimits = PLAN_LIMITS['pro'];
    expect(tenantStore.updatePlan).toHaveBeenCalledWith(
      'tenant-1',
      'pro',
      proLimits.maxServers,
      proLimits.maxUsers,
    );
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionCanceled
// ---------------------------------------------------------------------------

describe('handleSubscriptionCanceled', () => {
  let subStore: WebhookSubscriptionStore;
  let tenantStore: WebhookTenantStore;

  beforeEach(() => {
    subStore = createMockSubStore(makeRow({ plan: 'team' }));
    tenantStore = createMockTenantStore();
    setWebhookSubscriptionStore(subStore);
    setWebhookTenantStore(tenantStore);
  });

  it('downgrades subscription to free and cancels', async () => {
    const sub = makeSubscriptionObject();
    await handleSubscriptionCanceled(sub);

    expect(subStore.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: 'canceled',
        plan: 'free',
        cancelAtPeriodEnd: false,
      }),
    );
  });

  it('downgrades tenant to free plan limits (maxServers:1, maxUsers:1)', async () => {
    const sub = makeSubscriptionObject();
    await handleSubscriptionCanceled(sub);

    expect(tenantStore.updatePlan).toHaveBeenCalledWith(
      'tenant-1',
      'free',
      1, // PLAN_LIMITS.free.maxServers
      1, // PLAN_LIMITS.free.maxUsers
    );
  });

  it('silently returns when subscription not found locally', async () => {
    const emptyStore = createMockSubStore(null);
    setWebhookSubscriptionStore(emptyStore);

    const sub = makeSubscriptionObject({ id: 'sub_unknown' });
    await handleSubscriptionCanceled(sub);

    expect(emptyStore.update).not.toHaveBeenCalled();
    expect(tenantStore.updatePlan).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handlePaymentFailed
// ---------------------------------------------------------------------------

describe('handlePaymentFailed', () => {
  let subStore: WebhookSubscriptionStore;

  beforeEach(() => {
    subStore = createMockSubStore(makeRow());
    setWebhookSubscriptionStore(subStore);
    setWebhookTenantStore(createMockTenantStore());
  });

  it('marks subscription as past_due', async () => {
    const invoice = makeInvoiceObject({ status: 'open' });
    await handlePaymentFailed(invoice);

    expect(subStore.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: 'past_due',
      }),
    );
  });

  it('ignores invoices without a subscription', async () => {
    const invoice = makeInvoiceObject({ subscription: null });
    await handlePaymentFailed(invoice);

    expect(subStore.findByStripeSubscriptionId).not.toHaveBeenCalled();
    expect(subStore.update).not.toHaveBeenCalled();
  });

  it('silently returns when subscription not found locally', async () => {
    const emptyStore = createMockSubStore(null);
    setWebhookSubscriptionStore(emptyStore);

    const invoice = makeInvoiceObject({ subscription: 'sub_unknown' });
    await handlePaymentFailed(invoice);

    expect(emptyStore.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handlePaymentSucceeded
// ---------------------------------------------------------------------------

describe('handlePaymentSucceeded', () => {
  let subStore: WebhookSubscriptionStore;

  beforeEach(() => {
    subStore = createMockSubStore(makeRow({ status: 'past_due' }));
    setWebhookSubscriptionStore(subStore);
    setWebhookTenantStore(createMockTenantStore());
  });

  it('confirms subscription as active', async () => {
    const invoice = makeInvoiceObject({ status: 'paid' });
    await handlePaymentSucceeded(invoice);

    expect(subStore.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: 'active',
      }),
    );
  });

  it('ignores invoices without a subscription', async () => {
    const invoice = makeInvoiceObject({ subscription: null });
    await handlePaymentSucceeded(invoice);

    expect(subStore.findByStripeSubscriptionId).not.toHaveBeenCalled();
    expect(subStore.update).not.toHaveBeenCalled();
  });

  it('silently returns when subscription not found locally', async () => {
    const emptyStore = createMockSubStore(null);
    setWebhookSubscriptionStore(emptyStore);

    const invoice = makeInvoiceObject({ subscription: 'sub_unknown' });
    await handlePaymentSucceeded(invoice);

    expect(emptyStore.update).not.toHaveBeenCalled();
  });
});
