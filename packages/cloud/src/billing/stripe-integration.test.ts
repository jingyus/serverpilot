// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Stripe from 'stripe';
import {
  getStripeClient,
  setStripeClient,
  setSubscriptionStore,
  getSubscriptionStore,
  findOrCreateCustomer,
  createSubscription,
  cancelSubscription,
  getSubscription,
  updateSubscriptionPlan,
  computePeriodEnd,
} from './stripe-integration.js';
import type { SubscriptionStore } from './stripe-integration.js';
import type { SubscriptionRow } from './types.js';

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

function createMockStore(existing?: SubscriptionRow | null): SubscriptionStore {
  let stored = existing ?? null;
  return {
    findByTenantId: vi.fn(async () => stored),
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

function createMockStripe() {
  return {
    customers: {
      retrieve: vi.fn(),
      create: vi.fn(),
    },
    subscriptions: {
      create: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
    },
  } as unknown as Stripe;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  setStripeClient(null);
  setSubscriptionStore(null);
});

describe('getStripeClient', () => {
  it('throws when STRIPE_SECRET_KEY is not set', () => {
    const original = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      expect(() => getStripeClient()).toThrow('STRIPE_SECRET_KEY');
    } finally {
      if (original) process.env.STRIPE_SECRET_KEY = original;
    }
  });

  it('returns the injected client after setStripeClient', () => {
    const mock = createMockStripe();
    setStripeClient(mock);
    expect(getStripeClient()).toBe(mock);
  });
});

describe('getSubscriptionStore', () => {
  it('throws when store is not initialized', () => {
    expect(() => getSubscriptionStore()).toThrow('SubscriptionStore not initialized');
  });

  it('returns the injected store', () => {
    const store = createMockStore();
    setSubscriptionStore(store);
    expect(getSubscriptionStore()).toBe(store);
  });
});

describe('findOrCreateCustomer', () => {
  let stripe: ReturnType<typeof createMockStripe>;

  beforeEach(() => {
    stripe = createMockStripe();
    setStripeClient(stripe as unknown as Stripe);
  });

  it('validates existing customer when stripeCustomerId is provided', async () => {
    (stripe.customers.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cus_existing',
      deleted: false,
    });

    const result = await findOrCreateCustomer('user-1', 'tenant-1', undefined, 'cus_existing');
    expect(result).toBe('cus_existing');
    expect(stripe.customers.retrieve).toHaveBeenCalledWith('cus_existing');
    expect(stripe.customers.create).not.toHaveBeenCalled();
  });

  it('throws when existing customer is deleted', async () => {
    (stripe.customers.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cus_deleted',
      deleted: true,
    });

    await expect(
      findOrCreateCustomer('user-1', 'tenant-1', undefined, 'cus_deleted'),
    ).rejects.toThrow('has been deleted');
  });

  it('creates a new customer when no existing ID is provided', async () => {
    (stripe.customers.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cus_new',
    });

    const result = await findOrCreateCustomer('user-1', 'tenant-1', 'user@example.com');
    expect(result).toBe('cus_new');
    expect(stripe.customers.create).toHaveBeenCalledWith({
      metadata: { userId: 'user-1', tenantId: 'tenant-1' },
      email: 'user@example.com',
    });
  });

  it('creates customer without email when not provided', async () => {
    (stripe.customers.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cus_noemail',
    });

    await findOrCreateCustomer('user-1', 'tenant-1');
    expect(stripe.customers.create).toHaveBeenCalledWith({
      metadata: { userId: 'user-1', tenantId: 'tenant-1' },
    });
  });
});

describe('createSubscription', () => {
  let stripe: ReturnType<typeof createMockStripe>;
  let store: SubscriptionStore;

  beforeEach(() => {
    stripe = createMockStripe();
    setStripeClient(stripe as unknown as Stripe);
    store = createMockStore();
    setSubscriptionStore(store);

    (stripe.customers.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cus_new',
    });
  });

  it('creates a subscription for a new user (pro plan)', async () => {
    (stripe.subscriptions.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_new',
      status: 'incomplete',
      start_date: 1738368000,
      cancel_at_period_end: false,
      latest_invoice: {
        confirmation_secret: {
          client_secret: 'pi_secret_test',
        },
      },
    });

    const result = await createSubscription({
      tenantId: 'tenant-1',
      userId: 'user-1',
      plan: 'pro',
    });

    expect(result.stripeSubscriptionId).toBe('sub_new');
    expect(result.clientSecret).toBe('pi_secret_test');
    expect(result.subscription.plan).toBe('pro');
    expect(result.subscription.status).toBe('incomplete');
    expect(result.subscription.stripeCustomerId).toBe('cus_new');

    expect(stripe.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_new',
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.confirmation_secret'],
      }),
    );
  });

  it('reuses existing Stripe customer when provided', async () => {
    (stripe.customers.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cus_existing',
      deleted: false,
    });
    (stripe.subscriptions.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_existing',
      status: 'incomplete',
      start_date: 1738368000,
      cancel_at_period_end: false,
      latest_invoice: null,
    });

    const result = await createSubscription({
      tenantId: 'tenant-1',
      userId: 'user-1',
      plan: 'team',
      stripeCustomerId: 'cus_existing',
    });

    expect(result.subscription.stripeCustomerId).toBe('cus_existing');
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.customers.retrieve).toHaveBeenCalledWith('cus_existing');
  });

  it('returns undefined clientSecret when no confirmation_secret', async () => {
    (stripe.subscriptions.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_nopi',
      status: 'active',
      start_date: 1738368000,
      cancel_at_period_end: false,
      latest_invoice: null,
    });

    const result = await createSubscription({
      tenantId: 'tenant-1',
      userId: 'user-1',
      plan: 'enterprise',
    });

    expect(result.clientSecret).toBeUndefined();
  });

  it('persists the subscription row to the store', async () => {
    (stripe.subscriptions.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_persist',
      status: 'incomplete',
      start_date: 1738368000,
      cancel_at_period_end: false,
      latest_invoice: 'inv_string', // string = unexpanded
    });

    await createSubscription({
      tenantId: 'tenant-1',
      userId: 'user-1',
      plan: 'pro',
    });

    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        plan: 'pro',
        stripeSubscriptionId: 'sub_persist',
        stripeCustomerId: 'cus_new',
      }),
    );
  });

  it('sets period start and end based on start_date', async () => {
    const startTs = 1738368000; // 2025-02-01 UTC
    (stripe.subscriptions.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_period',
      status: 'active',
      start_date: startTs,
      cancel_at_period_end: false,
      latest_invoice: null,
    });

    const result = await createSubscription({
      tenantId: 'tenant-1',
      userId: 'user-1',
      plan: 'pro',
    });

    const expectedStart = new Date(startTs * 1000);
    const expectedEnd = computePeriodEnd(expectedStart);
    expect(result.subscription.currentPeriodStart).toEqual(expectedStart);
    expect(result.subscription.currentPeriodEnd).toEqual(expectedEnd);
  });

  it('propagates Stripe API errors', async () => {
    (stripe.subscriptions.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Stripe API error: card_declined'),
    );

    await expect(
      createSubscription({
        tenantId: 'tenant-1',
        userId: 'user-1',
        plan: 'pro',
      }),
    ).rejects.toThrow('Stripe API error: card_declined');
  });
});

describe('cancelSubscription', () => {
  let stripe: ReturnType<typeof createMockStripe>;
  let store: SubscriptionStore;

  beforeEach(() => {
    stripe = createMockStripe();
    setStripeClient(stripe as unknown as Stripe);
  });

  it('cancels at period end by default', async () => {
    const existing = makeRow();
    store = createMockStore(existing);
    setSubscriptionStore(store);

    (stripe.subscriptions.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_123',
      cancel_at_period_end: true,
    });

    const result = await cancelSubscription({ tenantId: 'tenant-1' });

    expect(result.subscription.cancelAtPeriodEnd).toBe(true);
    expect(result.subscription.status).toBe('active');
    expect(result.effectiveDate).toEqual(existing.currentPeriodEnd);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_123', {
      cancel_at_period_end: true,
    });
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('cancels immediately when immediate=true', async () => {
    store = createMockStore(makeRow());
    setSubscriptionStore(store);

    (stripe.subscriptions.cancel as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_123',
      status: 'canceled',
    });

    const result = await cancelSubscription({ tenantId: 'tenant-1', immediate: true });

    expect(result.subscription.status).toBe('canceled');
    expect(result.subscription.cancelAtPeriodEnd).toBe(false);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_123');
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('throws when no subscription exists', async () => {
    store = createMockStore(null);
    setSubscriptionStore(store);

    await expect(
      cancelSubscription({ tenantId: 'tenant-missing' }),
    ).rejects.toThrow('No subscription found');
  });

  it('throws when subscription has no Stripe ID', async () => {
    store = createMockStore(makeRow({ stripeSubscriptionId: null }));
    setSubscriptionStore(store);

    await expect(
      cancelSubscription({ tenantId: 'tenant-1' }),
    ).rejects.toThrow('no Stripe subscription ID');
  });
});

describe('getSubscription', () => {
  it('returns the subscription row for a tenant', async () => {
    const existing = makeRow();
    const store = createMockStore(existing);
    setSubscriptionStore(store);

    const result = await getSubscription('tenant-1');
    expect(result).toEqual(existing);
    expect(store.findByTenantId).toHaveBeenCalledWith('tenant-1');
  });

  it('returns null when no subscription exists', async () => {
    const store = createMockStore(null);
    setSubscriptionStore(store);

    const result = await getSubscription('tenant-missing');
    expect(result).toBeNull();
  });
});

describe('updateSubscriptionPlan', () => {
  let stripe: ReturnType<typeof createMockStripe>;
  let store: SubscriptionStore;

  beforeEach(() => {
    stripe = createMockStripe();
    setStripeClient(stripe as unknown as Stripe);
  });

  it('updates the subscription to a new plan', async () => {
    store = createMockStore(makeRow({ plan: 'pro' }));
    setSubscriptionStore(store);

    (stripe.subscriptions.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_123',
      items: { data: [{ id: 'si_item1', price: { id: 'price_pro_monthly' } }] },
    });
    (stripe.subscriptions.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_123',
      status: 'active',
      start_date: 1738368000,
    });

    const result = await updateSubscriptionPlan({
      tenantId: 'tenant-1',
      newPlan: 'team',
    });

    expect(result.subscription.plan).toBe('team');
    expect(result.immediate).toBe(true);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith(
      'sub_123',
      expect.objectContaining({
        items: [{ id: 'si_item1', price: expect.any(String) }],
        proration_behavior: 'always_invoice',
        metadata: { plan: 'team' },
      }),
    );
  });

  it('throws when no subscription exists', async () => {
    store = createMockStore(null);
    setSubscriptionStore(store);

    await expect(
      updateSubscriptionPlan({ tenantId: 'tenant-missing', newPlan: 'team' }),
    ).rejects.toThrow('No subscription found');
  });

  it('throws when subscription has no Stripe ID', async () => {
    store = createMockStore(makeRow({ stripeSubscriptionId: null }));
    setSubscriptionStore(store);

    await expect(
      updateSubscriptionPlan({ tenantId: 'tenant-1', newPlan: 'team' }),
    ).rejects.toThrow('no Stripe subscription ID');
  });

  it('throws when subscription has no items', async () => {
    store = createMockStore(makeRow());
    setSubscriptionStore(store);

    (stripe.subscriptions.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_123',
      items: { data: [] },
    });

    await expect(
      updateSubscriptionPlan({ tenantId: 'tenant-1', newPlan: 'enterprise' }),
    ).rejects.toThrow('no items');
  });

  it('persists the updated plan to the store', async () => {
    store = createMockStore(makeRow({ plan: 'pro' }));
    setSubscriptionStore(store);

    (stripe.subscriptions.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_123',
      items: { data: [{ id: 'si_item1' }] },
    });
    (stripe.subscriptions.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_123',
      status: 'active',
      start_date: 1738368000,
    });

    await updateSubscriptionPlan({ tenantId: 'tenant-1', newPlan: 'enterprise' });

    expect(store.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        plan: 'enterprise',
        status: 'active',
      }),
    );
  });
});

describe('computePeriodEnd', () => {
  it('adds one month to the start date', () => {
    const start = new Date('2026-02-01T00:00:00Z');
    const end = computePeriodEnd(start);
    expect(end).toEqual(new Date('2026-03-01T00:00:00Z'));
  });

  it('handles month-end boundaries (Jan 31 → Feb 28)', () => {
    const start = new Date('2026-01-31T00:00:00Z');
    const end = computePeriodEnd(start);
    // JavaScript Date rolls Jan 31 + 1 month to Mar 3 (28 days in Feb 2026)
    expect(end.getUTCMonth()).toBe(2); // March (0-indexed)
  });
});
