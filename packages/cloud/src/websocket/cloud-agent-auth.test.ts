// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach } from 'vitest';
import {
  authenticateCloudAgent,
  type CloudAgentAuthStore,
  type CloudAgent,
  type CloudServer,
  type CloudTenant,
  type CloudSubscription,
} from './cloud-agent-auth.js';

// ---------------------------------------------------------------------------
// In-memory test store
// ---------------------------------------------------------------------------

function createMockStore(overrides: Partial<CloudAgentAuthStore> = {}): CloudAgentAuthStore {
  return {
    findAgentByServerId: async () => null,
    findServerById: async () => null,
    findTenantById: async () => null,
    findSubscriptionByTenantId: async () => null,
    countServersByTenantId: async () => 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const AGENT: CloudAgent = {
  id: 'agent-1',
  serverId: 'srv-1',
  keyHash: 'valid-token-abc123',
};

const SERVER: CloudServer = {
  id: 'srv-1',
  name: 'Test Server',
  userId: 'user-1',
  tenantId: 'tenant-1',
  status: 'online',
};

const TENANT: CloudTenant = {
  id: 'tenant-1',
  name: 'Acme Corp',
  plan: 'pro',
  maxServers: 10,
  maxUsers: 5,
};

const SUBSCRIPTION_ACTIVE: CloudSubscription = {
  id: 1,
  tenantId: 'tenant-1',
  plan: 'pro',
  status: 'active',
};

function buildHappyStore(): CloudAgentAuthStore {
  return createMockStore({
    findAgentByServerId: async (sid) => (sid === AGENT.serverId ? AGENT : null),
    findServerById: async (sid) => (sid === SERVER.id ? SERVER : null),
    findTenantById: async (tid) => (tid === TENANT.id ? TENANT : null),
    findSubscriptionByTenantId: async (tid) =>
      tid === SUBSCRIPTION_ACTIVE.tenantId ? SUBSCRIPTION_ACTIVE : null,
    countServersByTenantId: async () => 3,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authenticateCloudAgent', () => {
  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------
  describe('successful authentication', () => {
    it('returns success with full context for valid token + active subscription', async () => {
      const store = buildHappyStore();
      const result = await authenticateCloudAgent('srv-1', 'valid-token-abc123', store);

      expect(result.success).toBe(true);
      if (!result.success) return; // type narrowing

      expect(result.server).toEqual(SERVER);
      expect(result.tenant).toEqual(TENANT);
      expect(result.userId).toBe('user-1');
      expect(result.subscription).toEqual(SUBSCRIPTION_ACTIVE);
      expect(result.permissions).toEqual({
        plan: 'pro',
        maxServers: 10,
      });
    });

    it('returns success when server count is exactly at limit', async () => {
      const store = buildHappyStore();
      store.countServersByTenantId = async () => 10; // exactly at pro limit

      const result = await authenticateCloudAgent('srv-1', 'valid-token-abc123', store);
      expect(result.success).toBe(true);
    });

    it('returns success for unlimited plan (team) regardless of server count', async () => {
      const teamSubscription: CloudSubscription = {
        ...SUBSCRIPTION_ACTIVE,
        plan: 'team',
      };
      const teamTenant: CloudTenant = {
        ...TENANT,
        plan: 'team',
        maxServers: -1,
      };
      const store = createMockStore({
        findAgentByServerId: async () => AGENT,
        findServerById: async () => SERVER,
        findTenantById: async () => teamTenant,
        findSubscriptionByTenantId: async () => teamSubscription,
        countServersByTenantId: async () => 999,
      });

      const result = await authenticateCloudAgent('srv-1', 'valid-token-abc123', store);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.permissions.plan).toBe('team');
        expect(result.permissions.maxServers).toBe(-1);
      }
    });

    it('returns success for enterprise plan with unlimited servers', async () => {
      const entSubscription: CloudSubscription = {
        ...SUBSCRIPTION_ACTIVE,
        plan: 'enterprise',
      };
      const entTenant: CloudTenant = {
        ...TENANT,
        plan: 'enterprise',
        maxServers: -1,
      };
      const store = createMockStore({
        findAgentByServerId: async () => AGENT,
        findServerById: async () => SERVER,
        findTenantById: async () => entTenant,
        findSubscriptionByTenantId: async () => entSubscription,
        countServersByTenantId: async () => 500,
      });

      const result = await authenticateCloudAgent('srv-1', 'valid-token-abc123', store);
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Token validation
  // -----------------------------------------------------------------------
  describe('token validation', () => {
    it('rejects when agent record not found', async () => {
      const store = createMockStore(); // all return null

      const result = await authenticateCloudAgent('srv-1', 'any-token', store);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe('invalid_token');
      expect(result.message).toBe('Invalid agent token');
    });

    it('rejects when token does not match keyHash', async () => {
      const store = createMockStore({
        findAgentByServerId: async () => AGENT, // keyHash = 'valid-token-abc123'
      });

      const result = await authenticateCloudAgent('srv-1', 'wrong-token', store);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe('invalid_token');
    });
  });

  // -----------------------------------------------------------------------
  // Server validation
  // -----------------------------------------------------------------------
  describe('server validation', () => {
    it('rejects when server not found', async () => {
      const store = createMockStore({
        findAgentByServerId: async () => AGENT,
        findServerById: async () => null,
      });

      const result = await authenticateCloudAgent('srv-1', 'valid-token-abc123', store);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe('server_not_found');
      expect(result.message).toContain('srv-1');
    });

    it('rejects when server has no tenantId', async () => {
      const serverNoTenant: CloudServer = { ...SERVER, tenantId: null };
      const store = createMockStore({
        findAgentByServerId: async () => AGENT,
        findServerById: async () => serverNoTenant,
      });

      const result = await authenticateCloudAgent('srv-1', 'valid-token-abc123', store);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe('tenant_missing');
      expect(result.message).toContain('not assigned to a tenant');
    });
  });

  // -----------------------------------------------------------------------
  // Tenant validation
  // -----------------------------------------------------------------------
  describe('tenant validation', () => {
    it('rejects when tenant not found in database', async () => {
      const store = createMockStore({
        findAgentByServerId: async () => AGENT,
        findServerById: async () => SERVER,
        findTenantById: async () => null,
      });

      const result = await authenticateCloudAgent('srv-1', 'valid-token-abc123', store);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe('tenant_not_found');
      expect(result.message).toContain('tenant-1');
    });
  });

  // -----------------------------------------------------------------------
  // Subscription validation
  // -----------------------------------------------------------------------
  describe('subscription validation', () => {
    it('rejects when no subscription exists for tenant', async () => {
      const store = createMockStore({
        findAgentByServerId: async () => AGENT,
        findServerById: async () => SERVER,
        findTenantById: async () => TENANT,
        findSubscriptionByTenantId: async () => null,
      });

      const result = await authenticateCloudAgent('srv-1', 'valid-token-abc123', store);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe('subscription_not_found');
    });

    it('rejects past_due subscription with billing update message', async () => {
      const pastDueSub: CloudSubscription = {
        ...SUBSCRIPTION_ACTIVE,
        status: 'past_due',
      };
      const store = createMockStore({
        findAgentByServerId: async () => AGENT,
        findServerById: async () => SERVER,
        findTenantById: async () => TENANT,
        findSubscriptionByTenantId: async () => pastDueSub,
      });

      const result = await authenticateCloudAgent('srv-1', 'valid-token-abc123', store);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe('subscription_inactive');
      expect(result.message).toContain('past due');
      expect(result.message).toContain('billing');
    });

    it('rejects canceled subscription', async () => {
      const canceledSub: CloudSubscription = {
        ...SUBSCRIPTION_ACTIVE,
        status: 'canceled',
      };
      const store = createMockStore({
        findAgentByServerId: async () => AGENT,
        findServerById: async () => SERVER,
        findTenantById: async () => TENANT,
        findSubscriptionByTenantId: async () => canceledSub,
      });

      const result = await authenticateCloudAgent('srv-1', 'valid-token-abc123', store);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe('subscription_inactive');
      expect(result.message).toContain('canceled');
    });

    it('rejects incomplete subscription', async () => {
      const incompleteSub: CloudSubscription = {
        ...SUBSCRIPTION_ACTIVE,
        status: 'incomplete',
      };
      const store = createMockStore({
        findAgentByServerId: async () => AGENT,
        findServerById: async () => SERVER,
        findTenantById: async () => TENANT,
        findSubscriptionByTenantId: async () => incompleteSub,
      });

      const result = await authenticateCloudAgent('srv-1', 'valid-token-abc123', store);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe('subscription_inactive');
    });

    it('rejects unpaid subscription', async () => {
      const unpaidSub: CloudSubscription = {
        ...SUBSCRIPTION_ACTIVE,
        status: 'unpaid',
      };
      const store = createMockStore({
        findAgentByServerId: async () => AGENT,
        findServerById: async () => SERVER,
        findTenantById: async () => TENANT,
        findSubscriptionByTenantId: async () => unpaidSub,
      });

      const result = await authenticateCloudAgent('srv-1', 'valid-token-abc123', store);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe('subscription_inactive');
    });
  });

  // -----------------------------------------------------------------------
  // Server limit enforcement
  // -----------------------------------------------------------------------
  describe('server limit enforcement', () => {
    it('rejects when server count exceeds plan limit', async () => {
      const store = buildHappyStore();
      store.countServersByTenantId = async () => 11; // pro limit is 10

      const result = await authenticateCloudAgent('srv-1', 'valid-token-abc123', store);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe('server_limit_exceeded');
      expect(result.message).toContain('11/10');
      expect(result.message).toContain('upgrade');
    });

    it('rejects free plan when server count exceeds 1', async () => {
      const freeSub: CloudSubscription = {
        ...SUBSCRIPTION_ACTIVE,
        plan: 'free',
      };
      const freeTenant: CloudTenant = {
        ...TENANT,
        plan: 'free',
        maxServers: 1,
      };
      const store = createMockStore({
        findAgentByServerId: async () => AGENT,
        findServerById: async () => SERVER,
        findTenantById: async () => freeTenant,
        findSubscriptionByTenantId: async () => freeSub,
        countServersByTenantId: async () => 2,
      });

      const result = await authenticateCloudAgent('srv-1', 'valid-token-abc123', store);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe('server_limit_exceeded');
      expect(result.message).toContain('2/1');
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('uses subscription plan (not tenant plan) for limit checks', async () => {
      // Tenant plan says 'free' but subscription says 'pro' (e.g. upgrade in progress)
      const mismatchTenant: CloudTenant = {
        ...TENANT,
        plan: 'free',
        maxServers: 1,
      };
      const store = createMockStore({
        findAgentByServerId: async () => AGENT,
        findServerById: async () => SERVER,
        findTenantById: async () => mismatchTenant,
        findSubscriptionByTenantId: async () => SUBSCRIPTION_ACTIVE, // plan: 'pro'
        countServersByTenantId: async () => 5, // over free limit but under pro limit
      });

      const result = await authenticateCloudAgent('srv-1', 'valid-token-abc123', store);

      // Should use subscription.plan (pro, limit=10) not tenant.plan (free, limit=1)
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.permissions.plan).toBe('pro');
        expect(result.permissions.maxServers).toBe(10);
      }
    });

    it('propagates store errors as unhandled exceptions', async () => {
      const store = createMockStore({
        findAgentByServerId: async () => {
          throw new Error('DB connection lost');
        },
      });

      await expect(
        authenticateCloudAgent('srv-1', 'valid-token-abc123', store),
      ).rejects.toThrow('DB connection lost');
    });
  });
});
