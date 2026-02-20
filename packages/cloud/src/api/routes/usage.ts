// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Usage API — 使用量摘要、历史趋势、配额详情。
 *
 * 数据按 tenant_id 隔离；需 requireAuth + verifyTenant。
 *
 * @module cloud/api/routes/usage
 */

import { Hono } from 'hono';
import { eq, gte, lt, sql, and } from 'drizzle-orm';
import { getPgDatabase } from '../../db/pg-connection.js';
import { aiUsage, servers, tenants } from '../../db/pg-schema.js';
import { getAIQuotaManager } from '../../ai/quota-manager.js';
import { getSkillExecutionRepository } from '../../skills/skill-execution-repository.js';
import { PLAN_QUOTAS } from '../../ai/constants.js';
import type { PlanId } from '../../ai/types.js';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface UsageApiEnv {
  Variables: {
    userId: string;
    tenantId: string | null;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startOfMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function endOfMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function nextMonthStart(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createUsageRoutes() {
  const usage = new Hono<UsageApiEnv>();

  /**
   * GET /summary — 本月使用量摘要（按租户）
   */
  usage.get('/summary', async (c) => {
    const userId = c.get('userId');
    const tenantId = c.get('tenantId');

    if (!userId || !tenantId) {
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication and tenant required' } },
        401,
      );
    }

    const db = getPgDatabase();
    const monthStart = startOfMonth();
    const monthEnd = endOfMonth();

    const [aiRow] = await db
      .select({
        aiCalls: sql<number>`count(*)::int`,
        aiCost: sql<number>`coalesce(sum(${aiUsage.cost})::float, 0)`,
      })
      .from(aiUsage)
      .where(
        and(
          eq(aiUsage.tenantId, tenantId),
          gte(aiUsage.createdAt, monthStart),
          lt(aiUsage.createdAt, monthEnd),
        ),
      );

    const quotaResult = await getAIQuotaManager().checkQuota(userId, tenantId);
    const skillRepo = getSkillExecutionRepository();
    const stats = await skillRepo.getStats(tenantId, { since: monthStart, until: monthEnd });
    const skillExecutions = stats.reduce((acc, s) => acc + s.count, 0);

    const [serverRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(servers)
      .where(eq(servers.tenantId, tenantId));

    return c.json({
      aiCalls: aiRow?.aiCalls ?? 0,
      aiCost: Number(aiRow?.aiCost ?? 0),
      quotaRemaining: quotaResult.remaining ?? 0,
      skillExecutions,
      serverCount: serverRow?.count ?? 0,
    });
  });

  /**
   * GET /history?days=30 — 历史趋势：每日成本、模型分布、top skills
   */
  usage.get('/history', async (c) => {
    const tenantId = c.get('tenantId');
    if (!tenantId) {
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Tenant required' } },
        401,
      );
    }

    const days = Math.min(90, Math.max(1, parseInt(c.req.query('days') ?? '30', 10) || 30));
    const until = new Date();
    const since = new Date(until);
    since.setUTCDate(since.getUTCDate() - days);

    const db = getPgDatabase();

    const dailyRows = await db
      .select({
        date: sql<string>`to_char(${aiUsage.createdAt}, 'YYYY-MM-DD')`,
        cost: sql<number>`sum(${aiUsage.cost})::float`,
      })
      .from(aiUsage)
      .where(
        and(
          eq(aiUsage.tenantId, tenantId),
          gte(aiUsage.createdAt, since),
          lt(aiUsage.createdAt, until),
        ),
      )
      .groupBy(sql`to_char(${aiUsage.createdAt}, 'YYYY-MM-DD')`);

    const modelRows = await db
      .select({
        model: aiUsage.model,
        callCount: sql<number>`count(*)::int`,
        totalCost: sql<number>`sum(${aiUsage.cost})::float`,
      })
      .from(aiUsage)
      .where(
        and(
          eq(aiUsage.tenantId, tenantId),
          gte(aiUsage.createdAt, since),
          lt(aiUsage.createdAt, until),
        ),
      )
      .groupBy(aiUsage.model);

    const skillRepo = getSkillExecutionRepository();
    const topSkills = await skillRepo.getStats(tenantId, { since, until });

    return c.json({
      dailyCosts: dailyRows.map((r) => ({ date: r.date, cost: Number(r.cost) })),
      modelDistribution: modelRows.map((r) => ({
        model: r.model,
        callCount: r.callCount,
        totalCost: Number(r.totalCost),
      })),
      topSkills: topSkills.map((s) => ({
        skillName: s.skillName,
        count: s.count,
        successCount: s.successCount,
        failedCount: s.failedCount,
      })),
    });
  });

  /**
   * GET /quota — 当前用户配额详情：plan, used, limit, resetDate
   */
  usage.get('/quota', async (c) => {
    const userId = c.get('userId');
    const tenantId = c.get('tenantId');

    if (!userId || !tenantId) {
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication and tenant required' } },
        401,
      );
    }

    const db = getPgDatabase();
    const [tenant] = await db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const plan: PlanId = (tenant?.plan as PlanId) ?? 'free';
    const quota = PLAN_QUOTAS[plan];
    const monthStart = startOfMonth();
    const monthEnd = endOfMonth();

    const [countRow] = await db
      .select({ used: sql<number>`count(*)::int` })
      .from(aiUsage)
      .where(
        and(
          eq(aiUsage.userId, userId),
          gte(aiUsage.createdAt, monthStart),
          lt(aiUsage.createdAt, monthEnd),
        ),
      );

    const [costRow] = await db
      .select({ usedCost: sql<number>`coalesce(sum(${aiUsage.cost})::float, 0)` })
      .from(aiUsage)
      .where(
        and(
          eq(aiUsage.userId, userId),
          gte(aiUsage.createdAt, monthStart),
          lt(aiUsage.createdAt, monthEnd),
        ),
      );

    const used = countRow?.used ?? 0;
    const usedCost = Number(costRow?.usedCost ?? 0);
    const limit = quota.maxCalls ?? null;
    const softLimit = quota.softLimit ?? null;

    return c.json({
      plan,
      used: limit != null ? used : usedCost,
      limit: limit ?? softLimit ?? null,
      resetDate: nextMonthStart(),
      type: limit != null ? 'count' : 'cost',
    });
  });

  return usage;
}
