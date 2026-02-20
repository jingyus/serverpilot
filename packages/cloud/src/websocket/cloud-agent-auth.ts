// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Cloud Agent Authentication
 *
 * Extends the base agent authentication with cloud-specific checks:
 * 1. Token verification (agent keyHash match)
 * 2. Tenant isolation (server must belong to a valid tenant)
 * 3. Subscription status validation (past_due / canceled → reject)
 * 4. Server count enforcement (must not exceed plan maxServers)
 *
 * @module cloud/websocket/cloud-agent-auth
 */

import type { PlanId } from '../ai/types.js';
import type { SubscriptionStatus } from '../billing/constants.js';
import { getPlanLimits, isActiveStatus } from '../billing/constants.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A minimal server row needed for auth. */
export interface CloudServer {
  id: string;
  name: string;
  userId: string;
  tenantId: string | null;
  status: string;
}

/** A minimal agent row needed for auth. */
export interface CloudAgent {
  id: string;
  serverId: string;
  keyHash: string;
}

/** A minimal tenant row needed for auth. */
export interface CloudTenant {
  id: string;
  name: string;
  plan: PlanId;
  maxServers: number;
  maxUsers: number;
}

/** A minimal subscription row needed for auth. */
export interface CloudSubscription {
  id: number;
  tenantId: string;
  plan: PlanId;
  status: SubscriptionStatus;
}

/** Data store interface for cloud agent auth lookups. */
export interface CloudAgentAuthStore {
  /** Find an agent record by serverId. */
  findAgentByServerId(serverId: string): Promise<CloudAgent | null>;
  /** Find a server record by id. */
  findServerById(serverId: string): Promise<CloudServer | null>;
  /** Find a tenant record by id. */
  findTenantById(tenantId: string): Promise<CloudTenant | null>;
  /** Find the active subscription for a tenant. */
  findSubscriptionByTenantId(tenantId: string): Promise<CloudSubscription | null>;
  /** Count servers that belong to a tenant (online or offline). */
  countServersByTenantId(tenantId: string): Promise<number>;
}

/** Successful authentication result. */
export interface CloudAuthResult {
  server: CloudServer;
  tenant: CloudTenant;
  userId: string;
  subscription: CloudSubscription;
  permissions: {
    plan: PlanId;
    maxServers: number;
  };
}

/** Rejection reasons for agent auth. */
export type CloudAuthDenyReason =
  | 'invalid_token'
  | 'server_not_found'
  | 'tenant_missing'
  | 'tenant_not_found'
  | 'subscription_not_found'
  | 'subscription_inactive'
  | 'server_limit_exceeded';

/** Rejection result with structured error info. */
export interface CloudAuthDenied {
  success: false;
  reason: CloudAuthDenyReason;
  message: string;
}

/** Union discriminated by `success`. */
export type CloudAuthOutcome =
  | ({ success: true } & CloudAuthResult)
  | CloudAuthDenied;

// ---------------------------------------------------------------------------
// Core authentication function
// ---------------------------------------------------------------------------

/**
 * Authenticate a cloud agent connection.
 *
 * Performs a cascading series of checks:
 * 1. Verify agentToken against the stored keyHash
 * 2. Look up the server and ensure it belongs to a tenant
 * 3. Load the tenant and verify it exists
 * 4. Load the subscription and verify it is active
 * 5. Enforce the plan's maxServers limit
 *
 * @param serverId   - The server ID the agent claims to represent
 * @param agentToken - The agent's authentication token
 * @param store      - Data access layer (injected for testability)
 * @returns A discriminated union: success with full context, or denial with reason
 */
export async function authenticateCloudAgent(
  serverId: string,
  agentToken: string,
  store: CloudAgentAuthStore,
): Promise<CloudAuthOutcome> {
  // Step 1: Verify agent token
  const agent = await store.findAgentByServerId(serverId);
  if (!agent || agent.keyHash !== agentToken) {
    return {
      success: false,
      reason: 'invalid_token',
      message: 'Invalid agent token',
    };
  }

  // Step 2: Find the server and check tenantId
  const server = await store.findServerById(serverId);
  if (!server) {
    return {
      success: false,
      reason: 'server_not_found',
      message: `Server '${serverId}' not found`,
    };
  }

  if (!server.tenantId) {
    return {
      success: false,
      reason: 'tenant_missing',
      message: 'Server is not assigned to a tenant',
    };
  }

  // Step 3: Load tenant
  const tenant = await store.findTenantById(server.tenantId);
  if (!tenant) {
    return {
      success: false,
      reason: 'tenant_not_found',
      message: `Tenant '${server.tenantId}' not found`,
    };
  }

  // Step 4: Check subscription status
  const subscription = await store.findSubscriptionByTenantId(tenant.id);
  if (!subscription) {
    return {
      success: false,
      reason: 'subscription_not_found',
      message: 'No subscription found for this tenant',
    };
  }

  if (!isActiveStatus(subscription.status)) {
    const statusMsg =
      subscription.status === 'past_due'
        ? 'Subscription is past due — please update your billing information'
        : subscription.status === 'canceled'
          ? 'Subscription has been canceled'
          : `Subscription status is '${subscription.status}'`;

    return {
      success: false,
      reason: 'subscription_inactive',
      message: statusMsg,
    };
  }

  // Step 5: Enforce server count limit
  const planLimits = getPlanLimits(subscription.plan);
  if (planLimits.maxServers !== -1) {
    const currentCount = await store.countServersByTenantId(tenant.id);
    // The current server is already counted, so we only block if
    // the count exceeds the limit (which means a new server was added
    // beyond the limit, or the plan was downgraded).
    if (currentCount > planLimits.maxServers) {
      return {
        success: false,
        reason: 'server_limit_exceeded',
        message: `Server limit exceeded: ${currentCount}/${planLimits.maxServers} servers. Please upgrade your plan.`,
      };
    }
  }

  // All checks passed
  return {
    success: true,
    server,
    tenant,
    userId: server.userId,
    subscription,
    permissions: {
      plan: subscription.plan,
      maxServers: planLimits.maxServers,
    },
  };
}
