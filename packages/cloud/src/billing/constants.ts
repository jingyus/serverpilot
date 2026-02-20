// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Stripe billing constants — Price ID mappings and plan limits.
 *
 * Price IDs are configurable via environment variables for
 * test-mode / live-mode switching.
 *
 * @module cloud/billing/constants
 */

import type { PlanId } from '../ai/types.js';

// ---------------------------------------------------------------------------
// Subscription status enum
// ---------------------------------------------------------------------------

/** Stripe subscription lifecycle statuses. */
export const SUBSCRIPTION_STATUSES = [
  'incomplete',
  'active',
  'past_due',
  'canceled',
  'unpaid',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Stripe Price ID mapping
// ---------------------------------------------------------------------------

/**
 * Maps each paid plan to its Stripe Price ID.
 *
 * Defaults use placeholder values — override via env vars:
 * - `STRIPE_PRICE_PRO`
 * - `STRIPE_PRICE_TEAM`
 * - `STRIPE_PRICE_ENTERPRISE`
 */
export const PLAN_PRICE_IDS: Record<Exclude<PlanId, 'free'>, string> = {
  pro: process.env.STRIPE_PRICE_PRO ?? 'price_pro_monthly',
  team: process.env.STRIPE_PRICE_TEAM ?? 'price_team_monthly',
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE ?? 'price_enterprise_monthly',
};

// ---------------------------------------------------------------------------
// Plan limits
// ---------------------------------------------------------------------------

/** Resource limits for a billing plan. */
export interface PlanLimits {
  /** Max managed servers (-1 = unlimited). */
  maxServers: number;
  /** Max team members (-1 = unlimited). */
  maxUsers: number;
  /** AI call limit per month (-1 = unlimited / fair-use). */
  maxAiCalls: number;
  /** Soft spending limit per month in USD (undefined = no soft limit). */
  softLimitUsd?: number;
}

/**
 * Per-plan resource limits.
 *
 * Values match the pricing table in the development guide:
 * | Plan       | Servers | Users | AI Calls | Soft Limit |
 * |------------|---------|-------|----------|------------|
 * | free       |       1 |     1 |      100 |          — |
 * | pro        |      10 |     5 |    2 000 |        $50 |
 * | team       |      -1 |    -1 |       -1 |       $200 |
 * | enterprise |      -1 |    -1 |       -1 |     $1 000 |
 */
export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    maxServers: 1,
    maxUsers: 1,
    maxAiCalls: 100,
  },
  pro: {
    maxServers: 10,
    maxUsers: 5,
    maxAiCalls: 2000,
    softLimitUsd: 50,
  },
  team: {
    maxServers: -1,
    maxUsers: -1,
    maxAiCalls: -1,
    softLimitUsd: 200,
  },
  enterprise: {
    maxServers: -1,
    maxUsers: -1,
    maxAiCalls: -1,
    softLimitUsd: 1000,
  },
};

// ---------------------------------------------------------------------------
// Stripe webhook event types we handle
// ---------------------------------------------------------------------------

/** Stripe webhook events relevant to subscription management. */
export const HANDLED_STRIPE_EVENTS = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
] as const;

export type HandledStripeEvent = (typeof HANDLED_STRIPE_EVENTS)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns `true` when `status` represents a usable subscription. */
export function isActiveStatus(status: SubscriptionStatus): boolean {
  return status === 'active';
}

/** Returns the Stripe Price ID for a given plan, or `undefined` for free. */
export function getPriceId(plan: PlanId): string | undefined {
  if (plan === 'free') return undefined;
  return PLAN_PRICE_IDS[plan];
}

/** Returns the plan limits for a given plan ID. */
export function getPlanLimits(plan: PlanId): PlanLimits {
  return PLAN_LIMITS[plan];
}
