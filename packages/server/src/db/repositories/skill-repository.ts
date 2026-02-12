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
import { eq, and, desc } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { installedSkills, skillExecutions, skillStore } from '../schema.js';

import type { DrizzleDB } from '../connection.js';
import type {
  SkillSource,
  SkillStatus,
  SkillTriggerType,
  SkillExecutionStatus,
} from '../schema.js';
import type {
  InstalledSkill,
  SkillExecution,
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

export interface SkillRepository {
  findAll(userId: string): Promise<InstalledSkill[]>;
  findAllEnabled(): Promise<InstalledSkill[]>;
  findById(id: string): Promise<InstalledSkill | null>;
  findByName(userId: string, name: string): Promise<InstalledSkill | null>;
  install(input: InstallSkillInput): Promise<InstalledSkill>;
  updateStatus(id: string, status: SkillStatus): Promise<void>;
  updateConfig(id: string, config: Record<string, unknown>): Promise<void>;
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
}

// ============================================================================
// InMemory Implementation (for testing)
// ============================================================================

export class InMemorySkillRepository implements SkillRepository {
  private skills: InstalledSkill[] = [];
  private executions: SkillExecution[] = [];

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

  async uninstall(id: string): Promise<void> {
    this.skills = this.skills.filter((s) => s.id !== id);
    this.executions = this.executions.filter((e) => e.skillId !== id);
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
