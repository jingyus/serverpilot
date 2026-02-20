// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { checkAIQuota } from './check-ai-quota.js';
import type { QuotaApiEnv } from './check-ai-quota.js';
import {
  AIQuotaManager,
  setAIQuotaManager,
  _resetAIQuotaManager,
} from '../../ai/quota-manager.js';
import type { QuotaDataAccess, AIUsageRecord } from '../../ai/quota-manager.js';
import type { PlanId, QuotaCheckResult } from '../../ai/types.js';

// ---------------------------------------------------------------------------
// In-memory QuotaDataAccess for testing
// ---------------------------------------------------------------------------

class InMemoryQuotaDataAccess implements QuotaDataAccess {
  private tenantPlans = new Map<string, PlanId>();
  private callCounts = new Map<string, number>();
  private costs = new Map<string, number>();

  setTenantPlan(tenantId: string, plan: PlanId): void {
    this.tenantPlans.set(tenantId, plan);
  }

  setCallCount(userId: string, count: number): void {
    this.callCounts.set(userId, count);
  }

  setCost(userId: string, cost: number): void {
    this.costs.set(userId, cost);
  }

  async getTenantPlan(tenantId: string): Promise<PlanId | null> {
    return this.tenantPlans.get(tenantId) ?? null;
  }

  async getCallCount(userId: string, _since: Date): Promise<number> {
    return this.callCounts.get(userId) ?? 0;
  }

  async getTotalCost(userId: string, _since: Date): Promise<number> {
    return this.costs.get(userId) ?? 0;
  }

  async insertUsage(_record: Omit<AIUsageRecord, 'id' | 'createdAt'>): Promise<number> {
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------

/**
 * Build a minimal Hono app with optional auth context injection
 * followed by the checkAIQuota middleware and a dummy handler.
 */
function createTestApp(opts?: { userId?: string; tenantId?: string | null }) {
  const app = new Hono<QuotaApiEnv>();

  // Simulate auth middleware injection
  app.use('*', async (c, next) => {
    if (opts?.userId !== undefined) {
      c.set('userId', opts.userId);
    }
    if (opts?.tenantId !== undefined) {
      c.set('tenantId', opts.tenantId);
    }
    await next();
  });

  // Mount the quota middleware
  app.use('*', checkAIQuota());

  // Dummy handler
  app.get('/chat', (c) => c.json({ ok: true }));
  app.post('/chat', (c) => c.json({ ok: true }));

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkAIQuota middleware', () => {
  let dataAccess: InMemoryQuotaDataAccess;

  beforeEach(() => {
    dataAccess = new InMemoryQuotaDataAccess();
    setAIQuotaManager(new AIQuotaManager(dataAccess));
  });

  afterEach(() => {
    _resetAIQuotaManager();
  });

  // -------------------------------------------------------------------------
  // Unauthenticated / missing context
  // -------------------------------------------------------------------------

  describe('unauthenticated requests', () => {
    it('should return 401 when userId is not set', async () => {
      const app = createTestApp(); // no auth context
      const res = await app.request('/chat');

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toBe('Authentication required');
    });

    it('should return 401 when tenantId is null', async () => {
      const app = createTestApp({ userId: 'user-1', tenantId: null });
      const res = await app.request('/chat');

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toBe('Tenant context required');
    });
  });

  // -------------------------------------------------------------------------
  // Free plan — hard limit enforcement
  // -------------------------------------------------------------------------

  describe('free plan', () => {
    const userId = 'free-user';
    const tenantId = 'tenant-free';

    beforeEach(() => {
      dataAccess.setTenantPlan(tenantId, 'free');
    });

    it('should pass when quota is available', async () => {
      dataAccess.setCallCount(userId, 10); // well under 100 limit
      const app = createTestApp({ userId, tenantId });
      const res = await app.request('/chat');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('should set X-Quota-Remaining header when quota available', async () => {
      dataAccess.setCallCount(userId, 90); // 10 remaining
      const app = createTestApp({ userId, tenantId });
      const res = await app.request('/chat');

      expect(res.status).toBe(200);
      expect(res.headers.get('X-Quota-Remaining')).toBe('10');
    });

    it('should return 429 + QUOTA_EXCEEDED when free plan limit exhausted', async () => {
      dataAccess.setCallCount(userId, 100); // exactly at limit
      const app = createTestApp({ userId, tenantId });
      const res = await app.request('/chat');

      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error.code).toBe('QUOTA_EXCEEDED');
      expect(body.error.message).toContain('Free plan limit reached');
      expect(body.error.upgradeUrl).toBe('/billing?upgrade=pro');
    });

    it('should return 429 when free plan limit exceeded', async () => {
      dataAccess.setCallCount(userId, 150); // over the limit
      const app = createTestApp({ userId, tenantId });
      const res = await app.request('/chat');

      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error.code).toBe('QUOTA_EXCEEDED');
    });

    it('should set X-Quota-Remaining to 0 when exhausted', async () => {
      dataAccess.setCallCount(userId, 100);
      const app = createTestApp({ userId, tenantId });
      const res = await app.request('/chat');

      expect(res.status).toBe(429);
      expect(res.headers.get('X-Quota-Remaining')).toBe('0');
    });

    it('should work with POST requests', async () => {
      dataAccess.setCallCount(userId, 100);
      const app = createTestApp({ userId, tenantId });
      const res = await app.request('/chat', { method: 'POST' });

      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error.code).toBe('QUOTA_EXCEEDED');
    });
  });

  // -------------------------------------------------------------------------
  // Paid plans — never blocked (soft limits only)
  // -------------------------------------------------------------------------

  describe('pro plan', () => {
    const userId = 'pro-user';
    const tenantId = 'tenant-pro';

    beforeEach(() => {
      dataAccess.setTenantPlan(tenantId, 'pro');
    });

    it('should pass with quota remaining', async () => {
      dataAccess.setCallCount(userId, 50);
      const app = createTestApp({ userId, tenantId });
      const res = await app.request('/chat');

      expect(res.status).toBe(200);
    });

    it('should pass even when call count exceeds hard limit (pro has soft cost limit)', async () => {
      dataAccess.setCallCount(userId, 5000); // well over 2000 hard limit
      dataAccess.setCost(userId, 60); // over $50 soft limit
      const app = createTestApp({ userId, tenantId });
      const res = await app.request('/chat');

      // Pro is never blocked — soft limit warning only
      expect(res.status).toBe(200);
    });

    it('should set X-Quota-Remaining header', async () => {
      dataAccess.setCallCount(userId, 500);
      const app = createTestApp({ userId, tenantId });
      const res = await app.request('/chat');

      expect(res.status).toBe(200);
      const remaining = res.headers.get('X-Quota-Remaining');
      expect(remaining).toBeDefined();
      expect(Number(remaining)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('team plan', () => {
    const userId = 'team-user';
    const tenantId = 'tenant-team';

    beforeEach(() => {
      dataAccess.setTenantPlan(tenantId, 'team');
    });

    it('should always pass (unlimited calls, soft spend limit)', async () => {
      dataAccess.setCost(userId, 300); // over $200 soft limit
      const app = createTestApp({ userId, tenantId });
      const res = await app.request('/chat');

      expect(res.status).toBe(200);
    });
  });

  describe('enterprise plan', () => {
    const userId = 'enterprise-user';
    const tenantId = 'tenant-enterprise';

    beforeEach(() => {
      dataAccess.setTenantPlan(tenantId, 'enterprise');
    });

    it('should always pass (unlimited, soft spend limit)', async () => {
      dataAccess.setCost(userId, 1500); // over $1000 soft limit
      const app = createTestApp({ userId, tenantId });
      const res = await app.request('/chat');

      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should return 429 when tenant not found', async () => {
      // No tenant plan set — getTenantPlan returns null
      const app = createTestApp({ userId: 'user-1', tenantId: 'unknown-tenant' });
      const res = await app.request('/chat');

      // QuotaManager returns { allowed: false, remaining: 0, reason: 'Tenant not found' }
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error.code).toBe('QUOTA_EXCEEDED');
      expect(body.error.message).toBe('Tenant not found');
    });

    it('should handle quota check at boundary (99 of 100 calls used)', async () => {
      dataAccess.setTenantPlan('t1', 'free');
      dataAccess.setCallCount('u1', 99);
      const app = createTestApp({ userId: 'u1', tenantId: 't1' });
      const res = await app.request('/chat');

      expect(res.status).toBe(200);
      expect(res.headers.get('X-Quota-Remaining')).toBe('1');
    });

    it('should set X-Quota-Remaining on 429 responses too', async () => {
      dataAccess.setTenantPlan('t1', 'free');
      dataAccess.setCallCount('u1', 100);
      const app = createTestApp({ userId: 'u1', tenantId: 't1' });
      const res = await app.request('/chat');

      expect(res.status).toBe(429);
      // Header should be set even on rejection
      expect(res.headers.get('X-Quota-Remaining')).toBeDefined();
    });
  });
});
