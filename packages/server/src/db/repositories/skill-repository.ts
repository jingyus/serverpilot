// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill repository — data access layer for installed skills and execution history.
 *
 * Provides CRUD for installed skills, execution records, and per-skill KV store.
 *
 * @module db/repositories/skill-repository
 */

import { randomUUID } from 'node:crypto';
import { eq, and, desc, lt, not, inArray, count as drizzleCount } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { installedSkills, skillExecutions, skillStore, skillExecutionLogs } from '../schema.js';

import type { DrizzleDB } from '../connection.js';
import type {
  SkillSource,
  SkillStatus,
  SkillTriggerType,
  SkillExecutionStatus,
  SkillLogEventType,
} from '../schema.js';
import type {
  InstalledSkill,
  SkillExecution,
  SkillExecutionLog,
  SkillStats,
} from '../../core/skill/types.js';

// ============================================================================
// Input Types
// ============================================================================

export interface InstallSkillInput {
  userId: string;
  tenantId?: string | null;
  name: string;
  displayName?: string | null;
  version: string;
  source: SkillSource;
  skillPath: string;
  config?: Record<string, unknown> | null;
  manifestInputs?: unknown[] | null;
}

export interface CreateExecutionInput {
  skillId: string;
  serverId: string;
  userId: string;
  triggerType: SkillTriggerType;
}

// ============================================================================
// Interface
// ============================================================================

export interface UpdateManifestInput {
  version: string;
  displayName?: string | null;
  skillPath?: string;
  manifestInputs?: unknown[] | null;
}

export interface SkillRepository {
  findAll(userId: string): Promise<InstalledSkill[]>;
  findAllEnabled(): Promise<InstalledSkill[]>;
  findById(id: string): Promise<InstalledSkill | null>;
  findByName(userId: string, name: string): Promise<InstalledSkill | null>;
  install(input: InstallSkillInput): Promise<InstalledSkill>;
  updateStatus(id: string, status: SkillStatus): Promise<void>;
  updateConfig(id: string, config: Record<string, unknown>): Promise<void>;
  updateManifest(id: string, input: UpdateManifestInput): Promise<void>;
  uninstall(id: string): Promise<void>;

  createExecution(input: CreateExecutionInput): Promise<SkillExecution>;
  completeExecution(
    id: string,
    status: SkillExecutionStatus,
    result: Record<string, unknown> | null,
    stepsExecuted: number,
    duration: number,
  ): Promise<void>;
  listExecutions(skillId: string, limit: number): Promise<SkillExecution[]>;
  findExecutionById(id: string): Promise<SkillExecution | null>;
  listPendingConfirmations(userId: string): Promise<SkillExecution[]>;
  expirePendingConfirmations(cutoff: Date): Promise<number>;

  /** Delete completed/failed/cancelled/timeout executions started before `cutoff`. Skips running/pending. */
  deleteExecutionsBefore(cutoff: Date): Promise<number>;
  /** Count total execution records, optionally filtered by skillId. */
  countExecutions(skillId?: string): Promise<number>;

  getStats(userId: string, from?: Date, to?: Date): Promise<SkillStats>;

  /** Append a log entry for a skill execution. */
  appendLog(executionId: string, eventType: SkillLogEventType, data: Record<string, unknown>): Promise<void>;
  /** Get all log entries for a skill execution, ordered by creation time. */
  getLogs(executionId: string): Promise<SkillExecutionLog[]>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

export class DrizzleSkillRepository implements SkillRepository {
  constructor(private db: DrizzleDB) {}

  async findAll(userId: string): Promise<InstalledSkill[]> {
    const rows = this.db
      .select()
      .from(installedSkills)
      .where(eq(installedSkills.userId, userId))
      .orderBy(desc(installedSkills.createdAt))
      .all();
    return rows.map((r) => this.toInstalledSkill(r));
  }

  async findAllEnabled(): Promise<InstalledSkill[]> {
    const rows = this.db
      .select()
      .from(installedSkills)
      .where(eq(installedSkills.status, 'enabled'))
      .orderBy(desc(installedSkills.createdAt))
      .all();
    return rows.map((r) => this.toInstalledSkill(r));
  }

  async findById(id: string): Promise<InstalledSkill | null> {
    const rows = this.db
      .select()
      .from(installedSkills)
      .where(eq(installedSkills.id, id))
      .limit(1)
      .all();
    return rows[0] ? this.toInstalledSkill(rows[0]) : null;
  }

  async findByName(userId: string, name: string): Promise<InstalledSkill | null> {
    const rows = this.db
      .select()
      .from(installedSkills)
      .where(and(eq(installedSkills.userId, userId), eq(installedSkills.name, name)))
      .limit(1)
      .all();
    return rows[0] ? this.toInstalledSkill(rows[0]) : null;
  }

  async install(input: InstallSkillInput): Promise<InstalledSkill> {
    const now = new Date();
    const id = randomUUID();

    this.db.insert(installedSkills).values({
      id,
      userId: input.userId,
      tenantId: input.tenantId ?? null,
      name: input.name,
      displayName: input.displayName ?? null,
      version: input.version,
      source: input.source,
      skillPath: input.skillPath,
      status: 'installed',
      config: input.config ?? null,
      manifestInputs: input.manifestInputs ?? null,
      createdAt: now,
      updatedAt: now,
    }).run();

    return (await this.findById(id))!;
  }

  async updateStatus(id: string, status: SkillStatus): Promise<void> {
    this.db.update(installedSkills)
      .set({ status, updatedAt: new Date() })
      .where(eq(installedSkills.id, id))
      .run();
  }

  async updateConfig(id: string, config: Record<string, unknown>): Promise<void> {
    this.db.update(installedSkills)
      .set({ config, updatedAt: new Date() })
      .where(eq(installedSkills.id, id))
      .run();
  }

  async updateManifest(id: string, input: UpdateManifestInput): Promise<void> {
    const updates: Record<string, unknown> = {
      version: input.version,
      updatedAt: new Date(),
    };
    if (input.displayName !== undefined) updates['displayName'] = input.displayName;
    if (input.skillPath !== undefined) updates['skillPath'] = input.skillPath;
    if (input.manifestInputs !== undefined) updates['manifestInputs'] = input.manifestInputs;

    this.db.update(installedSkills)
      .set(updates)
      .where(eq(installedSkills.id, id))
      .run();
  }

  async uninstall(id: string): Promise<void> {
    this.db.delete(installedSkills)
      .where(eq(installedSkills.id, id))
      .run();
  }

  async createExecution(input: CreateExecutionInput): Promise<SkillExecution> {
    const now = new Date();
    const id = randomUUID();

    this.db.insert(skillExecutions).values({
      id,
      skillId: input.skillId,
      serverId: input.serverId,
      userId: input.userId,
      triggerType: input.triggerType,
      status: 'running',
      startedAt: now,
      completedAt: null,
      result: null,
      stepsExecuted: 0,
      duration: null,
    }).run();

    return (await this.findExecutionById(id))!;
  }

  async completeExecution(
    id: string,
    status: SkillExecutionStatus,
    result: Record<string, unknown> | null,
    stepsExecuted: number,
    duration: number,
  ): Promise<void> {
    this.db.update(skillExecutions)
      .set({
        status,
        result,
        stepsExecuted,
        duration,
        completedAt: new Date(),
      })
      .where(eq(skillExecutions.id, id))
      .run();
  }

  async listExecutions(skillId: string, limit: number): Promise<SkillExecution[]> {
    const rows = this.db
      .select()
      .from(skillExecutions)
      .where(eq(skillExecutions.skillId, skillId))
      .orderBy(desc(skillExecutions.startedAt))
      .limit(limit)
      .all();
    return rows.map((r) => this.toExecution(r));
  }

  async findExecutionById(id: string): Promise<SkillExecution | null> {
    const rows = this.db
      .select()
      .from(skillExecutions)
      .where(eq(skillExecutions.id, id))
      .limit(1)
      .all();
    return rows[0] ? this.toExecution(rows[0]) : null;
  }

  async listPendingConfirmations(userId: string): Promise<SkillExecution[]> {
    const rows = this.db
      .select()
      .from(skillExecutions)
      .where(and(eq(skillExecutions.userId, userId), eq(skillExecutions.status, 'pending_confirmation')))
      .orderBy(desc(skillExecutions.startedAt))
      .all();
    return rows.map((r) => this.toExecution(r));
  }

  async expirePendingConfirmations(cutoff: Date): Promise<number> {
    const rows = this.db.select().from(skillExecutions)
      .where(eq(skillExecutions.status, 'pending_confirmation')).all();
    let expired = 0;
    for (const row of rows) {
      if (row.startedAt && row.startedAt < cutoff) {
        this.db.update(skillExecutions)
          .set({ status: 'cancelled', result: { reason: 'expired' } as Record<string, unknown>, completedAt: new Date() })
          .where(eq(skillExecutions.id, row.id)).run();
        expired++;
      }
    }
    return expired;
  }

  async deleteExecutionsBefore(cutoff: Date): Promise<number> {
    // Only delete terminal statuses — never running or pending_confirmation
    const terminalStatuses = ['success', 'failed', 'timeout', 'cancelled'] as const;
    const rows = this.db
      .select({ id: skillExecutions.id })
      .from(skillExecutions)
      .where(
        and(
          lt(skillExecutions.startedAt, cutoff),
          inArray(skillExecutions.status, [...terminalStatuses]),
        ),
      )
      .all();

    for (const row of rows) {
      this.db.delete(skillExecutions).where(eq(skillExecutions.id, row.id)).run();
    }
    return rows.length;
  }

  async countExecutions(skillId?: string): Promise<number> {
    const condition = skillId ? eq(skillExecutions.skillId, skillId) : undefined;
    const rows = this.db
      .select({ value: drizzleCount() })
      .from(skillExecutions)
      .where(condition)
      .all();
    return rows[0]?.value ?? 0;
  }

  async getStats(userId: string, from?: Date, to?: Date): Promise<SkillStats> {
    // Default range: last 30 days
    const rangeFrom = from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rangeTo = to ?? new Date();

    // Fetch user's skill ids for name mapping
    const userSkills = this.db
      .select()
      .from(installedSkills)
      .where(eq(installedSkills.userId, userId))
      .all();
    const skillNameMap = new Map(userSkills.map((s) => [s.id, s.displayName ?? s.name]));

    // Fetch executions in range for this user
    const rows = this.db
      .select()
      .from(skillExecutions)
      .where(eq(skillExecutions.userId, userId))
      .all()
      .filter((r) => {
        const ts = r.startedAt?.getTime() ?? 0;
        return ts >= rangeFrom.getTime() && ts <= rangeTo.getTime();
      });

    return computeStats(rows, skillNameMap);
  }

  async appendLog(
    executionId: string,
    eventType: SkillLogEventType,
    data: Record<string, unknown>,
  ): Promise<void> {
    this.db.insert(skillExecutionLogs).values({
      id: randomUUID(),
      executionId,
      eventType,
      data,
      createdAt: new Date(),
    }).run();
  }

  async getLogs(executionId: string): Promise<SkillExecutionLog[]> {
    const rows = this.db
      .select()
      .from(skillExecutionLogs)
      .where(eq(skillExecutionLogs.executionId, executionId))
      .orderBy(skillExecutionLogs.createdAt)
      .all();
    return rows.map((r) => this.toExecutionLog(r));
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private toInstalledSkill(row: typeof installedSkills.$inferSelect): InstalledSkill {
    return {
      id: row.id,
      userId: row.userId,
      tenantId: row.tenantId,
      name: row.name,
      displayName: row.displayName,
      version: row.version,
      source: row.source as SkillSource,
      skillPath: row.skillPath,
      status: row.status as SkillStatus,
      config: row.config as Record<string, unknown> | null,
      manifestInputs: (row.manifestInputs as unknown[] | null) ?? null,
      createdAt: row.createdAt!.toISOString(),
      updatedAt: row.updatedAt!.toISOString(),
    };
  }

  private toExecution(row: typeof skillExecutions.$inferSelect): SkillExecution {
    return {
      id: row.id,
      skillId: row.skillId,
      serverId: row.serverId,
      userId: row.userId,
      triggerType: row.triggerType as SkillTriggerType,
      status: row.status as SkillExecutionStatus,
      startedAt: row.startedAt!.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      result: row.result as Record<string, unknown> | null,
      stepsExecuted: row.stepsExecuted,
      duration: row.duration,
    };
  }

  private toExecutionLog(row: typeof skillExecutionLogs.$inferSelect): SkillExecutionLog {
    return {
      id: row.id,
      executionId: row.executionId,
      eventType: row.eventType as SkillLogEventType,
      data: row.data as Record<string, unknown>,
      createdAt: row.createdAt!.toISOString(),
    };
  }
}

// ============================================================================
// InMemory Implementation (for testing)
// ============================================================================

export class InMemorySkillRepository implements SkillRepository {
  private skills: InstalledSkill[] = [];
  private executions: SkillExecution[] = [];
  private logs: SkillExecutionLog[] = [];

  async findAll(userId: string): Promise<InstalledSkill[]> {
    return this.skills
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findAllEnabled(): Promise<InstalledSkill[]> {
    return this.skills
      .filter((s) => s.status === 'enabled')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findById(id: string): Promise<InstalledSkill | null> {
    return this.skills.find((s) => s.id === id) ?? null;
  }

  async findByName(userId: string, name: string): Promise<InstalledSkill | null> {
    return this.skills.find((s) => s.userId === userId && s.name === name) ?? null;
  }

  async install(input: InstallSkillInput): Promise<InstalledSkill> {
    const now = new Date().toISOString();
    const skill: InstalledSkill = {
      id: randomUUID(),
      userId: input.userId,
      tenantId: input.tenantId ?? null,
      name: input.name,
      displayName: input.displayName ?? null,
      version: input.version,
      source: input.source,
      skillPath: input.skillPath,
      status: 'installed',
      config: input.config ?? null,
      manifestInputs: (input.manifestInputs as InstalledSkill['manifestInputs']) ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.skills.push(skill);
    return skill;
  }

  async updateStatus(id: string, status: SkillStatus): Promise<void> {
    const skill = this.skills.find((s) => s.id === id);
    if (skill) {
      skill.status = status;
      skill.updatedAt = new Date().toISOString();
    }
  }

  async updateConfig(id: string, config: Record<string, unknown>): Promise<void> {
    const skill = this.skills.find((s) => s.id === id);
    if (skill) {
      skill.config = config;
      skill.updatedAt = new Date().toISOString();
    }
  }

  async updateManifest(id: string, input: UpdateManifestInput): Promise<void> {
    const skill = this.skills.find((s) => s.id === id);
    if (skill) {
      skill.version = input.version;
      if (input.displayName !== undefined) skill.displayName = input.displayName;
      if (input.skillPath !== undefined) skill.skillPath = input.skillPath;
      if (input.manifestInputs !== undefined) {
        skill.manifestInputs = (input.manifestInputs as InstalledSkill['manifestInputs']) ?? null;
      }
      skill.updatedAt = new Date().toISOString();
    }
  }

  async uninstall(id: string): Promise<void> {
    const executionIds = new Set(this.executions.filter((e) => e.skillId === id).map((e) => e.id));
    this.skills = this.skills.filter((s) => s.id !== id);
    this.executions = this.executions.filter((e) => e.skillId !== id);
    this.logs = this.logs.filter((l) => !executionIds.has(l.executionId));
  }

  async createExecution(input: CreateExecutionInput): Promise<SkillExecution> {
    const now = new Date().toISOString();
    const execution: SkillExecution = {
      id: randomUUID(),
      skillId: input.skillId,
      serverId: input.serverId,
      userId: input.userId,
      triggerType: input.triggerType,
      status: 'running',
      startedAt: now,
      completedAt: null,
      result: null,
      stepsExecuted: 0,
      duration: null,
    };
    this.executions.push(execution);
    return execution;
  }

  async completeExecution(
    id: string,
    status: SkillExecutionStatus,
    result: Record<string, unknown> | null,
    stepsExecuted: number,
    duration: number,
  ): Promise<void> {
    const execution = this.executions.find((e) => e.id === id);
    if (execution) {
      execution.status = status;
      execution.result = result;
      execution.stepsExecuted = stepsExecuted;
      execution.duration = duration;
      execution.completedAt = new Date().toISOString();
    }
  }

  async listExecutions(skillId: string, limit: number): Promise<SkillExecution[]> {
    return this.executions
      .filter((e) => e.skillId === skillId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  async findExecutionById(id: string): Promise<SkillExecution | null> {
    return this.executions.find((e) => e.id === id) ?? null;
  }

  async listPendingConfirmations(userId: string): Promise<SkillExecution[]> {
    return this.executions
      .filter((e) => e.userId === userId && e.status === 'pending_confirmation')
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async expirePendingConfirmations(cutoff: Date): Promise<number> {
    const cutoffStr = cutoff.toISOString();
    let expired = 0;
    for (const e of this.executions) {
      if (e.status === 'pending_confirmation' && e.startedAt < cutoffStr) {
        e.status = 'cancelled';
        e.result = { reason: 'expired' };
        e.completedAt = new Date().toISOString();
        expired++;
      }
    }
    return expired;
  }

  async deleteExecutionsBefore(cutoff: Date): Promise<number> {
    const cutoffStr = cutoff.toISOString();
    const terminalStatuses = new Set(['success', 'failed', 'timeout', 'cancelled']);
    const deletedIds = new Set(
      this.executions
        .filter((e) => e.startedAt < cutoffStr && terminalStatuses.has(e.status))
        .map((e) => e.id),
    );
    const before = this.executions.length;
    this.executions = this.executions.filter((e) => !deletedIds.has(e.id));
    this.logs = this.logs.filter((l) => !deletedIds.has(l.executionId));
    return before - this.executions.length;
  }

  async countExecutions(skillId?: string): Promise<number> {
    if (skillId) {
      return this.executions.filter((e) => e.skillId === skillId).length;
    }
    return this.executions.length;
  }

  async getStats(userId: string, from?: Date, to?: Date): Promise<SkillStats> {
    const rangeFrom = from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rangeTo = to ?? new Date();
    const rangeFromStr = rangeFrom.toISOString();
    const rangeToStr = rangeTo.toISOString();

    // Build skill name map
    const userSkills = this.skills.filter((s) => s.userId === userId);
    const skillNameMap = new Map(userSkills.map((s) => [s.id, s.displayName ?? s.name]));

    // Filter executions in range for this user
    const rows = this.executions
      .filter((e) => e.userId === userId && e.startedAt >= rangeFromStr && e.startedAt <= rangeToStr)
      .map((e) => ({
        id: e.id,
        skillId: e.skillId,
        status: e.status,
        triggerType: e.triggerType,
        startedAt: new Date(e.startedAt),
        duration: e.duration,
      }));

    return computeStats(rows, skillNameMap);
  }

  async appendLog(
    executionId: string,
    eventType: SkillLogEventType,
    data: Record<string, unknown>,
  ): Promise<void> {
    this.logs.push({
      id: randomUUID(),
      executionId,
      eventType,
      data,
      createdAt: new Date().toISOString(),
    });
  }

  async getLogs(executionId: string): Promise<SkillExecutionLog[]> {
    return this.logs
      .filter((l) => l.executionId === executionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

// ============================================================================
// Shared Stats Computation
// ============================================================================

interface StatsRow {
  skillId: string;
  status: string;
  triggerType: string;
  startedAt: Date | null;
  duration: number | null;
}

function computeStats(
  rows: StatsRow[],
  skillNameMap: Map<string, string>,
): SkillStats {
  const totalExecutions = rows.length;
  const successCount = rows.filter((r) => r.status === 'success').length;
  const successRate = totalExecutions > 0 ? successCount / totalExecutions : 0;

  const durations = rows.filter((r) => r.duration != null).map((r) => r.duration!);
  const avgDuration = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  // Top skills by execution count (top 5)
  const skillCounts = new Map<string, { count: number; success: number }>();
  for (const r of rows) {
    const entry = skillCounts.get(r.skillId) ?? { count: 0, success: 0 };
    entry.count++;
    if (r.status === 'success') entry.success++;
    skillCounts.set(r.skillId, entry);
  }
  const topSkills = [...skillCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([skillId, { count, success }]) => ({
      skillId,
      skillName: skillNameMap.get(skillId) ?? skillId,
      executionCount: count,
      successCount: success,
    }));

  // Daily trend
  const dailyMap = new Map<string, { total: number; success: number; failed: number }>();
  for (const r of rows) {
    const date = r.startedAt ? r.startedAt.toISOString().slice(0, 10) : 'unknown';
    const entry = dailyMap.get(date) ?? { total: 0, success: 0, failed: 0 };
    entry.total++;
    if (r.status === 'success') entry.success++;
    if (r.status === 'failed' || r.status === 'timeout') entry.failed++;
    dailyMap.set(date, entry);
  }
  const dailyTrend = [...dailyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, { total, success, failed }]) => ({ date, total, success, failed }));

  // Trigger distribution
  const triggerMap = new Map<string, number>();
  for (const r of rows) {
    triggerMap.set(r.triggerType, (triggerMap.get(r.triggerType) ?? 0) + 1);
  }
  const triggerDistribution = [...triggerMap.entries()].map(([triggerType, count]) => ({
    triggerType: triggerType as import('../../db/schema.js').SkillTriggerType,
    count,
  }));

  return {
    totalExecutions,
    successRate,
    avgDuration,
    topSkills,
    dailyTrend,
    triggerDistribution,
  };
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: SkillRepository | null = null;

export function getSkillRepository(): SkillRepository {
  if (!_instance) {
    _instance = new DrizzleSkillRepository(getDatabase());
  }
  return _instance;
}

export function setSkillRepository(repo: SkillRepository): void {
  _instance = repo;
}

export function _resetSkillRepository(): void {
  _instance = null;
}
