// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SkillExecutionRepository,
  getSkillExecutionRepository,
  _resetSkillExecutionRepository,
} from './skill-execution-repository.js';

// Capture eq() right-hand side so mock can filter (same pattern as cloud-register.test)
let lastEqValues: unknown[] = [];
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('drizzle-orm');
  return {
    ...actual,
    eq: (left: unknown, right: unknown) => {
      lastEqValues.push(right);
      return actual.eq(left, right);
    },
  };
});

// ---------------------------------------------------------------------------
// In-memory store and mock
// ---------------------------------------------------------------------------

type StoredRow = {
  id: number;
  userId: string;
  tenantId: string;
  serverId: string;
  skillName: string;
  status: 'success' | 'failed';
  report: Record<string, unknown> | null;
  duration: number | null;
  createdAt: Date;
};

const store: StoredRow[] = [];
let nextId = 1;

const mockDb = {
  insert: () => ({
    values: (row: Record<string, unknown>) => ({
      returning: () => {
        const rec: StoredRow = {
          id: nextId++,
          userId: row.userId as string,
          tenantId: row.tenantId as string,
          serverId: row.serverId as string,
          skillName: row.skillName as string,
          status: row.status as 'success' | 'failed',
          report: (row.report as Record<string, unknown>) ?? null,
          duration: (row.duration as number) ?? null,
          createdAt: new Date(),
        };
        store.push(rec);
        return Promise.resolve([rec]);
      },
    }),
  }),
  select: () => ({
    from: () => ({
      where: (_cond: unknown) => {
        const values = [...lastEqValues];
        lastEqValues = []; // clear so next repo call gets fresh values
        const strings = values.filter((v): v is string => typeof v === 'string');
        const tid = strings[0];
        const skillName = strings[1]; // second string is skillName when present (findByTenant)
        let filtered = tid ? store.filter((r) => r.tenantId === tid) : store;
        if (skillName && skillName !== tid) filtered = filtered.filter((r) => r.skillName === skillName);
        return {
          orderBy: () => ({
            limit: (n: number) => ({
              offset: (o: number) =>
                Promise.resolve(
                  [...filtered]
                    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                    .slice(o, o + n),
                ),
            }),
          }),
          groupBy: () => {
            const bySkill = new Map<
              string,
              { count: number; successCount: number; failedCount: number }
            >();
            for (const r of filtered) {
              const cur = bySkill.get(r.skillName) ?? {
                count: 0,
                successCount: 0,
                failedCount: 0,
              };
              cur.count++;
              if (r.status === 'success') cur.successCount++;
              else cur.failedCount++;
              bySkill.set(r.skillName, cur);
            }
            return Promise.resolve(
              [...bySkill.entries()].map(([skillName, v]) => ({
                skillName,
                count: v.count,
                successCount: v.successCount,
                failedCount: v.failedCount,
              })),
            );
          },
        };
      },
    }),
  }),
};

vi.mock('../db/pg-connection.js', () => ({
  getPgDatabase: vi.fn(() => mockDb),
}));

beforeEach(() => {
  _resetSkillExecutionRepository();
  lastEqValues = [];
  store.length = 0;
  nextId = 1;
});

describe('SkillExecutionRepository', () => {
  it('create 插入并返回记录', async () => {
    const repo = getSkillExecutionRepository();
    const created = await repo.create({
      userId: 'u1',
      tenantId: 't1',
      serverId: 's1',
      skillName: 'log-scanner',
      status: 'success',
      report: { healthScore: 90 },
      duration: 1000,
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.skillName).toBe('log-scanner');
    expect(created.status).toBe('success');
    expect(created.report).toEqual({ healthScore: 90 });
    expect(created.duration).toBe(1000);
    expect(store).toHaveLength(1);
  });

  it('findByTenant 按 tenant 隔离', async () => {
    store.push(
      {
        id: 1,
        userId: 'u1',
        tenantId: 't1',
        serverId: 's1',
        skillName: 'log-scanner',
        status: 'success',
        report: null,
        duration: 100,
        createdAt: new Date(),
      },
      {
        id: 2,
        userId: 'u2',
        tenantId: 't2',
        serverId: 's2',
        skillName: 'security-audit',
        status: 'failed',
        report: null,
        duration: null,
        createdAt: new Date(),
      },
    );
    const repo = getSkillExecutionRepository();
    const list = await repo.findByTenant('t1');
    expect(list.length).toBe(1);
    expect(list[0]!.tenantId).toBe('t1');
    expect(list[0]!.skillName).toBe('log-scanner');
  });

  it('findByTenant 支持 skillName 筛选', async () => {
    store.push(
      {
        id: 1,
        userId: 'u1',
        tenantId: 't1',
        serverId: 's1',
        skillName: 'log-scanner',
        status: 'success',
        report: null,
        duration: null,
        createdAt: new Date(),
      },
      {
        id: 2,
        userId: 'u1',
        tenantId: 't1',
        serverId: 's1',
        skillName: 'security-audit',
        status: 'success',
        report: null,
        duration: null,
        createdAt: new Date(),
      },
    );
    const repo = getSkillExecutionRepository();
    const list = await repo.findByTenant('t1', { skillName: 'log-scanner' });
    expect(list.length).toBe(1);
    expect(list[0]!.skillName).toBe('log-scanner');
  });

  it('getStats 按 skill 聚合', async () => {
    store.push(
      {
        id: 1,
        userId: 'u1',
        tenantId: 't1',
        serverId: 's1',
        skillName: 'log-scanner',
        status: 'success',
        report: null,
        duration: null,
        createdAt: new Date(),
      },
      {
        id: 2,
        userId: 'u1',
        tenantId: 't1',
        serverId: 's1',
        skillName: 'log-scanner',
        status: 'failed',
        report: null,
        duration: null,
        createdAt: new Date(),
      },
      {
        id: 3,
        userId: 'u1',
        tenantId: 't1',
        serverId: 's1',
        skillName: 'security-audit',
        status: 'success',
        report: null,
        duration: null,
        createdAt: new Date(),
      },
    );
    const repo = getSkillExecutionRepository();
    const stats = await repo.getStats('t1');
    expect(stats.length).toBe(2);
    const logScanner = stats.find((s) => s.skillName === 'log-scanner');
    expect(logScanner?.count).toBe(2);
    expect(logScanner?.successCount).toBe(1);
    expect(logScanner?.failedCount).toBe(1);
    const sec = stats.find((s) => s.skillName === 'security-audit');
    expect(sec?.count).toBe(1);
    expect(sec?.successCount).toBe(1);
  });

  it('getStats 空数据返回空数组', async () => {
    const repo = getSkillExecutionRepository();
    const stats = await repo.getStats('t-none');
    expect(stats).toEqual([]);
  });

  it('findByTenant 空数据返回空数组', async () => {
    const repo = getSkillExecutionRepository();
    const list = await repo.findByTenant('t-none');
    expect(list).toEqual([]);
  });

  it('create 无 report 和 duration 可省略', async () => {
    const repo = getSkillExecutionRepository();
    const created = await repo.create({
      userId: 'u1',
      tenantId: 't1',
      serverId: 's1',
      skillName: 'log-scanner',
      status: 'success',
    });
    expect(created.report).toBeNull();
    expect(created.duration).toBeNull();
  });

  it('getStats 不同 tenant 数据隔离', async () => {
    store.push(
      {
        id: 1,
        userId: 'u1',
        tenantId: 't1',
        serverId: 's1',
        skillName: 'log-scanner',
        status: 'success',
        report: null,
        duration: null,
        createdAt: new Date(),
      },
      {
        id: 2,
        userId: 'u2',
        tenantId: 't2',
        serverId: 's2',
        skillName: 'log-scanner',
        status: 'success',
        report: null,
        duration: null,
        createdAt: new Date(),
      },
    );
    const repo = getSkillExecutionRepository();
    const statsT1 = await repo.getStats('t1');
    const statsT2 = await repo.getStats('t2');
    expect(statsT1.length).toBe(1);
    expect(statsT2.length).toBe(1);
    expect(statsT1[0]!.skillName).toBe('log-scanner');
    expect(statsT2[0]!.skillName).toBe('log-scanner');
  });

  it('singleton 返回同一实例', () => {
    const a = getSkillExecutionRepository();
    const b = getSkillExecutionRepository();
    expect(a).toBe(b);
  });
});
