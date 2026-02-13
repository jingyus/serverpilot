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
import { eq, and, desc, lt, inArray, count as drizzleCount } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { installedSkills, skillExecutions, skillExecutionLogs } from '../schema.js';
import { computeStats } from './skill-repository-stats.js';

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

// Re-export InMemorySkillRepository from its dedicated module
// so existing imports from 'skill-repository.js' continue to work.
export { InMemorySkillRepository } from './skill-repository-memory.js';

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
