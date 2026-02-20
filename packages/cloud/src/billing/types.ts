// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Type definitions for Stripe billing integration.
 *
 * These types model the data flowing between our backend,
 * the Stripe API, and the database.
 *
 * @module cloud/billing/types
 */

import type { PlanId } from '../ai/types.js';
import type { SubscriptionStatus, HandledStripeEvent } from './constants.js';

// ---------------------------------------------------------------------------
// Database row types
// ---------------------------------------------------------------------------

/** A row from the `subscriptions` table. */
export interface SubscriptionRow {
  id: number;
  tenantId: string;
  userId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Stripe webhook payload
// ---------------------------------------------------------------------------

/** Minimal shape of a Stripe webhook event we process. */
export interface StripeWebhookEvent {
  /** Stripe event ID (e.g. `evt_1...`). */
  id: string;
  /** Event type — only handled types should reach our processing logic. */
  type: HandledStripeEvent;
  /** Timestamp of the event (Unix seconds). */
  created: number;
  /** The event data object (shape depends on `type`). */
  data: {
    object: StripeSubscriptionObject | StripeInvoiceObject;
  };
}

/** Minimal subset of a Stripe Subscription object. */
export interface StripeSubscriptionObject {
  id: string;
  customer: string;
  status: SubscriptionStatus;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: boolean;
  items: {
    data: Array<{
      price: { id: string };
    }>;
  };
  metadata?: Record<string, string>;
}

/** Minimal subset of a Stripe Invoice object. */
export interface StripeInvoiceObject {
  id: string;
  customer: string;
  subscription: string | null;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  amount_due: number;
  amount_paid: number;
  currency: string;
}

// ---------------------------------------------------------------------------
// Service layer types
// ---------------------------------------------------------------------------

/** Input for creating a new subscription. */
export interface CreateSubscriptionInput {
  tenantId: string;
  userId: string;
  plan: Exclude<PlanId, 'free'>;
  /** Optional existing Stripe customer ID to reuse. */
  stripeCustomerId?: string;
}

/** Result returned when a subscription is created or updated. */
export interface CreateSubscriptionResult {
  /** The subscription row persisted to the database. */
  subscription: SubscriptionRow;
  /** Stripe client secret for completing payment (if confirmation required). */
  clientSecret?: string;
  /** Stripe subscription ID. */
  stripeSubscriptionId: string;
}

/** Input for canceling a subscription. */
export interface CancelSubscriptionInput {
  tenantId: string;
  /** When true, cancel immediately; otherwise cancel at period end. */
  immediate?: boolean;
}

/** Result of a cancellation request. */
export interface CancelSubscriptionResult {
  /** Updated subscription row. */
  subscription: SubscriptionRow;
  /** The effective cancellation date. */
  effectiveDate: Date;
}

/** Input for changing the plan on an existing subscription. */
export interface ChangePlanInput {
  tenantId: string;
  newPlan: Exclude<PlanId, 'free'>;
}

/** Result of a plan change. */
export interface ChangePlanResult {
  /** Updated subscription row. */
  subscription: SubscriptionRow;
  /** Whether the change takes effect immediately or at period end. */
  immediate: boolean;
  /** Prorated amount (positive = charge, negative = credit). */
  proratedAmountCents?: number;
}

// ---------------------------------------------------------------------------
// Webhook handler types
// ---------------------------------------------------------------------------

/** Result of processing a single Stripe webhook event. */
export interface WebhookProcessResult {
  /** Whether processing succeeded. */
  success: boolean;
  /** Event ID that was processed. */
  eventId: string;
  /** Event type that was processed. */
  eventType: HandledStripeEvent;
  /** Error message if processing failed. */
  error?: string;
}
