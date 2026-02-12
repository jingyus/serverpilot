// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * SkillConfirmationManager — handles the confirmation flow for skill executions.
 *
 * Extracted from SkillEngine to keep file size within limits.
 * Manages pending confirmations: create, confirm, reject, list, expire.
 *
 * @module core/skill/engine-confirmation
 */

import { createContextLogger } from '../../utils/logger.js';
import { loadSkillFromDir, resolvePromptTemplate, type TemplateVars } from './loader.js';
import { getSkillEventBus } from './skill-event-bus.js';
import type { SkillRepository } from '../../db/repositories/skill-repository.js';
import type { SkillManifest } from '@aiinstaller/shared';
import type {
  InstalledSkill,
  SkillExecution,
  SkillExecutionResult,
  SkillRunParams,
} from './types.js';
import { SkillRunner } from './runner.js';

const logger = createContextLogger({ module: 'skill-confirmation' });

/** TTL for pending confirmation executions before auto-cancellation (30 minutes). */
const CONFIRMATION_TTL_MS = 30 * 60 * 1000;

/** Callbacks injected by SkillEngine for shared functionality. */
export interface ConfirmationDeps {
  repo: SkillRepository;
  buildServerVars: (serverId: string, userId: string) => Promise<{ name: string; os: string; ip: string }>;
  buildSkillVars: (skillId: string) => Promise<{ last_run: string; last_result: string }>;
  dispatchWebhookEvent: (type: 'skill.completed' | 'skill.failed', userId: string, data: Record<string, unknown>) => void;
}

export class SkillConfirmationManager {
  private repo: SkillRepository;
  private deps: ConfirmationDeps;

  constructor(deps: ConfirmationDeps) {
    this.repo = deps.repo;
    this.deps = deps;
  }

  async createPendingConfirmation(
    params: SkillRunParams,
    skill: InstalledSkill,
    _manifest: SkillManifest,
  ): Promise<SkillExecutionResult> {
    const { skillId, serverId, userId, triggerType } = params;

    const execution = await this.repo.createExecution({
      skillId, serverId, userId, triggerType,
    });

    await this.repo.completeExecution(execution.id, 'pending_confirmation', null, 0, 0);

    const bus = getSkillEventBus();
    bus.publish(execution.id, {
      type: 'confirmation_required',
      executionId: execution.id,
      timestamp: new Date().toISOString(),
      skillId,
      skillName: skill.displayName ?? skill.name,
      serverId,
      triggerType,
    });

    logger.info(
      { executionId: execution.id, skillId, triggerType },
      'Skill execution awaiting confirmation',
    );

    return {
      executionId: execution.id,
      status: 'pending_confirmation',
      stepsExecuted: 0,
      duration: 0,
      result: null,
      errors: [],
    };
  }

  async confirmExecution(executionId: string, _userId: string): Promise<SkillExecutionResult> {
    const execution = await this.repo.findExecutionById(executionId);
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }
    if (execution.status !== 'pending_confirmation') {
      throw new Error(
        `Execution '${executionId}' is not pending confirmation (status=${execution.status})`,
      );
    }

    const createdAt = new Date(execution.startedAt).getTime();
    if (Date.now() - createdAt > CONFIRMATION_TTL_MS) {
      await this.repo.completeExecution(executionId, 'cancelled', { reason: 'expired' }, 0, 0);
      throw new Error(`Execution '${executionId}' has expired`);
    }

    return this.executeConfirmed(execution);
  }

  async rejectExecution(executionId: string, _userId: string): Promise<void> {
    const execution = await this.repo.findExecutionById(executionId);
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }
    if (execution.status !== 'pending_confirmation') {
      throw new Error(
        `Execution '${executionId}' is not pending confirmation (status=${execution.status})`,
      );
    }

    await this.repo.completeExecution(executionId, 'cancelled', { reason: 'rejected' }, 0, 0);
    logger.info({ executionId }, 'Skill execution rejected');
  }

  async listPendingConfirmations(userId: string): Promise<SkillExecution[]> {
    return this.repo.listPendingConfirmations(userId);
  }

  async expirePendingConfirmations(): Promise<number> {
    const cutoff = new Date(Date.now() - CONFIRMATION_TTL_MS);
    return this.repo.expirePendingConfirmations(cutoff);
  }

  private async executeConfirmed(execution: SkillExecution): Promise<SkillExecutionResult> {
    const startTime = Date.now();
    const { skillId, serverId, userId } = execution;

    const skill = await this.repo.findById(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    if (skill.status !== 'enabled') {
      await this.repo.completeExecution(execution.id, 'cancelled', { reason: 'skill_disabled' }, 0, 0);
      throw new Error(`Skill '${skill.name}' is not enabled (status=${skill.status})`);
    }

    let manifest: SkillManifest;
    try {
      manifest = await loadSkillFromDir(skill.skillPath);
    } catch (err) {
      await this.repo.completeExecution(execution.id, 'failed', { error: (err as Error).message }, 0, 0);
      throw new Error(`Failed to load skill manifest: ${(err as Error).message}`);
    }

    await this.repo.completeExecution(execution.id, 'running', null, 0, 0);

    try {
      const mergedConfig = { ...skill.config };
      const serverVars = await this.deps.buildServerVars(serverId, userId);
      const skillVars = await this.deps.buildSkillVars(skillId);

      const templateVars: TemplateVars = {
        input: mergedConfig,
        server: serverVars,
        skill: skillVars,
        now: new Date().toISOString(),
      };
      const resolvedPrompt = resolvePromptTemplate(manifest.prompt, templateVars);

      const runner = new SkillRunner();
      const runResult = await runner.run({
        manifest, resolvedPrompt, skillId, serverId, userId,
        executionId: execution.id, config: mergedConfig,
      });

      const duration = Date.now() - startTime;
      const status = runResult.status === 'success' ? 'success'
        : runResult.status === 'timeout' ? 'timeout' : 'failed';

      const result: Record<string, unknown> = {
        output: runResult.output, toolResults: runResult.toolResults, errors: runResult.errors,
      };

      await this.repo.completeExecution(execution.id, status, result, runResult.stepsExecuted, duration);

      this.deps.dispatchWebhookEvent(
        status === 'success' ? 'skill.completed' : 'skill.failed',
        userId,
        { serverId, skillId, skillName: skill.name, executionId: execution.id, status, duration },
      );

      return {
        executionId: execution.id, status, stepsExecuted: runResult.stepsExecuted,
        duration, result, errors: runResult.errors,
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMessage = (err as Error).message;
      await this.repo.completeExecution(execution.id, 'failed', { error: errorMessage }, 0, duration);

      this.deps.dispatchWebhookEvent('skill.failed', userId, {
        serverId, skillId, skillName: skill.name, executionId: execution.id,
        status: 'failed', duration, error: errorMessage,
      });

      return {
        executionId: execution.id, status: 'failed', stepsExecuted: 0,
        duration, result: null, errors: [errorMessage],
      };
    }
  }
}
