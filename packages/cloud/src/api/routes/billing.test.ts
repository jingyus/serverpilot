// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import type Stripe from 'stripe';
import { createBillingRoutes } from './billing.js';
import type { BillingApiEnv } from './billing.js';
import {
  setStripeClient,
  setSubscriptionStore,
} from '../../billing/stripe-integration.js';
import type { SubscriptionStore } from '../../billing/stripe-integration.js';
import {
  setWebhookSubscriptionStore,
  setWebhookTenantStore,
} from '../../billing/stripe-webhook.js';
import type {
  WebhookSubscriptionStore,
  WebhookTenantStore,
} from '../../billing/stripe-webhook.js';
import type { SubscriptionRow } from '../../billing/types.js';
import { PLANS } from '../../billing/index.js';

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

function createMockWebhookSubStore(existing?: SubscriptionRow | null): WebhookSubscriptionStore {
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
  return { updatePlan: vi.fn(async () => {}) };
}

function createMockStripe() {
  return {
    customers: {
      retrieve: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'cus_new' }),
    },
    subscriptions: {
      create: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
    },
    webhooks: {
      constructEvent: vi.fn(),
    },
  } as unknown as Stripe;
}

interface TestAppOptions {
  userId?: string;
  tenantId?: string | null;
  userRole?: 'owner' | 'admin' | 'member';
}

function createTestApp(opts?: TestAppOptions) {
  const app = new Hono<BillingApiEnv>();

  // Simulate auth/tenant/role middleware
  app.use('*', async (c, next) => {
    if (opts?.userId !== undefined) {
      c.set('userId', opts.userId);
    }
    if (opts?.tenantId !== undefined) {
      c.set('tenantId', opts.tenantId);
    }
    if (opts?.userRole !== undefined) {
      c.set('userRole', opts.userRole);
    }
    await next();
  });

  // Mount billing routes
  const billingRoutes = createBillingRoutes();
  app.route('/billing', billingRoutes);

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  setStripeClient(null);
  setSubscriptionStore(null);
  setWebhookSubscriptionStore(null);
  setWebhookTenantStore(null);
});

afterEach(() => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

// ---------------------------------------------------------------------------
// GET /plans — public endpoint
// ---------------------------------------------------------------------------

describe('GET /billing/plans', () => {
  it('returns all available plans without auth', async () => {
    const app = createTestApp(); // no auth
    const res = await app.request('/billing/plans');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plans).toEqual(PLANS);
    expect(body.plans).toHaveLength(4);
  });

  it('includes plan features in response', async () => {
    const app = createTestApp();
    const res = await app.request('/billing/plans');

    const body = await res.json();
    const freePlan = body.plans.find((p: { id: string }) => p.id === 'free');
    expect(freePlan).toBeDefined();
    expect(freePlan.monthlyPrice).toBe(0);
    expect(freePlan.features).toBeInstanceOf(Array);
  });
});

// ---------------------------------------------------------------------------
// POST /subscribe
// ---------------------------------------------------------------------------

describe('POST /billing/subscribe', () => {
  let stripe: ReturnType<typeof createMockStripe>;

  beforeEach(() => {
    stripe = createMockStripe();
    setStripeClient(stripe as unknown as Stripe);
  });

  it('returns 401 when not authenticated', async () => {
    const app = createTestApp(); // no auth
    const res = await app.request('/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro' }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when tenant context is missing', async () => {
    const app = createTestApp({ userId: 'user-1', tenantId: null, userRole: 'owner' });
    const res = await app.request('/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro' }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toBe('Tenant context required');
  });

  it('returns 403 when user is a member (not owner/admin)', async () => {
    const app = createTestApp({ userId: 'user-1', tenantId: 'tenant-1', userRole: 'member' });
    const res = await app.request('/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro' }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 for invalid plan', async () => {
    const app = createTestApp({ userId: 'user-1', tenantId: 'tenant-1', userRole: 'owner' });
    const res = await app.request('/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'invalid' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain('Invalid plan');
  });

  it('returns 400 for free plan (cannot subscribe to free)', async () => {
    const app = createTestApp({ userId: 'user-1', tenantId: 'tenant-1', userRole: 'owner' });
    const res = await app.request('/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'free' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 for invalid JSON body', async () => {
    const app = createTestApp({ userId: 'user-1', tenantId: 'tenant-1', userRole: 'owner' });
    const res = await app.request('/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe('Invalid JSON body');
  });

  it('creates subscription and returns 201 with clientSecret', async () => {
    const store = createMockStore();
    setSubscriptionStore(store);

    (stripe.subscriptions.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_new',
      status: 'incomplete',
      start_date: 1738368000,
      cancel_at_period_end: false,
      latest_invoice: {
        confirmation_secret: { client_secret: 'pi_secret_test' },
      },
    });

    const app = createTestApp({ userId: 'user-1', tenantId: 'tenant-1', userRole: 'owner' });
    const res = await app.request('/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.stripeSubscriptionId).toBe('sub_new');
    expect(body.clientSecret).toBe('pi_secret_test');
    expect(body.subscription.plan).toBe('pro');
  });

  it('allows admin to create subscription', async () => {
    const store = createMockStore();
    setSubscriptionStore(store);

    (stripe.subscriptions.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_admin',
      status: 'incomplete',
      start_date: 1738368000,
      cancel_at_period_end: false,
      latest_invoice: null,
    });

    const app = createTestApp({ userId: 'user-1', tenantId: 'tenant-1', userRole: 'admin' });
    const res = await app.request('/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'team' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.subscription.plan).toBe('team');
  });

  it('returns 500 when Stripe API fails', async () => {
    const store = createMockStore();
    setSubscriptionStore(store);

    (stripe.subscriptions.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Stripe API error: card_declined'),
    );

    const app = createTestApp({ userId: 'user-1', tenantId: 'tenant-1', userRole: 'owner' });
    const res = await app.request('/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro' }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toContain('card_declined');
  });
});

// ---------------------------------------------------------------------------
// GET /subscription
// ---------------------------------------------------------------------------

describe('GET /billing/subscription', () => {
  it('returns 401 when not authenticated', async () => {
    const app = createTestApp();
    const res = await app.request('/billing/subscription');

    expect(res.status).toBe(401);
  });

  it('returns 401 when tenant context is missing', async () => {
    const app = createTestApp({ userId: 'user-1', tenantId: null });
    const res = await app.request('/billing/subscription');

    expect(res.status).toBe(401);
  });

  it('returns current subscription', async () => {
    const existing = makeRow();
    const store = createMockStore(existing);
    setSubscriptionStore(store);

    const app = createTestApp({ userId: 'user-1', tenantId: 'tenant-1', userRole: 'member' });
    const res = await app.request('/billing/subscription');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription).toBeDefined();
    expect(body.subscription.plan).toBe('pro');
    expect(body.subscription.status).toBe('active');
  });

  it('returns null subscription when none exists', async () => {
    const store = createMockStore(null);
    setSubscriptionStore(store);

    const app = createTestApp({ userId: 'user-1', tenantId: 'tenant-1', userRole: 'member' });
    const res = await app.request('/billing/subscription');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription).toBeNull();
  });

  it('allows member to view subscription (read-only)', async () => {
    const store = createMockStore(makeRow());
    setSubscriptionStore(store);

    const app = createTestApp({ userId: 'user-2', tenantId: 'tenant-1', userRole: 'member' });
    const res = await app.request('/billing/subscription');

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /cancel
// ---------------------------------------------------------------------------

describe('POST /billing/cancel', () => {
  let stripe: ReturnType<typeof createMockStripe>;

  beforeEach(() => {
    stripe = createMockStripe();
    setStripeClient(stripe as unknown as Stripe);
  });

  it('returns 401 when not authenticated', async () => {
    const app = createTestApp();
    const res = await app.request('/billing/cancel', { method: 'POST' });

    expect(res.status).toBe(401);
  });

  it('returns 403 when user is a member', async () => {
    const app = createTestApp({ userId: 'user-1', tenantId: 'tenant-1', userRole: 'member' });
    const res = await app.request('/billing/cancel', { method: 'POST' });

    expect(res.status).toBe(403);
  });

  it('cancels at period end by default', async () => {
    const store = createMockStore(makeRow());
    setSubscriptionStore(store);

    (stripe.subscriptions.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_123',
      cancel_at_period_end: true,
    });

    const app = createTestApp({ userId: 'user-1', tenantId: 'tenant-1', userRole: 'owner' });
    const res = await app.request('/billing/cancel', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription.cancelAtPeriodEnd).toBe(true);
    expect(body.effectiveDate).toBeDefined();
  });

  it('cancels immediately when immediate=true', async () => {
    const store = createMockStore(makeRow());
    setSubscriptionStore(store);

    (stripe.subscriptions.cancel as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_123',
      status: 'canceled',
    });

    const app = createTestApp({ userId: 'user-1', tenantId: 'tenant-1', userRole: 'owner' });
    const res = await app.request('/billing/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ immediate: true }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription.status).toBe('canceled');
  });

  it('returns 404 when no subscription exists', async () => {
    const store = createMockStore(null);
    setSubscriptionStore(store);

    const app = createTestApp({ userId: 'user-1', tenantId: 'tenant-1', userRole: 'owner' });
    const res = await app.request('/billing/cancel', { method: 'POST' });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// POST /webhook
// ---------------------------------------------------------------------------

describe('POST /billing/webhook', () => {
  let stripe: ReturnType<typeof createMockStripe>;

  beforeEach(() => {
    stripe = createMockStripe();
    setStripeClient(stripe as unknown as Stripe);
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const app = createTestApp();
    const res = await app.request('/billing/webhook', {
      method: 'POST',
      body: '{}',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('stripe-signature');
  });

  it('returns 400 when signature verification fails', async () => {
    (stripe.webhooks.constructEvent as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Invalid signature');
    });

    const app = createTestApp();
    const res = await app.request('/billing/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'bad_sig' },
      body: 'payload',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('WEBHOOK_ERROR');
    expect(body.error.message).toContain('Signature verification failed');
  });

  it('processes valid webhook event successfully', async () => {
    (stripe.webhooks.constructEvent as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'evt_test',
      type: 'charge.succeeded', // unhandled event type — should pass
      data: { object: {} },
    });

    const app = createTestApp();
    const res = await app.request('/billing/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'valid_sig' },
      body: 'payload',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(body.eventId).toBe('evt_test');
  });

  it('routes subscription.updated event to handler', async () => {
    const subStore = createMockWebhookSubStore(makeRow());
    const tenantStore = createMockTenantStore();
    setWebhookSubscriptionStore(subStore);
    setWebhookTenantStore(tenantStore);

    (stripe.webhooks.constructEvent as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'evt_sub_updated',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'active',
          current_period_start: 1738368000,
          current_period_end: 1740960000,
          cancel_at_period_end: false,
          items: { data: [{ price: { id: 'price_pro_monthly' } }] },
          metadata: { plan: 'pro' },
        },
      },
    });

    const app = createTestApp();
    const res = await app.request('/billing/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'valid_sig' },
      body: 'payload',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(subStore.findByStripeSubscriptionId).toHaveBeenCalledWith('sub_123');
  });

  it('returns 500 when webhook secret env var is missing', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const app = createTestApp();
    const res = await app.request('/billing/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'sig' },
      body: 'payload',
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toContain('STRIPE_WEBHOOK_SECRET');
  });
});

// ---------------------------------------------------------------------------
// Permission checks
// ---------------------------------------------------------------------------

describe('permission checks', () => {
  it('owner can subscribe', async () => {
    const stripe = createMockStripe();
    setStripeClient(stripe as unknown as Stripe);
    const store = createMockStore();
    setSubscriptionStore(store);

    (stripe.subscriptions.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_owner',
      status: 'incomplete',
      start_date: 1738368000,
      cancel_at_period_end: false,
      latest_invoice: null,
    });

    const app = createTestApp({ userId: 'user-1', tenantId: 'tenant-1', userRole: 'owner' });
    const res = await app.request('/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'enterprise' }),
    });

    expect(res.status).toBe(201);
  });

  it('admin can cancel', async () => {
    const stripe = createMockStripe();
    setStripeClient(stripe as unknown as Stripe);
    const store = createMockStore(makeRow());
    setSubscriptionStore(store);

    (stripe.subscriptions.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sub_123',
      cancel_at_period_end: true,
    });

    const app = createTestApp({ userId: 'user-1', tenantId: 'tenant-1', userRole: 'admin' });
    const res = await app.request('/billing/cancel', { method: 'POST' });

    expect(res.status).toBe(200);
  });

  it('member cannot subscribe', async () => {
    const app = createTestApp({ userId: 'user-1', tenantId: 'tenant-1', userRole: 'member' });
    const res = await app.request('/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro' }),
    });

    expect(res.status).toBe(403);
  });

  it('member cannot cancel', async () => {
    const app = createTestApp({ userId: 'user-1', tenantId: 'tenant-1', userRole: 'member' });
    const res = await app.request('/billing/cancel', { method: 'POST' });

    expect(res.status).toBe(403);
  });
});
