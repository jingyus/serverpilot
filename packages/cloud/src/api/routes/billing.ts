// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Billing API routes for subscription management.
 *
 * Endpoints:
 * - POST   /subscribe   — Create a new subscription (auth + tenant:manage)
 * - GET    /subscription — View current subscription status (auth)
 * - POST   /cancel       — Cancel subscription at period end (auth + tenant:manage)
 * - POST   /webhook      — Stripe webhook receiver (no auth, signature verification)
 * - GET    /plans        — List available billing plans (public)
 *
 * @module cloud/api/routes/billing
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  createSubscription,
  cancelSubscription,
  getSubscription,
} from '../../billing/stripe-integration.js';
import { handleStripeWebhook } from '../../billing/stripe-webhook.js';
import { PLANS } from '../../billing/index.js';
import type { PlanId } from '../../ai/types.js';

// ---------------------------------------------------------------------------
// Context type (mirrors server ApiEnv — only the fields we need)
// ---------------------------------------------------------------------------

export interface BillingApiEnv {
  Variables: {
    userId: string;
    tenantId: string | null;
    userRole: 'owner' | 'admin' | 'member';
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_PAID_PLANS = ['pro', 'team', 'enterprise'] as const;

function isValidPaidPlan(plan: unknown): plan is Exclude<PlanId, 'free'> {
  return typeof plan === 'string' && (VALID_PAID_PLANS as readonly string[]).includes(plan);
}

function canManageBilling(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

// ---------------------------------------------------------------------------
// Route module
// ---------------------------------------------------------------------------

export function createBillingRoutes() {
  const billing = new Hono<BillingApiEnv>();

  // -----------------------------------------------------------------------
  // GET /plans — public, no auth required
  // -----------------------------------------------------------------------
  billing.get('/plans', (c) => {
    return c.json({ plans: PLANS });
  });

  // -----------------------------------------------------------------------
  // POST /subscribe — create a new subscription
  // -----------------------------------------------------------------------
  billing.post('/subscribe', async (c) => {
    const userId = c.get('userId');
    const tenantId = c.get('tenantId');
    const userRole = c.get('userRole');

    if (!userId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
    }

    if (!tenantId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Tenant context required' } }, 401);
    }

    if (!canManageBilling(userRole)) {
      return c.json(
        { error: { code: 'FORBIDDEN', message: 'Only owner or admin can manage subscriptions' } },
        403,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
    }

    const { plan, stripeCustomerId } = body as Record<string, unknown>;

    if (!isValidPaidPlan(plan)) {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: `Invalid plan: must be one of ${VALID_PAID_PLANS.join(', ')}` } },
        400,
      );
    }

    try {
      const result = await createSubscription({
        tenantId,
        userId,
        plan,
        stripeCustomerId: typeof stripeCustomerId === 'string' ? stripeCustomerId : undefined,
      });

      return c.json({
        subscription: result.subscription,
        clientSecret: result.clientSecret,
        stripeSubscriptionId: result.stripeSubscriptionId,
      }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Subscription creation failed';
      return c.json({ error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  });

  // -----------------------------------------------------------------------
  // GET /subscription — view current subscription
  // -----------------------------------------------------------------------
  billing.get('/subscription', async (c) => {
    const userId = c.get('userId');
    const tenantId = c.get('tenantId');

    if (!userId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
    }

    if (!tenantId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Tenant context required' } }, 401);
    }

    try {
      const subscription = await getSubscription(tenantId);
      return c.json({ subscription });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch subscription';
      return c.json({ error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  });

  // -----------------------------------------------------------------------
  // POST /cancel — cancel subscription (at period end by default)
  // -----------------------------------------------------------------------
  billing.post('/cancel', async (c) => {
    const userId = c.get('userId');
    const tenantId = c.get('tenantId');
    const userRole = c.get('userRole');

    if (!userId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
    }

    if (!tenantId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Tenant context required' } }, 401);
    }

    if (!canManageBilling(userRole)) {
      return c.json(
        { error: { code: 'FORBIDDEN', message: 'Only owner or admin can manage subscriptions' } },
        403,
      );
    }

    let immediate = false;
    try {
      const body = await c.req.json();
      if (typeof body === 'object' && body !== null && 'immediate' in body) {
        immediate = Boolean(body.immediate);
      }
    } catch {
      // No body is fine — defaults to cancel at period end
    }

    try {
      const result = await cancelSubscription({ tenantId, immediate });
      return c.json({
        subscription: result.subscription,
        effectiveDate: result.effectiveDate.toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cancellation failed';
      if (message.includes('No subscription found')) {
        return c.json({ error: { code: 'NOT_FOUND', message } }, 404);
      }
      return c.json({ error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  });

  // -----------------------------------------------------------------------
  // POST /webhook — Stripe webhook (no auth, uses signature verification)
  // -----------------------------------------------------------------------
  billing.post('/webhook', async (c: Context) => {
    const signature = c.req.header('stripe-signature');
    if (!signature) {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'Missing stripe-signature header' } },
        400,
      );
    }

    let rawBody: string;
    try {
      rawBody = await c.req.text();
    } catch {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Failed to read request body' } }, 400);
    }

    try {
      const result = await handleStripeWebhook(rawBody, signature);

      if (!result.success) {
        return c.json(
          { error: { code: 'WEBHOOK_ERROR', message: result.error ?? 'Webhook processing failed' } },
          400,
        );
      }

      return c.json({ received: true, eventId: result.eventId });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Webhook processing failed';
      return c.json({ error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  });

  return billing;
}
