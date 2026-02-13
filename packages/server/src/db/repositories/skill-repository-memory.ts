// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * In-memory skill repository implementation for testing.
 *
 * Extracted from skill-repository.ts to keep file sizes under the 500-line limit.
 * Implements the same SkillRepository interface using plain arrays.
 *
 * @module db/repositories/skill-repository-memory
 */

import { randomUUID } from 'node:crypto';

import { computeStats } from './skill-repository-stats.js';

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
import type {
  SkillRepository,
  InstallSkillInput,
  CreateExecutionInput,
  UpdateManifestInput,
} from './skill-repository.js';

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

  async findAllSkills(): Promise<InstalledSkill[]> {
    return [...this.skills].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
      source: input.source as SkillSource,
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
      triggerType: input.triggerType as SkillTriggerType,
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
