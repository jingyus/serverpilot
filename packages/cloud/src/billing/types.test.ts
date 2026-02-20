// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect } from 'vitest';
import type {
  SubscriptionRow,
  StripeWebhookEvent,
  StripeSubscriptionObject,
  StripeInvoiceObject,
  CreateSubscriptionInput,
  CreateSubscriptionResult,
  CancelSubscriptionInput,
  CancelSubscriptionResult,
  ChangePlanInput,
  ChangePlanResult,
  WebhookProcessResult,
} from './types.js';

/**
 * Type-level tests: these tests verify that the type definitions
 * compile correctly and can be instantiated with valid data.
 * They catch structural regressions in the type contracts.
 */

describe('SubscriptionRow', () => {
  it('can be constructed with all required fields', () => {
    const row: SubscriptionRow = {
      id: 1,
      tenantId: 'tenant-1',
      userId: 'user-1',
      plan: 'pro',
      status: 'active',
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_123',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      cancelAtPeriodEnd: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(row.id).toBe(1);
    expect(row.plan).toBe('pro');
    expect(row.status).toBe('active');
  });

  it('allows null for optional Stripe fields', () => {
    const row: SubscriptionRow = {
      id: 2,
      tenantId: 'tenant-1',
      userId: 'user-1',
      plan: 'free',
      status: 'active',
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(row.stripeSubscriptionId).toBeNull();
    expect(row.stripeCustomerId).toBeNull();
    expect(row.currentPeriodStart).toBeNull();
    expect(row.currentPeriodEnd).toBeNull();
  });
});

describe('StripeWebhookEvent', () => {
  it('can represent a subscription.created event', () => {
    const subObj: StripeSubscriptionObject = {
      id: 'sub_abc',
      customer: 'cus_abc',
      status: 'active',
      current_period_start: 1700000000,
      current_period_end: 1702678400,
      cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_pro_monthly' } }] },
    };
    const event: StripeWebhookEvent = {
      id: 'evt_1',
      type: 'customer.subscription.created',
      created: 1700000000,
      data: { object: subObj },
    };
    expect(event.type).toBe('customer.subscription.created');
    expect(event.data.object).toBe(subObj);
  });

  it('can represent an invoice.payment_failed event', () => {
    const invoiceObj: StripeInvoiceObject = {
      id: 'in_abc',
      customer: 'cus_abc',
      subscription: 'sub_abc',
      status: 'open',
      amount_due: 1900,
      amount_paid: 0,
      currency: 'usd',
    };
    const event: StripeWebhookEvent = {
      id: 'evt_2',
      type: 'invoice.payment_failed',
      created: 1700000000,
      data: { object: invoiceObj },
    };
    expect(event.type).toBe('invoice.payment_failed');
  });
});

describe('StripeSubscriptionObject', () => {
  it('supports optional metadata', () => {
    const sub: StripeSubscriptionObject = {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      current_period_start: 1700000000,
      current_period_end: 1702678400,
      cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_1' } }] },
      metadata: { tenantId: 'tenant-1' },
    };
    expect(sub.metadata?.tenantId).toBe('tenant-1');
  });

  it('works without metadata', () => {
    const sub: StripeSubscriptionObject = {
      id: 'sub_2',
      customer: 'cus_2',
      status: 'incomplete',
      current_period_start: 1700000000,
      current_period_end: 1702678400,
      cancel_at_period_end: false,
      items: { data: [] },
    };
    expect(sub.metadata).toBeUndefined();
  });
});

describe('CreateSubscriptionInput', () => {
  it('requires a paid plan (not free)', () => {
    const input: CreateSubscriptionInput = {
      tenantId: 'tenant-1',
      userId: 'user-1',
      plan: 'pro',
    };
    expect(input.plan).toBe('pro');
  });

  it('accepts optional stripeCustomerId', () => {
    const input: CreateSubscriptionInput = {
      tenantId: 'tenant-1',
      userId: 'user-1',
      plan: 'team',
      stripeCustomerId: 'cus_existing',
    };
    expect(input.stripeCustomerId).toBe('cus_existing');
  });
});

describe('CreateSubscriptionResult', () => {
  it('includes subscription and stripeSubscriptionId', () => {
    const result: CreateSubscriptionResult = {
      subscription: {
        id: 1,
        tenantId: 'tenant-1',
        userId: 'user-1',
        plan: 'pro',
        status: 'active',
        stripeSubscriptionId: 'sub_123',
        stripeCustomerId: 'cus_123',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      stripeSubscriptionId: 'sub_123',
    };
    expect(result.stripeSubscriptionId).toBe('sub_123');
    expect(result.clientSecret).toBeUndefined();
  });

  it('can include clientSecret for incomplete subscriptions', () => {
    const result: CreateSubscriptionResult = {
      subscription: {
        id: 2,
        tenantId: 'tenant-1',
        userId: 'user-1',
        plan: 'pro',
        status: 'incomplete',
        stripeSubscriptionId: 'sub_456',
        stripeCustomerId: 'cus_456',
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      stripeSubscriptionId: 'sub_456',
      clientSecret: 'pi_secret_abc',
    };
    expect(result.clientSecret).toBe('pi_secret_abc');
  });
});

describe('CancelSubscriptionInput / CancelSubscriptionResult', () => {
  it('supports immediate cancellation', () => {
    const input: CancelSubscriptionInput = {
      tenantId: 'tenant-1',
      immediate: true,
    };
    expect(input.immediate).toBe(true);
  });

  it('defaults to end-of-period cancellation when immediate is omitted', () => {
    const input: CancelSubscriptionInput = {
      tenantId: 'tenant-1',
    };
    expect(input.immediate).toBeUndefined();
  });

  it('result includes effective cancellation date', () => {
    const result: CancelSubscriptionResult = {
      subscription: {
        id: 1,
        tenantId: 'tenant-1',
        userId: 'user-1',
        plan: 'pro',
        status: 'canceled',
        stripeSubscriptionId: 'sub_123',
        stripeCustomerId: 'cus_123',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      effectiveDate: new Date('2026-03-01'),
    };
    expect(result.effectiveDate).toBeInstanceOf(Date);
  });
});

describe('ChangePlanInput / ChangePlanResult', () => {
  it('specifies a new paid plan', () => {
    const input: ChangePlanInput = {
      tenantId: 'tenant-1',
      newPlan: 'enterprise',
    };
    expect(input.newPlan).toBe('enterprise');
  });

  it('result includes proration info', () => {
    const result: ChangePlanResult = {
      subscription: {
        id: 1,
        tenantId: 'tenant-1',
        userId: 'user-1',
        plan: 'enterprise',
        status: 'active',
        stripeSubscriptionId: 'sub_123',
        stripeCustomerId: 'cus_123',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      immediate: true,
      proratedAmountCents: 15000,
    };
    expect(result.immediate).toBe(true);
    expect(result.proratedAmountCents).toBe(15000);
  });
});

describe('WebhookProcessResult', () => {
  it('represents a successful processing', () => {
    const result: WebhookProcessResult = {
      success: true,
      eventId: 'evt_1',
      eventType: 'customer.subscription.created',
    };
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('represents a failed processing with error', () => {
    const result: WebhookProcessResult = {
      success: false,
      eventId: 'evt_2',
      eventType: 'invoice.payment_failed',
      error: 'Customer not found',
    };
    expect(result.success).toBe(false);
    expect(result.error).toBe('Customer not found');
  });
});
