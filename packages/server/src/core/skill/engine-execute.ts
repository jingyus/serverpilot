// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill single-server execution logic, extracted from SkillEngine.
 *
 * Handles:
 * - `executeSingle()` — run a skill on a single server with template resolution
 * - `emitTriggerEvent()` — fire-and-forget event emission for chain triggers
 * - `dispatchWebhookEvent()` — fire-and-forget webhook dispatch
 * - `checkSkillRequirements()` — validate skill requirements against server profile
 *
 * All functions receive their dependencies as arguments (repo, triggerManager, etc.)
 * rather than importing the SkillEngine class, to avoid circular dependencies.
 *
 * @module core/skill/engine-execute
 */

import { createContextLogger } from '../../utils/logger.js';
import {
  loadSkillFromDir,
  resolvePromptTemplate,
  checkRequirements,
  type TemplateVars,
  type RequirementCheckResult,
} from './loader.js';
import { getServerRepository } from '../../db/repositories/server-repository.js';
import { getWebhookDispatcher } from '../webhook/dispatcher.js';
import { buildServerVars, buildSkillVars } from './engine-template-vars.js';
import { SkillRunner } from './runner.js';
import type { SkillRepository } from '../../db/repositories/skill-repository.js';
import type { TriggerManager } from './trigger-manager.js';
import type { SkillManifest } from '@aiinstaller/shared';
import type {
  InstalledSkill,
  SkillExecutionResult,
  SkillRunParams,
  ChainContext,
} from './types.js';

const logger = createContextLogger({ module: 'skill-execute' });

/**
 * Execute a skill on a single server.
 *
 * Manages the full lifecycle: requirement check → confirmation gate →
 * execution record → template resolution → SkillRunner → DB completion →
 * trigger/webhook dispatch.
 */
export async function executeSingle(
  params: SkillRunParams,
  skill: InstalledSkill,
  manifest: SkillManifest,
  deps: ExecuteSingleDeps,
): Promise<SkillExecutionResult> {
  const { skillId, serverId, userId, triggerType, chainContext, dryRun } = params;
  const startTime = Date.now();
  const effectiveTriggerType = dryRun ? 'dry-run' as const : triggerType;

  // Check skill requirements against server profile
  const reqCheck = await checkSkillRequirements(manifest, serverId, userId);
  if (!reqCheck.satisfied) {
    throw new Error(
      `Skill requirements not met: ${reqCheck.missing.join('; ')}`,
    );
  }
  if (reqCheck.warnings.length > 0) {
    logger.warn(
      { skillId, warnings: reqCheck.warnings },
      'Skill requirements check has warnings',
    );
  }

  // Check if confirmation is required for auto-triggered skills (never for dry-run)
  const needsConfirmation =
    !dryRun &&
    manifest.constraints?.requires_confirmation === true &&
    triggerType !== 'manual';

  if (needsConfirmation) {
    return deps.confirmationManager.createPendingConfirmation(params, skill, manifest);
  }

  // Create execution record
  const execution = await deps.repo.createExecution({
    skillId,
    serverId,
    userId,
    triggerType: effectiveTriggerType,
  });

  // Build chain context for downstream triggers
  const nextChain: ChainContext = {
    depth: (chainContext?.depth ?? 0) + 1,
    trail: [...(chainContext?.trail ?? []), skillId],
  };

  // Create AbortController for external cancellation
  const abortController = new AbortController();
  deps.runningExecutions.set(execution.id, abortController);

  try {
    // Resolve prompt template with available variables
    const mergedConfig = { ...skill.config, ...params.config };

    // Build server context from repository
    const serverVars = await buildServerVars(serverId, userId);

    // Build skill context from last execution
    const skillVars = await buildSkillVars(deps.repo, skillId);

    const templateVars: TemplateVars = {
      input: mergedConfig,
      server: serverVars,
      skill: skillVars,
      now: new Date().toISOString(),
    };
    const resolvedPrompt = resolvePromptTemplate(manifest.prompt, templateVars);

    // Run via AI SkillRunner
    const runner = new SkillRunner();
    const runResult = await runner.run({
      manifest,
      resolvedPrompt,
      skillId,
      serverId,
      userId,
      executionId: execution.id,
      config: mergedConfig,
      signal: abortController.signal,
      dryRun,
    });

    const duration = Date.now() - startTime;
    const status = runResult.status === 'success' ? 'success'
      : runResult.status === 'cancelled' ? 'cancelled'
      : runResult.status === 'timeout' ? 'timeout'
      : 'failed';

    const result: Record<string, unknown> = {
      output: runResult.output,
      toolResults: runResult.toolResults,
      errors: runResult.errors,
      ...(runResult.parsedOutputs ? { parsedOutputs: runResult.parsedOutputs } : {}),
    };

    await deps.repo.completeExecution(
      execution.id,
      status,
      result,
      runResult.stepsExecuted,
      duration,
    );

    logger.info(
      { executionId: execution.id, skillId, serverId, duration, steps: runResult.stepsExecuted },
      'Skill execution completed',
    );

    const execResult: SkillExecutionResult = {
      executionId: execution.id,
      status,
      stepsExecuted: runResult.stepsExecuted,
      duration,
      result,
      errors: runResult.errors,
    };

    // Skip trigger events and webhooks for dry-run — it's just a preview
    if (!dryRun) {
      emitTriggerEvent(
        deps.triggerManager,
        status === 'success' ? 'skill.completed' : 'skill.failed',
        { serverId, skillId, skillName: skill.name, executionId: execution.id, chainContext: nextChain },
      );

      dispatchWebhookEvent(
        status === 'success' ? 'skill.completed' : 'skill.failed',
        userId,
        { serverId, skillId, skillName: skill.name, executionId: execution.id, status, duration },
      );
    }

    return execResult;
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorMessage = (err as Error).message;

    await deps.repo.completeExecution(execution.id, 'failed', { error: errorMessage }, 0, duration);
    logger.error({ executionId: execution.id, skillId, error: errorMessage }, 'Skill execution failed');

    if (!dryRun) {
      emitTriggerEvent(deps.triggerManager, 'skill.failed', {
        serverId, skillId, skillName: skill.name, executionId: execution.id, chainContext: nextChain,
      });

      dispatchWebhookEvent('skill.failed', userId, {
        serverId, skillId, skillName: skill.name, executionId: execution.id,
        status: 'failed', duration, error: errorMessage,
      });
    }

    return {
      executionId: execution.id, status: 'failed', stepsExecuted: 0,
      duration, result: null, errors: [errorMessage],
    };
  } finally {
    deps.runningExecutions.delete(execution.id);
  }
}

/** Fire-and-forget event emission for chain triggers. */
export function emitTriggerEvent(
  triggerManager: TriggerManager | null,
  eventType: string,
  data: Record<string, unknown>,
): void {
  if (!triggerManager) return;
  triggerManager.handleEvent(eventType, data).catch((err) => {
    logger.error({ eventType, error: (err as Error).message }, 'Failed to emit trigger event');
  });
}

/** Fire-and-forget webhook dispatch for external subscribers. */
export function dispatchWebhookEvent(
  type: 'skill.completed' | 'skill.failed',
  userId: string,
  data: Record<string, unknown>,
): void {
  try {
    const dispatcher = getWebhookDispatcher();
    dispatcher.dispatch({ type, userId, data }).catch((err) => {
      logger.error({ type, error: (err as Error).message }, 'Failed to dispatch webhook event');
    });
  } catch {
    // Dispatcher not initialized — skip silently (e.g. in tests)
  }
}

/**
 * Check skill requirements against the target server's profile.
 * Agent version is not yet available in the protocol, so it passes null
 * which causes a graceful degradation to a warning.
 */
export async function checkSkillRequirements(
  manifest: SkillManifest,
  serverId: string,
  userId: string,
): Promise<RequirementCheckResult> {
  let serverProfile = null;
  try {
    const serverRepo = getServerRepository();
    serverProfile = await serverRepo.getProfile(serverId, userId);
  } catch {
    // Profile may not be available — checkRequirements handles null gracefully
  }

  // Agent version not yet reported via protocol — pass null to degrade to warning
  const agentVersion: string | null = null;

  return checkRequirements(manifest.requires, serverProfile, agentVersion);
}

/** Minimal interface for tracking running executions (duck-typed). */
interface ExecutionTracker {
  set(executionId: string, controller: AbortController): void;
  delete(executionId: string): void;
}

/** Dependencies injected from SkillEngine into executeSingle(). */
export interface ExecuteSingleDeps {
  repo: SkillRepository;
  triggerManager: TriggerManager | null;
  runningExecutions: ExecutionTracker;
  confirmationManager: {
    createPendingConfirmation(
      params: SkillRunParams,
      skill: InstalledSkill,
      manifest: SkillManifest,
    ): Promise<SkillExecutionResult>;
  };
}
