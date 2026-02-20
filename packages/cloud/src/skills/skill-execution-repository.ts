// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill 执行记录 Repository — 持久化与按租户查询。
 *
 * 供 Usage 统计与 log-scanner / security-scanner 写入执行记录。
 *
 * @module cloud/skills/skill-execution-repository
 */

import { and, eq, gte, lte, sql, desc } from 'drizzle-orm';
import { getPgDatabase } from '../db/pg-connection.js';
import { skillExecutions } from '../db/pg-schema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillExecutionRecord {
  id: number;
  userId: string;
  tenantId: string;
  serverId: string;
  skillName: string;
  status: 'success' | 'failed';
  report: Record<string, unknown> | null;
  duration: number | null;
  createdAt: Date;
}

export interface CreateSkillExecutionInput {
  userId: string;
  tenantId: string;
  serverId: string;
  skillName: string;
  status: 'success' | 'failed';
  report?: Record<string, unknown> | null;
  duration?: number | null;
}

export interface FindByTenantOptions {
  limit?: number;
  offset?: number;
  skillName?: string;
  since?: Date;
  until?: Date;
}

export interface SkillStatsEntry {
  skillName: string;
  count: number;
  successCount: number;
  failedCount: number;
}

export interface GetStatsOptions {
  since?: Date;
  until?: Date;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: SkillExecutionRepository | null = null;

export function getSkillExecutionRepository(): SkillExecutionRepository {
  if (!_instance) {
    _instance = new SkillExecutionRepository(getPgDatabase());
  }
  return _instance;
}

export function _resetSkillExecutionRepository(): void {
  _instance = null;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class SkillExecutionRepository {
  constructor(private db: ReturnType<typeof getPgDatabase>) {}

  /**
   * 插入一条执行记录。
   */
  async create(input: CreateSkillExecutionInput): Promise<SkillExecutionRecord> {
    const [row] = await this.db
      .insert(skillExecutions)
      .values({
        createdAt: new Date(),
        userId: input.userId,
        tenantId: input.tenantId,
        serverId: input.serverId,
        skillName: input.skillName,
        status: input.status,
        report: input.report ?? null,
        duration: input.duration ?? null,
      })
      .returning();

    if (!row) throw new Error('Insert skill_executions failed');
    return this.toRecord(row);
  }

  /**
   * 按租户分页查询，支持按 skillName、时间范围筛选。
   */
  async findByTenant(
    tenantId: string,
    options: FindByTenantOptions = {},
  ): Promise<SkillExecutionRecord[]> {
    const conditions = [eq(skillExecutions.tenantId, tenantId)];
    if (options.skillName) conditions.push(eq(skillExecutions.skillName, options.skillName));
    if (options.since) conditions.push(gte(skillExecutions.createdAt, options.since));
    if (options.until) conditions.push(lte(skillExecutions.createdAt, options.until));

    const rows = await this.db
      .select()
      .from(skillExecutions)
      .where(and(...conditions))
      .orderBy(desc(skillExecutions.createdAt))
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0);

    return rows.map((r) => this.toRecord(r));
  }

  /**
   * 按租户 + 时间范围聚合各 skill 的执行次数（成功/失败）。
   */
  async getStats(
    tenantId: string,
    options: GetStatsOptions = {},
  ): Promise<SkillStatsEntry[]> {
    const conditions = [eq(skillExecutions.tenantId, tenantId)];
    if (options.since) conditions.push(gte(skillExecutions.createdAt, options.since));
    if (options.until) conditions.push(lte(skillExecutions.createdAt, options.until));

    const rows = await this.db
      .select({
        skillName: skillExecutions.skillName,
        count: sql<number>`count(*)::int`,
        successCount: sql<number>`count(*) filter (where ${skillExecutions.status} = 'success')::int`,
        failedCount: sql<number>`count(*) filter (where ${skillExecutions.status} = 'failed')::int`,
      })
      .from(skillExecutions)
      .where(and(...conditions))
      .groupBy(skillExecutions.skillName);

    return rows.map((r) => ({
      skillName: r.skillName,
      count: r.count,
      successCount: r.successCount,
      failedCount: r.failedCount,
    }));
  }

  private toRecord(row: {
    id: number;
    userId: string;
    tenantId: string;
    serverId: string;
    skillName: string;
    status: 'success' | 'failed';
    report: Record<string, unknown> | null;
    duration: number | null;
    createdAt: Date;
  }): SkillExecutionRecord {
    return {
      id: row.id,
      userId: row.userId,
      tenantId: row.tenantId,
      serverId: row.serverId,
      skillName: row.skillName,
      status: row.status,
      report: row.report,
      duration: row.duration,
      createdAt: row.createdAt,
    };
  }
}
