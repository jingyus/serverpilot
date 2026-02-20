// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createUsageRoutes } from './usage.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let selectCallIndex = 0;
function makeThenable<T>(
  arr: T[],
): Promise<T[]> & { groupBy: () => Promise<T[]>; limit: (n?: number) => Promise<T[]> } {
  const p = Promise.resolve(arr) as Promise<T[]> & {
    groupBy: () => Promise<T[]>;
    limit: (n?: number) => Promise<T[]>;
  };
  p.groupBy = () => Promise.resolve(arr);
  p.limit = (n?: number) => Promise.resolve(n === 1 ? arr.slice(0, 1) : arr);
  return p;
}
const mockDb = {
  select: vi.fn(() => {
    const idx = selectCallIndex++;
    return {
      from: vi.fn(() => ({
        where: vi.fn(() => {
          if (idx === 0) return makeThenable([{ aiCalls: 10, aiCost: 1.5 }]);
          if (idx === 1) return makeThenable([{ count: 2 }]);
          if (idx === 2)
            return makeThenable([{ date: '2026-02-01', cost: 0.5 }]);
          if (idx === 3)
            return makeThenable([
              { model: 'claude-sonnet-4-5', callCount: 5, totalCost: 0.5 },
            ]);
          if (idx === 4) return makeThenable([{ plan: 'free' }]);
          if (idx === 5) return makeThenable([{ used: 42 }]);
          if (idx === 6) return makeThenable([{ usedCost: 0.5 }]);
          return makeThenable([]);
        }),
      })),
    };
  }),
};

const mockQuotaCheck = vi.fn().mockResolvedValue({ remaining: 50 });
const mockGetStats = vi.fn().mockResolvedValue([]);

vi.mock('../../db/pg-connection.js', () => ({
  getPgDatabase: vi.fn(() => mockDb),
}));

vi.mock('../../ai/quota-manager.js', () => ({
  getAIQuotaManager: vi.fn(() => ({ checkQuota: mockQuotaCheck })),
}));

vi.mock('../../skills/skill-execution-repository.js', () => ({
  getSkillExecutionRepository: vi.fn(() => ({ getStats: mockGetStats })),
}));

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------

type Env = { Variables: { userId?: string; tenantId?: string | null } };

function createApp() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    const uid = c.req.header('X-Test-User-Id');
    const tid = c.req.header('X-Test-Tenant-Id');
    if (uid) c.set('userId', uid);
    if (tid !== undefined) c.set('tenantId', tid || null);
    return next();
  });
  app.route('/', createUsageRoutes());
  return app;
}

describe('Usage API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallIndex = 0;
    mockQuotaCheck.mockResolvedValue({ remaining: 50 });
    mockGetStats.mockResolvedValue([]);
  });

  it('GET /summary 需要认证', async () => {
    const app = createApp();
    const res = await app.request('/summary');
    expect(res.status).toBe(401);
  });

  it('GET /summary 有 auth 时返回月度摘要', async () => {
    const app = createApp();
    const res = await app.request('/summary', {
      headers: { 'X-Test-User-Id': 'u1', 'X-Test-Tenant-Id': 't1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('aiCalls');
    expect(body).toHaveProperty('aiCost');
    expect(body).toHaveProperty('quotaRemaining');
    expect(body).toHaveProperty('skillExecutions');
    expect(body).toHaveProperty('serverCount');
  });

  it('GET /history 需要 tenant', async () => {
    const app = createApp();
    const res = await app.request('/history');
    expect(res.status).toBe(401);
  });

  it('GET /history 有 tenant 时返回 dailyCosts 和 modelDistribution', async () => {
    const app = createApp();
    const res = await app.request('/history?days=30', {
      headers: { 'X-Test-Tenant-Id': 't1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('dailyCosts');
    expect(body).toHaveProperty('modelDistribution');
    expect(body).toHaveProperty('topSkills');
  });

  it('GET /quota 需要认证', async () => {
    const app = createApp();
    const res = await app.request('/quota');
    expect(res.status).toBe(401);
  });

  it('GET /quota 有 auth 时返回 plan, used, limit, resetDate', async () => {
    const app = createApp();
    const res = await app.request('/quota', {
      headers: { 'X-Test-User-Id': 'u1', 'X-Test-Tenant-Id': 't1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('plan');
    expect(body).toHaveProperty('used');
    expect(body).toHaveProperty('limit');
    expect(body).toHaveProperty('resetDate');
    expect(body).toHaveProperty('type');
  });

  it('GET /summary 空数据返回零值', async () => {
    mockDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }));
    mockQuotaCheck.mockResolvedValue({ remaining: 100 });
    const app = createApp();
    const res = await app.request('/summary', {
      headers: { 'X-Test-User-Id': 'u1', 'X-Test-Tenant-Id': 't1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aiCalls).toBeDefined();
    expect(body.serverCount).toBeDefined();
  });
});
