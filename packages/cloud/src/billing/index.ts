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
  aiCallsPerMonth: number;
  monthlyPrice: number;
  features: string[];
}

export const PLANS: BillingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    maxServers: 1,
    maxUsers: 1,
    aiCallsPerMonth: 100,
    monthlyPrice: 0,
    features: ['Basic monitoring', 'AI chat', 'Community support'],
  },
  {
    id: 'pro',
    name: 'Pro',
    maxServers: 10,
    maxUsers: 5,
    aiCallsPerMonth: 2000,
    monthlyPrice: 19,
    features: ['Advanced monitoring', 'Priority AI', 'Team collaboration', 'Webhooks', 'Email support'],
  },
  {
    id: 'team',
    name: 'Team',
    maxServers: -1, // unlimited
    maxUsers: -1,
    aiCallsPerMonth: -1, // unlimited
    monthlyPrice: 49,
    features: ['Unlimited servers in team', 'Team management', 'Advanced API', 'Compliance reporting', 'Priority support'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    maxServers: -1, // unlimited
    maxUsers: -1,
    aiCallsPerMonth: -1, // unlimited
    monthlyPrice: 199,
    features: ['Unlimited servers', 'SSO/SAML', 'Audit logs', 'Custom integrations', 'Dedicated support'],
  },
];

// TODO: Implement Stripe integration
// export async function createCheckoutSession(tenantId: string, planId: string): Promise<string> {}
// export async function handleStripeWebhook(payload: unknown, signature: string): Promise<void> {}
// export async function getCurrentSubscription(tenantId: string): Promise<Subscription | null> {}
