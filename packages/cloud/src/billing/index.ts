// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * ServerPilot Cloud — Billing Module (placeholder)
 *
 * Future implementation:
 * - Stripe subscription management (free / pro / enterprise plans)
 * - Usage-based metering (servers, API calls, AI tokens)
 * - Invoice generation and payment history
 * - Plan limits enforcement and upgrade prompts
 * - Webhook handlers for Stripe events (payment success/failure)
 *
 * @module cloud/billing
 */

export interface BillingPlan {
  id: string;
  name: string;
  maxServers: number;
  maxUsers: number;
  monthlyPrice: number;
  features: string[];
}

export const PLANS: BillingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    maxServers: 3,
    maxUsers: 1,
    monthlyPrice: 0,
    features: ['Basic monitoring', 'AI chat', 'Community support'],
  },
  {
    id: 'pro',
    name: 'Pro',
    maxServers: 25,
    maxUsers: 10,
    monthlyPrice: 29,
    features: ['Advanced monitoring', 'Priority AI', 'Team collaboration', 'Webhooks', 'Email support'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    maxServers: -1, // unlimited
    maxUsers: -1,
    monthlyPrice: 99,
    features: ['Unlimited servers', 'SSO/SAML', 'Audit logs', 'Custom integrations', 'Dedicated support'],
  },
];

// TODO: Implement Stripe integration
// export async function createCheckoutSession(tenantId: string, planId: string): Promise<string> {}
// export async function handleStripeWebhook(payload: unknown, signature: string): Promise<void> {}
// export async function getCurrentSubscription(tenantId: string): Promise<Subscription | null> {}
